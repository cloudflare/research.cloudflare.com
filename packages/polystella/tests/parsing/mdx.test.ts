import { describe, expect, it } from "vitest";

import { markdownAdapter } from "../../src/parsing/adapters/markdown.js";
import { parseMarkdown, parseMdx } from "../../src/parsing/parse.js";

/**
 * MDX support tests.
 *
 * The markdown adapter dispatches by file extension: `.mdx` files
 * route through `parseMdx` (recognising imports/exports, JSX
 * components, and expression bindings as first-class AST nodes);
 * `.md` files (or no path hint) use the plain-markdown parser.
 *
 * Round-trip behaviour for `.mdx`:
 *   - Frontmatter: extracted and translatable as today.
 *   - Prose paragraphs / headings: extracted normally, including
 *     content nested inside JSX components.
 *   - `import` / `export` blocks: preserved byte-perfect, never
 *     extracted (they're code, not prose).
 *   - JSX components (`<Section>`, etc.): preserved byte-perfect.
 *   - Expression bindings (`{value}`): preserved byte-perfect.
 *
 * Pure-markdown features that DON'T survive in MDX (deliberate, by
 * remark-mdx's design): indented code blocks, autolinks
 * (`<https://...>`), and raw block-level HTML rewritten as JSX.
 * `.md` files keep these because they don't go through `parseMdx`.
 */

const SAMPLE_MDX = [
  "---",
  "title: Philosophy",
  "metaTitle: Philosophy",
  "---",
  "",
  'import Section from "@/components/Section.astro";',
  'import NarrowContent from "@/components/NarrowContent.astro";',
  "",
  "<Section>",
  "  <NarrowContent>",
  "",
  "First paragraph of prose.",
  "",
  "## A Hybrid Approach",
  "",
  "Second paragraph.",
  "",
  "  </NarrowContent>",
  "</Section>",
  "",
].join("\n");

const adapterOpts = {
  sourcePath: "pages/philosophy.mdx",
  translatableKeys: { "pages/**": ["title", "metaTitle"] as string[] },
};

describe("parseMarkdown vs parseMdx", () => {
  it("parseMarkdown does NOT recognise `import` as ESM (treats as paragraph text)", () => {
    const ast = parseMarkdown('import Foo from "./foo";\n');
    expect(ast.children[0]?.type).toBe("paragraph");
  });

  it("parseMdx recognises `import` as `mdxjsEsm`", () => {
    const ast = parseMdx('import Foo from "./foo";\n');
    expect(ast.children[0]?.type).toBe("mdxjsEsm");
  });

  it("parseMdx recognises a block-level JSX component as `mdxJsxFlowElement`", () => {
    const ast = parseMdx("<Foo>\n\nbody\n\n</Foo>\n");
    expect(ast.children[0]?.type).toBe("mdxJsxFlowElement");
  });

  it("parseMarkdown treats the same JSX component as raw HTML", () => {
    // CommonMark + GFM see `<Foo>...</Foo>` as raw block-level HTML.
    const ast = parseMarkdown("<Foo>\n\nbody\n\n</Foo>\n");
    expect(ast.children[0]?.type).toBe("html");
  });
});

describe("markdownAdapter — `.mdx` extension dispatch", () => {
  it("sourcePath ending in `.mdx` selects the MDX parser", () => {
    const parsed = markdownAdapter.parse(SAMPLE_MDX, "pages/philosophy.mdx");
    // First non-yaml child should be `mdxjsEsm` (the import block) —
    // proof that the MDX parser ran.
    const firstNonYaml = parsed.children.find((c) => c.type !== "yaml");
    expect(firstNonYaml?.type).toBe("mdxjsEsm");
  });

  it("sourcePath ending in `.md` selects the plain-markdown parser", () => {
    // Same source, parsed as `.md`: imports become a paragraph.
    const parsed = markdownAdapter.parse(SAMPLE_MDX, "pages/philosophy.md");
    const firstNonYaml = parsed.children.find((c) => c.type !== "yaml");
    expect(firstNonYaml?.type).toBe("paragraph");
  });

  it("omitted sourcePath defaults to plain-markdown parsing (backward compat)", () => {
    const parsed = markdownAdapter.parse(SAMPLE_MDX);
    const firstNonYaml = parsed.children.find((c) => c.type !== "yaml");
    expect(firstNonYaml?.type).toBe("paragraph");
  });

  it("case-insensitive extension match (`.MDX` works)", () => {
    const parsed = markdownAdapter.parse(SAMPLE_MDX, "Pages/Philosophy.MDX");
    const firstNonYaml = parsed.children.find((c) => c.type !== "yaml");
    expect(firstNonYaml?.type).toBe("mdxjsEsm");
  });
});

