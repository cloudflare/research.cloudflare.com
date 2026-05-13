import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveOptions } from "../../src/config/options.js";
import { runTranslationPass } from "../../src/translation/run.js";
import type { Logger } from "../../src/translation/run.js";
import type { Translator } from "../../src/translation/provider.js";
import type { R2Client, R2GetResult } from "../../src/storage/r2.js";

/**
 * `runTranslationPass` integration tests.
 *
 * We exercise the orchestrator end-to-end against a temp source dir,
 * a stub translator, and an in-memory R2 fake. Hooks into branch
 * isolation (`prefix`, `readFallbackPrefixes`, `readOnly`) are tested
 * here at the orchestrator level — the per-pair contracts are still
 * covered by `cache.test.ts` and `prune.test.ts`.
 *
 * The orchestrator IS what wires those knobs together; if any rung
 * of the ladder is missed (e.g. config knob set, but never threaded
 * into `translateOrLoadFromCache`), only an integration test
 * surfaces it.
 */

const NULL_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

interface InMemoryR2Object {
  body: Uint8Array;
  metadata: Record<string, string>;
}

function makeInMemoryR2() {
  const store = new Map<string, InMemoryR2Object>();
  const calls = { get: 0, put: 0, list: 0, del: 0, exists: 0 };
  const getKeys: string[] = [];
  const client: R2Client = {
    async exists(key) {
      calls.exists++;
      return store.has(key);
    },
    async get(key) {
      calls.get++;
      getKeys.push(key);
      const obj = store.get(key);
      if (!obj) return null;
      const result: R2GetResult = {
        body: obj.body,
        contentType: "text/markdown; charset=utf-8",
        etag: null,
        metadata: obj.metadata,
      };
      return result;
    },
    async put(key, body, opts) {
      calls.put++;
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
      store.set(key, {
        body: bytes,
        metadata: { ...(opts?.metadata ?? {}) },
      });
    },
    async list(prefix) {
      calls.list++;
      return [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => ({
          key: k,
          size: v.body.length,
          lastModified: new Date(0),
          etag: "",
        }));
    },
    async del(key) {
      calls.del++;
      store.delete(key);
    },
  };
  return { client, store, calls, getKeys };
}

function makeStubTranslator(modelId = "stub/echo-1") {
  const t = {
    modelId,
    calls: 0,
    async translate(_systemPrompt: string, userPrompt: string) {
      t.calls++;
      // Echo each `@@<id>@@` block back with a `TR:` prefix.
      const blocks: string[] = [];
      const re = /^@@([^@\n]+?)@@\s*\n([\s\S]*?)(?=\n@@|$)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(userPrompt)) !== null) {
        const id = m[1]!.trim();
        const text = (m[2] ?? "").trim();
        blocks.push(`@@${id}@@\nTR:${text}`);
      }
      return blocks.join("\n\n");
    },
  };
  return t as Translator & { calls: number };
}

const SAMPLE_MD = ["---", "title: Hello", "---", "", "First paragraph.", "", "Second paragraph.", ""].join("\n");

let tempRoots: string[] = [];

