# PolyStella

> ⚠️ **Work in progress.** PolyStella is in active development and not yet published to npm. APIs, configuration shapes, and internal behaviour may change without notice. Currently piloted on `research.cloudflare.com`; do not adopt for new projects yet.

PolyStella is an [Astro](https://astro.build) integration that translates content into additional locales at build time using AI, caches translations in Cloudflare R2, and injects locale-prefixed routes for the translated pages.

The full design lives in `polystella-design-collections-c011ec.md`; this README is a quick orientation.

## What it does

- **Build-time translation.** Translates `.md` (and other formats — see below) into additional locales during `astro build`. Visitors get static bytes; no runtime AI calls.
- **R2-cached.** Translations are content-addressed by source bytes + glossary + model. Unchanged pages cost zero on rebuild. Translations are never committed to the repo.
- **Pluggable file formats.** Currently Markdown, MDX, and TOML. YAML, JSON, and an OpenAPI preset are planned.
- **Per-locale model selection.** Latin-script and CJK locales can use different models.
- **Glossary control.** A YAML file per locale pins do-not-translate terms, preferred translations, and free-form translator notes. Edits to the glossary re-translate only the pages that need it.
- **Hand-translation overrides.** Drop a markdown file at `i18n/overrides/{locale}/<mirrored-path>` and it wins over AI output verbatim.
- **Internal-link rewriting.** Both inline markdown links and configured URL fields (frontmatter, structured-data) are locale-prefixed at staging. External URLs and operator-declared exemptions (`noPrefixUrls`) pass through unchanged.
- **Manual UI strings.** Short chrome text (nav, CTAs) stays hand-authored with build-time drift detection across locales. Includes a React hook for client-side islands.
- **Standalone or Starlight.** Ships its own route shim today (standalone). Starlight integration is the next milestone.
- **CLI.** `pnpm translate` runs the pipeline outside `astro build` for one-off re-translations or CI dispatch, with branch-aware R2 prefixes.

## Install

TODO: Update to refer to install via github

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
  const raw = { name: "blog-loader", load: async (ctx) => { /* fetch + store.set */ } };
  return polystellaLoader(raw, {
    name: "blog",                          // matches the defineCollection key
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
  getLocalizedEntry,        // (collection, id, locale?)
  getLocalizedCollection,   // (collection, filter?, locale?)
  localizedHref,            // (href, locale?)
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

`polystella-translate` runs the same pipeline as `astro build` without booting Astro:

```bash
pnpm translate                          # run for the current git branch
pnpm translate --locale pt-BR           # one locale only
pnpm translate --file "publications/Davidson2018.md"  # one file
pnpm translate --dry-run                # log the planned R2 keys, write nothing
pnpm translate --branch main            # target main's R2 prefix explicitly
```

Exit codes: `0` success, `1` config error, `2` ≥1 (file, locale) pair failed.

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

| Path                                       | Surface                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `polystella`                               | The Astro integration default export.                                          |
| `polystella/content`                       | `polystellaCollections({ ... })`, `file()`, `polystellaLoader()` for `content.config.ts`. |
| `polystella/runtime`                       | `getLocalizedEntry`, `getLocalizedCollection`, `localizedHref`, `polystellaMiddleware`. |
| `polystella/i18n`                          | `i18nLoader`, `i18nSchema`, `getTranslations`, `getDictionary`, drift helpers. |
| `polystella/react`                         | `useTranslations(dictionary)` for React islands.                               |
| `polystella/components/LocalePicker.astro` | Unstyled, accessible locale switcher.                                          |

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

## Documentation

- **Design doc** — `polystella-design-collections-c011ec.md` (root of this workspace's plans directory). Architecture, mode boundary, public surface, roadmap.
- **Engineering RFC** — `polystella-rfc-collections-c011ec.md`. Implementation-level detail.
- **Reference config** — `polystella.config.mjs` at the repo root. Every option, with inline commentary.

## Tests

```bash
pnpm --filter polystella test
```

The package has ~940 unit tests across parsing, extraction, translation prompt round-trips, R2 cache logic, routing, runtime dispatch (locale-aware entry / collection fetching), middleware bindings, custom-loader wrapping + sibling translation, and UI-strings drift detection. CI runs them on every PR.

## License

Internal use only while in development. Will be open-sourced under a permissive license (TBD) ahead of the v0.3 public release.
