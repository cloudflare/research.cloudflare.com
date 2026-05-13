import type { Root, Yaml } from "mdast";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type {
  AdapterApplyOptions,
  AdapterDocumentContextOptions,
  AdapterExtractOptions,
  AdapterRewriteUrlsOptions,
  FileTypeAdapter,
} from "../adapter.js";
import { applyTranslations } from "../apply.js";
import { extractSegments, peekNoTranslate, resolveFrontmatterKeys, selectTranslatableFrontmatter } from "../extract.js";
import type { Segment } from "../extract.js";
import { parseMarkdown, parseMdx } from "../parse.js";
import { visitTranslatableBlocks } from "../traverse.js";

/**
 * Markdown / MDX adapter. Wraps the existing `parse.ts` / `extract.ts`
 * / `apply.ts` markdown pipeline behind the generic `FileTypeAdapter`
 * interface so the registry can dispatch by extension uniformly with
 * structured-data adapters.
 *
 * **Behaviour invariant.** The adapter is a thin shim — no logic
 * lives here that doesn't already live in the underlying functions.
 * Existing tests against `extractSegments` / `applyTranslations` /
 * `peekNoTranslate` continue to exercise the same code paths.
 *
 * **Note on MDX.** v0.1 ships markdown-only parsing (remark-parse +
 * remark-frontmatter + remark-gfm). Real MDX support — JSX-aware
 * extraction, prop allowlist, import/export skipping — is deferred
 * to v0.2 alongside the docs platform. Today, `.mdx` files round-
 * trip through the markdown parser and any embedded JSX is treated
 * as raw HTML; suitable when MDX content is structurally markdown-
 * shaped but unsuitable for component-heavy MDX.
 */
