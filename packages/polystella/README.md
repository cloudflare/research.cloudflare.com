# PolyStella

> ⚠️ **Work in progress.** PolyStella is in active development and not yet published to npm. APIs, configuration shapes, and internal behaviour may change without notice. Currently piloted on `research.cloudflare.com`; do not adopt for new projects yet.

PolyStella is an [Astro](https://astro.build) integration that translates content into additional locales at build time using AI, caches translations in Cloudflare R2, and injects locale-prefixed routes for the translated pages.

## What it does

- **Build-time translation.** Translates `.md` (and other formats — see below) into additional locales during `astro build`. Visitors get static bytes; no runtime AI calls.
- **Batched prose translation with section-aware grouping.** Long markdown files split into multiple prompt batches anchored at headings, so terminology stays consistent across sections without exceeding the model's output-token cap. Each batch carries a configurable document-context block (title, excerpt, ...) so the model has stable framing even when the body is split.
- **R2-cached.** Translations are content-addressed by source bytes + glossary + model. Unchanged pages cost zero on rebuild. Translations are never committed to the repo.
- **Pluggable file formats.** Currently Markdown, MDX, and TOML. YAML, JSON, and an OpenAPI preset are planned.
- **Per-locale model selection.** Latin-script and CJK locales can use different models.
- **Glossary control.** A YAML file per locale pins do-not-translate terms, preferred translations, and free-form translator notes. Edits to the glossary re-translate only the pages that need it.
- **Hand-translation overrides.** Drop a markdown file at `i18n/overrides/{locale}/<mirrored-path>` and it wins over AI output verbatim.
- **Internal-link rewriting.** Both inline markdown links and configured URL fields (frontmatter, structured-data) are locale-prefixed at staging. External URLs and operator-declared exemptions (`noPrefixUrls`) pass through unchanged.
- **UI-string maintenance.** Short chrome text (nav, CTAs) lives in per-locale JSON files with build-time drift detection. The CLI offers offline key reconciliation (`sync-ui`) and AI-fill of empty placeholders (`translate-ui`) so adding or removing a key in the default locale propagates to the others. Includes a React hook for client-side islands.
- **Standalone routing.** Ships its own route shim that locale-prefixes pages via injected dynamic routes. Starlight-aware mode is planned but not yet shipped.
- **CLI.** `polystella translate` runs the pipeline outside `astro build` for one-off re-translations or CI dispatch, with branch-aware R2 prefixes. Sibling subcommands (`check-ui`, `sync-ui`, `translate-ui`) handle UI-string maintenance.

## Install

PolyStella isn't on npm yet. While the package lives inside `cloudflare/research.cloudflare.com` it's consumed as a workspace member (`"polystella": "workspace:*"` in the host's `package.json`). Once the package is extracted into its own repo (planned), install will be via:

```bash
pnpm add github:cloudflare/polystella#vX.Y.Z
```

An npm publish will follow once the API has been validated by external consumers. See the project roadmap for the latest status.

## Quick start

Four files participate in a typical setup.

**1. `astro.config.mjs`** — register the integration. Locale set lives here (single source of truth).

```js
import { defineConfig } from "astro/config";
import polystella from "polystella";
import polystellaConfig from "./polystella.config.mjs";

export default defineConfig({
  i18n: {
    defaultLocale: "en-US",
    locales: ["en-US", "pt-BR", "ja-JP"],
  },
  integrations: [polystella(polystellaConfig)],
});
```

**2. `polystella.config.mjs`** — provider, glossary, R2, format-specific keys. The repo root's `polystella.config.mjs` is the working reference; every option is documented inline.

**3. `src/content.config.ts`** — register sibling content collections so Astro's content layer picks up the translations. Locale set is auto-derived from `astro.config.mjs`'s `i18n` block.

```ts
import { defineCollection } from "astro:content";
import { polystellaCollections } from "polystella/content";
import { i18nLoader, i18nSchema } from "polystella/i18n";

import { publications, people /* ... */ } from "./content-schemas";

export const collections = {
  ...polystellaCollections({
    source: { publications, people },
  }),
  // Hand-authored UI-strings collection, drift-detected at build.
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
```

**4. `src/env.d.ts`** — pick up types for PolyStella's virtual modules (`polystella:runtime-config`). Mirrors Astro's own `astro/client` pattern.

```ts
/// <reference types="polystella/client" />
```

**Custom loaders.** Collections loaded via a custom Astro loader (e.g. fetched from an external API at build time, like the research site's `blog` collection) can be translated by wrapping the raw loader with `polystellaLoader`:

```ts
// src/loaders/blog.ts
import { polystellaLoader } from "polystella/content";

export function blogLoader() {
  const raw = {
    name: "blog-loader",
    load: async (ctx) => {
      /* fetch + store.set */
    },
  };
  return polystellaLoader(raw, {
    name: "blog", // matches the defineCollection key
    translatableKeys: ["title", "excerpt"], // top-level data fields to translate
  });
}
```

`polystellaCollections` auto-detects the wrapper and generates per-locale sibling collections (`blog__pt-BR`, etc.) that translate captured entries inline at content-sync time. No `loaderOverrides` entry needed; entries flow through the same R2 cache + AI translator as file-based content. Other data fields (date, url, image, tags, …) pass through verbatim.

In a page, use `Astro.locals.getLocalizedEntry` and `Astro.locals.getLocalizedCollection` — the integration auto-registers a request middleware that pre-binds the request's locale to all four locale-aware locals (`t`, `lhref`, `getLocalizedEntry`, `getLocalizedCollection`):

```astro
---
const { t, lhref, getLocalizedEntry, getLocalizedCollection } = Astro.locals;

// Single entry — locale closed over by the middleware.
const { slug } = Astro.params;
const entry = await getLocalizedEntry("publications", slug);

// Whole collection, optionally filtered. Filter receives the merged
// shape (`LocalizedEntry<CollectionEntry<C>>`) so it can branch on
// `entry.isLocalized` / `entry.locale` if it wants — existing
// `({ data }) => ...` filters work unchanged.
const activePeople = await getLocalizedCollection("people", ({ data }) => data.type === "active");
---
```

UI strings and locale-prefixed URLs sit alongside on `Astro.locals`:

```astro
<a href={Astro.locals.lhref("/foo")}>{Astro.locals.t("nav.foo")}</a>
<img src={Astro.locals.lhref("/hero.png")} alt={Astro.locals.t("hero.alt")} />
```

`Astro.locals.t` and `Astro.locals.lhref` mirror Starlight's `Astro.locals.t` shape. The short `lhref` name keeps templates terse; the entry/collection fetchers take the full names so IDE autocomplete works against `Astro.locals.`. For non-template contexts (`getStaticPaths`, utility scripts, build helpers, React islands), import the explicit forms from `polystella/runtime` directly:

```ts
import {
  getLocalizedEntry, // (collection, id, locale?)
  getLocalizedCollection, // (collection, filter?, locale?)
  localizedHref, // (href, locale?)
} from "polystella/runtime";
```

In starlight mode, polystella defers to Starlight's i18next-backed `t` and skips that one local; the other three install in every mode. To opt out of auto-registration entirely, set `middleware: false` in your polystella config and call `polystellaMiddleware()` from `src/middleware.ts` via `astro:middleware`'s `sequence(...)`.

For non-template contexts (utility scripts, build helpers), the explicit lookups remain available:

```astro
---
import { getTranslations } from "polystella/i18n";
const t = await getTranslations(Astro.currentLocale);
---
<a href="/">{t("nav.home")}</a>
```

For React islands, fetch the dictionary server-side and consume it via the hook. Pair with `useLocalizedHref(locale)` for client-side URL prefixing:

```astro
---
import { getDictionary } from "polystella/i18n";
import { NavMenu } from "../components/NavMenu";
const navDict = await getDictionary(Astro.currentLocale, "nav");
---
<NavMenu client:load locale={Astro.currentLocale} dict={navDict} />
```

```tsx
import { useTranslations, useLocalizedHref } from "polystella/react";

export function NavMenu({ locale, dict }: { locale: string | undefined; dict: Record<string, string> }) {
  const t = useTranslations(dict);
  const link = useLocalizedHref(locale);
  return <a href={link("/foo")}>{t("nav.home")}</a>;
}
```

## CLI

The package exposes a single `polystella` binary with verb-style subcommands. Run `polystella --help` for the top-level menu or `polystella <subcommand> --help` for per-subcommand flags.

> **Breaking change (pre-1.0):** the legacy `polystella-translate` binary has been renamed to `polystella translate`. Host projects need to update any direct invocations; the suggested `pnpm translate` wrapper in the host package.json transparently redirects.

### `polystella translate` — markdown pipeline

Runs the same translation pipeline as `astro build` without booting Astro:

```bash
pnpm translate                          # run for the current git branch
pnpm translate --locale pt-BR           # one locale only
pnpm translate --file "publications/Davidson2018.md"  # one file
pnpm translate --dry-run                # log the planned R2 keys, write nothing
pnpm translate --branch main            # target main's R2 prefix explicitly
```

Exit codes: `0` success, `1` config error, `2` ≥1 (file, locale) pair failed.

### UI-strings subcommands

UI strings (`src/content/i18n/<locale>.json`) are maintained via three offline-or-online subcommands:

```bash
pnpm i18n:check                         # drift detection only, no writes (pre-commit hook target)
pnpm i18n:sync                          # mechanical: add missing keys as "", drop extras
pnpm i18n:sync -- --check               # report pending changes; non-zero exit; no writes
pnpm i18n:translate                     # sync + AI-fill empty placeholders (one batched call per locale)
pnpm i18n:translate -- --locale pt-BR   # one locale only
pnpm i18n:translate -- --sync-only      # same as `i18n:sync` (skips the AI step)
```

How it works:

- `check-ui` runs `loadAndCheckDrift` against the locale set declared in `astro.config.mjs`. Runs offline — safe to wire into a pre-commit hook (see `.githooks/pre-commit`). Catches three failure modes: missing keys, extra keys, **and empty-placeholder values** (a non-default locale has `""` where the source has a non-empty string — synced but not translated). The build's own drift check uses the same logic, so the integration also fails on these cases. Intentional blanks are supported: if the source value is `""`, the locale value being `""` is accepted as deliberate.
- `sync-ui` reconciles non-default locale key sets against the default-locale file: missing keys get an empty placeholder, extras are removed. Existing values (empty or not) are preserved, source-file key order is mirrored, and blank-line section breaks are preserved across runs so diffs stay readable.
- `translate-ui` first runs sync, then fills empty placeholders via the configured provider. One batched `translateBatch` call per locale (the marker prompt protocol is purpose-built for batching). Locales themselves run in parallel up to the `concurrency` cap in `polystella.config.mjs` (default 4) — independent file writes, independent provider calls, no shared state. A `{{token}}` preservation validator runs after each batch; failures retry with sampling variance, and if a key still can't be translated cleanly it's left empty for manual fix-up.

> **`dryRun` does NOT gate `translate-ui`.** The flag in `polystella.config.mjs` governs the markdown pipeline (R2 writes, paid provider calls, branch dispatch) where a preview-only run is genuinely useful. UI-string translation is local-file-only and small-scale; the right "skip AI" mode is `--sync-only`.

Exit codes for the UI-string subcommands: `0` clean, `1` config error, `2` for `sync-ui --check` when changes are pending or for `translate-ui` when token validation never converged. Hand-translation always wins: if you don't want AI output for a key, write the value directly in the locale JSON and `translate-ui` will skip it (only empty placeholders are filled).

## R2 cache layout

The bucket has three logical writers, distinguished automatically:

| Mode             | Trigger                         | Reads from                                       | Writes to                  |
| ---------------- | ------------------------------- | ------------------------------------------------ | -------------------------- |
| Local build      | `pnpm build` / `pnpm dev`       | `i18n/` (production)                             | nowhere — `readOnly: true` |
| CI build (main)  | Workers Builds, branch = `main` | `i18n/`                                          | `i18n/`                    |
| CI build (other) | Workers Builds, branch ≠ `main` | `previews/<branch>/i18n/`, falls back to `i18n/` | `previews/<branch>/i18n/`  |
| CLI run          | `pnpm translate`                | same as CI for the resolved branch               | same as CI                 |

A developer's local build cannot overwrite production. Preview branches stay isolated until they merge.

## Public exports

| Path                                       | Surface                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `polystella`                               | The Astro integration default export.                                                     |
| `polystella/content`                       | `polystellaCollections({ ... })`, `file()`, `polystellaLoader()` for `content.config.ts`. |
| `polystella/runtime`                       | `getLocalizedEntry`, `getLocalizedCollection`, `localizedHref`, `polystellaMiddleware`.   |
| `polystella/i18n`                          | `i18nLoader`, `i18nSchema`, `getTranslations`, `getDictionary`, drift helpers.            |
| `polystella/react`                         | `useTranslations(dictionary)` for React islands.                                          |
| `polystella/components/LocalePicker.astro` | Unstyled, accessible locale switcher.                                                     |

## Status

| Area                                 | Status          |
| ------------------------------------ | --------------- |
| Markdown adapter                     | Shipped         |
| TOML adapter                         | Shipped         |
| Workers AI provider                  | Shipped         |
| Anthropic provider                   | Shipped         |
| R2 cache + preview-branch dispatch   | Shipped         |
| CLI                                  | Shipped         |
| Manual UI strings (incl. React)      | Shipped         |
| Standalone routing + shims           | Shipped         |
| Glossary + overrides + AI marker     | Shipped         |
| Build report (`i18n-r2-report.json`) | Shipped         |
| YAML / JSON adapters                 | Planned         |
| OpenAPI preset                       | Planned         |
| MDX adapter                          | Shipped         |
| Starlight mode                       | Planned (v0.2)  |
| `hreflang` sitemap                   | Planned (v0.2)  |
| Public npm release                   | Not yet (v0.3+) |

## Tests

```bash
pnpm --filter polystella test
```

The package has 981 tests across 48 files: parsing, extraction, translation prompt round-trips, R2 cache logic (including bulk pre-list), routing, runtime dispatch (locale-aware entry / collection fetching), middleware bindings, custom-loader wrapping + sibling translation, UI-strings drift detection + sync + AI-fill, and a 9-test end-to-end smoke suite that drives the full integration against a temp project. CI runs them on every PR.

## License

Internal use only while in development. Will be open-sourced under a permissive license (TBD) ahead of the v0.3 public release.
