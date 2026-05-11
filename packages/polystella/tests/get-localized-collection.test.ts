import { describe, expect, it, vi } from "vitest";

import { resolveLocalizedCollection, type ResolveLocalizedCollectionDeps } from "../src/runtime/get-localized-collection.js";
import type { SourceEntryShape } from "../src/runtime/get-localized-entry.js";

/**
 * Tests for the pure runtime helper that powers
 * `getLocalizedCollection`.
 *
 * The helper is dispatch-only: it picks between the source collection
 * and the per-locale sibling collection, merges them per the
 * `fallback` / `noTranslateBehavior` policies, and applies the user's
 * filter post-merge. No file IO, no overlay merge, no frontmatter
 * rules. Every branch (default-locale, all-hit, all-miss, partial,
 * `noTranslate`, `skip`, filter timing) gets a dedicated test.
 *
 * Deps are injected so the suite never touches the real filesystem
 * and never imports `astro:content`.
 */

const DEFAULT_LOCALE = "en-US";

/**
 * Build a stub for `deps.getCollection`. Configured per-test via the
 * `collections` map (keyed by collection name). Returns `[]` for
 * collection names not in the map, matching Astro's behaviour for
 * an empty / unregistered sibling collection.
 */
function makeGetCollection(collections: Record<string, SourceEntryShape[]>): ReturnType<typeof vi.fn> {
  return vi.fn(async (collection: string) => {
    return collections[collection] ?? [];
  });
}

function makeDeps(overrides: Partial<ResolveLocalizedCollectionDeps> = {}): ResolveLocalizedCollectionDeps {
  return {
    defaultLocale: DEFAULT_LOCALE,
    getCollection: vi.fn(async () => []),
    ...overrides,
  };
}

/** Convenience builder for a source-shape entry. */
function entry(collection: string, id: string, data: Record<string, unknown> = {}): SourceEntryShape {
  return { collection, id, data: { title: id, ...data } };
}

