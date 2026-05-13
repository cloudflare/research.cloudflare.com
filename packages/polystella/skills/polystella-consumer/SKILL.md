---
name: polystella-consumer
description: Add or maintain PolyStella in an existing Astro project. Use when integrating AI-driven build-time content localization, configuring R2 caching, wiring locale-prefixed routes, or debugging an existing PolyStella setup in a downstream project.
---

# polystella-consumer

You are working in an Astro project that consumes the `polystella`
package. This skill covers integration, configuration, common
pitfalls, and the debug flow.

If you are working on the `polystella` package source itself (adding
adapters, editing translators, modifying the cache layer), STOP and
load `polystella-contributor` instead.

## What PolyStella does

Build-time content localization for Astro:

- **Translates** content collections (`.md`, `.mdx`, `.toml`, `.json`, `.yaml`) into additional locales using AI (Workers AI or Anthropic).
- **Caches** translations in Cloudflare R2, content-addressed by source bytes + glossary + model. Unchanged content costs zero on rebuild.
- **Injects routes** under `/[lang]/...` for each non-default locale.
- **Provides runtime APIs** on `Astro.locals` (`t`, `lhref`, `getLocalizedEntry`, `getLocalizedCollection`) and React hooks (`useTranslations`, `useLocalizedHref`).
- **Maintains UI strings** via per-locale JSON dicts with drift detection, sync, and AI-fill subcommands.

Visitors get static bytes — no runtime AI calls.

## Installation

Pre-1.0 the package isn't on npm. Install from GitHub once it lands at `cloudflare/polystella`:

```bash
pnpm add github:cloudflare/polystella#vX.Y.Z
```

The package has a `prepare` script that builds the CLI bundle on install (`pnpm build:cli` → `dist/cli.js`).

Peer dependency: `astro ^6.0.0`.

## Four-file integration

Set up these four files. The locale set lives in `astro.config.mjs`
ONLY — everything else derives from it.

### 1. `astro.config.mjs`

```js
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import polystella, { astroSitemapI18n } from "polystella";
import polystellaConfig from "./polystella.config.mjs";

// Hoist `i18n` so the same object feeds Astro routing, PolyStella
// translation, AND the sitemap helper. One source of truth.
const i18n = {
  defaultLocale: "en-US",
  locales: ["en-US", "pt-BR", "ja-JP"],
  routing: { prefixDefaultLocale: false },
};

export default defineConfig({
  i18n,
  integrations: [sitemap(astroSitemapI18n(i18n, { hreflang: { en: "en-US" } })), polystella(polystellaConfig)],
});
```

### 2. `polystella.config.mjs`

Where provider, glossary, R2, format-specific keys live. Schema source of truth is `src/config/options.ts` in the package; everything is zod-validated at the boundary.

Skeleton:

```js
import "dotenv/config";

export default {
  // R2 config (branch-dispatched — see "Branch-isolated cache" below)
  r2: {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: "your-bucket-name",
    prefix: "i18n/",
    // readOnly: derived from environment; see below
  },
  provider: {
    kind: "workers-ai",
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    // maxTokens: 8192,  // DON'T LOWER — see Pitfall #3
  },
  // Per-locale model override (optional):
  // model: { default: "@cf/meta/...", "ja-JP": "@cf/qwen/..." },

  glossaryDir: "i18n/glossary", // YAML files: <locale>.yaml
  overridesDir: "i18n/overrides", // <locale>/<mirrored-path>

  // Translatable frontmatter keys per source glob:
  frontmatter: {
    "content/publications/**/*.md": ["title", "description"],
    "content/people/**/*.md": ["position", "bio"],
  },

  // Per-batch document-context framing (improves cross-section consistency):
  markdown: {
    contextKeys: {
      "content/publications/**/*.md": ["title", "excerpt"],
    },
  },

  // Locale-prefixed routes — list any pages that need shimming:
  routes: [
    "src/pages/index.astro",
    "src/pages/[slug].astro",
    // { source: "src/pages/[slug].astro", imports: ["./src/styles/publication.css"] },
  ],

  // CSS imports for shims (see Pitfall #5):
  routesImports: ["./src/styles/global.css"],
};
```

### 3. `src/content.config.ts`

```ts
import { defineCollection } from "astro:content";
import { polystellaCollections } from "polystella/content";
import { i18nLoader, i18nSchema } from "polystella/i18n";

import { publications, people } from "./content-schemas";

export const collections = {
  ...polystellaCollections({
    source: { publications, people },
  }),
  // Hand-authored UI-strings collection, drift-detected at build:
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
```

### 4. `src/env.d.ts`

```ts
/// <reference types="polystella/client" />
```

Picks up types for PolyStella's virtual modules (`polystella:runtime-config`).

