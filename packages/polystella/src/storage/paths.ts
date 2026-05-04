/**
 * Shared path constants — single source of truth between the
 * integration's writer (`src/index.ts`) and the
 * `polystellaCollections` reader (`src/content/build.ts`). A drift
 * between writer and reader silently produces empty sibling
 * collections at sync time; routing through one constant prevents it.
 *
 * Path is relative to the Astro project root (NOT `config.cacheDir`,
 * which resolves to `<root>/node_modules/.astro/` in Astro 6).
 * Anchoring at `<root>/.astro/i18n-staging` lets consumers gitignore
 * via the existing `.astro/` rule.
 */
export const DEFAULT_STAGING_DIR = ".astro/i18n-staging";

/**
 * Default sibling-loader glob pattern. Co-located with the staging
 * dir so a future change here matches what the integration writes.
 */
export const DEFAULT_STAGING_GLOB = "**/*.{md,mdx}";
