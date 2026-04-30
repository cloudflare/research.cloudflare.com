/**
 * `polystellaCollections` — public entry-point for the content-config
 * helper. Imports the real Astro factories (`defineCollection`,
 * `glob`, `file`) and feeds them into the pure core in `./build.ts`.
 *
 * Tests don't import this file (the `astro:content` virtual module
 * doesn't resolve outside Astro's Vite environment); they go
 * directly to `./build.js` and pass synthetic deps.
 *
 * See `./build.ts` for the contract, the conventions, and the
 * options surface.
 */

import { defineCollection as astroDefineCollection } from "astro:content";
import { glob as astroGlob, file as astroFile } from "astro/loaders";

import {
  buildCollections,
  type PolystellaCollectionsOptions,
  type PolystellaCollectionsOutput,
} from "./build.js";

export {
  buildCollections,
  deriveSiblingCollection,
  type LoaderOverride,
  type LocaleSiblings,
  type PolystellaCollectionsDeps,
  type PolystellaCollectionsOptions,
  type PolystellaCollectionsOutput,
} from "./build.js";

/**
 * Public helper. Wraps `buildCollections` with the real Astro
 * imports. The result is shaped as `{ ...source, ...siblings }` and
 * is intended to be the right-hand side of `export const collections
 * = ...` in `src/content.config.ts`.
 *
 * The `TLocales` generic is inferred from the literal-typed
 * `locales` array the caller passes; the return type then carries
 * typed sibling keys (e.g. `publications__pt-BR` typed identically
 * to `publications`) so Astro's `InferEntrySchema<C>` resolves to
 * the user's actual schema rather than `any`. Without this, every
 * `entry.data.*` access in consumer pages would silently lose its
 * types.
 */
export function polystellaCollections<
  TSource extends Record<string, unknown>,
  TLocales extends readonly string[],
>(
  opts: PolystellaCollectionsOptions<TSource, TLocales>,
): PolystellaCollectionsOutput<TSource, TLocales[number]> {
  return buildCollections(opts, {
    defineCollection: astroDefineCollection,
    glob: astroGlob,
    file: astroFile,
  });
}