## UI strings

Chrome text (nav, footer, accessibility strings) lives in
`src/content/i18n/<locale>.json` as flat key→string dicts. The
default-locale file is the single source of truth; non-default
locales must match its key set.

Workflow:

1. Edit `src/content/i18n/en-US.json` — add, remove, or change keys.
2. Run `polystella translate-ui` to propagate changes through other locales.
3. Spot-check translations; hand-edit any keys where you want exact wording. The AI step only fills _empty_ values, so a hand-written value stays untouched on subsequent runs.
4. Commit. The pre-commit hook should run `polystella check-ui` automatically when `src/content/i18n/` is staged.

Wire the pre-commit hook (`.githooks/pre-commit`):

```sh
if printf '%s\n' "$STAGED" | grep -qE '^src/content/i18n/'; then
  pnpm exec polystella check-ui
fi
```

## Runtime APIs

In `.astro` files:

```astro
---
const { t, lhref, getLocalizedEntry, getLocalizedCollection } = Astro.locals;

const { slug } = Astro.params;
const entry = await getLocalizedEntry("publications", slug);

const activePeople = await getLocalizedCollection(
  "people",
  ({ data }) => data.type === "active",
);
---

<a href={lhref("/foo")}>{t("nav.foo")}</a>
```

Outside `.astro` (utility scripts, getStaticPaths, React islands):

```ts
import { getLocalizedEntry, getLocalizedCollection, localizedHref } from "polystella/runtime";

import { useTranslations, useLocalizedHref } from "polystella/react";
import { getDictionary } from "polystella/i18n";
```

## Branch-isolated R2 cache

Three modes, dispatched automatically by `polystella.config.mjs`:

| Mode               | Env signals                          | r2.prefix                            | Writes?                   |
| :----------------- | :----------------------------------- | :----------------------------------- | :------------------------ |
| Local build        | neither var set                      | `i18n/` (read-only against main)     | NO                        |
| CI build (main)    | `WORKERS_CI_BRANCH=main`             | `i18n/`                              | YES                       |
| CI build (preview) | `WORKERS_CI_BRANCH=<other>`          | `previews/<branch>/i18n/` + fallback | YES (preview prefix only) |
| Explicit CLI       | `POLYSTELLA_CLI=1` (set by `cli.ts`) | per resolved branch                  | YES                       |

**Key mental model:** a developer's local `pnpm build` can NEVER overwrite production. To populate R2 from outside CI, use the explicit `polystella translate` CLI.

Configure a lifecycle rule on the R2 bucket to expire `previews/*` after 30 days. The package only prunes within its configured prefix, so cross-build cleanup of orphan preview prefixes needs the lifecycle rule.

## Override files (hand translations)

Drop a file at `i18n/overrides/{locale}/<mirrored-path>` and it wins over AI output verbatim. Overrides go through the URL rewriter (idempotent) but are NOT written to R2 — they live in your repo, not in the cache.

Use overrides for content you want to control exactly (legal copy, brand names, marketing taglines).

## Glossary

YAML file per locale at `<glossaryDir>/<locale>.yaml`:

```yaml
- term: "Cloudflare"
  translation: "Cloudflare" # do-not-translate
- term: "edge computing"
  translation: "edge computing"
  notes: "Keep English; widely understood as a technical term in <locale>."
- term: "free tier"
  translation: "<locale-specific preferred phrasing>"
```

Editing the glossary re-translates only pages mentioning the changed term (the glossary hash folds into the cache key).

## Build report

After every translation pass, `astro build` (and `polystella translate`) writes `dist/i18n-r2-report.json` with per-pair outcomes: cache hits, AI translations, overrides, errors, locally-skipped pairs, prune actions. Check it when something looks wrong.

## Common pitfalls (top 10)

