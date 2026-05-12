# PolyStella Architecture

System-level design decisions and rationale. In-code comments stay tight
("why" only); the longer-form context that explains *how the pieces fit*
lives here so contributors and agents can find it without scrolling through
implementation files.

For day-to-day usage and configuration reference, see the docs site
(forthcoming). For agent-facing gotchas, see `AGENTS.md`.

---

## 1. Pipeline at a glance

PolyStella is an Astro integration that runs at build time. The entry point
is `src/index.ts`, which registers two Astro hooks:

- **`astro:config:setup`** does almost all the work:
  1. validates options against `config.i18n`,
  2. registers the `polystella:runtime-config` Vite virtual module,
  3. wires the per-request `Astro.locals` middleware (unless opted out),
  4. cleans + regenerates locale-prefixed route shims,
  5. checks UI-strings dictionary drift across locales (fail-fast on miss),
  6. runs the translation pass (`runTranslationPass` in
     `src/translation/run.ts`),
  7. publishes the runtime bridge for custom-loader siblings.
- **`astro:build:done`** emits `dist/i18n-r2-report.json` and logs the
  custom-loader summary.

The orchestration loop is intentionally split out of `index.ts`: the same
`runTranslationPass` powers the standalone `polystella-translate` CLI
without Astro on the import path.

## 2. Why translation runs in `config:setup`, not `build:start`

`polystellaCollections` registers per-locale sibling content collections
whose loaders read from `<stagingDir>/<locale>/<collection>/...`. Astro
syncs the content layer **between `config:setup` and `build:start`**. If we
staged in `build:start`, the siblings would already be empty when sync ran
and the runtime dispatcher would always fall back to source.

This is the single most surprising ordering constraint in the integration.
Don't move staging later in the lifecycle without re-doing the sibling
loader contract.

## 3. Staging directory vs cache directory

Translated bytes land at `<root>/.astro/i18n-staging/{locale}/...` — under
the **project root**, not `config.cacheDir`. `cacheDir` resolves to
`<root>/node_modules/.astro/` by default, which would desync from where
`polystellaCollections` reads.

Shims (the locale-prefixed route stubs Astro injects) do live under
`cacheDir` because Astro imports them via the path returned from
`injectRoute` — the indirection insulates them from the staging location.

## 4. Runtime bridge for custom loaders

`polystellaCollections` runs **after** the integration's `config:setup`
returns (it's called from the user's `content.config.ts`, at content-sync
time). The two halves need to share live JS objects (R2 client,
translators, glossaries) that can't be serialised through the
`polystella:runtime-config` virtual module.

The bridge in `src/runtime/custom-loader-runtime.ts` is a module-scoped
singleton populated by `setRuntimeBridge` during `config:setup` and read by
the sibling loaders at sync time. Module-scoped state is fine because Astro
runs both halves in the same Node process.

`publishRuntimeBridge` in `index.ts` re-loads glossaries and constructs
translators that `runTranslationPass` already built internally. The
duplication is deliberate (and cheap — one extra FS read per locale) to
keep `runTranslationPass`'s signature focused on the file-based pipeline.
A future consolidation can extract a shared dep builder.

## 5. Cache-key formula

R2 keys are content-addressed:

```
hash = sha256(body + selectedFrontmatterValues + glossaryHash + modelId)
```

Inputs:

- **`body`** — the raw source bytes.
- **`selectedFrontmatterValues`** — only the frontmatter fields the adapter
  considers translatable (or URL-rewrite targets). Editing untranslated
  fields (e.g. an internal `id`) doesn't invalidate the cache.
- **`glossaryHash`** — `hashGlossary(...)`. Changing a glossary entry
  re-translates the pages that mention the changed term, not the whole
  corpus.
- **`modelId`** — the per-locale resolved model. Switching models is an
  explicit invalidation.

Any change to this formula is a cache-wide invalidation. Treat the
formula's stability as part of the public contract.

## 6. Mode boundary: standalone vs Starlight

`resolved.mode` is `"standalone"` (the only currently-shipped mode) or
`"starlight"` (planned for v0.x post-cleanup). The two differ in:

- Routing: standalone injects its own shims; Starlight defers to its own
  route tree.
- UI strings: standalone installs polystella's `Astro.locals.t`; Starlight
  defers to its i18next-backed `t`.

The mode is exposed through the `polystella:runtime-config` virtual module
so the middleware can branch without re-reading the config.

## 7. Dry-run vs live pass

`runTranslationPass` runs ONE walk per source in live mode. The
separate dry-run pass exists only when the run is non-live
(`dryRun: true` or no provider configured); it counts pairs and
optionally — under `LOG_LEVEL=debug` — emits the planned R2 keys.

Live runs compute the cache key naturally inside the worker, so the
dry-run "preview the work" pass would be pure duplication. The two
passes are mutually exclusive.

## 8. Local staging index

`<stagingDir>/.polystella-cache.json` tracks the source hash of every
(file, locale) pair last staged. Subsequent runs use it to short-circuit
unchanged pairs entirely — no R2 GET, no staging write.

Two maps are involved:

- `localCacheIndex`: read once at the start of the run, immutable during
  the run.
- `nextLocalCacheIndex`: each pool worker writes its outcome here; the map
  is persisted at the end.

The split keeps the skip decision deterministic — a worker can't
accidentally observe another worker's just-written entry as a "skip me"
signal.

## 8.5. R2 bulk pre-list

Before the live worker pool starts, `runTranslationPass` fans out
one `r2.list(prefix + locale + "/")` per (prefix × locale) pair and
populates an in-memory `Set<string>` of every cached key. The cache
layer takes an optional `existsInCache: (key) => boolean` predicate
and uses it to short-circuit the `r2.get(key)` round-trip when the
key is known to be absent.

