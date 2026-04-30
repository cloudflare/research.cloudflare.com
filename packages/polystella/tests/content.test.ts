import { describe, expect, it, vi } from "vitest";

import {
  buildCollections,
  deriveSiblingCollection,
  type LoaderOverride,
  type PolystellaCollectionsDeps,
} from "../src/content/build.js";

/**
 * Tests pin the contract `polystellaCollections` exposes to user
 * `content.config.ts` files: per-locale sibling collections fanned
 * out from a source map, with explicit opt-out and per-collection
 * loader overrides.
 *
 * The helper is dependency-injected on `defineCollection`, `glob`,
 * and `file` so tests don't need an Astro project on disk. The stubs
 * below capture call arguments so we can assert on what the helper
 * asked Astro to register.
 */

interface CapturedDefineCall {
  config: unknown;
}
interface CapturedGlobCall {
  pattern: string | string[];
  base: string;
}
interface CapturedFileCall {
  path: string;
}

function makeDeps(): {
  deps: PolystellaCollectionsDeps;
  defineCalls: CapturedDefineCall[];
  globCalls: CapturedGlobCall[];
  fileCalls: CapturedFileCall[];
} {
  const defineCalls: CapturedDefineCall[] = [];
  const globCalls: CapturedGlobCall[] = [];
  const fileCalls: CapturedFileCall[] = [];

  const deps: PolystellaCollectionsDeps = {
    defineCollection: (config) => {
      defineCalls.push({ config });
      // Echo a tagged object so callers can recognise it in
      // assertions and so equality checks distinguish siblings from
      // source entries.
      return { __polystella_test_collection: true, config };
    },
    glob: ({ pattern, base }) => {
      globCalls.push({ pattern, base });
      return { name: "glob-loader", __pattern: pattern, __base: base };
    },
    file: (path) => {
      fileCalls.push({ path });
      return { name: "file-loader", __path: path };
    },
  };

  return { deps, defineCalls, globCalls, fileCalls };
}

/**
 * Synthesize a "source collection" the helper would receive from
 * `defineCollection({ loader: glob({ ... }), schema })` in a real
 * `content.config.ts`. The helper sniffs `loader.name` to decide
 * whether the convention path is safe; setting `name: "glob-loader"`
 * mirrors what `astro/loaders`' real `glob()` produces.
 */
function makeGlobSource(opts: { schema?: unknown } = {}): unknown {
  return {
    loader: { name: "glob-loader", __pattern: "**/*.md", __base: "./content" },
    ...(opts.schema !== undefined ? { schema: opts.schema } : {}),
  };
}

function makeFileSource(opts: { schema?: unknown } = {}): unknown {
  return {
    loader: { name: "file-loader", __path: "./content/site.toml" },
    ...(opts.schema !== undefined ? { schema: opts.schema } : {}),
  };
}

function makeCustomSource(): unknown {
  return {
    loader: { name: "blog-loader" },
    schema: { kind: "blog-schema" },
  };
}

describe("buildCollections — convention path", () => {
  it("preserves source collections verbatim under their original keys", () => {
    const { deps } = makeDeps();
    const publications = makeGlobSource({ schema: { tag: "pub-schema" } });
    const people = makeGlobSource({ schema: { tag: "ppl-schema" } });

    const out = buildCollections(
      {
        source: { publications, people },
        locales: ["pt-BR"],
      },
      deps,
    );

    // Source entries pass through by reference — preserving identity
    // matters because Astro keys validation, type generation, and
    // the runtime data store on the original config object.
    expect(out.publications).toBe(publications);
    expect(out.people).toBe(people);
  });

  it("fans out one sibling per (collection, locale) pair", () => {
    const { deps } = makeDeps();
    const publications = makeGlobSource();
    const people = makeGlobSource();

    const out = buildCollections(
      {
        source: { publications, people },
        locales: ["pt-BR", "ja-JP"],
      },
      deps,
    );

    // 2 source × 2 locales = 4 siblings + 2 source = 6 total keys.
    expect(Object.keys(out).sort()).toEqual([
      "people",
      "people__ja-JP",
      "people__pt-BR",
      "publications",
      "publications__ja-JP",
      "publications__pt-BR",
    ]);
  });

  it("uses the default `**/*.{md,mdx}` glob pattern and the staging-base path", () => {
    const { deps, globCalls } = makeDeps();
    const publications = makeGlobSource();

    buildCollections(
      {
        source: { publications },
        locales: ["pt-BR"],
        stagingDir: ".astro/i18n-staging",
      },
      deps,
    );

    expect(globCalls).toEqual([
      {
        pattern: "**/*.{md,mdx}",
        base: ".astro/i18n-staging/pt-BR/publications",
      },
    ]);
  });

  it("defaults stagingDir to `.astro/i18n-staging` when omitted", () => {
    const { deps, globCalls } = makeDeps();
    const publications = makeGlobSource();

    buildCollections(
      {
        source: { publications },
        locales: ["pt-BR"],
      },
      deps,
    );

    expect(globCalls[0]?.base).toBe(".astro/i18n-staging/pt-BR/publications");
  });

  it("threads the source schema through to siblings by reference", () => {
    const { deps, defineCalls } = makeDeps();
    const schema = { tag: "shared-schema" };
    const publications = makeGlobSource({ schema });

    buildCollections(
      {
        source: { publications },
        locales: ["pt-BR"],
      },
      deps,
    );

    // The first defineCollection call after source pass-through is
    // the sibling. Its `schema` should be the SAME reference the
    // user passed in, so Zod validation runs on translations against
    // the same contract as source content.
    const siblingConfig = defineCalls[0]?.config as { schema?: unknown };
    expect(siblingConfig?.schema).toBe(schema);
  });

  it("omits `schema` from sibling config when source has no schema", () => {
    const { deps, defineCalls } = makeDeps();
    const publications = makeGlobSource(); // no schema

    buildCollections(
      {
        source: { publications },
        locales: ["pt-BR"],
      },
      deps,
    );

    const siblingConfig = defineCalls[0]?.config as Record<string, unknown>;
    expect("schema" in siblingConfig).toBe(false);
  });
});

