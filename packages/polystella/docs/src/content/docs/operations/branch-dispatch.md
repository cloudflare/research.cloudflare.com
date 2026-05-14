---
title: Branch dispatch
description: How polystella.config.mjs reads WORKERS_CI_BRANCH to switch prefixes.
---

Branch dispatch is a config-side pattern, not built into the
integration. PolyStella reads `r2.prefix` and
`r2.readFallbackPrefixes` exactly as configured; the dispatch is
what your `polystella.config.mjs` decides to put in those fields.

## The signal: `WORKERS_CI_BRANCH`

Workers Builds sets `WORKERS_CI_BRANCH` automatically. Outside
Workers Builds, you set it yourself when you want CI-like
behaviour (e.g. for local debugging of a preview-branch flow).

```bash
WORKERS_CI_BRANCH=main polystella translate
WORKERS_CI_BRANCH=feature-xyz polystella translate
```

PolyStella doesn't read the variable directly; your config does.

## The pattern

```js
const branch = process.env.WORKERS_CI_BRANCH;
const isMain = branch === "main";

export default {
  r2: {
    prefix: isMain ? "i18n/" : `previews/${sanitize(branch)}/i18n/`,
    readFallbackPrefixes: isMain ? [] : ["i18n/"],
    readOnly: !branch && process.env.POLYSTELLA_CLI !== "1",
  },
};
```

Three branches:

- **`main`** — writes to `i18n/`, no fallback (it's the source of
  truth).
- **Other branch** — writes to its own preview prefix, falls back
  to `i18n/` on cache miss.
- **No branch set** — local build. `readOnly: true` unless the
  explicit CLI run sets `POLYSTELLA_CLI=1`.

The integration sees just the resolved options. The dispatch logic
is in user code.

## Branch sanitisation

Branch names can contain characters that don't belong in R2 keys
(`/`, `:`, `~`). Sanitise before using as a prefix component:

```js
function sanitize(name) {
  return (name ?? "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
```

A branch named `diogo/polystella-v1` becomes
`diogo-polystella-v1` and the resulting prefix is
`previews/diogo-polystella-v1/i18n/`.

Sanitisation is intentionally lossy (no preserving case, no
preserving special chars). The point is to produce a stable, R2-
safe identifier. Different branches that sanitise to the same name
collide — unlikely in practice but worth knowing.

## CLI flags override the env var

If you set `--branch` explicitly:

```bash
polystella translate --branch main
```

…that wins over `WORKERS_CI_BRANCH`. The CLI exports the resolved
branch back into the env before importing the config, so the
config sees the override.

## Resolution order summary

1. `--branch` CLI flag (highest).
2. `WORKERS_CI_BRANCH` env var.
3. `git rev-parse --abbrev-ref HEAD` (lowest).

If none resolve, the build fails — there's no automatic fallback to
"main" or similar. This is deliberate: silent fallback to main is
exactly what would let a local build pollute production.
