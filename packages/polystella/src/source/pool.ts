/**
 * Tiny promise-pool utility for the per-source build-hook loop.
 *
 * The build hook iterates `sources × locales` and, in live mode, calls
 * the AI provider for cache misses. Sequential iteration is the safe
 * smoke-test default — it caps provider concurrency at 1 and produces
 * a deterministic build log. In steady state (every locale × source
 * is a cache hit), sequential is also the slowest path because it
 * serialises N R2 round-trips that would each take longer than the
 * compute between them.
 *
 * `runWithConcurrency` keeps `concurrency` workers pulling from a
 * shared queue and resolves once every item has been processed. The
 * per-source counters and pair-tracking state in the build hook are
 * single-threaded JS-object mutations, so concurrent tasks racing to
 * `counts.hit++` or `touchedPairs.add(...)` is safe at the language
 * level — the order of increment doesn't matter, only the final
 * count, and nothing reads these mid-run.
 *
 * No external dep (we deliberately don't pull `p-limit` or `p-queue`
 * for ~10 lines of glue).
 */

/**
 * Run `worker` over each item in `items`, with at most `concurrency`
 * tasks in flight at any time. Resolves when every item has been
 * processed; rejects on the first error a worker throws (subsequent
 * pending items are abandoned, matching `Promise.all`'s short-circuit).
 *
 * `concurrency <= 0` is coerced to 1 — the safe default — rather than
 * thrown, because the resolved-options schema already guarantees a
 * positive integer; this guard is purely defensive against tests or
 * direct callers that bypass the schema.
 */
export async function runWithConcurrency<T>(
  items: ReadonlyArray<T>,
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  // Each runner pulls items off the shared cursor. Splitting the work
  // by index (rather than copying the array into a queue) keeps the
  // hot path allocation-free — important for builds with thousands of
  // sources where the `sources` list itself can be sizeable.
  async function runner(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      await worker(items[i] as T);
    }
  }

  await Promise.all(
    Array.from({ length: safeConcurrency }, () => runner()),
  );
}
