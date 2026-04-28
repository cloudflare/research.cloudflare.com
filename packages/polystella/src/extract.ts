import type { Root, Yaml } from "mdast";
import picomatch from "picomatch";
import { parse as parseYaml } from "yaml";
import { inlineSpan, visitTranslatableBlocks } from "./traverse.js";

/**
 * A single translatable unit extracted from a source document.
 *
 * IDs are stable: re-running `extractSegments` on the same AST produces
 * the same IDs in the same order. The same IDs are used by `apply.ts`
 * to write translations back at matching positions.
 *
 * ID grammar:
 *   body:<n>            n-th translatable block in DFS order
 *   fm:<key>            frontmatter string value at top-level <key>
 *   fm:<key>[<i>]       i-th element of a top-level array of strings
 */
export interface Segment {
  id: string;
  text: string;
}

export interface ExtractOptions {
  /**
   * The source file's path relative to `sourceDir`. Used to match
   * against the `frontmatter` glob rules. Forward slashes regardless of
   * platform (the same convention `walk.ts` uses).
   */
  sourcePath: string;
  /**
   * Per-glob frontmatter rules. Each glob pattern (matched against
   * `sourcePath`) maps to a list of frontmatter keys to translate.
   * Keys not listed for any matching pattern are ignored.
   */
  frontmatter: Record<string, string[]>;
}

/**
 * Walk `ast` and produce a list of translatable segments. Pure function;
 * does not mutate the AST.
 *
 * Body segments contain the **source markdown** of the block's inline
 * content (formatting markers preserved): a paragraph that contains
 * `**bold**` in the source produces a segment whose text includes the
 * `**...**` markers verbatim. This is what we want to send to a
 * translation model — the model preserves the markers, and `apply.ts`
 * splices the translation back at the exact same byte range, keeping
 * the surrounding block markers (`#`, `> `, `- `) intact.
 *
 * Frontmatter segments contain the parsed YAML scalar value, NOT raw
 * YAML — there's no markdown formatting in frontmatter values.
 */
export function extractSegments(
  ast: Root,
  opts: ExtractOptions,
  source: string,
): Segment[] {
  const segments: Segment[] = [];

  visitTranslatableBlocks(ast, ({ block, id }) => {
    const span = inlineSpan(block);
    if (!span) return;
    const text = source.slice(span.start, span.end);
    if (text.length > 0) {
      segments.push({ id, text });
    }
  });

  const frontmatterNode = ast.children.find(
    (child): child is Yaml => child.type === "yaml",
  );
  if (frontmatterNode) {
    const keys = resolveFrontmatterKeys(opts.sourcePath, opts.frontmatter);
    if (keys.length > 0) {
      const data = parseYaml(frontmatterNode.value) as Record<string, unknown>;
      for (const key of keys) {
        const value = data[key];
        if (typeof value === "string") {
          segments.push({ id: `fm:${key}`, text: value });
        } else if (Array.isArray(value)) {
          value.forEach((item, i) => {
            if (typeof item === "string") {
              segments.push({ id: `fm:${key}[${i}]`, text: item });
            }
          });
        }
        // Numbers, dates, nested objects, mixed-type arrays: not translatable.
      }
    }
  }

  return segments;
}

/**
 * Resolve which frontmatter keys to translate for `sourcePath`, by
 * unioning the key lists of every matching glob in `rules`.
 */
function resolveFrontmatterKeys(
  sourcePath: string,
  rules: Record<string, string[]>,
): string[] {
  const matched = new Set<string>();
  for (const [pattern, keys] of Object.entries(rules)) {
    if (picomatch.isMatch(sourcePath, pattern)) {
      for (const key of keys) {
        matched.add(key);
      }
    }
  }
  return [...matched];
}
