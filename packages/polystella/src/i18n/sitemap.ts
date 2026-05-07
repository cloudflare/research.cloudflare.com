/**
 * Build the i18n-driven options for `@astrojs/sitemap` from the same
 * Astro `i18n` block PolyStella reads.
 *
 * The default sitemap output for a multilingual site doesn't include
 * any cross-language linkage: each locale-prefixed URL appears as a
 * stand-alone entry. Search engines then treat the language variants
 * as duplicate content rather than alternates of one logical page,
 * which dilutes ranking signals and risks wrong-locale targeting.
 *
 * `astroSitemapI18n` produces two coordinated sitemap options:
 *
 *   - `i18n` — wires `@astrojs/sitemap`'s built-in alternates support,
 *     emitting `<xhtml:link rel="alternate" hreflang="…">` for every
 *     locale variant of a URL.
 *
 *   - `serialize` — appends a `hreflang="x-default"` annotation
 *     pointing at the default-locale URL of each group. This is a
 *     recommended SEO best practice (`x-default` tells search engines
 *     which URL to fall back to when no preferred-language match is
 *     available) and is enabled by default; pass `xDefault: false` to
 *     opt out.
 *
 * Drop the result directly into `sitemap()`:
 *
 *   sitemap(astroSitemapI18n(i18n, { hreflang: { en: "en-US" } }))
 *
 * Or compose with other sitemap options via spread:
 *
 *   sitemap({
 *     ...astroSitemapI18n(i18n, ...),
 *     filter: (page) => !page.includes("/draft/"),
 *   })
 *
 * Pure synchronous helper — no Astro hook integration, no I/O. Same
 * output regardless of how PolyStella resolves options later in
 * `astro:config:setup`.
 */

/**
 * Subset of Astro's `i18n` config shape that the helper needs. We
 * declare it locally rather than importing from `astro` so polystella
 * doesn't grow a runtime astro dependency just for a structural type.
 */
export interface AstroSitemapI18nInput {
  defaultLocale: string;
  /**
   * Astro accepts both string codes and `{ codes, path }` objects in
   * `i18n.locales`. Only the string form is supported here; the
   * object form (multi-code path groups, e.g. `{ codes: ['es-ES',
   * 'es-MX'], path: 'spanish' }`) requires fan-out logic that's
   * outside this helper's contract.
   */
  locales: ReadonlyArray<string | { codes: ReadonlyArray<string>; path: string }>;
}

export interface AstroSitemapI18nOptions {
  /**
   * Override the BCP 47 hreflang values emitted for specific locales.
   * Keys must be locale codes present in `i18n.locales`. Values are
   * the BCP 47 strings that appear in `<xhtml:link hreflang="…">`.
   *
   * Default is identity: the locale code itself (e.g., `pt-BR`) is
   * used as its own hreflang value. Override when the URL prefix you
   * want differs from the hreflang string (most commonly `en` URL →
   * `en-US` hreflang for region specificity).
   */
  hreflang?: Record<string, string>;
  /**
   * Emit a `<xhtml:link rel="alternate" hreflang="x-default">`
   * annotation pointing at the default-locale URL of each group.
   * Recommended SEO best practice. Default: `true`.
   *
   * Set to `false` if you'd rather rely on per-locale `Accept-Language`
   * matching alone, or if you're going to author your own `serialize`
   * callback that handles `x-default` differently.
   */
  xDefault?: boolean;
}

/**
 * Shape of an entry as `@astrojs/sitemap` passes it to the `serialize`
 * callback. We only access `links` (and pass everything else through
 * via spread), so this type intentionally lists ONLY the fields we
 * care about — `url` (required by sitemap, always present) and the
 * `links` alternates array. Other `SitemapItem` fields (`lastmod`,
 * `changefreq`, `priority`) flow through the spread untouched and
 * don't need to appear in our type.
 *
 * Subtle but load-bearing details:
 *
 *   - `links` must be a MUTABLE `Array`, not `ReadonlyArray`. Mutable
 *     arrays are subtypes of readonly arrays in TypeScript (you can
 *     read from them but also write); a function returning a
 *     readonly array can't stand in for one returning a mutable
 *     array, which is what `@astrojs/sitemap`'s `serialize` signature
 *     declares.
 *
 *   - Each link must include the optional `hreflang?` field. The
 *     underlying `sitemap` package's `LinkItem` interface declares
 *     it even though `@astrojs/sitemap` itself never sets it.
 *     Omitting it from our element shape makes the array types
 *     incompatible at the boundary.
 *
 *   - We deliberately do NOT declare `lastmod`, `changefreq`,
 *     `priority`. Adding them would either force us to import the
 *     `EnumChangefreq` enum from `sitemap` (a hard dep we don't
 *     want) or use a wider type like `string` that's not assignable
 *     to the enum, breaking the structural compatibility. Leaving
 *     them off makes our type a structural SUBSET of `SitemapItem`,
 *     which TypeScript accepts: the missing optionals don't need to
 *     match anything.
 */
