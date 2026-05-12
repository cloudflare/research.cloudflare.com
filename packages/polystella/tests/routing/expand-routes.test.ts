import { describe, expect, it } from "vitest";

import { expandRoutes, type RouteEntry } from "../src/routing/expand-routes.js";

/**
 * Pure tests for the route glob expander. Production callers feed
 * `availableFiles` from a real filesystem walk; tests pass fixtures
 * directly.
 */

const PAGES_FIXTURE = [
  "src/pages/404.astro",
  "src/pages/[slug].astro",
  "src/pages/index.astro",
  "src/pages/philosophy.astro",
  "src/pages/presentations.astro",
  "src/pages/people/[slug].astro",
  "src/pages/people/index.astro",
  "src/pages/focus/index.astro",
  "src/pages/focus/[slug].astro",
  "src/pages/_components/Card.astro",
  "src/pages/_layouts/Base.astro",
  "src/pages/blog/_helpers/slug.astro",
];

function r(source: string, imports: string[] = []): RouteEntry {
  return { source, imports };
}

describe("expandRoutes — literal paths", () => {
  it("passes literal paths through unchanged", () => {
    const result = expandRoutes([r("src/pages/index.astro"), r("src/pages/about.astro")], PAGES_FIXTURE);
    expect(result).toEqual([
      { source: "src/pages/index.astro", imports: [] },
      { source: "src/pages/about.astro", imports: [] },
    ]);
  });

  it("preserves the imports array on literal entries", () => {
    const result = expandRoutes([r("src/pages/index.astro", ["./src/styles/global.css", "./src/styles/home.css"])], PAGES_FIXTURE);
    expect(result).toEqual([{ source: "src/pages/index.astro", imports: ["./src/styles/global.css", "./src/styles/home.css"] }]);
  });

  it("does NOT auto-exclude `404.astro` when listed as a literal path", () => {
    // Explicit user intent overrides the auto-exclusion. Operators
    // who really want a `/<locale>/404` route can opt in.
    const result = expandRoutes([r("src/pages/404.astro")], PAGES_FIXTURE);
    expect(result).toEqual([{ source: "src/pages/404.astro", imports: [] }]);
  });
});

describe("expandRoutes — glob expansion", () => {
  it("expands a single-level wildcard against top-level files", () => {
    const result = expandRoutes([r("src/pages/*.astro")], PAGES_FIXTURE);
    // 404.astro is excluded; people/, focus/, _components/, etc. are
    // not at top level so they don't match.
    expect(result.map((e) => e.source)).toEqual([
      "src/pages/[slug].astro",
      "src/pages/index.astro",
      "src/pages/philosophy.astro",
      "src/pages/presentations.astro",
    ]);
  });

  it("expands a recursive globstar to every nested page", () => {
    const result = expandRoutes([r("src/pages/**/*.astro")], PAGES_FIXTURE);
    expect(result.map((e) => e.source)).toEqual([
      "src/pages/[slug].astro",
      "src/pages/index.astro",
      "src/pages/philosophy.astro",
      "src/pages/presentations.astro",
      "src/pages/people/[slug].astro",
      "src/pages/people/index.astro",
      "src/pages/focus/index.astro",
      "src/pages/focus/[slug].astro",
    ]);
  });

  it("excludes 404.astro at any depth from glob expansion", () => {
    // Add a nested 404 to the fixture for this test.
    const files = [...PAGES_FIXTURE, "src/pages/legal/404.astro"];
    const result = expandRoutes([r("src/pages/**/*.astro")], files);
    expect(result.map((e) => e.source)).not.toContain("src/pages/404.astro");
    expect(result.map((e) => e.source)).not.toContain("src/pages/legal/404.astro");
  });

  it("excludes any path with an underscore-prefixed segment", () => {
    const result = expandRoutes([r("src/pages/**/*.astro")], PAGES_FIXTURE);
    const sources = result.map((e) => e.source);
    expect(sources).not.toContain("src/pages/_components/Card.astro");
    expect(sources).not.toContain("src/pages/_layouts/Base.astro");
    // Nested under a deeper `_helpers` segment should also be excluded.
    expect(sources).not.toContain("src/pages/blog/_helpers/slug.astro");
  });

  it("propagates imports from glob entries to every expanded match", () => {
    const result = expandRoutes([r("src/pages/*.astro", ["./src/styles/global.css"])], PAGES_FIXTURE);
    for (const entry of result) {
      expect(entry.imports).toEqual(["./src/styles/global.css"]);
    }
  });

  it("returns no matches (and doesn't throw) for a glob that hits nothing", () => {
    const result = expandRoutes([r("src/pages/missing/**/*.astro")], PAGES_FIXTURE);
    expect(result).toEqual([]);
  });
});

describe("expandRoutes — mixed entries + dedup", () => {
  it("preserves order: literal paths and glob expansions in input sequence", () => {
    const result = expandRoutes(
      [r("src/pages/philosophy.astro"), r("src/pages/people/*.astro"), r("src/pages/index.astro")],
      PAGES_FIXTURE,
    );
    expect(result.map((e) => e.source)).toEqual([
      "src/pages/philosophy.astro",
      "src/pages/people/[slug].astro",
      "src/pages/people/index.astro",
      "src/pages/index.astro",
    ]);
  });

  it("dedupes by source — first occurrence wins", () => {
    // Glob covers `people/index.astro`; the literal entry afterward
    // is a no-op because the source is already in the output.
    const result = expandRoutes(
      [r("src/pages/people/*.astro", ["./a.css"]), r("src/pages/people/index.astro", ["./b.css"])],
      PAGES_FIXTURE,
    );
    const indexEntry = result.find((e) => e.source === "src/pages/people/index.astro");
    expect(indexEntry?.imports).toEqual(["./a.css"]);
    // No duplicate.
    const indexCount = result.filter((e) => e.source === "src/pages/people/index.astro").length;
    expect(indexCount).toBe(1);
  });

  it("a glob and a literal that don't overlap both contribute", () => {
    const result = expandRoutes([r("src/pages/people/*.astro"), r("src/pages/index.astro")], PAGES_FIXTURE);
    expect(result.map((e) => e.source)).toEqual(["src/pages/people/[slug].astro", "src/pages/people/index.astro", "src/pages/index.astro"]);
  });
});

describe("expandRoutes — empty inputs", () => {
  it("empty entries → empty result", () => {
    expect(expandRoutes([], PAGES_FIXTURE)).toEqual([]);
  });

  it("empty availableFiles → globs produce no matches; literals still pass through", () => {
    const result = expandRoutes([r("src/pages/index.astro"), r("src/pages/*.astro")], []);
    expect(result).toEqual([{ source: "src/pages/index.astro", imports: [] }]);
  });
});
