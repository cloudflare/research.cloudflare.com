---
title: Runtime bridge
description: The seam between config-time and content-sync-time for custom-loader translation.
---

Most of PolyStella runs at `astro:config:setup`. File-based content
collections work because the source is already on disk when the
integration walks the filesystem.

Custom loaders — anything wrapped with `polystellaLoader` — work
differently. The loader's `load(ctx)` function fetches data at
content-sync time, which is AFTER `config:setup` finishes. There's
no way to know the entry contents during the translation pass; the
fetch hasn't happened yet.

The **runtime bridge** is how PolyStella bridges this gap.

## The flow

1. **`astro:config:setup`** — the integration runs the translation
   pass over file-based content as usual. It builds an in-memory
   bridge object containing the R2 client, translator instances,
   glossary maps, and configuration, then registers it on
   `globalThis`.

2. **Content-sync time** — Astro evaluates `content.config.ts`.
   The wrapped custom loader runs; its raw `load(ctx)` populates
   the store. PolyStella's auto-generated sibling collection
   (`<name>__<locale>`) calls `captureEntries()` on the marker,
   walks the captured entries, translates each one inline against
   the runtime bridge, and writes the result into its own per-
   locale store.

3. **Render time** — `Astro.locals.getLocalizedEntry("blog", id)`
   reads from the per-locale sibling collection like any other
   collection. The fact that the data came from a custom loader
   instead of files is invisible.

## Why a global

The bridge has to be discoverable from inside the sibling
collection's `load(ctx)` function, which runs in a context the
integration doesn't directly control. The options were:

- Module-level singleton in `polystella/runtime`. Works but is
  fragile if `vite` reloads the module mid-build.
- `globalThis` symbol-keyed property. Survives Vite module
  reloads. The chosen approach.
- Pass through Astro's hooks. Astro doesn't expose a stable hook
  that fires between `config:setup` and content sync.

The `globalThis` approach has one constraint: the bridge has to
be live when the sibling loader runs. The integration takes care
of this; you only see the consequences if you do something exotic
like running multiple Astro builds in parallel within the same
Node process. Don't.

## What's on the bridge

```ts
interface PolystellaRuntimeBridge {
  defaultLocale: string;
  polystellaVersion: string;
  context?: string; // user-supplied prompt context
  r2: R2Client | null;
  r2Prefix?: string;
  r2ReadOnly: boolean;
  readFallbackPrefixes: ReadonlyArray<string>;
  stagingDir: string;
  translatorsByLocale: Map<string, Translator>;
  glossariesByLocale: Map<string, Glossary>;
  glossaryHashByLocale: Map<string, string>;
  concurrency: number;
  reportSink: CustomLoaderTranslateRecord[];
}
```

Sibling loaders read what they need (translator, glossary, R2
client, config) and write per-entry outcomes to `reportSink`. The
sink is drained at `astro:build:done` so the build report
includes custom-loader entries alongside file-based ones.

## See also

- [Adapters → Custom loader](/adapters/custom-loader/) — the
  consumer-side wrapper API.
- [`AGENTS.md`](https://github.com/cloudflare/polystella/blob/main/AGENTS.md)
  in the repo for the contributor-facing gotchas around the bridge
  lifecycle.
