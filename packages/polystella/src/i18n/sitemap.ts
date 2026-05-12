/**
 * Build `@astrojs/sitemap` options from Astro's `i18n` block.
 *
 * Default sitemap output treats locale variants as duplicate
 * content. This helper emits `<xhtml:link rel="alternate" hreflang>`
 * cross-links via the `i18n` option, plus an `x-default` annotation
 * via `serialize` (disable with `xDefault: false`).
 *
 *   sitemap(astroSitemapI18n(i18n, { hreflang: { en: "en-US" } }))
 *
 * Pure synchronous helper — no hooks, no I/O.
 */

/** Subset of Astro's `i18n` shape the helper reads (declared locally to avoid a runtime astro dep). */
export interface AstroSitemapI18nInput {
  defaultLocale: string;
  /**
   * Only the string form is supported. Object form
   * (`{ codes, path }` multi-code groups) requires fan-out outside
   * this helper's contract.
   */
  locales: ReadonlyArray<string | { codes: ReadonlyArray<string>; path: string }>;
}

export interface AstroSitemapI18nOptions {
  /**
   * Override BCP 47 hreflang values per locale. Default: identity
   * (`pt-BR` URL → `pt-BR` hreflang). Override when URL prefix
   * differs from hreflang (e.g. `en` URL → `en-US` hreflang).
   */
  hreflang?: Record<string, string> | undefined;
  /** Emit `hreflang="x-default"`. Default: `true`. */
  xDefault?: boolean | undefined;
}

/**
 * Subset of `@astrojs/sitemap`'s SitemapItem we touch.
 *
 * Type details that aren't obvious:
 *   - `links` must be MUTABLE `Array` (sitemap's `serialize` signature
 *     declares it that way; `ReadonlyArray` would be incompatible).
 *   - `LinkItem.hreflang?` exists in the underlying `sitemap`
 *     package's type even though `@astrojs/sitemap` doesn't set it.
 *   - We omit `lastmod`/`changefreq`/`priority` so we stay a
 *     structural subset (avoids importing `EnumChangefreq`).
 */
interface SitemapItemLike {
  url: string;
  links?: Array<{ url: string; lang: string; hreflang?: string }>;
}

/** Spread-friendly subset of `@astrojs/sitemap`'s options. */
export interface AstroSitemapI18nOutput {
  i18n: { defaultLocale: string; locales: Record<string, string> };
  /** Present when `xDefault` is on. Items without alternates pass through unchanged. */
  serialize?: (item: SitemapItemLike) => SitemapItemLike;
}

/**
 * Validates `defaultLocale` ∈ `locales`, non-empty / unique locales,
 * and hreflang override keys — all silent-malformation paths.
 */
export function astroSitemapI18n(input: AstroSitemapI18nInput, options: AstroSitemapI18nOptions = {}): AstroSitemapI18nOutput {
  // Only string form supported — object form would silently produce
  // wrong hreflang output.
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

  // Capture the default-locale's hreflang (BCP 47, after any
  // override) so the serialize callback identifies which existing
  // link to clone as `x-default` without re-validating.
  // The earlier `defaultLocale ∈ locales` validation guarantees this.
  const defaultHreflang = locales[input.defaultLocale];
  if (defaultHreflang === undefined) {
    throw new Error(`[polystella] internal invariant: hreflang map missing default locale "${input.defaultLocale}"`);
  }

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
