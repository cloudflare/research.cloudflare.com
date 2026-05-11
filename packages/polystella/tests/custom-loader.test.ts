import { describe, expect, it, vi } from "vitest";
import type { Loader, LoaderContext } from "astro/loaders";

import {
  POLYSTELLA_CUSTOM_LOADER_KEY,
  polystellaLoader,
  readPolystellaCustomLoaderMarker,
  type CapturedEntry,
} from "../src/content/custom-loader.js";

/**
 * Tests for the polystella custom-loader wrapper.
 *
 * The wrapper does three things:
 *
 *   1. Stamps a non-enumerable marker on the returned loader so
 *      `polystellaCollections` can auto-derive locale siblings.
 *   2. Exposes `captureEntries()`, which runs the raw loader against
 *      a synthetic store and returns the entries it `store.set()`s.
 *   3. Replays captured entries when Astro later calls `load()`,
 *      avoiding a second invocation of the raw loader's fetch logic
 *      AND guaranteeing entry-ID parity between source and sibling
 *      collections.
 *
 * Each test exercises one of these guarantees with the absolute
 * minimum loader fixture.
 */

/**
 * Build a fake raw loader that calls `store.set()` for each of the
 * supplied entries. Captures every `LoaderContext` it sees so tests
 * can assert what was threaded through.
 */
function makeRawLoader(entries: CapturedEntry[]): Loader & { contexts: LoaderContext[] } {
  const contexts: LoaderContext[] = [];
  return {
    name: "fake-loader",
    contexts,
    load: async (ctx) => {
      contexts.push(ctx);
      for (const entry of entries) {
        ctx.store.set({ id: entry.id, data: entry.data });
      }
    },
  } as Loader & { contexts: LoaderContext[] };
}

/**
 * Build a minimal real-store stub for replay-path tests. Records
 * every `set` and `clear` so tests can verify the wrapped loader's
 * replay behaviour.
 */
function makeRealStoreSpy(): {
  store: LoaderContext["store"];
  sets: Array<{ id: string; data: Record<string, unknown> }>;
  clears: number;
} {
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
  return { store, sets, get clears() { return clears; } };
}

function makeRealContext(store: LoaderContext["store"]): LoaderContext {
  // Minimal real-context stub; sufficient for the replay path which
  // only touches `store`, `parseData`. Cast through `unknown`
  // because Astro's full LoaderContext has additional fields
  // (renderMarkdown, watcher, etc.) that aren't relevant to replay.
  return {
    collection: "test",
    store,
    parseData: async ({ data }: { id: string; data: Record<string, unknown> }) => data,
  } as unknown as LoaderContext;
}

describe("polystellaLoader — wrapping", () => {
  it("returns a loader with the same name as the raw loader", () => {
    const raw = makeRawLoader([]);
    const wrapped = polystellaLoader(raw, { name: "blog", translatableKeys: ["title"] });
    expect(wrapped.name).toBe(raw.name);
  });

  it("stamps the marker as a non-enumerable property", () => {
    const raw = makeRawLoader([]);
    const wrapped = polystellaLoader(raw, { name: "blog", translatableKeys: ["title"] });

    // JSON.stringify and Object.keys must NOT surface the marker —
    // anything that serialises loaders should see the same shape
    // as an unwrapped one.
    expect(Object.keys(wrapped)).not.toContain(POLYSTELLA_CUSTOM_LOADER_KEY);
    expect(JSON.stringify(wrapped)).not.toContain(POLYSTELLA_CUSTOM_LOADER_KEY);

    // Direct access still works.
    expect((wrapped as unknown as Record<string, unknown>)[POLYSTELLA_CUSTOM_LOADER_KEY]).toBeDefined();
  });

  it("preserves a schema field from the raw loader", () => {
    // Astro's `Loader` type is a discriminated union — `schema` lives
    // on one branch only. We assert via `unknown` cast so the test
    // doesn't have to construct a real Zod schema (this test cares
    // only about pass-through behaviour, not validation).
    const fakeSchema = { __zod: true } as unknown;
    const raw = { ...makeRawLoader([]), schema: fakeSchema } as unknown as Loader;
    const wrapped = polystellaLoader(raw, { name: "blog", translatableKeys: ["title"] });
    expect((wrapped as { schema?: unknown }).schema).toBe(fakeSchema);
  });

  it("rejects invalid first argument", () => {
    expect(() =>
      polystellaLoader(null as unknown as Loader, { name: "blog", translatableKeys: [] }),
    ).toThrow(/first argument must be an Astro Loader/);
  });

  it("rejects empty name", () => {
    const raw = makeRawLoader([]);
    expect(() => polystellaLoader(raw, { name: "", translatableKeys: [] })).toThrow(
      /options\.name must be a non-empty string/,
    );
  });

  it("rejects non-array translatableKeys", () => {
    const raw = makeRawLoader([]);
    expect(() =>
      polystellaLoader(raw, { name: "blog", translatableKeys: "title" as unknown as string[] }),
    ).toThrow(/options\.translatableKeys must be an array/);
  });
});

