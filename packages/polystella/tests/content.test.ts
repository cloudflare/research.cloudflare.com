import { z } from "astro/zod";
import { describe, expect, it, vi } from "vitest";

import { buildCollections, deriveSiblingCollection, type LoaderOverride, type PolystellaCollectionsDeps } from "../src/content/build.js";
import { POLYSTELLA_SOURCE_PATH_KEY } from "../src/content/file-loader.js";

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

/**
 * Like `makeFileSource` but with a polystella-flavoured `file()`
 * loader — the marker key carries the path so auto-detection in
 * `deriveSiblingCollection` finds it. Tests don't need the real
 * `file()` function from `polystella/content` here; we just simulate
 * what it produces.
 */
function makePolystellaFileSource(args: { recordedPath: string; schema?: unknown }): unknown {
  const loader: Record<string, unknown> = {
    name: "file-loader",
    load: () => undefined,
  };
  Object.defineProperty(loader, POLYSTELLA_SOURCE_PATH_KEY, {
    value: args.recordedPath,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return {
    loader,
    ...(args.schema !== undefined ? { schema: args.schema } : {}),
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

    expect(Object.keys(out)).toEqual(["publications", "publications__pt-BR", "publications__ja-JP"]);
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

    expect(Object.keys(out)).toEqual(["publications", "publications__pt-BR", "publications__ja-JP"]);
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

    expect(Object.keys(out).sort()).toEqual(["blog", "publications", "publications__pt-BR"]);
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
  it('"file" override points at the source-relative-path under the staging dir', () => {
    // Single-file collections (Astro `file()` loader) live at
    // `content/<filename>` in the source, NOT under a collection-named
    // subdirectory. The integration stages them at
    // `<stagingDir>/<locale>/<source-relative-path>`, so the sibling
    // loader must point at the same path — no extra collection
    // segment.
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

    expect(fileCalls).toEqual([{ path: ".astro/i18n-staging/pt-BR/site.toml" }]);
    // Schema still threaded through.
    const siblingConfig = defineCalls[0]?.config as { schema?: unknown };
    expect(siblingConfig?.schema).toEqual({ tag: "site-schema" });
  });

  it('"file" override accepts a sub-directory path so non-root single-file collections work', () => {
    // For a source at `content/configs/site.toml`, the user passes
    // `filename: "configs/site.toml"` so the staging path resolves
    // to `<stagingDir>/<locale>/configs/site.toml` — matching where
    // the integration writes it.
    const { deps, fileCalls } = makeDeps();
    const site = makeFileSource();

    buildCollections(
      {
        source: { site },
        locales: ["pt-BR"],
        loaderOverrides: {
          site: { kind: "file", filename: "configs/site.toml" },
        },
      },
      deps,
    );

    expect(fileCalls).toEqual([{ path: ".astro/i18n-staging/pt-BR/configs/site.toml" }]);
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
    const factory = vi.fn((_locale: string, _stagingBase: string) => customResult);

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

    expect(factory).toHaveBeenCalledExactlyOnceWith("pt-BR", ".astro/i18n-staging/pt-BR/blog");
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
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/collection "blog" uses a custom loader/);
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
    expect(buildCollections({ source: {}, locales: ["pt-BR"] }, deps)).toEqual({});
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
    ).toThrowError(/unrecognized loaderOverride kind for collection "publications"/);
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

describe("buildCollections — file() auto-detection (polystella's wrapped loader)", () => {
  it("auto-derives a sibling for a polystella-wrapped file() loader without an explicit override", () => {
    // Drop-in: the user imports `file` from `polystella/content`,
    // calls it normally, and the helper derives the sibling
    // automatically — no `loaderOverrides` needed.
    const { deps, fileCalls } = makeDeps();
    const site = makePolystellaFileSource({
      recordedPath: "./content/site.toml",
      schema: { tag: "site-schema" },
    });

    buildCollections({ source: { site }, locales: ["pt-BR"] }, deps);

    expect(fileCalls).toEqual([{ path: ".astro/i18n-staging/pt-BR/site.toml" }]);
  });

  it("auto-detection respects sourceDir for sub-directory'd file sources", () => {
    // Source at `content/configs/site.toml` → staged at
    // `.astro/i18n-staging/<locale>/configs/site.toml`. The auto-
    // detection branch computes the relative path against the
    // configured sourceDir and threads that into the file() loader
    // path.
    const { deps, fileCalls } = makeDeps();
    const site = makePolystellaFileSource({
      recordedPath: "./content/configs/site.toml",
    });

    buildCollections(
      { source: { site }, locales: ["pt-BR"], sourceDir: "./content" },
      deps,
    );

    expect(fileCalls).toEqual([{ path: ".astro/i18n-staging/pt-BR/configs/site.toml" }]);
  });

  it("auto-detection works with a non-default sourceDir", () => {
    const { deps, fileCalls } = makeDeps();
    const site = makePolystellaFileSource({
      recordedPath: "./src/data/site.toml",
    });

    buildCollections(
      { source: { site }, locales: ["pt-BR"], sourceDir: "./src/data" },
      deps,
    );

    expect(fileCalls).toEqual([{ path: ".astro/i18n-staging/pt-BR/site.toml" }]);
  });

  it("warns and skips when the recorded path is outside sourceDir", () => {
    // Common misconfiguration: the user changed the integration's
    // sourceDir but not polystellaCollections's. The helper surfaces
    // a clear warning instead of silently mis-targeting the staged
    // file.
    const { deps, fileCalls } = makeDeps();
    const logger = { warn: vi.fn() };
    const site = makePolystellaFileSource({
      recordedPath: "./other/site.toml",
    });

    const out = buildCollections(
      { source: { site }, locales: ["pt-BR"], sourceDir: "./content", logger },
      deps,
    );

    // No sibling registered.
    expect(Object.keys(out)).toEqual(["site"]);
    expect(fileCalls).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
    const message = logger.warn.mock.calls[0]?.[0] as string;
    expect(message).toMatch(/outside sourceDir/);
    expect(message).toContain("./other/site.toml");
    expect(message).toContain("./content");
  });

  it("explicit loaderOverrides still wins over auto-detection (back-compat)", () => {
    // A user who already has `loaderOverrides.site = { ... }` set
    // shouldn't see different behaviour just because they swap
    // their `file()` import. The override path takes precedence.
    const { deps, fileCalls } = makeDeps();
    const site = makePolystellaFileSource({
      recordedPath: "./content/site.toml",
    });

    buildCollections(
      {
        source: { site },
        locales: ["pt-BR"],
        loaderOverrides: {
          site: { kind: "file", filename: "manual-name.toml" },
        },
      },
      deps,
    );

    // Manual filename wins; auto-detected path ignored.
    expect(fileCalls).toEqual([{ path: ".astro/i18n-staging/pt-BR/manual-name.toml" }]);
  });

  it("explicit `kind: 'skip'` override silences auto-detection", () => {
    // Explicit opt-out always wins, even if the loader is
    // auto-detectable. Mirrors the behaviour for glob-loader sources.
    const { deps, fileCalls } = makeDeps();
    const site = makePolystellaFileSource({
      recordedPath: "./content/site.toml",
    });

    const out = buildCollections(
      {
        source: { site },
        locales: ["pt-BR"],
        loaderOverrides: { site: { kind: "skip" } },
      },
      deps,
    );

    expect(Object.keys(out)).toEqual(["site"]);
    expect(fileCalls).toEqual([]);
  });

  it("non-polystella file-loader (no recorded path) still requires an override", () => {
    // Users who import `file` from `astro/loaders` directly hit the
    // existing warn-and-skip path — the helper has no way to know
    // the filename without the marker.
    const { deps, fileCalls } = makeDeps();
    const logger = { warn: vi.fn() };
    const site = makeFileSource({ schema: { tag: "site-schema" } });

    const out = buildCollections(
      { source: { site }, locales: ["pt-BR"], logger },
      deps,
    );

    expect(Object.keys(out)).toEqual(["site"]);
    expect(fileCalls).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
    const message = logger.warn.mock.calls[0]?.[0] as string;
    expect(message).toMatch(/custom loader/);
    expect(message).toContain("loaderOverrides.site");
  });
});

describe("buildCollections — AI marker schema extension (integration)", () => {
  /**
   * Real-Zod helpers — these tests exercise the actual schema-extender
   * end-to-end (the unit-level extender is covered in
   * `schema-extend.test.ts`; here we verify the build-collections path
   * wires it correctly for both source and sibling schemas).
   */
  function makeRealDeps(): { deps: PolystellaCollectionsDeps; defineCalls: { config: unknown }[] } {
    const defineCalls: { config: unknown }[] = [];
    const deps: PolystellaCollectionsDeps = {
      defineCollection: (config) => {
        defineCalls.push({ config });
        return config; // identity, mirroring Astro's defineCollection
      },
      glob: (opts) => ({ name: "glob-loader", __pattern: opts.pattern, __base: opts.base }),
      file: (path) => ({ name: "file-loader", __path: path }),
    };
    return { deps, defineCalls };
  }

  it("extends source schemas so consumers can read entry.data.aiTranslated uniformly", () => {
    const { deps } = makeRealDeps();
    const publicationsSchema = z.object({ title: z.string() });
    const publications = {
      loader: { name: "glob-loader" },
      schema: publicationsSchema,
    };

    const out = buildCollections({ source: { publications }, locales: ["pt-BR"] }, deps);

    const sourceConfig = out.publications as { schema: z.ZodObject<z.ZodRawShape> };
    // Source schema is now extended — accepts marker fields without
    // throwing. `entry.data.aiTranslated` becomes a typed optional
    // boolean reachable from consumer code.
    expect(() => sourceConfig.schema.parse({ title: "Hello" })).not.toThrow();
    expect(() =>
      sourceConfig.schema.parse({
        title: "Hello",
        aiTranslated: true,
        aiTranslationModel: "@cf/meta/llama-3.1-8b-instruct",
        aiTranslatedAt: "2026-05-06T10:00:00Z",
      }),
    ).not.toThrow();
  });

  it("extends sibling schemas with the same marker fields", () => {
    const { deps } = makeRealDeps();
    const publicationsSchema = z.object({ title: z.string() });
    const publications = {
      loader: { name: "glob-loader" },
      schema: publicationsSchema,
    };

    const out = buildCollections({ source: { publications }, locales: ["pt-BR"] }, deps);

    const siblingConfig = out["publications__pt-BR"] as { schema: z.ZodObject<z.ZodRawShape> };
    // Sibling schema accepts the same marker fields. Translated entries
    // arrive with `aiTranslated: true` baked in by the markdown adapter
    // and validate through Astro's content layer cleanly.
    const parsed = siblingConfig.schema.parse({
      title: "Olá",
      aiTranslated: true,
      aiTranslationModel: "@cf/meta/llama-3.1-8b-instruct",
      aiTranslatedAt: "2026-05-06T10:00:00Z",
    });
    expect(parsed).toMatchObject({
      title: "Olá",
      aiTranslated: true,
      aiTranslationModel: "@cf/meta/llama-3.1-8b-instruct",
      aiTranslatedAt: "2026-05-06T10:00:00Z",
    });
  });

  it("preserves the original Zod schema reference when the consumer pre-declares all marker fields", () => {
    // Collision short-circuit (extender returns input unchanged) means
    // the source collection ALSO short-circuits and is returned by
    // reference. Keeps Astro's content layer keying on the original
    // config object (matters for type generation + caching).
    const { deps } = makeRealDeps();
    const fullySpecifiedSchema = z.object({
      title: z.string(),
      aiTranslated: z.boolean().optional(),
      aiTranslationModel: z.string().optional(),
      aiTranslatedAt: z.string().optional(),
    });
    const publications = {
      loader: { name: "glob-loader" },
      schema: fullySpecifiedSchema,
    };
    const logger = { warn: vi.fn() };

    const out = buildCollections({ source: { publications }, locales: ["pt-BR"], logger }, deps);

    // Identity preserved: no rewrap when nothing to add.
    expect(out.publications).toBe(publications);
    // Sibling DOES get a fresh defineCollection call (it has a new
    // loader path even though the schema is identity-shared).
    const siblingConfig = out["publications__pt-BR"] as { schema: unknown };
    expect(siblingConfig.schema).toBe(fullySpecifiedSchema);
  });

  it("leaves loader-only source collections untouched (no schema → nothing to extend)", () => {
    const { deps } = makeRealDeps();
    const docs = { loader: { name: "glob-loader" } }; // no schema

    const out = buildCollections({ source: { docs }, locales: ["pt-BR"] }, deps);

    // Reference equality preserved when there's no schema to extend.
    expect(out.docs).toBe(docs);
  });

  it("function-form schemas are wrapped — invocation returns extended ZodObject", () => {
    const { deps } = makeRealDeps();
    const factorySchema = ({ image }: { image: () => z.ZodTypeAny }) =>
      z.object({ title: z.string(), cover: image() });
    const publications = {
      loader: { name: "glob-loader" },
      schema: factorySchema,
    };

    const out = buildCollections({ source: { publications }, locales: ["pt-BR"] }, deps);

    const sourceConfig = out.publications as { schema: (deps: { image: () => z.ZodTypeAny }) => z.ZodObject<z.ZodRawShape> };
    expect(typeof sourceConfig.schema).toBe("function");

    const resolved = sourceConfig.schema({ image: () => z.string() });
    expect(Object.keys(resolved.shape).sort()).toEqual(
      ["aiTranslated", "aiTranslatedAt", "aiTranslationModel", "cover", "title"].sort(),
    );
  });
});
