---
title: Route configuration
description: "The routes and routesImports options."
---

Two `polystella.config.mjs` options control which source pages get
locale-prefixed shims and what they import.

## `routes`

A list of source page paths to wrap with shims. Each entry is
either:

- **A string** — path to a source page relative to project root.
  Equivalent to `{ source: <path>, imports: [] }`.
- **An object** — `{ source: <path>, imports?: string[] }`. The
  `imports` are extra modules threaded into the shim's frontmatter
  beyond what `routesImports` provides.

```js
routes: [
  "src/pages/publications/[slug].astro",
  {
    source: "src/pages/people/[slug].astro",
    imports: ["../../styles/people.css"],
  },
];
```

The wrapper-string form is shorthand for the most common case.

## `routesImports`

A list of imports threaded into **every** shim's frontmatter, in
addition to per-route `imports`:

```js
routesImports: ["../../styles/global.css"];
```

Use this for global CSS (or any other module) that every shim
needs. The combined import list is `[...routesImports, ...route.imports]`
in that order; duplicates are deduped.

## Why import paths look strange

The `imports` paths are **relative to the shim's location in
`<cacheDir>/polystella-shims/`**, NOT relative to your source page.
Astro's compiler resolves these against the shim file's directory.

```text
<root>/.astro/polystella-shims/route-0.astro    ← shim
<root>/src/pages/publications/[slug].astro       ← source page
<root>/src/styles/global.css                     ← CSS

import "../../styles/global.css";  ← path from the SHIM
```

This is awkward but necessary; the shim is a real file and its
import resolution follows real-file rules.

PolyStella's docs site doesn't have a "compute the right relative
path" helper for you. The pattern that works is:

- Drop `../../` for every level of nesting under `src/pages/`.
- Then point at the asset from the project root.

## What's NOT a `routes` entry

Pages that don't need a locale-prefixed variant. Examples:

- Static legal pages that exist in one locale only.
- API routes (`src/pages/api/...`).
- The 404 page.
- Pages whose template doesn't read from `Astro.locals.getLocalizedEntry`.

If a page doesn't appear in `routes`, PolyStella ignores it
entirely — no shim, no `/[lang]/...` variant.

## When the shim breaks

If a source page's `getStaticPaths` does something unusual (returns
no params; uses dynamic imports the shim can't traverse), the shim
generation can produce a file Astro rejects. The error surfaces at
`astro build` time as a Rollup or compile error pointing at
`.astro/polystella-shims/route-N.astro`.

Diagnose by opening that file. The source code is short and the
intent should be obvious; if the import path is wrong, fix
`routesImports` / per-route `imports`.

See ARCHITECTURE.md `#routing-shims` for the implementation
detail.
