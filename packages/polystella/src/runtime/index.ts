import { getEntry, type CollectionEntry } from "astro:content";
import {
  defaultLocale,
  fallback,
  locales,
  noTranslateBehavior,
} from "polystella:runtime-config";

import {
  normaliseGetLocalizedEntryArgs,
  resolveLocalizedEntry,
  type CollectionEntryRef,
  type LocalizedEntry,
  type SourceEntryShape,
} from "./get-localized-entry.js";
import {
  resolveLocalizedHref,
  type LocalizedHrefDeps,
} from "./localized-href.js";

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
      getEntry: (c, s) =>
        (getEntry as (c: string, s: string) => Promise<unknown>)(
          c,
          s,
        ) as Promise<SourceEntryShape | undefined>,
    },
  });
  return result as LocalizedEntry<CollectionEntry<C>> | undefined;
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
  });
}

export {
  normaliseGetLocalizedEntryArgs,
  type CollectionEntryRef,
  type LocalizedEntry,
} from "./get-localized-entry.js";
export {
  resolveLocalizedHref,
  type LocalizedHrefDeps,
} from "./localized-href.js";

