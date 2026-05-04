import { describe, expect, it } from "vitest";
import {
  extractSegments,
  peekNoTranslate,
  selectTranslatableFrontmatter,
} from "../src/parsing/extract.js";
import { parseMarkdown } from "../src/parsing/parse.js";
import { computeSourceHash } from "../src/storage/hash.js";

const noFrontmatterRules = { sourcePath: "test.md", frontmatter: {} };

describe("extractSegments — body", () => {
  it("emits one segment per paragraph with stable body:<n> IDs", () => {
    const source = "First paragraph.\n\nSecond paragraph.\n";
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noFrontmatterRules, source);

    expect(segments).toEqual([
      { id: "body:0", text: "First paragraph." },
      { id: "body:1", text: "Second paragraph." },
    ]);
  });

  it("emits one segment per heading and counts it in the same body sequence", () => {
    const source = "# Title\n\nBody text.\n\n## Subtitle\n";
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noFrontmatterRules, source);

    expect(segments).toEqual([
      { id: "body:0", text: "Title" },
      { id: "body:1", text: "Body text." },
      { id: "body:2", text: "Subtitle" },
    ]);
  });

  it("preserves inline formatting markers (bold, italic, code) in segment text", () => {
    const source = "This is **bold** and _italic_ and `code`.\n";
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noFrontmatterRules, source);

    // The segment text is the source markdown of the block's inline
    // content — formatting markers preserved so a translation model can
    // mirror them in its output, and apply.ts splices them back at the
    // same byte range.
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({
      id: "body:0",
      text: "This is **bold** and _italic_ and `code`.",
    });
  });

  it("preserves link source (text and URL together) in segment text", () => {
    const source = "See [Smith 2020](https://example.com/smith) for details.\n";
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noFrontmatterRules, source);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe(
      "See [Smith 2020](https://example.com/smith) for details.",
    );
  });

  it("emits NO segments for code blocks (preserved verbatim)", () => {
    const source = [
      "Before.",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "After.",
      "",
    ].join("\n");
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noFrontmatterRules, source);

    expect(segments.map((s) => s.text)).toEqual(["Before.", "After."]);
  });

  it("recurses into list items and emits segments for their paragraphs", () => {
    const source = "- one\n- two\n- three\n";
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noFrontmatterRules, source);

    expect(segments).toEqual([
      { id: "body:0", text: "one" },
      { id: "body:1", text: "two" },
      { id: "body:2", text: "three" },
    ]);
  });

  it("emits one segment per table cell", () => {
    const source = ["| a | b |", "| - | - |", "| 1 | 2 |", ""].join("\n");
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noFrontmatterRules, source);

    expect(segments.map((s) => s.text)).toEqual(["a", "b", "1", "2"]);
  });
});

