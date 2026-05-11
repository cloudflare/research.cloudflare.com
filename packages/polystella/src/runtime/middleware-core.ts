/**
 * Pure middleware core. Separated from `middleware.ts` so vitest
 * can import without resolving virtual modules. `middleware.ts`
 * pre-instantiates the public `polystellaMiddleware()` / `onRequest`
 * against production deps.
 */

import { buildTranslateFn, type TranslateFn } from "../i18n/translate.js";
import { resolveLocalizedCollection } from "./get-localized-collection.js";
import {
  normaliseGetLocalizedEntryArgs,
  resolveLocalizedEntry,
  type CollectionEntryRef,
  type LocalizedEntry,
  type LocalizedFallbackPolicy,
  type NoTranslatePolicy,
  type SourceEntryShape,
} from "./get-localized-entry.js";
import { resolveLocalizedHref } from "./localized-href.js";

/**
 * Narrowed MiddlewareHandler shape; avoids importing `astro:middleware`
 * so the module loads in vitest without an Astro runtime.
 */
type MinimalContext = {
  currentLocale: string | undefined;
  locals: Record<string, unknown>;
};
export type PolystellaMiddleware = (context: MinimalContext, next: () => unknown) => Promise<unknown> | unknown;

/**
 * Pure dependency surface — lifted out of virtual-module imports so
 * vitest can drive the core directly. `getEntry` / `getCollection`
 * type to `SourceEntryShape` so the same deps satisfy translator
 * (reads `.data`) and localized fetchers (need full shape).
 */
export interface MiddlewareDeps {
  defaultLocale: string;
  locales: ReadonlyArray<string>;
  noPrefixUrls: ReadonlyArray<string>;
  mode: "auto" | "standalone" | "starlight";
  /** Astro's `getEntry`. */
  getEntry: (collection: string, slug: string) => Promise<SourceEntryShape | undefined>;
  /** Astro's `getCollection` (no filter — bindings filter on the merged list). */
  getCollection: (collection: string) => Promise<SourceEntryShape[]>;
  /** Cross-locale miss policy for sources without `noTranslate`. Defaults to `"default-locale"`. */
  fallback?: LocalizedFallbackPolicy;
  /** Cross-locale miss policy for sources with `noTranslate: true`. Defaults to `"fallback"`. */
  noTranslateBehavior?: NoTranslatePolicy;
}

/** Locale-bound `localizedHref` closure for middleware + React hook. */
export function buildLocalizedHref(
  locale: string | undefined,
  deps: Pick<MiddlewareDeps, "defaultLocale" | "locales" | "noPrefixUrls">,
): (href: string) => string {
  return (href: string) =>
    resolveLocalizedHref(href, locale, {
      defaultLocale: deps.defaultLocale,
      locales: deps.locales,
      ...(deps.noPrefixUrls.length > 0 ? { noPrefixUrls: deps.noPrefixUrls } : {}),
    });
}

/**
 * Resolve a translator. Fallback chain: visitor locale →
 * default → literal-key passthrough. Errors silently passthrough
 * so one bad dictionary doesn't break unrelated pages.
 */
export async function buildTranslator(
  locale: string | undefined,
  deps: Pick<MiddlewareDeps, "defaultLocale" | "getEntry">,
): Promise<TranslateFn> {
  const passthrough: TranslateFn = (key: string) => key;
  // Astro stores entry IDs lowercased — lowercase both sides so
  // `en-US` resolves to entry id `en-us`.
  const defaultLocaleId = deps.defaultLocale.toLowerCase();
  const effectiveLocale = locale && locale.length > 0 ? locale.toLowerCase() : defaultLocaleId;
  try {
    const entry = await deps.getEntry("i18n", effectiveLocale);
    if (entry?.data) return buildTranslateFn(entry.data as Record<string, string>);
    if (effectiveLocale !== defaultLocaleId) {
      const fallback = await deps.getEntry("i18n", defaultLocaleId);
      if (fallback?.data) return buildTranslateFn(fallback.data as Record<string, string>);
    }
  } catch {
    // Eaten on purpose — passthrough below.
  }
  return passthrough;
}

/**
 * Locale-bound `getLocalizedEntry` for `Astro.locals`. Accepts
 * tuple (`collection, id`) or ref (`{ collection, id }`) forms.
 */
export type BoundGetLocalizedEntry = (
  collectionOrRef: string | CollectionEntryRef,
  idOrUndefined?: string,
) => Promise<LocalizedEntry<SourceEntryShape> | undefined>;

/**
 * Locale-bound `getLocalizedCollection` for `Astro.locals`. Filter
 * receives the merged-and-tagged shape; return type is `unknown` to
 * match Astro's `getCollection` filter convention (callers can use
 * optional-chain results without coercing to boolean).
 */
export type BoundGetLocalizedCollection = (
  collection: string,
  filter?: (entry: LocalizedEntry<SourceEntryShape>) => unknown,
) => Promise<LocalizedEntry<SourceEntryShape>[]>;

export function bindGetLocalizedEntry(
  locale: string | undefined,
  deps: Pick<MiddlewareDeps, "defaultLocale" | "fallback" | "noTranslateBehavior" | "getEntry">,
): BoundGetLocalizedEntry {
  return async (collectionOrRef, idOrUndefined) => {
    const { collection, id } = normaliseGetLocalizedEntryArgs(collectionOrRef, idOrUndefined, undefined);
    return resolveLocalizedEntry({
      collection,
      slug: id,
      locale,
      deps,
    });
  };
}

/**
 * Filter is forwarded to `resolveLocalizedCollection` which applies
 * it post-merge — sees the resolved entry shape regardless of
 * whether each entry came from sibling hit or source fallback.
 */
export function bindGetLocalizedCollection(
  locale: string | undefined,
  deps: Pick<MiddlewareDeps, "defaultLocale" | "fallback" | "noTranslateBehavior" | "getCollection">,
): BoundGetLocalizedCollection {
  return async (collection, filter) => {
    return resolveLocalizedCollection({
      collection,
      locale,
      filter,
      deps,
    });
  };
}

/**
 * Per-request locals:
 *   - `lhref` — locale-bound `localizedHref`. Always installed.
 *     (Short name keeps templates terse; the verbose
 *     `localizedHref(href, locale?)` is on the explicit import path.)
 *   - `t` — translator. Skipped in starlight mode (Starlight owns it).
 *   - `getLocalizedEntry` / `getLocalizedCollection` — always installed.
 */
export function createMiddleware(deps: MiddlewareDeps): PolystellaMiddleware {
  return async (context, next) => {
    const locale = context.currentLocale;
    context.locals.lhref = buildLocalizedHref(locale, deps);
    context.locals.getLocalizedEntry = bindGetLocalizedEntry(locale, deps);
    context.locals.getLocalizedCollection = bindGetLocalizedCollection(locale, deps);
    if (deps.mode !== "starlight") {
      context.locals.t = await buildTranslator(locale, deps);
    }
    return next();
  };
}
