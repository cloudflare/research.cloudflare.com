/**
 * Locale-aware URL helpers and translation-status resolution for the
 * locale picker, translation notice, and footer badge.
 *
 * `defaultLocale` and `locales` come from `polystella:runtime-config`
 * (which the integration populates from `astro.config.mjs`'s `i18n`
 * block); we don't redeclare them here.
 */
import { defaultLocale, locales } from "polystella:runtime-config";

export { defaultLocale, locales };

/** Native endonyms shown in the picker; falls back to the bare code. */
export const LOCALE_NAMES: Record<string, string> = {
  "en-US": "English",
  "pt-BR": "Português (Brasil)",
  "ja-JP": "日本語",
  "es-ES": "Español",
};

export function localeName(locale: string): string {
  return LOCALE_NAMES[locale] ?? locale;
}

/**
 * Strip an existing non-default locale prefix (if any) and prepend
 * `targetLocale` (unless target is the default). Preserves the
 * input's trailing-slash convention.
 */
export function swapLocale(pathname: string, targetLocale: string): string {
  const segments = pathname.split("/").filter((s) => s.length > 0);
  const nonDefaultLocales = locales.filter((l) => l !== defaultLocale);
  const hasLocalePrefix = segments.length > 0 && nonDefaultLocales.includes(segments[0]);
  const logicalSegments = hasLocalePrefix ? segments.slice(1) : segments;
  const trailingSlash = pathname.endsWith("/");

  if (targetLocale === defaultLocale) {
    if (logicalSegments.length === 0) return "/";
    return "/" + logicalSegments.join("/") + (trailingSlash ? "/" : "");
  }
  if (logicalSegments.length === 0) return `/${targetLocale}/`;
  return `/${targetLocale}/${logicalSegments.join("/")}` + (trailingSlash ? "/" : "");
}

export type TranslationStatus = "ai" | "override" | "fallback" | "source";

export interface TranslationStatusEntry {
  isLocalized?: boolean;
  data?: { aiTranslated?: boolean; [key: string]: unknown };
}

/**
 * Resolve a page's translation provenance. Default locale → `"source"`;
 * non-default with no localized entry → `"fallback"`; localized with
 * `aiTranslated: true` → `"ai"`; localized without the marker →
 * `"override"` (PolyStella never injects the marker on hand-written
 * overrides under `i18n/overrides/`).
 */
export function computeTranslationStatus(
  currentLocale: string | undefined,
  entry: TranslationStatusEntry | null | undefined,
): TranslationStatus {
  if (!currentLocale || currentLocale === defaultLocale) return "source";
  if (!entry || !entry.isLocalized) return "fallback";
  return entry.data?.aiTranslated === true ? "ai" : "override";
}