describe("extractSegments — frontmatter", () => {
  const docWithFrontmatter = [
    "---",
    'title: "Hello"',
    "year: 2025",
    "tags:",
    "  - alpha",
    "  - beta",
    'description: "A test doc."',
    "---",
    "",
    "Body.",
    "",
  ].join("\n");

  it("does not extract any frontmatter when no rule matches the source path", () => {
    const ast = parseMarkdown(docWithFrontmatter);
    const segments = extractSegments(
      ast,
      {
        sourcePath: "publications/foo.md",
        frontmatter: { "people/**": ["title"] },
      },
      docWithFrontmatter,
    );

    expect(segments.map((s) => s.id)).toEqual(["body:0"]);
  });

  it("extracts only the keys listed under matching globs, as fm:<key>", () => {
    const ast = parseMarkdown(docWithFrontmatter);
    const segments = extractSegments(
      ast,
      {
        sourcePath: "publications/foo.md",
        frontmatter: { "publications/**": ["title", "description"] },
      },
      docWithFrontmatter,
    );

    expect(segments).toEqual([
      { id: "body:0", text: "Body." },
      { id: "fm:title", text: "Hello" },
      { id: "fm:description", text: "A test doc." },
    ]);
  });

  it("expands string-arrays into fm:<key>[<i>] entries", () => {
    const ast = parseMarkdown(docWithFrontmatter);
    const segments = extractSegments(
      ast,
      {
        sourcePath: "publications/foo.md",
        frontmatter: { "publications/**": ["tags"] },
      },
      docWithFrontmatter,
    );

    expect(segments.filter((s) => s.id.startsWith("fm:"))).toEqual([
      { id: "fm:tags[0]", text: "alpha" },
      { id: "fm:tags[1]", text: "beta" },
    ]);
  });

  it("skips non-string scalars (numbers, dates) silently", () => {
    const ast = parseMarkdown(docWithFrontmatter);
    const segments = extractSegments(
      ast,
      {
        sourcePath: "publications/foo.md",
        frontmatter: { "publications/**": ["title", "year"] },
      },
      docWithFrontmatter,
    );

    // `year: 2025` is a number; only `title` makes it through.
    expect(segments.filter((s) => s.id.startsWith("fm:"))).toEqual([
      { id: "fm:title", text: "Hello" },
    ]);
  });

  it("unions keys across all matching globs in declaration order", () => {
    const ast = parseMarkdown(docWithFrontmatter);
    const segments = extractSegments(
      ast,
      {
        sourcePath: "publications/foo.md",
        frontmatter: {
          "**/*": ["description"],
          "publications/**": ["title"],
        },
      },
      docWithFrontmatter,
    );

    // Globs are iterated in the order they're declared in the rules
    // object; matching globs contribute their keys in that order. So
    // `**/*`'s `description` is collected before `publications/**`'s `title`.
    expect(
      segments.filter((s) => s.id.startsWith("fm:")).map((s) => s.id),
    ).toEqual(["fm:description", "fm:title"]);
  });
});

describe("selectTranslatableFrontmatter", () => {
  const docWithFrontmatter = [
    "---",
    'title: "Hello"',
    'metaDescription: "An overview."',
    "year: 2025",
    "tags:",
    "  - alpha",
    "  - beta",
    "---",
    "",
    "Body.",
    "",
  ].join("\n");

  it("returns an empty object when the source has no frontmatter", () => {
    const ast = parseMarkdown("# No frontmatter here\n");
    const result = selectTranslatableFrontmatter(ast, {
      sourcePath: "publications/x.md",
      frontmatter: { "publications/**": ["title"] },
    });
    expect(result).toEqual({});
  });

  it("returns an empty object when no glob matches the source path", () => {
    const ast = parseMarkdown(docWithFrontmatter);
    const result = selectTranslatableFrontmatter(ast, {
      sourcePath: "people/alice.md",
      frontmatter: { "publications/**": ["title", "metaDescription"] },
    });
    expect(result).toEqual({});
  });

  it("returns only the configured keys, even when other keys exist", () => {
    const ast = parseMarkdown(docWithFrontmatter);
    const result = selectTranslatableFrontmatter(ast, {
      sourcePath: "publications/foo.md",
      frontmatter: { "publications/**": ["metaDescription"] },
    });
    expect(result).toEqual({ metaDescription: "An overview." });
  });

  it("preserves the raw value type (numbers, arrays) so the hash sees changes", () => {
    const ast = parseMarkdown(docWithFrontmatter);
    const result = selectTranslatableFrontmatter(ast, {
      sourcePath: "publications/foo.md",
      frontmatter: { "publications/**": ["year", "tags"] },
    });
    expect(result).toEqual({ year: 2025, tags: ["alpha", "beta"] });
  });

  it("omits configured keys that are absent from actual frontmatter", () => {
    const ast = parseMarkdown(docWithFrontmatter);
    const result = selectTranslatableFrontmatter(ast, {
      sourcePath: "publications/foo.md",
      frontmatter: { "publications/**": ["metaDescription", "missing"] },
    });
    expect(result).toEqual({ metaDescription: "An overview." });
  });

  // End-to-end: the cache key reflects translatable-frontmatter
  // changes, so editing e.g. `metaDescription` busts the cache.
  it("changes the cache key when a translatable frontmatter value changes", () => {
    const before = parseMarkdown(docWithFrontmatter);
    const after = parseMarkdown(
      docWithFrontmatter.replace("An overview.", "An updated overview."),
    );

    const opts = {
      sourcePath: "publications/foo.md",
      frontmatter: { "publications/**": ["metaDescription"] },
    };
    const fmBefore = selectTranslatableFrontmatter(before, opts);
    const fmAfter = selectTranslatableFrontmatter(after, opts);

    const hashBefore = computeSourceHash({
      body: "Body.",
      frontmatter: fmBefore,
      glossaryHash: "g0",
      modelId: "m",
    });
    const hashAfter = computeSourceHash({
      body: "Body.",
      frontmatter: fmAfter,
      glossaryHash: "g0",
      modelId: "m",
    });

    expect(hashBefore).not.toBe(hashAfter);
  });

  it("does NOT change the cache key when a non-translatable frontmatter key changes", () => {
    const before = parseMarkdown(docWithFrontmatter);
    const after = parseMarkdown(
      docWithFrontmatter.replace("year: 2025", "year: 2026"),
    );

    const opts = {
      sourcePath: "publications/foo.md",
      // `year` is intentionally NOT in the rule list — translation
      // doesn't apply to it, so the cache should stay valid when only
      // `year` changes.
      frontmatter: { "publications/**": ["metaDescription"] },
    };
    const fmBefore = selectTranslatableFrontmatter(before, opts);
    const fmAfter = selectTranslatableFrontmatter(after, opts);

    const hashBefore = computeSourceHash({
      body: "Body.",
      frontmatter: fmBefore,
      glossaryHash: "g0",
      modelId: "m",
    });
    const hashAfter = computeSourceHash({
      body: "Body.",
      frontmatter: fmAfter,
      glossaryHash: "g0",
      modelId: "m",
    });

    expect(hashBefore).toBe(hashAfter);
  });
});

