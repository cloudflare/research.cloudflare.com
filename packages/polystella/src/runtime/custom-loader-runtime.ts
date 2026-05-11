/**
 * Runtime bridge for custom-loader translation.
 *
 * Discovery problem: the polystella integration's `astro:config:setup`
 * hook runs BEFORE Astro evaluates `content.config.ts` — so at the
 * time the integration's translation pass would normally execute, the
 * wrapped `polystellaLoader(...)` calls have not yet happened and we
 * can't see which loaders need translating.
 *
 * Solution: do the translation work LAZILY, inside the custom sibling
 * loaders that `polystellaCollections` generates at content-config
 * time. The integration publishes its resolved options + dependencies
 * (R2 client, translators, glossaries) to a module-scoped bridge in
 * this file at `config:setup`; the sibling loaders read from it at
 * content-sync time.
 *
 * Module-scoped state is safe because the integration runs in the
 * same Node process as Astro's content sync — there's no
 * serialisation boundary between writing the bridge and reading it.
 * If the integration is absent (or disabled), `getRuntimeBridge`
 * returns `undefined`; the sibling loader degrades to a passthrough
 * that emits source entries (matching the "no provider configured"
 * branch in `runTranslationPass`).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Loader } from "astro/loaders";

import type { CapturedEntry, PolystellaCustomLoaderMarker } from "../content/custom-loader.js";
import { EMPTY_GLOSSARY, type Glossary } from "../glossary/glossary.js";
import { parsePath, readAtPath, writeAtPath, type PathSegment } from "../parsing/key-paths.js";
import type { Segment } from "../parsing/extract.js";
import { runWithConcurrency } from "../source/pool.js";
import {
  buildCacheMetadata,
  translateOrLoadFromCache,
  type CacheEvents,
} from "../storage/cache.js";
import { computeSourceHash } from "../storage/hash.js";
import { buildR2Key, type R2Client } from "../storage/r2.js";
import type { Translator } from "../translation/provider.js";

/**
 * Per-(loader, locale) translation outcome. Mirrors a subset of the
 * file-based pipeline's build-report fields so consumers of the
 * eventual unified report can treat both code paths uniformly.
 */
export type CustomLoaderTranslateOutcome =
  | "cache-hit"
  | "ai-translated"
  | "skipped-no-translator"
  | "staged"
  | "error";

export interface CustomLoaderTranslateRecord {
  /** Loader name (matches the marker's `name`). */
  loaderName: string;
  /** Per-entry id from `captureEntries`. */
  entryId: string;
  /** Target locale. */
  locale: string;
  outcome: CustomLoaderTranslateOutcome;
  /** When `error`, the error's message (defensive — never undefined). */
  errorMessage?: string;
  /** Source path used in the R2 key; useful for the report. */
  sourcePath: string;
}

/**
 * Everything a sibling loader needs to translate one entry. Populated
 * by the integration's `astro:config:setup` hook; read by the sibling
 * loaders at content-sync time.
 *
 * Translators / R2 client / glossaries are live JS objects (HTTP
 * clients, parsed maps) — they can't survive serialisation, which is
 * why the bridge stores them by reference rather than going through
 * the `polystella:runtime-config` virtual module.
 */
export interface PolystellaRuntimeBridge {
  defaultLocale: string;
  /** Polystella version, baked into R2 metadata. */
  polystellaVersion: string;
  /** From `astro:config:setup` log line — kept around for the report. */
  context?: string;
  /** Resolved R2 prefix; undefined when no R2 configured. */
  r2Prefix?: string;
  /** When `true`, skips R2 PUT (preview-branch behaviour). */
  r2ReadOnly: boolean;
  /** R2 client; `null` means "no R2 configured" — translation still runs but doesn't cache. */
  r2: R2Client | null;
  /**
   * Absolute path to the i18n-staging directory. Custom-loader
   * sibling translations are persisted to
   * `<stagingDir>/<locale>/<name>/<id>.json` as a side effect, so
   * subsequent runs (especially `pnpm dev` without
   * `POLYSTELLA_TRANSLATE=1`) can read them without R2 access.
   * Mirrors the disk-persistence model markdown/TOML siblings
   * already use.
   */
  stagingDir: string;
  /** Per-locale translator instances. Missing locale → translation is skipped (passthrough). */
  translatorsByLocale: Map<string, Translator>;
  /** Per-locale glossaries. */
  glossariesByLocale: Map<string, Glossary>;
  /** Per-locale glossary hashes (for cache-key composition). */
  glossaryHashByLocale: Map<string, string>;
  /** Fallback prefixes for R2 reads; mirrors `r2.readFallbackPrefixes`. */
  readFallbackPrefixes: ReadonlyArray<string>;
  /**
   * Max parallel translations per sibling loader. Mirrors
   * `resolved.concurrency`. Critical for large custom-loader corpora
   * — 200 entries × 3 locales serial would take ages; concurrency 4
   * cuts wall-clock by ~4× without overwhelming the AI provider.
   */
  concurrency: number;
  /** Sink for per-(entry, locale) outcomes; the integration reads this at `build:done`. */
  reportSink: CustomLoaderTranslateRecord[];
}

