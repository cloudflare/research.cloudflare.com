import type { Root, Yaml } from "mdast";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { AdapterApplyOptions, AdapterExtractOptions, AdapterRewriteUrlsOptions, FileTypeAdapter } from "../adapter.js";
import { applyTranslations } from "../apply.js";
import { extractSegments, peekNoTranslate, selectTranslatableFrontmatter } from "../extract.js";
import type { Segment } from "../extract.js";
import { parseMarkdown, parseMdx } from "../parse.js";

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
};