async function makeProjectFixture(opts: { files: Record<string, string> }): Promise<{ rootDir: string; stagingDir: string }> {
  const rootDir = await mkdtemp(path.join(tmpdir(), "polystella-run-"));
  tempRoots.push(rootDir);
  for (const [rel, content] of Object.entries(opts.files)) {
    const abs = path.join(rootDir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  const stagingDir = path.join(rootDir, ".astro", "i18n-staging");
  return { rootDir, stagingDir };
}

beforeEach(() => {
  tempRoots = [];
});

afterEach(async () => {
  // Best-effort cleanup; rmdir failures are non-fatal because the
  // OS will reap the temp dir later.
  for (const root of tempRoots) {
    try {
      const { rm } = await import("node:fs/promises");
      await rm(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("runTranslationPass — staging output", () => {
  it("writes translated bytes to <stagingDir>/<locale>/<source> for each locale", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
    const r2 = makeInMemoryR2();
    const ptBR = makeStubTranslator("stub/pt-BR-1");
    const jaJP = makeStubTranslator("stub/ja-JP-1");

    const resolved = resolveOptions(
      {
        sourceDir: "./content",
        include: ["**/*.md"],
        // Schema requires r2 fields when r2 block is present; we
        // skip the block entirely (caching handled via r2Override).
      },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR", "ja-JP"] },
    );
    // Schema requires `provider` for live mode; we satisfy by
    // injecting translator overrides AND faking the provider field
    // — but the schema makes provider optional, so we can leave it
    // unset if we use translatorOverrides + dryRun=false. The
    // run-pass guard `liveMode = provider !== undefined && !dryRun`
    // means we need to set provider in resolved options. Patch it.
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/default",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    const result = await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([
        ["pt-BR", ptBR],
        ["ja-JP", jaJP],
      ]),
    });

    expect(result.liveRan).toBe(true);
    // 1 source × 2 target locales = 2 entries.
    expect(result.entries).toHaveLength(2);
    expect(result.counts.miss).toBe(2);
    expect(result.counts.hit).toBe(0);
    expect(ptBR.calls).toBe(1);
    expect(jaJP.calls).toBe(1);

    // Both staged files exist with translated content.
    const ptBody = await readFile(path.join(stagingDir, "pt-BR", "publications/sample.md"), "utf8");
    const jaBody = await readFile(path.join(stagingDir, "ja-JP", "publications/sample.md"), "utf8");
    expect(ptBody).toContain("TR:");
    expect(jaBody).toContain("TR:");
  });

  it("a second run on unchanged input is all cache hits (translator never called)", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator("stub/m1");

    const resolved = resolveOptions(
      { sourceDir: "./content", include: ["**/*.md"] },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    const overrides = new Map<string, Translator>([["pt-BR", translator]]);

    // First run — cold cache → translates and writes back.
    const first = await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: overrides,
    });
    expect(first.counts.miss).toBe(1);
    expect(first.counts.hit).toBe(0);
    expect(first.counts.localSkipped).toBe(0);
    expect(translator.calls).toBe(1);

    // Reset translator + R2 call counters; store retains the bytes
    // and the staging index file.
    translator.calls = 0;
    r2.calls.get = 0;

    // Second run on the same input + same staging dir — the local
    // staging index short-circuits the pair before any R2 call.
    const second = await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: overrides,
    });
    expect(second.counts.localSkipped).toBe(1);
    expect(second.counts.hit).toBe(0);
    expect(second.counts.miss).toBe(0);
    expect(translator.calls).toBe(0);
    // Crucially: zero R2 GETs on the second run. The whole point of
    // the local cache is to avoid the round-trip when nothing changed.
    expect(r2.calls.get).toBe(0);
  });
});

