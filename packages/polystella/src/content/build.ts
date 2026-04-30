/**
 * Pure, deps-injected core of the `polystellaCollections` helper.
 *
 * This module is deliberately free of `astro:content` or
 * `astro/loaders` imports so the test suite can exercise it without
 * Astro's virtual-module resolver. The thin wrapper in
 * `./index.ts` imports the real Astro factories and feeds them in
 * as deps.
 *
 * Why a helper rather than an integration hook: Astro 6 integrations
 * cannot programmatically register content collections — collections
 * must come from `src/content.config.ts`. So PolyStella ships this
 * helper for the user to call from their own content config.
 *
 * Conventions:
 *
 *   - Sibling-collection naming: `${collection}__${locale}`.
 *     Double-underscore separator is unambiguous (collection names
 *     don't typically contain `__`), avoids hyphen collisions in
 *     BCP-47 locale tags (e.g. `pt-BR`, `zh-Hans`), and keeps the
 *     keys grep-friendly.
 *   - Default loader for omitted entries: `glob({ pattern:
 *     "**\u002F*.{md,mdx}", base: "<stagingDir>/<locale>/<collection>" })`.
 *     Covers the dominant case in real Astro projects (one
 *     directory per collection, markdown or MDX content) without
 *     forcing per-collection metadata for every entry.
 *   - Schemas: translated collections share the source's Zod schema
 *     **by reference**. Translations validate against the same
 *     contract as source content — a real correctness improvement
 *     over the runtime overlay model that bypassed Zod entirely.
 *   - Custom loaders auto-skip with a warning. The `loaderOverrides`
 *     escape hatch covers `file()`-based collections, custom
 *     patterns, and fully-custom factories.
 */

/**
 * Per-collection override telling PolyStella how to construct the
 * sibling loader for a given source collection. The default (no
 * override) is `glob({ pattern: "**\u002F*.{md,mdx}", base: "<stagingDir>/<locale>/<collection>" })`,
 * which suits the common case of one directory per collection
 * containing markdown or MDX files.
 *
 * Variants:
 *
 *   - `glob` — different glob pattern (e.g. `"**\u002F*.markdoc"` or
 *     a more specific path). `base` is always derived from
 *     `<stagingDir>/<locale>/<collection>`; user-controllable
 *     `base` would defeat the staging-layout invariant the build
 *     hook depends on.
 *   - `file` — single-file collections (TOML/YAML/JSON loaded via
 *     Astro's `file()` loader). The build hook stages the
 *     translated file at `<stagingDir>/<locale>/<collection>/<filename>`,
 *     and the sibling loader points at exactly that path.
 *   - `custom` — arbitrary factory. Receives the locale and the
 *     staging base directory; returns a fully-formed
 *     `defineCollection` config. Use for collections with
 *     non-standard loaders that PolyStella can't otherwise model.
 *   - `skip` — explicit opt-out. Equivalent to listing the
 *     collection in `skipLocalize`, but lets the user record a
 *     reason inline next to the loader metadata for future
 *     archaeology.
 */
export type LoaderOverride =
  | { kind: "glob"; pattern: string | string[] }
  | { kind: "file"; filename: string }
  | {
      kind: "custom";
      factory: (locale: string, stagingBase: string) => unknown;
    }
  | { kind: "skip"; reason?: string };

/**
 * Type-level fan-out: produces the sibling map shape from a source
 * map and a locale union. Each source key `K` becomes `${K}__${L}`
 * for every locale `L` in the union, preserving the source value's
 * type (the sibling shares the same schema by reference).
 *
 * Critically, the siblings are typed with the SAME shape as the
 * source — when Astro's `InferEntrySchema<"publications__pt-BR">`
 * looks up `ContentConfig['collections']["publications__pt-BR"]['schema']`,
 * it sees the publications schema. That's what we want: translated
 * entries validate against the same Zod contract as source entries,
 * and consumer page code gets full schema-aware inference on
 * `entry.data.*`.
 */
