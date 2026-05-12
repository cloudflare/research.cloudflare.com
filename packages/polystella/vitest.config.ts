import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests are tiny + pure; no need for jsdom/happy-dom.
    pool: "threads",
    poolOptions: {
      // Single thread is faster than multi-worker for our suite —
      // ~1.2s vs ~1.6s when measured locally. Per-worker startup
      // dominates parallelism gains at this scale (47 files,
      // ~970 tests, all finish in <500ms aggregate). Revisit when
      // the suite outgrows the per-worker overhead.
      threads: { singleThread: true },
    },
  },
});