describe("buildCollections — defaultLocale filtering", () => {
  it("filters defaultLocale out of the locales list when present", () => {
    const { deps } = makeDeps();
    const publications = makeGlobSource();

    const out = buildCollections(
      {
        source: { publications },
        // Mirrors `i18n.locales` which by Astro's contract includes
        // the default. The helper should not register a self-translation
        // sibling.
        locales: ["en", "pt-BR", "ja-JP"],
        defaultLocale: "en",
      },
      deps,
    );

    expect(Object.keys(out)).toEqual([
      "publications",
      "publications__pt-BR",
      "publications__ja-JP",
    ]);
  });

  it("treats `locales` literally when defaultLocale is not provided", () => {
    const { deps } = makeDeps();
    const publications = makeGlobSource();

    const out = buildCollections(
      {
        source: { publications },
        locales: ["pt-BR", "ja-JP"], // no `en`, no defaultLocale
      },
      deps,
    );

    expect(Object.keys(out)).toEqual([
      "publications",
      "publications__pt-BR",
      "publications__ja-JP",
    ]);
  });
});

describe("buildCollections — skipLocalize", () => {
  it("skips listed collections entirely (no siblings registered)", () => {
    const { deps } = makeDeps();
    const publications = makeGlobSource();
    const blog = makeGlobSource();

    const out = buildCollections(
      {
        source: { publications, blog },
        locales: ["pt-BR"],
        skipLocalize: ["blog"],
      },
      deps,
    );

    expect(Object.keys(out).sort()).toEqual([
      "blog",
      "publications",
      "publications__pt-BR",
    ]);
  });

  it("preserves the source collection for skipped collections", () => {
    const { deps } = makeDeps();
    const blog = makeGlobSource();

    const out = buildCollections(
      {
        source: { blog },
        locales: ["pt-BR"],
        skipLocalize: ["blog"],
      },
      deps,
    );

    expect(out.blog).toBe(blog);
  });
});