Trade-offs:

- **Cost when the cache is small or empty:** one list call returns
  zero results, an obvious win.
- **Cost when the cache is large:** the list call paginates. For
  caches with 10k+ keys per locale, the upfront cost can exceed the
  savings. Operators opt out via `r2.bulkListOnStart: false`.
- **Correctness:** the in-memory set is populated before any write,
  and each pair has a unique cache key (the hash includes the full
  source body), so writes from one pair never affect lookups for
  another. No staleness window.
- **Failure mode:** if the list throws (transient R2 outage), we
  log a warning and the worker falls back to per-pair GETs — the
  build still completes correctly, just slower.

## 9. R2 cache layout and branch dispatch

| Mode             | Trigger                         | Reads from                                       | Writes to                  |
| ---------------- | ------------------------------- | ------------------------------------------------ | -------------------------- |
| Local build      | `pnpm build` / `pnpm dev`       | `i18n/` (production)                             | nowhere — `readOnly: true` |
| CI build (main)  | Workers Builds, branch = `main` | `i18n/`                                          | `i18n/`                    |
| CI build (other) | Workers Builds, branch ≠ `main` | `previews/<branch>/i18n/`, falls back to `i18n/` | `previews/<branch>/i18n/`  |
| CLI run          | `pnpm translate`                | same as CI for the resolved branch               | same as CI                 |

`readFallbackPrefixes` is the read-only consult list for cache misses
against the primary `prefix`. First hit wins; bytes are returned verbatim
and **not** promoted into the primary prefix (no implicit cross-prefix
copies). This keeps writes deterministic and branch-isolated.

## 10. Build-feed heartbeat

Astro emits a single "Waiting for integration..." line after 3s, then goes
silent until the hook returns. With `verbose: false`, the per-pair log
lines are suppressed, so a cold-cache live run can sit quiet for tens of
seconds.

The heartbeat in `runTranslationPass` is either-or:

- a 15s timer ensures *something* prints during genuinely slow stretches,
- a 5%-progress threshold short-circuits the timer so a fast burst
  surfaces immediately.

It's disabled for trivially small runs (≤10 pairs) and when `verbose: true`
(which already prints one line per pair). The `setInterval` handle is
`unref()`'d so a stalled pool doesn't keep the Node event loop alive.

## 11. Cache writes are post-translation

The cache layer (`storage/cache.ts`) is format-agnostic. On a miss it:

1. calls the translator,
2. calls the caller-supplied `apply` closure to splice translations back
   into source bytes,
3. PUTs the resulting bytes to R2 verbatim and returns them to the caller
   for staging.

Any AI-translation marker (e.g. `aiTranslated: true` baked into
frontmatter) is the caller's responsibility — it must be woven into
`apply` **before** the PUT so later cache hits return the marker verbatim
and timestamps stay truthful.

`readOnly: true` skips the PUT but still returns the translated bytes:
the translator was already paid for; `readOnly` governs cache writes, not
the translation pipeline itself.

## 12. URL rewriting layers

Post-cache, staged bytes go through two URL rewrites:

1. **Adapter-specific key-path rewriting** for frontmatter URL keys
   (markdown) or structured URL paths (TOML/etc.) via `adapter.rewriteUrls`.
2. **Inline-link rewriting** via `rewriteInternalLinks` over bytes —
   markdown-only (structured-data formats have no body links).

Both layers share `rewriteUrlIfInternal` underneath, so `noPrefixUrls`
exemptions apply uniformly. Both layers are idempotent.

## 13. Adapter contract

Every file format goes through `parsing/adapter.ts`'s `FileTypeAdapter`
interface:

- `parse(body, sourcePath)` — bytes → format-specific AST.
- `extract(parsed, opts)` — AST → translatable `Segment[]`.
- `apply(parsed, translations, opts)` — AST × translations → output bytes.
- `peekNoTranslate(parsed)` — `noTranslate: true` short-circuit.
- `selectedValuesForHash(parsed, body, opts)` — frontmatter values that
  feed into the cache hash.
- `rewriteUrls?(bytes, opts)` — optional structured URL rewrite.

Adding a new format = implementing this interface + registering it in
`parsing/registry.ts`. No changes to `run.ts` or the cache layer required.

## 14. Routing shim model (standalone mode)

For each entry in `routes`, polystella:

1. globs the pattern against on-disk pages,
2. writes a shim under `<cacheDir>/polystella-shims/route-<idx>.astro`
   that imports the source page and re-exports `getStaticPaths` expanded
   over non-default locales,
3. injects `/[lang]/...` route patterns pointing at the shim.

Stale shims are nuked unconditionally at the start of each build. Global
`routesImports` are deduped against per-route extras by absolute path so
the same file listed in both places only emits one import line.

## 15. Module-scope POLYSTELLA_VERSION

Lives in `src/version.ts` as a JSON import from `package.json`
(`import pkg from "../package.json" with { type: "json" }`).
Re-exported from `src/index.ts` and consumed directly by `src/cli.ts`.

The CLI is bundled via esbuild (`pnpm build:cli`), which inlines the
JSON content at build time. The library itself ships as raw TS, so
the JSON import resolves naturally through Astro/Vite at consumer
build time.

Bump `package.json` only; both surfaces follow. The constant is
baked into R2 metadata and the build report — changes to the version
do NOT invalidate the cache (the version isn't in the hash formula),
so a `0.x → 0.y` bump is safe to roll out without a cache flush.
