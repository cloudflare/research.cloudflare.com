---
title: Explicit imports
description: Calling polystella/runtime functions directly outside .astro templates.
---

`Astro.locals` only exists in request-scoped contexts (`.astro`
templates, middleware). When you need the same lookups from
elsewhere — `getStaticPaths`, build scripts, React islands — use
the explicit imports.

## The functions

```ts
import {
  getLocalizedEntry, // (collection, id, locale?)
  getLocalizedCollection, // (collection, filter?, locale?)
  localizedHref, // (href, locale?)
} from "polystella/runtime";
```

Each takes the locale as a (typically last) optional parameter
instead of closing over it the way the `Astro.locals` variants do.

## `getLocalizedEntry(collection, slug, locale?)`

```ts
import { getLocalizedEntry } from "polystella/runtime";

const entry = await getLocalizedEntry("publications", "Davidson2018", "pt-BR");
```

When `locale` is omitted, falls back to default locale.

Returns `LocalizedEntry<...> | undefined` — same shape as the
`Astro.locals` variant.

## `getLocalizedCollection(collection, filter?, locale?)`

```ts
import { getLocalizedCollection } from "polystella/runtime";

const ptBR = await getLocalizedCollection("people", undefined, "pt-BR");
const active = await getLocalizedCollection("people", ({ data }) => data.active, "ja-JP");
```

## `localizedHref(href, locale?)`

```ts
import { localizedHref } from "polystella/runtime";

localizedHref("/about", "pt-BR"); // "/pt-BR/about"
localizedHref("/about"); // "/about" (default locale)
localizedHref("https://x.com", "pt-BR"); // unchanged
```

## When to use these

- **`getStaticPaths`** — Astro runs this at build time, before
  request handlers exist. `Astro.locals` is unavailable; explicit
  imports are the only option.
- **Build scripts** — anything that runs outside Astro's request
  loop.
- **React islands** that need to compute URLs server-side at
  prerender time. Use the [React hooks](/runtime-api/react-hooks/)
  for client-side dispatch.

## When NOT to use these

In `.astro` templates and middleware, use `Astro.locals` instead.
The explicit imports work but force you to thread `locale`
everywhere, which is noisy.

## Example: per-locale sitemap

```ts
// src/scripts/build-sitemap.ts
import { getLocalizedCollection } from "polystella/runtime";

for (const locale of ["en-US", "pt-BR", "ja-JP"]) {
  const pubs = await getLocalizedCollection("publications", undefined, locale);
  for (const pub of pubs) {
    console.log(`${locale}: ${pub.id}`);
  }
}
```

This wouldn't work via `Astro.locals` — there's no request scope.
