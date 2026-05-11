/**
 * Locale-aware content lookup dispatcher.
 * `polystellaCollections` registers `<collection>__<locale>` siblings;
 * this helper picks the right one or falls back per policy.
 * Translated entries flow through Astro's content layer normally —
 * schema validation, MDX, `rendered.html`, `reference()` all work.
 */

/** Cross-collection ref shape — mirrors Astro's `reference()`/`getEntry` ref. */
export interface CollectionEntryRef {
  collection: string;
  id: string;
}

/**
 * Flatten overloads:
 *   - String first arg → `(collection, id, locale)` tuple.
 *   - Object first arg → `(ref, locale)`.
 */
export function normaliseGetLocalizedEntryArgs(
  collectionOrRef: string | CollectionEntryRef,
  idOrLocale: string | undefined,
  maybeLocale: string | undefined,
): { collection: string; id: string; locale: string | undefined } {
  if (typeof collectionOrRef === "string") {
    if (typeof idOrLocale !== "string") {
      throw new TypeError("[polystella] getLocalizedEntry(collection, id, locale?): `id` is required when the first argument is a string.");
    }
    return {
      collection: collectionOrRef,
      id: idOrLocale,
      locale: maybeLocale,
    };
  }
  return {
    collection: collectionOrRef.collection,
    id: collectionOrRef.id,
    locale: idOrLocale,
  };
}

/**
 * Minimum entry shape the dispatcher reads. Astro's additional
 * fields (`filePath`, `digest`, `rendered`, `body`) survive {...spread}.
 */
export interface SourceEntryShape {
  collection: string;
  id: string;
  data: Record<string, unknown>;
  body?: string;
}

/**
 * Return shape: underlying entry (preserving every Astro-computed
 * field) plus:
 *   - `isLocalized`: true on sibling hit; false on source fallback.
 *   - `locale`: requested locale on hit, default locale on fallback.
 *
 * Generic defaults to `SourceEntryShape` for tests; public wrapper
 * substitutes Astro's `CollectionEntry<C>` for schema-aware inference.
 */
export type LocalizedEntry<TEntry extends SourceEntryShape = SourceEntryShape> = TEntry & {
  isLocalized: boolean;
  locale: string;
};

/**
 * Sibling-miss policy for sources WITHOUT `noTranslate: true`.
 *   - `"default-locale"`: return source with `isLocalized: false`.
 *   - `"skip"`: return `undefined` so Astro 404s the route.
 */
export type LocalizedFallbackPolicy = "default-locale" | "skip";

/**
 * Sibling-miss policy for sources WITH `noTranslate: true`. Takes
 * precedence over `LocalizedFallbackPolicy` when the flag is set —
 * per-entry operator intent overrides the generic policy.
 *   - `"fallback"`: return source with `isLocalized: false`.
 *   - `"404"`: return `undefined`.
 */
export type NoTranslatePolicy = "fallback" | "404";

export interface ResolveLocalizedEntryDeps {
  /** From Astro's `i18n.defaultLocale`. */
  defaultLocale: string;
  /** Defaults to `"default-locale"`. */
  fallback?: LocalizedFallbackPolicy;
  /** Defaults to `"fallback"`. */
  noTranslateBehavior?: NoTranslatePolicy;
  /** Astro's `getEntry` (or test stub). Called sibling-then-source on miss. */
  getEntry: (collection: string, slug: string) => Promise<SourceEntryShape | undefined>;
}

export interface ResolveLocalizedEntryInput {
  collection: string;
  slug: string;
  /** Visitor's locale; `undefined` means "the default locale". */
  locale: string | undefined;
  deps: ResolveLocalizedEntryDeps;
}

/**
 * Three branches:
 *   1. Default-locale → source entry directly.
 *   2. Cross-locale hit → sibling (schema-validated, MDX-compiled).
 *   3. Cross-locale miss → policy fallback. `noTranslateBehavior`
 *      wins when source has `noTranslate: true`; `fallback` covers
 *      generic untranslated case. Both → `undefined` short-circuits
 *      the source lookup.
 *
 * Fallback entries are tagged with `defaultLocale` (the entry IS
 * in the default locale; tagging with requested locale would mislead).
 * Sibling naming `__` is the convention bound to `polystellaCollections`.
 */
export async function resolveLocalizedEntry(input: ResolveLocalizedEntryInput): Promise<LocalizedEntry | undefined> {
  const { collection, slug, locale, deps } = input;

  if (locale === undefined || locale === "" || locale === deps.defaultLocale) {
    const source = await deps.getEntry(collection, slug);
    if (source === undefined) return undefined;
    return withExtensions(source, false, deps.defaultLocale);
  }

  const localizedCollection = `${collection}__${locale}`;
  const localized = await deps.getEntry(localizedCollection, slug);
  if (localized !== undefined) {
    // Normalise `collection` back to the source name — sibling is
    // a polystella internal; consumer code branching on
    // `entry.collection === "blog"` shouldn't care.
    return withExtensions({ ...localized, collection } as SourceEntryShape, true, locale);
  }

  const fallbackPolicy = deps.fallback ?? "default-locale";
  const noTranslatePolicy = deps.noTranslateBehavior ?? "fallback";
  if (fallbackPolicy === "skip" && noTranslatePolicy === "404") {
    return undefined;
  }
  const source = await deps.getEntry(collection, slug);
  if (source === undefined) return undefined;
  const isNoTranslate = source.data?.noTranslate === true;
  if (isNoTranslate) {
    if (noTranslatePolicy === "404") return undefined;
    return withExtensions(source, false, deps.defaultLocale);
  }
  if (fallbackPolicy === "skip") return undefined;
  return withExtensions(source, false, deps.defaultLocale);
}

/**
 * Fresh shallow copy + extension fields. Exported so
 * `resolveLocalizedCollection` produces the same shape — keeps the
 * `LocalizedEntry` contract canonical.
 */
export function withExtensions<TEntry extends SourceEntryShape>(
  entry: TEntry,
  isLocalized: boolean,
  locale: string,
): LocalizedEntry<TEntry> {
  return { ...entry, isLocalized, locale };
}
