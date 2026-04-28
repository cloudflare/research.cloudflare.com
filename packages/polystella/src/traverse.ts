import type { Heading, Paragraph, Root, TableCell } from "mdast";

/**
 * AST traversal shared between `extract.ts` and `apply.ts`.
 *
 * Both files MUST iterate translatable blocks in the same order so that
 * the segment IDs they produce line up: the n-th block visited by extract
 * is the same n-th block visited by apply. We achieve that by funnelling
 * all traversal through `visitTranslatableBlocks` here.
 */

/**
 * Block-level node types that carry translatable inline text. One
 * segment is produced per occurrence.
 */
const TRANSLATABLE_BLOCK_TYPES = new Set(["paragraph", "heading", "tableCell"]);

/**
 * Container node types whose children may contain translatable blocks.
 * We descend into these without producing a segment for the container
 * itself (the container's *children* are what get translated).
 */
const RECURSE_INTO_TYPES = new Set([
  "root",
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
  "footnoteDefinition",
]);

export type TranslatableBlock = Paragraph | Heading | TableCell;

export interface BlockVisit {
  /** The AST node itself. Mutating `block.children` here mutates the AST. */
  block: TranslatableBlock;
  /** Stable segment ID, e.g. `body:0`, `body:1`. */
  id: string;
}

/**
 * Visit every translatable block in `ast` in DFS order, in a single pass.
 * Skips code blocks, HTML, thematic breaks, frontmatter, definitions,
 * and other non-translatable structures — they're left untouched.
 */
export function visitTranslatableBlocks(
  ast: Root,
  visitor: (visit: BlockVisit) => void,
): void {
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
 * Compute the byte-offset span of a block's inline content — i.e., the
 * range that covers the block's children, NOT the block itself.
 *
 * Why "inline" and not "block": for `# Title\n` the block's position
 * covers `0..7` (the whole line including the `#` prefix), but the
 * children's combined position covers only `2..7` (just `Title`). We
 * want the inline range so that:
 *
 *   - `extract.ts` reads `source.slice(span)` and gets just the
 *     translatable content (no `#`, no `>`, no `- `).
 *   - `apply.ts` splices the translation into the same `span`, so
 *     the heading marker / blockquote prefix / list marker outside
 *     the span survives untouched.
 *
 * This symmetry is what gives us the byte-perfect no-replacement
 * round-trip and the "preserve inline formatting in translations"
 * behaviour, without any post-processing.
 *
 * Returns `undefined` if the block has no children or if any of the
 * required offsets are missing — a defensive check; for blocks coming
 * out of `remark-parse` the offsets are always present.
 */
export function inlineSpan(
  block: TranslatableBlock,
): { start: number; end: number } | undefined {
  const children = block.children;
  if (!Array.isArray(children) || children.length === 0) return undefined;
  const first = children[0]!;
  const last = children[children.length - 1]!;
  const start = first.position?.start?.offset;
  const end = last.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return undefined;
  return { start, end };
}
