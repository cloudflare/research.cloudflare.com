/**
 * `polystella/ui` — public entry point for the UI-strings helpers.
 *
 * Three things ship here:
 *
 *   - `i18nLoader()` and `i18nSchema()`: drop into `content.config.ts`
 *     to register the `i18n` content collection.
 *   - `useTranslations(locale)`: page-render-time helper; returns a
 *     bound `t(key, params?)` function.
 *   - Pure utilities (`interpolate`, `buildTranslateFn`,
 *     `checkI18nDrift`, `formatDriftIssues`): exported for direct
 *     unit-testing and for consumers building custom translation
 *     layers on the same primitives.
 *
 * Astro-bound imports (`astro:content`, `astro/loaders`,
 * `polystella:runtime-config`) are isolated to this wrapper so the
 * pure modules underneath stay testable without standing up Astro.
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
 * Construct an Astro content-collection loader for the `i18n`
 * collection. Mirrors Starlight's `i18nLoader()` shape. Pass the
 * result to `defineCollection({ loader, schema })` in
 * `src/content.config.ts`.
 *
 * Default options match the Starlight convention:
 * `base: "./src/content/i18n"`, `pattern: "**\/*.json"`. Override
 * `base` if your layout differs, or `pattern` to scope to a
 * subdirectory.
 */
export function i18nLoader(options: I18nLoaderOptions = {}): unknown {
  return buildI18nLoader({ glob: astroGlob }, options);
}

export { i18nSchemaCore as i18nSchema };
export type { I18nLoaderOptions, I18nEntryData } from "./loader.js";

/**
 * Page-render-time helper. Resolve a translator function bound to
 * the visitor's locale. Reads from the `i18n` content collection
 * (one entry per locale) registered via `i18nLoader`.
 *
 * Typical use in an `.astro` page:
 *
 *   ---
 *   import { useTranslations } from "polystella/ui";
 *   const t = await useTranslations(Astro.currentLocale);
 *   ---
 *   <a href="/">{t("nav.home")}</a>
 *   <p>{t("greeting", { name: "Diogo" })}</p>
 *
 * Returns a function — `await` once at the top of the page, then
 * call synchronously inside the template. Falls back to the
 * default-locale dictionary on missing keys, then to the literal
 * key as a last resort. Drift detection at build time means
 * fall-through should be rare in practice.
 *
 * The collection name is fixed to `"i18n"` in v0.1; v0.2 may add a
 * configurable name when Starlight mode lands.
 */
export async function useTranslations(
  locale: string | undefined,
): Promise<TranslateFn> {
  return resolveTranslations(locale, {
    defaultLocale,
    // The dispatcher needs `getEntry` widened to a string-keyed
    // collection; Astro's overloads constrain the first arg to
    // declared collection names but the i18n collection's name is a
    // literal `"i18n"` we baked in. The cast here is structural —
    // Astro's runtime accepts any collection name and returns an
    // entry-or-undefined. The structural shape we care about
    // (`{ data: Record<string, string> }`) holds for any
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
