import { getEntry, type CollectionEntry } from "astro:content";
import { defaultLocale } from "polystella:runtime-config";

import {
  normaliseGetLocalizedEntryArgs,
  resolveLocalizedEntry,
  type CollectionEntryRef,
  type LocalizedEntry,
  type SourceEntryShape,
} from "./get-localized-entry.js";

/**
 * Public locale-aware content fetcher.
 *
 * Drop-in companion to Astro's `getEntry` for pages mounted under a
 * locale-prefixed route by PolyStella's shim layer. Two call shapes
 * mirror Astro's own overloads:
 *
 *   - `getLocalizedEntry({ collection, id }, locale?)`
 *   - `getLocalizedEntry(collection, id, locale?)`
 *
 * Resolution model:
 *
 *   - `locale === undefined` / blank / equal to `defaultLocale`:
 *     return the source-collection entry verbatim plus
 *     `isLocalized: false` and `locale: defaultLocale`.
 *   - Otherwise: dispatch to the per-locale sibling collection
 *     `<collection>__<locale>` (registered by `polystellaCollections`
 *     in the user's `content.config.ts`). On hit, return the sibling
 *     entry with `isLocalized: true`. On miss, fall back to the
 *     source collection with `isLocalized: false`.
 *
 * Translated entries flow through Astro's content layer the same way
 * source entries do — schema validation runs on translations,
 * `entry.rendered.html` populates from the normal compile pipeline,
 * MDX components resolve through Vite. The runtime helper is
 * dispatch-only; it never reads files or merges values itself.
 *
 * Returns `undefined` when neither the sibling nor the source entry
 * exists — matching `getEntry`'s contract exactly so the helper is a
 * true drop-in. Consumer filters typed
 * `(e): e is NonNullable<typeof e> => e !== undefined` work without
 * modification.
 */
// Collection-aware overloads: when the caller pins a collection name
// `C`, the entry shape resolves to `CollectionEntry<C>` (with the
// PolyStella extension fields intersected on top). In a consumer
// project that has run `astro sync`, this carries the real per-
// collection schema, so `entry.data.authors.map(...)` gets full
// inference and `entry.body` / `entry.rendered` are visible.
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
      // Astro's `CollectionEntry` has more fields than the pure
      // helper's `SourceEntryShape` declares (`filePath`, `digest`,
      // `rendered`, …) — they survive the {...source} spread inside
      // the helper, so the cast at the dep boundary is structural
      // and lossless. The first arg is widened to `string` because
      // the dispatcher synthesises `<collection>__<locale>`
      // collection names that aren't statically known to Astro's
      // generic `getEntry`.
      getEntry: (c, s) =>
        (getEntry as (c: string, s: string) => Promise<unknown>)(
          c,
          s,
        ) as Promise<SourceEntryShape | undefined>,
    },
  });
  // The pure helper returns LocalizedEntry against its structural
  // SourceEntryShape; downcast to the consumer-pinned
  // CollectionEntry<C> shape so callers see the real schema.
  return result as LocalizedEntry<CollectionEntry<C>> | undefined;
}

export {
  normaliseGetLocalizedEntryArgs,
  type CollectionEntryRef,
  type LocalizedEntry,
} from "./get-localized-entry.js";
