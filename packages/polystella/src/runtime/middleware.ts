/**
 * Per-request middleware that exposes `Astro.locals.t` and
 * `Astro.locals.localizedHref`, mirroring Starlight's pattern.
 *
 * Auto-registered by the integration when `options.middleware` is
 * `true` (the default). Consumers can also import the factory
 * directly and compose it via `astro:middleware`'s `sequence(...)`
 * when they need a specific ordering with their own middleware.
 *
 * Mode-aware behaviour:
 *
 *   - `standalone` / `auto`: install both `t` (from polystella's
 *     `i18n` collection) and `localizedHref`.
 *   - `starlight`: install only `localizedHref`. Starlight's own
 *     middleware sets `t` via i18next; replacing it would break
 *     `docs` pages.
 *
 * Failure modes degrade gracefully — a missing dictionary, an
 * unreadable `i18n` collection, etc., fall back to a passthrough
 * `t` (returns the literal key). The build doesn't break.
 *
 * The pure middleware core lives in `./middleware-core.ts` so vitest
 * can import it without resolving the virtual modules below.
 */

import { getEntry } from "astro:content";
import { defaultLocale, locales, mode, noPrefixUrls } from "polystella:runtime-config";

import { createMiddleware, type PolystellaMiddleware } from "./middleware-core.js";

export {
  buildLocalizedHref,
  buildTranslator,
  createMiddleware,
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
  // `getEntry` is widened from Astro's collection-generic shape to
  // the simpler narrowing we need (the i18n collection's data is a
  // flat string map regardless of how it was declared).
  const widenedGet = getEntry as (collection: string, slug: string) => Promise<{ data: Record<string, string> } | undefined>;
  return createMiddleware({
    defaultLocale,
    locales,
    noPrefixUrls,
    mode,
    getEntry: widenedGet,
  });
}

/**
 * Astro's `addMiddleware` resolves the entrypoint module's
 * `onRequest` export. Pre-instantiating the factory here means the
 * integration's `addMiddleware({ entrypoint: ".../middleware.js" })`
 * call resolves to the same handler shape `sequence(...)` expects
 * — no separate auto-middleware file needed.
 */
export const onRequest = polystellaMiddleware();
