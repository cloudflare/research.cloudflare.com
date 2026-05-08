import type { Heading, Paragraph, Root, TableCell } from "mdast";

/**
 * AST traversal shared between `extract.ts` and `apply.ts`. Both
 * MUST iterate translatable blocks in the same order so segment IDs
 * line up — funnelled through `visitTranslatableBlocks` here.
 */

/** Block-level nodes carrying translatable inline text. */
const TRANSLATABLE_BLOCK_TYPES = new Set(["paragraph", "heading", "tableCell"]);

/**
 * Containers we descend into without emitting a segment for the
 * container itself. Includes MDX block-level JSX components
 * (`mdxJsxFlowElement`) so prose written inside `<Section>`...
 * `</Section>` reaches the extractor — without this, MDX files would
 * treat component-wrapped content as opaque.
 *
 * `mdxJsxTextElement` is NOT here: it's an inline node, only ever
 * a child of paragraphs / headings / table cells. Inline nodes are
 * inside the byte-spliced inline span, so the byte-splicer handles
 * them transparently — recursing into them at the block level would
 * double-process.
 *
 * Other MDX node types intentionally absent (= ignored, byte-perfect
 * preserved):
 *   - `mdxjsEsm` — ESM imports/exports at the file root.
 *   - `mdxFlowExpression` — block-level `{...}` expressions.
 *   - `mdxTextExpression` — inline `{...}` (handled by inline span).
 */
const RECURSE_INTO_TYPES = new Set([
  "root",
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
  "footnoteDefinition",
  "mdxJsxFlowElement",
]);

export type TranslatableBlock = Paragraph | Heading | TableCell;

export interface BlockVisit {
  /** The AST node itself. Mutating `block.children` here mutates the AST. */
  block: TranslatableBlock;
  /** Stable segment ID, e.g. `body:0`, `body:1`. */
  id: string;
}

/**
 * Visit every translatable block in DFS order. Skips code, HTML,
 * thematic breaks, frontmatter, definitions — they're left untouched.
 */
export function visitTranslatableBlocks(ast: Root, visitor: (visit: BlockVisit) => void): void {
  let index = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(node: any): void {
    if (TRANSLATABLE_BLOCK_TYPES.has(node.type)) {
      visitor({ block: node as TranslatableBlock, id: `body:${index}` });
      index++;
      return;
    }
    if (RECURSE_INTO_TYPES.has(node.type) && Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
    // Anything else (code, html, thematicBreak, yaml, definition, …): ignored.
  }

  walk(ast);
}

/**
 * Byte-offset span of a block's CHILDREN (not the block itself).
 * For `# Title\n`, the block covers `0..7` but the children cover
 * `2..7` — the inline range. Reading and writing this range
 * preserves block markers (`#`, `> `, `- `) while letting the inline
 * content be replaced cleanly. The extract / apply symmetry on this
 * span is what gives us the byte-perfect round-trip.
 */
export function inlineSpan(block: TranslatableBlock): { start: number; end: number } | undefined {
  const children = block.children;
  if (!Array.isArray(children) || children.length === 0) return undefined;
  const first = children[0]!;
  const last = children[children.length - 1]!;
  const start = first.position?.start?.offset;
  const end = last.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return undefined;
  return { start, end };
}