/**
 * The bridge lives on `globalThis` (not module-scoped) because Astro
 * evaluates `content.config.ts` in a temp Vite server with its OWN
 * module graph. Module-scoped state set by the integration in the
 * parent Node process would be invisible to the sibling loaders that
 * `polystellaCollections` generates inside that Vite context — they'd
 * import a fresh copy of this module and see `null`.
 *
 * `globalThis` is shared across module-graph isolations within a
 * single Node process, so the sibling loaders see exactly what the
 * integration wrote.
 *
 * The symbol-keyed property avoids collision with any other code
 * that decorates globalThis.
 */
const BRIDGE_KEY = Symbol.for("polystella.runtimeBridge");

type GlobalThisWithBridge = typeof globalThis & {
  [BRIDGE_KEY]?: PolystellaRuntimeBridge | null;
};

/**
 * Called by the integration's `astro:config:setup` hook to publish
 * the runtime state sibling loaders depend on. Calling this with
 * `null` clears the bridge (used by tests that want to verify
 * graceful degradation).
 */
export function setRuntimeBridge(bridge: PolystellaRuntimeBridge | null): void {
  (globalThis as GlobalThisWithBridge)[BRIDGE_KEY] = bridge;
}

/**
 * Read the active runtime bridge. Returns `null` when the
 * integration hasn't run (e.g. the user hasn't enabled polystella,
 * or vitest is running in isolation). Sibling loaders that get
 * `null` here degrade to source-only behaviour.
 */
export function getRuntimeBridge(): PolystellaRuntimeBridge | null {
  return (globalThis as GlobalThisWithBridge)[BRIDGE_KEY] ?? null;
}

/**
 * Build a synthetic source-path for an entry's R2 key. Matches the
 * shape file-based sources use: forward-slash, includes the loader
 * name as the dir, ends in `.json` so the file-extension switch in
 * `buildR2Key` produces a sensible suffix.
 */
function buildEntrySourcePath(loaderName: string, entryId: string): string {
  return `${loaderName}/${entryId}.json`;
}

/**
 * Absolute disk path where a translated entry is persisted.
 *
 *   `<stagingDir>/<locale>/<name>/<id>.json`
 *
 * Mirrors the staging layout file-based siblings (markdown, TOML)
 * already use — `polystella-implementation-collections-c011ec.md`
 * design §3 for the canonical shape.
 */
function buildStagingPath(stagingDir: string, locale: string, name: string, entryId: string): string {
  return path.join(stagingDir, locale, name, `${entryId}.json`);
}

/**
 * Apply the translated values from a parsed JSON snapshot to a
 * fresh clone of the source entry's data, preserving JS-native
 * types on non-translatable fields.
 *
 * The snapshot was produced by serialising the translated entry with
 * `JSON.stringify`, which flattens `Date`/`URL`/etc. to strings. We
 * can't pass that flattened object straight to the consumer's schema
 * (which expects `z.date()` etc.). Instead we:
 *   1. Clone the source entry's data (Dates stay Dates).
 *   2. Overlay translatable string values from the snapshot.
 *   3. Copy the AI marker fields verbatim (they're always strings/
 *      booleans, so JSON round-trip is fine for them).
 *
 * Returns the merged data ready for `ctx.parseData` + `ctx.store.set`.
 */
function overlaySnapshotOnSource(args: {
  source: CapturedEntry;
  snapshot: Record<string, unknown>;
  translatableKeys: ReadonlyArray<string>;
}): Record<string, unknown> {
  const { source, snapshot, translatableKeys } = args;
  const merged = structuredClone(source.data);
  for (const keyPath of translatableKeys) {
    const { segments: pathSegs } = parsePath(keyPath);
    const value = readAtPath(snapshot, pathSegs as PathSegment[]);
    if (typeof value === "string") {
      writeAtPath(merged, pathSegs as PathSegment[], value);
    }
  }
  if ("aiTranslated" in snapshot) merged.aiTranslated = snapshot.aiTranslated;
  if ("aiTranslationModel" in snapshot) merged.aiTranslationModel = snapshot.aiTranslationModel;
  if ("aiTranslatedAt" in snapshot) merged.aiTranslatedAt = snapshot.aiTranslatedAt;
  return merged;
}

