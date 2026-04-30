/**
 * Ambient type declaration for the runtime-config virtual module the
 * integration registers in `astro:config:setup`. The virtual module is
 * a thin export of build-time constants — staging directory, default
 * locale, source dir — that the runtime helper needs at page-render
 * time without re-reading the user's PolyStella config.
 *
 * The integration's Vite plugin resolves the import at build time;
 * this declaration only exists to make TypeScript and editors happy
 * inside the package source.
 */

declare module "polystella:runtime-config" {
  /** Absolute path to `<cacheDir>/i18n-staging`. */
  export const stagingDir: string;
  /** Source/canonical locale, mirrored from `config.i18n.defaultLocale`. */
  export const defaultLocale: string;
  /** Source dir from PolyStella's resolved options (e.g. `./content`). */
  export const sourceDir: string;
  /**
   * Per-glob translatable-keys map mirrored from
   * `polystella({ frontmatter })`. The runtime helper uses this to
   * decide which keys to overlay from the staged frontmatter onto
   * the schema-validated source entry — keys not listed for any
   * matching glob keep their source-entry values verbatim, so Astro's
   * `reference()` parsing, date coercion, and image asset resolution
   * survive the locale swap.
   */
  export const frontmatter: Record<string, string[]>;
}
