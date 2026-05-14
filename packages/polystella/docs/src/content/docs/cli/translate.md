---
title: polystella translate
description: "polystella translate — markdown pipeline outside astro build."
---

Runs the same translation pipeline as `astro build` without booting
Astro. Useful for one-off re-translations, CI dispatch, and dry-run
inspection of what a build would do.

## Usage

```bash
polystella translate [flags]
```

The host research-site monorepo wires `pnpm translate` to invoke
this for muscle-memory continuity.

## Flags

| Flag                | Purpose                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| `--locale <code>`   | Run for one locale only. Errors if the locale isn't in `i18n.locales`.    |
| `--file <glob>`     | Run for one file (or glob pattern). Saves a full sweep on edits.          |
| `--dry-run`         | Log the planned R2 keys; write nothing.                                   |
| `--branch <name>`   | Target a specific branch's R2 prefix. Defaults to current git branch.     |
| `--prefix <prefix>` | Override the resolved `r2.prefix` directly. Must end with `/`.            |
| `--report <path>`   | Write the build report to a custom path (default: `i18n-r2-report.json`). |
| `--help`            | Show flag help.                                                           |

## Examples

```bash
pnpm translate                          # full run for the current git branch
pnpm translate --locale pt-BR           # only pt-BR translations
pnpm translate --file "publications/Davidson2018.md"  # one file
pnpm translate --dry-run                # plan; don't write
pnpm translate --branch main            # target main's R2 prefix
```

## Branch resolution

By default, `polystella translate` picks the R2 prefix based on
your current git branch. The branch resolution order is:

1. `--branch <name>` flag (highest priority).
2. `WORKERS_CI_BRANCH` environment variable.
3. Current git HEAD (`git rev-parse --abbrev-ref HEAD`).

Setting `WORKERS_CI_BRANCH` before invoking the CLI makes it
behave identically to a Workers Build run. This is how Workers
Builds dispatches per-branch caching automatically.

## What it does

The CLI invokes the same `runTranslationPass` orchestrator as the
Astro integration. For each source file × target locale pair:

1. Compute the content hash.
2. Check the R2 cache (or fall back through `readFallbackPrefixes`).
3. On miss, translate via the configured provider.
4. Stage the result under `.astro/i18n-staging/<locale>/`.
5. PUT to R2 (unless `readOnly: true`).
6. After all pairs, prune R2 to keep at most `keepLastN` variants
   per `(locale, source)` pair.
7. Emit the build report.

The Astro integration runs the same flow during `astro build`; the
CLI just skips Astro's outer shell. See [Concepts → How it
works](/concepts/how-it-works/) for the full pipeline.

## Exit codes

- `0` — every `(file, locale)` pair succeeded (cache hit, override
  applied, or fresh translation).
- `1` — configuration error (bad flags, missing config files).
- `2` — one or more `(file, locale)` pairs failed during translation.
