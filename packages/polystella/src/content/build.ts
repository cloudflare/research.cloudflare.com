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
export type LocaleSiblings<TSource extends Record<string, unknown>, TLocales extends string> = {
  [K in keyof TSource as K extends string ? `${K}__${TLocales}` : never]: TSource[K];
};

/**
 * Source map intersected with typed sibling keys, so
 * `ContentConfig['collections'][C]` resolves to a concrete
 * `defineCollection` config rather than `unknown`.
 */
export type PolystellaCollectionsOutput<TSource extends Record<string, unknown>, TLocales extends string> = TSource &
  LocaleSiblings<TSource, TLocales>;

/**
 * Options consumed by the pure-core `buildCollections` (this file).
 * Distinct from the public `PolystellaCollectionsOptions` exported by
 * `./index.ts`, which omits `locales` / `defaultLocale` and lets the
 * wrapper read them from `polystella:runtime-config` for a
 * single-source-of-truth contract with `astro.config.mjs`. Tests
 * reach this internal shape directly so they can pin literal locale
 * tuples without booting the integration.
 */
export interface BuildCollectionsOptions<
  TSource extends Record<string, unknown>,
  TLocales extends readonly string[] = readonly string[],
> {
  /** User's source collections, keyed by name. */
  source: TSource;
  /**
   * Target locales. The pure core takes them explicitly; the public
   * wrapper injects them from `polystella:runtime-config`.
   * `defaultLocale` is filtered out of this set before sibling
   * generation — a `publications__en` sibling on top of
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
  /**
   * Where the user's source content lives, relative to the project
   * root. Used to compute source-relative paths for single-file
   * collections that use polystella's wrapped `file()` loader (so
   * the auto-derived sibling lands at
   * `<stagingDir>/<locale>/<source-relative-path>`, matching where
   * the integration's translation pass stages the file).
   *
   * Default: `"./content"` — matches the integration's `sourceDir`
   * default. If you've changed the integration's `sourceDir` in
   * `polystella.config.mjs`, set the same value here.
   */
  sourceDir?: string;
  /** Collections to leave un-localised. Source collection is kept; siblings skipped. */
  skipLocalize?: ReadonlyArray<keyof TSource & string>;
  /** Per-collection loader overrides; see `LoaderOverride`. */
  loaderOverrides?: Partial<Record<keyof TSource & string, LoaderOverride>>;
  /** Defaults to `console`; tests pass a stub. */
  logger?: { warn: (message: string) => void };
}

/** Deps for the test-friendly variant. The public wrapper feeds Astro's. */
export interface PolystellaCollectionsDeps {
  defineCollection: (config: unknown) => unknown;
  glob: (opts: { pattern: string | string[]; base: string }) => unknown;
  file: (path: string) => unknown;
}

import { posix as pathPosix } from "node:path";

import { createCustomLoaderSibling } from "../runtime/custom-loader-runtime.js";
import { DEFAULT_STAGING_DIR, DEFAULT_STAGING_GLOB as DEFAULT_GLOB_PATTERN } from "../storage/paths.js";
import { readPolystellaCustomLoaderMarker } from "./custom-loader.js";
import { extendSchemaWithAiMarker } from "./extend-schema.js";
import { readRecordedSourcePath } from "./file-loader.js";

/**
 * Default `sourceDir` matches the integration's default
 * (`./content`). Change both together if the consumer relocates
 * source content.
 */