export type LocaleSiblings<
  TSource extends Record<string, unknown>,
  TLocales extends string,
> = {
  [K in keyof TSource as K extends string
    ? `${K}__${TLocales}`
    : never]: TSource[K];
};

/**
 * Output shape of `polystellaCollections` / `buildCollections`.
 *
 * The intersection preserves the source's per-collection types AND
 * adds the typed sibling keys, so `ContentConfig['collections'][C]`
 * lookups (used by Astro's `InferEntrySchema`) resolve to the
 * concrete `defineCollection` config rather than `unknown`. This is
 * the difference between consumer code seeing
 * `entry.data.authors: Array<{collection,id}>` (good) and
 * `entry.data.authors: any` (silent type loss).
 */
export type PolystellaCollectionsOutput<
  TSource extends Record<string, unknown>,
  TLocales extends string,
> = TSource & LocaleSiblings<TSource, TLocales>;

/**
 * Public entry-point options for `polystellaCollections`. `source` is
 * the user's collection map (`{ publications, people, ... }`); the
 * helper preserves it verbatim and adds locale-suffixed siblings to
 * the returned object.
 *
 * `TLocales` is inferred from the literal-typed `locales` array the
 * caller passes. Adding `as const` to the array literal is NOT
 * required — TypeScript narrows tuple element types when the
 * destination type is a `readonly T[]` constrained to `string`.
 */
export interface PolystellaCollectionsOptions<
  TSource extends Record<string, unknown>,
  TLocales extends readonly string[] = readonly string[],
> {
  /**
   * The user's source collections, keyed by collection name. Each
   * value is the result of `defineCollection({ ... })`. PolyStella
   * preserves the original entries verbatim — siblings are added
   * alongside, never substituted in place.
   */
  source: TSource;
  /**
   * The list of target locales. Typically mirrors
   * `i18n.locales` from `astro.config.mjs` minus `defaultLocale`,
   * but PolyStella does not enforce that — projects may register
   * siblings for a subset of locales (e.g. progressive rollout).
   *
   * Pass `defaultLocale` separately so the helper can filter it out
   * if the user includes it here by mistake; we do NOT want a
   * `publications__en` sibling on top of `publications`.
   */
  locales: TLocales;
  /**
   * Optional explicit default locale. When set, it's filtered from
   * `locales` before sibling generation (defensive: easier than
   * documenting "don't include the default"). Constrained to the
   * locale union so a typo (`defaultLocale: "pt-Br"` when locales
   * are `["en", "pt-BR"]`) becomes a TypeScript error rather than a
   * silent self-translation sibling.
   */
  defaultLocale?: TLocales[number];
  /**
   * Staging directory base, **relative to project root**. Default:
   * `.astro/i18n-staging`. Must match the integration's staging
   * dir; PolyStella's build hook derives it from
   * `config.cacheDir` (also `.astro/` by default), so the default
   * here lines up by convention.
   */
  stagingDir?: string;
  /**
   * Collections to NOT register siblings for. Useful when a
   * collection contains content that shouldn't be translated —
   * e.g. tag definitions, slugs, or English-only blog posts. The
   * source collection is still returned unchanged; only the
   * locale-suffixed siblings are skipped.
   */
  skipLocalize?: ReadonlyArray<keyof TSource & string>;
  /**
   * Per-collection loader overrides. Entries here take precedence
   * over the default convention. See `LoaderOverride` for variants.
   */
  loaderOverrides?: Partial<
    Record<keyof TSource & string, LoaderOverride>
  >;
  /**
   * Logger for non-fatal warnings (unrecognized loaders, etc.).
   * Defaults to `console`. Tests pass a stub to assert on
   * warning content.
   */
  logger?: { warn: (message: string) => void };
}

/**
 * Dependency-injected variant of `polystellaCollections` for tests.
 * The public function in `./index.ts` imports the real
 * `defineCollection`, `glob`, `file` from Astro and feeds them in
 * here; tests pass stubs so the suite doesn't need an Astro project
 * on disk.
 */
