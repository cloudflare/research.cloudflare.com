import type { Segment } from "./extract.js";

/**
 * Pluggable file-format adapter interface.
 *
 * One adapter per family of file extensions (markdown, TOML, JSON,
 * YAML, …). The integration's translation pass dispatches per source
 * file by extension via the registry in `./registry.ts`.
 *
 * The interface is intentionally narrow: each adapter owns parsing,
 * segment extraction, translation application, cache-key value
 * selection, and the `noTranslate` opt-out check. Everything else
 * (cache layer, R2, glossary, overrides, prune, build report) is
 * format-agnostic and lives one layer up.
 *
 * **Per-format ID grammar.** Adapters MUST emit segment IDs unique
 * within a single file. Markdown uses `body:n` / `fm:key` /
 * `fm:key[i]`; structured-data adapters use dotted key paths
 * (`featuredResearch.title`, `tags[0].description`). The cache layer
 * round-trips IDs verbatim through the translator response, so the
 * grammar only needs to be self-consistent within an adapter.
 *
 * **Per-format cache-key composition (intentional asymmetry).** The
 * runtime hashes `body || canonicalSelectedValues || glossary || model`
 * for every adapter today. Markdown's `body` is the raw source bytes
 * (every byte is potentially translatable inline content). For
 * structured-data adapters, we may revisit this in v0.1.x — comments
 * and non-translatable fields shouldn't bust the cache when the
 * structure has explicit translatable key paths. See the design doc
 * §3.1 for the planned variant.
 */
export interface FileTypeAdapter<TParsed = unknown> {
  /**
   * File extensions this adapter claims (lowercase, with leading
   * dot, e.g. `[".md", ".mdx"]`). The registry's reverse-index keys
   * dispatch by this list.
   */
  readonly extensions: readonly string[];

  /**
   * Parse source bytes into the adapter's internal representation.
   * Pure: no I/O, no Astro coupling. Throws on syntactic errors so
   * the per-pair try/catch in `runTranslationPass` can surface them
   * without aborting the build.
   *
   * `sourcePath` (optional) lets adapters that claim multiple
   * extensions dispatch on the actual file type — the markdown
   * adapter uses it to choose between `.md` (plain markdown) and
   * `.mdx` (MDX-aware) parsing. Adapters that own a single extension
   * can ignore it.
   */
  parse(source: string, sourcePath?: string): TParsed;

  /**
   * Extract translatable segments. `source` is passed through so
   * adapters that byte-splice on apply (e.g. markdown) can read
   * inline ranges directly from source bytes; adapters that
   * parse-mutate-stringify (TOML/JSON/YAML) ignore it.
   */
  extractSegments(parsed: TParsed, source: string, opts: AdapterExtractOptions): Segment[];

  /**
   * Apply translations and return the new bytes. For markdown:
   * byte-splices the inline ranges so non-translated bytes are
   * preserved verbatim. For structured-data adapters: parse-mutate-
   * stringify (round-trip is relaxed; comments and key order may
   * drift on output, but only on translation outputs — source files
   * are never rewritten).
   *
   * `topLevelAdditions` carries the AI-translation marker (or any
   * future top-level key additions). Markdown injects them into
   * frontmatter; structured-data adapters write them as top-level
   * keys.
   */
  applyTranslations(parsed: TParsed, source: string, translations: Map<string, string>, opts: AdapterApplyOptions): string;

  /**
   * Translatable-value snapshot fed into the cache hash. Sensitive
   * to per-glob `translatableKeys` rules; ordering doesn't matter
   * (the hasher canonicalises before SHA-256).
   *
   * Keys NOT covered by the rules MUST NOT appear in the snapshot —
   * otherwise an unrelated edit would bust the cache.
   */
  selectedValuesForHash(parsed: TParsed, source: string, opts: AdapterExtractOptions): Record<string, unknown>;

  /**
   * `true` when the source is opted out of translation entirely.
   * For markdown: top-level frontmatter `noTranslate: true` (with
   * `"true"` / `"yes"` string aliases). For structured-data: top-
   * level `noTranslate: true` key.
   */
  peekNoTranslate(parsed: TParsed): boolean;

  /**
   * Rewrite key-path-based URL fields in `bytes`, returning new
   * bytes with each matched URL passed through `opts.rewriter`.
   * Operates on serialised bytes (post-`applyTranslations`,
   * post-cache) so the cache layer stores URL-rewrite-naïve content.
   *
   * Adapters that don't expose URL fields by key path MAY omit
   * this method — markdown body inline links, for example, are
   * handled separately via `rewriteInternalLinks` over bytes.
   * Markdown's implementation here covers ONLY frontmatter URL
   * fields; TOML/JSON/YAML implementations cover the structured
   * URL paths declared in the user's config.
   *
   * Implementations should be idempotent on already-rewritten
   * inputs and pass non-string / missing values through unchanged.
   */
  rewriteUrls?(bytes: string, opts: AdapterRewriteUrlsOptions): string;

