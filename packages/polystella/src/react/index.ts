/**
 * `polystella/react` — React hooks for client-side translation and
 * locale-aware URL resolution. Both mirror the shape of the Astro-
 * side helpers so the surface is consistent across boundaries.
 *
 *   import { useTranslations, useLocalizedHref } from "polystella/react";
 *
 *   export function NavMenu({ locale, dict }) {
 *     const t = useTranslations(dict);
 *     const link = useLocalizedHref(locale);
 *     return <a href={link("/foo")}>{t("nav.foo")}</a>;
 *   }
 *
 * Pure: no Astro imports, no async, works in any React environment.
 * `useLocalizedHref` reads the resolved locale set + exemptions from
 * `polystella:runtime-config` (Vite-resolved at bundle time, so the
 * client bundle gets a static snapshot — no runtime config fetch).
 */

import { useMemo } from "react";
import { defaultLocale, locales, noPrefixUrls } from "polystella:runtime-config";

import { buildTranslateFn, interpolate } from "../i18n/translate.js";
import type { InterpolateParams, TranslateFn } from "../i18n/translate.js";
import { resolveLocalizedHref } from "../runtime/localized-href.js";

/**
 * React hook returning a `t(key, params?)` bound to the supplied
 * dictionary. Memoised on dictionary identity so re-renders that
 * pass the same object don't rebuild the lookup function.
 */
export function useTranslations(dictionary: Record<string, string>): TranslateFn {
  return useMemo(() => buildTranslateFn(dictionary), [dictionary]);
}

/**
 * React hook returning a locale-bound URL rewriter. Pass
 * `Astro.currentLocale` (or any string locale) as a prop to the
 * island and call the returned function on each URL:
 *
 *   const link = useLocalizedHref(locale);
 *   <a href={link("/foo")}>foo</a>
 *
 * Memoised on `locale` so re-renders with the same locale don't
 * rebuild the closure. Honours `noPrefixUrls` from the resolved
 * config — exemptions match the build-time and Astro-side surfaces.
 */
export function useLocalizedHref(locale: string | undefined): (href: string) => string {
  return useMemo(
    () => (href: string) =>
      resolveLocalizedHref(href, locale, {
        defaultLocale,
        locales,
        ...(noPrefixUrls.length > 0 ? { noPrefixUrls } : {}),
      }),
    [locale],
  );
}

export { interpolate, type InterpolateParams, type TranslateFn };
