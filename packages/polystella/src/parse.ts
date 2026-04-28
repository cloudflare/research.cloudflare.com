import type { Root } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * Markdown → mdast.
 *
 * The parser recognises:
 *   - YAML frontmatter as a first-class `yaml` AST node (so frontmatter
 *     values can be located, translated, and written back at the same
 *     position by M3.3 — they are NOT stripped).
 *   - GFM extensions: tables, strikethrough, task-list items, autolinks,
 *     and footnotes. The publications corpus uses tables and autolinks.
 *
 * Versions are pinned to the same caret ranges Astro brings transitively
 * (`unified ^11`, `remark-parse ^11`, `remark-gfm ^4`) so pnpm dedupes
 * to a single installed copy and the AST shape produced here is byte-
 * for-byte the shape Astro produces internally. `remark-frontmatter`
 * is a direct addition; Astro strips frontmatter via its own YAML
 * parser before invoking remark, so it doesn't bring this transitively.
 *
 * Synchronous: there are no transformer plugins in the chain, so we
 * call `.parse()` (lex + tree build) and skip `.run()` (transformer
 * traversal) entirely.
 */

/**
 * Build a fresh `unified` processor pre-loaded with PolyStella's
 * markdown plugin chain. Exposed so M3.3's applier can attach
 * `remark-stringify` to a processor that recognises the same syntax
 * extensions used at parse time.
 */
export function createMarkdownProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm);
}

/**
 * Parse a markdown source string into an mdast `Root`. Pure: no I/O,
 * no Astro coupling, no global state.
 */
export function parseMarkdown(source: string): Root {
  return createMarkdownProcessor().parse(source) as Root;
}
