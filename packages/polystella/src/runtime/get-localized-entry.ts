/**
 * Build-time runtime helper for locale-aware content lookup.
 *
 * Pages built into the locale-prefixed routes use this helper instead
 * of `getEntry` to fetch translated content. The helper is dispatch-
 * only: at config-setup time, the `polystellaCollections` content-
 * config helper (in `polystella/content`) registers a sibling
 * collection per `(collection, locale)` pair, named
 * `<collection>__<locale>`. At page-render time this helper picks the
 * sibling matching the requested locale, or falls back to the source
 * collection on miss.
 *
 * No staged-file probes, no frontmatter overlay, no manual
 * rendering. Translated entries flow through Astro's content layer
 * just like source entries — schema validation runs on translations,
 * `entry.rendered.html` populates from the normal compile pipeline,
 * MDX components resolve through Vite, and references follow
 * natively. The earlier overlay model (sidecar HTML, render cache,
 * frontmatter merge) is retired.
 */

/**
 * Reference shape for the cross-collection lookup form. Mirrors the
 * shape Astro's content layer surfaces for `reference()` schema
 * fields and for `getEntry`'s reference overload.
 */
export interface CollectionEntryRef {
  collection: string;
  id: string;
}

/**
 * Disambiguate the two `getLocalizedEntry` overloads into a flat
 * `{ collection, id, locale }` shape:
 *
 *   - First arg is a string → tuple form: `(collection, id, locale)`.
 *   - First arg is an object → ref form: `(ref, locale)`. The second
 *     positional arg is the locale, NOT the id (the id lives on
 *     the ref). A third positional arg is silently ignored in this
 *     branch — there's no meaningful interpretation for it.
 *
 * Lives in the pure module (rather than next to the public wrapper)
 * so tests can pin its behaviour without pulling in `astro:content`
 * or the runtime-config virtual module.
 */
export function normaliseGetLocalizedEntryArgs(
  collectionOrRef: string | CollectionEntryRef,
  idOrLocale: string | undefined,
  maybeLocale: string | undefined,
): { collection: string; id: string; locale: string | undefined } {
  if (typeof collectionOrRef === "string") {
    if (typeof idOrLocale !== "string") {
      throw new TypeError(
        "[polystella] getLocalizedEntry(collection, id, locale?): `id` is required when the first argument is a string.",
      );
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
 * Minimum fields the runtime needs to read off whatever Astro's
 * `getEntry` returned. Kept structural so tests can pass tiny inline
 * fixtures without simulating Astro's full entry shape; production
 * Astro entries match this shape (with extra fields like `filePath`,
 * `digest`, `rendered`, `body` flowing through the spread).
 */
export interface SourceEntryShape {
  collection: string;
  id: string;
  data: Record<string, unknown>;
  body?: string;
}

/**
 * The shape `getLocalizedEntry` returns: the underlying entry
 * (preserving every Astro-computed field — `filePath`, `digest`,
 * `rendered`, schema-validated refs, `body`) intersected with two
 * PolyStella extension fields.
 *
 *   - `isLocalized`: `true` when a translated sibling collection
 *     entry was found and returned; `false` when the helper fell
 *     back to source content (default-locale call, missing sibling
 *     entry).
 *   - `locale`: the locale this entry represents — the requested
 *     `locale` on a hit, or the default locale on any fallback path.
 *
 * The generic defaults to `SourceEntryShape` for tests; the public
 * wrapper substitutes Astro's `CollectionEntry<C>` so consumers get
 * full schema-aware inference (`data.authors` typed as the resolved
 * `reference("people")` array, etc.).
 */
export type LocalizedEntry<TEntry extends SourceEntryShape = SourceEntryShape> =
  TEntry & {
    isLocalized: boolean;
    locale: string;
  };

export interface ResolveLocalizedEntryDeps {
  /** Source/canonical locale, derived from Astro's `i18n.defaultLocale`. */
  defaultLocale: string;
  /**
   * Astro's `getEntry` (or a test stub). The dispatcher calls this
   * twice in the cross-locale path: once for the
   * `<collection>__<locale>` sibling, once for the source collection
   * on miss. Returning `undefined` is the standard "entry not found"
   * sentinel.
   */
  getEntry: (
    collection: string,
    slug: string,
  ) => Promise<SourceEntryShape | undefined>;
}

export interface ResolveLocalizedEntryInput {
  collection: string;
  slug: string;
  /** Visitor's locale; `undefined` means "the default locale". */
  locale: string | undefined;
  deps: ResolveLocalizedEntryDeps;
}

/**
 * Core dispatcher for `getLocalizedEntry`. Three branches:
 *
 *   1. `locale` is missing/blank/equal to `defaultLocale`: return the
 *      source-collection entry with `isLocalized: false` and
 *      `locale: defaultLocale`. Returns `undefined` if the source
 *      entry doesn't exist (matches `getEntry`'s contract exactly).
 *   2. Cross-locale lookup: try
 *      `getEntry("<collection>__<locale>", slug)`. On hit, return it
 *      with `isLocalized: true` and `locale`.
 *   3. Cross-locale miss: fall back to the source collection with
 *      `isLocalized: false` and `locale: defaultLocale`. The
 *      consumer can branch on `isLocalized` to surface a "translation
 *      pending" treatment.
 *
 * The sibling-collection naming convention (`__` separator) must
 * match `polystellaCollections`'s registration; the two are bound by
 * convention rather than a shared constant because the helper runs
 * inside the user's content config (which has its own module graph)
 * and the runtime runs on the page (different module graph).
 */
export async function resolveLocalizedEntry(
  input: ResolveLocalizedEntryInput,
): Promise<LocalizedEntry | undefined> {
  const { collection, slug, locale, deps } = input;

  // Branch 1: default-locale (or missing-locale) path. No sibling
  // lookup needed; fetch source and return.
  if (
    locale === undefined ||
    locale === "" ||
    locale === deps.defaultLocale
  ) {
    const source = await deps.getEntry(collection, slug);
    if (source === undefined) return undefined;
    return withExtensions(source, false, deps.defaultLocale);
  }

  // Branch 2: cross-locale lookup against the
  // `<collection>__<locale>` sibling collection. On hit, the
  // returned entry is already schema-validated and (for MDX/MD)
  // already rendered through Astro's normal pipeline — no overlay
  // logic needed.
  const localizedCollection = `${collection}__${locale}`;
  const localized = await deps.getEntry(localizedCollection, slug);
  if (localized !== undefined) {
    return withExtensions(localized, true, locale);
  }

  // Branch 3: sibling miss. Fall back to source with
  // `isLocalized: false` so a consumer page can render a "translation
  // pending" affordance if it wants. We deliberately do NOT use the
  // requested `locale` here — the entry being returned is in the
  // default locale, and tagging it with the requested locale would
  // mislead consumer code reading `entry.locale`.
  const source = await deps.getEntry(collection, slug);
  if (source === undefined) return undefined;
  return withExtensions(source, false, deps.defaultLocale);
}

/**
 * Attach the PolyStella extension fields to an entry without
 * mutating it. The returned object is a fresh shallow copy, so the
 * caller can safely add other fields without aliasing the input.
 */
function withExtensions(
  entry: SourceEntryShape,
  isLocalized: boolean,
  locale: string,
): LocalizedEntry {
  return { ...entry, isLocalized, locale };
}
