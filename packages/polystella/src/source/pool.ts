/**
 * Tiny promise pool. `concurrency` workers pull from a shared cursor;
 * resolves once every item is processed. Rejects on the first worker
 * error (matching `Promise.all`'s short-circuit). `concurrency <= 0`
 * is coerced to 1 defensively (the schema already guarantees a
 * positive int).
 */
export async function runWithConcurrency<T>(
  items: ReadonlyArray<T>,
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  // Index-based dispatch keeps the hot path allocation-free.
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
