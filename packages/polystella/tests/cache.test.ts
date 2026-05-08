import { describe, expect, it, vi } from "vitest";
import { buildCacheMetadata, translateOrLoadFromCache, type TranslateOrLoadOptions } from "../src/storage/cache.js";
import { applyTranslations } from "../src/parsing/apply.js";
import { extractSegments } from "../src/parsing/extract.js";
import { EMPTY_GLOSSARY, hashGlossary, type Glossary } from "../src/glossary/glossary.js";
import { computeSourceHash } from "../src/storage/hash.js";
import { parseMarkdown } from "../src/parsing/parse.js";
import { buildR2Key, type R2Client, type R2GetResult } from "../src/storage/r2.js";
import type { Translator } from "../src/translation/provider.js";

/**
 * Cache-aware orchestrator tests.
 *
 * The flagship test (`miss-then-hit sequence`) simulates two
 * consecutive builds against an in-memory R2 fixture and asserts
 * that the second build is a pure cache hit — no provider call, no
 * PUT — which is the whole point of the cache. Several focused tests around
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
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
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
      // Pull each `@@<id>@@` block out of the user prompt and echo
      // its content back with a "TR:" prefix in the same marker format.
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
  return t;
}

const SAMPLE_SOURCE = ["---", "title: Hello", "---", "", "First paragraph with **bold** and *italic*.", "", "Second paragraph.", ""].join(
  "\n",
);

/** Build a fresh set of orchestrator inputs per test to keep cases isolated. */
function makeOptions(
  overrides: Partial<TranslateOrLoadOptions> & {
    r2?: R2Client | null;
    /**
     * Test-only convenience: when set, the default `apply` closure
     * forwards them as `frontmatterAdditions` to the markdown applier
     * (mirroring how `runTranslationPass` weaves the AI-translation
     * marker into the closure).
     */
    frontmatterAdditions?: Record<string, unknown>;
  },
): TranslateOrLoadOptions {
  const ast = parseMarkdown(SAMPLE_SOURCE);
  const segments = extractSegments(ast, { sourcePath: "publications/sample.md", frontmatter: {} }, SAMPLE_SOURCE);
  const translator = overrides.translator ?? makeStubTranslator();
  const fm = overrides.frontmatterAdditions;
  const apply: TranslateOrLoadOptions["apply"] = (translations) =>
    applyTranslations(ast, translations, SAMPLE_SOURCE, {
      ...(fm ? { frontmatterAdditions: fm } : {}),
    });
  return {
    segments,
    apply,
    locale: "pt-BR",
    key: "i18n/pt-BR/publications/sample.md#abc123.md",
    r2: overrides.r2 ?? null,
    translator,
    glossary: EMPTY_GLOSSARY,
    sourceLocale: "en-US",
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
    const first = await translateOrLoadFromCache(makeOptions({ r2: r2.client, translator }));

    expect(first.outcome).toBe("miss");
    // Translator was hit exactly once.
    expect(translator.calls).toBe(1);
    // R2 saw one GET (the lookup) and one PUT (the write-back).
    expect(r2.calls.get).toBe(1);
    expect(r2.calls.put).toBe(1);
    // The translated body landed in the in-memory store.
    expect(r2.store.size).toBe(1);
    expect(r2.store.has("i18n/pt-BR/publications/sample.md#abc123.md")).toBe(true);
    // The body came back as a string ready for staging writes.
    expect(typeof first.body).toBe("string");
    expect(first.body).toContain("TR:");

    // ─── Build #2 ─────────────────────────────────────────────────
    // Reset call counters, keep the store. This is the "second build"
    // simulation — same key, same source, R2 already has the bytes.
    r2.calls.get = 0;
    r2.calls.put = 0;
    translator.calls = 0;

    const second = await translateOrLoadFromCache(makeOptions({ r2: r2.client, translator }));

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
    const result = await translateOrLoadFromCache(makeOptions({ r2: null, translator }));
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

    const result = await translateOrLoadFromCache(makeOptions({ r2: r2.client, translator: explodingTranslator }));

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
    await expect(translateOrLoadFromCache(makeOptions({ r2: r2.client, translator: angry }))).rejects.toThrow(/provider boom/);
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
    await expect(translateOrLoadFromCache(makeOptions({ r2: flakyR2, translator }))).rejects.toThrow(/R2 unreachable/);
    expect(translator.calls).toBe(0);
  });
});