1. **Locale set drift** — `astro.config.mjs`'s `i18n.locales` is the only source of truth. Don't duplicate it in `polystella.config.mjs`. The `astroSitemapI18n(i18n, ...)` helper takes the same `i18n` block. Sitemap config that doesn't match Astro's `i18n` ships locale-prefixed URLs with no `hreflang` annotations — search engines treat them as duplicate content.
2. **Empty preview cache panic** — A PR preview's R2 prefix is `previews/<branch>/i18n/`, initially empty. The fallback to `i18n/` means cache hits still come from main; new translations write to the preview prefix. This is correct behaviour.
3. **Workers AI `maxTokens` default** — The schema default is `8192`. Lowering it truncates multi-segment translations into invalid JSON. Keep it at `8192` unless you've measured single-segment files and know what you're doing.
4. **`pnpm i18n:sync` alone is not enough** — Sync only reconciles keys; it leaves new keys as `""` placeholders. The build's drift check fails on `""` in a non-default locale when the source value is non-empty. Run `pnpm i18n:translate` (or hand-edit) to fill placeholders before committing.
5. **CSS missing on translated routes** — Translated pages render via shims; Astro's per-route stylesheet injection doesn't follow CSS through child `<SourcePage />` components. List your global CSS in `routesImports` (or per-route via the object form) so shims emit the import directly.
6. **`prettier --write` collapses sync writer's blank lines** — The UI-string sync writer preserves blank-line section breaks between key groups. `prettier --write` collapses them. The pre-commit hook should use `prettier --check` (not `--write`).
7. **`{{token}}` placeholders dropped by AI** — Validated post-translation; if a token is missing or renamed after all retries, the key is left empty for manual fix-up. Hand-edit the locale JSON in that case.
8. **Override files don't get cache-invalidated** — Edits to overrides aren't reflected in the cache (overrides aren't cached). The override is read fresh every build.
9. **MDX vs MD** — `remark-mdx` disables indented code, autolinks, and raw-HTML blocks. If your `.md` files use any of these, don't accidentally rename them to `.mdx`.
10. **R2 credentials in repo** — Never commit credentials. Use `.env` (gitignored) + `dotenv/config` at the top of `polystella.config.mjs`. Workers Builds inject credentials via env vars; local development reads from `.env`.

## CLI quick reference

```bash
polystella translate                          # translate for current git branch
polystella translate --branch main            # target main's R2 prefix explicitly
polystella translate --locale pt-BR           # one locale only
polystella translate --file 'foo.md'          # one file
polystella translate --dry-run                # plan only, no provider/R2 calls
polystella translate --prefix 'custom/i18n/'  # direct r2.prefix override

polystella check-ui                           # drift detection (offline)
polystella sync-ui                            # reconcile key sets (offline)
polystella sync-ui --check                    # dry-run sync, exits non-zero if work pending
polystella translate-ui                       # sync + AI-fill empty placeholders
polystella translate-ui --locale pt-BR        # one locale only
polystella translate-ui --sync-only           # same as `sync-ui`
```

Exit codes: `0` clean, `1` config error, `2` translation/sync work failed.

Typical host-project package.json wrappers:

```json
{
  "scripts": {
    "translate": "polystella translate",
    "translate:dry": "polystella translate --dry-run",
    "i18n:check": "polystella check-ui",
    "i18n:sync": "polystella sync-ui",
    "i18n:translate": "polystella translate-ui"
  }
}
```

## Debug flow

When a translation is wrong:

1. Run `polystella translate --dry-run --file '<source-path>'` to see the planned R2 key. Verify the key is what you expect.
2. Inspect the staged file at `<root>/.astro/i18n-staging/<locale>/<source-path>`. Did the AI output land there? Is the marker (`aiTranslated: true`) in the frontmatter?
3. Check the build report (`dist/i18n-r2-report.json`) — was it a hit, miss, override, or error?
4. If a glossary entry should have applied: `cat <glossaryDir>/<locale>.yaml` and confirm the term is listed.
5. If an override should have applied: confirm the path `i18n/overrides/<locale>/<exact-mirror-of-source>` exists.
6. Re-run with `LOG_LEVEL=debug polystella translate --file '...'` for batch-level detail (segment count, batch count, oversize warnings).
7. To force re-translation: bump the source file (any edit changes its hash), or delete the R2 object directly, or delete the local cache index entry at `<root>/.astro/i18n-staging/.polystella-cache.json`.

## What never to do

- Commit R2 credentials, Workers AI API tokens, or Anthropic API keys.
- Run `pnpm i18n:sync` and commit without `pnpm i18n:translate` — the build will fail on empty placeholders.
- Manually write to R2 from outside CI without setting `POLYSTELLA_CLI=1` (the CLI does this automatically; this is a warning if you're scripting against the R2 client directly).
- Move translation out of `astro:config:setup` — sibling collections will see empty staging dirs.
- Hardcode locale lists in multiple places. The `astro.config.mjs` `i18n` block is the single source of truth.

## Where to look

| You want to           | Look at                                                               |
| :-------------------- | :-------------------------------------------------------------------- |
| Understand the system | `node_modules/polystella/ARCHITECTURE.md`                             |
| See config schema     | `node_modules/polystella/src/config/options.ts`                       |
| See available exports | `node_modules/polystella/package.json` (`exports` field)              |
| See CLI flags         | `polystella --help`, `polystella <subcommand> --help`                 |
| Debug a translation   | `dist/i18n-r2-report.json`, `<root>/.astro/i18n-staging/<locale>/...` |
| File an issue         | The package's GitHub repo (post-split: `cloudflare/polystella`)       |