export const markdownAdapter: FileTypeAdapter<Root> = {
  extensions: [".md", ".mdx"],

  /**
   * Dispatch parser by file extension: `.mdx` opts into MDX-aware
   * parsing (recognising `import`/`export`, JSX components, and
   * expression bindings as first-class AST nodes); `.md` (or no
   * hint) uses pure markdown. The hint is optional for backward
   * compatibility — callers pre-dating the multi-format dispatch
   * still get plain-markdown parsing, which matches the historical
   * behaviour for `.mdx` files (treated as markdown with HTML).
   */
  parse(source: string, sourcePath?: string): Root {
    if (sourcePath !== undefined && sourcePath.toLowerCase().endsWith(".mdx")) {
      return parseMdx(source);
    }
    return parseMarkdown(source);
  },

  extractSegments(parsed: Root, source: string, opts: AdapterExtractOptions): Segment[] {
    // The existing extractor takes the user-facing `frontmatter` map;
    // the adapter interface generalises that to `translatableKeys`.
    // For markdown the two are interchangeable.
    return extractSegments(parsed, { sourcePath: opts.sourcePath, frontmatter: opts.translatableKeys }, source);
  },

  applyTranslations(parsed: Root, source: string, translations: Map<string, string>, opts: AdapterApplyOptions): string {
    return applyTranslations(parsed, translations, source, {
      ...(opts.topLevelAdditions ? { frontmatterAdditions: opts.topLevelAdditions } : {}),
    });
  },

  selectedValuesForHash(parsed: Root, _source: string, opts: AdapterExtractOptions): Record<string, unknown> {
    return selectTranslatableFrontmatter(parsed, {
      sourcePath: opts.sourcePath,
      frontmatter: opts.translatableKeys,
    });
  },

  peekNoTranslate(parsed: Root): boolean {
    return peekNoTranslate(parsed);
  },

  /**
   * Frontmatter URL rewriter. Body inline links are NOT touched
   * here — the pipeline runs `rewriteInternalLinks` over body bytes
   * separately. Rationale: body link rewriting is span-based
   * (mdast `link` nodes byte-spliced in place), so it has no shared
   * code with key-path-based URL rewriting and folding it in here
   * would be a behaviour change with no upside.
   *
   * Re-parses `bytes` to find the frontmatter span, walks the
   * configured URL keys, and splices a re-stringified YAML block
   * back in. No-op when there's no frontmatter, no configured keys,
   * or no value at any configured key passes the rewriter check.
   */
  rewriteUrls(bytes: string, opts: AdapterRewriteUrlsOptions): string {
    if (opts.paths.length === 0) return bytes;
    const ast = parseMarkdown(bytes);
    const fm = ast.children.find((child): child is Yaml => child.type === "yaml");
    if (!fm || typeof fm.position?.start?.offset !== "number" || typeof fm.position?.end?.offset !== "number") {
      return bytes;
    }
    const data = parseYaml(fm.value) as Record<string, unknown>;
    let mutated = false;
    for (const key of opts.paths) {
      const value = data[key];
      if (typeof value !== "string") continue;
      const rewritten = opts.rewriter(value);
      if (rewritten === null || rewritten === value) continue;
      data[key] = rewritten;
      mutated = true;
    }
    if (!mutated) return bytes;
    const newInner = stringifyYaml(data).replace(/\n+$/, "");
    const start = fm.position.start.offset;
    const end = fm.position.end.offset;
    return `${bytes.slice(0, start)}---\n${newInner}\n---${bytes.slice(end)}`;
  },

  /**
   * Heading-anchored grouping (ARCHITECTURE.md §17).
   *
   * Walks the AST in DFS order via the shared `visitTranslatableBlocks`
   * (the same iteration `extractSegments` uses, so IDs align) and
   * partitions emitted segments into groups. Every heading node
   * starts a new group; non-heading blocks (paragraphs, table cells)
   * append to the current group. Frontmatter segments are appended
   * as a single trailing group regardless of body shape.
   *
   * Invariant: `flat(result) === segments` by reference, in order.
   * The runtime assertion at the end catches grouping bugs early —
   * if it ever fires in production it means the AST shape changed
   * out from under us (e.g. an MDX node type whose ID numbering
   * doesn't match `extractSegments`).
   */
  groupSegments(parsed: Root, segments: Segment[]): Segment[][] {
    if (segments.length === 0) return [];

    // Index segments by ID for O(1) lookup during the walk. The
    // visitor numbers `body:N` for every translatable block; only
    // blocks whose inline span yielded text are in `segments`.
    const segmentById = new Map<string, Segment>();
    for (const seg of segments) segmentById.set(seg.id, seg);

    const bodyGroups: Segment[][] = [];
    let currentGroup: Segment[] = [];

    visitTranslatableBlocks(parsed, ({ block, id }) => {
      const seg = segmentById.get(id);
      if (seg === undefined) return; // block didn't emit a segment (empty span)
      if (block.type === "heading") {
        if (currentGroup.length > 0) {
          bodyGroups.push(currentGroup);
          currentGroup = [];
        }
        currentGroup.push(seg);
      } else {
        currentGroup.push(seg);
      }
    });
    if (currentGroup.length > 0) {
      bodyGroups.push(currentGroup);
    }

    // Frontmatter segments use the `fm:` prefix and are appended
    // after body segments by `extractSegments`. A prefix scan
    // avoids a second AST walk and preserves their original order.
    const fmGroup: Segment[] = [];
    for (const seg of segments) {
      if (seg.id.startsWith("fm:")) fmGroup.push(seg);
    }

    const groups: Segment[][] = [...bodyGroups];
    if (fmGroup.length > 0) groups.push(fmGroup);

    // Always-on invariant check: flat(groups) must equal segments
    // by reference + order. Cost is O(n) on already-small arrays;
    // cheap relative to the AST walk we just did.
    const flat = groups.flat();
    if (flat.length !== segments.length) {
      throw new Error(
        `[polystella] markdownAdapter.groupSegments invariant violated: produced ${flat.length} segments but received ${segments.length}`,
      );
    }
    for (let i = 0; i < flat.length; i++) {
      if (flat[i] !== segments[i]) {
        throw new Error(
          `[polystella] markdownAdapter.groupSegments invariant violated: segment at position ${i} differs (expected "${segments[i]?.id}", got "${flat[i]?.id}")`,
        );
      }
    }

    return groups;
  },

  /**
   * Document-context framing block (ARCHITECTURE.md §17).
   *
   * Reads configured `contextKeys` for the source's glob, pulls
   * matching frontmatter values (string-typed only), and formats
   * each as `<Title-Cased Key>: <single-line value>`. Multi-line
   * values collapse to one line so the model treats each entry as
   * a single context item.
   *
   * Returns `undefined` when no values resolve — the caller then
   * omits the DOCUMENT CONTEXT block from the prompt, preserving
   * byte-identical output to today.
   */
  documentContext(parsed: Root, opts: AdapterDocumentContextOptions): string | undefined {
    const fm = parsed.children.find((child): child is Yaml => child.type === "yaml");
    if (!fm) return undefined;

    const keys = resolveFrontmatterKeys(opts.sourcePath, opts.contextKeys);
    if (keys.length === 0) return undefined;

    let data: unknown;
    try {
      data = parseYaml(fm.value);
    } catch {
      // Malformed frontmatter is the operator's problem; don't
      // crash the build over a missing context block.
      return undefined;
    }
    if (data === null || typeof data !== "object") return undefined;
    const map = data as Record<string, unknown>;

    const lines: string[] = [];
    for (const key of keys) {
      const value = map[key];
      if (typeof value !== "string") continue;
      // Collapse runs of whitespace-around-newline to a single space.
      // Handles `\n`, `\r\n`, and double-newlines uniformly.
      const flat = value.replace(/\s*\n\s*/g, " ").trim();
      if (flat.length === 0) continue;
      lines.push(`${titleCaseKey(key)}: ${flat}`);
    }

    return lines.length > 0 ? lines.join("\n") : undefined;
  },
};

/**
 * Convert a snake/kebab key into a title-cased label for the
 * document-context block. `og_description` → `Og Description`,
 * `title` → `Title`, `seo-meta_image` → `Seo Meta Image`. Multiple
 * adjacent separators collapse to a single space; leading/trailing
 * separators don't produce empty words.
 */
function titleCaseKey(key: string): string {
  return key
    .split(/[_-]+/)
    .filter((w) => w.length > 0)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}
