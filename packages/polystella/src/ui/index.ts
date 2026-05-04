/**
 * `polystella/ui` — public entry point. Three surfaces:
 *   - `i18nLoader()` / `i18nSchema()` for `content.config.ts`.
 *   - `useTranslations(locale)` for page-render-time `t()`.
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
import {
  resolveTranslations,
  type TranslateFn,
} from "./translate.js";

/**
 * Astro content-collection loader for the `i18n` collection. Mirrors
 * Starlight's `i18nLoader()` shape. Defaults: `./src/content/i18n`,
 * `**\/*.json`.
 */
export function i18nLoader(options: I18nLoaderOptions = {}): unknown {
  return buildI18nLoader({ glob: astroGlob }, options);
}

export { i18nSchemaCore as i18nSchema };
export type { I18nLoaderOptions, I18nEntryData } from "./loader.js";

/**
 * Resolve a `t()` bound to the visitor's locale.
 *
 *   const t = await useTranslations(Astro.currentLocale);
 *   <a href="/">{t("nav.home")}</a>
 *   <p>{t("greeting", { name: "Diogo" })}</p>
 *
 * Falls back to the default-locale dictionary on missing keys, then
 * to the literal key. Collection name is fixed to `"i18n"`.
 */
export async function useTranslations(
  locale: string | undefined,
): Promise<TranslateFn> {
  return resolveTranslations(locale, {
    defaultLocale,
    // `getEntry` widened to string-keyed; the structural shape we
    // need (`{ data: Record<string, string> }`) holds for any
    // `defineCollection`-backed entry.
    getI18nEntry: async (loc) => {
      const entry = await (
        getEntry as (
          collection: string,
          slug: string,
        ) => Promise<{ data: Record<string, string> } | undefined>
      )("i18n", loc);
      return entry;
    },
  });
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