export interface PolystellaCollectionsDeps {
  defineCollection: (config: unknown) => unknown;
  glob: (opts: { pattern: string | string[]; base: string }) => unknown;
  file: (path: string) => unknown;
}

const DEFAULT_STAGING_DIR = ".astro/i18n-staging";
const DEFAULT_GLOB_PATTERN = "**/*.{md,mdx}";

/**
 * Pure, deps-injected core. Iterates `source × locales`, produces
 * sibling collections per the convention or the per-collection
 * override, and returns the merged map.
 *
 * The core is exported (rather than buried inside
 * `polystellaCollections`) so the test file can pass synthetic
 * `defineCollection` / `glob` / `file` stubs and assert on what was
 * called and how. Production callers go through the wrapper in
 * `./index.ts`.
 *
 * The return type is computed as `TSource &
 * LocaleSiblings<TSource, TLocales[number]>` so the consumer's
 * `content.config.ts` exports a strongly-typed `collections` object
 * — critical for Astro's `InferEntrySchema<C>` lookup, which
 * resolves to `any` when `ContentConfig['collections'][C]` is
 * `unknown`. The runtime cast back to `TSource &
 * LocaleSiblings<...>` is structurally lossless: every key the type
 * promises is actually present in the runtime object (the
 * convention path produces a sibling for every non-skipped source
 * key × locale pair) modulo the warn+skip path for unrecognised
 * loaders, which the user can suppress via `skipLocalize` or
 * `loaderOverrides`.
 */
export function buildCollections<
  TSource extends Record<string, unknown>,
  TLocales extends readonly string[],
>(
  opts: PolystellaCollectionsOptions<TSource, TLocales>,
  deps: PolystellaCollectionsDeps,
): PolystellaCollectionsOutput<TSource, TLocales[number]> {
  const {
    source,
    locales,
    defaultLocale,
    stagingDir = DEFAULT_STAGING_DIR,
    skipLocalize = [],
    loaderOverrides = {},
    logger = console,
  } = opts;

  // Filter `defaultLocale` out of `locales` defensively. Users who
  // pass `i18n.locales` directly from astro.config.mjs (which
  // includes the default by Astro's contract) shouldn't get a
  // self-translation sibling.
  const targetLocales = defaultLocale
    ? locales.filter((l) => l !== defaultLocale)
    : [...locales];

  const skipSet = new Set<string>(skipLocalize);
  // The destructuring default flattens `loaderOverrides` to `{}` when
  // the caller omits it; widen the local back to the full
  // `Record<string, LoaderOverride | undefined>` shape so the
  // `[collectionName]` lookup below type-checks. The values are still
  // `LoaderOverride | undefined`, just keyed by an arbitrary string.
  const overrides: Record<string, LoaderOverride | undefined> = {
    ...(loaderOverrides as Record<string, LoaderOverride | undefined>),
  };

  // Start with the source collections verbatim. Sibling collections
  // are layered on top below; they never replace source entries.
  const out: Record<string, unknown> = { ...source };

  for (const collectionName of Object.keys(source)) {
    const sourceCollection = source[collectionName];
    if (skipSet.has(collectionName)) continue;

    const override = overrides[collectionName];
    if (override?.kind === "skip") continue;

    for (const locale of targetLocales) {
      const sibling = deriveSiblingCollection({
        collectionName,
        sourceCollection,
        locale,
        stagingDir,
        override,
        deps,
        logger,
      });
      if (sibling === null) continue;

      const siblingName = `${collectionName}__${locale}`;
      out[siblingName] = sibling;
    }
  }

  return out as PolystellaCollectionsOutput<TSource, TLocales[number]>;
}

/**
 * Build a single sibling collection for the given `(collectionName,
 * locale)` pair. Returns `null` when the loader can't be derived
 * (custom loader without an override) — caller logs a warning and
 * skips the sibling.
 *
 * Exposed for unit tests; not part of the public surface.
 */
