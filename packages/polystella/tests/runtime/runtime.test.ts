import { describe, expect, it, vi } from "vitest";

import {
  normaliseGetLocalizedEntryArgs,
  resolveLocalizedEntry,
  type ResolveLocalizedEntryDeps,
  type SourceEntryShape,
} from "../src/runtime/get-localized-entry.js";

/**
 * Tests for the pure runtime helper that powers `getLocalizedEntry`.
 *
 * The helper is dispatch-only after the content-layer pivot: it picks
 * between a per-locale sibling collection (`<collection>__<locale>`)
 * and the source collection. No file IO, no overlay merge, no
 * frontmatter rules. Each branch (default-locale, sibling hit,
 * sibling miss, missing source) gets a dedicated test.
 *
 * Deps are injected so the suite never touches the real filesystem
 * and never imports `astro:content`.
 */

const DEFAULT_LOCALE = "en-US";

/**
 * Stub for `deps.getEntry`. Configured per-test via the `entries`
 * map (keyed by `<collection>:<slug>`). Returns `undefined` for
 * keys not in the map, matching Astro's missing-entry sentinel.
 */
function makeGetEntry(entries: Record<string, SourceEntryShape>): ReturnType<typeof vi.fn> {
  return vi.fn(async (collection: string, slug: string) => {
    return entries[`${collection}:${slug}`];
  });
}

function makeDeps(overrides: Partial<ResolveLocalizedEntryDeps> = {}): ResolveLocalizedEntryDeps {
  return {
    defaultLocale: DEFAULT_LOCALE,
    // Default: source entry exists for any (collection, slug). Tests
    // that need miss behaviour override this with a curated map.
    getEntry: vi.fn(async (collection: string, slug: string) => ({
      id: slug,
      collection,
      data: { title: `Source: ${slug}` },
      body: "Source body",
    })),
    ...overrides,
  };
}

describe("resolveLocalizedEntry — default-locale path", () => {
  it("returns the source entry with isLocalized=false when locale is undefined", async () => {
    const deps = makeDeps();
    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: undefined,
      deps,
    });

    expect(result).toEqual({
      collection: "publications",
      id: "foo",
      data: { title: "Source: foo" },
      body: "Source body",
      isLocalized: false,
      locale: DEFAULT_LOCALE,
    });
  });

  it("returns the source entry when locale is the empty string", async () => {
    const deps = makeDeps();
    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "",
      deps,
    });

    expect(result?.isLocalized).toBe(false);
    expect(result?.locale).toBe(DEFAULT_LOCALE);
  });

  it("returns the source entry when locale equals defaultLocale", async () => {
    const deps = makeDeps();
    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: DEFAULT_LOCALE,
      deps,
    });

    expect(result?.isLocalized).toBe(false);
    expect(result?.locale).toBe(DEFAULT_LOCALE);
  });

  it("does not probe the sibling collection on the default-locale path", async () => {
    // Avoiding the second `getEntry` call on the hot default-locale
    // path matters: the dispatcher runs on every page render.
    const deps = makeDeps();
    await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: undefined,
      deps,
    });

    expect(deps.getEntry).toHaveBeenCalledTimes(1);
    expect(deps.getEntry).toHaveBeenCalledWith("publications", "foo");
  });

  it("returns undefined when the source entry doesn't exist", async () => {
    const deps = makeDeps({
      getEntry: makeGetEntry({}), // empty map, every lookup misses
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "missing",
      locale: undefined,
      deps,
    });

    expect(result).toBeUndefined();
  });
});

