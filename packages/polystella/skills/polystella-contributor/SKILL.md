---
name: polystella-contributor
description: Edit the PolyStella package source. Use when adding a file-format adapter, adding a CLI subcommand, adding a translation provider, modifying the cache contract, debugging a translation regression, or otherwise working on the package itself (not consuming it).
---

# polystella-contributor

You are editing the PolyStella package source. This skill is recipes
for the common contributor tasks.

If you are integrating PolyStella into a downstream Astro project,
STOP and load `polystella-consumer` instead.

Read first:

- [`AGENTS.md`](../../AGENTS.md) — orientation, invariants, boundaries.
- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — subsystem reference.

Then come back here for step-by-step task recipes.

---

## Recipes

- [Add a file-format adapter](#add-adapter)
- [Add a CLI subcommand](#add-cli-subcommand)
- [Add a translation provider](#add-provider)
- [Change the cache contract](#change-cache-contract)
- [Debug a translation regression](#debug-translation)
- [Modify a runtime API](#modify-runtime-api)
- [Edit UI-string handling](#edit-ui-strings)
- [Strict tsconfig patterns](#strict-tsconfig)
- [Testing conventions](#testing)

---

## Add a file-format adapter

<a id="add-adapter"></a>

**When to use:** Supporting a new file extension (`.xml`, `.html`, `.po`, custom format).

**Contract:** `FileTypeAdapter` in `src/parsing/adapter.ts`. See [#adapter-contract](../../ARCHITECTURE.md#adapter-contract).

**Steps:**

1. Implement the adapter at `src/parsing/adapters/<name>.ts`:

   ```ts
   import type { FileTypeAdapter, AdapterExtractOptions, AdapterApplyOptions } from "../adapter.js";
   import type { Segment } from "../extract.js";

   export const myFormatAdapter: FileTypeAdapter<MyParsedShape> = {
     extensions: [".myext"],

     parse(source, sourcePath) {
       // Pure. No I/O. Throw on syntactic errors — the per-pair
       // try/catch in runTranslationPass will surface them without
       // aborting the build.
     },

     extractSegments(parsed, source, opts): Segment[] {
       // Emit { id, text } per translatable unit.
       // IDs must be unique within a single file.
       // Empty text → no segment (translating "" is meaningless).
     },

     applyTranslations(parsed, source, translations, opts): string {
       // Splice translations back into source bytes.
       // INVARIANT 3: produce the EXACT bytes that will be PUT to R2.
       // Weave any AI-translation marker from opts.topLevelAdditions
       // into the output here, not after.
     },

     selectedValuesForHash(parsed, source, opts): Record<string, unknown> {
       // Snapshot of values that feed the cache hash. Only fields
       // your adapter considers translatable should appear here.
     },

     peekNoTranslate(parsed): boolean {
       // Return true when the source is opted out via your format's
       // convention (e.g. top-level `noTranslate: true`).
     },

     // Optional:
     rewriteUrls(bytes, opts): string { ... },   // post-cache; idempotent
     groupSegments(parsed, segments): Segment[][] { ... },  // INVARIANT 2
     documentContext(parsed, opts): string | undefined { ... },
   };
   ```

2. Register in `src/parsing/registry.ts`:

   ```ts
   import { myFormatAdapter } from "./adapters/myformat.js";
   // ...
   registerAdapter(myFormatAdapter);
   ```

   **First-registered wins.** If your adapter claims an extension another adapter already owns, your registration is silently ignored. The order at the bottom of `registry.ts` is the de-facto priority.

3. Add tests under `tests/parsing/adapters/<name>.test.ts`. Mirror the structure of an existing adapter test (`tests/parsing/adapters/toml.test.ts` is a good template — it's structured-data-flavoured like most new adapters will be).

   Required test coverage:
   - `parse` round-trip (parse → reserialize via `applyTranslations` with no translations → byte-identical)
   - `extractSegments` produces expected IDs
   - `applyTranslations` splices correctly
   - `selectedValuesForHash` snapshots ONLY translatable fields
   - `peekNoTranslate` honours your format's opt-out convention
   - If you implement `rewriteUrls`: idempotent on already-rewritten input
   - If you implement `groupSegments`: `flat(result) === segments` (reference-equal)

4. **No changes to `src/translation/run.ts` or `src/storage/cache.ts`.** The orchestrator dispatches by extension via the registry; the cache layer is format-agnostic. If you find yourself editing either, you're doing something wrong.

5. Verify:

   ```sh
   pnpm test
   pnpm exec tsc --noEmit
   ```

6. Update the contributor README's status table and any per-format docs.

---

## Add a CLI subcommand

<a id="add-cli-subcommand"></a>

**When to use:** Adding a new top-level verb (`polystella <verb>`).

**Pattern:** Each subcommand owns its argv parsing and a `run<Name>(args, deps)` handler. The dispatcher in `src/cli.ts` is a thin router.

**Steps:**

1. Create `src/cli/<name>.ts`:

   ```ts
   export interface MySubcommandArgs {
     // Parsed flags.
     help: boolean;
     someFlag?: string;
   }

   export const MY_SUBCOMMAND_USAGE = `polystella my-subcommand
   
   <description>
   
   Usage:
     polystella my-subcommand [flags]
   
   Flags:
     --some-flag <value>   ...
     --help                Print this message.
   
   Exit codes:
     0   ok
     1   config error
     2   <subcommand-specific failure>
   `;

   export function parseMySubcommandArgs(argv: ReadonlyArray<string>): MySubcommandArgs {
     // Throw on unknown flag or missing value — accept-then-reject
     // would silently swallow typos.
   }

   export interface MySubcommandDeps {
     cwd: string;
     log: (msg: string) => void;
     err: (msg: string) => void;
     // Add fakeable I/O / clock / etc. for tests.
   }

   export async function runMySubcommand(args: MySubcommandArgs, deps: MySubcommandDeps): Promise<number> {
     // Return process exit code.
   }
   ```

2. Wire dispatch in `src/cli.ts`:
   - Add to the `Subcommand` union type.
   - Add the literal to `parseSubcommand`'s `if (first === "translate" || ...)` check.
   - Add a case to `main()`'s switch statement.
   - Update `TOP_LEVEL_USAGE` to mention the new verb.

3. Add tests:
   - `tests/cli/<name>.test.ts` for the argv parser + handler (with stubbed deps).
   - Extend `tests/cli.test.ts` if the top-level dispatch needs new coverage (it usually does — add at least one "dispatches `my-subcommand` to the right handler" case).

4. If the subcommand needs a `pnpm` wrapper in the host's `package.json`, document it in the package README's CLI section. Don't add the wrapper to this package — host projects own their own scripts.

5. Verify:

   ```sh
   pnpm test
   pnpm exec tsc --noEmit
   pnpm build:cli
   node dist/cli.js my-subcommand --help    # sanity-check the bundle
   ```

---

## Add a translation provider

<a id="add-provider"></a>

**When to use:** Adding a third translator (e.g. OpenAI, Bedrock).

**Contract:** `Translator` in `src/translation/provider.ts`. See [#translator-contract](../../ARCHITECTURE.md#translator-contract).

**Steps:**

1. Add a config variant to the provider zod schema in `src/config/options.ts`:

   ```ts
   const newProviderSchema = z.object({
     kind: z.literal("new-provider"),
     apiKey: z.string(),
     model: modelSpecSchema, // string | per-locale map
     maxTokens: z.number().int().positive().default(8192),
     endpoint: z.string().url().optional(),
   });

   // Add to the discriminated union:
   const providerSchema = z.discriminatedUnion("kind", [workersAISchema, anthropicSchema, newProviderSchema]);
   ```

2. Implement the translator factory in `src/translation/provider.ts`:

   ```ts
   function createNewProviderTranslator(
     provider: NewProviderConfig,
     locale: string,
     fetchImpl: typeof fetch,
   ): Translator {
     const modelId = resolveModelId(provider.model, locale);

     return {
       modelId,
       async translate(systemPrompt, userPrompt, signal) {
         const res = await fetchImpl(endpoint, {
           method: "POST",
           headers: { ... },
           body: JSON.stringify({ ... }),
           ...(signal !== undefined ? { signal } : {}),
         });

         if (!res.ok) {
           const text = await res.text().catch(() => "");
           const message = `[polystella] new-provider request failed: ${res.status} ${res.statusText}${text ? `\n${text}` : ""}`;
           if (PERMANENT_HTTP_STATUSES.has(res.status)) {
             throw new PermanentProviderError(message);
           }
           throw new Error(message);
         }

         const data = await res.json();
         // Extract the model's raw text; caller validates via parseResponse.
         // Round-trip via JSON.stringify if the provider pre-parses on the server.
         return text;
       },
     };
   }
   ```

3. Wire into `createTranslator`:

   ```ts
   if (provider.kind === "new-provider") {
     return createNewProviderTranslator(provider, locale, fetchImpl);
   }
   ```

4. **Permanent vs retriable** — `PERMANENT_HTTP_STATUSES` is `{400, 401, 403, 404, 422}`. Don't widen this without thinking about what flaky responses might wrongly skip retry. 5xx, 408, 425, 429 are retriable. **Ask first** before adding statuses (per `AGENTS.md` Boundaries).

5. Add tests at `tests/translation/provider.test.ts` covering:
   - Happy path (mock fetch returns expected shape).
   - Each permanent status → `PermanentProviderError`.
   - 5xx → plain `Error` (retriable).
   - Network error → plain `Error`.
   - Unexpected response shape → clear error message with raw response preview.
   - `signal` propagation to `fetch`.

6. Document the new provider in the package README's config section.

---

## Change the cache contract

<a id="change-cache-contract"></a>

**When to use:** Modifying any input to the cache hash formula.

**Severity:** Cache-wide invalidation. Every cached translation across every consumer becomes a miss on the next build.

**Steps:**

1. Read [#cache-key](../../ARCHITECTURE.md#cache-key). The current formula is:

   ```
   hash = sha256(body + selectedFrontmatterValues + glossaryHash + modelId)
   ```

2. **Stop.** Coordinate with the owner before merging. This is **Invariant 1** in `AGENTS.md`. The change needs to be in a major version bump and called out in CHANGELOG.

3. If you're confident this is the right change:
   - Edit `src/storage/hash.ts` (the `computeSourceHash` function).
   - Update the formula description in `ARCHITECTURE.md#cache-key`.
   - Update `AGENTS.md` Invariant #1.
   - Update the hash test pin in `tests/storage/hash.test.ts` — it pins a literal hash to catch accidental formula drift. Compute the new literal and replace it.
   - Add a CHANGELOG entry under a "Breaking changes" heading.
   - Bump the major version (or 0.x minor pre-1.0).

4. Verify:

   ```sh
   pnpm test
   pnpm exec tsc --noEmit
   ```

   The pinned-hash test will catch drift if you missed the test update.

---

## Debug a translation regression

<a id="debug-translation"></a>

**When to use:** A translation that used to work is wrong, missing, or failing.

**Diagnostic flow:**

1. **Reproduce on the fixture.** If the regression is reported against a consumer's content, reduce to the smallest source file that reproduces. Add it under `tests/fixtures/` if it's worth a regression test.

2. **Inspect what the cache layer planned:**

   ```sh
   polystella translate --dry-run --file 'path/to/source.md'
   # or in a consumer repo:
   pnpm translate --dry-run --file 'path/to/source.md'
   ```

   Output includes the planned R2 key. If the key is wrong, the bug is in `computeSourceHash` or `buildR2Key`.

3. **Inspect the staged output:**

   ```sh
   cat <root>/.astro/i18n-staging/<locale>/<source-path>
   ```

   Compare to expected. Is the AI-translation marker (`aiTranslated: true`) present? Are URLs rewritten? Is the body translated at all?

4. **Inspect the build report:**

   ```sh
   cat dist/i18n-r2-report.json | jq '.entries[] | select(.sourcePath == "<path>")'
   ```

   Outcome will be `hit`, `miss`, `override`, `error`, or `localSkipped`. Read the corresponding code path in `src/storage/cache.ts` or `src/source/overrides.ts`.

5. **Crank up verbosity:**

   ```sh
   LOG_LEVEL=debug polystella translate --file 'path/to/source.md'
   ```

   Emits per-batch detail (segment count, batch count, oversize warnings, retry attempts).

6. **Bypass the cache:** delete the relevant R2 object, or delete the local index entry:

   ```sh
   rm <root>/.astro/i18n-staging/.polystella-cache.json
   ```

7. **Bypass R2 entirely** by passing `r2Override: null` to `runTranslationPass` (test-only). Useful for isolating the translator from the cache layer.

8. **Common regression causes:**
   - Adapter `parse` not idempotent — calling it twice produces different output. (Asserted by some tests; if you added a new adapter, add this test.)
   - Cache key formula input added/removed without updating consumers.
   - Workers AI `maxTokens` was lowered — multi-segment translation truncated to invalid JSON.
   - Glossary YAML syntax error — silently ignored on load, term not applied.
   - `noTranslate: true` accidentally set in source frontmatter.
   - Override file path mismatch — locale or mirrored-path slug differs from source.
   - URL rewriter doubling prefixes — confirm both rewrite layers are idempotent on already-rewritten input.

---

## Modify a runtime API

<a id="modify-runtime-api"></a>

**When to use:** Editing `Astro.locals.t`, `lhref`, `getLocalizedEntry`, `getLocalizedCollection`, the React hooks, or the middleware that binds them.

**Files:**

- `src/runtime/middleware.ts` — request middleware; pre-binds locale to all four locals.
- `src/runtime/middleware-core.ts` — middleware body (test-friendly extract).
- `src/runtime/get-localized-entry.ts`, `get-localized-collection.ts` — fetcher implementations.
- `src/runtime/localized-href.ts` — URL prefixer.
- `src/runtime/custom-loader-runtime.ts` — the **bridge** (module-scoped singleton shared with sibling collections).
- `src/runtime/locals.d.ts` — TypeScript ambient declarations for `Astro.locals`.
- `src/react/index.ts` — `useTranslations`, `useLocalizedHref` hooks.

**Key contracts:**

- **Bridge timing (Invariant 5)** — the bridge must be set in `astro:config:setup` before sibling collections register. Edits that defer bridge setup will silently break sibling content loading.
- **Per-locale closures** — `t`, `lhref`, `getLocalizedEntry`, `getLocalizedCollection` are pre-bound to the request's locale by the middleware. Don't expose unbound versions in `.astro` files — they're imported separately from `polystella/runtime` for non-template contexts.

**Steps:**

1. Edit the relevant runtime file.
2. Update `src/runtime/locals.d.ts` if you're changing the shape of `Astro.locals`.
3. Update the `polystella-consumer` skill's "Runtime APIs" section.
4. Add tests under `tests/runtime/`:
   - Behaviour test for the new/changed function.
   - Middleware-binding test if the locals shape changes (`tests/runtime/middleware.test.ts`).
5. Don't forget the React side — `useTranslations` / `useLocalizedHref` and their consumer-side wiring (`getDictionary`).

---

## Edit UI-string handling

<a id="edit-ui-strings"></a>

**When to use:** Changing drift detection rules, sync writer behaviour, AI-fill orchestration, or the `{{token}}` validator.

**Files:**

- `src/i18n/drift.ts` — `checkI18nDrift`, `loadAndCheckDrift`.
- `src/i18n/sync.ts` — key reconciliation; **layout-aware** JSON writer (`formatLocaleFile`).
- `src/i18n/ui-translate.ts` — AI-fill orchestrator; parallel-locale execution; `{{token}}` validator + retry wrapper.
- `src/i18n/loader.ts`, `i18n/index.ts` — content-layer loader, dictionary fetcher.
- `src/cli/check-ui.ts`, `sync-ui.ts`, `translate-ui.ts` — CLI handlers.

**Key contracts:**

- **Three drift failure modes** — missing keys, extra keys, **empty-placeholder values** (a non-default locale has `""` where the source has a non-empty string). The build's `astro:config:setup` drift check and the `check-ui` CLI use the SAME predicate. If you add a fourth failure mode, update both.
- **Layout-aware sync writer** — parses the source file's text (not just its JSON) to recover key order and blank-line section breaks. The output mirrors that layout for every locale. Don't drop this — every sync would churn diffs.
- **`{{token}}` validator runs OUTSIDE `translateBatch`** — the orchestrator's retry wrapper sets `maxRetries: 0` on `translateBatch`. Don't add a second retry layer.
- **Parallel locales catch errors internally** — `translate-ui` runs locales in parallel via `runWithConcurrency`. Workers MUST catch every error and record it on the per-locale outcome — never re-throw. Re-throwing kills the whole run.

See [#ui-strings](../../ARCHITECTURE.md#ui-strings).

---

## Strict tsconfig patterns

<a id="strict-tsconfig"></a>

All four codex RFC 009 flags are on. Patterns that come up repeatedly:

### `noUncheckedIndexedAccess`

Indexed access returns `T | undefined`. Patterns:

```ts
// ❌ Old:
const first = arr[0];
first.foo; // type error: first might be undefined

// ✅ Guard:
const first = arr[0];
if (first === undefined) continue;
first.foo;

// ✅ Destructure with default (when default is safe):
const [first = defaultValue] = arr;
```

### `exactOptionalPropertyTypes`

`foo?: string` is NOT the same as `foo: string | undefined`. Callers passing `undefined` explicitly need the latter:

```ts
// ❌ Old:
interface Opts {
  signal?: AbortSignal;
}
function foo(opts: { signal?: AbortSignal }) {
  inner({ signal: opts.signal }); // type error: opts.signal might be `undefined` literal
}

// ✅ When the callee accepts explicit `undefined`:
interface Opts {
  signal?: AbortSignal | undefined;
}
```

### `noImplicitReturns`

Every code path returns. Add explicit `return` to early-exit branches:

```ts
function foo(): number {
  if (cond) {
    sideEffect();
    return 0;
  } // explicit return
  return 1;
}
```

### Replacing `!` and `any`

`!` and `any` are banned outside test code. Replace with:

```ts
// ❌
const value = map.get(key)!;
const data = JSON.parse(x) as any;

// ✅
const value = map.get(key);
if (value === undefined) throw new Error(`unexpected: ${key} not in map`);

const data = JSON.parse(x) as unknown;
if (typeof data !== "object" || data === null) throw new Error(`unexpected: ${x}`);
// narrow via structural type guards from here.
```

---

## Testing conventions

<a id="testing"></a>

- Tests live under `tests/<src-dir>/<basename>.test.ts`. Top-level exceptions: `tests/cli.test.ts` (top-level dispatch + translate-subcommand parsing), `tests/cli/` (per-subcommand handlers), `tests/smoke.test.ts` (end-to-end integration smoke).
- Vitest config in `vitest.config.ts`. `singleThread: true` — faster than multi-worker at this scale.
- Fakeable boundaries: each subsystem accepts a `deps`-shaped object so tests can inject stubs. The CLI's `runCheckUi(args, deps)` shape is the canonical example.
- For tests that need a clean adapter registry: call `resetRegistry()` before re-registering.
- For tests that exercise R2: use the in-memory R2 client at `tests/helpers/in-memory-r2.ts` (or whatever the equivalent helper is).
- For tests that exercise the translator: pass `translatorOverrides` to `runTranslationPass` with a fake `Translator`.
- For smoke tests: drive `polystella(options)` with stubbed Astro context against a real temp project. `tests/smoke.test.ts` is the template.
- For the doc-claims test (`tests/docs.test.ts`): pins file paths and command names referenced in `AGENTS.md` / `ARCHITECTURE.md`. If you move a file or rename a subcommand, update both the docs AND this test.

Verify before pushing:

```sh
pnpm test
pnpm exec tsc --noEmit
```