describe("runTranslationPass — branch-isolation knobs", () => {
  it("readOnly: true skips PUTs but still translates and stages bytes", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator("stub/m1");

    const resolved = resolveOptions(
      {
        sourceDir: "./content",
        include: ["**/*.md"],
        r2: {
          accountId: "fake",
          bucket: "preview-bucket",
          accessKeyId: "fake",
          secretAccessKey: "fake",
          prefix: "previews/feat-x/i18n/",
          readOnly: true,
        },
      },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    const result = await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });

    // Translator ran (bytes need to come from somewhere) and the
    // staging file landed on disk — but R2 is untouched.
    expect(result.counts.miss).toBe(1);
    expect(translator.calls).toBe(1);
    const staged = await readFile(path.join(stagingDir, "pt-BR", "publications/sample.md"), "utf8");
    expect(staged).toContain("TR:");
    expect(r2.calls.put).toBe(0);
    expect(r2.store.size).toBe(0);
    // No prune call — readOnly forbids the post-translation prune
    // (which would otherwise list + del). The bulk pre-list at the
    // start of the live phase IS allowed: it's a read-only optim
    // that turns per-pair GETs into one list per locale.
    expect(r2.calls.del).toBe(0);
  });

  it("readFallbackPrefixes lets a preview run reuse main's cache without writing", async () => {
    // Seed run uses one staging dir (`<root>/.astro/i18n-staging`),
    // preview run uses a SEPARATE staging dir to simulate a fresh
    // CI checkout where the preview build doesn't see main's local
    // cache index. Otherwise the local-cache layer would short-
    // circuit the pair before R2 is ever queried, defeating the
    // point of testing the R2 fallback path.
    const { rootDir, stagingDir: seedStagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
    const previewStagingDir = path.join(rootDir, ".astro", "preview-staging");
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator("stub/m1");

    // Pre-populate "main" prefix as if a prior production build
    // already translated this file. The hash isn't easy to hand-
    // compute here, so we'll do a two-pass setup: run once with
    // the production config to seed the cache, then run again with
    // the preview config and assert the fallback hits.
    const productionResolved = resolveOptions(
      {
        sourceDir: "./content",
        include: ["**/*.md"],
        r2: {
          accountId: "fake",
          bucket: "preview-bucket",
          accessKeyId: "fake",
          secretAccessKey: "fake",
          prefix: "i18n/",
        },
      },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    productionResolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    // Seed: production-mode run populates `i18n/...` prefix.
    const seed = await runTranslationPass({
      resolved: productionResolved,
      rootDir,
      stagingDir: seedStagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });
    expect(seed.counts.miss).toBe(1);
    expect(translator.calls).toBe(1);
    expect(r2.store.size).toBe(1);

    // Reset: preview-mode run should fallback-hit, no translation.
    translator.calls = 0;
    const previewResolved = resolveOptions(
      {
        sourceDir: "./content",
        include: ["**/*.md"],
        r2: {
          accountId: "fake",
          bucket: "preview-bucket",
          accessKeyId: "fake",
          secretAccessKey: "fake",
          prefix: "previews/feat-x/i18n/",
          readFallbackPrefixes: ["i18n/"],
          readOnly: true,
        },
      },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    previewResolved.provider = productionResolved.provider;

    const previewResult = await runTranslationPass({
      resolved: previewResolved,
      rootDir,
      stagingDir: previewStagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });
    expect(previewResult.counts.hit).toBe(1);
    expect(previewResult.counts.miss).toBe(0);
    expect(previewResult.counts.localSkipped).toBe(0);
    expect(translator.calls).toBe(0);
    // No new objects written — readOnly + cache hit means no PUTs
    // anywhere, ever.
    expect(r2.store.size).toBe(1);
  });
});

describe("runTranslationPass — local staging index", () => {
  // The local index sits at `<stagingDir>/.polystella-index.json`
  // and short-circuits unchanged pairs before they touch R2 or the
  // translator. Three behaviours to pin:
  //   1. Second run with same source = local-skipped (no R2, no
  //      translator).
  //   2. Edited source on a second run = invalidates the index
  //      entry and re-translates.
  //   3. Missing staged file (deleted out-of-band) = treats the
  //      index entry as stale and re-fetches.

  it("a second run with edited source invalidates the index and re-translates", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator("stub/m1");
    const resolved = resolveOptions(
      { sourceDir: "./content", include: ["**/*.md"] },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };
    const overrides = new Map<string, Translator>([["pt-BR", translator]]);

    await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: overrides,
    });
    expect(translator.calls).toBe(1);
    translator.calls = 0;

    // Edit the source file. The new content hash mismatches the
    // index entry's hash → skip path declines, R2 GET fires (miss
    // because the new hash isn't in R2 either) → translator runs.
    const edited = SAMPLE_MD.replace("First paragraph.", "Edited paragraph.");
    await writeFile(path.join(rootDir, "content/publications/sample.md"), edited, "utf8");

    const second = await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: overrides,
    });
    expect(second.counts.localSkipped).toBe(0);
    expect(second.counts.miss).toBe(1);
    expect(translator.calls).toBe(1);
    // The edited staged file reflects the new content.
    const stagedAfter = await readFile(path.join(stagingDir, "pt-BR", "publications/sample.md"), "utf8");
    expect(stagedAfter).toContain("TR:Edited paragraph");
  });

  it("a missing staged file forces a re-fetch even if the index has an entry", async () => {
    // Operator may have done `rm <stagingDir>/<locale>/<file>`
    // out-of-band (or it got clobbered by a partial extract). The
    // index entry alone doesn't mean the file is on disk — the
    // skip path stats the staged file before short-circuiting.
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator("stub/m1");
    const resolved = resolveOptions(
      { sourceDir: "./content", include: ["**/*.md"] },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };
    const overrides = new Map<string, Translator>([["pt-BR", translator]]);

    await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: overrides,
    });
    translator.calls = 0;

    // Delete the staged file but leave the index entry.
    const { rm } = await import("node:fs/promises");
    await rm(path.join(stagingDir, "pt-BR", "publications/sample.md"));

    const second = await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: overrides,
    });
    // R2 has the bytes, so this is a cache hit (not a translator
    // call), but it's NOT a local-skip — the staging file was
    // missing and had to be re-staged from R2.
    expect(second.counts.localSkipped).toBe(0);
    expect(second.counts.hit).toBe(1);
    expect(translator.calls).toBe(0);
    // The staged file is back.
    const stagedAfter = await readFile(path.join(stagingDir, "pt-BR", "publications/sample.md"), "utf8");
    expect(stagedAfter).toContain("TR:");
  });

  it("persists the index across multiple runs (the third run skips again)", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator("stub/m1");
    const resolved = resolveOptions(
      { sourceDir: "./content", include: ["**/*.md"] },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };
    const overrides = new Map<string, Translator>([["pt-BR", translator]]);

    // Three consecutive identical runs.
    for (let i = 0; i < 3; i++) {
      await runTranslationPass({
        resolved,
        rootDir,
        stagingDir,
        logger: NULL_LOGGER,
        polystellaVersion: "0.2.0",
        r2Override: r2.client,
        translatorOverrides: overrides,
      });
    }
    // Translator was called exactly once (run 1). Runs 2 and 3 hit
    // the local-skip path — meaning the index is being persisted
    // and re-read across invocations.
    expect(translator.calls).toBe(1);
  });
});

