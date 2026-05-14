---
title: Custom loader
description: Wrapping a non-glob, non-file Astro loader to opt content into the translation pipeline.
---

Astro's content layer supports custom loaders — functions that
populate a collection's store with data from anywhere (an external
API, a database, a file format Astro doesn't natively understand).
PolyStella's `polystellaLoader` wrapper opts a custom loader into
the translation pipeline.

## The wrapper

```ts
// src/loaders/blog.ts
import { polystellaLoader } from "polystella/content";

export function blogLoader() {
  const raw = {
    name: "blog-loader",
    load: async (ctx) => {
      // Whatever your normal loader does — fetch + ctx.store.set.
    },
  };

  return polystellaLoader(raw, {
    name: "blog", // MUST match the defineCollection key
    translatableKeys: ["title", "excerpt"],
  });
}
```

`polystellaLoader` returns a wrapped loader that:

1. Stamps a non-enumerable marker
   (`__polystellaCustomLoader`) on the loader. `polystellaCollections`
   reads this at content-config time.
2. Exposes a `captureEntries()` method that runs the raw loader
   against a synthetic context (writable store, deterministic
   `generateDigest`) and returns every entry the loader called
   `store.set` on, in insertion order.

## Per-locale siblings

`polystellaCollections` auto-detects the marker and generates
sibling collections per non-default locale:

```ts
// src/content.config.ts
import { polystellaCollections } from "polystella/content";
import { blogLoader } from "./loaders/blog.ts";

export const collections = {
  ...polystellaCollections({
    source: {
      blog: defineCollection({
        loader: blogLoader(),
        schema: blogSchema,
      }),
    },
  }),
};

// Generated implicitly:
//   blog            — your source collection, unchanged.
//   blog__pt-BR     — sibling, translated entries.
//   blog__ja-JP     — sibling, translated entries.
```

## The sibling's `load()` flow

At content-sync time, the sibling collection's loader:

1. Calls `marker.captureEntries()` to get the captured array.
2. For each entry, builds the translation cache key from
   `(translatableKeys' values, glossary, model)`.
3. Looks up R2 (via the runtime bridge), translates on miss, applies
   the AI marker.
4. Calls `ctx.store.set` with the translated entry.

The single-run guarantee on `captureEntries()` means the raw loader
runs exactly once per build, regardless of how many sibling
collections call it. The first caller (source `load` or any
sibling's `load`) captures into closure state; subsequent calls
read from the cache.

## What gets translated

Only the keys in `translatableKeys` are sent to the translator.
Everything else (dates, IDs, URLs, nested objects) passes through
verbatim.

```ts
return polystellaLoader(raw, {
  name: "blog",
  translatableKeys: ["title", "excerpt"], // these go to AI
});
// `date`, `slug`, `cover`, etc. — passthrough.
```

The schema you declare on the collection's `defineCollection` call
applies to BOTH the source and the sibling. PolyStella extends it
with the optional AI-marker fields, so consumer code can read
`entry.data.aiTranslated` on translated entries.

## When to use this

Use a wrapped custom loader when your content lives outside Astro's
filesystem layer:

- Data fetched from a CMS at build time.
- Data computed from another data source (e.g. parsing a CSV).
- Data from an external API.

Don't use it for:

- File-based content. Use the regular file-glob loader; the markdown
  adapter handles it.
- Data that's too large to fit in memory. The runtime bridge holds
  every translated entry in process memory; for huge corpora,
  consider splitting into multiple collections.

## See also

- [Runtime bridge](/concepts/runtime-bridge/) — how the wrapped
  loader reaches the translator at content-sync time.
