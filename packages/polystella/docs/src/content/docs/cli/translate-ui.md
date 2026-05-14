---
title: polystella translate-ui
description: "polystella translate-ui — sync followed by AI-fill of empty placeholders."
---

Sync (key add/remove) followed by AI-fill of empty values, one
batched LLM call per locale. Uses the same provider stack as the
markdown pipeline. Token placeholders (`{{name}}`) are validated
post-translation; failures retry the batch and, if persistent,
leave the key empty for manual fix-up.

## Usage

```bash
polystella translate-ui [flags]
```

## Flags

| Flag              | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `--base <path>`   | Override the dictionary directory (default: `src/content/i18n`). |
| `--locale <code>` | Run for one locale only.                                         |
| `--sync-only`     | Skip the AI step entirely (equivalent to `polystella sync-ui`).  |
| `--help`          | Show flag help.                                                  |

## How it works

1. Run `sync-ui` semantics first — reconcile keys across locales,
   add missing as empty placeholders.
2. For each non-default locale, collect every key whose value is
   `""` (and whose source value is non-empty — intentional blanks
   stay blank).
3. Make one batched `translateBatch` call per locale, feeding all
   empty keys into a single LLM round-trip.
4. Validate that every translation preserves the source's
   `{{token}}` placeholders. Token mismatches retry the batch with
   the same prompt (sampling variance usually recovers).
5. If a key still fails after retries, leave it empty. The next
   `check-ui` run will surface it as drift; the operator either
   fixes it by hand or re-runs `translate-ui` after editing the
   source.

Locales run in parallel up to `polystella.config.mjs`'s
`concurrency` cap (default 4). Independent file writes, independent
provider calls, no shared state.

## Why no R2 caching

The markdown pipeline caches translations in R2 because they're
expensive to recompute. UI-string translation isn't:

- Volume is tiny (~hundreds of strings × N locales).
- The cache-key design (per-file sha256) would force a full
  re-translation every time _any_ key in the file changes — a
  worse user experience than just re-translating the few changed
  keys.

If UI-string translation volume ever grows materially, a dedicated
per-string R2 cache could be added under an `i18n-ui/` prefix. For
now it's deliberately uncached.

## `dryRun` does NOT gate this command

The `dryRun` flag in `polystella.config.mjs` governs the markdown
pipeline — R2 writes, paid provider calls, branch dispatch — where
a preview-only run is genuinely useful. UI-string translation is
local-file-only and small-scale; the right "skip AI" mode is
`--sync-only`.

## Hand-translation always wins

If you don't want AI output for a specific key, write the value
directly in the locale JSON. `translate-ui` only fills _empty_
placeholders; an existing value (even one you typed five seconds
ago) is preserved.

## Example

```bash
pnpm i18n:translate                       # sync + AI-fill all locales
pnpm i18n:translate -- --locale pt-BR     # pt-BR only
pnpm i18n:translate -- --sync-only        # same as `pnpm i18n:sync`
```

## Exit codes

- `0` — every key was either translated cleanly or intentionally
  left empty.
- `1` — configuration error.
- `2` — token-preservation validation never converged for at least
  one key. The build report logs which key in which locale.