describe("translateOrLoadFromCache — write events", () => {
  it("fires onWriteStart then onWriteDone exactly once on a miss with r2", async () => {
    const r2 = makeInMemoryR2();
    const calls: Array<["start" | "done", Record<string, unknown>]> = [];
    const result = await translateOrLoadFromCache(
      makeOptions({
        r2: r2.client,
        events: {
          onWriteStart: (e) => calls.push(["start", e]),
          onWriteDone: (e) => calls.push(["done", e]),
        },
      }),
    );

    expect(result.outcome).toBe("miss");
    // Exactly one start + one done, in that order.
    expect(calls.map(([name]) => name)).toEqual(["start", "done"]);

    const [, startEvent] = calls[0]!;
    const [, doneEvent] = calls[1]!;
    // Both events carry the same key, locale, and byte count so the
    // operator can correlate them in the build log.
    expect(startEvent).toMatchObject({
      key: "i18n/pt-BR/publications/sample.md#abc123.md",
      locale: "pt-BR",
    });
    expect(doneEvent).toMatchObject({
      key: startEvent["key"],
      locale: startEvent["locale"],
      bytes: startEvent["bytes"],
    });
    // bytes is the UTF-8 byte length of what got written.
    expect(doneEvent["bytes"]).toBe(Buffer.byteLength(result.body, "utf8"));
    // durationMs is a non-negative integer (Date.now() resolution can
    // legitimately yield 0 on a fast in-memory PUT).
    expect(typeof doneEvent["durationMs"]).toBe("number");
    expect(doneEvent["durationMs"]).toBeGreaterThanOrEqual(0);
  });

  it("does NOT fire write events on a cache hit", async () => {
    const r2 = makeInMemoryR2();
    const key = "i18n/pt-BR/publications/sample.md#abc123.md";
    // Pre-populate to force a hit.
    await r2.client.put(key, "# cached\n", {
      metadata: { "source-path": "publications/sample.md" },
    });

    const onWriteStart = vi.fn();
    const onWriteDone = vi.fn();
    const result = await translateOrLoadFromCache(
      makeOptions({
        r2: r2.client,
        events: { onWriteStart, onWriteDone },
      }),
    );

    expect(result.outcome).toBe("hit");
    expect(onWriteStart).not.toHaveBeenCalled();
    expect(onWriteDone).not.toHaveBeenCalled();
  });

  it("fires onWriteFailed (not onWriteDone) and returns the translated body when r2.put rejects", async () => {
    const translator = makeStubTranslator();
    // R2 client whose GET reports a clean miss but whose PUT throws.
    // This is the "translator already paid for, then R2 went flaky"
    // scenario \u2014 the most expensive failure mode to mishandle.
    const flakyPutR2: R2Client = {
      async get() {
        return null;
      },
      async put() {
        throw new Error("R2 unreachable on PUT");
      },
      async exists() {
        return false;
      },
      async list() {
        return [];
      },
      async del() {},
    };
    const onWriteStart = vi.fn();
    const onWriteDone = vi.fn();
    const onWriteFailed = vi.fn();

    const result = await translateOrLoadFromCache(
      makeOptions({
        r2: flakyPutR2,
        translator,
        events: { onWriteStart, onWriteDone, onWriteFailed },
      }),
    );

    // The orchestrator MUST NOT rethrow: the build still gets the
    // translated bytes for staging, even though caching failed.
    expect(result.outcome).toBe("miss");
    expect(result.body).toContain("TR:");
    // Translator was called (we needed to translate; the PUT failure
    // happened after, so the translator cost is not avoidable).
    expect(translator.calls).toBe(1);
    // Event ordering: start fired (PUT was attempted), failed fired
    // (with the original error), done did NOT fire.
    expect(onWriteStart).toHaveBeenCalledTimes(1);
    expect(onWriteDone).not.toHaveBeenCalled();
    expect(onWriteFailed).toHaveBeenCalledTimes(1);
    const failedEvent = onWriteFailed.mock.calls[0]![0] as {
      key: string;
      locale: string;
      bytes: number;
      error: Error;
    };
    expect(failedEvent.key).toBe("i18n/pt-BR/publications/sample.md#abc123.md");
    expect(failedEvent.locale).toBe("pt-BR");
    expect(failedEvent.bytes).toBe(Buffer.byteLength(result.body, "utf8"));
    expect(failedEvent.error).toBeInstanceOf(Error);
    expect(failedEvent.error.message).toMatch(/R2 unreachable on PUT/);
  });

  it("does NOT fire write events when r2 is null", async () => {
    const onWriteStart = vi.fn();
    const onWriteDone = vi.fn();
    const result = await translateOrLoadFromCache(
      makeOptions({
        r2: null,
        events: { onWriteStart, onWriteDone },
      }),
    );

    expect(result.outcome).toBe("miss");
    // No r2 means no PUT, which means no write events — the build hook
    // should never see a "writing to R2" log line in this configuration.
    expect(onWriteStart).not.toHaveBeenCalled();
    expect(onWriteDone).not.toHaveBeenCalled();
  });
});

