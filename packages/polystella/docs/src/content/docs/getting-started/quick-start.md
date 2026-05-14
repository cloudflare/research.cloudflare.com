---
title: Quick start
description: "Five-minute setup — the four files that participate in a typical PolyStella project."
---

Four files participate in a typical PolyStella setup. None of them
are owned by PolyStella; you wire it into your existing Astro project
by adding configuration in the right places.

## 1. `astro.config.mjs` — register the integration

The locale set lives here. PolyStella reads `defaultLocale` and
`locales` from Astro's `i18n` block — there's no second source of
truth.

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

## 2. `polystella.config.mjs` — provider, glossary, R2

This file holds everything that isn't a locale. Provider credentials,
the R2 cache configuration, glossary file pattern, and per-format
key configuration (which frontmatter fields to translate, which URL
fields to locale-prefix).

See the [configuration reference](/configuration/reference/) for
every option. The simplest possible file:

```js
export default {
  provider: {
    kind: "workers-ai",
    accountId: process.env.CF_ACCOUNT_ID,
    apiToken: process.env.CF_API_TOKEN,
    model: "@cf/meta/llama-3.1-8b-instruct",
  },
  markdown: {
    keys: { "publications/**": ["title", "metaDescription"] },
  },
};
```

## 3. `src/content.config.ts` — register sibling collections

PolyStella generates per-locale sibling content collections that
mirror your source collections. Astro's content layer picks them up
through a normal `defineCollection` registration — the difference is
that PolyStella's helper builds the per-locale variants for you.

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

## 4. `src/env.d.ts` — pick up runtime-config types

PolyStella's virtual modules need a reference in your env types,
mirroring Astro's own `astro/client` pattern:

```ts
/// <reference types="polystella/client" />
```

## Custom loaders

Collections loaded via a custom Astro loader — fetched from an
external API at build time, for instance — can be translated by
wrapping the raw loader with `polystellaLoader`:

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
    translatableKeys: ["title", "excerpt"],
  });
}
```

`polystellaCollections` auto-detects the wrapper and generates
per-locale sibling collections (`blog__pt-BR`, etc.) that translate
captured entries inline at content-sync time. Entries flow through
the same R2 cache + AI translator as file-based content.

## Using translated content in pages

The integration auto-registers a request middleware that pre-binds
the request's locale to four `Astro.locals` properties:

```astro
---
const { t, lhref, getLocalizedEntry, getLocalizedCollection } = Astro.locals;

// Single entry — locale closed over by the middleware.
const { slug } = Astro.params;
const entry = await getLocalizedEntry("publications", slug);

// Whole collection, optionally filtered. Filter receives the merged
// shape (`LocalizedEntry<CollectionEntry<C>>`) so it can branch on
// `entry.isLocalized` / `entry.locale`.
const activePeople = await getLocalizedCollection(
  "people",
  ({ data }) => data.type === "active",
);
---
```

UI strings and locale-prefixed URLs sit alongside on `Astro.locals`:

```astro
<a href={Astro.locals.lhref("/foo")}>{Astro.locals.t("nav.foo")}</a>
<img src={Astro.locals.lhref("/hero.png")} alt={Astro.locals.t("hero.alt")} />
```

For non-template contexts (`getStaticPaths`, utility scripts, build
helpers, React islands), import the explicit forms from
`polystella/runtime`:

```ts
import {
  getLocalizedEntry, // (collection, id, locale?)
  getLocalizedCollection, // (collection, filter?, locale?)
  localizedHref, // (href, locale?)
} from "polystella/runtime";
```

## What happens at build time

When you run `astro build`:

1. PolyStella walks `sourceDir` for files matching `include`.
2. For each `(file, locale)` pair, it computes a content hash from
   the source bytes, glossary, and resolved model id.
3. It checks Cloudflare R2 for a cached translation at that hash.
4. On miss, it calls the configured provider and stores the result.
5. Translated bytes land in `<root>/.astro/i18n-staging/{locale}/...`
   where the per-locale sibling collections read them.
6. Astro then routes `/[lang]/...` URLs through generated shims that
   render your source page template against the localised entry.

The whole pipeline is documented in detail under
[Concepts → How it works](/concepts/how-it-works/).
