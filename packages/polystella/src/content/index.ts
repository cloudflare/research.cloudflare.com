/**
 * `polystellaCollections` — public entry-point for the content-config
 * helper. Imports Astro's real `defineCollection`/`glob`/`file` and
 * the resolved locale set from `polystella:runtime-config` (which the
 * integration's `astro:config:setup` hook populates from
 * `astro.config.mjs`'s `i18n` block), then feeds the merged inputs
 * into the pure core in `./build.ts`.
 *
 * Single source of truth: callers configure `i18n.locales` and
 * `i18n.defaultLocale` exactly once, in `astro.config.mjs`. They are
 * never repeated in `src/content.config.ts` — drift between the two
 * configs is impossible by construction.
 *
 * Tests bypass this wrapper and call `buildCollections` from
 * `./build.ts` directly with synthetic deps (since `astro:content`
 * and `polystella:runtime-config` only resolve inside Vite).
 */

import { defineCollection as astroDefineCollection } from "astro:content";
import { glob as astroGlob, file as astroFile } from "astro/loaders";
import { defaultLocale as configuredDefaultLocale, locales as configuredLocales } from "polystella:runtime-config";

import { buildCollections, type BuildCollectionsOptions, type PolystellaCollectionsOutput } from "./build.js";

export {
  buildCollections,
  deriveSiblingCollection,
  type LoaderOverride,
  type LocaleSiblings,
  type PolystellaCollectionsDeps,
  type PolystellaCollectionsOutput,
  type BuildCollectionsOptions,
} from "./build.js";

/**
 * Polystella's `file()` loader — drop-in replacement for Astro's,
 * adds path-recording so `polystellaCollections` can auto-derive
 * locale siblings without `loaderOverrides`. See `./file-loader.ts`.
 */
export { file, readRecordedSourcePath, POLYSTELLA_SOURCE_PATH_KEY, type PolystellaFileLoader } from "./file-loader.js";

/**
 * Polystella's custom-loader wrapper — opts a non-glob / non-file
 * Astro loader into translation. The wrapper stamps a non-enumerable
 * marker on the returned loader so `polystellaCollections` can
 * auto-derive locale-sibling collections. See `./custom-loader.ts`.
 */
export {
  polystellaLoader,
  readPolystellaCustomLoaderMarker,
  POLYSTELLA_CUSTOM_LOADER_KEY,
  type CapturedEntry,
  type PolystellaCustomLoaderMarker,
  type PolystellaCustomLoaderOptions,
  type PolystellaWrappedLoader,
} from "./custom-loader.js";

/**
 * Public-facing options for `polystellaCollections`. Locales and
 * defaultLocale are auto-derived from `polystella:runtime-config` —
 * users declare them once in `astro.config.mjs` and never repeat
 * them here.
 */
export type PolystellaCollectionsOptions<TSource extends Record<string, unknown>> = Omit<
  BuildCollectionsOptions<TSource, ReadonlyArray<string>>,
  "locales" | "defaultLocale"
>;

/**
 * Returns `{ ...source, ...siblings }` — the right-hand side of
 * `export const collections = ...` in `src/content.config.ts`.
 *
 * The `string`-typed second generic parameter on the output reflects
 * that locales are read at runtime from the integration's resolved
 * config (not statically from a literal tuple at the call site). The
 * mapped sibling-key type stays useful for indexed access — e.g.
 * `out["publications__pt-BR"]` resolves to the publications schema —
 * because Astro's content-types generator (`.astro/types.d.ts`)
 * produces correct per-collection types from the actual files on
 * disk anyway, independent of this object's TypeScript shape.
 */
export function polystellaCollections<TSource extends Record<string, unknown>>(
  opts: PolystellaCollectionsOptions<TSource>,
): PolystellaCollectionsOutput<TSource, string> {
  return buildCollections(
    {
      ...opts,
      locales: configuredLocales,
      defaultLocale: configuredDefaultLocale,
    },
    {
      defineCollection: astroDefineCollection,
      glob: astroGlob,
      file: astroFile,
    },
  );
}
