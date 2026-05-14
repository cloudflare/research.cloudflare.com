---
title: Monorepo setup
description: Using PolyStella inside a pnpm workspace.
---

PolyStella itself is currently consumed as a workspace member
inside the host research-site monorepo, so this pattern is well-
exercised.

## Workspace structure

```text
my-monorepo/
├── pnpm-workspace.yaml
├── packages/
│   ├── polystella/             # the package
│   └── site/                   # the Astro site consuming it
└── apps/
    └── docs/                   # additional Astro site (optional)
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

## Consuming polystella

In `apps/site/package.json`:

```json
{
  "dependencies": {
    "polystella": "workspace:*"
  }
}
```

`pnpm install` symlinks the workspace package; `pnpm dev` and
`pnpm build` run against live source.

## Shared config

If multiple sites need PolyStella, a shared `polystella.config.mjs`
can live at the workspace root and each site imports + overrides:

```js
// apps/site/polystella.config.mjs
import baseConfig from "../../polystella.config.mjs";

export default {
  ...baseConfig,
  markdown: {
    ...baseConfig.markdown,
    keys: {
      ...baseConfig.markdown.keys,
      "site-specific/**": ["heading", "subheading"],
    },
  },
};
```

This pattern keeps provider credentials and R2 setup in one place,
while letting each site declare its own content shape.

## CI workflow

Workers Builds runs one site at a time, so each site needs its
own build config. The R2 bucket can be shared across sites if
you use distinct `r2.prefix` values:

```js
// apps/site/polystella.config.mjs
r2: { prefix: "sites/main/i18n/", ... }

// apps/docs/polystella.config.mjs
r2: { prefix: "sites/docs/i18n/", ... }
```

Different prefixes mean the caches don't collide.

## Cross-site translation reuse

If two sites have overlapping content, they don't share cache
entries — the cache key is per-file and the file paths differ.
You can't really "reuse" translations across sites.

If you want shared translation for a specific subset (e.g. a
glossary of brand terms), put that in the **glossary** instead of
relying on the cache. The glossary applies to every page in every
site that loads it.
