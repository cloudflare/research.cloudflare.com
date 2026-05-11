import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { AdapterApplyOptions, AdapterExtractOptions, AdapterRewriteUrlsOptions, FileTypeAdapter } from "../adapter.js";
import type { Segment } from "../extract.js";
import { expandPath, parsePath, readAtPath, resolveConcretePaths, writeAtPath, type PathSegment } from "../key-paths.js";

/**
 * YAML adapter. Parses with the `yaml` library (already a dep for
 * markdown frontmatter), extracts translatable scalars at user-
 * configured key paths (with wildcard support), and applies
 * translations by mutating the parsed structure and re-stringifying.
 *
 * **Round-trip fidelity (relaxed).** Comments, anchors / aliases,
 * exact key ordering, and quoting style are NOT preserved on output
 * — `yaml.stringify` produces canonical output. Source files are
 * never rewritten by polystella, so this only affects translation
 * outputs (regenerated each build). Document mode (which preserves
 * more structure) is on the table for future strict round-trip; the
 * v0.1.x ship uses the simpler parse/stringify path.
 *
 * **Cache key.** Uses the same body+selectedValues+glossary+model
 * hash composition as the markdown / TOML / JSON adapters today;
 * whitespace and comment edits in source files DO bust the cache.
 * The structured-data variant (drop `rawBody`, hash only canonical
 * selected values) is documented as future work in the design doc
 * §3.1.
 *
 * **noTranslate opt-out.** Top-level `noTranslate` accepts both
 * boolean `true` and the string aliases `"true"` / `"yes"` (matching
 * markdown frontmatter, which IS YAML — operators expect parity
 * across the two YAML surfaces). TOML and JSON are stricter.
 *
 * **AI-marker injection (per-entry, not file root).** Astro's
 * `file()` loader maps each top-level YAML key to a separate
 * collection entry, with the value as that entry's `data`. Marker
 * fields written at the file root would manifest as bogus extra
 * entries (e.g. an entry with id `aiTranslated` whose data is
 * `true`) and fail schema validation. The adapter therefore injects
 * the marker fields INSIDE each top-level object-valued key. Top-
 * level scalar keys are skipped (their values are already valid
 * entry data and the marker has nowhere meaningful to attach).
 *
 * **Top-level sequence handling.** A YAML file with a top-level
 * sequence (Astro maps each element to a collection entry by
 * `id` / `slug`) gets the marker injected into each element that's
 * a mapping — same intent as the per-key injection for mapping
 * roots.
 *
 * **Date / timestamp interop.** This adapter uses the `yaml`
 * package (eemeli/yaml v2), which returns unquoted ISO 8601 strings
 * as plain strings — quoted and unquoted forms hash identically in
 * `selectedValuesForHash`. Astro's `file()` loader, however, uses
 * `js-yaml` internally, which DOES auto-parse unquoted ISO
 * timestamps to `Date`. The schema-extender accommodates both:
 * `aiTranslatedAt: z.union([z.string(), z.date()])`, so the marker
 * round-trips correctly through both ends of the pipeline.
 */
export const yamlAdapter: FileTypeAdapter<YamlData> = {
  extensions: [".yaml", ".yml"],

  parse(source: string): YamlData {
    return parseYaml(source) as YamlData;
  },

  extractSegments(parsed: YamlData, _source: string, opts: AdapterExtractOptions): Segment[] {
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
      // dates / null / nested structures are passed through
      // untouched.
      if (typeof value === "string" && value.length > 0) {
        segments.push({ id: path, text: value });
      }
    }
    return segments;
  },

  applyTranslations(parsed: YamlData, _source: string, translations: Map<string, string>, opts: AdapterApplyOptions): string {
    // Deep-clone before mutating so adapters can be re-invoked on
    // the same parsed object across cache misses without cross-
    // contamination. `yaml.parse` returns JS-native types (strings,
    // numbers, booleans, Dates, plain objects, arrays) — all of
    // which `structuredClone` handles.
    const out = structuredClone(parsed) as YamlData;

    for (const [id, translation] of translations) {
      const { segments } = parsePath(id);
      // Translator round-trips IDs verbatim, so wildcards never
      // appear here. If they do (malformed translator output),
      // the path is invalid and the write throws — caller's per-pair
      // try/catch surfaces it.
      writeAtPath(out, segments as PathSegment[], translation);
    }

    // Marker injection: per-entry, not file-root. Mirrors the JSON
    // adapter's logic — see json.ts for the array-vs-object cases.
    if (opts.topLevelAdditions) {
      injectMarkerIntoEntries(out, opts.topLevelAdditions);
    }

    return stringifyYaml(out);
  },

  selectedValuesForHash(parsed: YamlData, _source: string, opts: AdapterExtractOptions): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const concretePaths = resolveConcretePaths({
      parsed,
      sourcePath: opts.sourcePath,
      translatableKeys: opts.translatableKeys,
    });
    for (const path of concretePaths) {
      const { segments } = parsePath(path);
      const value = readAtPath(parsed, segments as PathSegment[]);
      // Capture every value the rules cover (strings AND non-strings):
      // a numeric / boolean / Date value change in a translatable
      // key MUST bust the cache. The hasher's canonical JSON pass
      // serialises Dates as `"<iso>"`, scalars verbatim — sufficient
      // for cache-key composition.
      if (value !== undefined) {
        result[path] = value;
      }
    }
    return result;
  },

  peekNoTranslate(parsed: YamlData): boolean {
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    const value = (parsed as Record<string, unknown>).noTranslate;
    if (value === true) return true;
    if (typeof value === "string") {
      const normalised = value.toLowerCase().trim();
      return normalised === "true" || normalised === "yes";
    }
    return false;
  },

  /**
   * Walk configured URL paths in the parsed bytes and rewrite
   * matched string values via `opts.rewriter`. Re-parses the bytes
   * (rather than receiving a parsed structure) because the pipeline
   * calls this AFTER `applyTranslations` returns serialised bytes
   * — keeps cached bytes URL-rewrite-naïve so a `noPrefixUrls`
   * config edit doesn't bust the cache.
   *
   * Wildcards (`[*]`, `.*`) expand against the post-apply structure.
   * No-op when the configured paths produce no concrete matches or
   * every matched value passes the rewriter unchanged.
   */
  rewriteUrls(bytes: string, opts: AdapterRewriteUrlsOptions): string {
    if (opts.paths.length === 0) return bytes;
    const parsed = parseYaml(bytes) as YamlData;
    const out = structuredClone(parsed) as YamlData;
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
    return stringifyYaml(out);
  },
};

/**
 * Type alias for `yaml.parse` output. Modelled as `unknown` because
 * a YAML file's root may be a mapping, sequence, or scalar; the
 * adapter handles each shape dynamically.
 */
export type YamlData = unknown;

/**
 * Inject the AI-marker fields per-entry. Behaviour mirrors the JSON
 * adapter's helper:
 *
 *   - Mapping root → walk top-level keys; merge marker into each
 *     object-valued key. Scalar-valued keys skipped.
 *   - Sequence root → walk elements; merge marker into each
 *     mapping-valued element. Scalar / null elements skipped.
 *   - Scalar root → no-op.
 *
 * Mutates `out` in place. Caller owns the deep-clone.
 */
function injectMarkerIntoEntries(out: YamlData, additions: Record<string, unknown>): void {
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
