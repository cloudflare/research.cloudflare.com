---
title: How it works
description: End-to-end overview of the PolyStella build pipeline.
---

PolyStella is an Astro integration that translates content into
additional locales at build time, caches the results in Cloudflare
R2, and injects locale-prefixed routes for the translated pages.

The same orchestrator powers a standalone `polystella` CLI so
operators can run the pipeline outside `astro build`.

## High-level diagram

```text
       ┌────────────────────────────────────────────────────────┐
       │              astro:config:setup (or CLI)               │
       └────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  walk sources ──► per (file × locale) worker pool ◄── R2 bulk pre-list
                                  │
                ┌─────────────────┴─────────────────┐
                ▼                                   ▼
        cache key matches?                   override file present?
                │                                   │
        no ┌────┴────┐ yes                          ▼
           ▼         ▼                       read verbatim, rewrite URLs
       parse +    return cached
       extract    bytes, rewrite                    │
           │     URLs, stage                        │
           ▼                                        │
       translate (token-aware batches,              │
         heading-anchored grouping,                 │
         document-context preamble)                 │
           │                                        │
           ▼                                        │
        apply translations + AI marker              │
           │                                        │
           ▼                                        │
        PUT to R2 (unless readOnly), stage          │
                                  │
                                  ▼
                   ┌──────────────────────────────┐
                   │  per-locale sibling collection │
                   │  (consumed by Astro routes)    │
                   └──────────────────────────────┘
```

## The pipeline, step by step

### 1. Hook timing

PolyStella registers as an Astro integration with hooks in
`astro:config:setup` and `astro:build:done`. The translation work
runs entirely in `config:setup` — not `build:start` — because
content-collection sync needs the staged files to exist before
Astro reads them. See ARCHITECTURE.md `#hook-timing` for the
ordering guarantees.

### 2. Walk sources

`runTranslationPass` walks `sourceDir` looking for files matching
`include` (minus `exclude`). The walker is filesystem-only — no
content-collection assumptions, no Astro-isms. The CLI uses the
exact same walker.

### 3. Pre-list R2

Before any per-pair work, the orchestrator issues one
`r2.list(prefix + locale + "/")` per locale and builds an in-memory
`Set<string>` of every cached key. Per-pair cache checks become
O(1) lookups instead of HTTP round-trips. See
[Concepts → R2 cache](/concepts/r2-cache/#bulk-pre-list).

### 4. Per-pair work

For each `(file, locale)` pair the worker pool runs:

1. Compute the source hash. The formula is
   `sha256(body + selectedFrontmatterValues + glossaryHash + modelId)`.
   See the [cache-key contract](/concepts/r2-cache/#cache-key).
2. Check the in-memory key set for the primary R2 key, then any
   configured `readFallbackPrefixes` keys in order.
3. On hit: pull the bytes from R2, run post-cache URL rewriting,
   stage to disk.
4. On override-file hit (i.e. `i18n/overrides/<locale>/<path>`
   exists): read the override verbatim, run URL rewriting, stage.
5. On full miss: parse + extract translatable segments, call the
   translator (with token-aware batching for large files), splice
   translations back via the adapter's `apply` step, bake in the
   AI marker, PUT to R2 (unless `readOnly: true`), stage.

### 5. Stage

Translated bytes land at
`<root>/.astro/i18n-staging/{locale}/{relative-source-path}`. This
is **not** under `cacheDir`; the integration deliberately uses the
project root so per-locale sibling content collections can find the
files. See ARCHITECTURE.md `#staging-vs-cache`.

### 6. Prune

After all pairs run, R2 is pruned: per `(locale, source-path)`
combination, keep at most `keepLastN` hash variants (default 5).
Stale variants are deleted in batch.

### 7. Report

`astro:build:done` emits `dist/i18n-r2-report.json` summarising
hits, misses, overrides, errors, and prune outcomes. The host
research site's CI uses this to track regression.

## Mode boundary

Today PolyStella runs in **standalone mode** — it injects its own
locale-prefixed route shims that re-render your source page
template against the per-locale sibling content. A planned
**Starlight mode** will defer routing and `Astro.locals.t` to
Starlight when the host project uses Starlight. See [Concepts →
Mode boundary](/concepts/mode-boundary/) for the difference.

## Where to read more

- [R2 cache](/concepts/r2-cache/) — keys, layout, branch dispatch.
- [Glossaries](/concepts/glossaries/) — pinning terminology.
- [Overrides](/concepts/overrides/) — hand-translated files that
  win over AI output.
- [AI marker](/concepts/ai-marker/) — the `aiTranslated` frontmatter
  fields baked into every translated file.
- [Runtime bridge](/concepts/runtime-bridge/) — how custom loaders
  reach the translator at content-sync time.

The full system-level reference lives in
[`ARCHITECTURE.md`](https://github.com/cloudflare/polystella/blob/main/ARCHITECTURE.md)
in the repo. That file is the source of truth; this page summarises.