describe("buildCollections — loaderOverrides", () => {
  it('"file" override builds a sibling pointing at the staged single-file path', () => {
    const { deps, defineCalls, fileCalls } = makeDeps();
    const site = makeFileSource({ schema: { tag: "site-schema" } });

    buildCollections(
      {
        source: { site },
        locales: ["pt-BR"],
        loaderOverrides: {
          site: { kind: "file", filename: "site.toml" },
        },
      },
      deps,
    );

    expect(fileCalls).toEqual([
      { path: ".astro/i18n-staging/pt-BR/site/site.toml" },
    ]);
    // Schema still threaded through.
    const siblingConfig = defineCalls[0]?.config as { schema?: unknown };
    expect(siblingConfig?.schema).toEqual({ tag: "site-schema" });
  });

  it('"glob" override uses the user-supplied pattern but the helper-derived base', () => {
    const { deps, globCalls } = makeDeps();
    const docs = makeGlobSource();

    buildCollections(
      {
        source: { docs },
        locales: ["pt-BR"],
        loaderOverrides: {
          docs: { kind: "glob", pattern: "**/*.markdoc" },
        },
      },
      deps,
    );

    expect(globCalls).toEqual([
      {
        pattern: "**/*.markdoc",
        base: ".astro/i18n-staging/pt-BR/docs",
      },
    ]);
  });

  it('"custom" override delegates entirely to the user factory', () => {
    const { deps } = makeDeps();
    const blog = makeCustomSource();
    const customResult = { __tag: "user-built-blog-collection" };
    const factory = vi.fn(
      (_locale: string, _stagingBase: string) => customResult,
    );

    const out = buildCollections(
      {
        source: { blog },
        locales: ["pt-BR"],
        loaderOverrides: {
          blog: { kind: "custom", factory },
        },
      },
      deps,
    );

    expect(factory).toHaveBeenCalledExactlyOnceWith(
      "pt-BR",
      ".astro/i18n-staging/pt-BR/blog",
    );
    expect(out["blog__pt-BR"]).toBe(customResult);
  });

  it('"skip" override silently excludes the collection (no warning)', () => {
    const { deps } = makeDeps();
    const logger = { warn: vi.fn() };
    const tags = makeGlobSource();

    const out = buildCollections(
      {
        source: { tags },
        locales: ["pt-BR"],
        loaderOverrides: {
          tags: { kind: "skip", reason: "tag IDs are language-agnostic" },
        },
        logger,
      },
      deps,
    );

    expect(Object.keys(out)).toEqual(["tags"]);
    // `kind: "skip"` is opt-out by design; no warning expected.
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("buildCollections — custom-loader auto-skip", () => {
  it("warns and skips when a source uses file-loader without an override", () => {
    // file-loader is recognised but the convention can't auto-derive
    // a sibling — the source's filename is closed over inside the
    // loader. Users must supply `loaderOverrides.X = { kind: "file",
    // filename: "..." }` to localise file collections. This test
    // pins that contract: silent fallback to a glob sibling would
    // produce a sibling collection that loads from the wrong path.
    const { deps } = makeDeps();
    const logger = { warn: vi.fn() };
    const site = makeFileSource({ schema: { tag: "site-schema" } });

    const out = buildCollections(
      {
        source: { site },
        locales: ["pt-BR"],
        logger,
      },
      deps,
    );

    expect(Object.keys(out)).toEqual(["site"]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/loaderOverrides\.site/);
  });

  it("warns and skips when a source collection uses an unrecognised loader", () => {
    const { deps } = makeDeps();
    const logger = { warn: vi.fn() };
    const blog = makeCustomSource();

    const out = buildCollections(
      {
        source: { blog },
        locales: ["pt-BR"],
        logger,
      },
      deps,
    );

    expect(Object.keys(out)).toEqual(["blog"]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(
      /collection "blog" uses a custom loader/,
    );
    // The warning should also point users at the escape hatch + the
    // explicit-skip silencer so it's actionable, not just noise.
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/loaderOverrides\.blog/);
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/skipLocalize/);
  });

  it("emits one warning per (collection, locale) pair", () => {
    // Predictable firing rate: one warning per attempted sibling.
    // Users with multiple locales see N warnings for the same custom
    // loader; that's the right signal that the loader needs an override.
    const { deps } = makeDeps();
    const logger = { warn: vi.fn() };
    const blog = makeCustomSource();

    buildCollections(
      {
        source: { blog },
        locales: ["pt-BR", "ja-JP"],
        logger,
      },
      deps,
    );

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});

describe("buildCollections — empty inputs", () => {
  it("returns an empty object when source is empty", () => {
    const { deps } = makeDeps();
    expect(
      buildCollections({ source: {}, locales: ["pt-BR"] }, deps),
    ).toEqual({});
  });

  it("returns source verbatim when locales is empty (no siblings)", () => {
    const { deps } = makeDeps();
    const publications = makeGlobSource();

    const out = buildCollections(
      {
        source: { publications },
        locales: [],
      },
      deps,
    );

    expect(Object.keys(out)).toEqual(["publications"]);
    expect(out.publications).toBe(publications);
  });

  it("returns source verbatim when defaultLocale strips locales to empty", () => {
    const { deps } = makeDeps();
    const publications = makeGlobSource();

    const out = buildCollections(
      {
        source: { publications },
        locales: ["en"],
        defaultLocale: "en",
      },
      deps,
    );

    expect(Object.keys(out)).toEqual(["publications"]);
  });
});

describe("deriveSiblingCollection — edge cases", () => {
  it("throws when a future LoaderOverride variant is passed", () => {
    // Belt-and-braces: the public type narrows variants, but if a
    // newer release adds one without updating the switch, surface
    // it loudly rather than silently dropping the sibling.
    const { deps } = makeDeps();
    const publications = makeGlobSource();
    const logger = { warn: vi.fn() };

    expect(() =>
      deriveSiblingCollection({
        collectionName: "publications",
        sourceCollection: publications,
        locale: "pt-BR",
        stagingDir: ".astro/i18n-staging",
        override: { kind: "future-variant" } as unknown as LoaderOverride,
        deps,
        logger,
      }),
    ).toThrowError(
      /unrecognized loaderOverride kind for collection "publications"/,
    );
  });

  it("returns null (and warns) for a custom-loader source without an override", () => {
    const { deps } = makeDeps();
    const blog = makeCustomSource();
    const logger = { warn: vi.fn() };

    const result = deriveSiblingCollection({
      collectionName: "blog",
      sourceCollection: blog,
      locale: "pt-BR",
      stagingDir: ".astro/i18n-staging",
      override: undefined,
      deps,
      logger,
    });

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("returns null (no warning) for an explicit skip override", () => {
    const { deps } = makeDeps();
    const publications = makeGlobSource();
    const logger = { warn: vi.fn() };

    const result = deriveSiblingCollection({
      collectionName: "publications",
      sourceCollection: publications,
      locale: "pt-BR",
      stagingDir: ".astro/i18n-staging",
      override: { kind: "skip" },
      deps,
      logger,
    });

    expect(result).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
