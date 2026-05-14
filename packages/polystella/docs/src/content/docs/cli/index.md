---
title: CLI overview
description: The polystella binary and its four verb-style subcommands.
---

The package exposes a single `polystella` binary with verb-style
subcommands:

| Command                   | Purpose                                        | Network          |
| ------------------------- | ---------------------------------------------- | ---------------- |
| `polystella translate`    | Markdown pipeline outside `astro build`        | AI provider + R2 |
| `polystella check-ui`     | Drift detection over UI-string JSONs           | None (offline)   |
| `polystella sync-ui`      | Mechanical key reconciliation (no AI)          | None (offline)   |
| `polystella translate-ui` | Sync + AI-fill of empty UI-string placeholders | AI provider only |

Run `polystella --help` for the top-level menu, or
`polystella <subcommand> --help` for per-subcommand flags.

:::caution[Breaking change (pre-1.0)]
The legacy `polystella-translate` binary has been renamed to
`polystella translate`. The host project's `pnpm translate` wrapper
transparently redirects, but direct invocations need updating.
:::

## How the subcommands fit together

`translate` and the `*-ui` subcommands address two distinct surfaces
in a localised Astro site:

- **`translate`** handles **content** — markdown files, MDX,
  structured TOML/JSON/YAML. The AI translates body prose and
  configured frontmatter / structured-data fields. Output lands in
  the R2 cache and the staging directory; Astro picks it up at
  build time.
- **`check-ui`** / **`sync-ui`** / **`translate-ui`** handle
  **chrome text** — nav labels, CTAs, error messages — which lives
  in per-locale JSON files (`src/content/i18n/<locale>.json`) and
  is consumed via `Astro.locals.t`. These don't go through R2;
  they're tiny, hand-curated, and edits to the source locale need
  to propagate to the others without re-translating everything.

You typically run `translate` infrequently (build-time, in CI) and
`check-ui` / `sync-ui` / `translate-ui` as you edit UI strings
locally. The host research site wires `check-ui` into a pre-commit
hook so the build never fails on drift.

## Exit codes

Across all subcommands:

- `0` — success.
- `1` — configuration error (missing/bad `astro.config.mjs` or
  `polystella.config.mjs`).
- `2` — work failed: a `(file, locale)` pair failed in `translate`,
  drift detected in `check-ui`, pending changes in
  `sync-ui --check`, or token-preservation never converged in
  `translate-ui`.

CI scripts should check for `0` vs anything else; the `1` vs `2`
distinction is mostly for human operators triaging a failure.

## Where the CLI lives

The CLI is a thin layer over the same `runTranslationPass`
orchestrator the Astro integration uses. There's nothing the CLI
does that the integration doesn't — it just exposes the entry point
outside of `astro build`. This matters for two scenarios:

- **One-off re-translations.** `polystella translate --file
"publications/Davidson2018.md"` retranslates one file without
  rebuilding the rest of the site.
- **CI dispatch.** Workers Builds runs the integration during the
  normal build, but if you want a separate "translate now" job
  (e.g. nightly), the CLI is what it invokes.

See the subcommand pages for flag-level detail.
