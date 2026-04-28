import type { Paragraph } from "mdast";
import { describe, expect, it } from "vitest";
import { applyTranslations } from "./apply.js";
import { extractSegments } from "./extract.js";
import { parseMarkdown } from "./parse.js";

describe("applyTranslations", () => {
  it("with an empty map, returns the source byte-for-byte (no allocation)", () => {
    const source = "First paragraph.\n\nSecond paragraph.\n";
    const ast = parseMarkdown(source);
    const output = applyTranslations(ast, new Map(), source);

    // Position-based splicing means an empty translations map is a no-op
    // and we return the source string itself. The corpus round-trip test
    // exercises this on every publication.
    expect(output).toBe(source);
  });

  it("replaces a body segment when a translation is provided for its ID", () => {
    const source = "Hello world.\n\nAnother paragraph.\n";
    const ast = parseMarkdown(source);
    const output = applyTranslations(
      ast,
      new Map([["body:0", "Olá mundo."]]),
      source,
    );

    expect(output).toContain("Olá mundo.");
    expect(output).not.toContain("Hello world.");
    expect(output).toContain("Another paragraph.");
  });

  it("leaves untranslated segments untouched (partial translation works)", () => {
    const source = "# Title\n\nBody.\n";
    const ast = parseMarkdown(source);
    const output = applyTranslations(
      ast,
      new Map([["body:1", "Corpo."]]),
      source,
    );

    expect(output).toContain("Title");
    expect(output).toContain("Corpo.");
    expect(output).not.toContain("Body.");
  });

  it("rewrites top-level frontmatter string values", () => {
    const source = [
      "---",
      'title: "Hello"',
      'description: "A doc."',
      "---",
      "",
      "Body.",
      "",
    ].join("\n");
    const ast = parseMarkdown(source);
    const output = applyTranslations(
      ast,
      new Map([["fm:title", "Olá"]]),
      source,
    );

    expect(output).toMatch(/title:\s*Olá/);
    expect(output).toMatch(/description:\s*A doc\./);
  });

  it("rewrites a single element of a frontmatter string-array", () => {
    const source = [
      "---",
      "tags:",
      "  - alpha",
      "  - beta",
      "  - gamma",
      "---",
      "",
      "Body.",
      "",
    ].join("\n");
    const ast = parseMarkdown(source);
    const output = applyTranslations(
      ast,
      new Map([["fm:tags[1]", "BETA"]]),
      source,
    );

    expect(output).toContain("alpha");
    expect(output).toContain("BETA");
    expect(output).not.toMatch(/-\s+beta/);
    expect(output).toContain("gamma");
  });

  it("ignores translations for IDs that don't exist", () => {
    const source = "Just a paragraph.\n";
    const ast = parseMarkdown(source);
    const output = applyTranslations(
      ast,
      new Map([
        ["body:99", "way out of range"],
        ["fm:nonexistent", "ignored"],
      ]),
      source,
    );

    expect(output).toBe(source);
  });
});

describe("applyTranslations — end-to-end with formatted translations", () => {
  // These tests prove the inline-formatting story: a translation
  // containing markdown markers (bold, italic, code, links) splices in
  // cleanly, AND when the output is re-parsed the AST contains real
  // formatting nodes (Strong, Emphasis, InlineCode, Link) — not escaped
  // literal text. This is what real translation calls will rely on.

  const noOpts = { sourcePath: "test.md", frontmatter: {} };

  it("preserves a bold marker from the translation in the re-parsed AST", () => {
    const source = "This paper introduces a new algorithm.\n";
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noOpts, source);

    const output = applyTranslations(
      ast,
      new Map([
        [segments[0]!.id, "Este artigo apresenta um **novo** algoritmo."],
      ]),
      source,
    );

    expect(output).toContain("**novo**");

    // Re-parse and confirm `**novo**` became a `strong` node, not
    // escaped literal text like `\*\*novo\*\*`.
    const reparsed = parseMarkdown(output);
    const paragraph = reparsed.children[0] as Paragraph;
    expect(paragraph.type).toBe("paragraph");

    const hasStrong = paragraph.children.some((c) => c.type === "strong");
    expect(hasStrong).toBe(true);
  });

  it("preserves italic, inline code, and links from the translation", () => {
    const source = "Hello world.\n";
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noOpts, source);

    const output = applyTranslations(
      ast,
      new Map([
        [
          segments[0]!.id,
          "_Itálico_ e `código` e [link](https://example.com).",
        ],
      ]),
      source,
    );

    const reparsed = parseMarkdown(output);
    const paragraph = reparsed.children[0] as Paragraph;
    const childTypes = paragraph.children.map((c) => c.type);

    expect(childTypes).toContain("emphasis");
    expect(childTypes).toContain("inlineCode");
    expect(childTypes).toContain("link");
  });

  it("a translation that itself contains formatting round-trips through extract → apply → parse", () => {
    // Realistic case: a model returns a translation that mirrors the
    // source's own formatting.
    const source = "We use **VOPRFs** to construct _verifiable_ tokens.\n";
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noOpts, source);

    expect(segments[0]!.text).toBe(
      "We use **VOPRFs** to construct _verifiable_ tokens.",
    );

    const translation =
      "Usamos **VOPRFs** para construir tokens _verificáveis_.";
    const output = applyTranslations(
      ast,
      new Map([[segments[0]!.id, translation]]),
      source,
    );

    const reparsed = parseMarkdown(output);
    const paragraph = reparsed.children[0] as Paragraph;
    const strongChildren = paragraph.children.filter(
      (c) => c.type === "strong",
    );
    const emphasisChildren = paragraph.children.filter(
      (c) => c.type === "emphasis",
    );

    expect(strongChildren).toHaveLength(1);
    expect(emphasisChildren).toHaveLength(1);
  });

  it("preserves the heading marker outside the inline span", () => {
    // The block prefix (`# `) must stay; only the heading TEXT is
    // replaced. This is what `inlineSpan` buys us.
    const source = "# Original Title\n\nBody.\n";
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noOpts, source);

    // First body segment should be the heading text.
    expect(segments[0]).toEqual({ id: "body:0", text: "Original Title" });

    const output = applyTranslations(
      ast,
      new Map([["body:0", "Translated Title"]]),
      source,
    );

    expect(output).toContain("# Translated Title\n");
    expect(output).toContain("\nBody.\n");
    expect(output).not.toContain("# Original Title");
  });

  it("preserves the list marker outside the inline span", () => {
    const source = "- first item\n- second item\n";
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noOpts, source);

    const output = applyTranslations(
      ast,
      new Map([["body:0", "primeiro item"]]),
      source,
    );

    expect(output).toBe("- primeiro item\n- second item\n");
  });
});
