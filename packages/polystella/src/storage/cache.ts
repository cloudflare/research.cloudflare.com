import type { Root } from "mdast";
import { applyTranslations } from "../parsing/apply.js";
import type { Segment } from "../parsing/extract.js";
import type { Glossary } from "../glossary/glossary.js";
import { translateBatch, type Translator } from "../translation/provider.js";
import type { R2Client } from "./r2.js";

/**
 * Cache-aware translation orchestrator.
 *
 * `translateOrLoadFromCache` is the single entry point the build hook
 * calls per (source-file, locale) pair. It encapsulates three concerns
 * the hook used to know about itself:
 *
 *   1. R2 cache lookup: if the keyed object exists, the translated
 *      bytes are reused verbatim — no provider call, no rewrite,
 *      byte-for-byte stable across builds.
 *   2. Translation on miss: build the prompt, hit the provider, parse
 *      the response, and splice translations back into the source
 *      using the same position-based applier the in-memory pipeline
 *      already uses.
 *   3. Cache write-back: on miss, PUT the translated bytes plus a
 *      structured metadata bag so future builds can hit the cache and
 *      operators can audit what produced each cached object.
 *
 * Pulled out of `index.ts` so the cache decision tree is unit-testable
 * with mocked R2 + Translator pairs without spinning up Astro.
 */

/** Outcome of a single cache-aware translation attempt. */
export type CacheOutcome = "hit" | "miss";

export interface TranslateOrLoadOptions {
  /** Parsed mdast root for the source file (used by the applier on miss). */
  ast: Root;
  /** Segments extracted from `ast` (skipped on hit; consumed on miss). */
  segments: Segment[];
  /** Original source bytes, needed by the position-based applier. */
  sourceBody: string;
  /** Target locale, e.g. `"pt-BR"`. */
  locale: string;
  /** R2 object key produced by `buildR2Key`. */
  key: string;
  /**
   * R2 client to use for cache lookup + write-back. Pass `null` to
   * skip the cache entirely (e.g. when no `r2` block is configured);
   * the call then degenerates to "always translate, never store".
   */
  r2: R2Client | null;
  /** Per-locale Translator (already model-id-resolved). */
  translator: Translator;
  /** Locale's glossary (or `EMPTY_GLOSSARY` if none). */
  glossary: Glossary;
  /** Source / canonical locale, e.g. `"en"`. */
  sourceLocale: string;
  /** Optional caller-supplied prompt context; see `BuildPromptInput.context`. */
  context?: string;
  /**
   * Pre-built metadata bag to attach to the cache PUT. Built by
   * `buildCacheMetadata` so the hook and the test harness produce
   * identical headers.
   */
  metadata: Record<string, string>;
  /**
   * Optional progress callbacks for the cache-write phase. Both are
   * no-ops by default and only invoked on the miss path with `r2`
   * non-null — i.e., when the orchestrator is genuinely about to
   * persist new bytes. The build hook plugs these in to print
   * “starting cache write” / “cache write done” log lines so a slow R2
   * round-trip doesn't look like a frozen build.
   */
  events?: CacheEvents;
}

/**
 * Progress callbacks for the cache-write phase. Signatures are stable:
 * callers can rely on `key`, `locale`, and `bytes` being present on
 * every event. `durationMs` (on `onWriteDone`) is wall-clock elapsed
 * inside the PUT call, rounded to whole milliseconds for log
 * readability. Exactly one of `onWriteDone` or `onWriteFailed` fires
 * per `onWriteStart` — they are mutually exclusive.
 */
export interface CacheEvents {
  onWriteStart?: (event: {
    key: string;
    locale: string;
    bytes: number;
  }) => void;
  onWriteDone?: (event: {
    key: string;
    locale: string;
    bytes: number;
    durationMs: number;
  }) => void;
  /**
   * Fires when the R2 PUT throws. The orchestrator does NOT rethrow:
   * a failed cache write is a degraded-but-acceptable state because
   * the translation itself already succeeded and the bytes are
   * returned to the caller for staging. The build hook uses this to
   * print a per-file warning so a flaky R2 is visible without
   * killing the build.
   */
  onWriteFailed?: (event: {
    key: string;
    locale: string;
    bytes: number;
    error: Error;
  }) => void;
}

