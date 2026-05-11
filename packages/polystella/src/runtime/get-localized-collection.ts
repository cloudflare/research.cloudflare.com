/**
 * Locale-aware collection lookup. Dispatcher only.
 *
 * Sibling to `resolveLocalizedEntry` (`./get-localized-entry.ts`).
 * Whereas the entry helper looks up one (collection, slug) pair, the
 * collection helper materialises every entry in a collection through
 * the same sibling-vs-source dispatch logic, then applies the user's
 * filter to the merged-and-tagged list.
 *
 * Resolution branches:
 *
 *   1. Default-locale (or undefined/empty/= defaultLocale) →
 *      `getCollection(name)` verbatim, every entry tagged
 *      `{ isLocalized: false, locale: defaultLocale }`.
 *
 *   2. Cross-locale → fetch source AND `${name}__${locale}` siblings
 *      in parallel (Promise.all). Index siblings by `id`. For each
 *      source entry:
 *        - sibling hit → tag `{ isLocalized: true, locale }`.
 *        - sibling miss + `noTranslate: true` → consult
 *          `noTranslateBehavior` (`"fallback"` keeps source as
 *          `isLocalized: false`; `"404"` drops the entry).
 *        - sibling miss + no flag → consult `fallback`
 *          (`"default-locale"` keeps source; `"skip"` drops it).
 *
 *   3. Apply the user's filter to the merged-and-tagged list.
 *
 * The filter receives the FULL extended entry shape
 * (`LocalizedEntry<TEntry>`), so callers can branch on
 * `entry.isLocalized` or `entry.locale` if they want to (e.g. to
 * hide untranslated entries in a non-default locale). Existing
 * `({ data }) => ...` filters work unchanged because `LocalizedEntry`
 * is `TEntry & { isLocalized; locale }` — the source's `data` field
 * is preserved verbatim.
 */

import type {
  LocalizedEntry,
  LocalizedFallbackPolicy,
  NoTranslatePolicy,
  SourceEntryShape,
} from "./get-localized-entry.js";
import { withExtensions } from "./get-localized-entry.js";

export interface ResolveLocalizedCollectionDeps<TEntry extends SourceEntryShape = SourceEntryShape> {
  /** From Astro's `i18n.defaultLocale`. */
  defaultLocale: string;
  /** Defaults to `"default-locale"` when absent. */
  fallback?: LocalizedFallbackPolicy;
  /** Defaults to `"fallback"` when absent. */
  noTranslateBehavior?: NoTranslatePolicy;
  /**
   * Astro's `getCollection` (or a test stub). Called once with the
   * source name on the default-locale path, twice (in parallel) on
   * the cross-locale path: source name + sibling name.
   *
   * Sibling-collection naming (`${name}__${locale}`) is bound by
   * convention with `polystellaCollections` — same convention
   * `resolveLocalizedEntry` uses.
   */
  getCollection: (collection: string) => Promise<TEntry[]>;
}

export interface ResolveLocalizedCollectionInput<TEntry extends SourceEntryShape = SourceEntryShape> {
  collection: string;
  /** Visitor's locale; `undefined` means "the default locale". */
  locale: string | undefined;
  /**
   * Optional filter applied to the merged-and-tagged entries.
   * Receives the extended `LocalizedEntry<TEntry>` shape so callers
   * can read `isLocalized` / `locale`. When omitted, all merged
   * entries are returned.
   */
  filter?: (entry: LocalizedEntry<TEntry>) => boolean;
  deps: ResolveLocalizedCollectionDeps<TEntry>;
}

/**
 * Two branches:
 *   1. Default-locale (or missing / matching) request → source list
 *      tagged with `defaultLocale`, filter applied normally.
 *   2. Cross-locale → parallel sibling+source fetch, merge per
 *      sibling-hit / fallback / no-translate policy, filter applied
 *      to the merged list.
 *
 * The filter argument receives the extended shape so it can
 * optionally branch on translation status; the existing
 * `({ data }) => ...` idiom is unaffected.
 *
 * Sibling-collection naming (`__` separator) matches
 * `resolveLocalizedEntry`'s convention. The two run in different
 * module graphs (content config vs. page render); a shared constant
 * isn't workable.
 *
 * `Promise.all` parallelism on the cross-locale path matters at
 * scale: building 80 publications × 2 locales × 2 lookups would
 * serialize into 320 awaits without it; the parallel form halves
 * the wall-clock cost when Astro's content layer caches are cold.
 */
export async function resolveLocalizedCollection<TEntry extends SourceEntryShape>(
  input: ResolveLocalizedCollectionInput<TEntry>,
): Promise<LocalizedEntry<TEntry>[]> {
  const { collection, locale, filter, deps } = input;

  if (locale === undefined || locale === "" || locale === deps.defaultLocale) {
    const sources = await deps.getCollection(collection);
    const tagged = sources.map((entry) => withExtensions(entry, false, deps.defaultLocale));
    return filter ? tagged.filter(filter) : tagged;
  }

  const localizedCollection = `${collection}__${locale}`;
  const [siblings, sources] = await Promise.all([
    deps.getCollection(localizedCollection),
    deps.getCollection(collection),
  ]);

  // Index siblings by id so per-source lookups stay O(1).
  // Sibling entries carry the SAME `id` as their source — that's the
  // contract `polystellaCollections` enforces by writing translated
  // bytes to staging paths that mirror the source filename.
  const siblingsById = new Map<string, TEntry>();
  for (const sibling of siblings) {
    siblingsById.set(sibling.id, sibling);
  }

  const fallbackPolicy = deps.fallback ?? "default-locale";
  const noTranslatePolicy = deps.noTranslateBehavior ?? "fallback";

  const merged: LocalizedEntry<TEntry>[] = [];
  for (const source of sources) {
    const sibling = siblingsById.get(source.id);
    if (sibling !== undefined) {
      merged.push(withExtensions(sibling, true, locale));
      continue;
    }

    // Sibling miss — apply policy. The two policies match
    // `resolveLocalizedEntry`'s exactly so the per-entry and
    // per-collection helpers agree.
    const isNoTranslate = source.data?.noTranslate === true;
    if (isNoTranslate) {
      if (noTranslatePolicy === "404") continue;
      // "fallback" — keep source as default-locale entry.
      merged.push(withExtensions(source, false, deps.defaultLocale));
      continue;
    }
    if (fallbackPolicy === "skip") continue;
    // "default-locale" — keep source as default-locale entry.
    merged.push(withExtensions(source, false, deps.defaultLocale));
  }

  return filter ? merged.filter(filter) : merged;
}
