import "dotenv/config";

/**
 * Three-mode dispatch for the R2 translation cache:
 *
 *   1. Local build:
 *      Read main's `i18n/` prefix, never write to R2. A developer's
 *      build can never overwrite production data. Translation is
 *      skipped by default (`dryRun: true`) to avoid burning Workers
 *      AI quota on routine content edits — previously-staged files
 *      remain on disk so existing translations still render.
 *
 *      Opt in explicitly with `POLYSTELLA_TRANSLATE=1 pnpm build`
 *      (or the convenience script `pnpm translate:build`) to run
 *      the AI pass locally; the bytes still only land in local
 *      staging and are discarded at the next clean.
 *
 *   2. CI build (Workers Builds, `WORKERS_CI_BRANCH` set by the
 *      runtime): main writes to `i18n/`, every other branch writes
 *      to `previews/<sanitized-branch>/i18n/` with a read-fallback
 *      to `i18n/` so unchanged content reuses production's cache.
 *
 *   3. Explicit CLI run (`pnpm translate`, `POLYSTELLA_CLI=1`): same dispatch
 *      as CI — main writes to production, anything else to its
 *      preview prefix. The CLI is the only path that lets a
 *      developer write to R2 from outside CI; the explicit
 *      invocation is the consent.
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

/** @type {import('@cloudflare/polystella').PolyStellaOptions} */
const config = {
  // Locale set is configured in `astro.config.mjs` under `i18n` and
  // read by PolyStella at `astro:config:setup`.

  sourceDir: "./content",

  include: ["**/*.md", "**/*.mdx", "site.toml"],

  // Each file format has its own block with two axes:
  //   - `keys`  — translatable scalars (sent to the AI translator).
  //   - `urls`  — URL fields locale-prefixed at staging time (e.g.
  //               `/foo` → `/pt-BR/foo`). External URLs and anchors
  //               pass through unchanged.
  //
  // Both are maps: glob (against the file's relative source path)
  // → array of key paths. Markdown uses flat frontmatter keys;
  // structured-data formats use dotted/bracketed key paths
  // (wildcards `[*]` / `.*` expand against the parsed structure).
  //
  // A given path MUST NOT appear in both `keys` and `urls` for the
  // same glob — the resolver errors at startup if it does.
  //
  // Markdown body inline links are rewritten automatically by the
  // markdown adapter and need no config; `markdown.urls` only
  // applies to frontmatter URL fields.
  markdown: {
    keys: {
      "publications/**": ["title", "metaDescription", "related_interests"],
      "pages/**": ["title"],
      "people/**": ["position"],
      "tags/**": ["name", "description"],
      "presentations/**": ["title", "related_interests"],
    },
    contextKeys: {
      "publications/**": ["title", "metaDescription"],
      "presentations/**": ["title"],
    },
  },

  // `site.toml`'s structure: a single top-level entry (`main`) holds
  // `featuredResearch` with translatable strings and a `link` that
  // points at an internal page. Astro's `file()` loader produces one
  // entry per top-level TOML table, so the schema in
  // `src/content.config.ts` validates against `entry.data.featuredResearch`.
  toml: {
    keys: {
      "site.toml": ["main.featuredResearch.title", "main.featuredResearch.description", "main.featuredResearch.buttonLabel"],
    },
    urls: {
      "site.toml": ["main.featuredResearch.link"],
    },
  },

  // Source pages PolyStella generates locale-prefixed shims for. Each
  // entry produces a shim at `<cacheDir>/polystella-shims/route-N.astro`
  // and an `injectRoute({ pattern: "/[lang]/<sourcePattern>" })` call
  // at config:setup. Source pages should call `getLocalizedEntry`
  // (instead of `getEntry`) to read translated content for the
  // locale-prefixed URLs.
  //
  // Entries can be literal paths or globs (picomatch syntax). Globs
  // expand at config:setup against the actual files on disk. Auto-
  // exclusions for glob expansion only:
  //   - `404.astro` (Astro's special fallback page)
  //   - any path with an `_`-prefixed segment (Astro convention for
  //     non-route files: layouts, helpers, etc.)
  // Literal paths are NEVER auto-excluded — listing `404.astro`
  // explicitly is a recognised opt-in.
  routes: ["src/pages/**/*.astro"],

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

  // Three-mode dispatch — see the `inCi`/`inCli`/`isLocalBuild` block
  // above for the detection logic.
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
    keepLastN: isLocalBuild
      ? false // readOnly already disables prune; setting `false` is belt + braces.
      : isProduction
        ? 2
        : 3, // preview branches churn hashes faster, keep more variants.
  },

  provider: {
    kind: "workers-ai",
    accountId: process.env.CF_ACCOUNT_ID ?? "",
    apiToken: process.env.WORKERS_AI_API_TOKEN ?? "",
    // Verify all model ids against the live catalog at
    // https://developers.cloudflare.com/workers-ai/models/ before changing them.
    model: {
      default: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "ja-JP": "@cf/qwen/qwen3-30b-a3b-fp8",
    },
  },

  // Per-locale terminology rules.
  glossary: {
    file: "./i18n/glossaries/{locale}.yaml",
  },

  prompt: {
    context:
      "Specialise in technical research content from the Cloudflare Research portal: cryptography, networking, distributed systems, and applied security.",
  },

  // Files placed under this directory always win over machine translation.
  // Mirror the structure of `sourceDir`, scoped per locale.
  //   ./i18n/overrides/pt-BR/publications/foo.md
  overridesDir: "./i18n/overrides",

  // When `true`, log what would happen but do not call R2 or the
  // provider. Local builds default to dry-run to avoid burning
  // Workers AI quota on routine edits; opt in with
  // `POLYSTELLA_TRANSLATE=1 pnpm build` or `pnpm translate:build`.
  dryRun: isLocalBuild && process.env.POLYSTELLA_TRANSLATE !== "1",
};

export default config;