describe("readPolystellaCustomLoaderMarker", () => {
  it("returns the marker for a wrapped loader", () => {
    const raw = makeRawLoader([]);
    const wrapped = polystellaLoader(raw, { name: "blog", translatableKeys: ["title", "excerpt"] });
    const marker = readPolystellaCustomLoaderMarker(wrapped);
    expect(marker).toBeDefined();
    expect(marker?.name).toBe("blog");
    expect(marker?.translatableKeys).toEqual(["title", "excerpt"]);
    expect(typeof marker?.captureEntries).toBe("function");
  });

  it("returns undefined for unwrapped loaders", () => {
    const raw = makeRawLoader([]);
    expect(readPolystellaCustomLoaderMarker(raw)).toBeUndefined();
  });

  it("returns undefined for null / non-objects", () => {
    expect(readPolystellaCustomLoaderMarker(null)).toBeUndefined();
    expect(readPolystellaCustomLoaderMarker(undefined)).toBeUndefined();
    expect(readPolystellaCustomLoaderMarker("not a loader")).toBeUndefined();
    expect(readPolystellaCustomLoaderMarker(42)).toBeUndefined();
  });

  it("returns undefined when the marker shape is malformed", () => {
    // Defensive: a loader that happens to have the same key but wrong
    // shape shouldn't satisfy the marker check (could happen if
    // someone mutates a wrapped loader manually).
    const fake = { [POLYSTELLA_CUSTOM_LOADER_KEY]: { name: "blog" } };
    expect(readPolystellaCustomLoaderMarker(fake)).toBeUndefined();
  });

  it("isolates translatableKeys (consumer cannot mutate the wrapper's copy)", () => {
    const keys = ["title", "excerpt"];
    const raw = makeRawLoader([]);
    const wrapped = polystellaLoader(raw, { name: "blog", translatableKeys: keys });
    const marker = readPolystellaCustomLoaderMarker(wrapped);

    keys.push("HACK");
    expect(marker?.translatableKeys).toEqual(["title", "excerpt"]);
  });
});

