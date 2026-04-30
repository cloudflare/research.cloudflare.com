import { describe, expect, it } from "vitest";

import {
  deriveUrlPattern,
  generateShimSource,
} from "../src/routing/shim.js";

/**
 * Pure-helper tests for the route-shim layer.
 *
 * The shim generator is the contract surface between PolyStella's
 * config and the Astro compiler — once a build emits a malformed
 * shim, the failure mode is a confusing rollup/Astro parse error
 * far from the change. So we pin the exact shape here, including
 * whitespace-sensitive bits like the `---` fences and the trailing
 * newline (Astro's parser tolerates the absence but emitters benefit
 * from a stable shape that diffs cleanly across builds).
 */

describe("deriveUrlPattern", () => {
  it("strips src/pages/ prefix and .astro suffix from a flat dynamic page", () => {
    expect(deriveUrlPattern("src/pages/[slug].astro")).toEqual({
      pattern: "[slug]",
      isDynamic: true,
    });
  });

  it("preserves nested directory structure for dynamic pages", () => {
    expect(deriveUrlPattern("src/pages/people/[slug].astro")).toEqual({
      pattern: "people/[slug]",
      isDynamic: true,
    });
  });

  it("recognises rest params as dynamic", () => {
    expect(deriveUrlPattern("src/pages/blog/[...slug].astro")).toEqual({
      pattern: "blog/[...slug]",
      isDynamic: true,
    });
  });

  it("flags static pages with no params as non-dynamic", () => {
    expect(deriveUrlPattern("src/pages/about.astro")).toEqual({
      pattern: "about",
      isDynamic: false,
    });
  });

  it("collapses bare index.astro to the empty pattern (homepage)", () => {
    expect(deriveUrlPattern("src/pages/index.astro")).toEqual({
      pattern: "",
      isDynamic: false,
    });
  });

  it("collapses section indexes to their parent path", () => {
    expect(deriveUrlPattern("src/pages/people/index.astro")).toEqual({
      pattern: "people",
      isDynamic: false,
    });
  });

  it("normalises Windows-style backslash separators", () => {
    expect(deriveUrlPattern("src\\pages\\people\\[slug].astro")).toEqual({
      pattern: "people/[slug]",
      isDynamic: true,
    });
  });

  it("tolerates a leading slash on the input path", () => {
    expect(deriveUrlPattern("/src/pages/[slug].astro")).toEqual({
      pattern: "[slug]",
      isDynamic: true,
    });
  });
});

describe("generateShimSource", () => {
  const LOCALES = ["pt-BR", "ja-JP"];

  it("wraps the source's getStaticPaths for dynamic pages", () => {
    const source = generateShimSource({
      relativeImportPath: "../../src/pages/[slug].astro",
      isDynamic: true,
      locales: LOCALES,
    });
    // Imports both the default render and the source's getStaticPaths;
    // a missing import here would silently leave Astro unable to
    // enumerate paths and the build would emit zero localized routes.
    expect(source).toContain(
      `import SourcePage, { getStaticPaths as sourceGetStaticPaths } from "../../src/pages/[slug].astro"`,
    );
    // Locales are declared inside `getStaticPaths` (not at module
    // scope) because Astro lifts `getStaticPaths` into its own
    // module for static-path generation, and surrounding
    // module-level constants don't survive that lift. A failing
    // build with `LOCALES is not defined` is the symptom of
    // regressing this back to module scope.
    expect(source).toContain('const locales = ["pt-BR","ja-JP"];');
    expect(source).not.toMatch(/^const\s+locales\s*=/m);
    // Wrapper expands the source paths × locales.
    expect(source).toContain("await sourceGetStaticPaths()");
    expect(source).toContain("params: { ...sp.params, lang }");
    expect(source).toContain("<SourcePage />");
  });

  it("enumerates locales for static pages with no params", () => {
    const source = generateShimSource({
      relativeImportPath: "../../src/pages/about.astro",
      isDynamic: false,
      locales: LOCALES,
    });
    expect(source).toContain(
      `import SourcePage from "../../src/pages/about.astro"`,
    );
    // Static pages don't import sourceGetStaticPaths — that import
    // would fail when the source page has no such export, so its
    // absence is part of the contract.
    expect(source).not.toContain("sourceGetStaticPaths");
    expect(source).toContain('const locales = ["pt-BR","ja-JP"];');
    expect(source).toContain(
      "locales.map((lang) => ({ params: { lang } }))",
    );
    expect(source).toContain("<SourcePage />");
  });

  it("keeps the locales literal inside getStaticPaths in both templates", () => {
    // Regression test for the Astro static-path lift: any reference
    // from inside `getStaticPaths` to a name declared at module
    // scope of the .astro frontmatter throws `<NAME> is not defined`
    // at build time. Both templates must carry the literal inside
    // the function body, not above the `export` declaration.
    for (const isDynamic of [true, false] as const) {
      const source = generateShimSource({
        relativeImportPath: "../../src/pages/whatever.astro",
        isDynamic,
        locales: LOCALES,
      });
      const fnStart = source.indexOf("export");
      const fnEnd = source.indexOf("---", fnStart);
      const beforeFn = source.slice(0, fnStart);
      const inFn = source.slice(fnStart, fnEnd);
      expect(beforeFn).not.toMatch(/const\s+locales\s*=/);
      expect(inFn).toMatch(/const\s+locales\s*=\s*\[/);
    }
  });

  it("normalises Windows-style backslashes in the import path", () => {
    const source = generateShimSource({
      relativeImportPath: "..\\..\\src\\pages\\[slug].astro",
      isDynamic: true,
      locales: LOCALES,
    });
    expect(source).toContain('"../../src/pages/[slug].astro"');
    expect(source).not.toContain("\\");
  });

  it("emits a reproducible byte-stable shape across calls", () => {
    // Same input must produce the same output. Stability matters: a
    // shim regenerated with byte-identical content avoids spurious
    // Vite cache invalidation between builds.
    const args = {
      relativeImportPath: "../../src/pages/[slug].astro",
      isDynamic: true,
      locales: LOCALES,
    } as const;
    expect(generateShimSource(args)).toBe(generateShimSource(args));
  });

  it("ends in a trailing newline (POSIX file convention)", () => {
    const source = generateShimSource({
      relativeImportPath: "../../src/pages/about.astro",
      isDynamic: false,
      locales: LOCALES,
    });
    expect(source.endsWith("\n")).toBe(true);
  });
});
