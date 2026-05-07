import type {
  AdapterApplyOptions,
  AdapterExtractOptions,
  AdapterRewriteUrlsOptions,
  FileTypeAdapter,
} from "../adapter.js";
import type { Segment } from "../extract.js";
import { expandPath, parsePath, readAtPath, resolveConcretePaths, writeAtPath, type PathSegment } from "../key-paths.js";

/**
 * JSON adapter. Parses with the native `JSON.parse`, extracts
 * translatable scalars at user-configured key paths (with wildcard
 * support), and applies translations by mutating the parsed
 * structure and re-stringifying with a stable two-space indent.
 *
 * **Round-trip fidelity (relaxed).** JSON has no comments, but key
 * order, indentation, and trailing-newline conventions in the source
 * are NOT preserved. `JSON.stringify(_, null, 2)` produces canonical
 * output. Source files are never rewritten by polystella, so this
 * only affects translation outputs (regenerated each build).
 *
 * **Cache key.** Uses the same body+selectedValues+glossary+model
 * hash composition as the markdown / TOML adapters today; whitespace
 * in source files DOES bust the cache. The structured-data variant
 * (drop `rawBody`, hash only canonical selected values) is documented
 * as future work in the design doc §3.1.
 *
 * **noTranslate opt-out.** Top-level boolean `noTranslate: true`
 * skips the file. JSON's strict type system means no string aliases
 * (matching TOML; YAML's looser parsing accepts `"true"` / `"yes"`
 * for parity with markdown frontmatter).
 *
 * **AI-marker injection (per-entry, not file root).** Astro's
 * `file()` loader maps each top-level JSON key to a separate
 * collection entry, with the value as that entry's `data`. Marker
 * fields written at the file root would manifest as bogus extra
 * entries (e.g. an entry with id `aiTranslated` whose data is
 * `true`) and fail schema validation. The adapter therefore injects
 * the marker fields INSIDE each top-level object-valued key — top-
 * level scalar keys are skipped (their values are already valid
 * entry data and the marker has nowhere meaningful to attach).
 *
 * **Top-level array handling.** A JSON file with a top-level array
 * (Astro maps each array element to a collection entry by `id` /
 * `slug`) gets the marker injected into each element that's an
 * object — same intent as the per-key injection for object roots.
 */
