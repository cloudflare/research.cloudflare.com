/**
 * Pure URL-prefixing helper for component-level locale-aware links.
 *
 * The build-time rewriter (`parsing/rewrite-links.ts`) handles links
 * inside translated markdown bodies — it walks the AST and edits
 * URLs as part of producing the staged translation. Component-level
 * links, like `<a href="/foo">` in an `.astro` template or a React
 * component, never go through that pipeline. Without help, those
 * links would always resolve to the default-locale URL even on
 * locale-prefixed pages.
 *
 * `resolveLocalizedHref` applies the same URL-classification rules
 * the build-time rewriter uses, so the two surfaces stay in lockstep:
 *
 *   - external (`http://`, `https://`, `//`, `mailto:`, `tel:`) →
 *     leave unchanged;
 *   - anchor-only (`#section`) → leave unchanged;
 *   - already locale-prefixed (`/pt-BR/...` etc., for any declared
 *     locale) → leave unchanged so a re-render can't double-prefix;
 *   - default-locale call (or missing locale) → leave unchanged
 *     (default-locale URLs live at the root with the canonical
 *     `prefixDefaultLocale: false` setup);
 *   - otherwise → return `/{locale}/{path}` with any query/fragment
 *     suffix appended after the prefix.
 *
 * Pure: no dependencies on `astro:content`, `astro:i18n`, or the
 * runtime-config virtual module. The `polystella/runtime` wrapper
 * binds the deps from `polystella:runtime-config` so consumers can
 * call `localizedHref(href, Astro.currentLocale)` without threading
 * configuration through every call site.
 */

export interface LocalizedHrefDeps {
  /**
   * The site's source/canonical locale, derived from
   * `config.i18n.defaultLocale`. URLs targeting this locale are
   * returned unchanged because default-locale routes live at the
   * unprefixed root with `prefixDefaultLocale: false`.
   */
  defaultLocale: string;
  /**
   * The full list of locales the site declares, **including** the
   * default. Used purely for the idempotency check: an href that
   * already starts with `/<knownLocale>/...` is left alone, which
   * means re-rendering an already-prefixed URL doesn't produce
   * `/pt-BR/pt-BR/...`.
   */
  locales: ReadonlyArray<string>;
}

/**
 * Apply locale-prefixing rules to a single href. Returns the new
 * href (possibly identical to the input).
 *
 * `locale` is the locale to prefix toward; typically the consumer
 * passes `Astro.currentLocale`. `undefined`, the empty string, and
 * the default locale all short-circuit to returning the input
 * unchanged.
 */
export function resolveLocalizedHref(
  href: string,
  locale: string | undefined,
  deps: LocalizedHrefDeps,
): string {
  if (href.length === 0) return href;

  // Same external/anchor/protocol bail-out as the build-time rewriter.
  // Comparison order matches `rewriteUrlIfInternal` so behaviour stays
  // identical between the two surfaces.
  if (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("//") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:") ||
    href.startsWith("#")
  ) {
    return href;
  }

  // Default-locale (or missing) call: nothing to prefix. Default-locale
  // routes live at the unprefixed root by Astro's standard
  // `prefixDefaultLocale: false` configuration, which v0.1's options
  // schema currently mandates. If a future release supports
  // `prefixDefaultLocale: true`, this branch will need a parallel
  // prefixing path; flagging by comment rather than coding the branch
  // speculatively because the matching schema relaxation hasn't
  // happened yet.
  if (locale === undefined || locale === "" || locale === deps.defaultLocale) {
    return href;
  }

  // Idempotency: leave URLs that already carry a known-locale prefix
  // alone, regardless of which locale we're now routing to. Without
  // this, a render pass over already-prefixed bytes would produce
  // `/pt-BR/pt-BR/foo` paths.
  for (const loc of deps.locales) {
    if (href === `/${loc}` || href.startsWith(`/${loc}/`)) {
      return href;
    }
  }

  // Split query/fragment so the prefix lands on the path. `/foo#bar`
  // becomes `/<locale>/foo#bar`, not `/<locale>/foo#bar` with a
  // mangled anchor.
  const suffixMatch = /[?#]/.exec(href);
  const pathPart = suffixMatch ? href.slice(0, suffixMatch.index) : href;
  const suffix = suffixMatch ? href.slice(suffixMatch.index) : "";

  const trimmedPath = pathPart.startsWith("/") ? pathPart.slice(1) : pathPart;
  return `/${locale}/${trimmedPath}${suffix}`;
}