describe("translateOrLoadFromCache — glossary-edit invalidation", () => {
  it("editing one locale's glossary flips that locale to miss while the other stays a hit", async () => {
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator();
    const sourcePath = "publications/sample.md";

    // Initial glossaries for two locales. Already in normalised form
    // (doNotTranslate sorted) — that's what `loadGlossaries` produces
    // in production, so passing pre-sorted arrays mirrors the real
    // call site rather than testing the loader's normalisation
    // (which `glossary.test.ts` already pins).
    const initialPtBR: Glossary = {
      version: "v1",
      doNotTranslate: ["Cloudflare", "TLS"],
      preferredTranslations: { edge: "borda" },
      styleRules: [],
      notes: "",
    };
    const initialJaJP: Glossary = {
      version: "v1",
      doNotTranslate: ["Cloudflare", "TLS"],
      preferredTranslations: {},
      styleRules: [],
      notes: "",
    };

    // Replicate the build-hook's key computation: sourceHash folds in
    // body + frontmatter + per-locale glossaryHash + modelId. Editing
    // one locale's glossary changes only that locale's hash — hence
    // only that locale's R2 key — hence only that locale invalidates.
    function keyFor(locale: string, glossary: Glossary): string {
      const hash = computeSourceHash({
        body: SAMPLE_SOURCE,
        frontmatter: {},
        glossaryHash: hashGlossary(glossary),
        modelId: translator.modelId,
      });
      return buildR2Key({ locale, sourcePath, hash });
    }

    // ─── Build #1: cold cache, both locales miss + write back ────
    const ptBR1Key = keyFor("pt-BR", initialPtBR);
    const jaJP1Key = keyFor("ja-JP", initialJaJP);

    const ptBR1 = await translateOrLoadFromCache(
      makeOptions({
        r2: r2.client,
        translator,
        locale: "pt-BR",
        key: ptBR1Key,
        glossary: initialPtBR,
      }),
    );
    const jaJP1 = await translateOrLoadFromCache(
      makeOptions({
        r2: r2.client,
        translator,
        locale: "ja-JP",
        key: jaJP1Key,
        glossary: initialJaJP,
      }),
    );

    expect(ptBR1.outcome).toBe("miss");
    expect(jaJP1.outcome).toBe("miss");
    expect(translator.calls).toBe(2);
    expect(r2.store.size).toBe(2);

    // ─── Operator edits pt-BR glossary, leaves ja-JP untouched ───
    const editedPtBR: Glossary = {
      ...initialPtBR,
      // Add a single doNotTranslate entry. The list stays sorted to
      // mirror loadGlossaries' output.
      doNotTranslate: ["Cloudflare", "QUIC", "TLS"],
    };

    const ptBR2Key = keyFor("pt-BR", editedPtBR);
    const jaJP2Key = keyFor("ja-JP", initialJaJP);

    // The contract this test guards: pt-BR's key MUST change, ja-JP's
    // MUST NOT. If either invariant breaks, the wrong locale gets
    // invalidated on a glossary edit and the build either re-translates
    // too much (waste) or too little (stale output).
    expect(ptBR2Key).not.toBe(ptBR1Key);
    expect(jaJP2Key).toBe(jaJP1Key);

    // Reset call counters so build #2 assertions are unambiguous.
    translator.calls = 0;
    r2.calls.get = 0;
    r2.calls.put = 0;

    // ─── Build #2: pt-BR misses (new key), ja-JP hits (key stable) ─
    const ptBR2 = await translateOrLoadFromCache(
      makeOptions({
        r2: r2.client,
        translator,
        locale: "pt-BR",
        key: ptBR2Key,
        glossary: editedPtBR,
      }),
    );
    const jaJP2 = await translateOrLoadFromCache(
      makeOptions({
        r2: r2.client,
        translator,
        locale: "ja-JP",
        key: jaJP2Key,
        glossary: initialJaJP,
      }),
    );

    // Acceptance: surgical invalidation. pt-BR re-translated and
    // re-cached; ja-JP served straight from R2 with no provider call.
    expect(ptBR2.outcome).toBe("miss");
    expect(jaJP2.outcome).toBe("hit");
    expect(translator.calls).toBe(1);
    expect(r2.calls.put).toBe(1);
    expect(r2.calls.get).toBe(2);

    // R2 now holds three objects: the original ja-JP (still valid and
    // just hit), the original pt-BR (orphaned by the glossary edit —
    // the count-based pruner will reap it on a later build), and the
    // freshly-written pt-BR keyed by the edited glossary's hash.
    expect(r2.store.size).toBe(3);
    expect(r2.store.has(ptBR1Key)).toBe(true);
    expect(r2.store.has(ptBR2Key)).toBe(true);
    expect(r2.store.has(jaJP1Key)).toBe(true);

    // ja-JP's served bytes must be byte-identical to what build #1
    // wrote — that's the whole point of cache stability across an
    // unrelated locale's glossary edit.
    expect(jaJP2.body).toBe(jaJP1.body);
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
    await translateOrLoadFromCache(makeOptions({ r2: r2.client, metadata: meta }));
    const stored = r2.store.get("i18n/pt-BR/publications/sample.md#abc123.md");
    expect(stored).toBeDefined();
    expect(stored!.metadata).toEqual(meta);
  });

  it("decodes UTF-8 multi-byte cache hits correctly", async () => {
    const r2 = makeInMemoryR2();
    const key = "i18n/ja-JP/publications/sample.md#abc123.md";
    const japaneseBody = "膝点と肘点の検出。\n";
    await r2.client.put(key, japaneseBody);
    const result = await translateOrLoadFromCache(makeOptions({ r2: r2.client, locale: "ja-JP", key }));
    expect(result.outcome).toBe("hit");
    expect(result.body).toBe(japaneseBody);
  });
});

