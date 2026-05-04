import type { Root } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * Markdown → mdast. Recognises YAML frontmatter as a first-class
 * node (so the applier can byte-replace it in place, not strip) and
 * GFM extensions (tables, autolinks, etc.). Versions pinned to
 * Astro's transitive ranges so pnpm dedupes to a single AST shape.
 *
 * Synchronous: no transformer plugins in the chain, so `.parse()`
 * suffices and we skip `.run()`.
 */

/** Re-usable processor exposed so callers can attach further plugins. */
export function createMarkdownProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm);
}

/** Pure: no I/O, no Astro coupling. */
export function parseMarkdown(source: string): Root {
  return createMarkdownProcessor().parse(source) as Root;
}