export interface TranslateOrLoadResult {
  outcome: CacheOutcome;
  /** The translated MDX bytes, ready to write to staging. */
  body: string;
  /**
   * On hit, the metadata that came back with the cached object (with
   * `x-amz-meta-` prefix already stripped by the R2 client). Useful
   * for the build report. Empty record on miss — the canonical
   * metadata the caller supplied is what got written.
   */
  cachedMetadata?: Record<string, string>;
}

/**
 * Try to load `key` from R2; on hit return its bytes, on miss
 * translate + apply + write back to R2 (when configured).
 *
 * Errors propagate: a failing R2 call or a failing translator throws
 * out, letting the caller's per-pair try/catch increment the failure
 * counter and log the diagnostic. We don't paper over either side —
 * a silent fallback would mask real provider/storage outages.
 */
export async function translateOrLoadFromCache(
  opts: TranslateOrLoadOptions,
): Promise<TranslateOrLoadResult> {
  const {
    ast,
    segments,
    sourceBody,
    locale,
    key,
    r2,
    translator,
    glossary,
    sourceLocale,
    context,
    metadata,
    events,
  } = opts;

  // 1. Cache lookup. A `null` r2 means the operator opted out of
  //    caching; we skip straight to translation so smoke tests can run
  //    without provisioning R2.
  if (r2) {
    const hit = await r2.get(key);
    if (hit) {
      return {
        outcome: "hit",
        body: new TextDecoder("utf-8").decode(hit.body),
        cachedMetadata: hit.metadata,
      };
    }
  }

  // 2. Cache miss → translate + apply.
  const translations = await translateBatch({
    translator,
    segments,
    glossary,
    sourceLocale,
    targetLocale: locale,
    context,
  });
  const translated = applyTranslations(ast, translations, sourceBody);

  // 3. Write back to R2 when configured. The metadata bag is
  //    intentionally caller-built so the hook and tests stay in sync
  //    on what gets persisted. PUT failures are caught here rather
  //    than propagated: by this point the translator already ran (and
  //    the operator was already billed for it), so dropping the
  //    translated bytes on a flaky R2 would compound the cost. We
  //    surface the failure via `onWriteFailed` and return the bytes
  //    so the caller can still stage them — the next build will
  //    retranslate, but only that pair, not the whole corpus.
  if (r2) {
    const bytes = Buffer.byteLength(translated, "utf8");
    events?.onWriteStart?.({ key, locale, bytes });
    const startedAt = Date.now();
    try {
      await r2.put(key, translated, {
        contentType: "text/markdown; charset=utf-8",
        metadata,
      });
      events?.onWriteDone?.({
        key,
        locale,
        bytes,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      events?.onWriteFailed?.({
        key,
        locale,
        bytes,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  return { outcome: "miss", body: translated };
}

export interface BuildCacheMetadataInput {
  /** Relative source path, normalised to forward slashes. */
  sourcePath: string;
  /** Target locale. */
  locale: string;
  /** Full source-content cache hash (the part after `#` in the R2 key). */
  sourceHash: string;
  /** Per-locale glossary hash; empty string when no glossary is configured. */
  glossaryHash: string;
  /** Resolved model id, e.g. `"@cf/meta/llama-3.1-8b-instruct"`. */
  modelId: string;
  /**
   * ISO-8601 timestamp for when the translation completed. Caller
   * supplies it (rather than us calling `new Date()` here) so tests
   * can pin a deterministic value and the build report can use the
   * same instant as the cached metadata.
   */
  translatedAt: string;
  /** PolyStella package version, for forensic traceability. */
  polystellaVersion: string;
}

/**
 * Assemble the canonical `x-amz-meta-*` bag for a cache write.
 *
 * Keys are kebab-case to match S3/R2 convention (the underlying client
 * lowercases anyway, but consistent shape makes log greps tolerable).
 * Values are always strings; none are nullable. Where an upstream
 * field is genuinely empty (e.g. `glossaryHash` for an unconfigured
 * locale) the empty string is preserved so the metadata schema stays
 * the same across rows.
 */
export function buildCacheMetadata(
  input: BuildCacheMetadataInput,
): Record<string, string> {
  return {
    "source-path": input.sourcePath,
    locale: input.locale,
    "source-hash": input.sourceHash,
    "glossary-hash": input.glossaryHash,
    "model-id": input.modelId,
    "translated-at": input.translatedAt,
    "polystella-version": input.polystellaVersion,
  };
}
