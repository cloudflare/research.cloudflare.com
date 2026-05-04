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

/**
 * What to do when a cross-locale lookup misses (no
 * `<collection>__<locale>` sibling entry for `slug`) AND the source
 * isn't flagged with `noTranslate: true`.
 *
 * - `"default-locale"` (default): return the source-collection
 *   entry with `isLocalized: false`. Page renders source content
 *   under the locale-prefixed URL — the typical "untranslated yet"
 *   experience.
 * - `"skip"`: return `undefined`. Astro produces a 404 for the
 *   slug at that locale. Use when you'd rather not surface an
 *   untranslated page at all than serve source content under a
 *   non-default URL.
 */
export type LocalizedFallbackPolicy = "default-locale" | "skip";

/**
 * What to do when a cross-locale lookup hits the source's
 * `noTranslate: true` flag (set in the source's frontmatter to opt
 * out of translation entirely, regardless of glossary or model).
 *
 * - `"fallback"` (default): return the source entry with
 *   `isLocalized: false`. The page renders the source language under
 *   the locale URL — useful when the source itself is intended to be
 *   universally readable (an English-only paper at a multilingual
 *   conference, a code reference, etc.).
 * - `"404"`: return `undefined`. The page should treat that as a
 *   404; consumers typically already do for invalid slugs. Pages
 *   that explicitly want a 404 status can `return new Response(null,
 *   { status: 404 })` when `getLocalizedEntry` returns `undefined`.
 *
 * Distinct from `LocalizedFallbackPolicy`: `fallback` covers the
 * generic "translation hasn't been generated yet" case, while
 * `noTranslateBehavior` covers the explicit opt-out. An operator can
 * configure them independently (e.g. `fallback: "default-locale"`
 * for general untranslated content, `noTranslateBehavior: "404"` for
 * pages explicitly marked).
 */
export type NoTranslatePolicy = "fallback" | "404";

export interface ResolveLocalizedEntryDeps {
  /** Source/canonical locale, derived from Astro's `i18n.defaultLocale`. */
  defaultLocale: string;
  /**
   * Behaviour on cross-locale miss for sources WITHOUT
   * `noTranslate: true`. Threaded through from the integration's
   * resolved options via the `polystella:runtime-config` virtual
   * module. Optional in the dep struct (tests pass plain objects);
   * the resolver defaults to `"default-locale"` when absent.
   */
  fallback?: LocalizedFallbackPolicy;
  /**
   * Behaviour on cross-locale miss for sources WITH
   * `noTranslate: true`. Threaded through the same virtual module.
   * Defaults to `"fallback"` when absent. Takes precedence over
   * `fallback` when the source's frontmatter has the flag — operator
   * intent explicit at the entry level overrides the generic policy.
   */
  noTranslateBehavior?: NoTranslatePolicy;
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

  // Branch 3: sibling miss. Two policies steer the outcome, in
  // priority order:
  //
  //   1. `noTranslateBehavior` — applies when the source frontmatter
  //      has `noTranslate: true`. Operator intent at the entry level
  //      takes precedence over the generic `fallback` policy.
  //         - `"fallback"` (default): return source with
  //           `isLocalized: false`.
  //         - `"404"`: return `undefined`.
  //      To check the flag we have to read the source entry first.
  //      That's a single extra `getEntry` call; we'd be calling it
  //      anyway for the `"default-locale"` branch.
  //   2. `fallback` — applies when the source is NOT `noTranslate`.
  //         - `"default-locale"` (default): return source with
  //           `isLocalized: false`.
  //         - `"skip"`: return `undefined`.
  //
  // Optimization: when both policies converge on `undefined` (skip +
  // 404), the source-flag value is irrelevant — there's no path to a
  // non-undefined return. Short-circuit before the second `getEntry`
  // call so callers configured this way pay just the sibling lookup.
  // For any other combination we need the source to know which policy
  // applies, so the source lookup is unavoidable.
  //
  // The default-locale branch is deliberately tagged with
  // `defaultLocale` on the returned entry rather than the requested
  // locale: the entry being returned is in the default locale, and
  // tagging it with the requested locale would mislead consumer code
  // that branches on `entry.locale`.
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