describe("translateOrLoadFromCache — readOnly mode", () => {
  // readOnly is the knob preview-branch builds use to consume the
  // production cache without polluting it. It MUST NOT skip
  // translation (the build still needs translated bytes for staging),
  // but it MUST skip the post-translation PUT so production's cache
  // is never written from a non-main branch.

  it("skips the PUT after a miss-translate but still returns translated bytes", async () => {
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator();
    const result = await translateOrLoadFromCache(makeOptions({ r2: r2.client, translator, readOnly: true }));

    // The translator was billed (cache miss → unavoidable) and the
    // build gets bytes for staging.
    expect(result.outcome).toBe("miss");
    expect(translator.calls).toBe(1);
    expect(result.body).toContain("TR:");

    // Crucially: NO PUT, NO write events, store is untouched.
    expect(r2.calls.put).toBe(0);
    expect(r2.store.size).toBe(0);
  });

  it("does not fire write events in readOnly mode", async () => {
    const r2 = makeInMemoryR2();
    const onWriteStart = vi.fn();
    const onWriteDone = vi.fn();
    const onWriteFailed = vi.fn();
    await translateOrLoadFromCache(
      makeOptions({
        r2: r2.client,
        readOnly: true,
        events: { onWriteStart, onWriteDone, onWriteFailed },
      }),
    );
    expect(onWriteStart).not.toHaveBeenCalled();
    expect(onWriteDone).not.toHaveBeenCalled();
    expect(onWriteFailed).not.toHaveBeenCalled();
  });

  it("still serves cache hits in readOnly mode (read path is unaffected)", async () => {
    const r2 = makeInMemoryR2();
    const key = "i18n/pt-BR/publications/sample.md#abc123.md";
    await r2.client.put(key, "# cached body\n", {
      metadata: { "source-path": "publications/sample.md" },
    });
    r2.calls.put = 0;

    const result = await translateOrLoadFromCache(makeOptions({ r2: r2.client, readOnly: true }));

    expect(result.outcome).toBe("hit");
    expect(result.body).toBe("# cached body\n");
    expect(r2.calls.put).toBe(0);
  });
});

