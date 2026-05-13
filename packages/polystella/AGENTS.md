# AGENTS.md

PolyStella — an Astro integration that translates content into
additional locales at build time using AI, caches translations in
Cloudflare R2, and injects locale-prefixed routes.

This file is the entry point for coding agents working **on the
PolyStella package itself**. Three companion docs:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system design, invariants,
  glossary, per-subsystem reference. The "why" answers.
- [`skills/polystella-contributor/SKILL.md`](./skills/polystella-contributor/SKILL.md)
  — step-by-step recipes for common contributor tasks (add an
  adapter, add a CLI subcommand, debug a translation, etc.).
- [`skills/polystella-consumer/SKILL.md`](./skills/polystella-consumer/SKILL.md)
  — for agents working in a **downstream Astro project** that
  depends on this package.

All cross-references use stable slug anchors (`#cache-key`), not
section numbers. Inserting new sections never breaks links.

---

## Commands

| Command                  | What it does                                                                                                                                                                                            |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test`              | Run vitest (1152 tests / 55 files / ~1.5s at time of writing).                                                                                                                                          |
| `pnpm test:watch`        | Vitest in watch mode.                                                                                                                                                                                   |
| `pnpm build:cli`         | Bundle the standalone `polystella` CLI to `dist/cli.js` via esbuild. The package exposes a single `polystella` binary with verb-style subcommands (`translate`, `check-ui`, `sync-ui`, `translate-ui`). |
| `pnpm exec tsc --noEmit` | Typecheck. The tsconfig has `noEmit: true`.                                                                                                                                                             |

No lint step yet. Biome adoption planned for the post-split phase.

> Test counts age. The authoritative count is `pnpm test`'s output;
> the number here is a snapshot pinned by [`tests/docs.test.ts`](./tests/docs.test.ts).

---

## Where do I make changes?

Task → entry-point file(s) → key contract → deep-dive link.

| Task                                                   | Entry point                                                                                      | Contract                                                              | See                                                                                                                                                 |
| :----------------------------------------------------- | :----------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a file-format adapter                              | `src/parsing/adapters/<name>.ts`; register in `src/parsing/registry.ts`                          | `FileTypeAdapter` in `src/parsing/adapter.ts`                         | [#adapter-contract](./ARCHITECTURE.md#adapter-contract); recipe in [contributor SKILL](./skills/polystella-contributor/SKILL.md#add-adapter)        |
| Add a CLI subcommand                                   | Handler in `src/cli/<name>.ts`; register in `src/cli.ts` (`parseSubcommand` + switch)            | Argv parser + `run<Name>(args, deps)`                                 | Recipe in [contributor SKILL](./skills/polystella-contributor/SKILL.md#add-cli-subcommand)                                                          |
| Add a translation provider                             | New branch in `createTranslator` (`src/translation/provider.ts`)                                 | `Translator` interface; permanent vs retriable error classification   | [#translator-contract](./ARCHITECTURE.md#translator-contract); recipe in [contributor SKILL](./skills/polystella-contributor/SKILL.md#add-provider) |
| Change cache key formula                               | `src/storage/hash.ts`                                                                            | **Invariant 1** — cache-wide invalidation                             | [#cache-key](./ARCHITECTURE.md#cache-key)                                                                                                           |
| Edit translation batching                              | `src/translation/batch.ts`, `src/translation/translate-segments.ts`                              | **Invariant 2** — `flat(groups) === segments`                         | [#translation-batching](./ARCHITECTURE.md#translation-batching)                                                                                     |
| Modify cache/storage behaviour                         | `src/storage/{cache,r2,prune,local-cache,report}.ts`                                             | Apply-before-PUT (**Invariant 3**); index isolation (**Invariant 4**) | [#cache-write-order](./ARCHITECTURE.md#cache-write-order), [#local-staging-index](./ARCHITECTURE.md#local-staging-index)                            |
| Modify runtime APIs (entry/collection/href/middleware) | `src/runtime/*`                                                                                  | Bridge timing (**Invariant 5**); per-locale closures                  | [#runtime-bridge](./ARCHITECTURE.md#runtime-bridge)                                                                                                 |
| Modify routing shims                                   | `src/routing/{shim,expand-routes,walk-pages}.ts`                                                 | Stale shims nuked per build; CSS via `routesImports`                  | [#routing-shims](./ARCHITECTURE.md#routing-shims)                                                                                                   |
| Edit UI-string handling                                | `src/i18n/*`, `src/cli/{check,sync,translate}-ui.ts`                                             | Three drift modes; layout-aware writer; `{{token}}` preservation      | [#ui-strings](./ARCHITECTURE.md#ui-strings)                                                                                                         |
| Edit content-collection wiring                         | `src/content/*`                                                                                  | Sibling collections; custom-loader wrapper; bridge timing             | [#runtime-bridge](./ARCHITECTURE.md#runtime-bridge)                                                                                                 |
| Debug a translation that's wrong                       | Start: `pnpm translate --dry-run` to inspect planned R2 keys; `LOG_LEVEL=debug` for batch detail | —                                                                     | Recipe in [contributor SKILL](./skills/polystella-contributor/SKILL.md#debug-translation)                                                           |
| Tune cold-cache build performance                      | `r2.bulkListOnStart`, `concurrency`, `batchInputTokenBudget` knobs                               | —                                                                     | [#bulk-prelist](./ARCHITECTURE.md#bulk-prelist), [#translation-batching](./ARCHITECTURE.md#translation-batching)                                    |

If your task isn't on this list, the answer is in `src/<area>/`
matching one of the subsystem sections in
[ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Invariants

Hard contracts. Don't violate without thinking carefully — link back
to the explanatory section when adding code that touches one.

1. **Cache key formula** — `sha256(body + selectedFrontmatterValues + glossaryHash + modelId)`. Changing any input is a cache-wide invalidation. [→ #cache-key](./ARCHITECTURE.md#cache-key)
2. **Group flattening** — `flat(adapter.groupSegments(...)) === segments` (reference-equal, order-preserved). Asserted at runtime. [→ #translation-batching](./ARCHITECTURE.md#translation-batching)
3. **Apply before PUT** — `applyTranslations` produces the exact bytes PUT to R2; markers woven inside `apply`, never after. [→ #cache-write-order](./ARCHITECTURE.md#cache-write-order)
4. **Local cache index write isolation** — workers write to `nextLocalCacheIndex` only; read only from `localCacheIndex`. [→ #local-staging-index](./ARCHITECTURE.md#local-staging-index)
5. **Bridge timing** — translation runs in `astro:config:setup`, NOT `build:start`. [→ #hook-timing](./ARCHITECTURE.md#hook-timing)
6. **URL-rewrite idempotence** — both layers safe to apply twice. [→ #url-rewriting](./ARCHITECTURE.md#url-rewriting)
7. **Path separators** — R2 keys use `/`, local paths use `path.sep`.
8. **Permanent vs retriable provider errors** — only `PermanentProviderError` short-circuits the retry loop. [→ #translator-contract](./ARCHITECTURE.md#translator-contract)
9. **Strict tsconfig** — no `any`, no `!` outside tests; use `unknown` + type guards; declare callable-`undefined` optionals as `foo?: T | undefined`.

---

## Boundaries

### Always

- Run `pnpm test` before pushing. Tests must stay green.
- Bump the package version in `package.json` only — `POLYSTELLA_VERSION`
  (in `src/version.ts`) reads it at module-load time. The CLI bundle
  (`dist/cli.js`) inlines it via esbuild at build time, so
  `pnpm build:cli` after a version bump. [→ #version-constant](./ARCHITECTURE.md#version-constant)
- Mirror filesystem path semantics across OS: forward slashes for R2
  keys, `path.sep` for local I/O.
- Forward `signal: AbortSignal` when adding a new async function on
  the hot path; `signal?.throwIfAborted()` at await boundaries that
  could otherwise run indefinitely. [→ #abortsignal](./ARCHITECTURE.md#abortsignal)

### Ask first

- Adding a new runtime dependency.
- Adding a new adapter (introduces a new file extension).
- Widening the permanent-provider-error set (HTTP status → `PermanentProviderError`).

### Never

- Re-introduce long-form design comments that were removed; they
  live in [`ARCHITECTURE.md`](./ARCHITECTURE.md) now. In-code
  comments stay tight ("why" only).
- Commit R2 credentials or live API keys to fixtures.
- Widen the AI-translation marker contract without bumping the cache
  key formula. Cache hits return the marker verbatim, so an existing
  cache must remain interpretable.
- Use `any`. Use `unknown` and narrow with type guards.
- Use `!` non-null assertions outside test code.

---

## Footguns by severity

Tiered so you can scan the ones that matter for your change.

### Will break production data or correctness

- **Cache-key formula stability** ([#cache-key](./ARCHITECTURE.md#cache-key)). Any change is a cache-wide invalidation; coordinate via changelog.
- **Apply-before-PUT** ([#cache-write-order](./ARCHITECTURE.md#cache-write-order)). The marker MUST be woven inside `apply`. Doing it after the PUT lets cache hits return marker-less bytes.
- **Bridge timing** ([#hook-timing](./ARCHITECTURE.md#hook-timing)). Moving translation to `build:start` makes sibling collections see empty staging dirs at content-sync time.
- **Workers AI default `maxTokens` is too low** ([#translator-contract](./ARCHITECTURE.md#translator-contract)). Default in our schema is `8192`. Lowering it truncates multi-segment translations into invalid JSON.
- **`{{token}}` validation runs outside `translateBatch`** ([#ui-strings](./ARCHITECTURE.md#ui-strings)). The orchestrator's retry wrapper sets `maxRetries: 0` on `translateBatch` so the retry loop is single-layer. Don't add a second retry layer.

### Will produce confusing failures

- **Override files at `i18n/overrides/{locale}/<path>`** win over AI output verbatim. They run through the URL rewriter (idempotent) but are NOT written to R2. Cache key changes don't affect overrides.
- **MDX vs MD** — `remark-mdx` disables indented code, autolinks, and raw-HTML blocks. Route through the right parser by extension; never apply MDX rules to `.md`.
- **Drift check fails on empty placeholders** ([#ui-strings](./ARCHITECTURE.md#ui-strings)). `pnpm i18n:sync` alone leaves the tree non-shippable until `pnpm i18n:translate` (or a hand-edit) fills the placeholders. Intentionally-blank labels are supported via matching `""` in the source dict.
- **UI-string sync writer is layout-aware** ([#ui-strings](./ARCHITECTURE.md#ui-strings)). Running `prettier --write` on a synced file collapses the blank-line section breaks. The pre-commit hook only runs `prettier --check`, so it doesn't trip — but a manual `pnpm format` will churn diffs.
- **`translate-ui` runs locales in parallel** ([#ui-strings](./ARCHITECTURE.md#ui-strings)). Workers MUST catch every error internally and record it on the per-locale outcome — never re-throw. Re-throwing kills the rest of the run.
- **`adapter.parse` is called once per source per live run** ([#dry-run-vs-live](./ARCHITECTURE.md#dry-run-vs-live)). Adapter `parse` should still be idempotent — calling it twice during debugging or in tests must not produce different output.

### Performance tuning, not correctness

- **R2 bulk pre-list** ([#bulk-prelist](./ARCHITECTURE.md#bulk-prelist)). Disable via `r2.bulkListOnStart: false` for caches with >10k keys per locale.
- **Vitest `singleThread: true`** is faster than multi-worker at current scale (~1.5s vs ~1.6s; per-worker startup dominates). Revisit when the suite outgrows the overhead.
- **Heartbeat `setInterval` is `unref()`'d** ([#heartbeat](./ARCHITECTURE.md#heartbeat)) so a stalled pool doesn't block process exit. Don't remove the unref.

---

## Verification

Before pushing:

- `pnpm test` must pass.
- `pnpm exec tsc --noEmit` must pass (strict mode).
- For changes to the translation pipeline, run end-to-end against a
  real consumer's fixtures: `polystella translate --dry-run` walks
  the full pipeline without hitting AI/R2.
- For changes to UI-string sync / translate: `polystella check-ui`
  (read-only), `polystella sync-ui --check` (read-only),
  `polystella translate-ui --sync-only` (offline, mutates JSONs).

---

## Resources

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system design and rationale.
- [`README.md`](./README.md) — user-facing introduction.
- [`skills/polystella-contributor/SKILL.md`](./skills/polystella-contributor/SKILL.md) — recipes for contributor tasks.
- [`skills/polystella-consumer/SKILL.md`](./skills/polystella-consumer/SKILL.md) — for agents in downstream consumer repos.
- [`llms.txt`](./llms.txt) — index for retrieval-time discovery.
