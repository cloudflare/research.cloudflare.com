import { describe, expect, it, vi } from "vitest";
import {
  buildCacheMetadata,
  translateOrLoadFromCache,
  type TranslateOrLoadOptions,
} from "../src/storage/cache.js";
import { extractSegments } from "../src/parsing/extract.js";
import { EMPTY_GLOSSARY } from "../src/glossary/glossary.js";
import { parseMarkdown } from "../src/parsing/parse.js";
import type { R2Client, R2GetResult } from "../src/storage/r2.js";
import type { Translator } from "../src/translation/provider.js";

/**
 * Cache-aware orchestrator tests.
 *
 * The flagship test (`miss-then-hit sequence`) exercises the M6.2
 * acceptance criterion: simulate two consecutive builds against an
 * in-memory R2 fixture and assert that the second build is a pure
 * cache hit — no provider call, no PUT. Several focused tests around
 * it cover the supporting behaviours (no-r2 fallback, metadata round-
 * trip, error propagation) so a regression in any branch surfaces
 * immediately rather than via the larger orchestration test.
 */

interface InMemoryR2Object {
  body: Uint8Array;
  metadata: Record<string, string>;
}

/**
 * Tiny in-memory R2 stand-in. Records every method call (so tests can
 * count provider/cache interactions across multiple builds) and stores
 * objects in a Map keyed by R2 key. Sufficient for orchestrator tests;
 * the real R2 client is exercised separately in `r2.test.ts`.
 */
function makeInMemoryR2() {
  const store = new Map<string, InMemoryR2Object>();
  const calls = {
    get: 0,
    put: 0,
    exists: 0,
    list: 0,
    del: 0,
  };
  const client: R2Client = {
    async get(key) {
      calls.get++;
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
      const bytes =
        typeof body === "string" ? new TextEncoder().encode(body) : body;
      store.set(key, {
        body: bytes,
        metadata: { ...(opts?.metadata ?? {}) },
      });
    },
    async exists(key) {
      calls.exists++;
      return store.has(key);
    },
    async list(prefix) {
      calls.list++;
      return [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({
          key: k,
          size: store.get(k)!.body.length,
          lastModified: new Date(0),
          etag: "",
        }));
    },
    async del(key) {
      calls.del++;
      store.delete(key);
    },
  };
  return { client, store, calls };
}

/**
 * Build a Translator stub that records every translate() call and
 * returns a JSON object echoing the prompt's segment ids back with a
 * locale-tagged prefix. Tests can spy on call counts without going
 * through the full prompt + provider stack.
 */
function makeStubTranslator(modelId = "stub/echo-1"): Translator & {
  calls: number;
} {
  const t = {
    modelId,
    calls: 0,
    async translate(_systemPrompt: string, userPrompt: string) {
      t.calls++;
      // Pull the JSON object out of the user prompt and echo each
      // segment with a "TR:" prefix. parseResponse will accept this.
      const start = userPrompt.indexOf("{");
      const end = userPrompt.lastIndexOf("}");
      const map = JSON.parse(userPrompt.slice(start, end + 1)) as Record<
        string,
        string
      >;
      const out: Record<string, string> = {};
      for (const [id, text] of Object.entries(map)) out[id] = `TR:${text}`;
      return JSON.stringify(out);
    },
  };
  return t;
}

const SAMPLE_SOURCE = [
  "---",
  "title: Hello",
  "---",
  "",
  "First paragraph with **bold** and *italic*.",
  "",
  "Second paragraph.",
  "",
].join("\n");

/** Build a fresh set of orchestrator inputs per test to keep cases isolated. */
function makeOptions(
  overrides: Partial<TranslateOrLoadOptions> & {
    r2?: R2Client | null;
  },
): TranslateOrLoadOptions {
  const ast = parseMarkdown(SAMPLE_SOURCE);
  const segments = extractSegments(
    ast,
    { sourcePath: "publications/sample.md", frontmatter: {} },
    SAMPLE_SOURCE,
  );
  const translator = overrides.translator ?? makeStubTranslator();
  return {
    ast,
    segments,
    sourceBody: SAMPLE_SOURCE,
    locale: "pt-BR",
    key: "i18n/pt-BR/publications/sample.md#abc123.md",
    r2: overrides.r2 ?? null,
    translator,
    glossary: EMPTY_GLOSSARY,
    sourceLocale: "en",
    metadata: buildCacheMetadata({
      sourcePath: "publications/sample.md",
      locale: "pt-BR",
      sourceHash: "abc123",
      glossaryHash: "",
      modelId: translator.modelId,
      translatedAt: "2026-04-29T12:00:00.000Z",
      polystellaVersion: "0.1.0",
    }),
    ...overrides,
  };
}

