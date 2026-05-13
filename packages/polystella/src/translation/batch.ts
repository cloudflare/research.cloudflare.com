import type { Segment } from "../parsing/extract.js";
import type { Logger } from "./logger.js";

/**
 * Token-aware batching primitive. Format-agnostic — depends only on
 * the `Segment` shape (`{ id, text }`). Adapters provide grouping
 * hints (see `FileTypeAdapter.groupSegments`); this module packs
 * those groups into batches that fit under a soft input-token
 * budget. See ARCHITECTURE.md §17 for the strategy.
 *
 * Pure functions, no I/O. The `logger` parameter is optional and
 * only surfaces the oversize-section degradation warning (§17).
 */

/**
 * Default soft cap for input tokens per batch. Sized to leave
 * roughly half of the model's `maxTokens` (8192 default) for the
 * response, matching stratus's 2500-token catalog heuristic scaled
 * to prose. Configurable via `provider.batchInputTokenBudget`.
 */
export const DEFAULT_INPUT_TOKEN_BUDGET = 4000;

/**
 * Average chars-per-token ratio for English-like scripts. Stratus's
 * `TOKEN_CHAR_RATIO = 4` heuristic; pessimistic for CJK (we
 * under-pack rather than over-pack on those locales, which is the
 * safe direction).
 */
const TOKEN_CHAR_RATIO = 4;

/**
 * Per-segment prompt overhead in chars. Each segment renders as
 * `@@<id>@@\n<text>\n\n` in the user prompt — 5 fixed chars plus
 * the id length plus the text. The +8 here pads the fixed overhead
 * slightly so we under-pack rather than over-pack at the budget
 * boundary; the rounding is harmless given the chars/4 estimate is
 * itself approximate.
 */
const SEGMENT_OVERHEAD_CHARS = 8;

/**
 * Estimate the input-token cost of rendering `segments` into the
 * user-prompt marker format. Returns `0` for an empty list (no
 * network call would happen).
 *
 * The estimate intentionally does NOT account for the system prompt
 * (glossary, style rules, doc-context block) — those are roughly
 * constant across batches within a single file, so they don't
 * affect the *relative* packing decision. Callers who need a hard
 * cap including the system prompt should pre-deduct it from the
 * configured budget.
 */
export function estimateInputTokens(segments: Segment[]): number {
  if (segments.length === 0) return 0;
  let chars = 0;
  for (const seg of segments) {
    chars += seg.id.length + seg.text.length + SEGMENT_OVERHEAD_CHARS;
  }
  return Math.ceil(chars / TOKEN_CHAR_RATIO);
}

export interface PackGroupsIntoBatchesOptions {
  /** Soft cap; defaults to `DEFAULT_INPUT_TOKEN_BUDGET`. */
  inputTokenBudget?: number;
  /**
   * Surface oversize-section warnings (logged once per oversize
   * group). Optional: tests and unit callers can omit it.
   */
  logger?: Logger;
  /** Forward-slash path; used in the oversize warning for operators. */
  sourcePath?: string;
}

/**
 * Pack adapter-grouped segments into prompt-sized batches.
 *
 * Algorithm (per §17):
 *   1. Greedy fill: maintain a `currentBatch`. For each group:
 *      - If `currentBatch + group ≤ budget`: append.
 *      - Else: flush `currentBatch` and start a new one with this group.
 *   2. Oversize-group fallback: when a single group exceeds the
 *      budget, flatten its segments and split them paragraph-by-
 *      paragraph using the same greedy fill. Emit `logger?.warn`
 *      so operators see the degradation (the section's heading
 *      anchor is lost for sub-batches past the first).
 *
 * Invariants:
 *   - Empty `groups` → `[]`.
 *   - `flat(result) === flat(groups)` (no segment dropped or duplicated).
 *   - Group order preserved across batches.
 *   - When everything fits in one budget, `result.length === 1`.
 */
export function packGroupsIntoBatches(groups: Segment[][], opts: PackGroupsIntoBatchesOptions = {}): Segment[][] {
  const budget = opts.inputTokenBudget ?? DEFAULT_INPUT_TOKEN_BUDGET;
  const batches: Segment[][] = [];
  let currentBatch: Segment[] = [];
  let currentTokens = 0;

  const flushCurrent = (): void => {
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }
  };

  for (const group of groups) {
    if (group.length === 0) continue;
    const groupTokens = estimateInputTokens(group);

    if (groupTokens > budget) {
      // Oversize group: flush the accumulator first so its contents
      // ship as their own batch, then split this group segment-by-
      // segment using the same greedy logic. Each segment becomes a
      // pseudo-group of size 1; segments smaller than the budget
      // still pack together.
      flushCurrent();
      opts.logger?.warn(
        `[polystella] section in ${opts.sourcePath ?? "<unknown>"} exceeds batch input-token budget (${groupTokens} > ${budget}); splitting paragraph-by-paragraph — heading anchor is lost for sub-batches past the first`,
      );
      for (const seg of group) {
        const segTokens = estimateInputTokens([seg]);
        if (currentTokens + segTokens <= budget) {
          currentBatch.push(seg);
          currentTokens += segTokens;
        } else {
          flushCurrent();
          // Even if the individual segment exceeds the budget on
          // its own, push it as a one-segment batch — truncation
          // then becomes a content-level problem the operator must
          // address (split the source). `parseResponse` already
          // raises a clear hint for that case.
          currentBatch.push(seg);
          currentTokens = segTokens;
        }
      }
      continue;
    }

    if (currentTokens + groupTokens > budget) {
      flushCurrent();
    }
    currentBatch.push(...group);
    currentTokens += groupTokens;
  }

  flushCurrent();
  return batches;
}
