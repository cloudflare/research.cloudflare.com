import "dotenv/config";

/**
 * PolyStella configuration for the Cloudflare Research site.
 *
 * Every available option is listed below. Required ones are uncommented
 * and filled in with the values this site uses; optional ones are
 * commented out with their defaults so you can see the full surface at a
 * glance and uncomment what you need.
 *
 * Schema source of truth: `packages/polystella/src/options.ts`.
 */

/**
 * Three-mode dispatch for the R2 cache:
 *
 *   1. Local build (`pnpm build` / `pnpm dev`, no env signals):
 *      Read main's `i18n/` prefix, never write to R2. A developer's
 *      build can never overwrite production data; if their edits
 *      change the source hash, translation still happens but the
 *      bytes only land in local staging — paid by the dev's
 *      Workers AI quota and discarded at the next clean.
 *
 *   2. CI build (Workers Builds, `WORKERS_CI_BRANCH` set by the
 *      runtime): main writes to `i18n/`, every other branch writes
 *      to `previews/<sanitized-branch>/i18n/` with a read-fallback
 *      to `i18n/` so unchanged content reuses production's cache.
 *
 *   3. Explicit CLI run (`pnpm translate`, `POLYSTELLA_CLI=1` set
 *      by `cli.ts` before this module is imported): same dispatch
 *      as CI — main writes to production, anything else to its
 *      preview prefix. The CLI is the only path that lets a
 *      developer write to R2 from outside CI; the explicit
 *      invocation is the consent.
 *
 * Detection cascade:
 *   - `inCi`         — `WORKERS_CI_BRANCH` is set (ONLY Workers
 *                      Builds sets this; local shells don't).
 *   - `inCli`        — `POLYSTELLA_CLI === "1"` (set by our CLI).
 *   - `isLocalBuild` — neither of the above.
 *
 * Branch sanitisation:
 *   Branch names commonly contain `/` (e.g. `diogo/polystella-v1`).
 *   Embedded slashes work in R2 keys but fragment a branch's cache
 *   across nested folders and let two branches collide on a shared
 *   namespace component (`diogo/foo` and `diogo/bar` both nest
 *   under `previews/diogo/`). We flatten to a single-level segment.
 *
 *   The sanitisation is lossy: `diogo/foo-bar` and `diogo-foo-bar`
 *   both normalise to `diogo-foo-bar` and would share a cache. The
 *   cache is content-addressed so no data corruption is possible
 *   even on a collision — worst case is one branch reads the
 *   other's translations of an identical source hash.
 */
const sanitizeBranchSegment = (name) => {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "branch";
};

const inCi = process.env.WORKERS_CI_BRANCH !== undefined;
const inCli = process.env.POLYSTELLA_CLI === "1";
const isLocalBuild = !inCi && !inCli;

const branch = process.env.WORKERS_CI_BRANCH ?? "main";
const isProduction = branch === "main";
const branchSegment = sanitizeBranchSegment(branch);

