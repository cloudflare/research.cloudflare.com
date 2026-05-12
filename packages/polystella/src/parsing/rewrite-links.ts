import type { Link, Root } from "mdast";
import picomatch from "picomatch";
import { parseMarkdown } from "./parse.js";

/**
 * Per-array cache of compiled picomatch matchers. `noPrefixUrls`
 * shares a reference across all link rewrites in a build, so the
 * WeakMap eliminates per-link regex compilation.
 */
const matcherCache = new WeakMap<ReadonlyArray<string>, (path: string) => boolean>();

function getNoPrefixMatcher(patterns: ReadonlyArray<string>): (path: string) => boolean {
  const cached = matcherCache.get(patterns);
  if (cached !== undefined) return cached;
  const matcher = picomatch(patterns as string[]);
  matcherCache.set(patterns, matcher);
  return matcher;
}

export interface RewriteInternalLinksOptions {
  /** Locale to prefix toward; the locale of the file being staged. */
  targetLocale: string;
  /** Full locale set INCLUDING the default; used for idempotency. */
  locales: ReadonlyArray<string>;
  /**
   * Picomatch globs against the URL path (after splitting query /
   * fragment). When a URL's path matches any glob, the rewriter
   * leaves it unchanged — useful for declaring single-locale
   * internal pages that shouldn't be prefixed.
   *
   * External URLs (`http://`, `https://`, `mailto:`, etc.) and
   * anchor-only URLs already bail out before this list is consulted,
   * so it has no effect on those.
   */
  noPrefixUrls?: ReadonlyArray<string>;
}

/**
 * Locale-prefix internal markdown links in `text`.
 *
 * Re-parses the translation output (rather than reusing the source
 * AST `applyTranslations` walks) because link nodes live INSIDE the
 * inline ranges that the applier byte-splices — overlapping edit
 * lists would clobber each other. Re-parsing gives fresh link
 * positions in the spliced output.
 *
 * Byte-edits URL spans rather than stringifying the AST so we avoid
 * `mdast-util-to-markdown`'s defensive escaping changing unrelated
 * text. URL spans have deterministic byte positions and no escaping
 * concerns of their own.
 */
export function rewriteInternalLinks(text: string, options: RewriteInternalLinksOptions): string {
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
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
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
export function rewriteUrlIfInternal(url: string, options: RewriteInternalLinksOptions): string | null {
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

  // Idempotency: leave URLs already prefixed with any declared locale
  // alone (no `/pt-BR/pt-BR/foo` on re-renders).
  for (const loc of options.locales) {
    if (url === `/${loc}` || url.startsWith(`/${loc}/`)) {
      return null;
    }
  }

  // Split query/fragment so the prefix lands on the path.
  const suffixMatch = /[?#]/.exec(url);
  const path = suffixMatch ? url.slice(0, suffixMatch.index) : url;
  const suffix = suffixMatch ? url.slice(suffixMatch.index) : "";

  // Operator-declared internal exemptions. Reuses a compiled matcher
  // per `noPrefixUrls` array reference — see `matcherCache`.
  if (options.noPrefixUrls && options.noPrefixUrls.length > 0) {
    const isExempt = getNoPrefixMatcher(options.noPrefixUrls);
    if (isExempt(path)) {
      return null;
    }
  }

  const trimmedPath = path.startsWith("/") ? path.slice(1) : path;
  return `/${options.targetLocale}/${trimmedPath}${suffix}`;
}

/**
 * DFS over `link` nodes. Skips `linkReference` and `image` (different
 * syntactic shapes; not in scope for v0.1's content).
 */
function visitLinks(ast: Root, visitor: (link: Link) => void): void {
  function walk(node: unknown): void {
    if (typeof node !== "object" || node === null) return;
    const n = node as { type?: unknown; children?: unknown };
    if (n.type === "link") {
      visitor(node as Link);
    }
    if (Array.isArray(n.children)) {
      for (const child of n.children) walk(child);
    }
  }
  walk(ast);
}

/** Pull `start`/`end` offsets off an mdast node's position. */
function nodeSpan(node: unknown): { start: number; end: number } | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const pos = (node as { position?: { start?: { offset?: unknown }; end?: { offset?: unknown } } }).position;
  const start = pos?.start?.offset;
  const end = pos?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return undefined;
  return { start, end };
}

/**
 * Find the URL byte-range inside an inline link slice
 * (`[text](url)` or `[text](url "title")`). Returns `undefined` for
 * autolinks and reference-style links, which don't carry an inline
 * URL we'd want to rewrite.
 *
 * Markdown's inline-link grammar disallows unescaped `(`/`)` and
 * whitespace inside an unbracketed URL, which is what makes this
 * tractable with a regex.
 */
function findUrlSpanInInlineLink(slice: string): { start: number; end: number } | undefined {
  // Unanchored match: mdast positions on links sometimes include
  // trailing whitespace (in table cells), so `^` would miss them.
  const m = /\[(?:[^\]\\]|\\.)*\]\(([^\s)]+)/.exec(slice);
  if (!m) return undefined;
  const urlGroup = m[1];
  if (urlGroup === undefined) return undefined;
  const urlStart = m.index + m[0].length - urlGroup.length;
  return { start: urlStart, end: urlStart + urlGroup.length };
}
