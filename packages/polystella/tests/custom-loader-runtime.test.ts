import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { LoaderContext } from "astro/loaders";

import {
  createCustomLoaderSibling,
  getRuntimeBridge,
  setRuntimeBridge,
  type CustomLoaderTranslateRecord,
  type PolystellaRuntimeBridge,
} from "../src/runtime/custom-loader-runtime.js";
import type {
  CapturedEntry,
  PolystellaCustomLoaderMarker,
} from "../src/content/custom-loader.js";
import { EMPTY_GLOSSARY } from "../src/glossary/glossary.js";
import type { Translator } from "../src/translation/provider.js";
import type { R2Client } from "../src/storage/r2.js";

/**
 * Tests for the runtime bridge powering custom-loader sibling
 * collections.
 *
 * The bridge is a module-scoped slot the integration writes to at
 * `config:setup` and sibling loaders read from at content-sync time.
 * Tests reset it via `setRuntimeBridge(null)` between cases so
 * module state doesn't leak across tests.
 *
 * The sibling-loader path is tested by stubbing the R2 client +
 * translator. We never actually call an LLM; the translator's
 * `translate` returns canned outputs and we assert the cache flow,
 * apply behaviour, and report-sink population.
 */

// Each test gets a fresh temp staging dir so staging fast-path
// assertions don't leak between tests. The bridge factory threads
// `stagingDirForTest` into every `makeBridge()` call.
let stagingDirForTest: string;

beforeEach(async () => {
  stagingDirForTest = await mkdtemp(path.join(tmpdir(), "polystella-cl-test-"));
});

afterEach(async () => {
  setRuntimeBridge(null);
  await rm(stagingDirForTest, { recursive: true, force: true });
});

function makeMarker(overrides: Partial<PolystellaCustomLoaderMarker> = {}): PolystellaCustomLoaderMarker {
  const entries: CapturedEntry[] = overrides.captureEntries
    ? []
    : [
        { id: "a", data: { title: "Hello", excerpt: "world" } },
        { id: "b", data: { title: "Foo", excerpt: "bar" } },
      ];
  return {
    name: "blog",
    translatableKeys: ["title", "excerpt"],
    captureEntries: async () => entries,
    ...overrides,
  };
}

/**
 * Mock translator. Astro's `Translator.translate` returns raw text
 * keyed by `@@id@@` markers (matches the real prompt protocol);
 * `translateBatch` then parses that into a `Map<id, translation>`.
 *
 * Our default mock parses the userPrompt for `@@id@@` markers,
 * captures the text between markers as the "translated" content,
 * and emits each one prefixed with `prefix` (default `"X:"`).
 * That gives the prefix-based assertions in the tests something
 * deterministic to match against.
 */
function makeTranslator(prefix = "X:", modelId = "test-model"): Translator {
  return {
    modelId,
    translate: vi.fn(async (_systemPrompt: string, userPrompt: string) => {
      // Parse `@@id@@\ntext\n` blocks out of the user prompt the same
      // way `parseResponse` expects them on the response side. The
      // builder's user-prompt format includes `@@id@@` lines bracketing
      // each segment's source text.
      const re = /^@@([^@\n]+?)@@\s*\n([\s\S]*?)(?=\n@@|$)/gm;
      const out: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = re.exec(userPrompt)) !== null) {
        const id = match[1]!.trim();
        const text = match[2]!.trim();
        out.push(`@@${id}@@\n${prefix}${text}`);
      }
      return out.join("\n");
    }),
  } as Translator;
}

function makeR2(initial: Record<string, { body: string; metadata?: Record<string, string> }> = {}): R2Client {
  const store = new Map<string, { body: string; metadata?: Record<string, string> }>();
  for (const [k, v] of Object.entries(initial)) store.set(k, v);
  return {
    get: vi.fn(async (key: string) => {
      const hit = store.get(key);
      if (!hit) return null;
      // Cast through `unknown` — the production R2 client's
      // `R2GetResult` has more fields (contentType, etag) than the
      // cache layer reads. Tests only need `body` + `metadata`.
      return {
        body: new TextEncoder().encode(hit.body),
        metadata: hit.metadata ?? {},
      };
    }),
    put: vi.fn(async (key: string, body: string, opts) => {
      store.set(key, { body, metadata: opts?.metadata ?? {} });
    }),
    list: vi.fn(async () => []),
    delete: vi.fn(async () => undefined),
  } as unknown as R2Client;
}

