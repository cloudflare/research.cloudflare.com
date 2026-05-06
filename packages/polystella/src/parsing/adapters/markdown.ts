import type { Root } from "mdast";

import type { AdapterApplyOptions, AdapterExtractOptions, FileTypeAdapter } from "../adapter.js";
import { applyTranslations } from "../apply.js";
import { extractSegments, peekNoTranslate, selectTranslatableFrontmatter } from "../extract.js";
import type { Segment } from "../extract.js";
import { parseMarkdown } from "../parse.js";

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

  parse: parseMarkdown,

  extractSegments(parsed: Root, source: string, opts: AdapterExtractOptions): Segment[] {
    // The existing extractor takes the user-facing `frontmatter` map;
    // the adapter interface generalises that to `translatableKeys`.
    // For markdown the two are interchangeable.
    return extractSegments(
      parsed,
      { sourcePath: opts.sourcePath, frontmatter: opts.translatableKeys },
      source,
    );
  },

  applyTranslations(
    parsed: Root,
    source: string,
    translations: Map<string, string>,
    opts: AdapterApplyOptions,
  ): string {
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
};
