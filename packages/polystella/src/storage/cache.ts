import type { Segment } from "../parsing/extract.js";
import type { Glossary } from "../glossary/glossary.js";
import { translateBatch, type TranslateBatchRetryEvent, type Translator } from "../translation/provider.js";
import type { R2Client } from "./r2.js";

/**
 * Cache-aware translation orchestrator. Single entry point per
 * (file, locale) pair: R2 GET → on hit return cached bytes; on miss,
 * translate via the provider, splice via the caller-supplied apply
 * callback, PUT back to R2 with metadata.
 *
 * The orchestrator is format-agnostic: callers pass `apply` as an
 * opaque "splice these translations into the source bytes" closure.
 * The markdown adapter's apply byte-splices inline ranges; structured-
 * data adapters (M3+) parse-mutate-stringify. Either way, the cache
 * layer just calls `apply(translations)` and receives final bytes.
 *
 * Any per-format AI-translation marker (e.g. `aiTranslated: true`
 * baked into frontmatter / top-level keys) is the caller's
 * responsibility to weave into the closure — bake it in BEFORE the
 * R2 PUT so later cache hits return the marker verbatim and timestamps
 * stay truthful.
 *
 * Lives separately from `index.ts` so the cache decision tree is
 * unit-testable with mocked R2 + Translator without booting Astro.
 */

export type CacheOutcome = "hit" | "miss";

export interface TranslateOrLoadOptions {
  segments: Segment[];
  /**
   * Format-agnostic apply step. Called once per cache miss, AFTER
   * the translator returns. Whatever closure the caller builds owns
   * (a) parsing the source, (b) mutating it with `translations`, and
   * (c) injecting any top-level marker fields (AI metadata, etc.).
   *
   * The cache layer treats the returned string as opaque bytes; it
   * gets PUT to R2 verbatim and returned to the caller for staging.
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
   * When `true`, the cache layer skips the PUT after a miss-translate.
   * The translated bytes are still returned to the caller for staging
   * (the translator was already paid for) — `readOnly` only governs
   * cache writes, not the translation pipeline.
   *
   * Use this on preview-branch builds that should consume but not
   * mutate the primary cache.
   */
  readOnly?: boolean;
  /**
   * Ordered list of additional R2 keys to GET if the primary `key`
   * misses. First hit wins; bytes are returned verbatim and NOT
   * promoted to the primary key (callers that want promotion must
   * issue an explicit PUT).
   *
   * Each fallback key MUST already be the result of `buildR2Key`
   * with the appropriate fallback prefix — the cache layer is
   * deliberately decoupled from key construction.
   */
  fallbackKeys?: string[];
  /**
   * Number of retries on translator/parse failure. Forwarded to
   * `translateBatch` verbatim — see its docstring for semantics.
   * `0` (default) preserves legacy single-attempt behaviour.
   */
  maxRetries?: number;
  /**
   * Fires once per failed translator attempt that's followed by a
   * retry. Forwarded to `translateBatch`; the cache layer doesn't
   * inspect the events. See `TranslateBatchRetryEvent`.
   */
  onRetry?: (event: TranslateBatchRetryEvent) => void;
}

/**
 * Cache-write progress callbacks. Exactly one of `onWriteDone` or
 * `onWriteFailed` fires per `onWriteStart`.
 */
export interface CacheEvents {
  onWriteStart?: (event: { key: string; locale: string; bytes: number }) => void;
  onWriteDone?: (event: { key: string; locale: string; bytes: number; durationMs: number }) => void;
  /**
   * Fires when the R2 PUT throws. The orchestrator does NOT rethrow:
   * the translator already succeeded and the bytes are returned to
   * the caller for staging — a flaky R2 shouldn't kill the build.
   */
  onWriteFailed?: (event: { key: string; locale: string; bytes: number; error: Error }) => void;
}

export interface TranslateOrLoadResult {
  outcome: CacheOutcome;
  /** Translated MDX bytes, ready to stage. */
  body: string;
  /** On hit, the cached object's metadata (`x-amz-meta-` prefix stripped). */
  cachedMetadata?: Record<string, string>;
  /**
   * Key that actually produced the cached bytes. Equals `opts.key`
   * on a primary hit; equals one of `opts.fallbackKeys` on a
   * fallback hit. Undefined on miss. Useful for build-report
   * provenance ("translation came from main's cache" vs. "from
   * the PR's own cache").
   */
  hitKey?: string;
}

/**
 * Errors propagate so the caller's per-pair try/catch can log + count
 * the failure. Silent fallback would mask real provider/storage outages.
 */
export async function translateOrLoadFromCache(opts: TranslateOrLoadOptions): Promise<TranslateOrLoadResult> {
  const {
    segments,
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
  } = opts;

  // `null` r2 = operator opted out; skip lookup, always translate.
  if (r2) {
    const hit = await r2.get(key);
    if (hit) {
      return {
        outcome: "hit",
        body: new TextDecoder("utf-8").decode(hit.body),
        cachedMetadata: hit.metadata,
        hitKey: key,
      };
    }
    // Primary miss → walk the fallback prefixes in order. First hit
    // wins; we never write back to fallback prefixes (that's the
    // upstream cache's job) and we never copy bytes from fallback
    // to primary (avoids implicit cross-prefix writes).
    if (fallbackKeys && fallbackKeys.length > 0) {
      for (const fbKey of fallbackKeys) {
        // Defensive: skip a fallback that's accidentally identical
        // to the primary key (would just retry the same GET).
        if (fbKey === key) continue;
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

  // Cache miss. The caller's `apply` closure is responsible for any
  // marker additions (AI metadata etc.) — they MUST be baked in
  // BEFORE the PUT so later cache hits return the marker verbatim.
  const translations = await translateBatch({
    translator,
    segments,
    glossary,
    sourceLocale,
    targetLocale: locale,
    context,
    ...(maxRetries !== undefined ? { maxRetries } : {}),
    ...(onRetry !== undefined ? { onRetry } : {}),
  });
  const translated = apply(translations);

  // PUT failures are caught (not rethrown): translator already ran
  // and was billed; dropping the bytes would compound the cost. We
  // surface the failure via `onWriteFailed` and return the bytes so
  // the caller can still stage them; the next build will retranslate
  // just that pair.
  //
  // `readOnly` short-circuits the PUT entirely — used by preview
  // builds that consume but don't mutate the primary cache. We
  // intentionally still return the freshly-translated bytes so the
  // caller can stage them; readOnly only forbids the side effect on
  // R2, not the translation work itself.
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
  /** ISO-8601. Caller-supplied so tests can pin it deterministic. */
  translatedAt: string;
  polystellaVersion: string;
}

/**
 * Build the `x-amz-meta-*` bag for a cache PUT. Keys kebab-case;
 * empty strings preserved so the metadata schema is uniform.
 */
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