describe("markdownAdapter — MDX extraction", () => {
  it("does NOT extract import statements as translatable text", () => {
    const parsed = markdownAdapter.parse(SAMPLE_MDX, "pages/philosophy.mdx");
    const segments = markdownAdapter.extractSegments(parsed, SAMPLE_MDX, adapterOpts);
    const texts = segments.map((s) => s.text);
    // Sanity check: prose IS extracted.
    expect(texts).toContain("First paragraph of prose.");
    // No segment should resemble an import statement.
    for (const t of texts) {
      expect(t).not.toMatch(/^import /);
      expect(t).not.toMatch(/from ".*";/);
    }
  });

  it("recurses into block-level JSX components to extract their prose", () => {
    const parsed = markdownAdapter.parse(SAMPLE_MDX, "pages/philosophy.mdx");
    const segments = markdownAdapter.extractSegments(parsed, SAMPLE_MDX, adapterOpts);
    const texts = segments.map((s) => s.text);
    expect(texts).toContain("First paragraph of prose.");
    expect(texts).toContain("A Hybrid Approach");
    expect(texts).toContain("Second paragraph.");
  });

  it("recurses through nested JSX components (e.g. `<Section><NarrowContent>...`)", () => {
    // Sanity that two levels of JSX nesting work — both Section and
    // NarrowContent need to be recursed into for the inner prose to
    // surface.
    const nested = ["<Outer>", "<Inner>", "", "Inside two layers.", "", "</Inner>", "</Outer>", ""].join("\n");
    const parsed = markdownAdapter.parse(nested, "pages/test.mdx");
    const segments = markdownAdapter.extractSegments(parsed, nested, adapterOpts);
    expect(segments.map((s) => s.text)).toContain("Inside two layers.");
  });

  it("extracts frontmatter `title` / `metaTitle` as fm:* segments", () => {
    const parsed = markdownAdapter.parse(SAMPLE_MDX, "pages/philosophy.mdx");
    const segments = markdownAdapter.extractSegments(parsed, SAMPLE_MDX, adapterOpts);
    const fmSegs = segments.filter((s) => s.id.startsWith("fm:"));
    expect(fmSegs.map((s) => `${s.id}=${s.text}`).sort()).toEqual(["fm:metaTitle=Philosophy", "fm:title=Philosophy"]);
  });

  it("ignores expression bindings (`{value}`) at block level", () => {
    const withExpr = ["{someValue}", "", "Real prose here.", ""].join("\n");
    const parsed = markdownAdapter.parse(withExpr, "pages/test.mdx");
    const segments = markdownAdapter.extractSegments(parsed, withExpr, adapterOpts);
    const texts = segments.map((s) => s.text);
    expect(texts).toContain("Real prose here.");
    expect(texts).not.toContain("{someValue}");
    expect(texts).not.toContain("someValue");
  });
});

describe("markdownAdapter — MDX round-trip", () => {
  it("byte-perfectly preserves imports, components, and indentation; replaces only prose spans", () => {
    const parsed = markdownAdapter.parse(SAMPLE_MDX, "pages/philosophy.mdx");
    const segments = markdownAdapter.extractSegments(parsed, SAMPLE_MDX, adapterOpts);
    const translations = new Map(segments.map((s) => [s.id, `TR:${s.text}`]));
    const out = markdownAdapter.applyTranslations(parsed, SAMPLE_MDX, translations, {});

    // Imports preserved exactly.
    expect(out).toContain('import Section from "@/components/Section.astro";');
    expect(out).toContain('import NarrowContent from "@/components/NarrowContent.astro";');
    // Components preserved exactly.
    expect(out).toContain("<Section>");
    expect(out).toContain("</Section>");
    expect(out).toContain("  <NarrowContent>");
    expect(out).toContain("  </NarrowContent>");
    // Prose translated.
    expect(out).toContain("TR:First paragraph of prose.");
    expect(out).toContain("## TR:A Hybrid Approach");
    expect(out).toContain("TR:Second paragraph.");
    // Frontmatter translated.
    expect(out).toContain("title: TR:Philosophy");
    expect(out).toContain("metaTitle: TR:Philosophy");
  });

  it("empty translations map → bytes unchanged (round-trip identity)", () => {
    const parsed = markdownAdapter.parse(SAMPLE_MDX, "pages/philosophy.mdx");
    const out = markdownAdapter.applyTranslations(parsed, SAMPLE_MDX, new Map(), {});
    expect(out).toBe(SAMPLE_MDX);
  });

  it("merges top-level additions into MDX frontmatter without breaking imports", () => {
    const parsed = markdownAdapter.parse(SAMPLE_MDX, "pages/philosophy.mdx");
    const out = markdownAdapter.applyTranslations(parsed, SAMPLE_MDX, new Map(), {
      topLevelAdditions: { aiTranslated: true, aiTranslationModel: "test/m1" },
    });
    expect(out).toContain("aiTranslated: true");
    expect(out).toContain("aiTranslationModel: test/m1");
    // Imports still present and unmodified.
    expect(out).toContain('import Section from "@/components/Section.astro";');
  });
});

describe("plain-markdown features still work for `.md` files", () => {
  // Regression: adding remark-mdx to the pipeline disabled some
  // markdown features (indented code, autolinks, raw HTML at block
  // level). Routing by extension means `.md` files keep the old
  // behaviour.

  it("`.md` parses indented code as a code block (not as paragraph text)", () => {
    const indented = "Plain paragraph.\n\n    code line 1\n    code line 2\n";
    const parsed = markdownAdapter.parse(indented, "test.md");
    // Walk children: should find a `code` node.
    const types = parsed.children.map((c) => c.type);
    expect(types).toContain("code");
  });

  it("`.md` parses autolinks (`<https://example.com>`) without throwing", () => {
    // The MDX parser throws on autolink syntax (sees `<` as JSX-start).
    // The plain markdown parser accepts it.
    const auto = "See <https://example.com> for details.\n";
    expect(() => markdownAdapter.parse(auto, "test.md")).not.toThrow();
  });

  it("`.md` parses block-level raw HTML as `html` nodes (not `mdxJsxFlowElement`)", () => {
    const html = "<aside>\n\nInside aside.\n\n</aside>\n";
    const parsed = markdownAdapter.parse(html, "test.md");
    const types = parsed.children.map((c) => c.type);
    expect(types).toContain("html");
    expect(types).not.toContain("mdxJsxFlowElement");
  });
});
