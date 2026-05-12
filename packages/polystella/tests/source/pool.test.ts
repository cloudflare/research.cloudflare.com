import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "../../src/source/pool.js";

/**
 * Tests for the pool utility used by the build hook's per-source
 * loop. The pool must:
 *
 *   - process every item exactly once,
 *   - cap in-flight tasks at `concurrency`,
 *   - drain reliably (no items left dangling),
 *   - propagate errors via `Promise.all` semantics.
 *
 * Tests use a manually-resolved promise-deferred pattern to keep the
 * concurrency assertion deterministic (no `setTimeout` flakiness).
 */

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("runWithConcurrency", () => {
  it("processes every item exactly once", async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("resolves immediately for an empty input", async () => {
    let called = false;
    await runWithConcurrency<number>([], 4, async () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  it("caps in-flight tasks at `concurrency`", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const gates = items.map(() => deferred());

    let inFlight = 0;
    let peak = 0;

    const pending = runWithConcurrency(items, 3, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await gates[i]!.promise;
      inFlight--;
    });

    // Allow the pool to spin up to its initial concurrency.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(peak).toBe(3);

    // Release each task one at a time; new tasks should immediately
    // pick up the freed slot, keeping `inFlight` at concurrency for
    // most of the run.
    for (const gate of gates) {
      gate.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    await pending;
    expect(peak).toBe(3);
  });

  it("does not exceed concurrency even when items.length < concurrency", async () => {
    const items = [1, 2];
    const seen: number[] = [];
    let peak = 0;
    let inFlight = 0;

    await runWithConcurrency(items, 8, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      seen.push(n);
      await new Promise<void>((resolve) => setImmediate(resolve));
      inFlight--;
    });

    expect(seen.sort()).toEqual([1, 2]);
    // 8 workers spun up but only 2 items; peak in-flight is 2.
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("treats concurrency<=0 as 1 (defensive)", async () => {
    // Schema-resolved options always pass a positive integer; the
    // floor exists so direct callers (tests, future helpers) can't
    // accidentally deadlock the pool.
    const items = [1, 2, 3];
    const seen: number[] = [];
    await runWithConcurrency(items, 0, async (n) => {
      seen.push(n);
    });
    expect(seen.sort()).toEqual([1, 2, 3]);
  });

  it("propagates the first worker error (Promise.all semantics)", async () => {
    const items = [1, 2, 3, 4];
    await expect(
      runWithConcurrency(items, 2, async (n) => {
        if (n === 2) throw new Error("boom on 2");
      }),
    ).rejects.toThrow(/boom on 2/);
  });
});