describe("translateOrLoadFromCache — fallback keys (branch isolation)", () => {
  // Fallback keys let a preview build read main's translations on a
  // miss against its own private prefix. The contract: walk
  // `fallbackKeys` in order, first hit wins, NEVER write back, NEVER
  // promote across prefixes.

  it("returns a fallback hit when the primary key misses", async () => {
    const r2 = makeInMemoryR2();
    const primaryKey = "previews/feat-x/i18n/pt-BR/publications/sample.md#abc123.md";
    const fallbackKey = "i18n/pt-BR/publications/sample.md#abc123.md";

    // Pre-populate ONLY the fallback (main) prefix with a previously-
    // translated body — simulates a PR build that hasn't yet seen
    // this content.
    await r2.client.put(fallbackKey, "# main's translation\n", {
      metadata: { "source-path": "publications/sample.md", origin: "main" },
    });
    r2.calls.get = 0;
    r2.calls.put = 0;

    const translator = makeStubTranslator();
    const result = await translateOrLoadFromCache(
      makeOptions({
        r2: r2.client,
        translator,
        key: primaryKey,
        fallbackKeys: [fallbackKey],
      }),
    );

    // Hit, no translation, fallback key reported as the source.
    expect(result.outcome).toBe("hit");
    expect(result.body).toBe("# main's translation\n");
    expect(result.hitKey).toBe(fallbackKey);
    expect(translator.calls).toBe(0);

    // Two GETs: one against primary (miss), one against fallback (hit).
    expect(r2.calls.get).toBe(2);
    // No PUT — fallback hits MUST NOT be promoted to the primary
    // prefix. Cross-prefix copies would silently mirror main's
    // bytes under previews/, blurring the isolation boundary.
    expect(r2.calls.put).toBe(0);
  });

  it("walks fallbacks in order; first hit wins", async () => {
    const r2 = makeInMemoryR2();
    const primaryKey = "tier-c/pt-BR/foo.md#h.md";
    const tierAKey = "tier-a/pt-BR/foo.md#h.md";
    const tierBKey = "tier-b/pt-BR/foo.md#h.md";

    // Populate both A and B; the walker must return A and never
    // call get(B).
    await r2.client.put(tierAKey, "# from A\n");
    await r2.client.put(tierBKey, "# from B\n");
    r2.calls.get = 0;

    // Spy via wrapping the client to record exact key order.
    const seenGets: string[] = [];
    const wrappedClient = {
      ...r2.client,
      async get(k: string) {
        seenGets.push(k);
        return r2.client.get(k);
      },
    };

    const result = await translateOrLoadFromCache(
      makeOptions({
        r2: wrappedClient,
        key: primaryKey,
        fallbackKeys: [tierAKey, tierBKey],
      }),
    );

    expect(result.outcome).toBe("hit");
    expect(result.body).toBe("# from A\n");
    expect(result.hitKey).toBe(tierAKey);
    // GETs in declared order; tier-b never queried because A hit.
    expect(seenGets).toEqual([primaryKey, tierAKey]);
  });

  it("falls through to translate when both primary and all fallbacks miss", async () => {
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator();
    const result = await translateOrLoadFromCache(
      makeOptions({
        r2: r2.client,
        translator,
        key: "previews/feat-x/i18n/pt-BR/publications/sample.md#abc123.md",
        fallbackKeys: ["tier-a/pt-BR/publications/sample.md#abc123.md", "i18n/pt-BR/publications/sample.md#abc123.md"],
      }),
    );

    expect(result.outcome).toBe("miss");
    expect(translator.calls).toBe(1);
    // 1 primary + 2 fallback GETs, all misses, then a PUT against
    // the primary key (only).
    expect(r2.calls.get).toBe(3);
    expect(r2.calls.put).toBe(1);
    // PUT landed under the primary prefix, not any fallback.
    expect(r2.store.has("previews/feat-x/i18n/pt-BR/publications/sample.md#abc123.md")).toBe(true);
    expect(r2.store.has("i18n/pt-BR/publications/sample.md#abc123.md")).toBe(false);
  });

  it("ignores a fallback key that is byte-identical to the primary (avoids redundant GET)", async () => {
    // Defensive: a misconfigured fallback that duplicates the primary
    // would otherwise issue a second GET against the same key. The
    // skip is silent because this can legitimately happen mid-config-
    // refactor and shouldn't flag.
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator();
    const key = "i18n/pt-BR/publications/sample.md#abc123.md";

    const result = await translateOrLoadFromCache(
      makeOptions({
        r2: r2.client,
        translator,
        key,
        fallbackKeys: [key],
      }),
    );
    expect(result.outcome).toBe("miss");
    // Only ONE GET — the duplicate fallback was skipped, not
    // re-issued.
    expect(r2.calls.get).toBe(1);
  });

  it("readOnly + fallbackKeys: hits propagate, misses translate without writing", async () => {
    // The full preview-build configuration: read main on fallback,
    // never write to either prefix. Smoke-tests that the two flags
    // compose correctly.
    const r2 = makeInMemoryR2();
    const translator = makeStubTranslator();

    // First call: empty cache, full miss → translates, no PUT.
    const first = await translateOrLoadFromCache(
      makeOptions({
        r2: r2.client,
        translator,
        readOnly: true,
        key: "previews/feat-x/i18n/pt-BR/publications/sample.md#abc123.md",
        fallbackKeys: ["i18n/pt-BR/publications/sample.md#abc123.md"],
      }),
    );
    expect(first.outcome).toBe("miss");
    expect(translator.calls).toBe(1);
    expect(r2.store.size).toBe(0);

    // Pre-populate main's prefix; second call should fallback-hit
    // without invoking the translator.
    await r2.client.put("i18n/pt-BR/publications/sample.md#abc123.md", "# main's translation\n");
    translator.calls = 0;
    r2.calls.put = 0;

    const second = await translateOrLoadFromCache(
      makeOptions({
        r2: r2.client,
        translator,
        readOnly: true,
        key: "previews/feat-x/i18n/pt-BR/publications/sample.md#abc123.md",
        fallbackKeys: ["i18n/pt-BR/publications/sample.md#abc123.md"],
      }),
    );
    expect(second.outcome).toBe("hit");
    expect(second.body).toBe("# main's translation\n");
    expect(second.hitKey).toBe("i18n/pt-BR/publications/sample.md#abc123.md");
    expect(translator.calls).toBe(0);
    expect(r2.calls.put).toBe(0);
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
      ["glossary-hash", "locale", "model-id", "polystella-version", "source-hash", "source-path", "translated-at"].sort(),
    );
  });
});