  /**
   * Partition the flat `Segment[]` (from `extractSegments`) into an
   * ordered list of groups for token-aware batching. Adapters that
   * have meaningful section structure (e.g. markdown headings) keep
   * related segments adjacent so a batch boundary doesn't fall in
   * the middle of a section. Adapters that omit this method get a
   * single-group fallback in the translation layer (`[segments]`),
   * which the batcher then packs by token budget alone.
   *
   * Invariants:
   *   - `flat(result) === segments` (no segment dropped, none
   *     duplicated, original order preserved).
   *   - The translation layer treats absent return values as
   *     "no grouping hints"; behaviour is identical to today.
   *
   * See ARCHITECTURE.md §17 for the grouping algorithm.
   */
  groupSegments?(parsed: TParsed, segments: Segment[]): Segment[][];

  /**
   * Build a per-batch "document context" framing string — a short,
   * source-language block (title, excerpt, ...) injected into every
   * batch's system prompt. Purpose: keep terminology consistent
   * across batches when a single document is split into multiple
   * prompt round-trips.
   *
   * Returns `undefined` when no configured `contextKeys` resolve to
   * non-empty values for the source. The translation layer treats
   * absent / empty returns as "no document context block" — the
   * prompt is byte-identical to today.
   *
   * Markdown reads `frontmatter[key]` for each `contextKeys` entry
   * matching the source's glob. Structured-data adapters MAY omit
   * this method; they have no canonical doc-level structure today.
   */
  documentContext?(parsed: TParsed, opts: AdapterDocumentContextOptions): string | undefined;
}

/**
 * Per-pair options threaded through `extract` / `selectedValuesForHash`.
 *
 * `translatableKeys` is the resolved per-glob → key-paths map for
 * the adapter being invoked. The runtime picks the right map per
 * adapter (markdown reads `frontmatter`; TOML reads `tomlKeys`; etc.)
 * before calling the adapter — adapters never see the user-facing
 * option name.
 */
export interface AdapterExtractOptions {
  /** Forward-slash path relative to `sourceDir`. */
  sourcePath: string;
  /**
   * Per-glob → translatable key paths. Globs match the source path;
   * key paths use the adapter's ID grammar.
   */
  translatableKeys: Record<string, string[]>;
}

/**
 * Per-pair options threaded through `applyTranslations`.
 */
export interface AdapterApplyOptions {
  /**
   * Top-level key/value pairs merged into the output. Used by the
   * AI-translation marker injection. Keys here override same-named
   * keys already in the source (the marker reflects this build's
   * output, not stale source state).
   *
   * - Markdown: merged into the YAML frontmatter block.
   * - TOML / JSON / YAML: written as top-level keys.
   */
  topLevelAdditions?: Record<string, unknown>;
}

/**
 * Per-pair options threaded through `rewriteUrls` (post-cache URL
 * rewriting). Adapters that don't have key-path-based URL fields
 * MAY omit `rewriteUrls` entirely — the pipeline treats absence as
 * a no-op.
 *
 * URL rewriting runs AFTER `applyTranslations` and on already-staged
 * bytes (as opposed to the parsed structure) so cached bytes are
 * URL-rewrite-naïve: changing `noPrefixUrls` doesn't bust the cache.
 *
 * `paths` are adapter-format key paths (markdown frontmatter: flat
 * keys; TOML: dotted/bracketed). `rewriter` returns the new URL
 * string, or `null` when the URL should be left unchanged.
 */
export interface AdapterRewriteUrlsOptions {
  paths: string[];
  rewriter: (url: string) => string | null;
}

/**
 * Per-pair options threaded through `documentContext`. The runtime
 * resolves the operator-configured `markdown.contextKeys` map (or
 * its per-adapter equivalent in future formats) and passes the full
 * glob → key-paths shape so adapters can union matching entries
 * themselves (mirrors how `translatableKeys` flows in `AdapterExtractOptions`).
 *
 * `contextKeys` is intentionally distinct from `translatableKeys`
 * and from `rewriteUrls.paths`: a single key MAY appear in both
 * `keys` (translated) and `contextKeys` (shown as framing in the
 * doc-context block) — typical for `title` / `excerpt`.
 */
export interface AdapterDocumentContextOptions {
  /** Forward-slash path relative to `sourceDir`. */
  sourcePath: string;
  /**
   * Per-glob → context-bearing key paths. Adapters MAY ignore the
   * shape if it doesn't apply (e.g. structured-data adapters that
   * don't implement `documentContext`).
   */
  contextKeys: Record<string, string[]>;
}
