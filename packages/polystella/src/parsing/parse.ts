import type { Root } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * Markdown / MDX → mdast. Two parser paths:
 *
 *   - `parseMarkdown(source)` — pure markdown (CommonMark + GFM +
 *     YAML frontmatter). Supports raw HTML at block level (parsed
 *     as `html` nodes), autolinks (`<https://...>`), and indented
 *     code blocks. Used for `.md` files.
 *
 *   - `parseMdx(source)` — markdown + MDX-specific syntax: ESM
 *     imports/exports (`mdxjsEsm`), block JSX (`mdxJsxFlowElement`),
 *     inline JSX (`mdxJsxTextElement`), and expression bindings
 *     (`mdxFlowExpression`, `mdxTextExpression`). Used for `.mdx`
 *     files.
 *
 * **Why split the parsers.** `remark-mdx` is intentionally stricter
 * than CommonMark — it disables indented code blocks (because four-
 * space indentation conflicts with JSX indentation), autolinks
 * (because `<...>` parses as JSX), and rewrites raw HTML at block
 * level into `mdxJsxFlowElement` nodes. Applying it uniformly to
 * `.md` files would silently change parsing behaviour for input the
 * operator never expected to be MDX. Routing by file extension (in
 * the markdown adapter) keeps each format's parsing rules
 * unsurprising.
 *
 * Synchronous: no transformer plugins in the chain, so `.parse()`
 * suffices and we skip `.run()`.
 */

/** Re-usable plain-markdown processor. */
export function createMarkdownProcessor() {
  return unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).use(remarkGfm);
}

/** Re-usable MDX processor (markdown + JSX + ESM + expressions). */
export function createMdxProcessor() {
  return createMarkdownProcessor().use(remarkMdx);
}

/** Pure: no I/O, no Astro coupling. */
export function parseMarkdown(source: string): Root {
  return createMarkdownProcessor().parse(source) as Root;
}

/**
 * Parse MDX source. Accepts everything `parseMarkdown` does, plus
 * MDX-specific syntax. Loses indented code, autolinks, and raw-HTML
 * blocks (the latter become JSX elements).
 */
export function parseMdx(source: string): Root {
  return createMdxProcessor().parse(source) as Root;
}