describe("translateOrLoadFromCache — miss-then-hit sequence", () => {
  it("first build translates + writes to R2; second build is a pure cache hit", async () => {
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator();

    // ─── Build #1 ─────────────────────────────────────────────────
    const first = await translateOrLoadFromCache(
      makeOptions({ r2: r2.client, translator }),
    );

    expect(first.outcome).toBe("miss");
    // Translator was hit exactly once.
    expect(translator.calls).toBe(1);
    // R2 saw one GET (the lookup) and one PUT (the write-back).
    expect(r2.calls.get).toBe(1);
    expect(r2.calls.put).toBe(1);
    // The translated body landed in the in-memory store.
    expect(r2.store.size).toBe(1);
    expect(r2.store.has("i18n/pt-BR/publications/sample.md#abc123.md")).toBe(
      true,
    );
    // The body came back as a string ready for staging writes.
    expect(typeof first.body).toBe("string");
    expect(first.body).toContain("TR:");

    // ─── Build #2 ─────────────────────────────────────────────────
    // Reset call counters, keep the store. This is the "second build"
    // simulation — same key, same source, R2 already has the bytes.
    r2.calls.get = 0;
    r2.calls.put = 0;
    translator.calls = 0;

    const second = await translateOrLoadFromCache(
      makeOptions({ r2: r2.client, translator }),
    );

    // Acceptance criterion: cache hit, no translator call, no PUT.
    expect(second.outcome).toBe("hit");
    expect(translator.calls).toBe(0);
    expect(r2.calls.put).toBe(0);
    expect(r2.calls.get).toBe(1);
    // The cached body must be byte-identical to what the first build
    // produced — that's the entire point of the cache.
    expect(second.body).toBe(first.body);
    // And the metadata round-trips through R2 unchanged.
    expect(second.cachedMetadata).toMatchObject({
      "source-path": "publications/sample.md",
      locale: "pt-BR",
      "source-hash": "abc123",
      "model-id": "stub/echo-1",
    });
  });
});

describe("translateOrLoadFromCache — fallback paths", () => {
  it("treats `r2: null` as 'always translate, never store'", async () => {
    const translator = makeStubTranslator();
    const result = await translateOrLoadFromCache(
      makeOptions({ r2: null, translator }),
    );
    expect(result.outcome).toBe("miss");
    expect(translator.calls).toBe(1);
    expect(result.body).toContain("TR:");
    // No assertions about r2 call counts — there's no client to call.
  });

  it("hits the cache and skips translation even when the translator would fail", async () => {
    const r2 = makeInMemoryR2();
    const cachedBody = "# Already-translated\n\nCached content.\n";
    const key = "i18n/pt-BR/publications/sample.md#abc123.md";
    // Pre-populate the store to simulate a prior build's write-back.
    await r2.client.put(key, cachedBody, {
      metadata: { "source-path": "publications/sample.md" },
    });
    r2.calls.put = 0; // ignore the setup PUT for the assertion below
    r2.calls.get = 0;

    // A translator that throws if called — the test fails loudly if
    // the cache layer falls through to translation on a hit.
    const explodingTranslator: Translator = {
      modelId: "stub/echo-1",
      translate: vi.fn().mockRejectedValue(new Error("should not be called")),
    };

    const result = await translateOrLoadFromCache(
      makeOptions({ r2: r2.client, translator: explodingTranslator }),
    );

    expect(result.outcome).toBe("hit");
    expect(result.body).toBe(cachedBody);
    expect(explodingTranslator.translate).not.toHaveBeenCalled();
    expect(r2.calls.put).toBe(0);
  });

  it("propagates translator errors so the build hook can count failures", async () => {
    const r2 = makeInMemoryR2();
    const angry: Translator = {
      modelId: "stub/echo-1",
      translate: vi.fn().mockRejectedValue(new Error("provider boom")),
    };
    await expect(
      translateOrLoadFromCache(
        makeOptions({ r2: r2.client, translator: angry }),
      ),
    ).rejects.toThrow(/provider boom/);
    // Failed translation must NOT produce a PUT.
    expect(r2.calls.put).toBe(0);
  });

  it("propagates R2 GET errors without invoking the translator", async () => {
    const translator = makeStubTranslator();
    const flakyR2: R2Client = {
      async get() {
        throw new Error("R2 unreachable");
      },
      async put() {},
      async exists() {
        return false;
      },
      async list() {
        return [];
      },
      async del() {},
    };
    await expect(
      translateOrLoadFromCache(makeOptions({ r2: flakyR2, translator })),
    ).rejects.toThrow(/R2 unreachable/);
    expect(translator.calls).toBe(0);
  });
});

