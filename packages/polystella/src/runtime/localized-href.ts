/**
 * Pure URL-prefixing helper for component-level links.
 *
 * Mirrors the URL classification rules of the build-time markdown
 * rewriter (`parsing/rewrite-links.ts`):
 *
 *   - external (`http://`, `https://`, `//`, `mailto:`, `tel:`) → unchanged;
 *   - anchor-only (`#section`) → unchanged;
 *   - already locale-prefixed → unchanged (idempotency);
 *   - default-locale or missing locale → unchanged (root-routed);
 *   - otherwise → `/{locale}/{path}{?query}{#fragment}`.
 *
 * No Astro deps; the `polystella/runtime` wrapper binds them.
 */

export interface LocalizedHrefDeps {
  /** From `config.i18n.defaultLocale`. */
  defaultLocale: string;
  /** Full locale set INCLUDING the default; used for idempotency. */
  locales: ReadonlyArray<string>;
}

/** `locale` is the target; typically `Astro.currentLocale`. */
export function resolveLocalizedHref(
  href: string,
  locale: string | undefined,
  deps: LocalizedHrefDeps,
): string {
  if (href.length === 0) return href;

  // External / anchor / protocol bail-out. Order mirrors the
  // build-time rewriter so the two surfaces stay identical.
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

  // Default-locale routes live at the unprefixed root (the canonical
  // `prefixDefaultLocale: false` setup). If a future config supports
  // `prefixDefaultLocale: true`, this branch needs a parallel
  // prefixing path.
  if (locale === undefined || locale === "" || locale === deps.defaultLocale) {
    return href;
  }

  // Idempotency: leave URLs already starting with any known-locale
  // prefix alone (no `/pt-BR/pt-BR/foo` on re-renders).
  for (const loc of deps.locales) {
    if (href === `/${loc}` || href.startsWith(`/${loc}/`)) {
      return href;
    }
  }

  // Split query/fragment so prefix lands on the path, not the suffix.
  const suffixMatch = /[?#]/.exec(href);
  const pathPart = suffixMatch ? href.slice(0, suffixMatch.index) : href;
  const suffix = suffixMatch ? href.slice(suffixMatch.index) : "";

  const trimmedPath = pathPart.startsWith("/") ? pathPart.slice(1) : pathPart;
  return `/${locale}/${trimmedPath}${suffix}`;
}
