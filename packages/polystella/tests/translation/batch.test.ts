import { describe, expect, it, vi } from "vitest";

import type { Segment } from "../../src/parsing/extract.js";
import { DEFAULT_INPUT_TOKEN_BUDGET, estimateInputTokens, packGroupsIntoBatches } from "../../src/translation/batch.js";

/**
 * Unit tests for the token-aware batching primitive.
 *
 * `estimateInputTokens` is a pure formula — assertions pin the exact
 * value so a future tweak to the chars/4 or +8 constants surfaces as
 * a test failure (the regression is in the cache-key implications:
 * over- or under-packing changes batch counts).
 *
 * `packGroupsIntoBatches` is the algorithm; assertions cover the
 * five algorithm paths declared in §17 + the logger-warn case from
 * the oversize-group fallback.
 */

const seg = (id: string, text: string): Segment => ({ id, text });

describe("estimateInputTokens", () => {
  it("returns 0 for an empty list (no segments → no prompt → no network)", () => {
    expect(estimateInputTokens([])).toBe(0);
  });

  it("computes ceil((id + text + 8) / 4) for a single segment", () => {
    // "a" (id=1) + "hello" (text=5) + 8 = 14 → ceil(14/4) = 4.
    expect(estimateInputTokens([seg("a", "hello")])).toBe(4);
  });

  it("sums segment costs before dividing (one ceil call, not per-segment)", () => {
    // Two segments of (id=1, text=5, +8) = 14 chars each → 28 total
    // → ceil(28/4) = 7. (Per-segment ceil would give 4 + 4 = 8.)
    expect(estimateInputTokens([seg("a", "hello"), seg("b", "world")])).toBe(7);
  });
});

describe("packGroupsIntoBatches", () => {
  it("returns an empty array for empty input", () => {
    expect(packGroupsIntoBatches([], {})).toEqual([]);
  });

  it("ignores empty groups silently", () => {
    // A grouping algorithm that emits an empty group (e.g. an
    // empty trailing-frontmatter group) shouldn't force an empty
    // batch downstream.
    expect(packGroupsIntoBatches([[], [seg("a", "x")], []], {})).toEqual([[seg("a", "x")]]);
  });

  it("returns one batch when a single group fits under the default budget", () => {
    const group = [seg("body:0", "hello"), seg("body:1", "world")];
    expect(packGroupsIntoBatches([group], {})).toEqual([group]);
  });

  it("packs multiple small groups into a single batch when they all fit", () => {
    const g1 = [seg("body:0", "a")];
    const g2 = [seg("body:1", "b")];
    const g3 = [seg("body:2", "c")];
    const out = packGroupsIntoBatches([g1, g2, g3], {});
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual([...g1, ...g2, ...g3]);
  });

  it("starts a new batch when the next group would overflow the budget", () => {
    // Two groups, each estimated at ~7 tokens (see estimateInputTokens
    // unit test). Budget of 7 fits the first group exactly; second
    // group can't join → starts a new batch.
    const g1 = [seg("a", "hello"), seg("b", "world")];
    const g2 = [seg("c", "hello"), seg("d", "world")];
    expect(estimateInputTokens(g1)).toBe(7);
    expect(estimateInputTokens(g2)).toBe(7);
    const out = packGroupsIntoBatches([g1, g2], { inputTokenBudget: 7 });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(g1);
    expect(out[1]).toEqual(g2);
  });

  it("preserves group order across batches", () => {
    const g1 = [seg("a", "hello"), seg("b", "world")];
    const g2 = [seg("c", "more"), seg("d", "stuff")];
    const g3 = [seg("e", "extra")];
    const out = packGroupsIntoBatches([g1, g2, g3], { inputTokenBudget: 10 });
    // Flatten and check the segment-id order matches input.
    const flat = out.flat().map((s) => s.id);
    expect(flat).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("preserves the flat(groups) === flat(batches) invariant across packing", () => {
    const groups: Segment[][] = [
      [seg("body:0", "alpha"), seg("body:1", "beta")],
      [seg("body:2", "gamma")],
      [seg("body:3", "delta"), seg("body:4", "epsilon"), seg("body:5", "zeta")],
      [seg("fm:title", "Hello")],
    ];
    const inputFlat = groups.flat();
    const out = packGroupsIntoBatches(groups, { inputTokenBudget: 12 });
    expect(out.flat()).toEqual(inputFlat);
  });

  it("warns via the logger when a single group exceeds the budget", () => {
    // Construct a group whose token estimate is 10 against a budget
    // of 5 — paragraph-by-paragraph fallback kicks in.
    const longText = "this is a longer paragraph that pushes the group over the budget alone";
    const oversize = [seg("body:0", longText), seg("body:1", "tail")];
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const out = packGroupsIntoBatches([oversize], {
      inputTokenBudget: 5,
      logger,
      sourcePath: "publications/big.md",
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const message = logger.warn.mock.calls[0]![0]!;
    expect(message).toMatch(/exceeds batch input-token budget/);
    expect(message).toMatch(/publications\/big\.md/);
    // Output still contains every segment.
    expect(out.flat()).toEqual(oversize);
  });

  it("falls back to paragraph-by-paragraph split without a logger (no throw)", () => {
    const oversize = [seg("body:0", "alpha beta gamma delta"), seg("body:1", "epsilon zeta"), seg("body:2", "eta theta iota")];
    // No logger provided — should still work.
    const out = packGroupsIntoBatches([oversize], { inputTokenBudget: 5 });
    expect(out.flat()).toEqual(oversize);
    // Each pseudo-segment may pack with neighbours when it fits;
    // assert the flatness invariant rather than a specific shape.
  });

  it("emits each segment as its own batch when the budget is below the per-segment minimum", () => {
    // inputTokenBudget: 1 forces every segment (≥1 char) into its own
    // batch. Degenerate but the algorithm should still terminate
    // with the full segment set spread across batches.
    const group = [seg("a", "x"), seg("b", "y"), seg("c", "z")];
    const out = packGroupsIntoBatches([group], { inputTokenBudget: 1 });
    expect(out).toHaveLength(3);
    expect(out.flat()).toEqual(group);
  });

  it("flushes the in-progress batch before splitting an oversize group", () => {
    // Sequence:
    //   g1 (fits in budget) → currentBatch = g1
    //   g2 (exceeds budget alone) → must flush g1 first, then split g2.
    // Result: [g1, ...split(g2)] — g1 doesn't get merged into g2's split.
    const g1 = [seg("a", "small")];
    const g2 = [seg("b", "this is the long one"), seg("c", "and another long bit")];
    const out = packGroupsIntoBatches([g1, g2], { inputTokenBudget: 5 });
    expect(out[0]).toEqual(g1);
    // Subsequent batches cover g2 in document order.
    expect(out.slice(1).flat()).toEqual(g2);
  });

  it("uses DEFAULT_INPUT_TOKEN_BUDGET (4000) when none is supplied", () => {
    // A modest 100-segment fixture should comfortably fit under 4000
    // tokens (rough size: 100 × (16 chars text + 8 id + 8 overhead)
    // / 4 = 800 tokens).
    const group = Array.from({ length: 100 }, (_, i) => seg(`body:${i}`, "hello world"));
    expect(DEFAULT_INPUT_TOKEN_BUDGET).toBe(4000);
    expect(estimateInputTokens(group)).toBeLessThan(DEFAULT_INPUT_TOKEN_BUDGET);
    const out = packGroupsIntoBatches([group], {});
    expect(out).toHaveLength(1);
  });
});