describe("runTranslationPass — early returns", () => {
  it("returns liveRan=false when no sources match the include glob", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/something-else.txt": "not markdown" },
    });
    const resolved = resolveOptions(
      { sourceDir: "./content", include: ["**/*.md"] },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    const result = await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
    });
    expect(result.liveRan).toBe(false);
    expect(result.entries).toHaveLength(0);
  });

  it("returns liveRan=false when dryRun is enabled (still logs the planned key set)", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
    const resolved = resolveOptions(
      { sourceDir: "./content", include: ["**/*.md"], dryRun: true },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    const result = await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
    });
    expect(result.liveRan).toBe(false);
    // No staging output, no entries — but the function ran the
    // dry-run key enumeration without throwing.
    expect(result.entries).toHaveLength(0);
  });
});

describe("runTranslationPass — URL rewriting", () => {
  // End-to-end: prove the pipeline ties `markdown.urls` /
  // `noPrefixUrls` config to staged-bytes URL rewriting. Each test
  // builds a tiny project with a known frontmatter URL and inspects
  // the staged file.

  // A minimal markdown source with a frontmatter URL field. The body
  // also has an internal link so we can verify both rewrite paths.
  const URL_SAMPLE_MD = [
    "---",
    "title: Hello",
    "heroImage: /images/hero.png",
    "pdfLink: /docs/paper.pdf",
    "---",
    "",
    "See [the API docs](/api-docs) and [the blog](/blog).",
    "",
  ].join("\n");

  it("rewrites configured frontmatter URL keys to be locale-prefixed", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": URL_SAMPLE_MD },
    });
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator("stub/url-1");
    const resolved = resolveOptions(
      {
        sourceDir: "./content",
        include: ["**/*.md"],
        markdown: {
          keys: { "publications/**": ["title"] },
          urls: { "publications/**": ["heroImage", "pdfLink"] },
        },
      },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/url-1",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });

    const ptBody = await readFile(path.join(stagingDir, "pt-BR", "publications/sample.md"), "utf8");
    expect(ptBody).toContain("heroImage: /pt-BR/images/hero.png");
    expect(ptBody).toContain("pdfLink: /pt-BR/docs/paper.pdf");
    // Body links rewritten by the existing rewriteInternalLinks pass.
    expect(ptBody).toContain("(/pt-BR/api-docs)");
    expect(ptBody).toContain("(/pt-BR/blog)");
  });

  it("honours noPrefixUrls for both frontmatter and body links", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": URL_SAMPLE_MD },
    });
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator("stub/url-2");
    const resolved = resolveOptions(
      {
        sourceDir: "./content",
        include: ["**/*.md"],
        markdown: {
          keys: { "publications/**": ["title"] },
          urls: { "publications/**": ["heroImage", "pdfLink"] },
        },
        // pdfLink-style paths AND body /api-docs are exempt — both
        // should pass through unchanged.
        noPrefixUrls: ["/docs/**", "/api-docs"],
      },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/url-2",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });

    const ptBody = await readFile(path.join(stagingDir, "pt-BR", "publications/sample.md"), "utf8");
    // Frontmatter: heroImage prefixed (no exemption); pdfLink exempted.
    expect(ptBody).toContain("heroImage: /pt-BR/images/hero.png");
    expect(ptBody).toContain("pdfLink: /docs/paper.pdf");
    // Body: /blog prefixed; /api-docs exempted.
    expect(ptBody).toContain("(/pt-BR/blog)");
    expect(ptBody).toContain("(/api-docs)");
    expect(ptBody).not.toContain("(/pt-BR/api-docs)");
  });

  it("does not bake URL rewrites into cached R2 bytes (cache stays URL-naïve)", async () => {
    // The whole point of running URL rewriting AFTER the cache layer:
    // R2-stored bytes are URL-rewrite-naïve, so editing `noPrefixUrls`
    // doesn't bust the cache. To prove this, we run the same source
    // twice with different `noPrefixUrls` configs and check the cached
    // R2 object stays identical across runs (cache hit, identical
    // bytes), while the staged file reflects each run's exemption.
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": URL_SAMPLE_MD },
    });
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator("stub/url-3");

    const baseResolved = resolveOptions(
      {
        sourceDir: "./content",
        include: ["**/*.md"],
        markdown: {
          keys: { "publications/**": ["title"] },
          urls: { "publications/**": ["heroImage"] },
        },
      },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    baseResolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/url-3",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    // First run, no exemptions: heroImage prefixed.
    await runTranslationPass({
      resolved: baseResolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });
    expect(translator.calls).toBe(1);
    // Capture cached R2 bytes (only one pt-BR object should exist).
    const r2Keys = [...r2.store.keys()];
    expect(r2Keys).toHaveLength(1);
    const cachedBytesAfterRun1 = new TextDecoder().decode(r2.store.get(r2Keys[0]!)!.body);

    // Second run with `noPrefixUrls` adding heroImage's path. Same
    // source bytes → same cache key → cache HIT, no translator call.
    // Stale staging file gets cleared so we re-stage from scratch.
    const { rootDir: rootDir2, stagingDir: stagingDir2 } = await makeProjectFixture({
      files: { "content/publications/sample.md": URL_SAMPLE_MD },
    });
    const exemptResolved = resolveOptions(
      {
        sourceDir: "./content",
        include: ["**/*.md"],
        markdown: {
          keys: { "publications/**": ["title"] },
          urls: { "publications/**": ["heroImage"] },
        },
        noPrefixUrls: ["/images/**"],
      },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    exemptResolved.provider = baseResolved.provider;
    translator.calls = 0;

    await runTranslationPass({
      resolved: exemptResolved,
      rootDir: rootDir2,
      stagingDir: stagingDir2,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });
    expect(translator.calls).toBe(0); // pure cache hit
    // Cached R2 bytes did NOT change.
    const cachedBytesAfterRun2 = new TextDecoder().decode(r2.store.get(r2Keys[0]!)!.body);
    expect(cachedBytesAfterRun2).toBe(cachedBytesAfterRun1);
    // But the staged file reflects the new exemption.
    const ptBody = await readFile(path.join(stagingDir2, "pt-BR", "publications/sample.md"), "utf8");
    expect(ptBody).toContain("heroImage: /images/hero.png");
    expect(ptBody).not.toContain("heroImage: /pt-BR/images/hero.png");
  });
});

