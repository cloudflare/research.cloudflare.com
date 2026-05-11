/**
 * Runtime bridge for custom-loader translation.
 *
 * The integration's `config:setup` runs BEFORE Astro evaluates
 * `content.config.ts`, so the wrapped `polystellaLoader(...)` calls
 * haven't happened yet when the file-based translation pass runs.
 * Solution: translate LAZILY inside the per-locale sibling loaders.
 * The integration publishes deps (R2, translators, glossaries) to a
 * globalThis-scoped bridge here at `config:setup`; sibling loaders
 * read from it at content-sync time. Absent bridge ⇒ passthrough.
 * See ARCHITECTURE.md §4.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Loader } from "astro/loaders";

import type { CapturedEntry, PolystellaCustomLoaderMarker } from "../content/custom-loader.js";
import { EMPTY_GLOSSARY, type Glossary } from "../glossary/glossary.js";
import { parsePath, readAtPath, writeAtPath, type PathSegment } from "../parsing/key-paths.js";
import type { Segment } from "../parsing/extract.js";
import { runWithConcurrency } from "../source/pool.js";
import { buildCacheMetadata, translateOrLoadFromCache, type CacheEvents } from "../storage/cache.js";
import { computeSourceHash } from "../storage/hash.js";
import { buildR2Key, type R2Client } from "../storage/r2.js";
import type { Translator } from "../translation/provider.js";

/** Per-(loader, locale) translation outcome. */
export type CustomLoaderTranslateOutcome = "cache-hit" | "ai-translated" | "skipped-no-translator" | "staged" | "error";

export interface CustomLoaderTranslateRecord {
  /** Loader name (matches the marker's `name`). */
  loaderName: string;
  /** Per-entry id from `captureEntries`. */
  entryId: string;
  /** Target locale. */
  locale: string;
  outcome: CustomLoaderTranslateOutcome;
  /** `error` only — never undefined for that outcome. */
  errorMessage?: string;
  /** Source path used in the R2 key. */
  sourcePath: string;
}

/**
 * Everything a sibling loader needs to translate one entry. Stored
 * by reference (translators / R2 / glossaries are live JS objects
 * that can't survive serialisation through a virtual module).
 */
export interface PolystellaRuntimeBridge {
  defaultLocale: string;
  /** Polystella version, baked into R2 metadata. */
  polystellaVersion: string;
  /** Prompt context, if configured. */
  context?: string;
  /** Resolved R2 prefix; undefined when no R2 configured. */
  r2Prefix?: string;
  /** When `true`, skips R2 PUT (preview-branch behaviour). */
  r2ReadOnly: boolean;
  /** R2 client; `null` = no caching but translation still runs. */
  r2: R2Client | null;
  /**
   * Absolute path to the i18n-staging dir. Custom-loader entries are
   * persisted to `<stagingDir>/<locale>/<name>/<id>.json` so dev
   * runs without `runOn: ["dev"]` still find translated content.
   */
  stagingDir: string;
  /** Per-locale Translator. Missing → translation skipped. */
  translatorsByLocale: Map<string, Translator>;
  /** Per-locale glossaries. */
  glossariesByLocale: Map<string, Glossary>;
  /** Per-locale glossary hashes (for cache-key composition). */
  glossaryHashByLocale: Map<string, string>;
  /** Fallback prefixes for R2 reads. */
  readFallbackPrefixes: ReadonlyArray<string>;
  /** Max parallel translations per sibling loader. */
  concurrency: number;
  /** Sink for per-(entry, locale) outcomes; read at `build:done`. */
  reportSink: CustomLoaderTranslateRecord[];
}

/**
 * The bridge lives on `globalThis` (not module-scoped) because Astro
 * evaluates `content.config.ts` in a temp Vite server with its own
 * module graph. Module-scoped state set by the integration would be
 * invisible there. `globalThis` is shared across module-graph
 * isolations within a single Node process.
 */
const BRIDGE_KEY = Symbol.for("polystella.runtimeBridge");

type GlobalThisWithBridge = typeof globalThis & {
  [BRIDGE_KEY]?: PolystellaRuntimeBridge | null;
};

/** Publish the runtime bridge. `null` clears it (used by tests). */
export function setRuntimeBridge(bridge: PolystellaRuntimeBridge | null): void {
  (globalThis as GlobalThisWithBridge)[BRIDGE_KEY] = bridge;
}

/** Read the active bridge. `null` ⇒ sibling loaders passthrough. */
export function getRuntimeBridge(): PolystellaRuntimeBridge | null {
  return (globalThis as GlobalThisWithBridge)[BRIDGE_KEY] ?? null;
}

/** Synthetic source-path for an entry's R2 key. Matches file-source shape. */
function buildEntrySourcePath(loaderName: string, entryId: string): string {
  return `${loaderName}/${entryId}.json`;
}

/** `<stagingDir>/<locale>/<name>/<id>.json` — matches file-source layout. */
function buildStagingPath(stagingDir: string, locale: string, name: string, entryId: string): string {
  return path.join(stagingDir, locale, name, `${entryId}.json`);
}

