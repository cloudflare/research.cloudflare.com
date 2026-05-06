import picomatch from "picomatch";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import type { AdapterApplyOptions, AdapterExtractOptions, FileTypeAdapter } from "../adapter.js";
import type { Segment } from "../extract.js";
import { expandPath, parsePath, readAtPath, writeAtPath, type PathSegment } from "../key-paths.js";

/**
 * TOML adapter. Parses with `smol-toml`, extracts translatable
 * scalars at user-configured key paths (with wildcard support), and
 * applies translations by mutating the parsed structure and
 * re-stringifying.
 *
 * **Round-trip fidelity (relaxed).** Comments and exact key ordering
 * are not preserved on output — `smol-toml.stringify` produces clean
 * canonical TOML. This is acceptable for translation outputs (the
 * staged file is regenerated each build); source files are never
 * rewritten by polystella.
 *
 * **Cache key.** Today the runtime feeds raw body bytes + selected
 * values into `computeSourceHash`. For TOML that means whitespace
 * and comment edits in source files DO bust the cache; design doc
 * §3.1 calls out a structured-data variant that drops `rawBody` and
 * hashes `canonicalSelectedValues + glossary + model`. Implementing
 * that variant is M3.5 follow-up work — for v0.1.x ship, the
 * conservative current behaviour is fine.
 *
 * **noTranslate opt-out.** Top-level boolean `noTranslate = true`
 * skips the file. (No string aliases — TOML's stricter type system
 * doesn't need them, unlike YAML frontmatter.)
 *
 * **AI-marker injection (per-entry, not file root).** Astro's
 * `file()` loader maps each top-level TOML key to a separate
 * collection entry, with the value as that entry's `data`. Marker
 * fields written at the file root would manifest as bogus extra
 * entries (e.g. an entry with id `aiTranslated` whose data is
 * `true`) and fail schema validation. The adapter therefore injects
 * the marker fields INSIDE each top-level object-valued key — so a
 * file like `[main.featuredResearch]\n...` becomes `[main]\n
 * aiTranslated = true\n[main.featuredResearch]\n...` after
 * translation. Top-level scalar keys (numbers / booleans / strings)
 * are left untouched: they're already entries with non-object data
 * and the marker has nowhere meaningful to live on them. Files with
 * a single top-level key (the common `file()` loader case) get the
 * marker on that key; multi-entry files get it on each one.
 *
 * Consumer schemas extended by `polystellaCollections` accept these
 * fields uniformly across formats — TOML siblings work identically
 * to markdown siblings on the consumer side.
 */
export const tomlAdapter: FileTypeAdapter<TomlData> = {
  extensions: [".toml"],

  parse(source: string): TomlData {
    return parseToml(source) as TomlData;
  },

  extractSegments(parsed: TomlData, _source: string, opts: AdapterExtractOptions): Segment[] {
    const segments: Segment[] = [];
    const concretePaths = resolveConcretePaths(parsed, opts);
    for (const path of concretePaths) {
      const { segments: pathSegs } = parsePath(path);
      const value = readAtPath(parsed, pathSegs as PathSegment[]);
      // Only string scalars are translatable; numbers / booleans /
      // dates / nested structures are passed through untouched.
      if (typeof value === "string" && value.length > 0) {
        segments.push({ id: path, text: value });
      }
    }
    return segments;
  },

  applyTranslations(
    parsed: TomlData,
    _source: string,
    translations: Map<string, string>,
    opts: AdapterApplyOptions,
  ): string {
    // Deep-clone before mutating so adapters can be re-invoked on the
    // same parsed object across cache misses without cross-contamination.
    // smol-toml's parse output is pure JSON-ish (strings, numbers,
    // booleans, plain objects, arrays, Dates) — `structuredClone`
    // handles all of those.
    const out = structuredClone(parsed) as TomlData;

    for (const [id, translation] of translations) {
      const { segments } = parsePath(id);
      // Translator round-trips IDs verbatim, so wildcards never
      // appear here. If they do (malformed translator output),
      // the path is invalid and the write throws — caller's per-pair
      // try/catch surfaces it.
      writeAtPath(out, segments as PathSegment[], translation);
    }

    // Marker injection: per-entry, not file-root.
    //
    // Astro's `file()` loader treats every top-level TOML key as an
    // entry. Writing `aiTranslated = true` at the file root would
    // produce a bogus extra entry whose data is `true` (failing
    // schema validation). Instead, we walk the parsed top level and
    // merge the marker fields into every object-valued key — they
    // become part of each entry's `data`, accepted by the
    // polystellaCollections-extended sibling schema.
    //
    // Top-level scalar keys are skipped: their values are already
    // valid entry data (number/string/boolean) and the marker has
    // nowhere meaningful to attach.
    if (opts.topLevelAdditions) {
      for (const [topKey, topValue] of Object.entries(out)) {
        if (topValue === null || typeof topValue !== "object" || Array.isArray(topValue)) {
          continue;
        }
        for (const [markerKey, markerValue] of Object.entries(opts.topLevelAdditions)) {
          (topValue as Record<string, unknown>)[markerKey] = markerValue;
        }
      }
    }

    return stringifyToml(out as Record<string, unknown>);
  },

  selectedValuesForHash(parsed: TomlData, _source: string, opts: AdapterExtractOptions): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const concretePaths = resolveConcretePaths(parsed, opts);
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

  peekNoTranslate(parsed: TomlData): boolean {
    if (parsed === null || typeof parsed !== "object") return false;
    return (parsed as Record<string, unknown>).noTranslate === true;
  },
};

/**
 * Type alias for the `smol-toml` parse output. Modelled as
 * `Record<string, unknown>` because the actual type is recursive
 * (objects/arrays/scalars) and we walk it dynamically — there's no
 * useful narrower type at this layer.
 */
export type TomlData = Record<string, unknown>;

/**
 * Resolve translatable key paths for a single source file. Walks
 * every glob in `translatableKeys` that matches the source path,
 * unions the listed paths, expands wildcards against `parsed`, and
 * returns the deduplicated concrete-path list.
 *
 * Order matters for ID stability: concrete paths are emitted in
 * the order rules appear in the user's config (within a glob, in
 * the user's listed order; across globs, in object-iteration order).
 * Any later-stage list dedup preserves first occurrence.
 */
function resolveConcretePaths(parsed: TomlData, opts: AdapterExtractOptions): string[] {
  const matchedRulePaths: string[] = [];
  for (const [pattern, paths] of Object.entries(opts.translatableKeys)) {
    if (picomatch.isMatch(opts.sourcePath, pattern)) {
      for (const p of paths) {
        if (!matchedRulePaths.includes(p)) {
          matchedRulePaths.push(p);
        }
      }
    }
  }
  const concrete: string[] = [];
  const seen = new Set<string>();
  for (const rule of matchedRulePaths) {
    for (const expanded of expandPath(rule, parsed)) {
      if (!seen.has(expanded)) {
        seen.add(expanded);
        concrete.push(expanded);
      }
    }
  }
  return concrete;
}
