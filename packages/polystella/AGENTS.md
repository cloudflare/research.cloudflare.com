# AGENTS.md

PolyStella — an Astro integration that translates content into additional
locales at build time using AI, caches translations in Cloudflare R2, and
injects locale-prefixed routes.

For system-level design and the rationale behind ordering decisions, read
`ARCHITECTURE.md`. For user-facing docs, see the docs site (forthcoming)
or `README.md`.

## Commands

- `pnpm test` — run vitest (981 tests, ~1.2s; includes a 9-test
  end-to-end smoke suite at `tests/smoke.test.ts`).
- `pnpm test:watch` — vitest in watch mode.
- `pnpm build:cli` — bundle the standalone `polystella-translate` CLI
  to `dist/cli.js` via esbuild.
- Typecheck: from the package root, `pnpm exec tsc --noEmit` (the
  tsconfig has `noEmit: true`).

There is no lint step yet. Biome adoption is planned for Phase 2.

## Structure

- `src/index.ts` — Astro integration entry. Registers hooks, runs the
  translation pass, publishes the runtime bridge.
- `src/cli.ts` — `polystella-translate` standalone runner. Shares the
  same `runTranslationPass` as the integration.
- `src/config/options.ts` — zod schema + `resolveOptions`. Locales are
  derived from Astro's `i18n` config, not duplicated here.
- `src/translation/` — `run.ts` (orchestrator), `provider.ts` (Workers
  AI + Anthropic translators), `prompt.ts` (marker-delimited prompt
  format + parser).
- `src/parsing/` — adapter contract (`adapter.ts`), per-format adapters
  (`adapters/{markdown,toml,json,yaml}.ts`), key-path utilities,
  link rewriter.
- `src/storage/` — R2 client, cache orchestrator, hash, prune,
  local staging index, build report.
- `src/source/` — file walker, concurrency pool, overrides reader.
- `src/glossary/` — glossary loader + content-hash.
- `src/routing/` — shim generator, page walker, route expansion.
- `src/runtime/` — middleware, `Astro.locals` bindings,
  `localized-href`, custom-loader runtime bridge.
- `src/content/` — `polystellaCollections`, custom-loader wrapper,
  file-loader wrapper, schema extension.
- `src/i18n/` — UI strings loader, drift detection, translator
  resolution, sitemap helper.
- `src/react/` — `useTranslations` + `useLocalizedHref` hooks for islands.
- `tests/` — tests grouped by source directory
  (`tests/parsing/`, `tests/storage/`, etc.) so finding the test
  for a given source file is `tests/<src-dir>/<basename>.test.ts`.
  Top-level exceptions: `tests/cli.test.ts` (the only `src/cli.ts`
  test), `tests/smoke.test.ts` (integration end-to-end). Vitest
  config in `vitest.config.ts`.

## Conventions

- **Astro hook timing**: translation runs in `astro:config:setup`, NOT
  `build:start`. See ARCHITECTURE.md §2. This is the single most
  surprising ordering constraint.
- **Adapter contract**: every new format implements `FileTypeAdapter`
  in `parsing/adapter.ts` and registers in `parsing/registry.ts`. No
  changes to `run.ts` or the cache layer required.
- **Cache key formula**:
  `sha256(body + selectedFrontmatterValues + glossaryHash + modelId)`.
  Changing inputs is a cache-wide invalidation; treat the formula's
  stability as part of the public contract.
- **Path handling**: R2 keys use forward slashes (POSIX); local paths
  use `path.sep`. Sources are walked relative to project root.
- **Comments**: keep "why" only. Long-form rationale lives in
  `ARCHITECTURE.md`. Avoid restating what the code says.
- **Zod everywhere**: config parses through zod at the boundary;
  downstream code trusts the schema.
- **Strict tsconfig**: codex RFC 009 flags are all on:
  `noUncheckedIndexedAccess` (indexed access returns `T | undefined`),
  `exactOptionalPropertyTypes` (`foo?: string` ≠ `foo: string | undefined`),
  `noImplicitReturns`, `noFallthroughCasesInSwitch`. For optional
  fields that semantically accept explicit `undefined` from the
  caller, type them as `foo?: T | undefined` (not just `foo?: T`).

