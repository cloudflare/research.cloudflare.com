---
title: polystella check-ui
description: "polystella check-ui — offline drift detection over UI-string JSONs."
---

Pure drift detection over the host project's UI-string JSON files.
Reads `astro.config.mjs` for the locale set, then runs the same
`loadAndCheckDrift` logic the integration uses, against
`src/content/i18n/` (or a custom base via `--base`).

No AI, no network, no writes. Safe for pre-commit hooks.

## Usage

```bash
polystella check-ui [flags]
```

## Flags

| Flag            | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `--base <path>` | Override the dictionary directory (default: `src/content/i18n`). |
| `--help`        | Show flag help.                                                  |

## What counts as drift

Three failure modes:

1. **Missing keys.** A key exists in the default-locale file but
   not in some other locale's file.
2. **Extra keys.** A key exists in a non-default locale file but
   not in the default.
3. **Empty-placeholder values.** A non-default locale file has
   `""` where the default has a non-empty string. This means a key
   was synced (`sync-ui`) but never filled in by `translate-ui` or
   a human.

Intentional blanks are supported: if the source value is `""`, the
locale value being `""` is accepted as deliberate (probably a key
that doesn't apply to that locale).

## Pre-commit hook

The host research-site monorepo wires this into a pre-commit hook
that fails the commit when drift is detected. The hook prints
actionable next-step commands so the operator knows what to run:

```text
[polystella check-ui] drift detected
  - missing keys in pt-BR.json: nav.about
Suggested fix:
  pnpm i18n:sync       # add missing keys as ""
  pnpm i18n:translate  # AI-fill them
```

## Exit codes

- `0` — no drift; every non-default locale's key set matches the
  default.
- `1` — drift detected, or a config error.