/**
 * Overlay translated string values from a JSON snapshot onto a fresh
 * clone of the source entry. Source clone preserves `Date`/`URL`
 * types that `JSON.stringify` would flatten — translatable strings
 * + AI marker fields are the only values we read from the snapshot.
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
 * Read a previously-staged snapshot. `null` on any failure (missing
 * file is common, malformed JSON self-heals next live build).
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
 * Persist to disk so subsequent runs (dev without `runOn: ["dev"]`)
 * read translations without R2 access.
 */
async function writeStagedSnapshot(args: { stagingPath: string; data: Record<string, unknown> }): Promise<void> {
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
 * pipeline: build segments → compute cache key → R2 GET → hit
 * returns cached; miss translates + applies marker + PUT. No
 * translator ⇒ passthrough source data so locale routes still render.
 */
async function translateEntry(input: TranslateEntryInput): Promise<TranslateEntryResult> {
  const { entry, marker, locale, bridge } = input;

  const translator = bridge.translatorsByLocale.get(locale);
  if (!translator) {
    return { data: entry.data, outcome: "skipped-no-translator" };
  }

  const sourcePath = buildEntrySourcePath(marker.name, entry.id);

  // Build segments + selected-values from the same `translatableKeys`
  // paths so the cache key and translator input stay in lockstep.
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

  // Nothing translatable → passthrough. Calling AI with zero
  // segments is wasteful and the cache key would be ambiguous.
  if (segments.length === 0) {
    return { data: entry.data, outcome: "skipped-no-translator" };
  }

  const glossaryHash = bridge.glossaryHashByLocale.get(locale) ?? "";
  const glossary = bridge.glossariesByLocale.get(locale) ?? EMPTY_GLOSSARY;

  // Body = "" — custom-loader entries have no body bytes.
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

  const fallbackKeys = bridge.readFallbackPrefixes.map((prefix) => buildR2Key({ locale, sourcePath, hash, prefix }));

  const metadata = buildCacheMetadata({
    polystellaVersion: bridge.polystellaVersion,
    sourcePath,
    locale,
    sourceHash: hash,
    modelId: translator.modelId,
    glossaryHash,
    translatedAt: new Date().toISOString(),
  });

  // Capture `inMemoryApplied` so the miss path can return JS-typed
  // data directly (the JSON-stringified form sent to R2 flattens
  // `Date`/`URL` which then fail `z.date()` schema validation).
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

  // Quiet by default — Astro already logs content sync progress.
  const events: CacheEvents = {};

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

  // Miss → use the in-memory result (preserves Date/URL types).
  if (result.outcome === "miss" && inMemoryApplied !== undefined) {
    return { data: inMemoryApplied, outcome: "ai-translated" };
  }

  // Hit → overlay JSON snapshot onto a fresh source clone.
  const parsedFromCache = JSON.parse(result.body) as Record<string, unknown>;
  const merged = overlaySnapshotOnSource({
    source: entry,
    snapshot: parsedFromCache,
    translatableKeys: marker.translatableKeys,
  });

  return { data: merged, outcome: "cache-hit" };
}

/**
 * Per-locale sibling loader for a custom-loader source.
 * `polystellaCollections` calls this once per (loader, locale) pair.
 * At sync time: pull captured entries, translate via the bridge's
 * R2+translator, populate Astro's store. No bridge ⇒ passthrough
 * source entries (untranslated routes still render, no 404s).
 */
export function createCustomLoaderSibling(args: { marker: PolystellaCustomLoaderMarker; locale: string }): Loader {
  const { marker, locale } = args;
  return {
    name: `polystella-translated-${marker.name}-${locale}`,
    load: async (ctx) => {
      const entries = await marker.captureEntries();
      ctx.store.clear();

      const bridge = getRuntimeBridge();

      // Bridge-or-cwd staging dir so `translate:build` + `pnpm dev`
      // (default `runOn: ["build"]`) still finds staged files.
      const stagingDir = bridge?.stagingDir ?? path.resolve(process.cwd(), ".astro/i18n-staging");

      // Staging fast-path: read JSON snapshots before any bridge
      // work. Critical for dev without `runOn: ["dev"]` — the only
      // way translated content reaches dev. Bridge-absent + staging-
      // miss falls through to passthrough; bridge-present + staging-
      // miss goes through translateEntry.
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

      // Every entry came from staging — done. Common dev path.
      if (stagingMissEntries.length === 0) return;

      if (!bridge) {
        // No bridge + staging miss → passthrough source data.
        for (const entry of stagingMissEntries) {
          const parsed = await ctx.parseData({ id: entry.id, data: entry.data });
          ctx.store.set({ id: entry.id, data: parsed });
        }
        return;
      }

      // Translation phase: pool + heartbeat over `bridge.concurrency`
      // workers. `ctx.store.set` inside the worker keeps memory
      // bounded (no accumulating 200 entries before storing).
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
        // Outcome counts distinguish "fast all-hit" from "slow translate" runs.
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

      // Time-based safety net for slow stretches (single AI call
      // taking 30s+ on a busy provider).
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

          let result: TranslateEntryResult;
          try {
            result = await translateEntry({ entry, marker, locale, bridge });
          } catch (err) {
            // Per-entry failure → log, fall back to source so the
            // page still renders. Matches the file-based pipeline.
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

          // Persist successful translations so the staging fast-path
          // can short-circuit next run. Skipped for passthrough.
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
        const all = bridge.reportSink.filter((r) => r.loaderName === marker.name && r.locale === locale);
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