describe("runTranslationPass — cancellation", () => {
  it("pre-aborted signal short-circuits before any work", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
    const resolved = resolveOptions(
      { sourceDir: "./content", include: ["**/*.md"] },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    const controller = new AbortController();
    controller.abort(new Error("pre-cancelled"));

    await expect(
      runTranslationPass({
        resolved,
        rootDir,
        stagingDir,
        logger: NULL_LOGGER,
        polystellaVersion: "0.2.0",
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("aborting mid-run propagates into the worker pool", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: {
        "content/publications/a.md": SAMPLE_MD,
        "content/publications/b.md": SAMPLE_MD,
        "content/publications/c.md": SAMPLE_MD,
      },
    });
    const resolved = resolveOptions(
      { sourceDir: "./content", include: ["**/*.md"], concurrency: 1 },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    const controller = new AbortController();
    let calls = 0;
    const translator: Translator = {
      modelId: "stub/m1",
      async translate(_sys, userPrompt) {
        calls++;
        // Abort after the first translator call returns. Subsequent
        // workers should see the signal and bail before calling
        // `translate()` again.
        controller.abort(new Error("user cancelled"));
        const blocks: string[] = [];
        const re = /^@@([^@\n]+?)@@\s*\n([\s\S]*?)(?=\n@@|$)/gm;
        let m: RegExpExecArray | null;
        while ((m = re.exec(userPrompt)) !== null) {
          blocks.push(`@@${m[1]!.trim()}@@\nTR:${(m[2] ?? "").trim()}`);
        }
        return blocks.join("\n\n");
      },
    };

    await expect(
      runTranslationPass({
        resolved,
        rootDir,
        stagingDir,
        logger: NULL_LOGGER,
        polystellaVersion: "0.2.0",
        translatorOverrides: new Map([["pt-BR", translator]]),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    // Strictly fewer than the 3 pairs we'd have processed without
    // cancellation. Exactly 1 is the strictest assertion we can make
    // (the first pair completes before the abort lands).
    expect(calls).toBeLessThan(3);
  });
});

describe("runTranslationPass — bulk pre-list optimisation", () => {
  it("issues one list() per locale and skips per-pair GETs when cache is empty", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: {
        "content/publications/a.md": SAMPLE_MD,
        "content/publications/b.md": SAMPLE_MD,
        "content/publications/c.md": SAMPLE_MD,
      },
    });
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator("stub/bulk-1");
    const resolved = resolveOptions(
      { sourceDir: "./content", include: ["**/*.md"] },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR", "ja-JP"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/bulk-1",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([
        ["pt-BR", translator],
        ["ja-JP", translator],
      ]),
    });

    // 2 locales × 1 prefix = 2 list calls (one per locale).
    expect(r2.calls.list).toBe(2);
    // 3 sources × 2 locales = 6 pairs; all cache misses on first run,
    // but the predicate said "no" for each, so ZERO GET round-trips.
    expect(r2.calls.get).toBe(0);
    // All 6 pairs translated and stored.
    expect(translator.calls).toBe(6);
    expect(r2.store.size).toBe(6);
  });

  it("uses the predicate to skip GETs for keys the list never returned", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator("stub/bulk-2");
    const resolved = resolveOptions(
      { sourceDir: "./content", include: ["**/*.md"] },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/bulk-2",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    // Run once to populate R2.
    await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });
    expect(translator.calls).toBe(1);

    // Second run, fresh staging dir to bypass local index. The
    // bulk-list predicate sees the cached key → exactly ONE GET to
    // pull the bytes → translator not invoked.
    const { rootDir: rootDir2, stagingDir: stagingDir2 } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
    translator.calls = 0;
    r2.calls.get = 0;
    r2.calls.list = 0;

    await runTranslationPass({
      resolved,
      rootDir: rootDir2,
      stagingDir: stagingDir2,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });

    expect(r2.calls.list).toBe(1);
    expect(r2.calls.get).toBe(1); // predicate said yes; GET pulls bytes
    expect(translator.calls).toBe(0);
  });

  it("bulkListOnStart: false disables the pre-list", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator("stub/bulk-3");
    const resolved = resolveOptions(
      {
        sourceDir: "./content",
        include: ["**/*.md"],
        r2: {
          accountId: "fake",
          bucket: "fake",
          accessKeyId: "fake",
          secretAccessKey: "fake",
          bulkListOnStart: false,
        },
      },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/bulk-3",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    const listsBefore = r2.calls.list;
    await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });

    // No bulk pre-list happened. The post-translation prune DOES
    // call list() per locale; that one is unrelated to bulkListOnStart.
    // 1 source × 1 locale × prune = 1 list. With bulkListOnStart on
    // we'd have 1 (pre) + 1 (prune) = 2.
    expect(r2.calls.list - listsBefore).toBe(1);
    expect(r2.calls.get).toBeGreaterThan(0);
  });

  it("falls back to per-pair GETs if the pre-list throws", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
    const r2 = makeInMemoryR2();
    // Override list to throw; verify the run still completes via
    // per-pair GETs.
    r2.client.list = async () => {
      throw new Error("simulated R2 list outage");
    };
    const translator = makeStubTranslator("stub/bulk-4");
    const resolved = resolveOptions(
      { sourceDir: "./content", include: ["**/*.md"] },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/bulk-4",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };

    const result = await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });

    // Translation still happened end-to-end via the per-pair GET path.
    expect(result.counts.miss).toBe(1);
    expect(translator.calls).toBe(1);
  });
});