interface SitemapItemLike {
  url: string;
  links?: Array<{ url: string; lang: string; hreflang?: string }>;
}

/**
 * The piece of `@astrojs/sitemap`'s options object that this helper
 * produces. Intentionally shaped to be `...spread`-friendly so other
 * sitemap options (`filter`, `customPages`, `lastmod`, etc.) can sit
 * alongside without conflict.
 */
export interface AstroSitemapI18nOutput {
  i18n: { defaultLocale: string; locales: Record<string, string> };
  /**
   * Present when `xDefault` is enabled (the default). Injects an
   * `x-default` link into each item that has language alternates.
   * Items without alternates (utility pages, redirects with no
   * translation) pass through unchanged.
   */
  serialize?: (item: SitemapItemLike) => SitemapItemLike;
}

/**
 * Build i18n-driven options for `@astrojs/sitemap` from Astro's
 * `i18n` config.
 *
 * Validates that `defaultLocale` appears in `locales`, that locales
 * are non-empty and unique, and that any `hreflang` override key
 * matches a configured locale — all of which would silently produce
 * a malformed sitemap if accepted.
 */
export function astroSitemapI18n(input: AstroSitemapI18nInput, options: AstroSitemapI18nOptions = {}): AstroSitemapI18nOutput {
  // Astro permits string-or-object entries; we only handle strings.
  // Throwing on the object form is intentional — silently dropping or
  // flattening would produce incorrect hreflang output and the user
  // wouldn't know.
  const localeCodes: string[] = [];
  for (const entry of input.locales) {
    if (typeof entry === "string") {
      localeCodes.push(entry);
    } else {
      throw new Error(
        `[polystella] astroSitemapI18n only supports string-form Astro locales. Got object form: ${JSON.stringify(
          entry,
        )}. For multi-code path groups, configure @astrojs/sitemap's i18n option manually.`,
      );
    }
  }

  if (localeCodes.length === 0) {
    throw new Error("[polystella] astroSitemapI18n requires at least one locale in i18n.locales.");
  }

  // Detect duplicates explicitly. The output `locales` object would
  // dedupe silently if we didn't, hiding a real config bug.
  const seen = new Set<string>();
  for (const code of localeCodes) {
    if (seen.has(code)) {
      throw new Error(`[polystella] astroSitemapI18n: duplicate locale "${code}" in i18n.locales.`);
    }
    seen.add(code);
  }

  if (!seen.has(input.defaultLocale)) {
    throw new Error(
      `[polystella] astroSitemapI18n: defaultLocale "${input.defaultLocale}" is not present in i18n.locales (got: ${localeCodes.join(", ")}).`,
    );
  }

  const overrides = options.hreflang ?? {};
  for (const key of Object.keys(overrides)) {
    if (!seen.has(key)) {
      throw new Error(
        `[polystella] astroSitemapI18n: hreflang override "${key}" is not a configured locale (got: ${localeCodes.join(", ")}).`,
      );
    }
  }

  // Build the locales map. Iterating over `localeCodes` (rather than
  // `Object.entries(overrides)`) preserves the user's authored order
  // — which @astrojs/sitemap doesn't care about, but produces stable
  // diffable output if the result is ever serialized.
  const locales: Record<string, string> = {};
  for (const code of localeCodes) {
    locales[code] = overrides[code] ?? code;
  }

  const i18n = { defaultLocale: input.defaultLocale, locales };
  const xDefault = options.xDefault ?? true;
  if (!xDefault) {
    return { i18n };
  }

  // Capture the default-locale's hreflang (BCP 47 form, after any
  // override) so the serialize callback can identify which existing
  // link to clone as `x-default` without re-running validation.
  const defaultHreflang = locales[input.defaultLocale]!;

  return {
    i18n,
    serialize(item) {
      // Items without alternates predate any i18n grouping decision —
      // typically standalone pages with no translation. Leave them
      // alone; injecting an x-default with no peers would be a
      // dangling annotation.
      if (!item.links || item.links.length === 0) return item;

      // The default-locale link always exists inside the alternates
      // group when generated by @astrojs/sitemap from a valid i18n
      // config. Defensive guard regardless: if a future sitemap
      // version skips it, return the item unchanged rather than
      // emitting a corrupt x-default with the wrong target URL.
      const defaultLink = item.links.find((l) => l.lang === defaultHreflang);
      if (!defaultLink) return item;

      return {
        ...item,
        links: [...item.links, { url: defaultLink.url, lang: "x-default" }],
      };
    },
  };
}
