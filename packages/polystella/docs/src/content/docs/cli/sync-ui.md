---
title: polystella sync-ui
description: "polystella sync-ui — mechanical UI-string key reconciliation."
---

Mechanical (no AI) key reconciliation for UI-string JSONs. Adds
missing keys to non-default locales as empty strings, drops keys
not in the default. Preserves existing values (empty or not),
source-file key order, and blank-line section layout.

Pair with `polystella translate-ui` to fill the empty placeholders
with AI-generated strings.

## Usage

```bash
polystella sync-ui [flags]
```

## Flags

| Flag            | Purpose                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| `--base <path>` | Override the dictionary directory (default: `src/content/i18n`).          |
| `--check`       | Report pending changes; exit non-zero if any. No writes (CI/verify mode). |
| `--help`        | Show flag help.                                                           |

## What it preserves

The host project's UI-string JSONs tend to be hand-curated for
readability — keys grouped by feature, blank lines between groups.
`sync-ui` keeps that layout intact across runs:

- **Key order** follows the default-locale source. New keys are
  inserted at the source's position, not appended.
- **Blank-line section breaks** in the source are mirrored in
  every non-default locale.
- **Existing values** (including empty strings) are preserved.
  `sync-ui` never overwrites a non-empty translation.

This means `sync-ui` is safe to re-run as often as you like; the
output is deterministic for a given source.

## What it does NOT do

- It doesn't translate. Adding a missing key writes `""`; you fill
  it via `polystella translate-ui` or by hand.
- It doesn't catch _empty_ drift. `check-ui` does (a non-default
  locale with `""` where the source has a value).
- It doesn't validate `{{token}}` placeholder consistency — that's
  `translate-ui`'s job, post-AI.

## Example

A typical flow when adding a new UI key:

```bash
# 1. Edit src/content/i18n/en-US.json to add the new key.
# 2. Propagate to other locales:
pnpm i18n:sync
# 3. Fill the empty placeholders:
pnpm i18n:translate
# 4. (optional) Hand-edit any AI output that's wrong:
$EDITOR src/content/i18n/pt-BR.json
# 5. Verify clean:
pnpm i18n:check
```

## Exit codes

- `0` — clean (or changes applied successfully).
- `1` — configuration error.
- `2` — `--check` was passed and pending changes exist.