export function deriveSiblingCollection(args: {
  collectionName: string;
  sourceCollection: unknown;
  locale: string;
  stagingDir: string;
  override: LoaderOverride | undefined;
  deps: PolystellaCollectionsDeps;
  logger: { warn: (message: string) => void };
}): unknown | null {
  const {
    collectionName,
    sourceCollection,
    locale,
    stagingDir,
    override,
    deps,
    logger,
  } = args;

  const stagingBase = `${stagingDir}/${locale}/${collectionName}`;
  const schema = readSchema(sourceCollection);

  // Explicit per-collection override path. Trust the user.
  if (override) {
    if (override.kind === "skip") return null;
    if (override.kind === "custom") {
      return override.factory(locale, stagingBase);
    }
    if (override.kind === "glob") {
      return deps.defineCollection({
        loader: deps.glob({
          pattern: override.pattern,
          base: stagingBase,
        }),
        ...(schema !== undefined ? { schema } : {}),
      });
    }
    if (override.kind === "file") {
      return deps.defineCollection({
        loader: deps.file(`${stagingBase}/${override.filename}`),
        ...(schema !== undefined ? { schema } : {}),
      });
    }
    // Exhaustive over the discriminated union; this throw should be
    // unreachable. If a future LoaderOverride variant lands without a
    // branch above, surface it loudly rather than silently skipping.
    throw new Error(
      `[polystella] unrecognized loaderOverride kind for collection "${collectionName}": ${
        (override as { kind: string }).kind
      }`,
    );
  }

  // Convention path: assume a markdown/MDX collection rooted at the
  // staging base. Covers the vast majority of real-world setups.
  const recognised = isRecognisedSourceLoader(sourceCollection);
  if (!recognised) {
    logger.warn(
      `[polystella] collection "${collectionName}" uses a custom loader; auto-skipping the "${locale}" sibling. Pass \`loaderOverrides.${collectionName}\` to localise it (variant "custom" or "file"), or list it in \`skipLocalize\` to silence this warning.`,
    );
    return null;
  }

  return deps.defineCollection({
    loader: deps.glob({
      pattern: DEFAULT_GLOB_PATTERN,
      base: stagingBase,
    }),
    ...(schema !== undefined ? { schema } : {}),
  });
}

/**
 * Best-effort sniff of whether a source collection's loader is the
 * built-in `glob()` loader. `glob-loader` is the only loader the
 * convention path can handle automatically — its sibling is just
 * another `glob()` pointed at the staging dir, with the default
 * `**\u002F*.{md,mdx}` pattern.
 *
 * `file-loader` is deliberately NOT auto-derived: the sibling needs
 * the file's basename to construct the staged path, and that's
 * closed over inside the source loader. Users must supply
 * `loaderOverrides.<collection> = { kind: "file", filename: "..." }`
 * to localise file-based collections.
 *
 * False negatives (an unrecognised loader treated as custom) are
 * survivable: the user gets a warning and can supply an override.
 * False positives (a custom loader sniffed as glob) would silently
 * substitute the user's loader for ours, which is worse — so we err
 * on the side of conservative recognition.
 */
function isRecognisedSourceLoader(sourceCollection: unknown): boolean {
  if (sourceCollection === null || typeof sourceCollection !== "object") {
    return false;
  }
  const loader = (sourceCollection as { loader?: unknown }).loader;
  if (loader === null || typeof loader !== "object") return false;
  const name = (loader as { name?: unknown }).name;
  return name === "glob-loader";
}

/**
 * Pull the `schema` field off the source collection. Astro's
 * `defineCollection` is essentially identity (returns the input
 * config object), so `source.schema` is the schema the user
 * declared. Returning `undefined` for collections without a schema
 * (loader-only) lets the caller omit the field entirely from the
 * sibling config.
 */
function readSchema(sourceCollection: unknown): unknown {
  if (sourceCollection === null || typeof sourceCollection !== "object") {
    return undefined;
  }
  return (sourceCollection as { schema?: unknown }).schema;
}