/** @type {import('polystella').PolyStellaOptions} */
const config = {
  // ─── Locales ───────────────────────────────────────────────────
  // Locale set is configured in `astro.config.mjs` under `i18n` and
  // read (never written) by PolyStella at `astro:config:setup`. To
  // change `defaultLocale` or add/remove a target locale, edit the
  // Astro config; PolyStella picks it up automatically and folds the
  // resolved set into every cache key.

  // ─── Source files ────────────────────────────────────────────────────
  // Where to look for translatable markdown, relative to the Astro
  // project root.
  // sourceDir: "./content",

  // Glob patterns relative to `sourceDir`. A file is considered for
  // translation if it matches at least one `include` and no `exclude`.
  // include: ["**/*.md", "**/*.mdx"],
  include: ["publications/*.md", "site.toml"],
  // exclude: [],
  //
  // Staged-rollout example — translate publications first:
  //   include: ["publications/**/*.md"],
  // …or keep `include` broad and exclude the rest:
  //   exclude: ["people/**", "presentations/**", "tags/**"],

  // ─── Per-collection frontmatter rules (markdown adapter) ─────────────
  // Map of glob (against the file's relative source path) → array of
  // frontmatter keys that should be translated. Frontmatter keys not
  // listed here are passed through verbatim.
  //
  frontmatter: {
    "publications/**": ["title", "metaDescription", "related_interests"],
    //"people/**": ["bio"],
    //"tags/**": ["title", "description"],
  },
  // frontmatter: {},

  // ─── TOML key paths (TOML adapter, v0.1.x) ───────────────────────────
  // Translatable scalars inside `.toml` files. Same shape as
  // `frontmatter`: glob → array of dotted/bracketed key paths inside
  // the parsed TOML. Wildcards `[*]` and `.*` expand at extract time.
  //
  // `site.toml`'s structure: a single top-level entry (`main`) holds
  // `featuredResearch` with translatable strings. Astro's `file()`
  // loader produces one entry per top-level TOML table, so the
  // schema in `src/content.config.ts` validates against
  // `entry.data.featuredResearch`.
  tomlKeys: {
    "site.toml": [
      "main.featuredResearch.title",
      "main.featuredResearch.description",
      "main.featuredResearch.buttonLabel",
    ],
  },

  // ─── Standalone-mode routing ─────────────────────────────────────────
  // Source pages PolyStella generates locale-prefixed shims for. Each
  // entry produces a shim at `<cacheDir>/polystella-shims/route-N.astro`
  // and an `injectRoute({ pattern: "/[lang]/<sourcePattern>" })` call
  // at config:setup. Until the source page is migrated to
  // `getLocalizedEntry` (planned milestone), the locale routes render
  // source-language content under the locale-prefixed URLs.
  routes: ["src/pages/index.astro", "src/pages/[slug].astro"],

  // ─── Shim CSS injection ──────────────────────────────────────────────
  // Astro's per-route `<link rel="stylesheet">` injection follows
  // CSS dependencies that are direct first-degree imports of the
  // route's own module. PolyStella's shims import the source page
  // and render it via `<SourcePage />`, but Astro DOESN'T follow
  // CSS through that render — so the shim's routes ship to dist/
  // with no stylesheet link, and translated pages render with no
  // styles applied.
  //
  // Listing CSS files here makes them first-degree imports of every
  // shim, which lands the right `<link>` in the translated pages'
  // HTML. Vite groups this codebase's CSS into a single chunk
  // (everything routes through `src/styles/global.css` via the
  // BaseLayout chain), so one entry covers all shimmed pages today.
  // If a future page introduces a CSS file that Vite chunks
  // separately, list it here too — or use the per-route object
  // form on `routes` to scope the import.
  routesImports: ["./src/styles/global.css"],

  // What to render at a translated URL when the underlying page has no
  // translation: fall back to the default-locale page, or 404.
  // noTranslateBehavior: "fallback",  // "fallback" | "404"

  // Rewrite internal links inside translated markdown so a `/foo` link
  // becomes `/<locale>/foo` automatically.
  // rewriteInternalLinks: true,

  // ─── R2 storage (translation cache) ──────────────────────────────────
  //
  // Three-mode dispatch — see the `inCi`/`inCli`/`isLocalBuild` block
  // above for the detection logic.
  //
  // Local build: `prefix: "i18n/"` + `readOnly: true`. We point at
  // production's prefix so cache hits are maximised, and the readOnly
  // flag forbids both PUTs and the prune step. Local builds therefore
  // cannot mutate the production cache, regardless of which branch
  // the developer happens to be on. `readFallbackPrefixes` is empty
  // because we're already reading from main; nothing to fall back to.
  //
  // CI / CLI: branch-isolated namespace. Main writes to `i18n/`;
  // anything else writes to `previews/<sanitized-branch>/i18n/` and
  // reads main on miss. Cross-prefix promotion is forbidden by
  // design — a preview hit against main returns those bytes verbatim
  // and never copies them under the preview prefix. Cleanup of stale
  // `previews/...` objects is handled by the bucket's lifecycle rule
  // (see README §Deployment).
  r2: {
    accountId: process.env.CF_ACCOUNT_ID,
    bucket: "research-i18n-cache",
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    prefix: isLocalBuild || isProduction ? "i18n/" : `previews/${branchSegment}/i18n/`,
    readFallbackPrefixes: isLocalBuild || isProduction ? [] : ["i18n/"],
    readOnly: isLocalBuild,
    // endpoint: "https://<accountId>.eu.r2.cloudflarestorage.com",
    keepLastN: isLocalBuild
      ? false // readOnly already disables prune; setting `false` is belt + braces.
      : isProduction
        ? 3
        : 5, // preview branches churn hashes faster, keep more variants.
  },

  // ─── AI provider ─────────────────────────────────────────────────────
  //
  // Workers AI:
  provider: {
    kind: "workers-ai",
    accountId: process.env.CF_ACCOUNT_ID ?? "",
    apiToken: process.env.WORKERS_AI_API_TOKEN ?? "",
    // …or per-locale, with a `default` fallback:
    //
    // Verify all model ids against the live catalog at
    // https://developers.cloudflare.com/workers-ai/models/ — entries
    // are added and removed without API breaks. The interim defaults
    // below are placeholders; M10's bake-off will lock final picks
    // per locale based on native-speaker review.
    model: {
      default: "@cf/meta/llama-3.1-8b-instruct",
      // Qwen 3rd-generation MoE, advertised "groundbreaking
      // multilingual support". Replaces the earlier
      // `@cf/qwen/qwen2.5-coder-32b-instruct` (a *code-specific*
      // model — wrong fit for prose translation). Qwen family is
      // best-in-class for CJK per the RFC's reasoning.
      "ja-JP": "@cf/qwen/qwen3-30b-a3b-fp8",
    },
    // endpoint: "https://...",            // override the default WAI endpoint
  },
  //
  // Anthropic:
  // provider: {
  //   kind: "anthropic",
  //   apiKey: process.env.ANTHROPIC_API_KEY,
  //   model: "claude-3-5-sonnet-latest",
  // },

  // ─── Glossary ────────────────────────────────────────────────────────
  // Per-locale terminology rules. The integration loads one YAML per
  // locale from `./i18n/glossary/<locale>.yaml`, hashes the contents,
  // and folds that hash into each translated file's cache key — so a
  // glossary edit invalidates only the affected locale's translations.
  //
  // Inline glossaries are also supported via `{ inline: {...} }` if
  // you'd rather declare terminology directly in this config.
  glossary: {
    file: "./i18n/glossaries/{locale}.yaml",
  },

  // ─── Prompt customisation ────────────────────────────────────────────
  // The package ships a generic "You are a professional translator."
  // opener. Use `context` to add a single line of site-/domain-specific
  // framing right after that opener, before the source/target locale
  // line. Keep it short and prescriptive — the model treats it as part
  // of its role definition, not as content to translate.
  prompt: {
    context:
      "Specialise in technical research content from the Cloudflare Research portal: cryptography, networking, distributed systems, and applied security.",
  },

  // ─── Debug: preview-output directory ─────────────────────────────────
  // Until the cache + route-injection layers land, translated MDX is
  // discarded after each successful build. Setting `debug.previewDir`
  // dumps every (locale, file) result to disk so you can diff/spot-check
  // the translations. Path is relative to the Astro project root and is
  // gitignored. Remove this block once the cache layer takes over.
  debug: {
    previewDir: "./i18n/.preview",
  },

  // ─── Hand-written translation overrides ──────────────────────────────
  // Files placed under this directory always win over machine translation.
  // Mirror the structure of `sourceDir`, scoped per locale.
  //   ./i18n/overrides/pt-BR/publications/foo.md
  overridesDir: "./i18n/overrides",

  // ─── Behaviour ───────────────────────────────────────────────────────
  // What to do when translation can't be produced for a route:
  //   "default-locale": serve the source-language page
  //   "skip":           omit the route entirely
  // fallback: "default-locale",

  // How many files to translate concurrently.
  // concurrency: 4,

  // When `true`, log what would happen but do not call R2 or the
  // provider. Useful for CI smoke checks.
  // dryRun: false,

  // Lifecycle hooks the integration runs in. Production builds always
  // include "build"; "dev" enables in-process translation while you
  // `astro dev`.
  // runOn: ["build"],

  // If credentials are required but missing, fail the build (true) or
  // silently fall back to default-locale content (false). Default: false.
  // failOnMissingCredentials: false,

  // Integration mode. "auto" detects Starlight and switches automatically;
  // "standalone" forces our own route injector; "starlight" forces
  // Starlight mode (lands in v0.2).
  // mode: "auto",
};

export default config;
