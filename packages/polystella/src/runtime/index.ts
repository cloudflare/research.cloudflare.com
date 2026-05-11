/// <reference path="./locals.d.ts" />
import { getCollection, getEntry, type CollectionEntry } from "astro:content";
import { defaultLocale, fallback, locales, noPrefixUrls, noTranslateBehavior } from "polystella:runtime-config";

import { resolveLocalizedCollection } from "./get-localized-collection.js";
import {
  normaliseGetLocalizedEntryArgs,
  resolveLocalizedEntry,
  type CollectionEntryRef,
  type LocalizedEntry,
  type SourceEntryShape,
} from "./get-localized-entry.js";
import { resolveLocalizedHref, type LocalizedHrefDeps } from "./localized-href.js";

/**
 * Locale-aware content fetcher; drop-in for Astro's `getEntry`.
 *
 *   - `getLocalizedEntry({ collection, id }, locale?)`
 *   - `getLocalizedEntry(collection, id, locale?)`
 *
 * Default-locale (or undefined/blank) calls return source verbatim
 * with `isLocalized: false`. Cross-locale calls hit the
 * `<collection>__<locale>` sibling registered by
 * `polystellaCollections`; on miss, behaviour follows the configured
 * `fallback` and `noTranslateBehavior` policies. Returns `undefined`
 * when neither sibling nor source exists, matching `getEntry`'s
 * contract.
 *
 * The collection-pinned generic `C` resolves the entry shape to
 * `CollectionEntry<C>` so consumers (after `astro sync`) get full
 * schema-aware inference on `entry.data.*`.
 */
export function getLocalizedEntry<C extends string>(
  ref: { collection: C; id: string },
  locale?: string,
): Promise<LocalizedEntry<CollectionEntry<C>> | undefined>;
export function getLocalizedEntry<C extends string>(
  collection: C,
  id: string,
  locale?: string,
): Promise<LocalizedEntry<CollectionEntry<C>> | undefined>;
export async function getLocalizedEntry<C extends string>(
  collectionOrRef: C | { collection: C; id: string },
  idOrLocale?: string,
  maybeLocale?: string,
): Promise<LocalizedEntry<CollectionEntry<C>> | undefined> {
  const { collection, id, locale } = normaliseGetLocalizedEntryArgs(
    collectionOrRef as string | CollectionEntryRef,
    idOrLocale,
    maybeLocale,
  );

  const result = await resolveLocalizedEntry({
    collection,
    slug: id,
    locale,
    deps: {
      defaultLocale,
      fallback,
      noTranslateBehavior,
      // First arg widened to `string` because the dispatcher
      // synthesises `<collection>__<locale>` names not statically
      // known to Astro's generic `getEntry`. The structural cast is
      // lossless: extra `CollectionEntry` fields survive the
      // `{...source}` spread inside the dispatcher.
      getEntry: (c, s) => (getEntry as (c: string, s: string) => Promise<unknown>)(c, s) as Promise<SourceEntryShape | undefined>,
    },
  });
  return result as LocalizedEntry<CollectionEntry<C>> | undefined;
}

