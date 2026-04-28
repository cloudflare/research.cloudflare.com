// @ts-check
/**
 * PolyStella configuration for the Cloudflare Research site.
 *
 * Imported by `astro.config.mjs`. Keeping it here means the Astro config
 * stays focused on Astro's own concerns and this file is the one place
 * you go to tune translation behaviour.
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
  // ─── Locales (required) ──────────────────────────────────────────────
  // The source/canonical language. Any language is supported; English is
  // the common case.
  defaultLocale: "en",

  // Target locales the integration should produce. MUST NOT include the
  // value of `defaultLocale`.
  locales: ["pt-BR", "ja-JP"],

  // ─── Source files ────────────────────────────────────────────────────
  // Where to look for translatable markdown, relative to the Astro
  // project root.
  // sourceDir: "./content",

  // Glob patterns relative to `sourceDir`. A file is considered for
  // translation if it matches at least one `include` and no `exclude`.
  // include: ["**/*.md", "**/*.mdx"],
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
  //   frontmatter: {
  //     "publications/**": ["title", "abstract"],
  //     "people/**": ["bio"],
  //     "tags/**": ["title", "description"],
  //   },
  // frontmatter: {},

  // ─── Standalone-mode routing ─────────────────────────────────────────
  // Glob patterns the integration is allowed to inject `/<locale>/...`
  // routes for. Empty array means "all routes are eligible".
  // routes: [],

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
  // r2: {
  //   accountId: process.env.CF_ACCOUNT_ID,
  //   bucket: "research-i18n-cache",
  //   accessKeyId: process.env.R2_ACCESS_KEY_ID,
  //   secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  //   prefix: "i18n/",                       // default: "i18n/"
  //   // endpoint: "https://<accountId>.eu.r2.cloudflarestorage.com",
  //   // readOnly: false,                    // skip writes; useful for staging
  //   // keepLastN: 5,                       // pruning per (locale, sourcePath); set to false to disable
  // },

  // ─── AI provider ─────────────────────────────────────────────────────
  // Becomes required once M5 wires the AI translator.
  //
  // Workers AI:
  // provider: {
  //   kind: "workers-ai",
  //   accountId: process.env.CF_ACCOUNT_ID,
  //   apiToken: process.env.WORKERS_AI_API_TOKEN,
  //   model: "@cf/meta/llama-3.1-8b-instruct",
  //   // …or per-locale, with a `default` fallback:
  //   // model: {
  //   //   default: "@cf/meta/llama-3.1-8b-instruct",
  //   //   "ja-JP": "@cf/qwen/qwen2.5-7b-instruct",
  //   // },
  //   // endpoint: "https://...",            // override the default WAI endpoint
  // },
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

  // ─── Hand-written translation overrides ──────────────────────────────
  // Files placed under this directory always win over machine translation.
  // Mirror the structure of `sourceDir`, scoped per locale.
  //   ./i18n/overrides/pt-BR/publications/foo.md
  // overridesDir: "./i18n/overrides",

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
