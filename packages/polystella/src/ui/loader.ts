/**
 * UI-strings content-collection loader and schema for PolyStella's
 * standalone mode.
 *
 * The convention mirrors Starlight's: per-locale JSON files at
 * `src/content/i18n/<locale>.json`, each holding a flat
 * `Record<key, translation>` map. Consumers wire them up in
 * `src/content.config.ts`:
 *
 *   import { i18nLoader, i18nSchema } from "polystella/ui";
 *
 *   const i18n = defineCollection({
 *     loader: i18nLoader(),
 *     schema: i18nSchema(),
 *   });
 *
 *   export const collections = {
 *     ...polystellaCollections({
 *       source: { publications, people },
 *       locales: [...],
 *       defaultLocale: "en",
 *     }),
 *     i18n,
 *   };
 *
 * The i18n collection is intentionally NOT registered through
 * `polystellaCollections` because its content is hand-authored JSON
 * keyed by locale — there's no AI translation step or per-locale
 * sibling needed. The runtime helper `useTranslations(locale)` looks
 * up entries on this collection by the locale name (`en`, `pt-BR`,
 * etc.); collection name is hard-coded to `"i18n"` in v0.1 to match
 * Starlight's convention. v0.2 may add a configurable name when
 * Starlight mode lands.
 *
 * Pure module: no `astro:content` import. The integration's wrapper
 * imports the real `glob` from `astro/loaders` and feeds it in. Tests
 * pass synthetic stubs to assert on `pattern` and `base` without
 * needing an Astro project on disk.
 */

import { z } from "astro/zod";

/**
 * Default base directory the i18n loader watches, relative to the
 * project root. Matches Starlight's convention so a Starlight site
 * picking up PolyStella's helpers in v0.2 finds its existing JSON
 * files in place.
 */
export const DEFAULT_I18N_BASE = "./src/content/i18n";

/**
 * Default glob pattern. Two-level matching (`**\/*.json`) so future
 * sub-directory layouts (e.g. `nav/en.json`, `errors/en.json`) work
 * without an option change. Today the pilot uses flat layout
 * (`en.json`, `pt-BR.json`); both shapes resolve through the same
 * loader.
 */
export const DEFAULT_I18N_PATTERN = "**/*.json";

export interface I18nLoaderOptions {
  /**
   * Base directory for JSON files. Default: `./src/content/i18n`.
   * Must be relative to the Astro project root; absolute paths get
   * misresolved by the glob loader on cross-platform builds.
   */
  base?: string;
  /**
   * Glob pattern to match within `base`. Default: `**\/*.json`.
   * Override only if you need to scope to a subdirectory or pick up
   * files in a non-standard layout.
   */
  pattern?: string;
}

/**
 * Dependency-injected glob factory used by the loader. Defined
 * separately so `i18nLoader` stays unit-testable without
 * `astro/loaders`. The public wrapper at `polystella/ui` imports the
 * real `glob` and feeds it in.
 */
export type GlobFactory = (opts: { base: string; pattern: string }) => unknown;

export interface BuildI18nLoaderDeps {
  glob: GlobFactory;
}

/**
 * Pure core of `i18nLoader`. The thin wrapper at `./index.ts` imports
 * Astro's `glob` and feeds it in here. Returns whatever the glob
 * factory returned — Astro's `glob()` produces a loader object that
 * `defineCollection` accepts; the type stays opaque (`unknown`) so
 * we don't have to mirror Astro's internal loader-object shape.
 */
export function buildI18nLoader(
  deps: BuildI18nLoaderDeps,
  options: I18nLoaderOptions = {},
): unknown {
  const base = options.base ?? DEFAULT_I18N_BASE;
  const pattern = options.pattern ?? DEFAULT_I18N_PATTERN;
  return deps.glob({ base, pattern });
}

/**
 * Zod schema for a single locale's UI-strings entry.
 *
 * The shape is deliberately flat: `Record<string, string>`. Nested
 * objects, arrays, and non-string values are rejected at content-sync
 * time so drift detection (which compares key sets across locales)
 * can run on a uniform structure. Operators who need richer shape
 * (e.g. interpolation parameter validation, plural forms) can pass
 * their own Zod schema to `defineCollection` instead.
 *
 * The function form (rather than a bare `z.record(...)`) keeps the
 * API symmetric with Starlight's `i18nSchema()` and leaves room for
 * future options (e.g. an `extend` parameter that merges custom keys
 * with default ones). v0.1 takes no options — adding them is a
 * non-breaking change.
 */
export function i18nSchema() {
  // Empty keys would defeat the entire dictionary lookup; reject at
  // schema time. Empty values are technically valid translations
  // (e.g. an explicitly-blank label) so we don't constrain those.
  return z.record(z.string().min(1), z.string());
}

/**
 * Type alias for what a single i18n entry's `data` field looks like.
 * Useful for typing the result of `getEntry("i18n", locale)` from
 * consumer code.
 */
export type I18nEntryData = Record<string, string>;
