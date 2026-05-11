/**
 * Pure, deps-injected core of `polystellaCollections`. The wrapper
 * in `./index.ts` feeds in real Astro factories. Exists because
 * Astro integrations can't programmatically register content
 * collections — they must come from `src/content.config.ts`.
 *
 * Conventions:
 *   - Sibling naming: `${collection}__${locale}` (`__` because
 *     hyphens collide with BCP-47 tags like `pt-BR`).
 *   - Default sibling loader: glob `**\/*.{md,mdx}` under
 *     `<stagingDir>/<locale>/<collection>`.
 *   - Sibling schemas extend the source schema with the AI marker.
 *   - Unrecognised loaders auto-skip with a warning; use
 *     `loaderOverrides` for `file()`-based / fully-custom collections.
 */

/**
 * Per-collection override for sibling loader construction.
 *   - `glob` — different glob pattern; base is always the staging path.
 *   - `file` — single-file collections (TOML/YAML/JSON via `file()`).
 *   - `custom` — arbitrary factory `(locale, stagingBase) => loader`.
 *   - `skip` — explicit opt-out; `reason` documents why.
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
 * Type-level fan-out: each source key `K` becomes `${K}__${L}` for
 * every locale `L`. `InferEntrySchema<"publications__pt-BR">` then
 * resolves to the publications schema for consumer page code.
 */
export type LocaleSiblings<TSource extends Record<string, unknown>, TLocales extends string> = {
  [K in keyof TSource as K extends string ? `${K}__${TLocales}` : never]: TSource[K];
};

/** Source map intersected with typed sibling keys. */
export type PolystellaCollectionsOutput<TSource extends Record<string, unknown>, TLocales extends string> = TSource &
  LocaleSiblings<TSource, TLocales>;

/**
 * Options for the pure-core `buildCollections`. Distinct from the
 * public wrapper's shape — the wrapper reads `locales` /
 * `defaultLocale` from `polystella:runtime-config` for single-source
 * parity with `astro.config.mjs`. Tests pin locale tuples directly here.
 */
export interface BuildCollectionsOptions<TSource extends Record<string, unknown>, TLocales extends readonly string[] = readonly string[]> {
  /** User's source collections, keyed by name. */
  source: TSource;
  /**
   * Target locales. `defaultLocale` is filtered out before sibling
   * generation (no self-translation siblings).
   */
  locales: TLocales;
  /** Constrained to `TLocales[number]` so typos surface as TS errors. */
  defaultLocale?: TLocales[number];
  /** Relative to project root. Default: `.astro/i18n-staging`. */
  stagingDir?: string;
  /**
   * Source content directory, relative to project root. Used to
   * compute source-relative paths for single-file collections via
   * the wrapped `file()` loader. Default `"./content"` — keep in
   * sync with the integration's `sourceDir`.
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

/** Matches the integration's `sourceDir` default. */
const DEFAULT_SOURCE_DIR = "./content";

/**
 * Iterate `source × locales`, return map of source + per-locale
 * siblings. Tests reach this directly with synthetic deps; production
 * goes through `./index.ts`. Unrecognised loaders warn-and-skip.
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

  // Filter `defaultLocale` out defensively — no self-translation siblings.
  const targetLocales = defaultLocale ? locales.filter((l) => l !== defaultLocale) : [...locales];

  const skipSet = new Set<string>(skipLocalize);
  const overrides: Record<string, LoaderOverride | undefined> = {
    ...(loaderOverrides as Record<string, LoaderOverride | undefined>),
  };

  // Wrap every source collection's schema to accept the AI marker
  // fields (even skipLocalize ones — keeps `entry.data.aiTranslated`
  // typesafe everywhere). Siblings layer on the same extended schema.
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
 * marker fields. Loader / other config pass through unchanged.
 * Returns the original by reference when there's no schema to extend.
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
  // Identity short-circuit preserves reference equality on warn-and-skip.
  if (extended === schema) return original;

  return deps.defineCollection({
    ...original,
    schema: extended,
  });
}

/**
 * Build a single sibling for `(collectionName, locale)`. Returns
 * `null` when the loader can't be derived; caller warns and skips.
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
  const { collectionName, sourceCollection, locale, stagingDir, sourceDir = DEFAULT_SOURCE_DIR, override, deps, logger } = args;

  const stagingBase = `${stagingDir}/${locale}/${collectionName}`;
  const sourceSchema = readSchema(sourceCollection);
  // Extend with AI marker so consumer code can read
  // `entry.data.aiTranslated` everywhere. See `extend-schema.ts`.
  const schema = sourceSchema !== undefined ? extendSchemaWithAiMarker(sourceSchema, { collectionName, logger }) : undefined;

  // Detect polystella-wrapped custom loaders BEFORE file() detection —
  // they need the inline-translation sibling, not glob/file overrides.
  // The marker's `name` MUST match the collection key (v1 contract);
  // mismatch ⇒ warn and skip so the build doesn't produce wrong content.
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

  // Auto-detect polystella's wrapped `file()` and synthesise
  // `kind: "file"` so consumers don't need to declare it manually.
  // Path: `path.relative(sourceDir, recordedPath)`. Failure modes
  // (file outside sourceDir, override of different kind) warn with
  // specific paths so the fix is obvious.
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

  // Explicit override path. Trust the user.
  if (effectiveOverride) {
    const override = effectiveOverride; // alias for readability
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
      // Single-file sources live at `content/<filename>`, NOT under
      // a collection-named subdir. Stage at
      // `<stagingDir>/<locale>/<filename>` (no extra segment).
      // For sub-dir sources, pass `filename: "configs/site.toml"`.
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

  // Convention path: markdown/MDX collection rooted at staging base.
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
 * Recognise the built-in `glob()` loader for the convention path.
 * Bare `file()` is NOT auto-derived (path is opaque inside the
 * closure) — users swap to the polystella-wrapped `file()` or
 * supply `loaderOverrides.<collection> = { kind: "file", ... }`.
 * Conservative on purpose: a false positive would silently
 * substitute our loader for the user's custom one.
 */
function isRecognisedSourceLoader(sourceCollection: unknown): boolean {
  const loader = readLoader(sourceCollection);
  if (loader === undefined) return false;
  const name = (loader as { name?: unknown }).name;
  return name === "glob-loader";
}

/** Pull `loader` off a collection definition. `undefined` if none. */
function readLoader(sourceCollection: unknown): unknown {
  if (sourceCollection === null || typeof sourceCollection !== "object") {
    return undefined;
  }
  const loader = (sourceCollection as { loader?: unknown }).loader;
  if (loader === null || typeof loader !== "object") return undefined;
  return loader;
}

/** Pull `schema` off a collection. `undefined` for loader-only. */
function readSchema(sourceCollection: unknown): unknown {
  if (sourceCollection === null || typeof sourceCollection !== "object") {
    return undefined;
  }
  return (sourceCollection as { schema?: unknown }).schema;
}

/**
 * Source-relative path for a `file()`-loaded source. Returns `null`
 * when outside `sourceDir` (caller warns). POSIX separators so
 * staging paths stay forward-slashed cross-OS.
 */
function computeSourceRelativePath(recordedPath: string, sourceDir: string): string | null {
  const rel = pathPosix.relative(sourceDir, recordedPath);
  if (rel.startsWith("..")) return null;
  // Empty == sourceDir itself (you can't `file()` a directory).
  if (rel === "") return null;
  return rel;
}