describe("runTranslationPass — batching wire-through", () => {
  // End-to-end check that `runTranslationPass` resolves
  // `groupSegments` + `documentContext` from the markdown adapter
  // and forwards them through `translateOrLoadFromCache` →
  // `translateSegments`. Asserts on translator call shape rather
  // than internals — if any rung of the ladder is missed, the stub
  // translator's recorded prompts surface the gap.

  const MULTI_SECTION_MD = [
    "---",
    "title: Echo State Networks",
    "excerpt: A practical guide to reservoir computing.",
    "---",
    "",
    "# Introduction",
    "",
    "Reservoir computing is a paradigm.",
    "",
    "## Background",
    "",
    "The history of reservoir computing.",
    "",
    "## Method",
    "",
    "We describe the method here.",
    "",
    "## Results",
    "",
    "Results section content.",
  ].join("\n");

  function makeRecordingTranslator(modelId = "stub/recording") {
    const calls: { systemPrompt: string; userPrompt: string }[] = [];
    const t = {
      modelId,
      async translate(systemPrompt: string, userPrompt: string) {
        calls.push({ systemPrompt, userPrompt });
        const blocks: string[] = [];
        const re = /^@@([^@\n]+?)@@\s*\n([\s\S]*?)(?=\n@@|$)/gm;
        let m: RegExpExecArray | null;
        while ((m = re.exec(userPrompt)) !== null) {
          const id = m[1]!.trim();
          const text = (m[2] ?? "").trim();
          blocks.push(`@@${id}@@\nTR:${text}`);
        }
        return blocks.join("\n\n");
      },
    };
    return { translator: t as Translator, calls };
  }

  it("emits a single batch for a small file (no behaviour change vs. today)", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
    const r2 = makeInMemoryR2();
    const { translator, calls } = makeRecordingTranslator();
    const resolved = resolveOptions(
      {
        sourceDir: "./content",
        include: ["**/*.md"],
      },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };
    await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });
    // Small file fits in one batch — one network call.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.systemPrompt).not.toMatch(/DOCUMENT CONTEXT/);
  });

  it("injects DOCUMENT CONTEXT into every batch's system prompt when markdown.contextKeys is configured", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/multi.md": MULTI_SECTION_MD },
    });
    const r2 = makeInMemoryR2();
    const { translator, calls } = makeRecordingTranslator();
    const resolved = resolveOptions(
      {
        sourceDir: "./content",
        include: ["**/*.md"],
        markdown: {
          keys: { "publications/**": ["title", "excerpt"] },
          contextKeys: { "publications/**": ["title", "excerpt"] },
        },
      },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
      batchInputTokenBudget: 4000,
    };
    await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });
    // Document context appears in every call's system prompt.
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.systemPrompt).toContain("DOCUMENT CONTEXT");
      expect(call.systemPrompt).toContain("Title: Echo State Networks");
      expect(call.systemPrompt).toContain("Excerpt: A practical guide to reservoir computing.");
    }
  });

  it("groups by heading: each H2-anchored section translates as its own batch under a tight budget", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/multi.md": MULTI_SECTION_MD },
    });
    const r2 = makeInMemoryR2();
    const { translator, calls } = makeRecordingTranslator();
    const resolved = resolveOptions(
      {
        sourceDir: "./content",
        include: ["**/*.md"],
        markdown: {
          keys: { "publications/**": ["title", "excerpt"] },
        },
      },
      { defaultLocale: "en-US", locales: ["en-US", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
      // Tight budget so each heading-anchored group becomes its own batch.
      batchInputTokenBudget: 15,
    };
    await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });
    // 1 H1 + 3 H2 sections + frontmatter = 5 groups; under a tight
    // budget each becomes its own batch (or fewer if neighbours fit).
    expect(calls.length).toBeGreaterThan(1);
  });
});
