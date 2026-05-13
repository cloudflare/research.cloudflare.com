import type { Segment } from "../parsing/extract.js";
import type { Glossary } from "../glossary/glossary.js";
import type { Logger } from "../translation/logger.js";
import { type TranslateBatchRetryEvent, type Translator } from "../translation/provider.js";
import { translateSegments } from "../translation/translate-segments.js";
import type { R2Client } from "./r2.js";

/**
 * Cache-aware translation orchestrator. One entry per (file, locale)
 * pair: R2 GET → hit returns cached bytes; miss runs the translator,
 * calls `apply(translations)` to splice, PUTs to R2 with metadata.
 *
 * Format-agnostic: `apply` is an opaque closure. Any AI-translation
 * marker is the caller's responsibility — must be baked in BEFORE
 * the PUT so hits return it verbatim. See ARCHITECTURE.md §11.
 */

export type CacheOutcome = "hit" | "miss";

export interface TranslateOrLoadOptions {
  segments: Segment[];
  /**
   * Adapter-grouped chunks (see `FileTypeAdapter.groupSegments`).
   * Forwarded to `translateSegments` on the miss branch; when
   * omitted, the wrapper packs `[segments]` as a single group —
   * indistinguishable from today's single-batch behaviour.
   */
  groups?: Segment[][];
  /**
   * Per-batch document-context block (see `FileTypeAdapter.documentContext`).
   * Threaded to every batch's system prompt. NOT included in the
   * cache hash — see ARCHITECTURE.md §17.
   */
  documentContext?: string | undefined;
  /** Soft cap on per-batch input tokens. Defaults applied in `batch.ts`. */
  inputTokenBudget?: number;
  /** Surfaces oversize-section warnings from the batcher. */
  logger?: Logger;
  /** Forward-slash path; threads through to the oversize warning. */
  sourcePath?: string;
  /**
   * Called once per miss after the translator returns. Caller's
   * closure parses, mutates with translations, and injects any
   * top-level markers. Returned string is opaque bytes — PUT to R2
   * verbatim and returned for staging.
   */
  apply: (translations: Map<string, string>) => string;
  locale: string;
  /** R2 key from `buildR2Key`. */
  key: string;
  /** `null` skips the cache entirely (always translate, never store). */
  r2: R2Client | null;
  translator: Translator;
  glossary: Glossary;
  sourceLocale: string;
  context?: string;
  /** From `buildCacheMetadata` — kept caller-built for hook/test parity. */
  metadata: Record<string, string>;
  /** Cache-write progress hooks; only fire on the miss path with `r2`. */
  events?: CacheEvents;
  /**
   * Skip the PUT after a miss-translate. Translated bytes still
   * return so the caller can stage them. Used by preview builds.
   */
  readOnly?: boolean;
  /**
   * Additional keys to GET if `key` misses. First hit wins; bytes
   * are NOT promoted to the primary key. Each must already be a
   * `buildR2Key` result with the appropriate fallback prefix.
   */
  fallbackKeys?: string[];
  /**
   * Retries on translator/parse failure. Forwarded to
   * `translateBatch`. `0` (default) = single attempt.
   */
  maxRetries?: number;
  /** Fires per failed-and-retried translator attempt. */
  onRetry?: (event: TranslateBatchRetryEvent) => void;
  /** Backoff between retries; forwarded to `translateBatch`. */
  retryMinTimeoutMs?: number;
  retryFactor?: number;
  retryRandomize?: boolean;
  /** Cancellation signal; forwarded to `translateBatch` + R2 ops. */
  signal?: AbortSignal;
  /**
   * Pre-built cache-key predicate. When provided, the cache layer
   * calls it before `r2.get(...)` and skips the round-trip if it
   * returns `false`. Lets the caller pre-list R2 (one paginated
   * `list()` per locale) instead of one GET per (file, locale) pair.
   * `true` means "key MIGHT exist, do the GET to confirm and pull
   * bytes". Omitted ⇒ behave as before (always GET).
   */
  existsInCache?: (key: string) => boolean;
}

/**
 * Cache-write progress callbacks. Exactly one of `onWriteDone` or
 * `onWriteFailed` fires per `onWriteStart`. PUT failures do NOT
 * rethrow — the bytes are already returned for staging.
 */
export interface CacheEvents {
  onWriteStart?: (event: { key: string; locale: string; bytes: number }) => void;
  onWriteDone?: (event: { key: string; locale: string; bytes: number; durationMs: number }) => void;
  onWriteFailed?: (event: { key: string; locale: string; bytes: number; error: Error }) => void;
}

