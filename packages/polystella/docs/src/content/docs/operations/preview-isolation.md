---
title: Preview isolation
description: Using readFallbackPrefixes to read main's cache without writing back.
---

The combination of `r2.readFallbackPrefixes` and `r2.readOnly`
gives you preview-branch isolation: preview builds can READ
production's cache to avoid retranslating unchanged content, but
they can't WRITE back to it.

## The setup

In a preview branch's `polystella.config.mjs`:

```js
r2: {
  prefix: "previews/feature-xyz/i18n/",        // preview's own prefix
  readFallbackPrefixes: ["i18n/"],             // fall back to main's
  readOnly: false,                              // can write to OWN prefix
}
```

The semantics:

- **GET on `previews/feature-xyz/i18n/<key>`** — primary read.
  On miss, also try `i18n/<key>` (the fallback).
- **PUT on `previews/feature-xyz/i18n/<key>`** — allowed; preview
  branch can write to its own prefix.
- **No writes to `i18n/`** — the fallback prefix is read-only by
  construction. There's no API path that writes to the fallback.

## What this gives you

A preview branch that edits one file out of 200 retranslates only
that file. The other 199 hit `i18n/` (main's cache) and stage
without re-translation. Build cost is proportional to actual
changes, not total content size.

## What it doesn't give you

If main updates its translation for a file the preview previously
translated, the preview's prefix is now stale relative to main.
Specifically:

- Preview branch hits its own prefix first. Its (older) translation
  wins.
- Only on miss does the fallback fire.

If you want previews to always reflect main's latest, the preview
prefix has to be regularly cleared, OR the preview branch should
re-translate the file. Neither is automatic.

In practice this rarely bites — preview branches are short-lived
and the "stale preview" window is small.

## The local-build case

The local-build pattern (developer machine, no CI env vars) uses
`readOnly: true` on `i18n/`:

```js
// What a local build effectively sees:
r2: {
  prefix: "i18n/",
  readFallbackPrefixes: [],
  readOnly: true,
}
```

Reads from `i18n/`, writes nowhere. The local build either hits
the cache (cheap) or translates locally and stages to disk for
just-this-build (no R2 write).

This is what makes a developer-machine `pnpm build` safe to run
even with the production credentials configured. The credentials
enable read access; `readOnly` denies write.

## The explicit CLI escape hatch

`POLYSTELLA_CLI=1` is the signal that "this is a deliberate
CLI-driven write, allow it even outside CI":

```bash
POLYSTELLA_CLI=1 polystella translate --branch main
```

This lets an operator manually translate against main from their
laptop. The CLI sets the env var automatically when invoked, so
you typically don't have to think about it.

## See also

- [R2 cache](/concepts/r2-cache/) — the layout + dispatch table.
- [Branch dispatch](/operations/branch-dispatch/) — env var
  signals.
