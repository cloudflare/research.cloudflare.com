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
  include: ["publications/Antunes2025.md"],
  // exclude: [],
  //
  // Staged-rollout example — translate publications first:
  //   include: ["publications/**/*.md"],
  // …or keep `include` broad and exclude the rest:
  //   exclude: ["people/**", "presentations/**", "tags/**"],

  // ─── Per-collection frontmatter rules ────────────────────────────────
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

  // ─── Standalone-mode routing ─────────────────────────────────────────
  // Source pages PolyStella generates locale-prefixed shims for. Each
  // entry produces a shim at `<cacheDir>/polystella-shims/route-N.astro`
  // and an `injectRoute({ pattern: "/[lang]/<sourcePattern>" })` call
  // at config:setup. Until the source page is migrated to
  // `getLocalizedEntry` (planned milestone), the locale routes render
  // source-language content under the locale-prefixed URLs.
  routes: ["src/pages/[slug].astro"],

  // What to render at a translated URL when the underlying page has no
  // translation: fall back to the default-locale page, or 404.
  // noTranslateBehavior: "fallback",  // "fallback" | "404"

  // Rewrite internal links inside translated markdown so a `/foo` link
  // becomes `/<locale>/foo` automatically.
  // rewriteInternalLinks: true,

  // ─── R2 storage (translation cache) ──────────────────────────────────
  // Becomes required once M6 wires real R2 access. While we're in
  // dry-run, this can be omitted entirely.
  //
  r2: {
    accountId: process.env.CF_ACCOUNT_ID,
    bucket: "research-i18n-cache",
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    prefix: "i18n/", // default: "i18n/"
    // endpoint: "https://<accountId>.eu.r2.cloudflarestorage.com",
    // readOnly: false,                    // skip writes; useful for staging
    keepLastN: 3,                       // pruning per (locale, sourcePath); set to false to disable
  },

  // ─── AI provider ─────────────────────────────────────────────────────
  //
  // Workers AI:
  provider: {
    kind: "workers-ai",
    accountId: process.env.CF_ACCOUNT_ID ?? "",
    apiToken: process.env.WORKERS_AI_API_TOKEN ?? "",
    // …or per-locale, with a `default` fallback:
    model: {
      default: "@cf/meta/llama-3.1-8b-instruct",
      "ja-JP": "@cf/qwen/qwen2.5-coder-32b-instruct",
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
