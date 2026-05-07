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
 */
export interface MiddlewareDeps {
  defaultLocale: string;
  locales: ReadonlyArray<string>;
  noPrefixUrls: ReadonlyArray<string>;
  mode: "auto" | "standalone" | "starlight";
  /** Mirrors Astro's `getEntry` — narrowed to the i18n collection's shape. */
  getEntry: (collection: string, slug: string) => Promise<{ data: Record<string, string> } | undefined>;
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
  const effectiveLocale = locale && locale.length > 0 ? locale.toLowerCase() : deps.defaultLocale;
  try {
    const entry = await deps.getEntry("i18n", effectiveLocale);
    if (entry?.data) return buildTranslateFn(entry.data);
    if (effectiveLocale !== deps.defaultLocale) {
      const fallback = await deps.getEntry("i18n", deps.defaultLocale.toLowerCase());
      if (fallback?.data) return buildTranslateFn(fallback.data);
    }
  } catch {
    // Eaten on purpose — fall through to passthrough below. The
    // missing dictionary is the operator's problem to fix; we
    // don't want one bad locale to take the whole site down.
  }
  return passthrough;
}

/**
 * Pure middleware factory taking explicit dependencies.
 * `polystellaMiddleware()` (in `./middleware.ts`) closes over the
 * virtual-module imports; tests inject mocks here to exercise
 * mode-specific branches without an Astro runtime.
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
    if (deps.mode !== "starlight") {
      context.locals.t = await buildTranslator(locale, deps);
    }
    return next();
  };
}
