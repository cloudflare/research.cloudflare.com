---
title: Configuration overview
description: Where polystella.config.mjs sits and how it relates to astro.config.mjs.
---

PolyStella's configuration lives in two files. Knowing which goes
where avoids a lot of confusion:

| Where                     | What lives there                                       |
| ------------------------- | ------------------------------------------------------ |
| `astro.config.mjs` `i18n` | `defaultLocale`, `locales`, Astro's i18n routing knobs |
| `polystella.config.mjs`   | Everything else: provider, R2, glossary, format keys   |

The split is deliberate. `i18n` is Astro's domain — every Astro
integration that cares about locales reads it from there, and the
build's URL routing flows through it. PolyStella reads it too, but
doesn't own it; you only declare your locale set once.

`polystella.config.mjs` exports a default object whose shape is the
schema documented in the
[full reference](/configuration/reference/). All fields are
optional in the sense that the schema has defaults, but you'll
need to set at minimum:

- `provider` — credentials for Workers AI or Anthropic.
- `r2` — credentials for the build cache (or omit for an
  uncached, dev-only setup).
- `markdown.keys` (or whichever adapter's `keys`) — which
  frontmatter fields to translate.

A minimal config:

```js
// polystella.config.mjs
export default {
  provider: {
    kind: "workers-ai",
    accountId: process.env.CF_ACCOUNT_ID,
    apiToken: process.env.CF_API_TOKEN,
    model: "@cf/meta/llama-3.1-8b-instruct",
  },
  r2: {
    accountId: process.env.CF_ACCOUNT_ID,
    bucket: "my-i18n-cache",
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  markdown: {
    keys: { "publications/**": ["title", "metaDescription"] },
  },
};
```

## Validation and errors

The config is parsed through zod at integration startup
(`resolveOptions` in `src/config/options.ts`). Bad input fails the
build with a concrete error pointing at the offending field — no
silent fallbacks. A few specific cross-checks:

- `defaultLocale` must appear in `locales`.
- The same key path can't appear in both `<format>.keys` and
  `<format>.urls` for the same glob — that would double-process the
  field.
- `mode: "starlight"` is rejected at parse time; that mode is
  planned but not yet shipped.

## Branch-aware configuration

PolyStella reads `WORKERS_CI_BRANCH` from the environment. Workers
Builds exports this automatically. Your config can use it to switch
R2 prefixes:

```js
const branch = process.env.WORKERS_CI_BRANCH ?? "local";

export default {
  r2: {
    // ...
    prefix: branch === "main" ? "i18n/" : `previews/${branch}/i18n/`,
    readFallbackPrefixes: branch === "main" ? [] : ["i18n/"],
    readOnly: branch !== "main" && !process.env.POLYSTELLA_CLI,
  },
};
```

The [branch-dispatch operations page](/operations/branch-dispatch/)
covers the patterns. See also [preview
isolation](/operations/preview-isolation/) for how `readOnly` plus
`readFallbackPrefixes` give preview branches the production cache
without polluting it.

## Schema source of truth

The [reference page](/configuration/reference/) is **auto-generated**
from `src/config/options.ts` on every docs build. If you spot a
field there that isn't documented, it's a generator gap, not a
hidden feature — file an issue.
