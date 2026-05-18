---
name: Bug report
about: Something doesn't work as expected
title: ""
labels: bug
---

## What happened

<!-- A clear description of the unexpected behaviour. -->

## What you expected

<!-- A clear description of what should have happened. -->

## Reproduction

<!--
Minimum config + source that exhibits the issue. The smaller the
better — copy-pasteable trumps "see this branch".

The most useful bug reports include:
  - the polystella.config.mjs slice that matters
  - a source file (or synthetic) that triggers the issue
  - the i18n-r2-report.json from the failing build, if relevant
-->

```js
// polystella.config.mjs
export default {
  // ...
};
```

## Environment

<!-- Fill in. `polystella --version` for the package version. -->

- PolyStella version:
- Astro version:
- Node version:
- OS:
- Provider (workers-ai / anthropic):

## Logs

<!-- Optional: paste relevant build log output. Wrap in triple backticks. -->