## Boundaries

**Always:**

- Run `pnpm test` before pushing. Tests must stay green.
- Bump the package version in `package.json` only — `POLYSTELLA_VERSION`
  (in `src/version.ts`) reads it at module-load time. The CLI bundle
  (`dist/cli.js`) inlines it via esbuild at build time, so `pnpm
build:cli` after a version bump.
- Mirror file-system path semantics across OS: forward slashes for
  R2 keys, `path.sep` for local I/O.

**Ask first:**

- Adding new dependencies.
- Adding a new adapter (introduces a new file extension).

**Never:**

- Re-introduce the long-form design comments that were removed; they
  live in `ARCHITECTURE.md` now.
- Commit R2 credentials or live API keys to fixtures.
- Widen the AI-translation marker contract without bumping the
  cache-key formula (cache hits return the marker verbatim).
- Use `any`. Use `unknown` and narrow with type guards.
- Use `!` non-null assertions outside test code.

## Gotchas

- **`polystellaCollections` runs AFTER `astro:config:setup`.** It's
  called from the user's `content.config.ts` at content-sync time. The
  runtime bridge in `src/runtime/custom-loader-runtime.ts` is the seam
  between the two halves — see ARCHITECTURE.md §4.
- **Vitest `singleThread: true`** is faster than multi-worker at this
  scale (~1.2s vs ~1.6s; per-worker startup dominates for ~970 tests).
  Revisit when the suite outgrows the overhead. Test files don't share
  module-scope state across workers (each worker gets its own module
  graph), so the original "share state" rationale no longer applies.
- **Local cache index** uses two separate maps (`localCacheIndex`
  immutable during the run; `nextLocalCacheIndex` accumulates writes).
  Workers must not read from `next…` mid-run — see ARCHITECTURE.md §8.
- **`adapter.parse` is called once per source per live run** (the
  separate dry-run pass only runs when actually in dry-run mode).
  Adapter `parse` should still be idempotent — calling it twice
  during debugging or in tests must not produce different output.
- **R2 bulk pre-list** happens once per (prefix × locale) at the
  start of the live phase, populating an in-memory predicate that
  short-circuits per-pair `r2.get` calls. Disable via
  `r2.bulkListOnStart: false` for caches with >10k keys per locale
  where the list cost dominates.
- **Heartbeat `setInterval`** is `unref()`'d so a stalled pool doesn't
  block process exit. Don't remove the unref.
- **Override files at `i18n/overrides/{locale}/<path>`** win over AI
  output verbatim. They run through the URL rewriter (idempotent) but
  are NOT written to R2.
- **MDX vs MD**: `remark-mdx` disables indented code, autolinks, and
  raw-HTML blocks. Route through the right parser by extension; never
  apply MDX rules to `.md`.
- **Workers AI default `maxTokens` is too low.** Default in our
  config is 8192. Lowering it truncates multi-segment translations.
- **`PermanentProviderError`** (in `translation/provider.ts`) is the
  only way to short-circuit `translateBatch`'s retry loop. Provider
  4xx responses (401, 403, 400, 404, 422) wrap into it; everything
  else (5xx, network, parse failures) retries with exponential backoff
  via `p-retry`. Don't widen the permanent-set without thinking about
  what flaky responses might wrongly skip retry.
- **`AbortSignal` threads from CLI / integration → `runTranslationPass`
  → worker → cache → `translateBatch` → provider HTTP fetch.** The
  CLI installs SIGINT/SIGTERM handlers; second Ctrl-C exits hard.
  Always forward `signal` when adding a new async function on the
  hot path; check `signal?.throwIfAborted()` at await boundaries that
  could otherwise run indefinitely.

## Verification

- `pnpm test` must pass (981 tests).
- `pnpm exec tsc --noEmit` must pass (strict mode).
- For changes to the translation pipeline, run end-to-end against the
  research-site fixtures: from the monorepo root, `pnpm translate
--dry-run` walks the full pipeline without hitting AI/R2.

## Resources

- `ARCHITECTURE.md` — system design + rationale extracted from inline
  comments.
- `README.md` — user-facing introduction.
- The host project at `research.cloudflare.com` is the first consumer;
  its `polystella.config.mjs` is the reference configuration.
