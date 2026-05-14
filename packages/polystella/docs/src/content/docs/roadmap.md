---
title: Roadmap
description: Status of shipped + planned features.
---

PolyStella is in active pre-1.0 development. The table below
reflects the current state.

| Area                                                | Status                 |
| --------------------------------------------------- | ---------------------- |
| Markdown adapter                                    | Shipped                |
| MDX adapter (frontmatter + body inline)             | Shipped                |
| TOML adapter                                        | Shipped                |
| JSON adapter                                        | Shipped                |
| YAML adapter                                        | Shipped                |
| Custom-loader adapter                               | Shipped                |
| Workers AI provider                                 | Shipped                |
| Anthropic provider                                  | Shipped                |
| R2 cache + branch dispatch                          | Shipped                |
| R2 bulk pre-list optimisation                       | Shipped                |
| Token-aware translation batching                    | Shipped                |
| Per-batch document context                          | Shipped                |
| Glossary (file + inline)                            | Shipped                |
| Hand-translation overrides                          | Shipped                |
| AI marker (frontmatter fields)                      | Shipped                |
| Build report                                        | Shipped                |
| Standalone routing + shims                          | Shipped                |
| Locale-aware `Astro.locals` middleware              | Shipped                |
| `LocalePicker` component                            | Shipped                |
| React hooks (`useTranslations`, `useLocalizedHref`) | Shipped                |
| UI-strings collection + drift detection             | Shipped                |
| UI-strings sync + AI-fill                           | Shipped                |
| `polystella` CLI with subcommands                   | Shipped                |
| Pre-commit hook for UI-strings drift                | Shipped (host project) |
| `PermanentProviderError` + retry contract           | Shipped                |
| `AbortSignal` threading                             | Shipped                |
| End-to-end smoke test                               | Shipped                |
| MDX JSX-children translation                        | Planned                |
| OpenAPI preset                                      | Planned                |
| Starlight mode                                      | Planned                |
| `hreflang` sitemap generator                        | Planned                |
| Public npm release                                  | Planned                |

## Upcoming work

The next concrete milestones are:

- **Repository split** — extract `packages/polystella` out of the
  host monorepo into its own GitHub repo.
- **GitHub-installable releases** — once split, tag releases as
  `v0.x` and let consumers install via
  `pnpm add github:cloudflare/polystella#vX.Y.Z`.
- **First npm publish** — once the GitHub-installable surface is
  validated by external consumers.
- **Starlight mode** — for projects already using `@astrojs/starlight`,
  defer routing + `Astro.locals.t` to Starlight's own infrastructure.

## What "planned" doesn't mean

Items marked "planned" have a concrete design but no commitment on
when they ship. The order is driven by where the host research site
needs the feature, not by a roadmap document. If you want one of
the planned items prioritised, file an issue on the GitHub repo
(once it exists) with the use case.

## Stable surfaces

The following are considered stable enough that we'll deprecate
before changing them:

- The `package.json` `exports` paths.
- `Astro.locals.{t, lhref, getLocalizedEntry, getLocalizedCollection}`.
- The `polystella` CLI subcommands + flags.
- The R2 cache key formula.
- The AI marker frontmatter fields.

The following are explicitly unstable pre-1.0:

- Internal module paths under `src/`. Don't import from anywhere
  not listed in `exports`.
- The `runtime/custom-loader-runtime.ts` bridge shape (the
  globalThis singleton). Subject to change without notice.
- The exact error message text from validation failures (the
  errors are stable; the wording isn't).
