---
title: Mental model
description: How PolyStella thinks about content, locales, and the build pipeline.
---

PolyStella has three central ideas. Internalise these and the rest
of the docs reads like commentary.

## 1. Translation is a build artifact

Visitors never trigger an AI call. Every translation is produced
during `astro build`, written to the static output, and served as
plain bytes.

That means:

- Translation is **deterministic per build**. The same source,
  glossary, and model produce the same translation modulo the
  model's sampling variance — which the cache pins.
- Translation is **billed at build time**. Your hosting layer
  doesn't pay per request.
- Translation **fails the build**. If the provider returns garbage
  the build fails fast and surfaces the offending file. There's no
  silent fallback that ships broken pages.

## 2. The cache is content-addressed

Every `(file, locale)` pair has a cache key derived from:

- The full source bytes (body + all frontmatter, not just the
  translatable parts — content hashes are over the whole file).
- The glossary hash for the target locale.
- The resolved model id for the target locale.

Edit any of those and the cache key changes; that pair re-translates.
Leave them alone and the build is essentially free even with a cold
local checkout — R2 has the bytes.

This is why the cache key isn't user-configurable. Changing the
formula would invalidate every existing entry, and the formula is
the only thing that makes incremental builds cheap.

See [Concepts → R2 cache](/concepts/r2-cache/) for the layout and
branch-dispatch story.

## 3. Per-locale siblings are the integration point

PolyStella doesn't fight Astro's content layer; it extends it.

For each of your source content collections, PolyStella generates a
sibling collection per non-default locale. So a project with
`publications` and locales `[en-US, pt-BR, ja-JP]` ends up with:

- `publications` (your source — unchanged)
- `publications__pt-BR` (auto-generated)
- `publications__ja-JP` (auto-generated)

The sibling collections share your source's schema, so consumer
code that branches on `entry.data.foo` keeps working. The dispatcher
in `Astro.locals.getLocalizedEntry` picks the right sibling at
request time based on the URL's `[lang]` segment.

You don't have to know about this if you stick to `Astro.locals`;
the abstraction holds. But when you need to debug why a translation
isn't showing up, "which sibling collection does it live in?" is
usually the right question.

## The pipeline at a glance

The full sequence from source file to rendered page:

1. **Walk source** — `sourceDir` is walked for files matching
   `include`. The walker honours `exclude` and Astro's pages directory
   conventions.
2. **Per-pair work** — for each `(file, locale)`:
   1. Read the file, compute its content hash.
   2. Build an R2 key from `{prefix}{locale}/{path}#{hash}.md`.
   3. Pre-list R2 to populate an in-memory key set (optimisation).
   4. On cache hit: pull the bytes, stage them.
   5. On cache miss: call the translator, splice translations back
      into source via the adapter's `apply` step, PUT the result
      to R2, then stage.
3. **Stage** — translated bytes land at
   `<root>/.astro/i18n-staging/{locale}/{relative-source-path}`.
4. **Astro continues** — the per-locale sibling collections read
   from the staging directory; route shims under `[lang]/...` render
   the source page template against the sibling entries.
5. **Report** — `dist/i18n-r2-report.json` summarises hits, misses,
   overrides, errors. CI uses it to track regression.

If you want the detailed version, [Concepts → How it works](/concepts/how-it-works/)
walks each step. The [configuration reference](/configuration/reference/)
documents every knob that affects the pipeline.
