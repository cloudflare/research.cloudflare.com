/**
 * `polystella/ui` — public entry point. Four surfaces:
 *   - `i18nLoader()` / `i18nSchema()` for `content.config.ts`.
 *   - `getTranslations(locale)` for page-render-time `t()`.
 *   - `getDictionary(locale, prefix?)` to fetch a raw (or filtered)
 *     dictionary for passing to React islands.
 *   - Pure helpers (`interpolate`, `buildTranslateFn`,
 *     `checkI18nDrift`, `formatDriftIssues`) for unit tests and
 *     consumer-built translation layers.
 *
 * Astro-bound imports are isolated here so the underlying modules
 * stay testable without booting Astro.
 */

import { glob as astroGlob } from "astro/loaders";
import { getEntry } from "astro:content";
import { defaultLocale } from "polystella:runtime-config";

import {
  buildI18nLoader,
  i18nSchema as i18nSchemaCore,
  type I18nLoaderOptions,
} from "./loader.js";
import { resolveTranslations, type TranslateFn } from "./translate.js";

/**
 * Astro content-collection loader for the `i18n` collection. Mirrors
 * Starlight's `i18nLoader()` shape. Defaults: `./src/content/i18n`,
 * `**\/*.json`.
 */
export function i18nLoader(options: I18nLoaderOptions = {}) {
  return buildI18nLoader({ glob: astroGlob }, options);
}

export { i18nSchemaCore as i18nSchema };
export type { I18nLoaderOptions, I18nEntryData } from "./loader.js";

/** Widened `getEntry` that normalises locale casing. */
async function getI18nEntry(
  loc: string,
): Promise<{ data: Record<string, string> } | undefined> {
  // Astro's glob loader lowercases entry IDs, but
  // `Astro.currentLocale` preserves the original case from
  // `astro.config.mjs` (e.g. "pt-BR"). Normalise so the lookup
  // matches.
  return (
    getEntry as (
      collection: string,
      slug: string,
    ) => Promise<{ data: Record<string, string> } | undefined>
  )("i18n", loc.toLowerCase());
}

/**
 * Resolve a `t()` bound to the visitor's locale.
 *
 *   const t = await getTranslations(Astro.currentLocale);
 *   <a href="/">{t("nav.home")}</a>
 *   <p>{t("greeting", { name: "Diogo" })}</p>
 *
 * Falls back to the default-locale dictionary on missing keys, then
 * to the literal key. Collection name is fixed to `"i18n"`.
 */
export async function getTranslations(
  locale: string | undefined,
): Promise<TranslateFn> {
  return resolveTranslations(locale, {
    defaultLocale,
    getI18nEntry,
  });
}

/**
 * Fetch the raw locale dictionary for passing to client-side React
 * components. Returns a plain `Record<string, string>` that can be
 * serialised as a prop.
 *
 *   const dict = await getDictionary(Astro.currentLocale, "nav");
 *   <NavMenu client:load dict={dict} />
 *
 * When `prefix` is supplied, only keys starting with `"<prefix>."`
 * are included — keeps the serialised payload small for components
 * that only need a subset of the dictionary.
 */
export async function getDictionary(
  locale: string | undefined,
  prefix?: string,
): Promise<Record<string, string>> {
  const effectiveLocale = locale ?? defaultLocale;
  const entry = await getI18nEntry(effectiveLocale);
  const dict = entry?.data ?? {};
  if (!prefix) return dict;
  const dotPrefix = prefix.endsWith(".") ? prefix : `${prefix}.`;
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(dict)) {
    if (key.startsWith(dotPrefix)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export {
  buildTranslateFn,
  interpolate,
  resolveTranslations,
  type InterpolateParams,
  type TranslateFn,
  type GetI18nEntry,
  type UseTranslationsDeps,
} from "./translate.js";
export {
  checkI18nDrift,
  formatDriftIssues,
  loadAndCheckDrift,
  type DriftCheckInput,
  type DriftCheckResult,
  type DriftIssue,
  type LoadAndCheckDriftOptions,
} from "./drift.js";
