/**
 * UI-strings content-collection loader and schema.
 *
 * Convention mirrors Starlight: per-locale JSON files at
 * `src/content/i18n/<locale>.json`, each holding a flat
 * `Record<key, translation>` map. Wire up in `src/content.config.ts`:
 *
 *   import { i18nLoader, i18nSchema } from "polystella/i18n";
 *   const i18n = defineCollection({
 *     loader: i18nLoader(),
 *     schema: i18nSchema(),
 *   });
 *   export const collections = {
 *     ...polystellaCollections({ source: { ... }, locales, defaultLocale }),
 *     i18n,
 *   };
 *
 * The `i18n` collection isn't registered through
 * `polystellaCollections` — its content is hand-authored JSON keyed
 * by locale, no AI step or per-locale sibling needed. The collection
 * name is hard-coded to `"i18n"` to match the Starlight convention.
 *
 * Pure module: tests pass synthetic deps; `./index.ts` feeds Astro's
 * real `glob`.
 */

import { z } from "astro/zod";

/** Relative to project root. */
export const DEFAULT_I18N_BASE = "./src/content/i18n";

/** `**\/*.json` so subdirectory layouts (`nav/en.json` etc.) work. */
export const DEFAULT_I18N_PATTERN = "**/*.json";

export interface I18nLoaderOptions {
  /** Default: `./src/content/i18n`. Relative to project root. */
  base?: string;
  /** Default: `**\/*.json`. */
  pattern?: string;
}

/** Injected so `buildI18nLoader` stays testable without `astro/loaders`. */
export type GlobFactory<T = unknown> = (opts: {
  base: string;
  pattern: string;
}) => T;

export interface BuildI18nLoaderDeps<T = unknown> {
  glob: GlobFactory<T>;
}

/**
 * Pure core. Generic over the loader type so the public wrapper
 * (which feeds Astro's real `glob`) propagates Astro's `Loader` type
 * to consumers
 */
export function buildI18nLoader<T>(
  deps: BuildI18nLoaderDeps<T>,
  options: I18nLoaderOptions = {},
): T {
  const base = options.base ?? DEFAULT_I18N_BASE;
  const pattern = options.pattern ?? DEFAULT_I18N_PATTERN;
  return deps.glob({ base, pattern });
}

/**
 * Schema for a single locale's UI-strings entry. Flat
 * `Record<string, string>`; nested shapes are rejected at content-sync
 * time so drift detection can compare uniform key sets. Function form
 * (rather than a bare `z.record(...)`) leaves room for future options.
 */
export function i18nSchema() {
  // Empty keys defeat lookup; empty values are valid (intentionally
  // blank labels).
  return z.record(z.string().min(1), z.string());
}

/** `data` shape for a single i18n entry. */
export type I18nEntryData = Record<string, string>;
