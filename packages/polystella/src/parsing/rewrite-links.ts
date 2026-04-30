import type { Link, Root } from "mdast";
import { parseMarkdown } from "./parse.js";

/**
 * Options controlling how internal markdown links are rewritten in
 * translated output.
 */
export interface RewriteInternalLinksOptions {
  /**
   * The locale segment to inject in front of internal links — e.g.
   * `"pt-BR"` produces `/pt-BR/some/path`. Caller's responsibility to
   * pass the locale of the file being staged, NOT the visitor's
   * locale (which doesn't exist at build time).
   */
  targetLocale: string;
  /**
   * The full set of locales the site declares (including the default
   * locale). Used purely to detect already-prefixed URLs so the
   * rewriter is idempotent — a link that already starts with
   * `/<knownLocale>/...` is left alone, which keeps a re-translation
   * pass from producing `/pt-BR/pt-BR/foo`.
   */
  locales: ReadonlyArray<string>;
}

/**
 * Rewrite internal markdown links inside `text` to be locale-prefixed.
 *
 * "Internal" means: any link whose URL is relative or starts with `/`,
 * AND doesn't already start with a known locale prefix, AND isn't an
 * external URL (`http://`, `https://`, protocol-relative `//`),
 * anchor (`#…`), `mailto:`, or `tel:` link.
 *
 * Implementation note — why we re-parse instead of walking the same
 * AST `applyTranslations` already has:
 *
 *   `applyTranslations` produces its output by byte-splicing
 *   translated text into the *block-level* inline ranges of the
 *   source AST. Link nodes live nested INSIDE those inline ranges, so
 *   their byte positions in the source overlap with the spliced
 *   regions — adding URL edits to the same edit list would mean the
 *   block edit clobbers the URL edit (or vice versa) depending on
 *   sort order, and there's no clean ordering that makes both stick.
 *
 *   By re-parsing the translation OUTPUT, we get fresh link
 *   positions that already account for the spliced content. The
 *   second pass is the only pass that needs to know about link
 *   nodes; `applyTranslations` stays oblivious.
 *
 * Implementation note — why we don't `remark-stringify` the rewritten
 * AST:
 *
 *   Same reason `applyTranslations` byte-splices instead of
 *   stringifying: `mdast-util-to-markdown` defensively escapes
 *   characters that round-trip ambiguously, which would change the
 *   output text in ways unrelated to link rewriting. Byte-editing the
 *   URL spans only is safe because the URL portion of an inline link
 *   has a deterministic byte position and no escaping concerns.
 *
 * Returns the rewritten markdown. If no links need rewriting, returns
 * `text` unchanged (same object reference).
 */
export function rewriteInternalLinks(
  text: string,
  options: RewriteInternalLinksOptions,
): string {
  const ast = parseMarkdown(text);
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  visitLinks(ast, (link) => {
    const span = nodeSpan(link);
    if (!span) return;
    const slice = text.slice(span.start, span.end);
    const urlSpan = findUrlSpanInInlineLink(slice);
    if (!urlSpan) return;
    const url = slice.slice(urlSpan.start, urlSpan.end);
    const newUrl = rewriteUrlIfInternal(url, options);
    if (newUrl === null) return;
    edits.push({
      start: span.start + urlSpan.start,
      end: span.start + urlSpan.end,
      replacement: newUrl,
    });
  });

  if (edits.length === 0) return text;

  edits.sort((a, b) => b.start - a.start);
  let output = text;
  for (const edit of edits) {
    output =
      output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  return output;
}

/**
 * Decide whether `url` should be rewritten and return the rewritten
 * form. Returns `null` when the URL is external, anchor-only, already
 * locale-prefixed, or otherwise out-of-scope.
 *
 * Exported for unit testing the URL classification rules without
 * needing a full markdown parse.
 */
export function rewriteUrlIfInternal(
  url: string,
  options: RewriteInternalLinksOptions,
): string | null {
  if (url.length === 0) return null;
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("//") ||
    url.startsWith("mailto:") ||
    url.startsWith("tel:") ||
    url.startsWith("#")
  ) {
    return null;
  }

  // Idempotency: leave already-locale-prefixed URLs alone. We check
  // against ALL declared locales (not just `targetLocale`) because a
  // re-build could otherwise turn `/pt-BR/foo` into
  // `/pt-BR/pt-BR/foo` if the rewriter ran on already-rewritten
  // cached content.
  for (const loc of options.locales) {
    if (url === `/${loc}` || url.startsWith(`/${loc}/`)) {
      return null;
    }
  }

  // Split off any fragment / query so the locale prefix lands on the
  // path, not on the suffix. e.g. `/foo#bar` → `/<locale>/foo#bar`.
  const suffixMatch = /[?#]/.exec(url);
  const path = suffixMatch ? url.slice(0, suffixMatch.index) : url;
  const suffix = suffixMatch ? url.slice(suffixMatch.index) : "";

  const trimmedPath = path.startsWith("/") ? path.slice(1) : path;
  return `/${options.targetLocale}/${trimmedPath}${suffix}`;
}

/**
 * Walk every `link` node in `ast` in DFS order. Skips `linkReference`
 * (reference-style links) and `image` nodes — those have different
 * syntactic shapes and the project's content doesn't use them.
 */
function visitLinks(ast: Root, visitor: (link: Link) => void): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(node: any): void {
    if (node.type === "link") {
      visitor(node as Link);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }
  walk(ast);
}

/**
 * Pull `start.offset` and `end.offset` out of an mdast node's
 * position. Returns `undefined` when either offset is missing —
 * shouldn't happen on `remark-parse` output but the type allows it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nodeSpan(node: any): { start: number; end: number } | undefined {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return undefined;
  return { start, end };
}

/**
 * Given the source slice covering a single inline link
 * (`[text](url)` or `[text](url "title")`), find the byte range of
 * the URL portion *relative to the slice's start*.
 *
 * Returns `undefined` if `slice` doesn't look like an inline link —
 * notably autolinks (`<https://...>`) and reference-style links
 * (`[text][ref]`), which don't carry an inline URL we'd want to
 * rewrite anyway.
 *
 * The matcher is deliberately narrow: it pairs the FIRST `]` with the
 * NEAREST following `(` and reads up to the next whitespace or `)`.
 * Markdown's inline-link grammar disallows unescaped `(`/`)` and
 * whitespace inside an unbracketed URL, which is what makes this
 * tractable with a small regex instead of a full URL parser.
 */
function findUrlSpanInInlineLink(
  slice: string,
): { start: number; end: number } | undefined {
  // Match `[text](url[ "title"])` capturing the URL group's position.
  // We can't use `^` here because mdast positions on links sometimes
  // include trailing whitespace (e.g. inside table cells); the
  // anchored variant occasionally misses real links. Greedy match on
  // the bracket pair handles nested brackets like `[[1]](/foo)`.
  const m = /\[(?:[^\]\\]|\\.)*\]\(([^\s)]+)/.exec(slice);
  if (!m) return undefined;
  const urlGroup = m[1];
  if (urlGroup === undefined) return undefined;
  const urlStart = m.index + m[0].length - urlGroup.length;
  return { start: urlStart, end: urlStart + urlGroup.length };
}
