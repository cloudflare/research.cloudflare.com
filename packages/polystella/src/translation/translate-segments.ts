import type { Segment } from "../parsing/extract.js";
import { packGroupsIntoBatches } from "./batch.js";
import type { Logger } from "./logger.js";
import { translateBatch, type TranslateBatchOptions } from "./provider.js";

/**
 * Multi-batch translation wrapper above `translateBatch`. Takes the
 * full segment list plus optional adapter-grouped chunks and an
 * optional per-batch document-context block, packs the groups into
 * batches under the configured token budget, and runs each batch
 * sequentially through `translateBatch`. Returns the merged
 * `Map<segmentId, translatedText>` across all batches.
 *
 * Why sequential (not parallel) within a file:
 *   - Parallelism already exists at the (file, locale) pair level
 *     via `runWithConcurrency` in `src/source/pool.ts`. Sequential
 *     batches keep rate-limit math simple — effective in-flight
 *     requests = pool size.
 *   - Per-batch retry isolation: a transient failure on batch N
 *     only retries batch N; batches 1..N-1 are already in hand.
 *
 * Why a separate file (not appended to `provider.ts`):
 *   - Retry semantics live in `translateBatch`; batching/groups
 *     live here; provider HTTP code lives in `provider.ts`. Three
 *     concerns, three files.
 *
 * See ARCHITECTURE.md §17.
 */

export interface TranslateSegmentsOptions extends TranslateBatchOptions {
  /**
   * Adapter-grouped chunks. When omitted, the wrapper treats the
   * full `segments` list as a single group — single-batch behaviour
   * indistinguishable from calling `translateBatch` directly.
   */
  groups?: Segment[][];
  /**
   * Source-language framing block injected into every batch's
   * system prompt. Threaded to `translateBatch.buildPrompt` via the
   * `documentContext` field on `BuildPromptInput`.
   */
  documentContext?: string | undefined;
  /** Soft cap on per-batch input tokens; defaults applied in batch.ts. */
  inputTokenBudget?: number;
  /** Surfaces oversize-section warnings from `packGroupsIntoBatches`. */
  logger?: Logger;
  /** Forward-slash path; threads through to the oversize warning. */
  sourcePath?: string;
}

export interface TranslateSegmentsResult {
  /** Merged `segmentId → translatedText` across every batch. */
  translations: Map<string, string>;
  /** Number of batches the wrapper dispatched. `0` when segments was empty. */
  batchCount: number;
}

export async function translateSegments(opts: TranslateSegmentsOptions): Promise<TranslateSegmentsResult> {
  const { segments, groups, documentContext, inputTokenBudget, logger, sourcePath, signal, ...rest } = opts;

  // Honour cancellation at entry — cheap, and avoids the
  // pack-then-loop dance for work that's about to be discarded.
  signal?.throwIfAborted();
  if (segments.length === 0) return { translations: new Map(), batchCount: 0 };

  // Single-group fallback when the caller doesn't pass `groups`:
  // mimics today's behaviour where `translateBatch` sends every
  // segment in one prompt. The batcher may still split this group
  // if it exceeds the token budget.
  const groupsToUse: Segment[][] = groups ?? [segments];
  const batches = packGroupsIntoBatches(groupsToUse, {
    ...(inputTokenBudget !== undefined ? { inputTokenBudget } : {}),
    ...(logger !== undefined ? { logger } : {}),
    ...(sourcePath !== undefined ? { sourcePath } : {}),
  });

  // Empty batches list (only possible when every group was empty)
  // → no work; return an empty result rather than calling translateBatch.
  if (batches.length === 0) return { translations: new Map(), batchCount: 0 };

  const merged = new Map<string, string>();
  for (const batch of batches) {
    signal?.throwIfAborted();
    const batchResult = await translateBatch({
      ...rest,
      segments: batch,
      ...(documentContext !== undefined ? { documentContext } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });
    for (const [id, text] of batchResult) {
      merged.set(id, text);
    }
  }
  return { translations: merged, batchCount: batches.length };
}
