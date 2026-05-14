---
title: Standalone shims
description: How PolyStella generates locale-prefixed route shims that re-render source pages.
---

In standalone mode, PolyStella owns the routing layer for locale-
prefixed URLs. It does this via generated **route shims** — small
Astro files that import a source page and re-export its
`getStaticPaths` expanded over the locale set.

## What a shim looks like

For a source page `src/pages/publications/[slug].astro`, PolyStella
generates something like:

```astro
---
// .astro/polystella-shims/route-0.astro
import SourcePage, { getStaticPaths as sourceGetStaticPaths } from "../../src/pages/publications/[slug].astro";

const locales = ["pt-BR", "ja-JP"];

export async function getStaticPaths() {
  const sourcePaths = await sourceGetStaticPaths();
  return sourcePaths.flatMap((sp) =>
    locales.map((lang) => ({
      params: { ...sp.params, lang },
      props: sp.props,
    })),
  );
}
---
<SourcePage />
```

…and registers it at `/[lang]/publications/[slug]` via
`injectRoute`.

The result: a request to `/pt-BR/publications/foo` renders the same
source page template against the `pt-BR` locale entry.

## Why per-shim imports matter

Each shim's `imports` list is part of the route configuration:

```js
// polystella.config.mjs
export default {
  routes: [
    {
      source: "src/pages/publications/[slug].astro",
      imports: ["../styles/global.css"],
    },
  ],
  routesImports: ["../styles/global.css"], // applied to EVERY shim
};
```

Astro's per-route `<link rel="stylesheet">` injection only follows
direct first-degree imports of the route module. A shim that
renders a source page via `<SourcePage />` does NOT inherit the
source's transitive CSS — Astro doesn't traverse `getStaticPaths`
re-exports for asset hints.

The fix: import the CSS from the shim itself. `routesImports`
applies a global list to every shim; the per-route `imports` adds
extras. Both produce real first-degree imports that Astro's link-
injection step picks up.

## Static-shim cleanup

PolyStella nukes `<cacheDir>/polystella-shims/` at the start of
every build before regenerating. This means renaming a source page
removes the stale shim cleanly; you don't end up with phantom
routes pointing at deleted files.

## Source vs shim — who renders?

The source page is what Astro routes to at the unprefixed URL
(`/publications/foo`). The shim is what Astro routes to at the
locale-prefixed URL (`/pt-BR/publications/foo`).

Both render the same source page template. The difference is the
content the template sees — `Astro.locals.getLocalizedEntry` reads
from the per-locale sibling collection in the prefixed case.

This means source-page template code never has to special-case
"am I being rendered for a locale?". The `getLocalizedEntry`
indirection handles that.

## What happens in Starlight mode

Nothing here — Starlight mode (planned) will defer routing to
Starlight entirely. The shim mechanism is standalone-mode-specific.
