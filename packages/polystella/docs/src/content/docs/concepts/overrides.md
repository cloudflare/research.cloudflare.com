---
title: Overrides
description: Hand-translated files that win over AI output verbatim.
---

Sometimes the AI gets something wrong. Or a page is too important
to trust to a model. Or you have an existing human translation you
want to preserve.

Drop a file at:

```text
{overridesDir}/{locale}/{mirrored-source-path}
```

…where `overridesDir` defaults to `./i18n/overrides`. Example:

```text
content/publications/Davidson2018.md  ← source
i18n/overrides/pt-BR/publications/Davidson2018.md  ← override
```

## What happens at build time

For each `(file, locale)` pair, the orchestrator checks for an
override **before** the cache layer. If one exists:

1. Read the override verbatim.
2. Run URL rewriting (same post-cache rewrite the AI path uses).
3. Stage to disk.
4. **Do not** call the translator or touch R2.

The override is a complete replacement for the source — frontmatter,
body, the lot. PolyStella doesn't merge fields between source and
override; what's on disk in the override file is what gets staged.

## URL rewriting still happens

Hand-translated files often contain `[link text](/foo)` style
internal links. PolyStella runs the same URL rewriter on overrides
as it does on AI output, so `/foo` becomes `/pt-BR/foo` in the
staged result.

The rewriter is idempotent: pre-prefixed URLs (already
`/pt-BR/foo`) pass through unchanged. So you can hand-write either
form and PolyStella does the right thing.

## When to use overrides

Overrides are the right answer when:

- The AI output is plain wrong and re-prompting won't fix it.
- A page contains legal text, marketing copy, or anything else
  that needs human sign-off.
- You're migrating from an existing translation workflow and
  want to preserve work that's already been paid for.

Overrides are **not** the right answer when:

- You want to tweak terminology globally — use the
  [glossary](/concepts/glossaries/) instead.
- You want to skip translation for a page — use frontmatter
  `noTranslate: true` and configure `noTranslateBehavior`.
- You want to fix a single sentence — overriding the entire page
  is heavyweight; consider whether the page should be tagged
  `noTranslate: true` and hand-translated entirely.

## Cache behaviour

Overrides don't go through R2. They're read directly from your
repo. This means:

- An override is never stale; whatever's on disk wins.
- Editing an override doesn't bust the cache (because the cache
  isn't involved).
- Removing an override file makes the next build fall back to the
  AI translation (which is still in R2 if it ever ran).
