/**
 * Ambient type declaration for the runtime-config virtual module the
 * integration registers in `astro:config:setup`. The post-pivot
 * runtime is a pure dispatcher — picks between
 * `<collection>__<locale>` siblings and the source collection — so
 * the constants here are exactly the data the runtime needs at
 * page-render time. The integration's Vite plugin resolves the
 * import at build time; this declaration only exists to make
 * TypeScript and editors happy inside the package source.
 */

declare module "polystella:runtime-config" {
  /** Source/canonical locale, mirrored from `config.i18n.defaultLocale`. */
  export const defaultLocale: string;

  /**
   * Full locale set including the default. Used by `localizedHref`
   * for its idempotency check (so a URL already prefixed with any
   * declared locale is left alone on re-render).
   */
  export const locales: ReadonlyArray<string>;

  /**
   * Behaviour on cross-locale miss in `getLocalizedEntry` for sources
   * WITHOUT `noTranslate: true`:
   * `"default-locale"` returns source content with `isLocalized: false`,
   * `"skip"` returns `undefined` so the page 404s.
   */
  export const fallback: "default-locale" | "skip";

  /**
   * Behaviour on cross-locale miss for sources WITH
   * `noTranslate: true` in their frontmatter. Takes precedence over
   * `fallback` when the flag is set:
   * `"fallback"` returns source content with `isLocalized: false`,
   * `"404"` returns `undefined`.
   */
  export const noTranslateBehavior: "fallback" | "404";

  /**
   * Operator-declared internal URL paths that should NOT receive a
   * locale prefix. Picomatch globs against the URL path (after
   * splitting query/fragment). Used by `localizedHref` for parity
   * with the build-time link rewriter.
   */
  export const noPrefixUrls: ReadonlyArray<string>;

  /**
   * Resolved integration mode. The runtime middleware reads this
   * to decide whether to install polystella's `Astro.locals.t`
   * (standalone / auto) or defer to Starlight's (starlight).
   */
  export const mode: "auto" | "standalone" | "starlight";
}
