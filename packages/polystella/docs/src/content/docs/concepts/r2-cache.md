---
title: R2 cache
description: How translations are content-addressed and cached in Cloudflare R2.
---

PolyStella's R2 cache is the load-bearing piece of the whole
pipeline. It's why incremental builds are essentially free; it's
why preview branches can ride on main's translations; it's why
local builds can't accidentally overwrite production.

## Cache key

<a id="cache-key"></a>

R2 keys are content-addressed:

```text
hash = sha256(body + selectedFrontmatterValues + glossaryHash + modelId)
```

Inputs:

- **`body`** — the raw source bytes.
- **`selectedFrontmatterValues`** — only the frontmatter fields the
  adapter considers translatable (or URL-rewrite targets). Editing
  untranslated fields (e.g. an internal `id`) doesn't invalidate
  the cache.
- **`glossaryHash`** — `hashGlossary(...)`. Changing a glossary
  entry re-translates the pages that mention the changed term, not
  the whole corpus.
- **`modelId`** — the per-locale resolved model. Switching models
  is an explicit invalidation.

### What's NOT in the hash

- The integration version (`POLYSTELLA_VERSION`). Recorded in R2
  metadata for diagnostics; a `0.x → 0.y` bump doesn't re-translate.
- `markdown.contextKeys` and the resulting per-batch document-
  context block — editing them doesn't bust the cache.
- `noPrefixUrls` and other URL-rewriting config — applied
  post-cache, so changing them doesn't re-translate.

This is **Invariant 1** in `ARCHITECTURE.md`. Any change to the
formula is a cache-wide invalidation. Treat its stability as part
of the public contract.

## Key format

```text
{prefix}{locale}/{relative-source-path}#{hash}.md
```

Examples:

```text
i18n/pt-BR/publications/Davidson2018.md#a3f2b1c8....md
previews/diogo-polystella-v1/i18n/ja-JP/people/alice.md#1234....md
```

The `#hash` segment is anchored on the **last** `#` in the key so
operator-supplied paths can contain `#` characters without breaking
key parsing.

## R2 layout and branch dispatch

<a id="branch-dispatch"></a>

Three logical writers, distinguished by env-var signals:

| Mode             | Detection                           | `r2.prefix`                         | `readFallbackPrefixes` | `readOnly` | Behaviour                                                   |
| :--------------- | :---------------------------------- | :---------------------------------- | :--------------------- | :--------- | :---------------------------------------------------------- |
| Local build      | neither env var set                 | `i18n/`                             | _(none)_               | `true`     | Reads main's cache; on miss, translates locally and stages. |
| CI build (main)  | `WORKERS_CI_BRANCH=main`            | `i18n/`                             | _(none)_               | `false`    | Production cache; sole writer of `i18n/`.                   |
| CI build (other) | `WORKERS_CI_BRANCH=<other>`         | `previews/<sanitized-branch>/i18n/` | `["i18n/"]`            | `false`    | Preview cache; reads main on miss, writes only `previews/`. |
| Explicit CLI     | `POLYSTELLA_CLI=1` + branch resolve | per resolved branch                 | per resolved branch    | `false`    | `polystella translate` writes per the branch's prefix.      |

`readFallbackPrefixes` is the read-only consult list for cache
misses against the primary `prefix`. First hit wins; bytes are
returned verbatim and **not** promoted into the primary prefix.

A developer's local build cannot overwrite production. Preview
branches stay isolated until they merge.

## Bulk pre-list

<a id="bulk-pre-list"></a>

Before the worker pool starts, `runTranslationPass` issues one
`r2.list(prefix + locale + "/")` per locale and populates an
in-memory `Set<string>` of every cached key. Per-pair cache checks
become O(1) lookups instead of HTTP round-trips.

Disable via `r2.bulkListOnStart: false` for caches with 10k+ keys
per locale where the list cost dominates. The default is `true`.

## Pruning

After all pairs run (and only on writers — `readOnly` builds skip
this), R2 is pruned per `(locale, source-path)`:

- Keep the **N most-recent hash variants** per pair, where N is
  `r2.keepLastN` (default 5).
- Delete the rest.

This bounds cache growth without losing the ability to roll back to
recent translations. Set `keepLastN: false` to disable pruning
entirely.

## Why R2?

Content-addressed translation caching has hard requirements that
ruled out cheaper alternatives:

- **Strong consistency** for the `(key, value)` mapping — needed
  so two CI runs starting from the same source produce the same
  translation.
- **Cross-region availability** — Workers Builds runs everywhere;
  the cache has to be reachable everywhere.
- **Cheap PUTs and GETs at small object sizes** — typical entry is
  a few KB.
- **Native to the Workers ecosystem** — every other piece of the
  stack already speaks R2.

KV would work for small projects but its read/write cost model
breaks down at the scale of a research-paper corpus (thousands of
files × multiple locales). D1 would be possible but adds row-level
overhead we don't need. Workers KV is wrong-sized; D1 is the wrong
shape; R2 fits the workload.