describe("translateOrLoadFromCache — metadata", () => {
  it("attaches the caller's metadata bag to the cache PUT verbatim", async () => {
    const r2 = makeInMemoryR2();
    const meta = buildCacheMetadata({
      sourcePath: "publications/sample.md",
      locale: "pt-BR",
      sourceHash: "deadbeef",
      glossaryHash: "cafef00d",
      modelId: "@cf/meta/llama-3.1-8b-instruct",
      translatedAt: "2026-04-29T12:00:00.000Z",
      polystellaVersion: "0.1.0",
    });
    await translateOrLoadFromCache(
      makeOptions({ r2: r2.client, metadata: meta }),
    );
    const stored = r2.store.get("i18n/pt-BR/publications/sample.md#abc123.md");
    expect(stored).toBeDefined();
    expect(stored!.metadata).toEqual(meta);
  });

  it("decodes UTF-8 multi-byte cache hits correctly", async () => {
    const r2 = makeInMemoryR2();
    const key = "i18n/ja-JP/publications/sample.md#abc123.md";
    const japaneseBody = "膝点と肘点の検出。\n";
    await r2.client.put(key, japaneseBody);
    const result = await translateOrLoadFromCache(
      makeOptions({ r2: r2.client, locale: "ja-JP", key }),
    );
    expect(result.outcome).toBe("hit");
    expect(result.body).toBe(japaneseBody);
  });
});

describe("buildCacheMetadata", () => {
  it("emits the documented kebab-case key set with all values stringified", () => {
    const meta = buildCacheMetadata({
      sourcePath: "publications/sample.md",
      locale: "pt-BR",
      sourceHash: "abc123",
      glossaryHash: "def456",
      modelId: "@cf/meta/llama-3.1-8b-instruct",
      translatedAt: "2026-04-29T12:00:00.000Z",
      polystellaVersion: "0.1.0",
    });
    expect(meta).toEqual({
      "source-path": "publications/sample.md",
      locale: "pt-BR",
      "source-hash": "abc123",
      "glossary-hash": "def456",
      "model-id": "@cf/meta/llama-3.1-8b-instruct",
      "translated-at": "2026-04-29T12:00:00.000Z",
      "polystella-version": "0.1.0",
    });
    // Every value must be a string — R2 metadata can't carry numbers.
    for (const v of Object.values(meta)) expect(typeof v).toBe("string");
  });

  it("preserves an empty glossaryHash as the empty string (not omitted)", () => {
    const meta = buildCacheMetadata({
      sourcePath: "publications/sample.md",
      locale: "pt-BR",
      sourceHash: "abc123",
      glossaryHash: "",
      modelId: "stub",
      translatedAt: "2026-04-29T12:00:00.000Z",
      polystellaVersion: "0.1.0",
    });
    expect(meta["glossary-hash"]).toBe("");
    // The schema is intentionally fixed-shape so the build report can
    // assume every row carries every field.
    expect(Object.keys(meta).sort()).toEqual(
      [
        "glossary-hash",
        "locale",
        "model-id",
        "polystella-version",
        "source-hash",
        "source-path",
        "translated-at",
      ].sort(),
    );
  });
});
