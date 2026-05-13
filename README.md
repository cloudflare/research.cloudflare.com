# Cloudflare Research

The website for Cloudflare Research, showcasing our work in building a better Internet through research and implementation.

## 🚀 Project Structure

```text
/
├── content/
│   ├── people/          # Team member profiles
│   ├── presentations/   # Research presentations
│   ├── publications/    # Research papers and publications
│   └── tags/           # Topic tags
├── public/
│   ├── fonts/
│   ├── images/
│   └── ...
├── src/
│   ├── components/
│   │   ├── home/       # Homepage-specific components
│   │   ├── ui/         # Reusable UI components
│   │   └── ...
│   ├── layouts/
│   │   ├── base.astro
│   │   └── interior.astro
│   ├── pages/
│   │   ├── focus/      # Focus area pages (Private, Safe, Fast, etc.)
│   │   ├── people/     # People directory and profiles
│   │   ├── index.astro # Homepage
│   │   └── ...
│   ├── styles/
│   │   └── global.css
│   └── lib/            # Utility functions and constants
└── package.json
```

## 🛠️ Tech Stack

- **Framework**: [Astro](https://astro.build) - Static site generator with partial hydration
- **UI Components**: React components with [Radix UI](https://www.radix-ui.com/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Content**: Astro Content Collections for type-safe content management
- **Icons**: Custom SVG sprite system via lemon-lime-svgs
- **Deployment**: Cloudflare Workers

## 🧞 Commands

All commands are run from the root of the project:

| Command               | Action                                                                                                 |
| :-------------------- | :----------------------------------------------------------------------------------------------------- |
| `pnpm install`        | Installs dependencies                                                                                  |
| `pnpm dev`            | Starts local dev server at `localhost:4321`                                                            |
| `pnpm build`          | Build your production site to `./dist/`                                                                |
| `pnpm preview`        | Preview your build locally, before deploying                                                           |
| `pnpm icons`          | Generate SVG sprite from icons in `/other/svg-icons`                                                   |
| `pnpm ui`             | Add shadcn/ui components                                                                               |
| `pnpm translate`      | Run the PolyStella markdown translation pipeline standalone (no Astro build). See _Translation_ below. |
| `pnpm translate:dry`  | Same as `translate` but skips the provider + R2 writes; only prints planned R2 keys.                   |
| `pnpm i18n:check`     | Detect drift in UI-string JSONs (`src/content/i18n/`). Runs offline; pre-commit hook target.           |
| `pnpm i18n:sync`      | Reconcile non-default UI-string locales against `en-US.json` (add missing keys as empty, drop extras). |
| `pnpm i18n:translate` | `i18n:sync`, then AI-fill empty placeholders via the configured provider.                              |

## 📝 Content Management

Content is managed through Astro's Content Collections located in the `/content` directory:

- **People**: Team member profiles with avatars, positions, and bios
- **Publications**: Research papers with authors, years, and related interests
- **Presentations**: Conference talks and keynotes
- **Tags**: Topic categorization for filtering content

### Featured Research

Within the [`/content/site.toml`](./content/site.toml) file, you can configure the featured research section on the homepage. It must follow this structure:

```toml
[main.featuredResearch]
publication = "publication-slug"
title = "Publication Title"
description = "Publication description"
link = "/publication-slug"
buttonLabel = "Read the Full Article"
```

### People

All people are located within the [`/content/people`](./content/people) directory.

They must follow this structure:

```markdown
---
title: "Person's Name"
position: "Position"
author_name: "Person's Name"
status: "current" | "inactive"
twitter: "twitter-handle"
bluesky: "bluesky-handle"
blog_author: "blog-author"
avatar: "/images/people/person-name.jpg"
slug: "person-name"
type: "active" | "alumni" | "external" | "intern" | "inactive"
---
```

Only `active` and `alumni` types are displayed on the team page.

Avatars are stored in the [`/public/images/people`](./public/images/people) directory and should be named after the person's slug.

### Publications

All publications are located within the [`/content/publications`](./content/publications) directory.

They must follow this structure:

```markdown
---
title: "Publication Name"
year: year
location: "Location"
authors:
  - author-slug
url: https://example.com
doi: doi
related_interests:
  - related-interest-slug
pillar: "fast" | "private" | "safe" | "reliable" | "measurable"
tags:
  - tag-slug
---

Publication content
```

### Presentations

All presentations are located within the [`/content/presentations`](./content/presentations) directory.

They must follow this structure:

```markdown
---
title: "Presentation Name"
youtube: "youtube-url"
thumbnail: "thumbnail-url"
year: year
---

Presentation content
```

### Tags

Tags are maintained in the [`/content/tags`](./content/tags) directory. They are used to categorize publications and presentations.

Tags must follow this structure:

```toml
---
name: "Tag Name"
slug: "tag-slug"
description: "Tag description"
color: "pink"
---
```

When you want to link a tag to a publication or presentation, you can do so by adding the tag slug to the `tags` array in the frontmatter of the content file (see [Publications](#publications) for an example).

## 🎨 Design System

The site uses a custom design system with:

- Responsive breakpoints: mobile (< 640px), tablet (640px-1024px), desktop (1024px+)
- Dark mode support via CSS custom properties
- Custom utility classes for headings, subheadings, and layout components
- Focus areas with distinct visual identities

## � Key Features

- **Focus Areas**: Five research pillars (Private, Safe, Fast, Reliable, Measurable)
- **Publications Grid**: Filterable grid of research papers and blog posts
- **People Directory**: Team member profiles with publications
- **Presentations**: Video presentations and keynotes
- **Responsive Navigation**: Mobile hamburger menu with full-screen overlay
- **Featured Research**: Highlighted research on homepage

## 📱 Responsive Design

The site is fully responsive with:

- Mobile-first approach
- Hamburger menu for mobile navigation
- Adaptive grids (1, 2, or 3 columns based on screen size)
- Responsive typography and spacing
- Touch-friendly interactive elements

## 🌐 Translation (PolyStella)

Locale-aware content is translated by [PolyStella](./packages/polystella/), a workspace-local Astro integration. Translations are computed by Workers AI and cached in an R2 bucket; on subsequent builds, unchanged content hits the cache and the provider is never called.

### Running translations standalone

The translation pipeline normally runs as part of `astro build` in CI. Locally, `pnpm build` and `pnpm dev` are read-only against R2 (see _Branch-isolated cache_ below) — you read main's translations but cannot write to the cache. Repeat local builds are fast: a per-pair on-disk index at `.astro/i18n-staging/.polystella-index.json` short-circuits unchanged content so a second consecutive build does zero R2 round-trips and zero translator calls.

To actually translate new content into R2 from a developer's machine, use the standalone CLI:

```sh
pnpm translate                                   # writes to current git branch's preview prefix (auto-detected)
pnpm translate:dry                               # preview the planned R2 keys; no provider/R2 calls
pnpm translate --branch my-feature               # target previews/my-feature/i18n/ regardless of git checkout
pnpm translate --branch main --locale ja-JP      # re-translate one locale into production's prefix (loud, explicit)
pnpm translate --file 'publications/foo.md'     # restrict to a single source file
pnpm translate --prefix 'custom/i18n/'          # direct r2.prefix override (escape hatch)
pnpm translate --report ./tmp/report.json       # emit the build report to a custom path
```

Branch resolution is `--branch` flag → `WORKERS_CI_BRANCH` env → `git rev-parse HEAD`. If git is unavailable or HEAD is detached, the CLI errors with a hint to pass `--branch` explicitly. Run `pnpm translate --help` for the full flag list.

Both `pnpm translate ...` and the explicit `pnpm translate -- ...` (POSIX `--` separator) forms work; pnpm forwards the trailing args either way.

### UI-string maintenance

The chrome text (nav labels, footer copy, accessibility strings) lives in `src/content/i18n/<locale>.json` as flat key→string dictionaries. The default-locale file (`en-US.json`) is the source of truth; non-default locales must have the same key set or the build fails. Three commands keep the locales aligned:

```sh
pnpm i18n:check               # drift detection only; Runs offline (pre-commit hook target)
pnpm i18n:sync                # add missing keys (value: ""), drop extras, preserve existing values
pnpm i18n:sync -- --check     # report pending changes without writing; non-zero exit if any
pnpm i18n:translate           # i18n:sync + AI-fill empty placeholders (one batched call per locale)
pnpm i18n:translate -- --locale pt-BR     # one locale only
pnpm i18n:translate -- --sync-only        # same as `i18n:sync` (no AI step)
```

The intended workflow when adding or editing UI strings:

1. Edit `src/content/i18n/en-US.json` — add, remove, or change keys.
2. Run `pnpm i18n:translate` to propagate the changes through the other locales.
3. Spot-check the translations; hand-edit any keys where you want exact wording (the AI step only fills _empty_ values, so a hand-written value stays untouched on subsequent runs).
4. Commit. The pre-commit hook runs `pnpm i18n:check` automatically when `src/content/i18n/` is staged, so an out-of-sync or untranslated tree won't ship by accident.

`pnpm i18n:check` fails on three things: missing keys, extra keys, **and empty-placeholder values** in any non-default locale (a `""` where the source has a non-empty string). The latter catches the "I ran `sync` but forgot `translate`" mistake — running `sync` alone leaves the tree in a state that won't pass the check or the build. If you genuinely want a blank label in every locale, set it to `""` in `en-US.json` too and the check skips it.

`{{token}}` placeholders (e.g. `Copyright ©{{year}}.`) are validated post-translation; if the AI drops or renames a token after all retries the key is left empty for manual fix-up rather than shipped broken. Hand-edit those in the locale JSON and re-run.

### Shim CSS imports

Translated routes are emitted via PolyStella's shim system: a small `.astro` file in `node_modules/.astro/polystella-shims/route-N.astro` imports the source page and renders it under a locale-prefixed pattern (`/[lang]/<slug>`). Astro's per-route `<link rel="stylesheet">` injection follows direct first-degree CSS imports of the route's own module — but it does NOT follow CSS through `<SourcePage />` rendered as a child component. Without intervention, every translated route would ship to `dist/` with no stylesheet link, rendering as raw HTML in the browser.

`polystella.config.mjs` solves this with `routesImports: ["./src/styles/global.css"]`. The listed CSS files become side-effect imports at the top of every shim's frontmatter, putting them in the shim's direct module graph. Vite groups CSS by module graph, and Astro emits the right `<link>` tags. For per-route exceptions, `routes` also accepts the object form:

```js
routes: [
  "src/pages/index.astro",
  { source: "src/pages/[slug].astro", imports: ["./src/styles/publication.css"] },
],
```

This codebase ships all CSS in a single Vite chunk (everything routes through `BaseLayout` → `global.css`), so the global `routesImports` entry covers all shimmed pages. If a future page introduces a CSS file Vite chunks separately, add it to the relevant route's `imports` or to the global `routesImports`.

### Local staging cache

After every translation pass (build, dev, or CLI), the orchestrator persists a small JSON index at `<root>/.astro/i18n-staging/.polystella-index.json` mapping `<locale>::<sourcePath>` to the source hash that was last staged. On the next run, any pair whose source hash matches the index entry — and whose staged file is still on disk — short-circuits before R2 is queried. The build report records these as `local-skipped` so you can see how much work the cache saved.

The cache is content-addressed (the source hash folds in body, frontmatter, glossary, and model id), so any change to those re-translates automatically. To force a full re-translate, delete the index file or the entire staging directory:

```sh
rm .astro/i18n-staging/.polystella-index.json    # re-fetch on next run, keep staged files on disk
rm -rf .astro/i18n-staging/                       # full reset; next run repopulates from R2
```

The index is gitignored (it lives under `.astro/`).

### Branch-isolated cache

`polystella.config.mjs` dispatches the R2 configuration based on two env-var signals:

- `WORKERS_CI_BRANCH` — set automatically by Cloudflare Workers Builds in CI. Unset in any local shell.
- `POLYSTELLA_CLI=1` — set by `cli.ts` before the config loads. Marks an explicit `pnpm translate` invocation.

Three resulting modes:

| Mode               | Detection                                 | `r2.prefix`                         | `r2.readFallbackPrefixes` | `r2.readOnly` | Behaviour                                                                                                                                                              |
| :----------------- | :---------------------------------------- | :---------------------------------- | :------------------------ | :------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local build        | neither env var set                       | `i18n/`                             | _(none)_                  | `true`        | `pnpm build` / `pnpm dev` reads main's cache; on miss, translates locally and stages without writing to R2. A developer's machine can never overwrite production data. |
| CI build (main)    | `WORKERS_CI_BRANCH=main`                  | `i18n/`                             | _(none)_                  | `false`       | Production cache; the sole writer of `i18n/`.                                                                                                                          |
| CI build (preview) | `WORKERS_CI_BRANCH=<other>`               | `previews/<sanitized-branch>/i18n/` | `["i18n/"]`               | `false`       | Preview cache; reads main's translations on miss, only writes its own variants under `previews/`.                                                                      |
| Explicit CLI       | `POLYSTELLA_CLI=1` + branch-from-anywhere | as above (per resolved branch)      | as above                  | `false`       | `pnpm translate` writes to R2 per the branch's prefix. Branch resolution: `--branch` flag → `WORKERS_CI_BRANCH` env → `git rev-parse HEAD`.                            |

Branch names containing `/`, `.`, `+`, or other non-alphanumeric characters are sanitized to a single flat segment — `diogo/polystella-v1` becomes `previews/diogo-polystella-v1/i18n/`. Sanitization rule (`[^a-zA-Z0-9_-]+` → `-`, trim leading/trailing `-`) lives in `polystella.config.mjs`.

Per-branch isolation means a PR build can re-translate edited files without polluting production's cache, while still reusing main's bytes for unchanged content (no double-translation cost). Local builds never write at all; the explicit CLI is the only way to populate non-main caches from outside CI.

### R2 lifecycle (operator action)

Configure a lifecycle rule on the `research-i18n-cache` bucket to expire objects under `previews/` after 30 days. This bounds storage cost as PRs come and go without requiring an explicit cleanup step on PR close. Production's `i18n/` prefix is exempt (no lifecycle rule there).

The polystella package itself prunes within its configured `prefix` only, so a preview build can never accidentally evict production variants — the lifecycle rule handles cross-build cleanup of orphan preview prefixes.

### Sitemap hreflang annotations

`@astrojs/sitemap` doesn't auto-detect Astro's `i18n` configuration; its own `i18n` option has to be passed in and kept in sync with `astro.config.mjs`'s locale list. Without that option, every locale-prefixed URL PolyStella injects appears in the sitemap as a stand-alone entry with no `<xhtml:link rel="alternate" hreflang="…">` annotation — search engines then treat the language variants as duplicate content instead of alternate-language pages, dilutes ranking signals, and risks wrong-locale targeting (e.g. surfacing the English page to a Spanish-language searcher even though `/es-ES/foo` exists).

PolyStella exports a small synchronous helper, `astroSitemapI18n`, that derives the i18n-driven sitemap options from the same Astro `i18n` block. Wire it like this in `astro.config.mjs`:

```js
import polystella, { astroSitemapI18n } from "polystella";

// Hoist `i18n` out of defineConfig so the same object feeds Astro
// routing, PolyStella translation, AND the sitemap helper. One source
// of truth for the locale list; the three integrations stay in sync.
const i18n = {
  defaultLocale: "en-US",
  locales: ["en-US", "pt-BR", "ja-JP", "es-ES"],
  routing: { prefixDefaultLocale: false },
};

export default defineConfig({
  i18n,
  integrations: [sitemap(astroSitemapI18n(i18n, { hreflang: { en: "en-US" } })), polystella(polystellaConfig)],
});
```

The helper returns `{ i18n, serialize }` — both top-level `@astrojs/sitemap` options. `i18n` wires the integration's built-in alternates support so each URL emits `<xhtml:link rel="alternate" hreflang="…">` annotations grouping it with its sibling-language variants. `serialize` appends a `hreflang="x-default"` annotation pointing at the default-locale URL, a recommended SEO best practice that tells search engines which URL to fall back to when no preferred-language match is available.

Compose with other sitemap options via spread:

```js
sitemap({
  ...astroSitemapI18n(i18n, { hreflang: { en: "en-US" } }),
  filter: (page) => !page.includes("/draft/"),
});
```

Validation: `defaultLocale` must appear in `locales`, locale codes must be unique, and any `hreflang` override key must match a configured locale. Default behavior is identity-mapping (locale code is its own hreflang); the optional `hreflang` map is for cases where the URL prefix differs from the BCP 47 string you want emitted (most commonly `en` URL → `en-US` hreflang). The object form of Astro locales (`{ codes: [...], path: "..." }`, used for multi-code path groups) is currently rejected — configure `@astrojs/sitemap`'s `i18n` option manually for that case.

Pass `xDefault: false` to skip the `serialize` callback if you'd rather rely on per-locale `Accept-Language` matching alone, or if you're authoring a custom `serialize` that handles `x-default` differently.

The result is `<url>` entries grouped with their `<xhtml:link rel="alternate" hreflang="…">` annotations plus `x-default` — the SEO-correct shape for indexable multilingual content. Each language variant lists every other variant as an alternate; search engines consolidate ranking signals across the group and serve the best language match per user, falling back to `x-default` when no language matches.

## 🚢 Deployment

The site is deployed on Cloudflare Workers with automatic deployments (via Workers Builds) from the main branch. PR previews are built and deployed automatically; their translation pass uses the branch-isolated cache described under _Translation_ above.
