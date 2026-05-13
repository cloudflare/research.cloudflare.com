# PolyStella Architecture

System-level design, hard invariants, domain glossary, and per-subsystem
reference. In-code comments stay tight ("why" only); this file is the
canonical home for the longer-form context.

For task recipes ("I want to add an adapter / a provider / a CLI
subcommand"), see [`AGENTS.md`](./AGENTS.md). For consumer-side wiring,
see [`skills/polystella-consumer/SKILL.md`](./skills/polystella-consumer/SKILL.md).
Future-tense planning lives in `plans/PHASE-PLAN.md` (in the parent
monorepo, until the split).

All cross-references in this doc and in `AGENTS.md` use **stable slug
anchors** (e.g. `#cache-key`), not section numbers. Inserting a new
section never invalidates an existing link.

---

## Contents

- [Overview](#overview)
- [Glossary](#glossary)
- [Invariants](#invariants)
- [Pipeline](#pipeline)
- [Hook timing](#hook-timing)
- [Staging vs cache directory](#staging-vs-cache)
- [Runtime bridge](#runtime-bridge)
- [Cache key](#cache-key)
- [R2 layout and branch dispatch](#r2-dispatch)
- [R2 bulk pre-list](#bulk-prelist)
- [Local staging index](#local-staging-index)
- [Dry-run vs live pass](#dry-run-vs-live)
- [Cache writes are post-translation](#cache-write-order)
- [URL rewriting layers](#url-rewriting)
- [Adapter contract](#adapter-contract)
- [Translator contract](#translator-contract)
- [Translation batching](#translation-batching)
- [Routing shims (standalone mode)](#routing-shims)
- [UI-strings pipeline](#ui-strings)
- [Mode boundary](#mode-boundary)
- [Heartbeat](#heartbeat)
- [AbortSignal threading](#abortsignal)
- [Version constant](#version-constant)

---

## Overview

<a id="overview"></a>

PolyStella is an Astro integration that translates content into
additional locales at build time using AI, caches translations in
Cloudflare R2, and injects locale-prefixed routes for the translated
pages. The same orchestrator powers a standalone `polystella` CLI so
operators can run the pipeline outside `astro build`.

```
       ┌────────────────────────────────────────────────────────┐
       │              astro:config:setup (or CLI)               │
       └────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  walk sources ──► per (file × locale) worker pool ◄── R2 bulk pre-list
                                  │
                ┌─────────────────┴─────────────────┐
                ▼                                   ▼
        cache key matches?                   override file present?
                │                                   │
        no ┌────┴────┐ yes                          ▼
           ▼         ▼                       read verbatim, rewrite URLs
       parse +    return cached
       extract    bytes, rewrite                    │
           │     URLs, stage                        │
           ▼                                        │
       translate (token-aware batches,              │
         heading-anchored grouping,                 │
         document-context preamble)                 │
           │                                        │
           ▼                                        │
        apply translations + AI marker              │
           │                                        │
           ▼                                        │
        PUT to R2 (post-apply bytes)                │
           │                                        │
           ▼                                        ▼
        rewrite URLs → stage under <root>/.astro/i18n-staging/<locale>/
                                  │
                                  ▼
        polystellaCollections (in user's content.config.ts)
        reads staged bytes via the runtime bridge → Astro content layer
                                  │
                                  ▼
        routing shims under <cacheDir>/polystella-shims/
        inject `/[lang]/...` routes pointing at staged content
                                  │
                                  ▼
                            astro build → dist/
```

Two entry points share `runTranslationPass` in `src/translation/run.ts`:

- **Astro integration** (`src/index.ts`) — registers hooks, runs the
  pass, publishes the runtime bridge.
- **CLI** (`src/cli.ts`) — verb-style dispatcher routing to
  `src/cli/<subcommand>.ts`. `translate` reuses `runTranslationPass`;
  `check-ui`, `sync-ui`, `translate-ui` operate on UI-string JSONs and
  don't touch the markdown pipeline or R2.

---

## Glossary

<a id="glossary"></a>

| Term                      | Meaning                                                                                                                                                                                                                                    |
| :------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adapter**               | A `FileTypeAdapter` implementation owning one file format (markdown, TOML, JSON, YAML). Parses, extracts segments, applies translations. See [adapter contract](#adapter-contract).                                                        |
| **Segment**               | The atomic translatable unit emitted by `adapter.extractSegments`. Has a stable per-file ID (`body:N`, `fm:key`, `fm:key[i]`, or a dotted key path).                                                                                       |
| **Group**                 | An ordered list of segments inside one section (e.g. all paragraphs under one heading). Produced by `adapter.groupSegments`; the batcher packs groups into batches under a token budget.                                                   |
| **Batch**                 | One prompt round-trip's worth of segments. Produced by `packGroupsIntoBatches`. Each batch carries its own document-context block.                                                                                                         |
| **Marker**                | The AI-translation flag (e.g. `aiTranslated: true`) injected into output bytes by `adapter.applyTranslations` before the R2 PUT. Cache hits return the marker verbatim.                                                                    |
| **Stage**                 | The act of writing translated bytes to `<root>/.astro/i18n-staging/<locale>/<sourcePath>`. Astro's content layer reads from here.                                                                                                          |
| **Shim**                  | A generated `.astro` file under `<cacheDir>/polystella-shims/` that imports a source page and re-renders it under a locale-prefixed pattern.                                                                                               |
| **Override**              | A hand-translated file at `i18n/overrides/<locale>/<mirrored-path>` that wins over AI output verbatim. Goes through URL rewriting but never written to R2.                                                                                 |
| **Drift**                 | A non-default-locale UI-string JSON disagreeing with the default-locale source: missing keys, extra keys, or `""` placeholders where the source is non-empty.                                                                              |
| **Miss path**             | The code branch in the cache layer when an R2 GET returns nothing. Triggers translator + apply + PUT.                                                                                                                                      |
| **Live phase / live run** | A run that actually translates (provider configured, `dryRun: false`). The pipeline only walks sources once in this mode.                                                                                                                  |
| **Bridge**                | `src/runtime/custom-loader-runtime.ts` — the module-scoped singleton holding live JS objects (R2 client, translators, glossaries) shared between `astro:config:setup` and the sibling content collections registered at content-sync time. |
| **Sibling collection**    | A per-locale content collection (`publications__pt-BR`, etc.) auto-registered by `polystellaCollections` alongside the user's source collection.                                                                                           |
| **Branch dispatch**       | The three-mode R2 prefix selection (local / CI main / CI preview) driven by `WORKERS_CI_BRANCH` and `POLYSTELLA_CLI`. See [R2 dispatch](#r2-dispatch).                                                                                     |

---

## Invariants

<a id="invariants"></a>

Hard contracts. Violating any of these breaks correctness or
production data. Always link back to the explanatory section when
adding new code that touches one.

1. **Cache key formula.** `hash = sha256(body + selectedFrontmatterValues + glossaryHash + modelId)`. Any change is a cache-wide invalidation. See [#cache-key](#cache-key).
2. **Group flattening.** `flat(adapter.groupSegments(...)) === segments` (reference-equal, order-preserved). Asserted at runtime. See [#translation-batching](#translation-batching).
3. **Apply before PUT.** `adapter.applyTranslations` must produce the exact bytes that get PUT to R2; any AI-translation marker is woven in inside `apply`, never after. Cache hits return the PUT bytes verbatim. See [#cache-write-order](#cache-write-order).
4. **Local cache index write isolation.** Pool workers read from `localCacheIndex` (immutable for the run) and write to `nextLocalCacheIndex` (accumulated, persisted at end). A worker MUST NOT read from `nextLocalCacheIndex`. See [#local-staging-index](#local-staging-index).
5. **Bridge timing.** `setRuntimeBridge` is called inside `astro:config:setup`; `polystellaCollections` reads it at content-sync time, which happens between `config:setup` and `build:start`. Translation MUST run in `config:setup` so staged files exist before sibling loaders execute. See [#hook-timing](#hook-timing).
6. **URL-rewrite idempotence.** Both layers (`adapter.rewriteUrls` + `rewriteInternalLinks`) must be safe to apply twice. Overrides re-rewrite without doubling prefixes. See [#url-rewriting](#url-rewriting).
7. **Path separator convention.** R2 keys use forward slashes (POSIX); local filesystem paths use `path.sep`. Sources are walked relative to project root, then joined per target.
8. **Permanent vs retriable provider errors.** Only `PermanentProviderError` short-circuits `translateBatch`'s retry loop. Wrap 4xx (400/401/403/404/422); everything else retries with exponential backoff. See [#translator-contract](#translator-contract).
9. **No `any`, no `!` outside tests.** Strict tsconfig flags are all on (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`). Use `unknown` + type guards; for optional properties accepting explicit `undefined` from callers, declare `foo?: T | undefined`.

---

## Pipeline

<a id="pipeline"></a>

`runTranslationPass` (in `src/translation/run.ts`) is the
orchestrator. Same function powers both the Astro integration and
the `polystella translate` CLI subcommand. Zero direct dependency on
Astro's types so the CLI can run without Astro on the import path.

Sequenced steps:

1. Load glossaries (`src/glossary/`).
2. Walk sources (`src/source/walk.ts`) — respects `include` / `exclude`.
3. Bulk pre-list R2 once per (prefix × locale) — populates an
   in-memory existence predicate (see [#bulk-prelist](#bulk-prelist)).
4. Read the local staging index (see [#local-staging-index](#local-staging-index)).
5. Run a worker pool over (file, locale) pairs with
   `runWithConcurrency` (`src/source/pool.ts`).
6. Per pair: short-circuit on local-skip → check override → check R2 →
   translate → apply → PUT → rewrite URLs → stage.
7. Persist `nextLocalCacheIndex` to disk.
8. Prune R2 keys not touched this run (within the configured prefix
   only — never cross-prefix).
9. Return `RunTranslationResult` to the caller (build report fields,
   glossaries, counts, abort status).

`runTranslationPass` does NOT inject routes/shims, run UI-strings drift
detection, or write the build report. Those are caller responsibilities
— the integration and the CLI each handle them differently.

---

## Hook timing

<a id="hook-timing"></a>

Translation runs in `astro:config:setup`, NOT `build:start`. This is
the single most surprising ordering constraint in the integration.

`polystellaCollections` registers per-locale sibling content collections
whose loaders read from `<stagingDir>/<locale>/<collection>/...`. Astro
syncs the content layer **between `config:setup` and `build:start`**.
If we staged in `build:start`, the siblings would already be empty
when sync ran and the runtime dispatcher would always fall back to
source. Don't move staging later in the lifecycle without re-doing
the sibling loader contract.

`astro:build:done` emits `dist/i18n-r2-report.json` and logs the
custom-loader summary.

---

## Staging vs cache directory

<a id="staging-vs-cache"></a>

Translated bytes land at `<root>/.astro/i18n-staging/{locale}/...` —
under the **project root**, not `config.cacheDir`. `cacheDir` resolves
to `<root>/node_modules/.astro/` by default, which would desync from
where `polystellaCollections` reads.

Shims (the locale-prefixed route stubs Astro injects) do live under
`cacheDir` because Astro imports them via the path returned from
`injectRoute` — the indirection insulates them from the staging
location.

---

## Runtime bridge

<a id="runtime-bridge"></a>

`polystellaCollections` runs **after** the integration's `config:setup`
returns (it's called from the user's `content.config.ts`, at
content-sync time). The two halves need to share live JS objects (R2
client, translators, glossaries) that can't be serialised through the
`polystella:runtime-config` virtual module.

The bridge in `src/runtime/custom-loader-runtime.ts` is a module-scoped
singleton populated by `setRuntimeBridge` during `config:setup` and
read by the sibling loaders at sync time. Module-scoped state is fine
because Astro runs both halves in the same Node process.

`publishRuntimeBridge` in `index.ts` re-loads glossaries and constructs
translators that `runTranslationPass` already built internally. The
duplication is deliberate (and cheap — one extra FS read per locale)
to keep `runTranslationPass`'s signature focused on the file-based
pipeline. A future consolidation can extract a shared dep builder.

---

## Cache key

<a id="cache-key"></a>

R2 keys are content-addressed:

```
hash = sha256(body + selectedFrontmatterValues + glossaryHash + modelId)
```

Inputs:

- **`body`** — the raw source bytes.
- **`selectedFrontmatterValues`** — only the frontmatter fields the
  adapter considers translatable (or URL-rewrite targets). Editing
  untranslated fields (e.g. an internal `id`) doesn't invalidate the
  cache.
- **`glossaryHash`** — `hashGlossary(...)`. Changing a glossary entry
  re-translates the pages that mention the changed term, not the whole
  corpus.
- **`modelId`** — the per-locale resolved model. Switching models is
  an explicit invalidation.

**Not in the hash:**

- The integration version (`POLYSTELLA_VERSION`). Recorded in R2
  metadata for diagnostics; a `0.x → 0.y` bump doesn't re-translate.
- `markdown.contextKeys` and the resulting per-batch document-context
  block — editing them doesn't bust the cache (see [#translation-batching](#translation-batching)).
- `noPrefixUrls` and other URL-rewriting config — applied
  post-cache (see [#url-rewriting](#url-rewriting)).

This is **Invariant 1**. Any change to the formula is a cache-wide
invalidation. Treat its stability as part of the public contract.

---

## R2 layout and branch dispatch

<a id="r2-dispatch"></a>

Three logical writers, distinguished by env-var signals:

| Mode             | Detection                                 | `r2.prefix`                         | `r2.readFallbackPrefixes` | `r2.readOnly` | Behaviour                                                                                                                                    |
| :--------------- | :---------------------------------------- | :---------------------------------- | :------------------------ | :------------ | :------------------------------------------------------------------------------------------------------------------------------------------- |
| Local build      | neither env var set                       | `i18n/`                             | _(none)_                  | `true`        | Reads main's cache; on miss, translates locally and stages without writing to R2. A developer's machine can never overwrite production data. |
| CI build (main)  | `WORKERS_CI_BRANCH=main`                  | `i18n/`                             | _(none)_                  | `false`       | Production cache; the sole writer of `i18n/`.                                                                                                |
| CI build (other) | `WORKERS_CI_BRANCH=<other>`               | `previews/<sanitized-branch>/i18n/` | `["i18n/"]`               | `false`       | Preview cache; reads main's translations on miss, only writes its own variants under `previews/`.                                            |
| Explicit CLI     | `POLYSTELLA_CLI=1` + branch-from-anywhere | as above (per resolved branch)      | as above                  | `false`       | `pnpm translate` writes to R2 per the branch's prefix. Branch resolution: `--branch` flag → `WORKERS_CI_BRANCH` env → `git rev-parse HEAD`.  |

`readFallbackPrefixes` is the read-only consult list for cache misses
against the primary `prefix`. First hit wins; bytes are returned
verbatim and **not** promoted into the primary prefix (no implicit
cross-prefix copies). This keeps writes deterministic and
branch-isolated.

Branch sanitization (`[^a-zA-Z0-9_-]+` → `-`, trim) lives in the
consumer's `polystella.config.mjs`, not the package.

---

## R2 bulk pre-list

<a id="bulk-prelist"></a>

Before the live worker pool starts, `runTranslationPass` fans out one
`r2.list(prefix + locale + "/")` per (prefix × locale) pair and
populates an in-memory `Set<string>` of every cached key. The cache
layer takes an optional `existsInCache: (key) => boolean` predicate
and uses it to short-circuit the `r2.get(key)` round-trip when the
key is known to be absent.

Trade-offs:

- **Small/empty cache** — one list call returns zero results, obvious win.
- **Large cache** — `>10k` keys per locale, list pagination cost can
  exceed the savings. Operators opt out via `r2.bulkListOnStart: false`.
- **Correctness** — the set is populated before any write, and each
  pair has a unique cache key, so writes from one pair never affect
  lookups for another. No staleness window.
- **Failure mode** — if the list throws (transient R2 outage), we log
  a warning and the worker falls back to per-pair GETs. Build still
  completes correctly, just slower.

---

## Local staging index

<a id="local-staging-index"></a>

`<stagingDir>/.polystella-cache.json` tracks the source hash of every
(file, locale) pair last staged. Subsequent runs use it to
short-circuit unchanged pairs entirely — no R2 GET, no staging write.

Two maps are involved:

- `localCacheIndex` — read once at the start of the run, immutable
  during the run.
- `nextLocalCacheIndex` — each pool worker writes its outcome here;
  the map is persisted at the end.

The split keeps the skip decision deterministic — a worker can't
accidentally observe another worker's just-written entry as a
"skip me" signal. This is **Invariant 4**.

---

## Dry-run vs live pass

<a id="dry-run-vs-live"></a>

`runTranslationPass` runs ONE walk per source in live mode. The
separate dry-run pass exists only when the run is non-live
(`dryRun: true` or no provider configured); it counts pairs and
optionally — under `LOG_LEVEL=debug` — emits the planned R2 keys.

Live runs compute the cache key naturally inside the worker, so the
dry-run "preview the work" pass would be pure duplication. The two
passes are mutually exclusive.

`adapter.parse` is called once per source per live run. Adapter `parse`
should still be idempotent — calling it twice during debugging or in
tests must not produce different output.

---

## Cache writes are post-translation

<a id="cache-write-order"></a>

The cache layer (`src/storage/cache.ts`) is format-agnostic. On a miss
it:

1. calls the translator,
2. calls the caller-supplied `apply` closure to splice translations
   back into source bytes,
3. PUTs the resulting bytes to R2 verbatim and returns them to the
   caller for staging.

Any AI-translation marker (e.g. `aiTranslated: true` baked into
frontmatter) is the caller's responsibility — it must be woven into
`apply` **before** the PUT so later cache hits return the marker
verbatim and timestamps stay truthful. This is **Invariant 3**.

`readOnly: true` skips the PUT but still returns the translated bytes:
the translator was already paid for; `readOnly` governs cache writes,
not the translation pipeline itself.

---

## URL rewriting layers

<a id="url-rewriting"></a>

Post-cache, staged bytes go through two URL rewrites:

1. **Adapter-specific key-path rewriting** for frontmatter URL keys
   (markdown) or structured URL paths (TOML/etc.) via
   `adapter.rewriteUrls`.
2. **Inline-link rewriting** via `rewriteInternalLinks` over bytes —
   markdown-only (structured-data formats have no body links).

Both layers share `rewriteUrlIfInternal` underneath, so `noPrefixUrls`
exemptions apply uniformly. Both layers are idempotent
(**Invariant 6**) — overrides re-rewrite without doubling prefixes.

---

## Adapter contract

<a id="adapter-contract"></a>

Every file format implements `FileTypeAdapter` in
`src/parsing/adapter.ts` and registers in `src/parsing/registry.ts`.
No changes to `run.ts` or the cache layer required.

Abbreviated shape:

```ts
interface FileTypeAdapter<TParsed = unknown> {
  readonly extensions: readonly string[]; // [".md", ".mdx"]
  parse(source: string, sourcePath?: string): TParsed; // pure; throws on syntactic errors
  extractSegments(parsed, source, opts): Segment[]; // emit translatable units
  applyTranslations(parsed, source, translations, opts): string; // → output bytes (Invariant 3)
  selectedValuesForHash(parsed, source, opts): Record<string, unknown>; // feeds the cache hash
  peekNoTranslate(parsed): boolean; // `noTranslate: true` opt-out
  rewriteUrls?(bytes, opts): string; // post-cache, idempotent
  groupSegments?(parsed, segments): Segment[][]; // for batching (Invariant 2)
  documentContext?(parsed, opts): string | undefined; // per-batch system-prompt framing
}

interface Segment {
  id: string; // body:N | fm:key | fm:key[i] | dotted.path
  text: string; // never empty
}
```

**ID grammar.** Segment IDs are unique within a single file and
round-trip verbatim through the translator. Markdown uses
`body:n` / `fm:key` / `fm:key[i]`; structured-data adapters use
dotted key paths. The grammar only needs to be self-consistent within
an adapter.

**Cache-key composition.** Today every adapter feeds the same hash:
`body + selectedSnapshot + glossaryHash + modelId`. For structured-data
adapters, hashing the full body is over-conservative — non-translatable
fields shouldn't bust the cache. A planned variant scopes this to
declared translatable paths.

**First-registered wins.** The registry silently ignores subsequent
registrations for the same extension. Tests that need a clean slate
call `resetRegistry()` before registering.

---

## Translator contract

<a id="translator-contract"></a>

One `Translator` per (provider, locale). Two concrete providers ship:
Workers AI and Anthropic. Both speak the same prompt-and-JSON-back
contract enforced by `src/translation/prompt.ts`.

```ts
interface Translator {
  readonly modelId: string; // resolved per-locale; in cache key
  translate(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string>; // raw text; caller parses
}
```

Permanent vs retriable (**Invariant 8**):

- `PermanentProviderError` short-circuits `translateBatch`'s retry
  loop. Wraps HTTP 400, 401, 403, 404, 422.
- Everything else (5xx, network, parse failures, model hallucinations)
  retries via `p-retry` with exponential backoff. Production callers
  pass `retryMinTimeoutMs: 100`, `factor: 2`, `randomize: true`.
- Don't widen the permanent set without thinking about what flaky
  responses might wrongly skip retry.

**Model resolution.** `resolveModelId(spec, locale)` returns either the
string `spec` directly or `spec[locale] ?? spec.default`. The result
folds into the cache key — switching models for a locale invalidates
that locale only.

---

## Translation batching

<a id="translation-batching"></a>

Token-aware batching plus per-batch document-context injection.
Replaces an earlier "one prompt per file" path that truncated
multi-segment files on the model's output-token cap.

**Heading-anchored grouping (markdown).** The markdown adapter's
`groupSegments` walks the AST in DFS order and partitions emitted
segments into groups: every heading node starts a new group;
paragraphs and table cells append to the current group; frontmatter
segments form a single trailing group regardless of body shape. The
invariant `flat(groups) === segments` (reference-equal,
order-preserved) is asserted at runtime — this is **Invariant 2**.
Adapters that don't implement `groupSegments` fall through to a
single-group default in `translateSegments`, which then packs by
token budget alone.

**Token-aware packing.** `packGroupsIntoBatches` (in
`src/translation/batch.ts`) is a pure function over `Segment[][]`.
Greedy-fills batches under a soft input-token budget
(`provider.batchInputTokenBudget`, default `4000`) using
`Math.ceil((id + text + 8) / 4)` per segment — the `+8` covers the
marker line overhead, the `/4` is a pessimistic char→token heuristic
(under-packs for CJK, which is the safer side of the trade-off).
When a single group exceeds the budget alone, the function falls back
to paragraph-by-paragraph splitting within that group and emits
`logger.warn` so operators see the degraded case.

**Per-batch document context.** The markdown adapter's
`documentContext` reads `markdown.contextKeys` (per-glob → key list,
opt-in, default `{}`) and emits one `<Title-Cased Key>: <one-line
value>` line per resolved string-typed frontmatter value. Injected
into every batch's system prompt under a `DOCUMENT CONTEXT (for
terminology only; do not translate this block):` preamble. The "do
not translate this block" clause is load-bearing — small instruct
models occasionally echo context segments back as translation markers
without it.

**Per-batch retry isolation.** Each batch has its own `p-retry`
budget; a transient failure on batch 3 of 5 retries only batch 3.
A `PermanentProviderError` on any batch short-circuits the entire
`translateSegments` call.

**Sequential within a file.** Batches within a single file run
sequentially. Parallelism already exists at the (file, locale) pair
level via the worker pool; sequential within-file batches keep
rate-limit math simple (effective in-flight requests = pool size).

**Cache-key invariance (v1 trade-off).** `documentContext` and
`markdown.contextKeys` are NOT in the cache-key hash. Changing
`contextKeys` from `["title"]` to `["title", "excerpt"]` does not
bust the cache — old cached translations are served with their
original context (or no context) until natural body-edit turnover
re-translates them. Eventually-consistent rather than strictly
consistent; the alternative (hashing context-bearing values) would
invalidate the entire cache on every config tweak.

**Observability.** When the miss path engages more than one batch,
the per-pair verbose log line includes `, ${batchCount} batches`
after the segment count. The oversize-section warning includes the
source path so operators can find files that need splitting.

---

## Routing shims (standalone mode)

<a id="routing-shims"></a>

For each entry in `routes`, polystella:

1. globs the pattern against on-disk pages,
2. writes a shim under `<cacheDir>/polystella-shims/route-<idx>.astro`
   that imports the source page and re-exports `getStaticPaths`
   expanded over non-default locales,
3. injects `/[lang]/...` route patterns pointing at the shim.

Stale shims are nuked unconditionally at the start of each build.
Global `routesImports` are deduped against per-route extras by
absolute path so the same file listed in both places only emits one
import line.

**CSS via shims.** Astro's per-route `<link rel="stylesheet">`
injection follows direct first-degree CSS imports of the route's own
module — but it does NOT follow CSS through `<SourcePage />` rendered
as a child component. Without intervention, every translated route
would ship with no stylesheet link. Operators list global CSS in
`routesImports` so each shim emits the import; per-route overrides
are supported via the object form (`{ source, imports }`).

---

## UI-strings pipeline

<a id="ui-strings"></a>

UI strings live in `src/content/i18n/<locale>.json` as flat
`Record<string, string>` dicts. The default-locale file is the single
source of truth; non-default locales must match its key set.

Three CLI subcommands maintain the invariant:

- **`check-ui`** (`src/cli/check-ui.ts`) — pure drift detection. Zero
  writes, zero network. Pre-commit hook target. Catches three failure
  modes: missing keys, extra keys, and **empty-placeholder values**
  (a key shared with the source dict but with `""` in the locale
  where the source value is non-empty). The build's own drift check
  at `astro:config:setup` uses the same predicate.
- **`sync-ui`** (`src/cli/sync-ui.ts` + `src/i18n/sync.ts`) —
  mechanical key reconciliation. Adds missing keys as empty strings,
  drops extras, preserves existing values (empty or not), re-emits
  files in source-file key order with blank-line section breaks
  preserved.
- **`translate-ui`** (`src/cli/translate-ui.ts` +
  `src/i18n/ui-translate.ts`) — runs sync, then for each locale calls
  `translateBatch` once with every empty-valued key as a segment.
  Locales run in parallel via `runWithConcurrency`.

**Layout-aware writer.** `formatLocaleFile` in `src/i18n/sync.ts`
parses the source file's text (not just its JSON) to recover top-level
key order AND which keys start a new "section" (blank line
immediately before). The output then mirrors that layout for every
locale. Without this, every sync run would churn diffs by reordering
keys alphabetically.

**`{{token}}` preservation.** Validated post-translation by
extracting `{{\w+}}` tokens from both source and translation and
comparing the sets. Validator lives _outside_ `translateBatch` (in
`src/i18n/ui-translate.ts`) because `translateBatch` doesn't expose
a post-parse hook. The orchestrator runs its own retry wrapper with
`maxRetries: 0` passed to `translateBatch` so the retry loop is
single-layer. A token-invalid translation after all retries leaves
the key empty and reports it — a broken `{{year}}` placeholder breaks
the page at runtime, so "obviously untranslated" is safer than
"subtly broken".

**Parallel locale execution.** `translate-ui` runs locales in
parallel via `runWithConcurrency`. The pool primitive short-circuits
on the first worker rejection (matches `Promise.all`), which would
let one locale's failure kill the rest. Workers MUST catch every
error internally and record it on the per-locale outcome — never
re-throw. Per-locale logs are buffered and flushed in `targets`
order so the final output is deterministic.

**No R2 caching.** Intentionally not wired into `translate-ui`. The
content-collection cache keys files by SHA-256 of full file body, so
adding a single UI key would invalidate every translation in the
file. A per-string cache (keyed by `sha256(source + glossary + model)`
under a dedicated `i18n-ui/` prefix) is a worthwhile future addition
if translation volume grows materially.

---

## Mode boundary

<a id="mode-boundary"></a>

`resolved.mode` is `"standalone"` (currently the only shipped mode) or
`"starlight"` (planned). The two differ in:

- Routing — standalone injects its own shims; Starlight defers to its
  own route tree.
- UI strings — standalone installs polystella's `Astro.locals.t`;
  Starlight defers to its i18next-backed `t`.

The mode is exposed through the `polystella:runtime-config` virtual
module so the middleware can branch without re-reading the config.

---

## Heartbeat

<a id="heartbeat"></a>

Astro emits a single "Waiting for integration..." line after 3s, then
goes silent until the hook returns. With `verbose: false`, per-pair
log lines are suppressed, so a cold-cache live run can sit quiet for
tens of seconds.

The heartbeat in `runTranslationPass` is either-or:

- a 15s timer ensures _something_ prints during genuinely slow stretches,
- a 5%-progress threshold short-circuits the timer so a fast burst
  surfaces immediately.

Disabled for trivially small runs (≤10 pairs) and when `verbose: true`
(already one line per pair). The `setInterval` handle is `unref()`'d
so a stalled pool doesn't keep the Node event loop alive — don't
remove the unref.

---

## AbortSignal threading

<a id="abortsignal"></a>

End-to-end signal path:

```
CLI / integration
  → runTranslationPass
  → per-pair worker
  → translateOrLoadFromCache
  → translateBatch (p-retry's signal + inline throwIfAborted)
  → translator.translate → fetch(...)
```

The CLI installs SIGINT/SIGTERM handlers; second Ctrl-C exits with
code 130. Always forward `signal` when adding a new async function
on the hot path; check `signal?.throwIfAborted()` at await
boundaries that could otherwise run indefinitely.

---

## Version constant

<a id="version-constant"></a>

`POLYSTELLA_VERSION` lives in `src/version.ts` as a JSON import from
`package.json` (`import pkg from "../package.json" with { type:
"json" }`). Re-exported from `src/index.ts`, consumed directly by
`src/cli.ts`.

The CLI is bundled via esbuild (`pnpm build:cli`), which inlines the
JSON content at build time. The library itself ships as raw TS, so
the JSON import resolves naturally through Astro/Vite at consumer
build time.

Bump `package.json` only; both surfaces follow. The constant is baked
into R2 metadata and the build report but is NOT in the cache key
formula, so a version bump doesn't re-translate.