describe("resolveLocalizedEntry — cross-locale hit path", () => {
  it("returns the sibling collection entry with isLocalized=true and the requested locale", async () => {
    const deps = makeDeps({
      getEntry: makeGetEntry({
        "publications__pt-BR:antunes2025": {
          collection: "publications__pt-BR",
          id: "antunes2025",
          data: { title: "Antunes2025 (pt-BR)" },
          body: "Corpo traduzido.",
        },
      }),
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "antunes2025",
      locale: "pt-BR",
      deps,
    });

    expect(result).toEqual({
      // The dispatcher normalises `collection` to the SOURCE name so
      // downstream code branching on `entry.collection === "publications"`
      // works for both source and translated entries — page code
      // shouldn't need to know that polystella stores siblings under
      // `publications__pt-BR` internally.
      collection: "publications",
      id: "antunes2025",
      data: { title: "Antunes2025 (pt-BR)" },
      body: "Corpo traduzido.",
      isLocalized: true,
      locale: "pt-BR",
    });
  });

  it("does not fall back to source on a sibling hit (single getEntry call)", async () => {
    const getEntry = makeGetEntry({
      "publications__pt-BR:antunes2025": {
        collection: "publications__pt-BR",
        id: "antunes2025",
        data: { title: "Antunes2025 (pt-BR)" },
      },
    });
    const deps = makeDeps({ getEntry });

    await resolveLocalizedEntry({
      collection: "publications",
      slug: "antunes2025",
      locale: "pt-BR",
      deps,
    });

    expect(getEntry).toHaveBeenCalledTimes(1);
    expect(getEntry).toHaveBeenCalledWith("publications__pt-BR", "antunes2025");
  });

  it("preserves Astro-computed fields (filePath, digest, rendered) from the sibling entry", async () => {
    // The dispatcher returns the sibling entry verbatim plus the
    // extension fields — every Astro-computed field rides through the
    // {...entry} spread. This pins that contract for downstream
    // pages relying on `entry.rendered.html` or `entry.filePath`.
    const localizedFixture = {
      collection: "publications__pt-BR",
      id: "antunes2025",
      data: { title: "Antunes2025 (pt-BR)" },
      body: "Corpo traduzido.",
      filePath: "/abs/.astro/i18n-staging/pt-BR/publications/antunes2025.md",
      digest: "sha256:abc",
      rendered: {
        html: "<p>Corpo traduzido.</p>",
        metadata: { headings: [] },
      },
    };
    const deps = makeDeps({
      getEntry: makeGetEntry({
        "publications__pt-BR:antunes2025": localizedFixture as SourceEntryShape,
      }),
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "antunes2025",
      locale: "pt-BR",
      deps,
    });

    expect(result).toMatchObject({
      filePath: localizedFixture.filePath,
      digest: localizedFixture.digest,
      rendered: localizedFixture.rendered,
    });
  });

  it("uses the __ separator (not :) for sibling-collection lookup", async () => {
    // Pin the naming convention. `polystellaCollections` registers
    // siblings as `${name}__${locale}`; a runtime that probed
    // `${name}:${locale}` instead would silently miss every hit.
    const getEntry = vi.fn(async () => undefined);
    const deps = makeDeps({ getEntry });

    await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(getEntry).toHaveBeenCalledWith("publications__pt-BR", "foo");
  });
});

describe("resolveLocalizedEntry — cross-locale miss path", () => {
  it("falls back to the source entry with isLocalized=false on sibling miss", async () => {
    const deps = makeDeps({
      getEntry: makeGetEntry({
        // Source exists, sibling does not.
        "publications:antunes2025": {
          collection: "publications",
          id: "antunes2025",
          data: { title: "Antunes2025 (en)" },
          body: "Source body.",
        },
      }),
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "antunes2025",
      locale: "pt-BR",
      deps,
    });

    expect(result).toEqual({
      collection: "publications",
      id: "antunes2025",
      data: { title: "Antunes2025 (en)" },
      body: "Source body.",
      isLocalized: false,
      // The fallback entry is in the default locale; tagging it with
      // the requested `pt-BR` would mislead consumer code.
      locale: DEFAULT_LOCALE,
    });
  });

  it("attempts sibling lookup first, then source (two getEntry calls)", async () => {
    const getEntry = vi.fn(async (collection: string) => {
      if (collection === "publications") {
        return {
          collection: "publications",
          id: "foo",
          data: { title: "Source" },
        } as SourceEntryShape;
      }
      return undefined;
    });
    const deps = makeDeps({ getEntry });

    await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(getEntry).toHaveBeenCalledTimes(2);
    expect(getEntry).toHaveBeenNthCalledWith(1, "publications__pt-BR", "foo");
    expect(getEntry).toHaveBeenNthCalledWith(2, "publications", "foo");
  });

  it("returns undefined when both sibling and source miss", async () => {
    const deps = makeDeps({
      getEntry: makeGetEntry({}), // both lookups miss
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "missing",
      locale: "pt-BR",
      deps,
    });

    expect(result).toBeUndefined();
  });
});

