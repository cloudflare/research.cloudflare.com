/**
 * `polystellaCollections` — public entry-point for the content-config
 * helper. Imports Astro's real `defineCollection`/`glob`/`file` and
 * feeds them into the pure core in `./build.ts` (which tests use
 * directly with synthetic deps, since `astro:content` doesn't
 * resolve outside Vite).
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
 * Returns `{ ...source, ...siblings }` — the right-hand side of
 * `export const collections = ...` in `src/content.config.ts`.
 *
 * `TLocales` is inferred from the caller's literal-typed `locales`
 * array, so sibling keys (`publications__pt-BR` etc.) are typed
 * identically to the source collection. Without this, every
 * `entry.data.*` access in consumer pages silently degrades to
 * `any`.
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