/**
 * Locale-aware collection fetcher; drop-in for Astro's `getCollection`
 * (with locale tacked onto the tail).
 *
 *   - `getLocalizedCollection(collection)`               — default locale, no filter
 *   - `getLocalizedCollection(collection, filter)`       — default locale, with filter
 *   - `getLocalizedCollection(collection, filter, locale)` — explicit locale
 *   - `getLocalizedCollection(collection, undefined, locale)` — locale, no filter
 *
 * Default-locale (or undefined / blank / matching) calls return the
 * full source list verbatim, each entry tagged
 * `{ isLocalized: false, locale: defaultLocale }`. Cross-locale calls
 * fetch the source AND the `<collection>__<locale>` sibling in
 * parallel, then merge per the configured `fallback` /
 * `noTranslateBehavior` policies — same dispatch logic as
 * `getLocalizedEntry`, applied entry-by-entry. The user's filter (if
 * any) runs on the merged-and-tagged list.
 *
 * Filter argument receives the full `LocalizedEntry<CollectionEntry<C>>`
 * shape so it can branch on `entry.isLocalized` / `entry.locale` if it
 * wants to (e.g. `(e) => e.isLocalized` to hide untranslated entries).
 * Existing `({ data }) => ...` filters work unchanged because
 * `LocalizedEntry` is `CollectionEntry<C> & {isLocalized; locale}`.
 *
 * The collection-pinned generic `C` resolves the entry shape to
 * `CollectionEntry<C>` so consumers (after `astro sync`) get full
 * schema-aware inference on `entry.data.*`.
 *
 * For locale-bound usage in `.astro` templates, prefer the
 * pre-bound `Astro.locals.getLocalizedCollection` — it closes over
 * the request's locale automatically, matching the `lhref` / `t`
 * pattern.
 */
export async function getLocalizedCollection<C extends string>(
  collection: C,
  // `unknown` return matches Astro's `getCollection` filter shape, so
  // callers can write `(pub) => pub.data.authors?.some(...)` without
  // coercing the optional-chain return. `Array.prototype.filter`
  // truthiness-checks the result.
  filter?: (entry: LocalizedEntry<CollectionEntry<C>>) => unknown,
  locale?: string,
): Promise<LocalizedEntry<CollectionEntry<C>>[]> {
  const result = await resolveLocalizedCollection({
    collection,
    locale,
    // Filter is widened from `LocalizedEntry<CollectionEntry<C>>` to
    // `LocalizedEntry<SourceEntryShape>` for the pure-core call;
    // structurally lossless because `CollectionEntry<C>` extends
    // `SourceEntryShape` (both have `collection`/`id`/`data`).
    filter: filter as ((entry: LocalizedEntry<SourceEntryShape>) => unknown) | undefined,
    deps: {
      defaultLocale,
      fallback,
      noTranslateBehavior,
      // First arg widened to `string` because the dispatcher
      // synthesises `<collection>__<locale>` names not statically
      // known to Astro's generic `getCollection`. The structural
      // cast is lossless: `CollectionEntry<C>` always has
      // `{collection, id, data}` plus extras that survive the
      // `{...source}` spread inside the dispatcher.
      getCollection: (c) =>
        (getCollection as (c: string) => Promise<unknown[]>)(c) as Promise<SourceEntryShape[]>,
    },
  });
  return result as LocalizedEntry<CollectionEntry<C>>[];
}

/**
 * Locale-aware URL prefixer for component-level links. Mirrors the
 * URL classification rules of the build-time markdown link rewriter
 * so component links and inlined-body links stay consistent.
 *
 *   <a href={localizedHref("/Smith2017", Astro.currentLocale)}>
 *
 * Returns the input unchanged for external URLs, anchor-only hrefs,
 * already-prefixed paths, missing/default locales. Otherwise returns
 * `/{locale}/{path}{?suffix}{#fragment}`.
 *
 * The pure `resolveLocalizedHref` is also exported for non-Astro
 * environments.
 */
export function localizedHref(href: string, locale?: string): string {
  return resolveLocalizedHref(href, locale, {
    defaultLocale,
    locales,
    ...(noPrefixUrls.length > 0 ? { noPrefixUrls } : {}),
  });
}

export { normaliseGetLocalizedEntryArgs, type CollectionEntryRef, type LocalizedEntry } from "./get-localized-entry.js";
export {
  resolveLocalizedCollection,
  type ResolveLocalizedCollectionDeps,
  type ResolveLocalizedCollectionInput,
} from "./get-localized-collection.js";
export { resolveLocalizedHref, type LocalizedHrefDeps } from "./localized-href.js";
export { polystellaMiddleware, buildLocalizedHref, type PolystellaMiddleware } from "./middleware.js";