function makeBridge(overrides: Partial<PolystellaRuntimeBridge> = {}): PolystellaRuntimeBridge {
  const translator = makeTranslator();
  return {
    defaultLocale: "en-US",
    polystellaVersion: "test-0.0.0",
    r2ReadOnly: false,
    r2: null,
    stagingDir: stagingDirForTest,
    translatorsByLocale: new Map([["pt-BR", translator]]),
    glossariesByLocale: new Map([["pt-BR", EMPTY_GLOSSARY]]),
    glossaryHashByLocale: new Map([["pt-BR", ""]]),
    readFallbackPrefixes: [],
    concurrency: 4,
    reportSink: [],
    ...overrides,
  };
}

function makeStoreSpy() {
  const sets: Array<{ id: string; data: Record<string, unknown> }> = [];
  let clears = 0;
  const store = {
    set: vi.fn((entry: { id: string; data: Record<string, unknown> }) => {
      sets.push({ id: entry.id, data: entry.data });
      return true;
    }),
    clear: vi.fn(() => {
      clears++;
    }),
    get: vi.fn(),
    has: vi.fn(),
    delete: vi.fn(),
    entries: vi.fn(() => []),
    keys: vi.fn(() => []),
    values: vi.fn(() => []),
  } as unknown as LoaderContext["store"];
  return {
    store,
    sets,
    get clears() {
      return clears;
    },
  };
}

