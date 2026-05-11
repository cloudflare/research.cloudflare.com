/**
 * Pure middleware core. Lives separately from `middleware.ts` so
 * vitest can import it without resolving the
 * `polystella:runtime-config` / `astro:content` virtual modules.
 *
 * `middleware.ts` re-exports these and pre-instantiates the public
 * `polystellaMiddleware()` / `onRequest` against the production
 * dependencies.
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
 * Astro's MiddlewareHandler shape, narrowed to what we need. We
 * avoid importing `astro:middleware` directly to keep the module
 * importable in unit tests (vitest doesn't provide that virtual
 * module without an Astro runtime).
 */
type MinimalContext = {
  currentLocale: string | undefined;
  locals: Record<string, unknown>;
};
export type PolystellaMiddleware = (context: MinimalContext, next: () => unknown) => Promise<unknown> | unknown;

/**
 * Pure dependency surface for the middleware core. Lifted out of
 * the `polystella:runtime-config` / `astro:content` imports so the
 * core is testable from vitest without an Astro runtime providing
 * the virtual modules. Production callers go through
 * `polystellaMiddleware()` (in `./middleware.ts`) which closes over
 * the real imports.
 *
 * `getEntry` / `getCollection` are typed against `SourceEntryShape`
 * so the same deps satisfy both the i18n translator (which only
 * reads `.data`) and the localized-entry / localized-collection
 * bindings (which need the full entry shape). The translator narrows
 * `data` to `Record<string, string>` at its call site since the i18n
 * collection's schema enforces string values.
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

/**
 * Build the locale-bound `localizedHref` closure used by both the
 * Astro middleware and (indirectly) the React hook. `deps` carries
 * the resolved locale set + `noPrefixUrls`; production callers
 * thread the production virtual-module imports through.
 */
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
 * Resolve a translator for the given locale. Encapsulated so the
 * middleware path and any future explicit-call surface share one
 * fallback chain: visitor locale → default locale → literal-key
 * passthrough. Errors resolve to the passthrough so a single
 * malformed dictionary doesn't break unrelated pages.
 */
export async function buildTranslator(
  locale: string | undefined,
  deps: Pick<MiddlewareDeps, "defaultLocale" | "getEntry">,
): Promise<TranslateFn> {
  const passthrough: TranslateFn = (key: string) => key;
  // Astro stores content-collection entry IDs lowercased. We
  // lowercase BOTH the visitor locale (when provided) and the
  // default locale fallback so a configured locale like `en-US`
  // resolves to entry id `en-us` regardless of which branch we
  // come through.
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
    // Eaten on purpose — fall through to passthrough below. The
    // missing dictionary is the operator's problem to fix; we
    // don't want one bad locale to take the whole site down.
  }
  return passthrough;
}

/**
 * Locale-bound `getLocalizedEntry` for `Astro.locals`. Mirrors the
 * import-side function's overload surface, minus the `locale` arg
 * (the binding closes over the request's locale).
 *
 *   await Astro.locals.getLocalizedEntry("publications", "foo")
 *   await Astro.locals.getLocalizedEntry({ collection: "people", id: "alice" })
 */
export type BoundGetLocalizedEntry = (
  collectionOrRef: string | CollectionEntryRef,
  idOrUndefined?: string,
) => Promise<LocalizedEntry<SourceEntryShape> | undefined>;

/**
 * Locale-bound `getLocalizedCollection` for `Astro.locals`. The
 * filter receives the merged-and-tagged shape so callers can
 * branch on `entry.isLocalized` / `entry.locale` if they want to;
 * existing `({ data }) => ...` filters work unchanged.
 *
 * Filter return type is `unknown` (not `boolean`) to match Astro's
 * `getCollection` filter convention — callers can write
 * `(pub) => pub.data.authors?.some(...)` without coercing the
 * optional-chain `boolean | undefined` to `boolean`.
 */
export type BoundGetLocalizedCollection = (
  collection: string,
  filter?: (entry: LocalizedEntry<SourceEntryShape>) => unknown,
) => Promise<LocalizedEntry<SourceEntryShape>[]>;

/**
 * Build the locale-bound `getLocalizedEntry` closure. Production
 * callers go through `createMiddleware`; tests call this directly
 * to verify the closure honours the bound locale across calls.
 *
 * The bound function accepts both the tuple form (`collection, id`)
 * and the ref form (`{ collection, id }`); disambiguation is
 * delegated to `normaliseGetLocalizedEntryArgs` so the two surfaces
 * stay in lockstep.
 */
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
 * Build the locale-bound `getLocalizedCollection` closure. Same
 * pattern as `bindGetLocalizedEntry` — locale closed over, deps
 * threaded through. Filter is forwarded verbatim to
 * `resolveLocalizedCollection`, which applies it post-merge so
 * the user's filter sees the resolved entry shape regardless of
 * whether each entry came from a sibling hit or a source fallback.
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
 * Pure middleware factory taking explicit dependencies.
 * `polystellaMiddleware()` (in `./middleware.ts`) closes over the
 * virtual-module imports; tests inject mocks here to exercise
 * mode-specific branches without an Astro runtime.
 *
 * Locals populated per request:
 *   - `lhref` — locale-bound `localizedHref`. Always installed.
 *   - `t` — translator. Skipped in starlight mode (Starlight owns
 *     `t` via i18next).
 *   - `getLocalizedEntry` / `getLocalizedCollection` — locale-bound
 *     content fetchers. Always installed (these don't conflict with
 *     anything Starlight provides).
 */
export function createMiddleware(deps: MiddlewareDeps): PolystellaMiddleware {
  return async (context, next) => {
    const locale = context.currentLocale;
    // Exposed as `lhref` rather than `localizedHref` so templates
    // stay terse (`Astro.locals.lhref("/foo")`). The verbose name
    // remains on the explicit import path
    // (`localizedHref(href, locale?)` from `polystella/runtime`)
    // and on the React hook (`useLocalizedHref`), where the import
    // site already documents intent.
    context.locals.lhref = buildLocalizedHref(locale, deps);

    // Locale-bound content fetchers. Long names match the
    // import-side functions for IDE autocomplete + searchability;
    // the destructure idiom keeps call sites concise:
    //
    //   const { getLocalizedEntry, getLocalizedCollection } = Astro.locals;
    //
    // Both install in every mode — unlike `t` (which Starlight
    // owns), these don't conflict with anything Starlight provides.
    context.locals.getLocalizedEntry = bindGetLocalizedEntry(locale, deps);
    context.locals.getLocalizedCollection = bindGetLocalizedCollection(locale, deps);

    if (deps.mode !== "starlight") {
      context.locals.t = await buildTranslator(locale, deps);
    }
    return next();
  };
}