describe("resolveLocalizedCollection — default-locale path", () => {
  it("returns the source list tagged with isLocalized=false when locale is undefined", async () => {
    const deps = makeDeps({
      getCollection: makeGetCollection({
        publications: [entry("publications", "a"), entry("publications", "b")],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: undefined,
      deps,
    });

    expect(result).toEqual([
      {
        collection: "publications",
        id: "a",
        data: { title: "a" },
        isLocalized: false,
        locale: DEFAULT_LOCALE,
      },
      {
        collection: "publications",
        id: "b",
        data: { title: "b" },
        isLocalized: false,
        locale: DEFAULT_LOCALE,
      },
    ]);
  });

  it("returns the source list when locale is the empty string", async () => {
    const deps = makeDeps({
      getCollection: makeGetCollection({
        publications: [entry("publications", "a")],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: "",
      deps,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.isLocalized).toBe(false);
    expect(result[0]?.locale).toBe(DEFAULT_LOCALE);
  });

  it("returns the source list when locale equals defaultLocale", async () => {
    const deps = makeDeps({
      getCollection: makeGetCollection({
        publications: [entry("publications", "a")],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: DEFAULT_LOCALE,
      deps,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.isLocalized).toBe(false);
  });

  it("does not probe the sibling collection on the default-locale path (single getCollection call)", async () => {
    // Avoiding the second `getCollection` call on the hot
    // default-locale path matters: the dispatcher runs on every
    // page render.
    const getCollection = makeGetCollection({
      publications: [entry("publications", "a")],
    });
    const deps = makeDeps({ getCollection });

    await resolveLocalizedCollection({
      collection: "publications",
      locale: undefined,
      deps,
    });

    expect(getCollection).toHaveBeenCalledTimes(1);
    expect(getCollection).toHaveBeenCalledWith("publications");
  });

  it("returns an empty list when the source collection is empty", async () => {
    const deps = makeDeps({
      getCollection: makeGetCollection({}),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: undefined,
      deps,
    });

    expect(result).toEqual([]);
  });

  it("applies the filter to the tagged list", async () => {
    const deps = makeDeps({
      getCollection: makeGetCollection({
        people: [
          entry("people", "alice", { type: "active" }),
          entry("people", "bob", { type: "alumni" }),
          entry("people", "carol", { type: "active" }),
        ],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "people",
      locale: undefined,
      filter: (e) => e.data.type === "active",
      deps,
    });

    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["alice", "carol"]);
    expect(result.every((e) => e.isLocalized === false)).toBe(true);
  });
});

describe("resolveLocalizedCollection — cross-locale, all hit", () => {
  it("returns the sibling list tagged with isLocalized=true and the requested locale", async () => {
    const deps = makeDeps({
      getCollection: makeGetCollection({
        publications: [entry("publications", "a", { title: "A (en)" }), entry("publications", "b", { title: "B (en)" })],
        "publications__pt-BR": [
          entry("publications__pt-BR", "a", { title: "A (pt-BR)" }),
          entry("publications__pt-BR", "b", { title: "B (pt-BR)" }),
        ],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      deps,
    });

    expect(result).toHaveLength(2);
    expect(result.every((e) => e.isLocalized === true)).toBe(true);
    expect(result.every((e) => e.locale === "pt-BR")).toBe(true);
    // Sibling data won — check titles are the translated ones.
    expect(result.map((e) => e.data.title)).toEqual(["A (pt-BR)", "B (pt-BR)"]);
  });

  it("uses the __ separator for the sibling-collection name", async () => {
    const getCollection = makeGetCollection({
      publications: [entry("publications", "a")],
    });
    const deps = makeDeps({ getCollection });

    await resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      deps,
    });

    // Both calls happen in parallel; the order isn't pinned, just
    // the names. Pin via `expect.arrayContaining` on
    // `getCollection.mock.calls`.
    const calledWith = getCollection.mock.calls.map((c) => c[0]);
    expect(calledWith).toContain("publications");
    expect(calledWith).toContain("publications__pt-BR");
  });

  it("preserves Astro-computed fields (filePath, digest, rendered) from sibling entries", async () => {
    // The dispatcher returns sibling entries verbatim plus the
    // extension fields — every Astro-computed field rides through
    // the `{...entry}` spread.
    const localizedFixture = {
      collection: "publications__pt-BR",
      id: "antunes2025",
      data: { title: "Antunes2025 (pt-BR)" },
      filePath: "/abs/.astro/i18n-staging/pt-BR/publications/antunes2025.md",
      digest: "sha256:abc",
      rendered: { html: "<p>x</p>", metadata: { headings: [] } },
    } as unknown as SourceEntryShape;
    const deps = makeDeps({
      getCollection: makeGetCollection({
        publications: [entry("publications", "antunes2025")],
        "publications__pt-BR": [localizedFixture],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      deps,
    });

    expect(result[0]).toMatchObject({
      filePath: (localizedFixture as unknown as { filePath: string }).filePath,
      digest: (localizedFixture as unknown as { digest: string }).digest,
      rendered: (localizedFixture as unknown as { rendered: unknown }).rendered,
    });
  });
});

describe("resolveLocalizedCollection — cross-locale, all miss", () => {
  it("falls back to source for every entry under default policy", async () => {
    const deps = makeDeps({
      // No fallback override → defaults to "default-locale".
      getCollection: makeGetCollection({
        publications: [entry("publications", "a", { title: "A (en)" }), entry("publications", "b", { title: "B (en)" })],
        // sibling collection is empty (or doesn't exist)
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      deps,
    });

    expect(result).toHaveLength(2);
    expect(result.every((e) => e.isLocalized === false)).toBe(true);
    // Fallback entries are tagged with defaultLocale, NOT the
    // requested locale.
    expect(result.every((e) => e.locale === DEFAULT_LOCALE)).toBe(true);
    expect(result.map((e) => e.data.title)).toEqual(["A (en)", "B (en)"]);
  });

  it("returns an empty list when both source and siblings are empty", async () => {
    const deps = makeDeps({
      getCollection: makeGetCollection({}),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      deps,
    });

    expect(result).toEqual([]);
  });
});

describe("resolveLocalizedCollection — cross-locale, partial", () => {
  it("returns a mix of localized and source-fallback entries with correct tagging", async () => {
    const deps = makeDeps({
      getCollection: makeGetCollection({
        publications: [
          entry("publications", "a", { title: "A (en)" }),
          entry("publications", "b", { title: "B (en)" }),
          entry("publications", "c", { title: "C (en)" }),
        ],
        "publications__pt-BR": [
          // Only `b` has a translated sibling.
          entry("publications__pt-BR", "b", { title: "B (pt-BR)" }),
        ],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      deps,
    });

    expect(result).toHaveLength(3);

    // Order matches the source list.
    expect(result.map((e) => e.id)).toEqual(["a", "b", "c"]);

    // a and c fall back; b hits the sibling.
    expect(result[0]?.isLocalized).toBe(false);
    expect(result[0]?.locale).toBe(DEFAULT_LOCALE);
    expect(result[0]?.data.title).toBe("A (en)");

    expect(result[1]?.isLocalized).toBe(true);
    expect(result[1]?.locale).toBe("pt-BR");
    expect(result[1]?.data.title).toBe("B (pt-BR)");

    expect(result[2]?.isLocalized).toBe(false);
    expect(result[2]?.locale).toBe(DEFAULT_LOCALE);
    expect(result[2]?.data.title).toBe("C (en)");
  });
});

describe("resolveLocalizedCollection — noTranslate flag", () => {
  // Source entries flagged with `noTranslate: true` skip the build-
  // time translation pipeline; the runtime helper sees a sibling
  // miss and applies `noTranslateBehavior` (which takes precedence
  // over `fallback` for those entries).

  it("noTranslateBehavior: fallback (default) keeps flagged entries as source", async () => {
    const deps = makeDeps({
      // No noTranslateBehavior override → defaults to "fallback".
      getCollection: makeGetCollection({
        publications: [
          entry("publications", "universal", {
            title: "Universal paper",
            noTranslate: true,
          }),
          entry("publications", "regular", { title: "Regular paper" }),
        ],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      deps,
    });

    expect(result).toHaveLength(2);
    // Both entries preserved as source-fallback (regular falls back
    // via "default-locale" policy; universal via its noTranslate flag).
    expect(result.every((e) => e.isLocalized === false)).toBe(true);
    expect(result.every((e) => e.locale === DEFAULT_LOCALE)).toBe(true);
  });

  it("noTranslateBehavior: 404 drops flagged entries", async () => {
    const deps = makeDeps({
      noTranslateBehavior: "404",
      getCollection: makeGetCollection({
        publications: [
          entry("publications", "universal", {
            title: "Universal paper",
            noTranslate: true,
          }),
          entry("publications", "regular", { title: "Regular paper" }),
        ],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      deps,
    });

    // `universal` is dropped; `regular` falls back to source via
    // the default fallback policy.
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("regular");
    expect(result[0]?.isLocalized).toBe(false);
  });

  it("noTranslateBehavior overrides fallback: 'fallback' beats 'skip' for flagged entries", async () => {
    // Operator wants "skip" for general untranslated misses but
    // explicitly wants flagged entries to render under all locales.
    // The per-entry policy wins.
    const deps = makeDeps({
      fallback: "skip",
      noTranslateBehavior: "fallback",
      getCollection: makeGetCollection({
        publications: [
          entry("publications", "universal", {
            title: "Universal paper",
            noTranslate: true,
          }),
          entry("publications", "regular", { title: "Regular paper" }),
        ],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      deps,
    });

    // `universal` kept (noTranslate + fallback); `regular` dropped (skip).
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("universal");
    expect(result[0]?.isLocalized).toBe(false);
  });

  it("noTranslate flag on a sibling-hit source has no effect (sibling won)", async () => {
    // The flag is on the SOURCE; if a sibling exists, the dispatcher
    // returns the sibling. (Build-time concern: noTranslate should
    // prevent siblings from being created, but a stale sibling in
    // the cache still wins on hit.)
    const deps = makeDeps({
      noTranslateBehavior: "404",
      getCollection: makeGetCollection({
        publications: [
          entry("publications", "stale", {
            title: "Source",
            noTranslate: true,
          }),
        ],
        "publications__pt-BR": [entry("publications__pt-BR", "stale", { title: "Stale translation" })],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      deps,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.isLocalized).toBe(true);
    expect(result[0]?.data.title).toBe("Stale translation");
  });
});

describe("resolveLocalizedCollection — fallback policy", () => {
  it("default-locale (default): keeps source on sibling miss", async () => {
    const deps = makeDeps({
      // No `fallback` key → defaults to "default-locale".
      getCollection: makeGetCollection({
        publications: [entry("publications", "a", { title: "A (en)" })],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      deps,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.isLocalized).toBe(false);
    expect(result[0]?.data.title).toBe("A (en)");
  });

  it("skip: drops untranslated entries", async () => {
    const deps = makeDeps({
      fallback: "skip",
      getCollection: makeGetCollection({
        publications: [entry("publications", "a", { title: "A (en)" }), entry("publications", "b", { title: "B (en)" })],
        "publications__pt-BR": [
          // Only `b` has a translation.
          entry("publications__pt-BR", "b", { title: "B (pt-BR)" }),
        ],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      deps,
    });

    // `a` is dropped (skip + no flag). `b` hits the sibling.
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("b");
    expect(result[0]?.isLocalized).toBe(true);
  });

  it("skip: still returns full source list on the default-locale path", async () => {
    // `fallback` only governs cross-locale misses. A default-locale
    // call should always return the full source list under any
    // policy.
    const deps = makeDeps({
      fallback: "skip",
      getCollection: makeGetCollection({
        publications: [entry("publications", "a"), entry("publications", "b")],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: undefined,
      deps,
    });

    expect(result).toHaveLength(2);
  });
});

describe("resolveLocalizedCollection — filter", () => {
  it("receives the merged shape (filter callback can read isLocalized / locale)", async () => {
    const deps = makeDeps({
      getCollection: makeGetCollection({
        publications: [
          entry("publications", "a", { title: "A (en)" }),
          entry("publications", "b", { title: "B (en)" }),
          entry("publications", "c", { title: "C (en)" }),
        ],
        "publications__pt-BR": [
          // Only `a` and `c` have translations.
          entry("publications__pt-BR", "a", { title: "A (pt-BR)" }),
          entry("publications__pt-BR", "c", { title: "C (pt-BR)" }),
        ],
      }),
    });

    // Filter only translated entries — only possible because the
    // filter sees the extended shape.
    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      filter: (e) => e.isLocalized === true,
      deps,
    });

    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("accepts filters that return boolean | undefined (matches Astro's getCollection)", async () => {
    // Real-world pattern: filtering by a field reached through an
    // optional chain (`pub.data.authors?.some(...)`) returns
    // `boolean | undefined`. Astro's `getCollection` accepts this
    // because its filter signature is `(entry) => unknown`. Pin
    // that we behave the same way — the resolver passes the
    // callback straight to `Array.prototype.filter`, which
    // truthiness-checks the return.
    const deps = makeDeps({
      getCollection: makeGetCollection({
        publications: [
          entry("publications", "with-authors", { authors: [{ id: "alice" }] }),
          entry("publications", "without-authors", {}),
          entry("publications", "wrong-author", { authors: [{ id: "bob" }] }),
        ],
      }),
    });

    const slug = "alice";
    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: undefined,
      // Optional-chain return → `boolean | undefined`. Should
      // type-check AND filter correctly at runtime.
      filter: (e) => (e.data.authors as Array<{ id: string }> | undefined)?.some((author) => author.id === slug),
      deps,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("with-authors");
  });

  it("applies filter on translated data when available", async () => {
    // When the filter reads translatable fields, it sees the
    // translated value on sibling-hit entries and the source value
    // on fallback entries. Demonstrates that filtering happens
    // post-merge.
    const deps = makeDeps({
      getCollection: makeGetCollection({
        publications: [entry("publications", "a", { tag: "research" }), entry("publications", "b", { tag: "research" })],
        "publications__pt-BR": [
          // Sibling has a different tag value (synthetic — wouldn't
          // happen in practice but tests the post-merge contract).
          entry("publications__pt-BR", "a", { tag: "translated" }),
        ],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      filter: (e) => e.data.tag === "translated",
      deps,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("a");
  });
});

describe("resolveLocalizedCollection — parallelism + fresh-object guarantee", () => {
  it("issues source + sibling getCollection calls in parallel", async () => {
    // Pin Promise.all behaviour: both calls are issued before
    // either resolves. Use two deferred promises and assert both
    // were called before resolving them.
    let resolveSource!: (entries: SourceEntryShape[]) => void;
    let resolveSibling!: (entries: SourceEntryShape[]) => void;
    const sourcePromise = new Promise<SourceEntryShape[]>((r) => {
      resolveSource = r;
    });
    const siblingPromise = new Promise<SourceEntryShape[]>((r) => {
      resolveSibling = r;
    });

    const getCollection = vi.fn(async (name: string) => {
      if (name === "publications") return sourcePromise;
      return siblingPromise;
    });

    const promise = resolveLocalizedCollection({
      collection: "publications",
      locale: "pt-BR",
      deps: makeDeps({ getCollection }),
    });

    // Yield once so the await microtask scheduling settles.
    await Promise.resolve();
    await Promise.resolve();

    // Both calls were issued before either resolved.
    expect(getCollection).toHaveBeenCalledTimes(2);

    resolveSource([entry("publications", "a")]);
    resolveSibling([]);

    const result = await promise;
    expect(result).toHaveLength(1);
  });

  it("returns fresh objects (top-level spread; data not deep-cloned)", async () => {
    // Aliasing the source entry would let consumer code mutate it
    // and surprise the next caller — content layer entries are
    // shared across page renders.
    const sourceFixture = entry("publications", "foo");
    const deps = makeDeps({
      getCollection: makeGetCollection({
        publications: [sourceFixture],
      }),
    });

    const result = await resolveLocalizedCollection({
      collection: "publications",
      locale: undefined,
      deps,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).not.toBe(sourceFixture);
    // `data` is not deep-cloned (the spread is shallow); only the
    // top-level extension fields land on a fresh object. That's
    // the intentional contract — Astro's entries are deeply shared
    // too.
    expect(result[0]?.data).toBe(sourceFixture.data);
  });
});