describe("peekNoTranslate", () => {
  it("returns false for a source with no frontmatter", () => {
    const ast = parseMarkdown("# No frontmatter\n\nBody.\n");
    expect(peekNoTranslate(ast)).toBe(false);
  });

  it("returns false for a source whose frontmatter doesn't set the key", () => {
    const ast = parseMarkdown('---\ntitle: "Hello"\n---\n\nBody.\n');
    expect(peekNoTranslate(ast)).toBe(false);
  });

  it("returns true for `noTranslate: true`", () => {
    const ast = parseMarkdown(
      '---\ntitle: "Hello"\nnoTranslate: true\n---\n\nBody.\n',
    );
    expect(peekNoTranslate(ast)).toBe(true);
  });

  it("returns false for `noTranslate: false`", () => {
    const ast = parseMarkdown(
      '---\ntitle: "Hello"\nnoTranslate: false\n---\n\nBody.\n',
    );
    expect(peekNoTranslate(ast)).toBe(false);
  });

  it('accepts the string alias `noTranslate: "true"`', () => {
    const ast = parseMarkdown(
      '---\ntitle: "Hello"\nnoTranslate: "true"\n---\n\nBody.\n',
    );
    expect(peekNoTranslate(ast)).toBe(true);
  });

  it("accepts the string alias `noTranslate: yes`", () => {
    const ast = parseMarkdown(
      '---\ntitle: "Hello"\nnoTranslate: "yes"\n---\n\nBody.\n',
    );
    expect(peekNoTranslate(ast)).toBe(true);
  });

  it("does NOT accept other YAML truthy aliases (avoids false positives on real strings)", () => {
    // `on` and `y` are YAML 1.1 truthy but commonly appear as real
    // string values; we limit acceptance to "true" / "yes" only.
    const astOn = parseMarkdown(
      '---\ntitle: "Hello"\nnoTranslate: "on"\n---\n\nBody.\n',
    );
    expect(peekNoTranslate(astOn)).toBe(false);
  });

  it("returns false for non-boolean truthy values (e.g. `noTranslate: 1`)", () => {
    const ast = parseMarkdown(
      '---\ntitle: "Hello"\nnoTranslate: 1\n---\n\nBody.\n',
    );
    expect(peekNoTranslate(ast)).toBe(false);
  });
});