describe("polystellaLoader — captureEntries()", () => {
  it("runs the raw loader against a synthetic store and returns captured entries", async () => {
    const raw = makeRawLoader([
      { id: "post-a", data: { title: "A", excerpt: "alpha" } },
      { id: "post-b", data: { title: "B", excerpt: "beta" } },
    ]);
    const wrapped = polystellaLoader(raw, { name: "blog", translatableKeys: ["title"] });
    const marker = readPolystellaCustomLoaderMarker(wrapped);
    if (!marker) throw new Error("marker missing");

    const captured = await marker.captureEntries();
    expect(captured).toEqual([
      { id: "post-a", data: { title: "A", excerpt: "alpha" } },
      { id: "post-b", data: { title: "B", excerpt: "beta" } },
    ]);
  });

  it("preserves insertion order", async () => {
    const raw = makeRawLoader([
      { id: "c", data: {} },
      { id: "a", data: {} },
      { id: "b", data: {} },
    ]);
    const marker = readPolystellaCustomLoaderMarker(
      polystellaLoader(raw, { name: "blog", translatableKeys: [] }),
    );

    const captured = await marker!.captureEntries();
    expect(captured.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  it("dedupes by id when the loader sets the same id twice (last write wins)", async () => {
    const raw: Loader = {
      name: "double-write",
      load: async (ctx) => {
        ctx.store.set({ id: "x", data: { title: "first" } });
        ctx.store.set({ id: "x", data: { title: "second" } });
      },
    };
    const marker = readPolystellaCustomLoaderMarker(
      polystellaLoader(raw, { name: "blog", translatableKeys: [] }),
    );

    const captured = await marker!.captureEntries();
    expect(captured).toEqual([{ id: "x", data: { title: "second" } }]);
  });

  it("supports store.clear() (drops everything captured before the call)", async () => {
    const raw: Loader = {
      name: "clear-then-set",
      load: async (ctx) => {
        ctx.store.set({ id: "stale", data: {} });
        ctx.store.clear();
        ctx.store.set({ id: "fresh", data: {} });
      },
    };
    const marker = readPolystellaCustomLoaderMarker(
      polystellaLoader(raw, { name: "blog", translatableKeys: [] }),
    );

    const captured = await marker!.captureEntries();
    expect(captured.map((e) => e.id)).toEqual(["fresh"]);
  });

  it("supports store.delete()", async () => {
    const raw: Loader = {
      name: "delete-some",
      load: async (ctx) => {
        ctx.store.set({ id: "a", data: {} });
        ctx.store.set({ id: "b", data: {} });
        ctx.store.delete("a");
      },
    };
    const marker = readPolystellaCustomLoaderMarker(
      polystellaLoader(raw, { name: "blog", translatableKeys: [] }),
    );

    const captured = await marker!.captureEntries();
    expect(captured.map((e) => e.id)).toEqual(["b"]);
  });

  it("throws a clear error if the loader reads from store mid-load", async () => {
    const raw: Loader = {
      name: "reads-mid-load",
      load: async (ctx) => {
        ctx.store.get("x"); // unsupported during capture
      },
    };
    const marker = readPolystellaCustomLoaderMarker(
      polystellaLoader(raw, { name: "blog", translatableKeys: [] }),
    );

    await expect(marker!.captureEntries()).rejects.toThrow(/mid-load/);
  });

  it("threads the configured name through to ctx.collection during capture", async () => {
    const raw = makeRawLoader([{ id: "x", data: {} }]) as Loader & { contexts: LoaderContext[] };
    const marker = readPolystellaCustomLoaderMarker(
      polystellaLoader(raw, { name: "blog-posts", translatableKeys: [] }),
    );

    await marker!.captureEntries();
    expect(raw.contexts).toHaveLength(1);
    expect(raw.contexts[0]?.collection).toBe("blog-posts");
  });

  it("provides a deterministic generateDigest (same input -> same output)", async () => {
    const captureIds: string[] = [];
    const raw: Loader = {
      name: "uses-digest",
      load: async (ctx) => {
        const id = ctx.generateDigest("https://example.com/post-1");
        captureIds.push(id);
        ctx.store.set({ id, data: {} });
      },
    };
    const marker = readPolystellaCustomLoaderMarker(
      polystellaLoader(raw, { name: "blog", translatableKeys: [] }),
    );

    const first = await marker!.captureEntries();
    const second = await marker!.captureEntries();

    expect(first[0]?.id).toBe(second[0]?.id);
    // Sanity: digest is 16 hex chars (64 bits truncation).
    expect(first[0]?.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("parseData is a pass-through (no schema validation at capture time)", async () => {
    // The blogLoader calls `parseData` before `store.set`. At
    // capture time we can't validate against the schema (we don't
    // have it), so parseData must return the input verbatim.
    const raw: Loader = {
      name: "uses-parsedata",
      load: async (ctx) => {
        const parsed = await ctx.parseData({ id: "x", data: { foo: "bar" } });
        ctx.store.set({ id: "x", data: parsed });
      },
    };
    const marker = readPolystellaCustomLoaderMarker(
      polystellaLoader(raw, { name: "blog", translatableKeys: [] }),
    );

    const captured = await marker!.captureEntries();
    expect(captured[0]?.data).toEqual({ foo: "bar" });
  });

  it("propagates errors from the raw loader", async () => {
    const raw: Loader = {
      name: "throws",
      load: async () => {
        throw new Error("fetch failed");
      },
    };
    const marker = readPolystellaCustomLoaderMarker(
      polystellaLoader(raw, { name: "blog", translatableKeys: [] }),
    );

    await expect(marker!.captureEntries()).rejects.toThrow(/fetch failed/);
  });

  it("caches results across multiple captureEntries calls (raw runs once)", async () => {
    // Each Astro build calls `captureEntries()` once per locale's
    // sibling loader, plus once for the source loader's own `load()`.
    // We cache the captured entries so the raw loader's fetch logic
    // only runs once per build regardless of how many siblings exist.
    // Critical for two reasons:
    //   1. Avoids N+1 fetches for N locales.
    //   2. Guarantees ID parity — every consumer (source + siblings)
    //      reads the same entries, computed once.
    let runCount = 0;
    const raw: Loader = {
      name: "counts-runs",
      load: async (ctx) => {
        runCount++;
        ctx.store.set({ id: `run-${runCount}`, data: {} });
      },
    };
    const marker = readPolystellaCustomLoaderMarker(
      polystellaLoader(raw, { name: "blog", translatableKeys: [] }),
    );

    const first = await marker!.captureEntries();
    const second = await marker!.captureEntries();

    expect(first).toBe(second); // same reference — cached
    expect(first[0]?.id).toBe("run-1");
    expect(runCount).toBe(1);
  });
});

describe("polystellaLoader — load() shared-cache path", () => {
  it("uses cached captureEntries result when load is called after capture", async () => {
    // First scenario: sibling loader captures first (during sync),
    // then Astro calls the source loader's `load`. Source must see
    // the same entries the sibling already captured.
    let rawCallCount = 0;
    const raw: Loader = {
      name: "tracks-calls",
      load: async (ctx) => {
        rawCallCount++;
        ctx.store.set({ id: "from-raw", data: { title: "A" } });
      },
    };
    const wrapped = polystellaLoader(raw, { name: "blog", translatableKeys: [] });
    const marker = readPolystellaCustomLoaderMarker(wrapped);

    // Capture once (raw runs).
    await marker!.captureEntries();
    expect(rawCallCount).toBe(1);

    // Now Astro calls load(); should reuse the cached capture.
    const spy = makeRealStoreSpy();
    const ctx = makeRealContext(spy.store);
    await wrapped.load(ctx);

    expect(rawCallCount).toBe(1); // raw didn't run again
    expect(spy.clears).toBe(1); // load clears the real store first
    expect(spy.sets).toEqual([{ id: "from-raw", data: { title: "A" } }]);
  });

  it("triggers capture when load is called first (raw still runs once)", async () => {
    // Reverse scenario: Astro's source `load` runs first, captures
    // into the shared cache. Any subsequent sibling-loader
    // `captureEntries` call reuses the same cache.
    let rawCallCount = 0;
    const raw: Loader = {
      name: "tracks-calls",
      load: async (ctx) => {
        rawCallCount++;
        ctx.store.set({ id: "x", data: { title: "first" } });
      },
    };
    const wrapped = polystellaLoader(raw, { name: "blog", translatableKeys: [] });
    const marker = readPolystellaCustomLoaderMarker(wrapped);

    const spy = makeRealStoreSpy();
    const ctx = makeRealContext(spy.store);
    await wrapped.load(ctx);

    expect(rawCallCount).toBe(1);
    expect(spy.sets).toEqual([{ id: "x", data: { title: "first" } }]);

    // Now the sibling loader calls captureEntries — should hit the
    // cache (no second raw run).
    const captured = await marker!.captureEntries();
    expect(rawCallCount).toBe(1);
    expect(captured).toEqual([{ id: "x", data: { title: "first" } }]);
  });

  it("threads parseData through load so Astro's schema validation runs", async () => {
    const raw = makeRawLoader([{ id: "x", data: { title: "raw" } }]);
    const wrapped = polystellaLoader(raw, { name: "blog", translatableKeys: [] });

    // Real parseData mutates data (simulates schema coercion).
    const spy = makeRealStoreSpy();
    const ctx = {
      ...makeRealContext(spy.store),
      parseData: async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        validated: true,
      }),
    } as unknown as LoaderContext;

    await wrapped.load(ctx);
    expect(spy.sets[0]?.data).toEqual({ title: "raw", validated: true });
  });
});
