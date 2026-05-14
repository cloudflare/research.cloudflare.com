---
title: CI / Workers Builds
description: Wiring up PolyStella in CI so the right R2 prefix is targeted per branch.
---

PolyStella is designed to run inside Cloudflare Workers Builds (or
any CI that sets `WORKERS_CI_BRANCH`). Pre-merge previews
automatically get their own R2 prefix; main builds write to
production.

## What Workers Builds gives you

Workers Builds exports several env vars during every build:

- `WORKERS_CI_BRANCH` — the branch being built.
- `WORKERS_CI_COMMIT_SHA` — the commit SHA.
- `WORKERS_CI_BUILD_UUID` — unique build identifier.

PolyStella reads `WORKERS_CI_BRANCH` directly. The rest aren't
used by the integration but are useful for your own observability.

## Reference config pattern

```js
// polystella.config.mjs
const branch = process.env.WORKERS_CI_BRANCH;
const isMain = branch === "main";
const isCI = branch !== undefined;
const isExplicitCLI = process.env.POLYSTELLA_CLI === "1";

function sanitizeBranch(name) {
  return name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export default {
  provider: {
    kind: "workers-ai",
    accountId: process.env.CF_ACCOUNT_ID,
    apiToken: process.env.CF_API_TOKEN,
    model: "@cf/meta/llama-3.1-8b-instruct",
  },
  r2: {
    accountId: process.env.CF_ACCOUNT_ID,
    bucket: "polystella-cache",
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,

    // Branch dispatch
    prefix: isMain ? "i18n/" : `previews/${sanitizeBranch(branch ?? "local")}/i18n/`,
    readFallbackPrefixes: isMain ? [] : ["i18n/"],

    // A local build cannot write to R2. A preview CI build can.
    readOnly: !isCI && !isExplicitCLI,
  },
};
```

What this does:

- **Main CI build** writes to `i18n/`. No fallback (it IS the
  fallback).
- **Preview CI build** writes to `previews/<sanitized-branch>/i18n/`
  and reads from `i18n/` on cache miss. Preview branches get the
  production cache for free.
- **Local build** — `readOnly: true`. Translates locally if
  needed, stages to disk, never writes to R2. A developer can't
  accidentally pollute production.
- **Explicit CLI run** (`polystella translate`) — writes per
  branch resolution. `POLYSTELLA_CLI=1` signals "this is
  deliberate; allow writes even outside CI".

## Required secrets

Workers Builds environment must contain:

- `CF_ACCOUNT_ID` — Cloudflare account for Workers AI + R2.
- `CF_API_TOKEN` — Workers AI scope.
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — R2 S3-compatible
  credentials.

For Anthropic provider, add `ANTHROPIC_API_KEY`.

## Build report

After every CI build, `dist/i18n-r2-report.json` summarises hits,
misses, overrides, errors. Useful for:

- Tracking cache hit rate over time.
- Spotting regressions (sudden spike in misses on an unchanged
  source).
- Audit trails — every translation records its model + timestamp.

Workers Builds keeps the artifact for inspection.

## See also

- [Branch dispatch](/operations/branch-dispatch/) — the env-var
  signals that drive the dispatch logic.
- [Preview isolation](/operations/preview-isolation/) — how
  `readOnly` + `readFallbackPrefixes` keep preview branches from
  polluting main.