export const jsonAdapter: FileTypeAdapter<JsonData> = {
  extensions: [".json"],

  parse(source: string): JsonData {
    return JSON.parse(source) as JsonData;
  },

  extractSegments(parsed: JsonData, _source: string, opts: AdapterExtractOptions): Segment[] {
    const segments: Segment[] = [];
    const concretePaths = resolveConcretePaths({
      parsed,
      sourcePath: opts.sourcePath,
      translatableKeys: opts.translatableKeys,
    });
    for (const path of concretePaths) {
      const { segments: pathSegs } = parsePath(path);
      const value = readAtPath(parsed, pathSegs as PathSegment[]);
      // Only string scalars are translatable; numbers / booleans /
      // null / nested structures are passed through untouched.
      if (typeof value === "string" && value.length > 0) {
        segments.push({ id: path, text: value });
      }
    }
    return segments;
  },

  applyTranslations(
    parsed: JsonData,
    _source: string,
    translations: Map<string, string>,
    opts: AdapterApplyOptions,
  ): string {
    // Deep-clone before mutating so adapters can be re-invoked on
    // the same parsed object across cache misses without cross-
    // contamination. JSON values are pure JSON-ish (strings,
    // numbers, booleans, null, plain objects, arrays) — `structuredClone`
    // handles all of them.
    const out = structuredClone(parsed) as JsonData;

    for (const [id, translation] of translations) {
      const { segments } = parsePath(id);
      // Translator round-trips IDs verbatim, so wildcards never
      // appear here. If they do (malformed translator output),
      // the path is invalid and the write throws — caller's per-pair
      // try/catch surfaces it.
      writeAtPath(out, segments as PathSegment[], translation);
    }

    // Marker injection: per-entry, not file-root. Mirrors the TOML
    // adapter's logic — see toml.ts for the rationale. JSON adds
    // top-level-array handling: when the root is an array, each
    // element that's an object gets the marker (matches Astro's
    // file() loader rule of "id-or-slug per array element → entry").
    if (opts.topLevelAdditions) {
      injectMarkerIntoEntries(out, opts.topLevelAdditions);
    }

    return JSON.stringify(out, null, 2);
  },

  selectedValuesForHash(parsed: JsonData, _source: string, opts: AdapterExtractOptions): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const concretePaths = resolveConcretePaths({
      parsed,
      sourcePath: opts.sourcePath,
      translatableKeys: opts.translatableKeys,
    });
    for (const path of concretePaths) {
      const { segments } = parsePath(path);
      const value = readAtPath(parsed, segments as PathSegment[]);
      // Capture every value the rules cover, not just strings:
      // `year: 2025 → 2026` should bust the cache too. Non-string
      // values flow into the canonical hash as-is.
      if (value !== undefined) {
        result[path] = value;
      }
    }
    return result;
  },

  peekNoTranslate(parsed: JsonData): boolean {
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    return (parsed as Record<string, unknown>).noTranslate === true;
  },

  /**
   * Walk configured URL paths in the parsed bytes and rewrite
   * matched string values via `opts.rewriter`. Re-parses the bytes
   * (rather than receiving a parsed structure) because the pipeline
   * calls this AFTER `applyTranslations` returns serialised bytes
   * — keeps cached bytes URL-rewrite-naïve so a `noPrefixUrls`
   * config edit doesn't bust the cache.
   *
   * Wildcards (`[*]`, `.*`) expand against the post-apply structure
   * so URL paths can target dynamic shapes like `entries[*].url`.
   * No-op when the configured paths produce no concrete matches or
   * every matched value passes the rewriter unchanged.
   */
  rewriteUrls(bytes: string, opts: AdapterRewriteUrlsOptions): string {
    if (opts.paths.length === 0) return bytes;
    const parsed = JSON.parse(bytes) as JsonData;
    const out = structuredClone(parsed) as JsonData;
    let mutated = false;
    for (const rule of opts.paths) {
      for (const concrete of expandPath(rule, out)) {
        const { segments } = parsePath(concrete);
        const value = readAtPath(out, segments as PathSegment[]);
        if (typeof value !== "string") continue;
        const rewritten = opts.rewriter(value);
        if (rewritten === null || rewritten === value) continue;
        writeAtPath(out, segments as PathSegment[], rewritten);
        mutated = true;
      }
    }
    if (!mutated) return bytes;
    return JSON.stringify(out, null, 2);
  },
};

/**
 * Type alias for `JSON.parse` output. Modelled as `unknown` because
 * a JSON file's root may be an object, array, or scalar; the adapter
 * handles each shape dynamically.
 */
export type JsonData = unknown;

/**
 * Inject the AI-marker fields per-entry. Behaviour:
 *
 *   - Object root → walk top-level keys; merge marker into each
 *     object-valued key. Scalar-valued top-level keys are skipped
 *     (Astro maps them to entries with scalar `data` — no place to
 *     attach the marker).
 *   - Array root → walk each element; merge marker into each
 *     object-valued element. Scalar / null elements are skipped.
 *   - Scalar root → no-op (the file doesn't represent collection
 *     entries in any meaningful way).
 *
 * Mutates `out` in place. Caller owns the deep-clone.
 */
function injectMarkerIntoEntries(out: JsonData, additions: Record<string, unknown>): void {
  if (out === null || typeof out !== "object") return;

  if (Array.isArray(out)) {
    for (const element of out) {
      if (element === null || typeof element !== "object" || Array.isArray(element)) continue;
      for (const [key, value] of Object.entries(additions)) {
        (element as Record<string, unknown>)[key] = value;
      }
    }
    return;
  }

  for (const [, topValue] of Object.entries(out)) {
    if (topValue === null || typeof topValue !== "object" || Array.isArray(topValue)) continue;
    for (const [key, value] of Object.entries(additions)) {
      (topValue as Record<string, unknown>)[key] = value;
    }
  }
}
