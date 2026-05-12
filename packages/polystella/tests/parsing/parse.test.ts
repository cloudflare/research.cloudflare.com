import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../src/parsing/parse.js";

describe("parseMarkdown", () => {
  it("produces an mdast Root with heading + paragraph for plain markdown", () => {
    const ast = parseMarkdown("# Hello\n\nworld\n");

    expect(ast.type).toBe("root");
    expect(ast.children).toHaveLength(2);

    const [heading, paragraph] = ast.children;
    if (heading === undefined || paragraph === undefined) throw new Error("expected two children");
    expect(heading.type).toBe("heading");
    if (heading.type === "heading") {
      expect(heading.depth).toBe(1);
      expect(heading.children[0]).toMatchObject({
        type: "text",
        value: "Hello",
      });
    }

    expect(paragraph.type).toBe("paragraph");
    if (paragraph.type === "paragraph") {
      expect(paragraph.children[0]).toMatchObject({
        type: "text",
        value: "world",
      });
    }
  });

  it("captures YAML frontmatter as a `yaml` node (not stripped, not a thematic break)", () => {
    const source = ["---", "title: Foo", "tags: [a, b]", "---", "", "# Body"].join("\n");
    const ast = parseMarkdown(source);

    expect(ast.children[0]).toMatchObject({
      type: "yaml",
      value: "title: Foo\ntags: [a, b]",
    });

    // Sanity: the heading after the frontmatter still parses as a heading.
    expect(ast.children[1]).toMatchObject({
      type: "heading",
      depth: 1,
    });
  });

  it("parses GFM tables as `table` nodes (not flattened to paragraphs)", () => {
    const source = ["| a | b |", "| - | - |", "| 1 | 2 |", ""].join("\n");
    const ast = parseMarkdown(source);

    expect(ast.children[0]?.type).toBe("table");
  });
});
