/**
 * Locale-aware content lookup. Dispatcher only.
 *
 * `polystellaCollections` (in `polystella/content`) registers a
 * sibling collection per `(collection, locale)` pair, named
 * `<collection>__<locale>`. This helper picks the sibling matching
 * the requested locale, or falls back to the source collection per
 * the configured policy. Translated entries flow through Astro's
 * content layer like any other — schema validation, MDX compilation,
 * `entry.rendered.html`, and `reference()` resolution all work.
 */

/**
 * Reference shape for the cross-collection lookup form. Mirrors what
 * Astro surfaces for `reference()` fields and `getEntry`'s ref overload.
 */
export interface CollectionEntryRef {
  collection: string;
  id: string;
}

/**
 * Flatten the two `getLocalizedEntry` overloads into a uniform shape:
 *   - String first arg → `(collection, id, locale)` tuple.
 *   - Object first arg → `(ref, locale)`; second arg is the locale.
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
 * Minimum entry shape the dispatcher reads. Production Astro entries
 * have additional fields (`filePath`, `digest`, `rendered`, `body`)
 * which survive the {...source} spread.
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
  /** Defaults to `"default-locale"` when absent. */
  fallback?: LocalizedFallbackPolicy;
  /** Defaults to `"fallback"` when absent. */
  noTranslateBehavior?: NoTranslatePolicy;
  /**
   * Astro's `getEntry` (or a test stub). Called twice on cross-locale
   * lookups: sibling first, source on miss. `undefined` is the
   * standard "entry not found" sentinel.
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
 * Three branches:
 *   1. Default-locale (or missing) request → source entry directly.
 *   2. Cross-locale hit → sibling entry, already schema-validated
 *      and MDX-compiled through Astro's normal pipeline.
 *   3. Cross-locale miss → policy-dependent fallback (see below).
 *
 * On miss, two policies apply in priority order:
 *   - `noTranslateBehavior` wins when the source has
 *     `noTranslate: true` (per-entry operator intent).
 *   - `fallback` covers the generic untranslated case.
 *
 * Source is fetched on miss to inspect the `noTranslate` flag.
 * Optimisation: when both policies converge on `undefined`
 * (`skip` + `404`), short-circuit before the source lookup.
 *
 * Fallback paths return entries tagged with `defaultLocale`, not the
 * requested locale — the entry IS in the default locale; tagging it
 * with the requested locale would mislead consumer code reading
 * `entry.locale`.
 *
 * The sibling-collection naming (`__` separator) is bound by
 * convention with `polystellaCollections`'s registration — the two
 * run in different module graphs (content config vs. page render),
 * so a shared constant isn't workable.
 */
export async function resolveLocalizedEntry(
  input: ResolveLocalizedEntryInput,
): Promise<LocalizedEntry | undefined> {
  const { collection, slug, locale, deps } = input;

  if (locale === undefined || locale === "" || locale === deps.defaultLocale) {
    const source = await deps.getEntry(collection, slug);
    if (source === undefined) return undefined;
    return withExtensions(source, false, deps.defaultLocale);
  }

  const localizedCollection = `${collection}__${locale}`;
  const localized = await deps.getEntry(localizedCollection, slug);
  if (localized !== undefined) {
    return withExtensions(localized, true, locale);
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

/** Fresh shallow copy + extension fields; doesn't mutate the input. */
function withExtensions(
  entry: SourceEntryShape,
  isLocalized: boolean,
  locale: string,
): LocalizedEntry {
  return { ...entry, isLocalized, locale };
}