/**
 * Try to read a previously-staged translation snapshot from disk.
 * Returns the parsed object on success, `null` on any failure (file
 * missing, malformed JSON, etc.) — the caller falls through to fresh
 * translation in that case.
 *
 * Failures are silent on purpose: a missing file is the common case
 * (first build, new entry, cleared staging dir) and not noteworthy.
 * Malformed JSON is rare and self-healing on the next live build,
 * which rewrites the file with valid content.
 */
async function tryReadStagedSnapshot(stagingPath: string): Promise<Record<string, unknown> | null> {
  try {
    const bytes = await readFile(stagingPath, "utf8");
    const parsed = JSON.parse(bytes);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Persist a translated entry to disk so subsequent runs (dev, fresh
 * builds without `POLYSTELLA_TRANSLATE=1`) can read it without R2
 * access. Failures are surfaced via logger but don't abort the
 * loader — the in-memory translation is still served this run.
 */
async function writeStagedSnapshot(args: {
  stagingPath: string;
  data: Record<string, unknown>;
}): Promise<void> {
  await mkdir(path.dirname(args.stagingPath), { recursive: true });
  await writeFile(args.stagingPath, `${JSON.stringify(args.data, null, 2)}\n`, "utf8");
}

interface TranslateEntryInput {
  entry: CapturedEntry;
  marker: PolystellaCustomLoaderMarker;
  locale: string;
  bridge: PolystellaRuntimeBridge;
}

interface TranslateEntryResult {
  /** Translated (or fallback) entry data ready for `store.set`. */
  data: Record<string, unknown>;
  outcome: CustomLoaderTranslateOutcome;
}

/**
 * Translate one entry for one locale. Mirrors the file-based
 * pipeline's per-pair flow:
 *
 *   1. Build segments from `marker.translatableKeys`. Each path is a
 *      string-valued field to translate.
 *   2. Compute cache key from canonical translatable values +
 *      glossary + model. Body is empty (custom-loader entries have no
 *      body bytes — matches the structured-data adapter's design-doc
 *      §3.1 future shape).
 *   3. R2 GET → on hit, return cached entry; on miss, translate via
 *      the provider, apply translations + AI marker to entry data,
 *      PUT to R2, return.
 *   4. When no translator is configured for the locale (provider
 *      missing or `dryRun: true`), short-circuit to the source entry
 *      verbatim with `skipped-no-translator` outcome — the sibling
 *      loader still populates the store so the locale-prefixed routes
 *      render something rather than 404ing.
 */
async function translateEntry(input: TranslateEntryInput): Promise<TranslateEntryResult> {
  const { entry, marker, locale, bridge } = input;

  const translator = bridge.translatorsByLocale.get(locale);
  if (!translator) {
    // No provider or dryRun → keep source data verbatim. The sibling
    // collection's locale routes get the source content, matching
    // the "fallback" behaviour of file-based sources without
    // translation.
    return { data: entry.data, outcome: "skipped-no-translator" };
  }

  const sourcePath = buildEntrySourcePath(marker.name, entry.id);

  // Build segments + selected-values snapshot. Both walk the same
  // `marker.translatableKeys` paths so the cache key and the
  // translator input stay in lockstep.
  const segments: Segment[] = [];
  const selectedValues: Record<string, unknown> = {};
  for (const keyPath of marker.translatableKeys) {
    const { segments: pathSegs } = parsePath(keyPath);
    const value = readAtPath(entry.data, pathSegs as PathSegment[]);
    if (value === undefined) continue;
    selectedValues[keyPath] = value;
    if (typeof value === "string" && value.length > 0) {
      segments.push({ id: keyPath, text: value });
    }
  }

  // If there's literally nothing to translate (every configured
  // path is missing or non-string), short-circuit — calling the AI
  // with zero segments is wasteful and the cache key would be
  // ambiguous.
  if (segments.length === 0) {
    return { data: entry.data, outcome: "skipped-no-translator" };
  }

  const glossaryHash = bridge.glossaryHashByLocale.get(locale) ?? "";
  const glossary = bridge.glossariesByLocale.get(locale) ?? EMPTY_GLOSSARY;

  // Body is "" — custom-loader entries have no body bytes. Only
  // translatable values + glossary + model drive the hash.
  const hash = computeSourceHash({
    body: "",
    frontmatter: selectedValues,
    glossaryHash,
    modelId: translator.modelId,
  });

  const key = buildR2Key({
    locale,
    sourcePath,
    hash,
    prefix: bridge.r2Prefix,
  });

  const fallbackKeys = bridge.readFallbackPrefixes.map((prefix) =>
    buildR2Key({ locale, sourcePath, hash, prefix }),
  );

  const metadata = buildCacheMetadata({
    polystellaVersion: bridge.polystellaVersion,
    sourcePath,
    locale,
    sourceHash: hash,
    modelId: translator.modelId,
    glossaryHash,
    translatedAt: new Date().toISOString(),
  });

  // Apply: deep-clone entry data, write translated values into the
  // configured paths, attach the AI marker at the top level. The
  // returned string is the JSON-serialised form that goes to R2.
  // We ALSO capture the in-memory `out` in `inMemoryApplied` so the
  // cache-miss path can return JS-typed data directly — `JSON.stringify`
  // collapses `Date` (and other non-JSON types) to strings, which
  // would then fail `z.date()` schema validation in the consumer's
  // collection schema. The cache layer never sees `inMemoryApplied`;
  // it only stores the bytes.
  let inMemoryApplied: Record<string, unknown> | undefined;
  const apply = (translations: Map<string, string>): string => {
    const out = structuredClone(entry.data);
    for (const [id, translation] of translations) {
      const { segments: pathSegs } = parsePath(id);
      writeAtPath(out, pathSegs as PathSegment[], translation);
    }
    out.aiTranslated = true;
    out.aiTranslationModel = translator.modelId;
    out.aiTranslatedAt = new Date().toISOString();
    inMemoryApplied = out;
    return JSON.stringify(out, null, 2);
  };

  const events: CacheEvents = {
    // Quiet by default — sibling loaders run during content sync,
    // and Astro already logs collection progress. Adding more lines
    // here would be noise.
  };

  const result = await translateOrLoadFromCache({
    segments,
    apply,
    locale,
    key,
    r2: bridge.r2,
    translator,
    glossary,
    sourceLocale: bridge.defaultLocale,
    ...(bridge.context !== undefined ? { context: bridge.context } : {}),
    metadata,
    events,
    readOnly: bridge.r2ReadOnly,
    fallbackKeys,
  });

  // Cache miss → `apply` ran, `inMemoryApplied` holds the JS-typed
  // result. Use it directly — preserves `Date` / `URL` / etc. that
  // would otherwise be flattened to strings by `JSON.stringify`.
  if (result.outcome === "miss" && inMemoryApplied !== undefined) {
    return { data: inMemoryApplied, outcome: "ai-translated" };
  }

  // Cache hit → R2 returned JSON bytes. Re-apply translatable
  // values to a fresh source clone (preserves Date/URL/etc. types
  // that JSON round-trip would have flattened to strings).
  const parsedFromCache = JSON.parse(result.body) as Record<string, unknown>;
  const merged = overlaySnapshotOnSource({
    source: entry,
    snapshot: parsedFromCache,
    translatableKeys: marker.translatableKeys,
  });

  return { data: merged, outcome: "cache-hit" };
}

/**
 * Build an Astro loader for the per-locale sibling collection of a
 * custom-loader source. `polystellaCollections` calls this once per
 * (loader, locale) pair and wires the returned loader into the
 * sibling collection's `defineCollection` config.
 *
 * At content-sync time, the returned loader:
 *   1. Pulls captured entries from the source via `marker.captureEntries()`
 *      (which is cached — same entries every sibling sees).
 *   2. Translates each entry for `locale`, threading through
 *      `translateOrLoadFromCache` against the integration's R2 +
 *      translator.
 *   3. Populates Astro's store with translated entries.
 *
 * When the runtime bridge isn't set (integration absent), the
 * sibling loader still populates the store with the source entries
 * verbatim — keeps the consumer's `/pt-BR/...` routes rendering
 * (untranslated) instead of 404ing.
 */
export function createCustomLoaderSibling(args: {
  marker: PolystellaCustomLoaderMarker;
  locale: string;
}): Loader {
  const { marker, locale } = args;
  return {
    name: `polystella-translated-${marker.name}-${locale}`,
    load: async (ctx) => {
      const entries = await marker.captureEntries();
      ctx.store.clear();

      const bridge = getRuntimeBridge();

      // Resolve the staging directory. Comes from the bridge when
      // the integration ran (build mode, or dev with runOn=["dev"]);
      // falls back to `.astro/i18n-staging` relative to `process.cwd`
      // for the dev-mode-without-runOn case. The fallback path
      // matches what the integration writes to, so a `translate:build`
      // followed by `pnpm dev` (default `runOn: ["build"]`) still
      // finds the staging files this loader needs.
      const stagingDir = bridge?.stagingDir ?? path.resolve(process.cwd(), ".astro/i18n-staging");

      // Pre-translation staging fast-path. Runs BEFORE the bridge
      // check because reading staged files needs no bridge state —
      // they're just JSON on disk. Critical for `pnpm dev` (default
      // `runOn: ["build"]`), where the integration never publishes
      // a bridge: the only way translated content reaches dev is via
      // this disk-read path.
      //
      // If the bridge isn't available, ALL entries that don't have
      // staging files will fall through to a passthrough (source
      // data). When the bridge is available, those entries instead
      // go through translateEntry (R2 + translator).
      //
      // We do a single staging-fast-path pre-pass before the
      // potentially-translation-heavy main loop so the simple case
      // (everything cached) doesn't spin up workers / heartbeats.
      const stagingResults = new Map<string, { merged: Record<string, unknown> } | "miss">();
      await Promise.all(
        entries.map(async (entry) => {
          const stagingPath = buildStagingPath(stagingDir, locale, marker.name, entry.id);
          const staged = await tryReadStagedSnapshot(stagingPath);
          if (staged !== null) {
            const merged = overlaySnapshotOnSource({
              source: entry,
              snapshot: staged,
              translatableKeys: marker.translatableKeys,
            });
            stagingResults.set(entry.id, { merged });
          } else {
            stagingResults.set(entry.id, "miss");
          }
        }),
      );

      // Apply staging hits immediately (no bridge needed for these).
      const stagingMissEntries: CapturedEntry[] = [];
      for (const entry of entries) {
        const result = stagingResults.get(entry.id);
        if (result && result !== "miss") {
          const parsed = await ctx.parseData({ id: entry.id, data: result.merged });
          ctx.store.set({ id: entry.id, data: parsed });
          if (bridge) {
            bridge.reportSink.push({
              loaderName: marker.name,
              entryId: entry.id,
              locale,
              outcome: "staged",
              sourcePath: buildEntrySourcePath(marker.name, entry.id),
            });
          }
        } else {
          stagingMissEntries.push(entry);
        }
      }

      // Every entry came from staging — we're done. Common path for
      // `pnpm dev` after a recent `translate:build`.
      if (stagingMissEntries.length === 0) return;

      if (!bridge) {
        // Bridge absent + some staging files missing → passthrough
        // the rest from source. Astro's parseData applies the
        // consumer's schema; if the schema rejects untranslated
        // entries (rare), the build fails with a clear message.
        for (const entry of stagingMissEntries) {
          const parsed = await ctx.parseData({ id: entry.id, data: entry.data });
          ctx.store.set({ id: entry.id, data: parsed });
        }
        return;
      }

      // Translation phase: parallelise across `bridge.concurrency`
      // workers, with periodic progress logging. Cache hits are
      // cheap (R2 GET, ~50ms); cache misses are slow (AI call,
      // seconds). Serial processing across 200+ entries × N locales
      // would take many minutes — silent, with no progress log,
      // that looks like a hang. The pool + heartbeat below makes
      // the wall-clock cost survivable AND observable.
      //
      // The `ctx.store.set` happens INSIDE the worker (not in a
      // batched post-pass) so memory pressure stays bounded — we
      // don't accumulate 200 translated entries in a JS array
      // before storing them.
      const totalPairs = stagingMissEntries.length;
      let processed = 0;
      let lastReportedPct = 0;
      let lastReportedAt = Date.now();
      const heartbeatPctStep = 10;
      const heartbeatIntervalMs = 15_000;
      const heartbeatThreshold = 10;
      const heartbeatEnabled = totalPairs >= heartbeatThreshold;
      const startedAt = Date.now();

      const emitProgress = () => {
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        const pct = Math.floor((processed / totalPairs) * 100);
        // Outcomes-so-far summary keeps the line informative even
        // when most pairs are cache hits (the bulk operation
        // distinguishes "fast hit" from "slow translate" runs).
        const recentOutcomes = bridge.reportSink
          .slice(-Math.min(processed, 1000))
          .filter((r) => r.loaderName === marker.name && r.locale === locale);
        const counts = recentOutcomes.reduce(
          (acc, rec) => {
            acc[rec.outcome] = (acc[rec.outcome] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );
        const summary = Object.entries(counts)
          .map(([outcome, n]) => `${n} ${outcome}`)
          .join(", ");
        ctx.logger.info(
          `${marker.name} → ${locale}: ${processed}/${totalPairs} (${pct}%)` +
            ` — ${summary || "no outcomes yet"} — ${elapsedSec}s elapsed`,
        );
        lastReportedPct = pct;
        lastReportedAt = Date.now();
      };

      const maybeEmitProgress = () => {
        if (!heartbeatEnabled) return;
        if (processed === 0) return;
        const pct = Math.floor((processed / totalPairs) * 100);
        if (pct - lastReportedPct >= heartbeatPctStep) {
          emitProgress();
        }
      };

      // Time-based heartbeat for very slow stretches (e.g. a single
      // AI call taking 30s on a busy provider). Without this, a
      // build could go silent for minutes during a single pair.
      const heartbeatHandle = heartbeatEnabled
        ? setInterval(() => {
            if (processed === 0) return;
            if (Date.now() - lastReportedAt < heartbeatIntervalMs) return;
            emitProgress();
          }, heartbeatIntervalMs)
        : null;
      if (heartbeatHandle?.unref) heartbeatHandle.unref();

      if (heartbeatEnabled) {
        ctx.logger.info(`${marker.name} → ${locale}: translating ${totalPairs} entries at concurrency ${bridge.concurrency}`);
      }

      try {
        await runWithConcurrency(stagingMissEntries, bridge.concurrency, async (entry) => {
          const sourcePath = buildEntrySourcePath(marker.name, entry.id);
          const stagingPath = buildStagingPath(bridge.stagingDir, locale, marker.name, entry.id);

          // (Staging fast-path already ran as a pre-pass before this
          // worker loop. We only reach this worker for entries that
          // missed staging — so we go straight to translateEntry.)

          let result: TranslateEntryResult;
          try {
            result = await translateEntry({ entry, marker, locale, bridge });
          } catch (err) {
            // Translation failure for one entry shouldn't kill the
            // build — log it via the report sink and fall back to
            // source data so the page still renders (matching the
            // file-based pipeline's per-pair try/catch behaviour).
            bridge.reportSink.push({
              loaderName: marker.name,
              entryId: entry.id,
              locale,
              outcome: "error",
              errorMessage: err instanceof Error ? err.message : String(err),
              sourcePath,
            });
            const parsed = await ctx.parseData({ id: entry.id, data: entry.data });
            ctx.store.set({ id: entry.id, data: parsed });
            processed++;
            maybeEmitProgress();
            return;
          }

          bridge.reportSink.push({
            loaderName: marker.name,
            entryId: entry.id,
            locale,
            outcome: result.outcome,
            sourcePath,
          });
          const parsed = await ctx.parseData({ id: entry.id, data: result.data });
          ctx.store.set({ id: entry.id, data: parsed });

          // Persist the successful translation so subsequent runs
          // can short-circuit via the staging fast-path above.
          // Skipped for `skipped-no-translator` outcomes (we have no
          // translated content to persist — source data isn't worth
          // staging since reading source is already free).
          if (result.outcome !== "skipped-no-translator") {
            try {
              await writeStagedSnapshot({ stagingPath, data: result.data });
            } catch (err) {
              ctx.logger?.warn?.(
                `polystella: failed to write staged translation for ${marker.name}/${entry.id} (${locale}): ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            }
          }

          processed++;
          maybeEmitProgress();
        });
      } finally {
        if (heartbeatHandle) clearInterval(heartbeatHandle);
      }

      // Final summary line per (loader, locale).
      if (heartbeatEnabled) {
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        const all = bridge.reportSink.filter(
          (r) => r.loaderName === marker.name && r.locale === locale,
        );
        const counts = all.reduce(
          (acc, rec) => {
            acc[rec.outcome] = (acc[rec.outcome] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );
        const summary = Object.entries(counts)
          .map(([outcome, n]) => `${n} ${outcome}`)
          .join(", ");
        ctx.logger.info(`${marker.name} → ${locale}: done in ${elapsedSec}s — ${summary}`);
      }
    },
  };
}
