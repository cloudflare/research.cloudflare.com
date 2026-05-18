# Contributing to PolyStella

Thanks for the interest. PolyStella is pre-1.0 and the development
loop is short — feel free to open issues, propose changes, or send
PRs.

## Repository overview

PolyStella is a pnpm workspace with two members:

- **The package itself** at the repo root (`package.json` →
  `polystella`).
- **The docs site** under `docs/` (`docs/package.json` →
  `polystella-docs`).

The agent-facing context lives in [`AGENTS.md`](./AGENTS.md). The
system-level design rationale lives in
[`ARCHITECTURE.md`](./ARCHITECTURE.md). Read those before working
on anything non-trivial; they save a lot of back-and-forth.

## Development setup

```bash
git clone https://github.com/cloudflare/polystella
cd polystella
pnpm install
```

Required:

- Node 20+ (24 LTS recommended).
- pnpm 9+ (the lockfile is `pnpm-lock.yaml`).

## Commands

| Command                               | Purpose                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| `pnpm test`                           | Run the package's unit + smoke tests (vitest).                  |
| `pnpm exec tsc --noEmit`              | Typecheck the package.                                          |
| `pnpm build:cli`                      | Build the standalone CLI bundle (`dist/cli.js`).                |
| `pnpm build:llms`                     | Regenerate `llms-full.txt` from canonical agent docs.           |
| `pnpm --filter polystella-docs dev`   | Run the Starlight docs site locally.                            |
| `pnpm --filter polystella-docs build` | Build the docs site (includes auto-generated config reference). |
| `pnpm --filter polystella-docs check` | Astro check over docs content.                                  |

## Pull request workflow

1. **Open an issue first** for anything non-trivial. PolyStella
   has tight coupling between adapters / providers / the cache
   layer; a 5-minute up-front discussion saves a rebase later.
2. **Branch from `main`**. Branch names like
   `<type>/<short-slug>` are nice but not enforced.
3. **Add a changeset** for any user-visible change. Run
   `pnpm changeset` from the repo root and follow the prompts.
   The Changesets bot will pick this up at release time.
4. **Run the test suite + typecheck + docs build** locally before
   pushing. CI does the same but local-first saves round-trips.
5. **Reference the issue** in the PR description if you opened one.

## Coding conventions

- **TypeScript strict mode**, including `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch`. Tooling configured in
  `tsconfig.json`.
- **No `any`, no `!`.** Use `unknown` + type guards; use
  destructure-and-check instead of non-null assertions. See
  [`AGENTS.md`](./AGENTS.md) for the rationale.
- **`.describe()` every public schema field.** The docs site
  auto-generates the configuration reference; missing `.describe()`
  calls produce empty cells in the table.
- **Comments document the "why", not the "what".** Long-form
  rationale belongs in `ARCHITECTURE.md`. Inline comments are for
  non-obvious decisions and known footguns.
- **Tests are integration-heavy.** We use vitest with
  `singleThread: true` (faster than multi-worker at our scale).
  Tests live under `tests/<src-dir>/<basename>.test.ts` mirroring
  the source structure. A 9-test smoke suite under `tests/smoke.test.ts`
  exercises the integration end-to-end against a temp project.

## Adding new APIs

Before adding to the public surface:

- **Is it covered by an existing export path?** Check the
  `exports` field in `package.json`. Eight subpaths are exposed;
  unless your addition needs its own namespace, it should fit in
  one of them.
- **Does it have a documentation page?** `pnpm
--filter polystella-docs check-exports` asserts every
  `exports` path is mentioned on `docs/src/content/docs/reference/exports.md`.
  CI fails if not.
- **Does the schema reference need updating?** The
  `docs/scripts/generate-config-ref.ts` script auto-walks
  `src/config/options.ts`'s zod schema. If your change adds a new
  config field, regenerate the page locally with
  `pnpm --filter polystella-docs prebuild` and verify the
  output reads cleanly.

## Adding a new adapter

Adapters implement the `FileTypeAdapter` interface in
`src/parsing/adapter.ts` and register via `parsing/registry.ts`.
See [`ARCHITECTURE.md`](./ARCHITECTURE.md) `#adapter-contract` for
the full contract. The Markdown adapter is the reference
implementation.

## Adding a new provider

Providers implement the `Translator` interface in
`src/translation/provider.ts`. Throw `PermanentProviderError` on
4xx HTTP responses that retries can't fix (401/403/404/422); throw
plain `Error` on anything retriable. See [`ARCHITECTURE.md`](./ARCHITECTURE.md)
`#translator-contract` for the detail.

## Reporting bugs

Bug reports against PolyStella are most useful when they include:

- Minimum reproducible config (the `polystella.config.mjs` slice
  that exhibits the issue).
- Source file(s) that trigger the issue (or a synthetic example
  with the same shape).
- The build report from `dist/i18n-r2-report.json`, if relevant.
- The PolyStella version (visible in the report; or `polystella --version`).

## License

By contributing, you agree that your contributions are licensed
under the MIT License — same as the project.