export interface TranslateOrLoadResult {
  outcome: CacheOutcome;
  /** Translated MDX bytes, ready to stage. */
  body: string;
  /** On hit, the cached object's metadata (`x-amz-meta-` prefix stripped). */
  cachedMetadata?: Record<string, string>;
  /**
   * Key that produced the cached bytes. Equals `opts.key` on primary
   * hit, one of `opts.fallbackKeys` on fallback hit, undefined on miss.
   * Useful for build-report provenance.
   */
  hitKey?: string;
  /**
   * Number of batches translated on the miss path. `1` for the common
   * case (single batch); `>1` when grouping + token budget produced
   * multiple batches. Undefined on cache hits (no batching took place).
   * Used by the orchestrator's progress log.
   */
  batchCount?: number;
}

/**
 * Errors propagate so the caller's per-pair try/catch can log + count.
 * Silent fallback would mask real provider/storage outages.
 */
export async function translateOrLoadFromCache(opts: TranslateOrLoadOptions): Promise<TranslateOrLoadResult> {
  const {
    segments,
    groups,
    documentContext,
    inputTokenBudget,
    logger,
    sourcePath,
    apply,
    locale,
    key,
    r2,
    translator,
    glossary,
    sourceLocale,
    context,
    metadata,
    events,
    readOnly,
    fallbackKeys,
    maxRetries,
    onRetry,
    retryMinTimeoutMs,
    retryFactor,
    retryRandomize,
    signal,
    existsInCache,
  } = opts;

  // Honour cancellation at every cache decision point — cheap, and
  // avoids issuing R2 GETs for work that's about to be discarded.
  signal?.throwIfAborted();

  // `null` r2 = operator opted out; skip lookup, always translate.
  if (r2) {
    // When `existsInCache` is provided, the caller already paid for
    // a bulk list. We only issue the GET (to pull bytes) if the
    // predicate says the key is present.
    const primaryMightExist = existsInCache ? existsInCache(key) : true;
    if (primaryMightExist) {
      const hit = await r2.get(key);
      if (hit) {
        return {
          outcome: "hit",
          body: new TextDecoder("utf-8").decode(hit.body),
          cachedMetadata: hit.metadata,
          hitKey: key,
        };
      }
    }
    // Primary miss → fallbacks in order. First hit wins; never
    // promoted to primary (avoids implicit cross-prefix writes).
    if (fallbackKeys && fallbackKeys.length > 0) {
      for (const fbKey of fallbackKeys) {
        // Defensive: skip a fallback identical to the primary.
        if (fbKey === key) continue;
        if (existsInCache && !existsInCache(fbKey)) continue;
        const fbHit = await r2.get(fbKey);
        if (fbHit) {
          return {
            outcome: "hit",
            body: new TextDecoder("utf-8").decode(fbHit.body),
            cachedMetadata: fbHit.metadata,
            hitKey: fbKey,
          };
        }
      }
    }
  }

  // Cache miss. `apply` bakes any markers in BEFORE the PUT so
  // later hits return them verbatim. `translateSegments` wraps
  // `translateBatch` with token-aware batching; absent
  // `groups`/`documentContext` it sends one batch indistinguishable
  // from the pre-batching path.
  signal?.throwIfAborted();
  const { translations, batchCount } = await translateSegments({
    translator,
    segments,
    ...(groups !== undefined ? { groups } : {}),
    ...(documentContext !== undefined ? { documentContext } : {}),
    ...(inputTokenBudget !== undefined ? { inputTokenBudget } : {}),
    ...(logger !== undefined ? { logger } : {}),
    ...(sourcePath !== undefined ? { sourcePath } : {}),
    glossary,
    sourceLocale,
    targetLocale: locale,
    context,
    ...(maxRetries !== undefined ? { maxRetries } : {}),
    ...(onRetry !== undefined ? { onRetry } : {}),
    ...(retryMinTimeoutMs !== undefined ? { retryMinTimeoutMs } : {}),
    ...(retryFactor !== undefined ? { retryFactor } : {}),
    ...(retryRandomize !== undefined ? { retryRandomize } : {}),
    ...(signal !== undefined ? { signal } : {}),
  });
  const translated = apply(translations);

  // PUT failures are caught, not rethrown — translator already
  // ran; dropping bytes would compound the cost. `readOnly`
  // short-circuits the PUT but still returns bytes for staging.
  if (r2 && !readOnly) {
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

  return { outcome: "miss", body: translated, batchCount };
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
  /** ISO-8601. Caller-supplied so tests can pin it deterministic. */
  translatedAt: string;
  polystellaVersion: string;
}

/** Build the `x-amz-meta-*` bag for a cache PUT. Keys kebab-case. */
export function buildCacheMetadata(input: BuildCacheMetadataInput): Record<string, string> {
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
