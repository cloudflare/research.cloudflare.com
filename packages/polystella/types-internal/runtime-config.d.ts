/**
 * Ambient type declaration for the runtime-config virtual module the
 * integration registers in `astro:config:setup`. The post-pivot
 * runtime is a pure dispatcher — picks between
 * `<collection>__<locale>` siblings and the source collection — so
 * the only constant it needs at page-render time is the default
 * locale. The integration's Vite plugin resolves the import at build
 * time; this declaration only exists to make TypeScript and editors
 * happy inside the package source.
 */

declare module "polystella:runtime-config" {
  /** Source/canonical locale, mirrored from `config.i18n.defaultLocale`. */
  export const defaultLocale: string;
}
