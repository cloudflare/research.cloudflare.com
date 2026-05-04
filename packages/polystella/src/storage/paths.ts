/**
 * Shared filesystem-path constants.
 *
 * Two surfaces consume `DEFAULT_STAGING_DIR`: the integration's build
 * hook (which writes translated bytes there) and the
 * `polystellaCollections` content-config helper (which reads them via
 * `glob()`). The constant lives in one module so a future change to
 * Astro's `cacheDir` default (or any other reason to move staging)
 * doesn't require coordinated edits in two unrelated files. If the
 * writer and reader ever desync on this path, the symptoms are
 * silent: every sibling collection appears empty at sync time, and
 * `getLocalizedEntry` falls back to source for every cross-locale
 * call. Routing this one constant through a shared file avoids that
 * class of bug entirely.
 *
 * The path is **relative to the Astro project root**, not to
 * `config.cacheDir`. In Astro 6 `cacheDir` resolves to
 * `<root>/node_modules/.astro/` by default; we deliberately anchor
 * staging at `<root>/.astro/i18n-staging` so consumers can
 * predictably gitignore it (the existing `.astro/` rule covers it
 * for free) and `polystellaCollections` can resolve a stable base
 * for `glob()` without having to thread a runtime value through the
 * content-config call.
 */
export const DEFAULT_STAGING_DIR = ".astro/i18n-staging";

/**
 * Default `glob()` pattern siblings use when no `loaderOverride`
 * applies. Co-located here because changing it affects both the
 * integration's writer (must match the file extensions actually
 * produced) and the reader (must match the files the integration
 * actually wrote). Single source of truth.
 */
export const DEFAULT_STAGING_GLOB = "**/*.{md,mdx}";
