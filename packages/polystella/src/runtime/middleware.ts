/**
 * Per-request middleware that exposes `Astro.locals.t`,
 * `Astro.locals.lhref`, `Astro.locals.getLocalizedEntry`, and
 * `Astro.locals.getLocalizedCollection`, mirroring Starlight's
 * pattern for `t` plus extending the surface with PolyStella's
 * locale-aware content helpers.
 *
 * Auto-registered by the integration when `options.middleware` is
 * `true` (the default). Consumers can also import the factory
 * directly and compose it via `astro:middleware`'s `sequence(...)`
 * when they need a specific ordering with their own middleware.
 *
 * Mode-aware behaviour:
 *
 *   - `standalone` / `auto`: install all four locals.
 *   - `starlight`: install `lhref`, `getLocalizedEntry`,
 *     `getLocalizedCollection`. Skip `t` (Starlight's own
 *     middleware sets it via i18next; replacing it would break
 *     `docs` pages).
 *
 * Failure modes degrade gracefully — a missing dictionary, an
 * unreadable `i18n` collection, etc., fall back to a passthrough
 * `t` (returns the literal key). The build doesn't break.
 *
 * The pure middleware core lives in `./middleware-core.ts` so vitest
 * can import it without resolving the virtual modules below.
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
 * Public middleware factory. Each invocation produces a fresh
 * handler so multiple `sequence(...)` compositions don't share
 * state.
 *
 *   import { sequence } from "astro:middleware";
 *   import { polystellaMiddleware } from "polystella/runtime";
 *   export const onRequest = sequence(myOwn, polystellaMiddleware());
 *
 * When auto-registration is enabled (the default), the integration
 * calls this internally — consumers import this factory only when
 * they've set `middleware: false` and want manual ordering.
 */
export function polystellaMiddleware(): PolystellaMiddleware {
  // Astro's `getEntry` / `getCollection` carry rich generics for
  // per-collection inference. The middleware deps' shape uses the
  // simpler `SourceEntryShape` form (the resolvers narrow at their
  // call sites; the translator narrows `data` to
  // `Record<string, string>` at its own call site). The casts are
  // structurally lossless because every Astro `CollectionEntry`
  // satisfies `SourceEntryShape`.
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

/**
 * Astro's `addMiddleware` resolves the entrypoint module's
 * `onRequest` export. Pre-instantiating the factory here means the
 * integration's `addMiddleware({ entrypoint: ".../middleware.js" })`
 * call resolves to the same handler shape `sequence(...)` expects
 * — no separate auto-middleware file needed.
 */
export const onRequest = polystellaMiddleware();
