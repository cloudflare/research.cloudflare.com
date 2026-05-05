import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveOptions } from "../src/config/options.js";
import { runTranslationPass } from "../src/translation/run.js";
import type { Logger } from "../src/translation/run.js";
import type { Translator } from "../src/translation/provider.js";
import type { R2Client, R2GetResult } from "../src/storage/r2.js";

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
      { defaultLocale: "en", locales: ["en", "pt-BR", "ja-JP"] },
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

    const resolved = resolveOptions({ sourceDir: "./content", include: ["**/*.md"] }, { defaultLocale: "en", locales: ["en", "pt-BR"] });
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
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
    expect(translator.calls).toBe(1);

    // Reset translator counter; store retains the bytes.
    translator.calls = 0;

    // Second run on the same input — every pair must be a hit and
    // the translator MUST NOT be called.
    const second = await runTranslationPass({
      resolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: overrides,
    });
    expect(second.counts.hit).toBe(1);
    expect(second.counts.miss).toBe(0);
    expect(translator.calls).toBe(0);
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
      { defaultLocale: "en", locales: ["en", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
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
    // No prune call either — readOnly forbids both side effects.
    expect(r2.calls.list).toBe(0);
    expect(r2.calls.del).toBe(0);
  });

  it("readFallbackPrefixes lets a preview run reuse main's cache without writing", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/publications/sample.md": SAMPLE_MD },
    });
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
      { defaultLocale: "en", locales: ["en", "pt-BR"] },
    );
    productionResolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
    };

    // Seed: production-mode run populates `i18n/...` prefix.
    const seed = await runTranslationPass({
      resolved: productionResolved,
      rootDir,
      stagingDir,
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
      { defaultLocale: "en", locales: ["en", "pt-BR"] },
    );
    previewResolved.provider = productionResolved.provider;

    const previewResult = await runTranslationPass({
      resolved: previewResolved,
      rootDir,
      stagingDir,
      logger: NULL_LOGGER,
      polystellaVersion: "0.2.0",
      r2Override: r2.client,
      translatorOverrides: new Map([["pt-BR", translator]]),
    });
    expect(previewResult.counts.hit).toBe(1);
    expect(previewResult.counts.miss).toBe(0);
    expect(translator.calls).toBe(0);
    // No new objects written — readOnly + cache hit means no PUTs
    // anywhere, ever.
    expect(r2.store.size).toBe(1);
  });
});

describe("runTranslationPass — early returns", () => {
  it("returns liveRan=false when no sources match the include glob", async () => {
    const { rootDir, stagingDir } = await makeProjectFixture({
      files: { "content/something-else.txt": "not markdown" },
    });
    const resolved = resolveOptions({ sourceDir: "./content", include: ["**/*.md"] }, { defaultLocale: "en", locales: ["en", "pt-BR"] });
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
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
      { defaultLocale: "en", locales: ["en", "pt-BR"] },
    );
    resolved.provider = {
      kind: "workers-ai",
      accountId: "fake",
      apiToken: "fake",
      model: "stub/m1",
      maxTokens: 8192,
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
