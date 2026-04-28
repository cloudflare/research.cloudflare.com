import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests are tiny + pure; no need for jsdom/happy-dom.
    pool: "threads",
    poolOptions: {
      threads: { singleThread: true },
    },
  },
});
