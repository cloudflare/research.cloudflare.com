/**
 * Locale-aware collection dispatcher. Per-entry sibling-vs-source
 * resolution mirrors `resolveLocalizedEntry`, applied across the
 * whole collection then filtered.
 *
 * Branches:
 *   1. Default locale → `getCollection(name)`, tagged
 *      `{ isLocalized: false, locale: defaultLocale }`.
 *   2. Cross-locale → parallel `Promise.all` fetch of source +
 *      `${name}__${locale}` siblings, merged per
 *      hit / fallback / noTranslate policy.
 *
 * Filter sees the merged `LocalizedEntry<TEntry>` so it can branch
 * on `isLocalized` / `locale`. Existing `({ data }) => ...` filters
 * keep working (data field is preserved verbatim).
 */

import type { LocalizedEntry, LocalizedFallbackPolicy, NoTranslatePolicy, SourceEntryShape } from "./get-localized-entry.js";
import { withExtensions } from "./get-localized-entry.js";

export interface ResolveLocalizedCollectionDeps<TEntry extends SourceEntryShape = SourceEntryShape> {
  /** From Astro's `i18n.defaultLocale`. */
  defaultLocale: string;
  /** Defaults to `"default-locale"`. */
  fallback?: LocalizedFallbackPolicy;
  /** Defaults to `"fallback"`. */
  noTranslateBehavior?: NoTranslatePolicy;
  /** Astro's `getCollection` (or test stub). */
  getCollection: (collection: string) => Promise<TEntry[]>;
}

export interface ResolveLocalizedCollectionInput<TEntry extends SourceEntryShape = SourceEntryShape> {
  collection: string;
  /** Visitor's locale; `undefined` means "the default locale". */
  locale: string | undefined;
  /**
   * Filter applied to merged-and-tagged entries. Return type is
   * `unknown` to match Astro's `getCollection` convention — callers
   * can use optional-chain expressions without coercing to boolean.
   */
  filter?: (entry: LocalizedEntry<TEntry>) => unknown;
  deps: ResolveLocalizedCollectionDeps<TEntry>;
}

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
  const [siblings, sources] = await Promise.all([deps.getCollection(localizedCollection), deps.getCollection(collection)]);

  // O(1) per-source lookups. Siblings carry the same `id` as their
  // source (enforced by mirroring staging paths in `polystellaCollections`).
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
      // Normalise `collection` to the source name so downstream code
      // branching on `entry.collection` doesn't have to special-case siblings.
      const normalized = { ...sibling, collection: source.collection } as TEntry;
      merged.push(withExtensions(normalized, true, locale));
      continue;
    }

    // Sibling miss — apply policy. Matches `resolveLocalizedEntry`.
    const isNoTranslate = source.data?.noTranslate === true;
    if (isNoTranslate) {
      if (noTranslatePolicy === "404") continue;
      merged.push(withExtensions(source, false, deps.defaultLocale));
      continue;
    }
    if (fallbackPolicy === "skip") continue;
    merged.push(withExtensions(source, false, deps.defaultLocale));
  }

  return filter ? merged.filter(filter) : merged;
}