const DEFAULT_SOURCE_DIR = "./content";

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
export function buildCollections<TSource extends Record<string, unknown>, TLocales extends readonly string[]>(
  opts: BuildCollectionsOptions<TSource, TLocales>,
  deps: PolystellaCollectionsDeps,
): PolystellaCollectionsOutput<TSource, TLocales[number]> {
  const {
    source,
    locales,
    defaultLocale,
    stagingDir = DEFAULT_STAGING_DIR,
    sourceDir = DEFAULT_SOURCE_DIR,
    skipLocalize = [],
    loaderOverrides = {},
    logger = console,
  } = opts;

  // Filter `defaultLocale` out of `locales` defensively (Astro's
  // contract includes the default in `i18n.locales`; we don't want
  // a self-translation sibling).
  const targetLocales = defaultLocale ? locales.filter((l) => l !== defaultLocale) : [...locales];

  const skipSet = new Set<string>(skipLocalize);
  // Widen back to a string-keyed map for the `[collectionName]` lookup.
  const overrides: Record<string, LoaderOverride | undefined> = {
    ...(loaderOverrides as Record<string, LoaderOverride | undefined>),
  };

  // Source collections wrapped with AI-marker schema extension; the
  // wrap is structurally a no-op in field shape (loader, etc. all
  // copied), but the schema becomes a superset that accepts the
  // optional `aiTranslated` / `aiTranslationModel` / `aiTranslatedAt`
  // fields. Siblings layered on top with the same extended schema.
  //
  // For collections opted out of localisation entirely (skipLocalize
  // or `kind: "skip"`), we still extend the source schema — the
  // marker fields stay optional/undefined on source content, but
  // declaring them in the type means consumer code that uniformly
  // reads `entry.data.aiTranslated` doesn't TS-error on those
  // collections.
  const out: Record<string, unknown> = {};
  for (const collectionName of Object.keys(source)) {
    out[collectionName] = wrapSourceWithExtendedSchema({
      collectionName,
      sourceCollection: source[collectionName],
      deps,
      logger,
    });
  }

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
        sourceDir,
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
 * Wrap a source collection so its schema accepts the AI-translation
 * marker fields. Loader and any other config fields pass through
 * unchanged via spread; only the schema is replaced (with the
 * extended one when the schema is extendable, or the original when
 * the extender warns-and-skips).
 *
 * Returns the original collection by reference when the input has
 * no schema (loader-only collections need no extension).
 */
function wrapSourceWithExtendedSchema(args: {
  collectionName: string;
  sourceCollection: unknown;
  deps: PolystellaCollectionsDeps;
  logger: { warn: (message: string) => void };
}): unknown {
  const { collectionName, sourceCollection, deps, logger } = args;
  if (sourceCollection === null || typeof sourceCollection !== "object") {
    return sourceCollection;
  }
  const original = sourceCollection as Record<string, unknown>;
  const schema = original.schema;
  if (schema === undefined) return original;

  const extended = extendSchemaWithAiMarker(schema, { collectionName, logger });
  // Identity short-circuit: when the extender returned the input
  // unchanged (warn-and-skip path), don't bother re-wrapping the
  // collection — preserves reference equality with the source.
  if (extended === schema) return original;

  return deps.defineCollection({
    ...original,
    schema: extended,
  });
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
  /** Source content directory, relative to project root. Default: "./content". */
  sourceDir?: string;
  override: LoaderOverride | undefined;
  deps: PolystellaCollectionsDeps;
  logger: { warn: (message: string) => void };
}): unknown | null {
  const {
    collectionName,
    sourceCollection,
    locale,
    stagingDir,
    sourceDir = DEFAULT_SOURCE_DIR,
    override,
    deps,
    logger,
  } = args;

  const stagingBase = `${stagingDir}/${locale}/${collectionName}`;
  const sourceSchema = readSchema(sourceCollection);
  // Sibling schemas extend the source schema with the AI-translation
  // marker so consumer code can read `entry.data.aiTranslated` on
  // translated entries. The extender warns and preserves consumer
  // declarations on collisions (see `extend-schema.ts`).
  const schema =
    sourceSchema !== undefined ? extendSchemaWithAiMarker(sourceSchema, { collectionName, logger }) : undefined;

  // Auto-detect a polystella-wrapped custom loader BEFORE the file()
  // detect — these loaders need a special sibling (the runtime
  // factory translates entries inline at content-sync time), not the
  // generic glob/file overrides. When the marker is present, we
  // short-circuit the normal sibling-derivation path entirely.
  //
  // The `name` on the marker MUST match the consumer-declared
  // collection key — that's the v1 contract. A mismatch indicates
  // the user wrapped the same loader under two collection names
  // (or vice versa), which would break the cache-key/staging-path
  // assumptions. Warn loudly and skip the sibling so the build
  // doesn't silently produce wrong content.
  if (!override) {
    const customMarker = readPolystellaCustomLoaderMarker(readLoader(sourceCollection));
    if (customMarker !== undefined) {
      if (customMarker.name !== collectionName) {
        logger.warn(
          `[polystella] collection "${collectionName}" is wrapped with polystellaLoader({ name: "${customMarker.name}" }) — the wrapper's name MUST match the collection key. Auto-skipping the "${locale}" sibling. Either rename the collection to "${customMarker.name}" or change the wrapper's name to "${collectionName}".`,
        );
        return null;
      }
      // Sibling uses a polystella-provided loader that translates
      // captured entries inline against the integration's runtime
      // bridge. No staging dir, no glob — entries flow through
      // Astro's content store directly.
      return deps.defineCollection({
        loader: createCustomLoaderSibling({ marker: customMarker, locale }),
        ...(schema !== undefined ? { schema } : {}),
      });
    }
  }

  // Auto-detect a polystella-wrapped `file()` loader. When the
  // source collection's loader carries a recorded source path (set
  // by polystella's `file()` wrapper in `./file-loader.ts`), we
  // synthesise the `kind: "file"` override so consumers don't have
  // to declare it manually. Path resolution: source-relative path =
  // `path.relative(sourceDir, recordedPath)`. The integration's
  // translation pass stages the file at
  // `<stagingDir>/<locale>/<source-relative-path>` — the sibling
  // loader points at that same path.
  //
  // Two failure modes are surfaced as warnings (not errors): the
  // recorded path lying outside `sourceDir` (the user's `file()` call
  // is reading a file the integration doesn't walk) and an explicit
  // override of a different kind taking precedence (the override
  // wins, so the user clearly wanted control). Both warnings include
  // the specific paths so the actionable fix is obvious.
  let effectiveOverride: LoaderOverride | undefined = override;
  if (!effectiveOverride) {
    const recordedPath = readRecordedSourcePath(readLoader(sourceCollection));
    if (recordedPath !== undefined) {
      const sourceRelativePath = computeSourceRelativePath(recordedPath, sourceDir);
      if (sourceRelativePath !== null) {
        effectiveOverride = { kind: "file", filename: sourceRelativePath };
      } else {
        logger.warn(
          `[polystella] collection "${collectionName}" was loaded with polystella's file() at "${recordedPath}", but that path is outside sourceDir "${sourceDir}". Auto-skipping the "${locale}" sibling. Either move the file under sourceDir, change \`sourceDir\` in \`polystellaCollections({ sourceDir })\` to match, or pass \`loaderOverrides.${collectionName}\` explicitly.`,
        );
        return null;
      }
    }
  }

  // Explicit per-collection override path. Trust the user.
  if (effectiveOverride) {
    const override = effectiveOverride; // alias for readability below
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
      // Single-file collections (loaded via Astro's `file()` loader)
      // live at `content/<filename>` in the source — NOT under a
      // collection-named subdirectory. The translation pass stages
      // them at `<stagingDir>/<locale>/<source-relative-path>`,
      // which for a source at `content/site.toml` is
      // `<stagingDir>/<locale>/site.toml`. The sibling loader must
      // point at the same path; threading `collectionName` through
      // here would mis-target the file by one extra path segment.
      //
      // For sub-directory'd file sources (e.g. `content/configs/site.toml`),
      // the user passes `filename: "configs/site.toml"` so the path
      // resolves correctly.
      return deps.defineCollection({
        loader: deps.file(`${stagingDir}/${locale}/${override.filename}`),
        ...(schema !== undefined ? { schema } : {}),
      });
    }
    // Exhaustiveness guard for future `LoaderOverride` variants.
    throw new Error(
      `[polystella] unrecognized loaderOverride kind for collection "${collectionName}": ${(override as { kind: string }).kind}`,
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
 * derive a sibling automatically. Astro's bare `file()` loader is
 * NOT auto-derived (the path is closed inside the loader's load
 * closure, opaque to introspection) — users either swap their
 * `file()` import for the polystella-wrapped one (which records the
 * path; auto-detection above kicks in) or supply
 * `loaderOverrides.<collection> = { kind: "file", filename: "..." }`.
 *
 * Conservative on purpose: a false positive (custom loader sniffed
 * as glob) would silently substitute our loader for theirs.
 */
function isRecognisedSourceLoader(sourceCollection: unknown): boolean {
  const loader = readLoader(sourceCollection);
  if (loader === undefined) return false;
  const name = (loader as { name?: unknown }).name;
  return name === "glob-loader";
}

/**
 * Pull the `loader` field off a source collection definition.
 * Returns `undefined` when there's no loader-shaped object to read
 * (loader-only collection, non-object input, etc.). Shared between
 * `isRecognisedSourceLoader` and the file-loader path-record probe.
 */
function readLoader(sourceCollection: unknown): unknown {
  if (sourceCollection === null || typeof sourceCollection !== "object") {
    return undefined;
  }
  const loader = (sourceCollection as { loader?: unknown }).loader;
  if (loader === null || typeof loader !== "object") return undefined;
  return loader;
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

/**
 * Compute the source-relative path of a file the user passed to
 * `file()`. Returns `null` when the file lives outside `sourceDir`
 * (the relative form would start with `..`) — caller surfaces a
 * warning so the operator can fix sourceDir or move the file.
 *
 * Uses POSIX-style separators throughout so the staging path stays
 * forward-slashed across OS boundaries. We intentionally don't
 * resolve to absolute paths here: both inputs are relative to the
 * project root, and string-relative-to-string is sufficient.
 */
function computeSourceRelativePath(recordedPath: string, sourceDir: string): string | null {
  // `path.posix.relative` handles the common cases ("./content",
  // "./content/site.toml" → "site.toml") and emits "../foo/bar"
  // when `recordedPath` falls outside `sourceDir`.
  const rel = pathPosix.relative(sourceDir, recordedPath);
  if (rel.startsWith("..")) return null;
  // Defensive: an exact match (`recordedPath === sourceDir`) is
  // semantically wrong (you can't load a directory via file()) but
  // we treat it as "outside" rather than emit an empty string.
  if (rel === "") return null;
  return rel;
}
