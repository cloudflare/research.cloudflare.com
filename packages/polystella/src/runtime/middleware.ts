/**
 * Per-request middleware. Exposes `Astro.locals.t`, `lhref`,
 * `getLocalizedEntry`, `getLocalizedCollection`. Mirrors Starlight's
 * pattern for `t` and extends with PolyStella's content helpers.
 *
 * Auto-registered when `options.middleware: true` (default), or
 * compose manually via `astro:middleware`'s `sequence(...)`.
 *
 * Mode-aware: `starlight` mode skips `t` (Starlight owns it).
 * Failure modes degrade gracefully — passthrough `t` on dictionary
 * errors so the build doesn't break.
 *
 * Pure core lives in `./middleware-core.ts` (vitest-importable
 * without the virtual modules imported below).
 */

import { getCollection, getEntry } from "astro:content";
import { defaultLocale, fallback, locales, mode, noPrefixUrls, noTranslateBehavior } from "polystella:runtime-config";

import type { SourceEntryShape } from "./get-localized-entry.js";
import { createMiddleware, type MiddlewareDeps, type PolystellaMiddleware } from "./middleware-core.js";

export {
  bindGetLocalizedCollection,
  bindGetLocalizedEntry,
  buildLocalizedHref,
  buildTranslator,
  createMiddleware,
  type BoundGetLocalizedCollection,
  type BoundGetLocalizedEntry,
  type MiddlewareDeps,
  type PolystellaMiddleware,
} from "./middleware-core.js";

/**
 * Factory. Each call produces a fresh handler so `sequence(...)`
 * compositions don't share state.
 *
 *   import { sequence } from "astro:middleware";
 *   import { polystellaMiddleware } from "polystella/runtime";
 *   export const onRequest = sequence(myOwn, polystellaMiddleware());
 */
export function polystellaMiddleware(): PolystellaMiddleware {
  // Widen Astro's generics to `SourceEntryShape` for the deps
  // surface. Structurally lossless — every `CollectionEntry`
  // satisfies it; resolvers narrow at their call sites.
  const widenedGetEntry = getEntry as (collection: string, slug: string) => Promise<SourceEntryShape | undefined>;
  const widenedGetCollection = getCollection as (collection: string) => Promise<SourceEntryShape[]>;
  return createMiddleware({
    defaultLocale,
    locales,
    noPrefixUrls,
    mode,
    fallback,
    noTranslateBehavior,
    getEntry: widenedGetEntry,
    getCollection: widenedGetCollection,
  } satisfies MiddlewareDeps);
}

/** Pre-instantiated handler for Astro's `addMiddleware({ entrypoint })`. */
export const onRequest = polystellaMiddleware();
