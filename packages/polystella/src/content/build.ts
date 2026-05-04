/**
 * Pure, deps-injected core of the `polystellaCollections` helper.
 * The wrapper in `./index.ts` imports the real Astro factories and
 * feeds them in.
 *
 * This helper exists because Astro integrations can't programmatically
 * register content collections — they must come from
 * `src/content.config.ts`. PolyStella ships this for the user to call
 * from there.
 *
 * Conventions:
 *   - Sibling naming: `${collection}__${locale}` (`__` because
 *     hyphens collide with BCP-47 tags like `pt-BR`).
 *   - Default sibling loader: `glob({ pattern: "**\/*.{md,mdx}",
 *     base: "<stagingDir>/<locale>/<collection>" })`.
 *   - Sibling schemas share the source's Zod schema by reference, so
 *     translations validate against the same contract.
 *   - Unrecognised loaders auto-skip with a warning; use
 *     `loaderOverrides` for `file()`-based or fully-custom collections.
 */

/**
 * Per-collection override for sibling loader construction. Variants:
 *   - `glob` — different glob pattern; `base` is always
 *     `<stagingDir>/<locale>/<collection>` (the staging-layout
 *     invariant the build hook depends on).
 *   - `file` — single-file collections (TOML/YAML/JSON via Astro's
 *     `file()` loader). The build hook stages to
 *     `<stagingDir>/<locale>/<collection>/<filename>`.
 *   - `custom` — arbitrary factory taking `(locale, stagingBase)`.
 *   - `skip` — explicit opt-out (the `reason` field documents why).
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
 * Type-level fan-out. Each source key `K` becomes `${K}__${L}` for
 * every locale `L`, with the source value's type preserved. Astro's
 * `InferEntrySchema<"publications__pt-BR">` then resolves to the
 * publications schema, so consumer page code gets full schema-aware
 * inference on `entry.data.*` for translated entries.
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
 * Source map intersected with typed sibling keys, so
 * `ContentConfig['collections'][C]` resolves to a concrete
 * `defineCollection` config rather than `unknown`.
 */
export type PolystellaCollectionsOutput<
  TSource extends Record<string, unknown>,
  TLocales extends string,
> = TSource & LocaleSiblings<TSource, TLocales>;

/**
 * Options for `polystellaCollections`. The helper preserves `source`
 * verbatim and adds locale-suffixed siblings alongside.
 */
export interface PolystellaCollectionsOptions<
  TSource extends Record<string, unknown>,
  TLocales extends readonly string[] = readonly string[],
> {
  /** User's source collections, keyed by name. */
  source: TSource;
  /**
   * Target locales. Typically mirrors `i18n.locales` from
   * `astro.config.mjs`. Pass `defaultLocale` separately so the helper
   * can filter it out — a `publications__en` sibling on top of
   * `publications` would self-translate.
   */
  locales: TLocales;
  /**
   * Optional default locale. Constrained to `TLocales[number]` so a
   * typo becomes a TypeScript error rather than a silent
   * self-translation sibling.
   */
  defaultLocale?: TLocales[number];
  /** Relative to project root. Default: `.astro/i18n-staging`. */
  stagingDir?: string;
  /** Collections to leave un-localised. Source collection is kept; siblings skipped. */
  skipLocalize?: ReadonlyArray<keyof TSource & string>;
  /** Per-collection loader overrides; see `LoaderOverride`. */
  loaderOverrides?: Partial<
    Record<keyof TSource & string, LoaderOverride>
  >;
  /** Defaults to `console`; tests pass a stub. */
  logger?: { warn: (message: string) => void };
}

/** Deps for the test-friendly variant. The public wrapper feeds Astro's. */
export interface PolystellaCollectionsDeps {
  defineCollection: (config: unknown) => unknown;
  glob: (opts: { pattern: string | string[]; base: string }) => unknown;
  file: (path: string) => unknown;
}

import {
  DEFAULT_STAGING_DIR,
  DEFAULT_STAGING_GLOB as DEFAULT_GLOB_PATTERN,
} from "../storage/paths.js";

/**
 * Iterate `source × locales` and return a map intersecting source
 * collections with their per-locale siblings. Exported so tests can
 * pass synthetic deps; production callers go through `./index.ts`.
 *
 * The runtime cast back to `TSource & LocaleSiblings<...>` is
 * structurally lossless: the convention path produces a sibling for
 * every non-skipped (source × locale) pair. Unrecognised loaders
 * warn-and-skip; suppress via `skipLocalize` or `loaderOverrides`.
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

  // Filter `defaultLocale` out of `locales` defensively (Astro's
  // contract includes the default in `i18n.locales`; we don't want
  // a self-translation sibling).
  const targetLocales = defaultLocale
    ? locales.filter((l) => l !== defaultLocale)
    : [...locales];

  const skipSet = new Set<string>(skipLocalize);
  // Widen back to a string-keyed map for the `[collectionName]` lookup.
  const overrides: Record<string, LoaderOverride | undefined> = {
    ...(loaderOverrides as Record<string, LoaderOverride | undefined>),
  };

  // Source collections kept verbatim; siblings layered on top.
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
 * Build a single sibling for `(collectionName, locale)`. Returns
 * `null` when the loader can't be derived (custom loader without an
 * override) — caller warns and skips. Exposed for unit tests.
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
    // Exhaustiveness guard for future `LoaderOverride` variants.
    throw new Error(
      `[polystella] unrecognized loaderOverride kind for collection "${collectionName}": ${
        (override as { kind: string }).kind
      }`,
    );
  }

  // Convention path: assume a markdown/MDX collection rooted at the
  // staging base.
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
 * Recognise the built-in `glob()` loader so the convention path can
 * derive a sibling automatically. `file-loader` isn't auto-derived
 * (the sibling needs the file basename, which is closed over in the
 * source loader); users supply `loaderOverrides.<collection> =
 * { kind: "file", filename: "..." }` for those.
 *
 * Conservative on purpose: a false positive (custom loader sniffed
 * as glob) would silently substitute our loader for theirs.
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
 * Pull `schema` off the source collection. Astro's `defineCollection`
 * is identity-shaped, so `source.schema` is whatever the user
 * declared. `undefined` for loader-only collections.
 */
function readSchema(sourceCollection: unknown): unknown {
  if (sourceCollection === null || typeof sourceCollection !== "object") {
    return undefined;
  }
  return (sourceCollection as { schema?: unknown }).schema;
}