describe("resolveLocalizedEntry — fallback policy", () => {
  it("default-locale (default): returns source on sibling miss", async () => {
    const deps = makeDeps({
      // Explicit default; no `fallback` key → behaves as default-locale.
      getEntry: makeGetEntry({
        "publications:foo": {
          collection: "publications",
          id: "foo",
          data: { title: "Source (en)" },
          body: "Source body.",
        },
      }),
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(result?.isLocalized).toBe(false);
    expect(result?.locale).toBe(DEFAULT_LOCALE);
    expect(result?.data.title).toBe("Source (en)");
  });

  it("default-locale (explicit): returns source on sibling miss", async () => {
    const deps = makeDeps({
      fallback: "default-locale",
      getEntry: makeGetEntry({
        "publications:foo": {
          collection: "publications",
          id: "foo",
          data: { title: "Source (en)" },
        },
      }),
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(result?.isLocalized).toBe(false);
  });

  it("skip: returns undefined on sibling miss (so the page 404s)", async () => {
    const getEntry = vi.fn(async (collection: string) => {
      if (collection === "publications") {
        return {
          collection: "publications",
          id: "foo",
          data: { title: "Source (en)" },
        } as SourceEntryShape;
      }
      return undefined;
    });
    const deps = makeDeps({ fallback: "skip", getEntry });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    // Sibling miss + skip = undefined. The dispatcher still reads
    // source so it can check `noTranslate` (which would override the
    // fallback policy to fallback-or-404 per noTranslateBehavior).
    // Two getEntry calls: sibling miss, then source-for-flag-check.
    expect(result).toBeUndefined();
    expect(getEntry).toHaveBeenCalledTimes(2);
    expect(getEntry).toHaveBeenNthCalledWith(1, "publications__pt-BR", "foo");
    expect(getEntry).toHaveBeenNthCalledWith(2, "publications", "foo");
  });

  it("skip + 404: short-circuits to undefined without the source lookup", async () => {
    // When both policies converge on undefined regardless of the
    // source flag, there's no point reading source. This is the only
    // combination that gets the optimization.
    const getEntry = vi.fn(async () => undefined);
    const deps = makeDeps({
      fallback: "skip",
      noTranslateBehavior: "404",
      getEntry,
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(result).toBeUndefined();
    expect(getEntry).toHaveBeenCalledTimes(1);
    expect(getEntry).toHaveBeenCalledWith("publications__pt-BR", "foo");
  });

  it("skip: still returns source on the default-locale path", async () => {
    // `fallback` only governs cross-locale misses. A default-locale
    // call should always return source content if it exists, even
    // under `skip`.
    const deps = makeDeps({
      fallback: "skip",
      getEntry: makeGetEntry({
        "publications:foo": {
          collection: "publications",
          id: "foo",
          data: { title: "Source (en)" },
        },
      }),
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: undefined,
      deps,
    });

    expect(result).toBeDefined();
    expect(result?.isLocalized).toBe(false);
  });

  it("skip: still returns sibling entry on a hit (skip is for misses only)", async () => {
    const deps = makeDeps({
      fallback: "skip",
      getEntry: makeGetEntry({
        "publications__pt-BR:foo": {
          collection: "publications__pt-BR",
          id: "foo",
          data: { title: "Translated" },
        },
      }),
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(result?.isLocalized).toBe(true);
    expect(result?.locale).toBe("pt-BR");
  });
});

describe("resolveLocalizedEntry — noTranslate flag", () => {
  // Source entries flagged with `noTranslate: true` skip the
  // translation loop at build time; the runtime helper sees a sibling
  // miss and applies `noTranslateBehavior` (which takes precedence
  // over `fallback` when the flag is set).

  it("noTranslateBehavior: fallback (default): returns source content for flagged entries", async () => {
    const deps = makeDeps({
      // No noTranslateBehavior key → defaults to "fallback".
      getEntry: makeGetEntry({
        "publications:foo": {
          collection: "publications",
          id: "foo",
          data: { title: "Universal paper", noTranslate: true },
        },
      }),
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(result?.isLocalized).toBe(false);
    expect(result?.locale).toBe(DEFAULT_LOCALE);
    expect(result?.data.title).toBe("Universal paper");
  });

  it("noTranslateBehavior: 404: returns undefined for flagged entries", async () => {
    const deps = makeDeps({
      noTranslateBehavior: "404",
      getEntry: makeGetEntry({
        "publications:foo": {
          collection: "publications",
          id: "foo",
          data: { title: "Universal paper", noTranslate: true },
        },
      }),
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(result).toBeUndefined();
  });

  it("noTranslateBehavior overrides fallback: 'fallback' beats 'skip' for flagged entries", async () => {
    // Operator wants "skip" for general untranslated misses but
    // explicitly wants flagged entries to render under all locales.
    // The per-entry policy wins.
    const deps = makeDeps({
      fallback: "skip",
      noTranslateBehavior: "fallback",
      getEntry: makeGetEntry({
        "publications:foo": {
          collection: "publications",
          id: "foo",
          data: { title: "Universal paper", noTranslate: true },
        },
      }),
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(result?.isLocalized).toBe(false);
    expect(result?.data.title).toBe("Universal paper");
  });

  it("noTranslateBehavior is ignored when the source has no flag", async () => {
    // The flag-specific policy only kicks in when the source has
    // `noTranslate: true`. An untouched source falls through to
    // `fallback` even when noTranslateBehavior is "404".
    const deps = makeDeps({
      noTranslateBehavior: "404",
      // fallback defaults to "default-locale"
      getEntry: makeGetEntry({
        "publications:foo": {
          collection: "publications",
          id: "foo",
          data: { title: "Source", noTranslate: false },
        },
      }),
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(result?.isLocalized).toBe(false);
    expect(result?.data.title).toBe("Source");
  });

  it("noTranslate flag on a sibling-hit source has no effect (sibling won)", async () => {
    // The flag is on the SOURCE; if there's a sibling translation,
    // the dispatcher returns the sibling without consulting source.
    // Operationally `noTranslate: true` should prevent siblings from
    // being created (build-time concern), but if a stale sibling
    // exists in the cache it still wins on hit.
    const deps = makeDeps({
      noTranslateBehavior: "404",
      getEntry: makeGetEntry({
        "publications__pt-BR:foo": {
          collection: "publications__pt-BR",
          id: "foo",
          data: { title: "Stale translation" },
        },
        "publications:foo": {
          collection: "publications",
          id: "foo",
          data: { title: "Source", noTranslate: true },
        },
      }),
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(result?.isLocalized).toBe(true);
    expect(result?.data.title).toBe("Stale translation");
  });
});

describe("resolveLocalizedEntry — fresh-object guarantee", () => {
  it("returns a fresh object (never mutates or aliases the input entry)", async () => {
    // Aliasing the source entry would let consumer code mutate it
    // and surprise the next caller — content layer entries are
    // shared across page renders.
    const sourceFixture: SourceEntryShape = {
      collection: "publications",
      id: "foo",
      data: { title: "Source" },
      body: "Source body",
    };
    const deps = makeDeps({
      getEntry: makeGetEntry({ "publications:foo": sourceFixture }),
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: undefined,
      deps,
    });

    expect(result).not.toBe(sourceFixture);
    // `data` is not deep-cloned (the spread is shallow); only the
    // top-level extension fields land on a fresh object. That's the
    // intentional contract — Astro's entries are deeply shared too.
    expect(result?.data).toBe(sourceFixture.data);
  });
});

describe("normaliseGetLocalizedEntryArgs — overload dispatch", () => {
  it("disambiguates the (collection, id, locale) tuple form", () => {
    expect(normaliseGetLocalizedEntryArgs("publications", "foo", "pt-BR")).toEqual({
      collection: "publications",
      id: "foo",
      locale: "pt-BR",
    });
  });

  it("disambiguates the ({ collection, id }, locale) ref form", () => {
    expect(normaliseGetLocalizedEntryArgs({ collection: "publications", id: "foo" }, "pt-BR", undefined)).toEqual({
      collection: "publications",
      id: "foo",
      locale: "pt-BR",
    });
  });

  it("treats the third arg as ignored on the ref form", () => {
    // Defensive: a consumer who accidentally passes
    // `getLocalizedEntry(ref, locale, somethingElse)` shouldn't get
    // the wrong locale. The dispatch picks `idOrLocale` as the
    // locale and silently drops the third arg.
    expect(normaliseGetLocalizedEntryArgs({ collection: "publications", id: "foo" }, "pt-BR", "spurious")).toEqual({
      collection: "publications",
      id: "foo",
      locale: "pt-BR",
    });
  });

  it("allows omitted locale on the tuple form (returns locale=undefined)", () => {
    expect(normaliseGetLocalizedEntryArgs("publications", "foo", undefined)).toEqual({
      collection: "publications",
      id: "foo",
      locale: undefined,
    });
  });

  it("allows omitted locale on the ref form (returns locale=undefined)", () => {
    expect(normaliseGetLocalizedEntryArgs({ collection: "publications", id: "foo" }, undefined, undefined)).toEqual({
      collection: "publications",
      id: "foo",
      locale: undefined,
    });
  });

  it("throws when the tuple form is called without an id", () => {
    // Prevent silent miscalls like
    // `getLocalizedEntry("publications", undefined, "pt-BR")` from
    // looking up the wrong slug.
    expect(() => normaliseGetLocalizedEntryArgs("publications", undefined, "pt-BR")).toThrowError(
      /`id` is required when the first argument is a string/,
    );
  });
});
