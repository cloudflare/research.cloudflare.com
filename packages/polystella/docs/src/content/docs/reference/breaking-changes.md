---
title: Breaking changes
description: Pre-1.0 breaking-change log.
---

PolyStella is in pre-1.0 development. Breaking changes happen.
The log below tracks them so consumers can update incrementally.

The package's `CHANGELOG.md` is the authoritative source; this
page mirrors the breaking entries.

## Unreleased (pre-split, v0.x)

### `polystella-translate` binary renamed to `polystella translate`

The legacy `polystella-translate` binary is gone. Consumers must
update direct invocations:

```bash
# Before
polystella-translate --locale pt-BR

# After
polystella translate --locale pt-BR
```

Host projects using a `pnpm translate` script wrapper need to
update the script's command to invoke `polystella translate`. The
host research-site monorepo has already done this.

### CLI is now subcommand-based

The CLI grew three new subcommands for UI-string maintenance
(`check-ui`, `sync-ui`, `translate-ui`). The original
translation flow lives at `polystella translate`. Run
`polystella --help` for the menu.

### `r2.bulkListOnStart` defaults to `true`

Added in this pre-release. Default `true` issues one `r2.list()`
per locale at the start of the live phase to populate an in-memory
key set, turning per-pair cache checks into O(1) lookups.

Consumers with caches >10k keys per locale (rare) may want
`bulkListOnStart: false` if the list cost dominates. Most
consumers see strictly faster builds.

### `provider.batchInputTokenBudget` added

Soft cap on per-batch input tokens during translation. Default 4000. Affects how the translator splits large files into batches;
doesn't affect the cache (the cache key is per-file).

Existing consumers see no behaviour change unless they set the
value explicitly.

## Earlier (not formally tracked)

Pre-0.1, breaking changes were rolled forward without a log because
the package was internal-only. The package's git history is the
record.

## How we'll track breaking changes going forward

Once the package is on GitHub with a `CHANGELOG.md`:

- Every breaking change gets an entry under "Breaking changes" in
  the relevant version's changelog block.
- Major version bumps (0.x → 0.y) signal "this release contains at
  least one breaking change; read the entries before upgrading".
- Minor / patch versions never break; if they do, that's a bug and
  we'll yank the release.

`CHANGELOG.md` follows the [Keep a Changelog](https://keepachangelog.com/)
format.
