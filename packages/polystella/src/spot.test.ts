import { describe, expect, it } from "vitest";
import { applyTranslations } from "./apply.js";
import { extractSegments } from "./extract.js";
import { parseMarkdown } from "./parse.js";

/**
 * Property-style spot tests for invariants that the publications-corpus
 * round-trip may not exercise heavily on its own: code blocks not
 * extracted, link URLs not exposed as separate translation units, HTML
 * blocks preserved verbatim, frontmatter keys outside the rule map
 * left untouched.
 *
 * Each test asserts a single contract; the names spell out the property
 * being checked so a future regression points straight at the broken
 * invariant.
 */

const noOpts = { sourcePath: "spot.md", frontmatter: {} };

describe("spot tests — code blocks", () => {
  it("never produces a segment for a fenced code block", () => {
    const source = [
      "Before the code.",
      "",
      "```ts",
      "const x: number = 42;",
      "function greet() { return 'hello'; }",
      "```",
      "",
      "After the code.",
      "",
    ].join("\n");
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noOpts, source);

    // The two surrounding paragraphs are translatable; the code block
    // contributes nothing — neither its body nor its info string.
    expect(segments).toEqual([
      { id: "body:0", text: "Before the code." },
      { id: "body:1", text: "After the code." },
    ]);
  });

  it("never produces a segment for an indented code block", () => {
    const source = [
      "Plain paragraph.",
      "",
      "    indented code line 1",
      "    indented code line 2",
      "",
      "Another plain paragraph.",
      "",
    ].join("\n");
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noOpts, source);

    expect(segments.map((s) => s.text)).toEqual([
      "Plain paragraph.",
      "Another plain paragraph.",
    ]);
  });

  it("preserves a fenced code block byte-for-byte through the round-trip", () => {
    const source = [
      "Lead-in.",
      "",
      "```python",
      "def greet(name: str) -> str:",
      "    return f'Hello, {name}!'",
      "```",
      "",
      "Trailing paragraph.",
      "",
    ].join("\n");
    const ast = parseMarkdown(source);
    const output = applyTranslations(ast, new Map(), source);

    // Same source bytes back. The code block, the language tag (`python`),
    // and the indentation inside the function body are all preserved.
    expect(output).toBe(source);
  });

  it("never extracts inline-code content (only the surrounding paragraph)", () => {
    const source = "Use the `fetch()` function for HTTP requests.\n";
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noOpts, source);

    // One segment for the paragraph; inline code stays in the segment
    // text as-is (with the backticks). It is not separately extracted.
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe(
      "Use the `fetch()` function for HTTP requests.",
    );
  });
});

describe("spot tests — link URLs", () => {
  it("does not produce a separate segment for a link URL", () => {
    const source =
      "Read [the paper](https://example.com/paper.pdf) for details.\n";
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noOpts, source);

    // Exactly one segment (the paragraph). The URL is part of the
    // paragraph's source markdown, not a standalone translatable unit.
    expect(segments).toHaveLength(1);
    expect(segments[0]!.id).toBe("body:0");
    // The URL appears literally inside the segment text (it's part of
    // the markdown the model will see).
    expect(segments[0]!.text).toContain("https://example.com/paper.pdf");
  });

  it("preserves the link URL when only the surrounding paragraph is translated", () => {
    const source =
      "Read [the paper](https://example.com/paper.pdf) for details.\n";
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noOpts, source);

    // A model-style translation that keeps the URL intact (real models
    // are instructed to preserve markdown formatting and URLs).
    const translation =
      "Leia [o artigo](https://example.com/paper.pdf) para detalhes.";
    const output = applyTranslations(
      ast,
      new Map([[segments[0]!.id, translation]]),
      source,
    );

    // The new link text is in place; the URL survived; everything
    // outside the inline span is unchanged.
    expect(output).toBe(
      "Leia [o artigo](https://example.com/paper.pdf) para detalhes.\n",
    );
  });

  it("re-parses a translated paragraph's link as a real Link node with the same URL", () => {
    const source = "See [Smith 2020](https://example.com/smith) for context.\n";
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noOpts, source);

    const output = applyTranslations(
      ast,
      new Map([
        [
          segments[0]!.id,
          "Veja [Smith 2020](https://example.com/smith) para contexto.",
        ],
      ]),
      source,
    );

    const reparsed = parseMarkdown(output);
    const paragraph = reparsed.children[0]!;
    if (paragraph.type !== "paragraph") {
      throw new Error("expected first child to be a paragraph");
    }
    const link = paragraph.children.find((c) => c.type === "link");
    if (!link || link.type !== "link") {
      throw new Error("expected the translated paragraph to contain a link");
    }
    expect(link.url).toBe("https://example.com/smith");
  });
});