function makeCtx(store: LoaderContext["store"]): LoaderContext {
  // Minimal logger stub — the sibling loader's progress logging
  // calls .info() when the entry count exceeds the heartbeat
  // threshold. Tests use small entry counts that fall below the
  // threshold, but providing a stub keeps the surface valid for
  // every test path.
  const logger = {
    label: "test",
    fork: () => logger,
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  return {
    collection: "blog__pt-BR",
    store,
    logger,
    parseData: async ({ data }: { id: string; data: Record<string, unknown> }) => data,
  } as unknown as LoaderContext;
}

describe("runtime bridge — set/get/clear", () => {
  it("returns null when no bridge is set", () => {
    expect(getRuntimeBridge()).toBeNull();
  });

  it("returns the bridge after setRuntimeBridge", () => {
    const bridge = makeBridge();
    setRuntimeBridge(bridge);
    expect(getRuntimeBridge()).toBe(bridge);
  });

  it("setRuntimeBridge(null) clears the slot", () => {
    setRuntimeBridge(makeBridge());
    setRuntimeBridge(null);
    expect(getRuntimeBridge()).toBeNull();
  });
});

describe("createCustomLoaderSibling — passthrough when bridge absent", () => {
  it("populates the store with source entries verbatim when no bridge is set", async () => {
    // Integration absent / disabled — sibling loader degrades to
    // emit untranslated source entries so the per-locale routes
    // render (untranslated) instead of 404ing.
    setRuntimeBridge(null);

    const marker = makeMarker();
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    const spy = makeStoreSpy();
    await sibling.load(makeCtx(spy.store));

    expect(spy.clears).toBe(1);
    expect(spy.sets).toEqual([
      { id: "a", data: { title: "Hello", excerpt: "world" } },
      { id: "b", data: { title: "Foo", excerpt: "bar" } },
    ]);
  });

  it("uses a stable, predictable name (helps Astro's content debug logs)", () => {
    const marker = makeMarker();
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    expect(sibling.name).toBe("polystella-translated-blog-pt-BR");
  });
});

describe("createCustomLoaderSibling — passthrough when translator missing", () => {
  it("emits source entries when the bridge has no translator for the target locale", async () => {
    // dryRun, no-provider, or "runOn doesn't include this command" —
    // all surface as an empty translatorsByLocale for the target.
    const bridge = makeBridge({
      translatorsByLocale: new Map(), // no translator for pt-BR
    });
    setRuntimeBridge(bridge);

    const marker = makeMarker();
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    const spy = makeStoreSpy();
    await sibling.load(makeCtx(spy.store));

    expect(spy.sets).toEqual([
      { id: "a", data: { title: "Hello", excerpt: "world" } },
      { id: "b", data: { title: "Foo", excerpt: "bar" } },
    ]);
    // Outcomes recorded so the integration's build:done summary
    // surfaces why translation didn't happen.
    expect(bridge.reportSink).toHaveLength(2);
    expect(bridge.reportSink.every((r) => r.outcome === "skipped-no-translator")).toBe(true);
  });
});

describe("createCustomLoaderSibling — translation flow", () => {
  it("translates each entry and applies the AI marker", async () => {
    const translator = makeTranslator();
    const bridge = makeBridge({
      translatorsByLocale: new Map([["pt-BR", translator]]),
    });
    setRuntimeBridge(bridge);

    const marker = makeMarker();
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    const spy = makeStoreSpy();
    await sibling.load(makeCtx(spy.store));

    expect(spy.sets).toHaveLength(2);
    // Entry `a` translatable fields run through translator's "X:" prefix.
    const a = spy.sets[0]?.data as Record<string, unknown>;
    expect(a.title).toBe("X:Hello");
    expect(a.excerpt).toBe("X:world");
    // AI marker fields injected at the top level.
    expect(a.aiTranslated).toBe(true);
    expect(a.aiTranslationModel).toBe("test-model");
    expect(typeof a.aiTranslatedAt).toBe("string");
  });

  it("records ai-translated outcomes in the report sink", async () => {
    const bridge = makeBridge();
    setRuntimeBridge(bridge);

    const marker = makeMarker();
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    await sibling.load(makeCtx(makeStoreSpy().store));

    expect(bridge.reportSink).toHaveLength(2);
    expect(bridge.reportSink.every((r) => r.outcome === "ai-translated")).toBe(true);
    expect(bridge.reportSink.map((r) => r.entryId).sort()).toEqual(["a", "b"]);
    expect(bridge.reportSink.every((r) => r.locale === "pt-BR")).toBe(true);
    expect(bridge.reportSink.every((r) => r.loaderName === "blog")).toBe(true);
  });

  it("skips entries whose translatable fields are all missing/non-string", async () => {
    // If marker.translatableKeys = ["title"] but the entry has no
    // title field (or it's a number), there's nothing to translate.
    // The entry passes through with `skipped-no-translator` outcome.
    const bridge = makeBridge();
    setRuntimeBridge(bridge);

    const marker = makeMarker({
      translatableKeys: ["nonexistent"],
      captureEntries: async () => [{ id: "x", data: { title: "Hello" } }],
    });
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    const spy = makeStoreSpy();
    await sibling.load(makeCtx(spy.store));

    expect(spy.sets[0]?.data.title).toBe("Hello"); // unchanged
    expect(bridge.reportSink[0]?.outcome).toBe("skipped-no-translator");
  });

  it("preserves non-JSON-serialisable types (Date) on translatable fields' siblings", async () => {
    // Consumer schemas often declare `date: z.date()` (without coerce);
    // a Date object that round-trips through JSON.stringify/parse
    // would become a string and fail the schema. The translation
    // path uses the SOURCE entry's JS-typed values directly and only
    // overlays the translated strings on top — so Date stays a Date.
    const bridge = makeBridge();
    setRuntimeBridge(bridge);

    const sourceDate = new Date("2026-04-15T12:34:56.000Z");
    const marker = makeMarker({
      captureEntries: async () => [
        { id: "x", data: { title: "Hello", excerpt: "world", date: sourceDate, tags: ["a"] } },
      ],
    });
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    const spy = makeStoreSpy();
    await sibling.load(makeCtx(spy.store));

    const stored = spy.sets[0]?.data as Record<string, unknown>;
    // Translatable fields translated.
    expect(stored.title).toBe("X:Hello");
    expect(stored.excerpt).toBe("X:world");
    // Non-translatable fields keep their original JS-typed values
    // (Date stays a Date; array stays an array).
    expect(stored.date).toBeInstanceOf(Date);
    expect((stored.date as Date).toISOString()).toBe("2026-04-15T12:34:56.000Z");
    expect(stored.tags).toEqual(["a"]);
  });

  it("preserves Date types on the cache-hit path (R2 round-trip safe)", async () => {
    // The cache stores JSON bytes; on hit, those bytes contain Date
    // fields as ISO strings. The translateEntry routine must NOT
    // pass parsed-from-JSON data directly to the store — it must
    // overlay translated strings on the source's JS-typed data.
    const cannedHit = JSON.stringify(
      {
        title: "Cached translated title",
        excerpt: "Cached translated excerpt",
        date: "2026-04-15T12:34:56.000Z",
        tags: ["cached"],
        aiTranslated: true,
        aiTranslationModel: "test-model",
        aiTranslatedAt: "2025-01-01T00:00:00.000Z",
      },
      null,
      2,
    );
    const r2: R2Client = {
      get: vi.fn(async () => ({
        body: new TextEncoder().encode(cannedHit),
        metadata: {},
      })),
      put: vi.fn(),
      list: vi.fn(async () => []),
      delete: vi.fn(),
    } as unknown as R2Client;
    const bridge = makeBridge({ r2 });
    setRuntimeBridge(bridge);

    const sourceDate = new Date("2026-04-15T12:34:56.000Z");
    const marker = makeMarker({
      captureEntries: async () => [
        { id: "x", data: { title: "src", excerpt: "src", date: sourceDate, tags: ["source"] } },
      ],
    });
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    const spy = makeStoreSpy();
    await sibling.load(makeCtx(spy.store));

    const stored = spy.sets[0]?.data as Record<string, unknown>;
    expect(stored.title).toBe("Cached translated title");
    expect(stored.date).toBeInstanceOf(Date);
    // Non-translatable, non-marker fields come from SOURCE, not cache —
    // the cached `tags: ["cached"]` doesn't leak through.
    expect(stored.tags).toEqual(["source"]);
    // AI marker fields come from the cached bytes (preserves
    // provenance — `aiTranslatedAt` reflects when the cached
    // translation happened, not now).
    expect(stored.aiTranslatedAt).toBe("2025-01-01T00:00:00.000Z");
  });

  it("handles entries with non-string translatable values (skipped)", async () => {
    // marker.translatableKeys includes "title", but entry.data.title
    // is a number. We don't translate non-strings; the segment isn't
    // emitted.
    const bridge = makeBridge();
    setRuntimeBridge(bridge);

    const marker = makeMarker({
      captureEntries: async () => [
        { id: "x", data: { title: 42 as unknown as string, excerpt: "real" } },
      ],
    });
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    const spy = makeStoreSpy();
    await sibling.load(makeCtx(spy.store));

    // `excerpt` translated; `title` left as the number it was.
    expect(spy.sets[0]?.data).toMatchObject({
      title: 42,
      excerpt: "X:real",
    });
  });
});

describe("createCustomLoaderSibling — R2 cache integration", () => {
  it("issues an R2 GET per entry and translates on miss", async () => {
    const r2 = makeR2(); // empty store; everything misses
    const bridge = makeBridge({ r2, r2Prefix: "i18n/" });
    setRuntimeBridge(bridge);

    const marker = makeMarker();
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    await sibling.load(makeCtx(makeStoreSpy().store));

    // 2 entries × 1 GET each = 2 GETs.
    expect(r2.get).toHaveBeenCalledTimes(2);
    // Both missed → both PUT.
    expect(r2.put).toHaveBeenCalledTimes(2);
    expect(bridge.reportSink.every((r) => r.outcome === "ai-translated")).toBe(true);
  });

  it("returns cached bytes on a hit (no translator call, no PUT)", async () => {
    // Pre-populate R2 with a hit for entry "a". The translator
    // SHOULD NOT be invoked for that entry. The hit's body is what
    // we serve.
    const translator = makeTranslator();
    const bridge = makeBridge({
      r2: null, // populated below
      translatorsByLocale: new Map([["pt-BR", translator]]),
    });
    // Pre-seed: we need to know the R2 key first. Build it the same
    // way the runtime does — but easier: just intercept the first
    // GET to return canned bytes.
    let getCount = 0;
    const cannedHitBody = JSON.stringify(
      {
        title: "Cached title",
        excerpt: "Cached excerpt",
        aiTranslated: true,
        aiTranslationModel: "previous-model",
        aiTranslatedAt: "2025-01-01T00:00:00.000Z",
      },
      null,
      2,
    );
    const r2: R2Client = {
      get: vi.fn(async () => {
        getCount++;
        // First call (entry "a") hits; second call (entry "b") misses.
        if (getCount === 1) {
          return {
            body: new TextEncoder().encode(cannedHitBody),
            metadata: {},
          };
        }
        return null;
      }),
      put: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      delete: vi.fn(async () => undefined),
    } as unknown as R2Client;
    bridge.r2 = r2;
    setRuntimeBridge(bridge);

    const marker = makeMarker();
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    const spy = makeStoreSpy();
    await sibling.load(makeCtx(spy.store));

    // Entry "a" served from cache (with the pre-existing translated marker).
    expect(spy.sets[0]?.data.title).toBe("Cached title");
    expect(spy.sets[0]?.data.aiTranslationModel).toBe("previous-model");
    // Entry "b" translated fresh.
    expect(spy.sets[1]?.data.title).toBe("X:Foo");

    expect(bridge.reportSink[0]?.outcome).toBe("cache-hit");
    expect(bridge.reportSink[1]?.outcome).toBe("ai-translated");

    // Translator only called once (for the miss).
    expect(translator.translate).toHaveBeenCalledTimes(1);
  });

  it("does not PUT in readOnly mode (preview-branch behaviour)", async () => {
    const r2 = makeR2(); // empty — everything misses
    const bridge = makeBridge({ r2, r2ReadOnly: true });
    setRuntimeBridge(bridge);

    const marker = makeMarker();
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    await sibling.load(makeCtx(makeStoreSpy().store));

    // GETs happen (we still want to consume primary cache), but no
    // PUTs — readOnly prevents writing back.
    expect(r2.get).toHaveBeenCalled();
    expect(r2.put).not.toHaveBeenCalled();
  });
});

describe("createCustomLoaderSibling — error handling", () => {
  it("records an error outcome and falls back to source on translation failure", async () => {
    const translator: Translator = {
      modelId: "broken",
      translate: vi.fn(async () => {
        throw new Error("translator boom");
      }),
    } as unknown as Translator;
    const bridge = makeBridge({
      translatorsByLocale: new Map([["pt-BR", translator]]),
    });
    setRuntimeBridge(bridge);

    const marker = makeMarker();
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    const spy = makeStoreSpy();
    await sibling.load(makeCtx(spy.store));

    // Both entries land in the store with source data (no AI marker).
    expect(spy.sets[0]?.data.title).toBe("Hello"); // untranslated
    expect(spy.sets[0]?.data.aiTranslated).toBeUndefined();

    // Both outcomes are `error`.
    expect(bridge.reportSink.every((r) => r.outcome === "error")).toBe(true);
    expect(bridge.reportSink[0]?.errorMessage).toContain("translator boom");
  });
});

describe("createCustomLoaderSibling — staging fast-path without bridge (dev mode)", () => {
  it("reads staging files even when the runtime bridge is absent", async () => {
    // Pins the `pnpm dev` default-`runOn: ["build"]` case: the
    // integration's config:setup never ran in dev, so the bridge is
    // null — but `pnpm translate:build` previously wrote staged
    // translations. The sibling loader must read those staging
    // files regardless of bridge state. Before this regression
    // test, the bridge-null check came BEFORE the staging fast-path,
    // so dev mode silently passed through source data.
    const { writeFile, mkdir } = await import("node:fs/promises");

    // Use a known location reachable from process.cwd(). The
    // sibling loader's fallback path is `<cwd>/.astro/i18n-staging`.
    const cwdStagingDir = path.join(process.cwd(), ".astro", "i18n-staging");
    const blogDir = path.join(cwdStagingDir, "pt-BR", "blog");
    await mkdir(blogDir, { recursive: true });
    const stagingFilePath = path.join(blogDir, "regression-test-id.json");
    await writeFile(
      stagingFilePath,
      JSON.stringify(
        {
          title: "Translated via staging",
          excerpt: "Disk-fast-path translated text",
          aiTranslated: true,
          aiTranslationModel: "previous-build-model",
          aiTranslatedAt: "2025-01-01T00:00:00.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );

    try {
      // Explicitly null bridge — simulating dev mode without runOn.
      setRuntimeBridge(null);

      const marker = makeMarker({
        captureEntries: async () => [
          {
            id: "regression-test-id",
            data: { title: "Source title", excerpt: "Source excerpt" },
          },
        ],
      });
      const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
      const spy = makeStoreSpy();
      await sibling.load(makeCtx(spy.store));

      expect(spy.sets).toHaveLength(1);
      expect(spy.sets[0]?.data.title).toBe("Translated via staging");
      expect(spy.sets[0]?.data.excerpt).toBe("Disk-fast-path translated text");
    } finally {
      // Clean up our test file so it doesn't pollute the project.
      const { rm } = await import("node:fs/promises");
      await rm(stagingFilePath, { force: true });
    }
  });
});

describe("createCustomLoaderSibling — staging fast-path", () => {
  it("reads from disk staging when a snapshot exists (no R2/AI calls)", async () => {
    // Simulates the dev-mode flow: a previous `translate:build` ran
    // and wrote `<stagingDir>/<locale>/<name>/<id>.json` per entry.
    // The dev sync should serve those files directly, with no R2
    // GET and no translator invocation.
    const { writeFile, mkdir } = await import("node:fs/promises");
    const blogDir = path.join(stagingDirForTest, "pt-BR", "blog");
    await mkdir(blogDir, { recursive: true });
    await writeFile(
      path.join(blogDir, "a.json"),
      JSON.stringify(
        {
          title: "Title from staging",
          excerpt: "Excerpt from staging",
          aiTranslated: true,
          aiTranslationModel: "previous-model",
          aiTranslatedAt: "2025-01-01T00:00:00.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );

    // R2 + translator should NOT be touched.
    const r2 = makeR2();
    const translator = makeTranslator();
    const bridge = makeBridge({
      r2,
      translatorsByLocale: new Map([["pt-BR", translator]]),
    });
    setRuntimeBridge(bridge);

    const marker = makeMarker({
      captureEntries: async () => [
        { id: "a", data: { title: "src", excerpt: "src" } },
      ],
    });
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    const spy = makeStoreSpy();
    await sibling.load(makeCtx(spy.store));

    expect(spy.sets[0]?.data.title).toBe("Title from staging");
    expect(spy.sets[0]?.data.excerpt).toBe("Excerpt from staging");
    expect(spy.sets[0]?.data.aiTranslatedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(bridge.reportSink[0]?.outcome).toBe("staged");

    // No translator / R2 traffic.
    expect(translator.translate).not.toHaveBeenCalled();
    expect(r2.get).not.toHaveBeenCalled();
    expect(r2.put).not.toHaveBeenCalled();
  });

  it("writes a staging file after a successful translation", async () => {
    // Simulates the build flow: no staging file exists; translation
    // runs; the result lands on disk for the next dev run.
    const { readFile } = await import("node:fs/promises");
    const bridge = makeBridge();
    setRuntimeBridge(bridge);

    const marker = makeMarker({
      captureEntries: async () => [
        { id: "a", data: { title: "Hello", excerpt: "world" } },
      ],
    });
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    const spy = makeStoreSpy();
    await sibling.load(makeCtx(spy.store));

    expect(bridge.reportSink[0]?.outcome).toBe("ai-translated");
    // The translation should have been persisted to disk.
    const staged = await readFile(path.join(stagingDirForTest, "pt-BR", "blog", "a.json"), "utf8");
    const parsed = JSON.parse(staged);
    expect(parsed.title).toBe("X:Hello");
    expect(parsed.excerpt).toBe("X:world");
    expect(parsed.aiTranslated).toBe(true);
  });

  it("does NOT write staging for skipped-no-translator outcomes", async () => {
    // No translator → no translation → nothing useful to persist.
    // Avoid creating misleading staging files.
    const { readdir } = await import("node:fs/promises");
    const bridge = makeBridge({
      translatorsByLocale: new Map(), // no translator for pt-BR
    });
    setRuntimeBridge(bridge);

    const marker = makeMarker();
    const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    await sibling.load(makeCtx(makeStoreSpy().store));

    // The blog/ dir may or may not have been created (other tests
    // share `stagingDirForTest`, but the beforeEach gives us a fresh
    // dir). Either way, there should be no JSON files for blog.
    let files: string[] = [];
    try {
      files = await readdir(path.join(stagingDirForTest, "pt-BR", "blog"));
    } catch {
      // dir doesn't exist — acceptable
    }
    expect(files).toEqual([]);
  });
});

describe("createCustomLoaderSibling — concurrency", () => {
  it(
    "translates entries in parallel up to bridge.concurrency",
    async () => {
      // Pin that workers run concurrently. Each translation pauses
      // before resolving; we count how many are in-flight at peak.
      // With concurrency=3 and 6 entries, peak in-flight should be 3.
      let inFlight = 0;
      let peakInFlight = 0;
      const release: (() => void)[] = [];

      const slowTranslator: Translator = {
        modelId: "slow",
        translate: vi.fn(async (_sys: string, userPrompt: string) => {
          inFlight++;
          peakInFlight = Math.max(peakInFlight, inFlight);
          // Wait for the test to release us. This pins all `concurrency`
          // workers in flight simultaneously.
          await new Promise<void>((resolve) => release.push(resolve));
          inFlight--;
          // Emit a minimal valid response to satisfy parseResponse.
          const ids = [...userPrompt.matchAll(/^@@([^@\n]+?)@@/gm)].map((m) => m[1]);
          return ids.map((id) => `@@${id}@@\nX`).join("\n");
        }),
      } as unknown as Translator;

      const bridge = makeBridge({
        concurrency: 3,
        translatorsByLocale: new Map([["pt-BR", slowTranslator]]),
      });
      setRuntimeBridge(bridge);

      const marker = makeMarker({
        captureEntries: async () => [
          { id: "a", data: { title: "1" } },
          { id: "b", data: { title: "2" } },
          { id: "c", data: { title: "3" } },
          { id: "d", data: { title: "4" } },
          { id: "e", data: { title: "5" } },
          { id: "f", data: { title: "6" } },
        ],
        translatableKeys: ["title"],
      });

      const sibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
      const spy = makeStoreSpy();
      const loadPromise = sibling.load(makeCtx(spy.store));

      // Generous yield helper — each `await` flushes microtasks AND
      // gives Node a setTimeout(0) macrotask, so disk-I/O completions
      // (mkdir, writeFile) have time to land before the test reads
      // `release.length` again. setImmediate alone wasn't enough now
      // that successful translations write a staging file.
      const yieldRound = async (): Promise<void> => {
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 0));
        }
      };

      // Wait for the first batch to be in-flight (3 workers).
      while (release.length < 3) {
        await yieldRound();
      }
      // Release 6 in sequence so the rest of the workers can pick up.
      // Loop a fixed 6 iterations rather than `while (length > 0)` so
      // we don't exit early if a worker hasn't pushed yet.
      for (let i = 0; i < 6; i++) {
        // Wait until at least one release is queued for us to flip.
        while (release.length === 0) {
          await yieldRound();
        }
        const r = release.shift()!;
        r();
        await yieldRound();
      }
      await loadPromise;

      expect(peakInFlight).toBe(3);
      expect(spy.sets).toHaveLength(6);
    },
    20_000,
  );
});

describe("createCustomLoaderSibling — locale isolation", () => {
  it("two sibling loaders for different locales translate independently", async () => {
    const ptTranslator = makeTranslator();
    const jaTranslator = makeTranslator("JA:", "ja-model");
    const bridge = makeBridge({
      translatorsByLocale: new Map([
        ["pt-BR", ptTranslator],
        ["ja-JP", jaTranslator],
      ]),
      glossariesByLocale: new Map([
        ["pt-BR", EMPTY_GLOSSARY],
        ["ja-JP", EMPTY_GLOSSARY],
      ]),
      glossaryHashByLocale: new Map([
        ["pt-BR", ""],
        ["ja-JP", ""],
      ]),
    });
    setRuntimeBridge(bridge);

    const marker = makeMarker();
    const ptSibling = createCustomLoaderSibling({ marker, locale: "pt-BR" });
    const jaSibling = createCustomLoaderSibling({ marker, locale: "ja-JP" });

    const ptSpy = makeStoreSpy();
    const jaSpy = makeStoreSpy();
    await ptSibling.load(makeCtx(ptSpy.store));
    await jaSibling.load(makeCtx(jaSpy.store));

    expect(ptSpy.sets[0]?.data.title).toBe("X:Hello");
    expect(jaSpy.sets[0]?.data.title).toBe("JA:Hello");
    expect(ptSpy.sets[0]?.data.aiTranslationModel).toBe("test-model");
    expect(jaSpy.sets[0]?.data.aiTranslationModel).toBe("ja-model");
  });
});