describe("spot tests — HTML blocks", () => {
  it("does not produce a segment for a top-level HTML block", () => {
    const source = [
      "Paragraph above.",
      "",
      '<div class="callout">',
      "  <p>Untranslated HTML content.</p>",
      "</div>",
      "",
      "Paragraph below.",
      "",
    ].join("\n");
    const ast = parseMarkdown(source);
    const segments = extractSegments(ast, noOpts, source);

    // Only the surrounding paragraphs become segments; the HTML block
    // is preserved verbatim, never sent to the translator.
    expect(segments.map((s) => s.text)).toEqual([
      "Paragraph above.",
      "Paragraph below.",
    ]);
  });

  it("preserves a top-level HTML block byte-for-byte through the round-trip", () => {
    const source = [
      "Lead-in paragraph.",
      "",
      '<figure class="diagram">',
      '  <img src="/foo.png" alt="Architecture" />',
      "  <figcaption>Figure 1.</figcaption>",
      "</figure>",
      "",
      "Trailing paragraph.",
      "",
    ].join("\n");
    const ast = parseMarkdown(source);
    const output = applyTranslations(ast, new Map(), source);

    // Indentation, attribute quoting style, and the self-closing slash
    // on `<img />` all round-trip exactly.
    expect(output).toBe(source);
  });
});

describe("spot tests — frontmatter keys outside the rule map", () => {
  const docWithRichFrontmatter = [
    "---",
    'title: "Original Title"',
    "year: 2025",
    "authors:",
    "  - alice-smith",
    "  - bob-jones",
    "doi: 10.1234/example.5678",
    'metaDescription: "Original meta."',
    "---",
    "",
    "Body.",
    "",
  ].join("\n");

  it("never extracts frontmatter keys that aren't listed for any matching glob", () => {
    const ast = parseMarkdown(docWithRichFrontmatter);
    const segments = extractSegments(
      ast,
      {
        sourcePath: "publications/foo.md",
        frontmatter: { "publications/**": ["title"] },
      },
      docWithRichFrontmatter,
    );

    const fmIds = segments
      .filter((s) => s.id.startsWith("fm:"))
      .map((s) => s.id);
    expect(fmIds).toEqual(["fm:title"]);
    // year, authors, doi, metaDescription all silently skipped.
  });

  it("preserves the entire frontmatter block byte-for-byte when no fm:* translations are applied", () => {
    const ast = parseMarkdown(docWithRichFrontmatter);
    // Even WITH a body translation in the map, frontmatter is untouched
    // because the apply branch only mutates frontmatter when there's
    // at least one fm:* entry.
    const output = applyTranslations(
      ast,
      new Map([["body:0", "Translated body."]]),
      docWithRichFrontmatter,
    );

    // Find the frontmatter block in both source and output and assert
    // they're byte-identical. (The body has changed, but frontmatter
    // is unaffected.)
    const fmRegex = /^---\n([\s\S]*?)\n---/;
    const sourceFm = fmRegex.exec(docWithRichFrontmatter)?.[1];
    const outputFm = fmRegex.exec(output)?.[1];
    expect(outputFm).toBe(sourceFm);
  });

  it("when ONE frontmatter key is translated, the OTHER keys still round-trip with the same values", () => {
    const ast = parseMarkdown(docWithRichFrontmatter);
    const output = applyTranslations(
      ast,
      new Map([["fm:title", "Título Traduzido"]]),
      docWithRichFrontmatter,
    );

    // Re-parse the output's frontmatter and check non-translated keys
    // still hold their original values. (The YAML formatting of the
    // block may differ — comments, key ordering, quoting style are NOT
    // guaranteed to round-trip when fm:* translations are applied; this
    // is documented in apply.ts. But the *values* of every key must
    // survive.)
    const fmMatch = /^---\n([\s\S]*?)\n---/.exec(output);
    if (!fmMatch) throw new Error("expected output to have frontmatter");
    const fmText = fmMatch[1]!;

    expect(fmText).toMatch(/year:\s*2025/);
    expect(fmText).toMatch(/alice-smith/);
    expect(fmText).toMatch(/bob-jones/);
    expect(fmText).toMatch(/doi:\s*10\.1234\/example\.5678/);
    expect(fmText).toMatch(/metaDescription:\s*['"]?Original meta\.['"]?/);
    expect(fmText).toMatch(/title:\s*Título Traduzido/);
  });
});
