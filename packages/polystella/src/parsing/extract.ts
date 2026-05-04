import type { Root, Yaml } from "mdast";
import picomatch from "picomatch";
import { parse as parseYaml } from "yaml";
import { inlineSpan, visitTranslatableBlocks } from "./traverse.js";

/**
 * A single translatable unit extracted from a source document.
 *
 * IDs are stable: re-running `extractSegments` on the same AST produces
 * the same IDs in the same order. The same IDs are used by `apply.ts`
 * to write translations back at matching positions.
 *
 * ID grammar:
 *   body:<n>            n-th translatable block in DFS order
 *   fm:<key>            frontmatter string value at top-level <key>
 *   fm:<key>[<i>]       i-th element of a top-level array of strings
 */
export interface Segment {
  id: string;
  text: string;
}

export interface ExtractOptions {
  /**
   * The source file's path relative to `sourceDir`. Used to match
   * against the `frontmatter` glob rules. Forward slashes regardless of
   * platform (the same convention `walk.ts` uses).
   */
  sourcePath: string;
  /**
   * Per-glob frontmatter rules. Each glob pattern (matched against
   * `sourcePath`) maps to a list of frontmatter keys to translate.
   * Keys not listed for any matching pattern are ignored.
   */
  frontmatter: Record<string, string[]>;
}

/**
 * Walk `ast` and produce a list of translatable segments. Pure function;
 * does not mutate the AST.
 *
 * Body segments contain the **source markdown** of the block's inline
 * content (formatting markers preserved): a paragraph that contains
 * `**bold**` in the source produces a segment whose text includes the
 * `**...**` markers verbatim. This is what we want to send to a
 * translation model — the model preserves the markers, and `apply.ts`
 * splices the translation back at the exact same byte range, keeping
 * the surrounding block markers (`#`, `> `, `- `) intact.
 *
 * Frontmatter segments contain the parsed YAML scalar value, NOT raw
 * YAML — there's no markdown formatting in frontmatter values.
 */
export function extractSegments(
  ast: Root,
  opts: ExtractOptions,
  source: string,
): Segment[] {
  const segments: Segment[] = [];

  visitTranslatableBlocks(ast, ({ block, id }) => {
    const span = inlineSpan(block);
    if (!span) return;
    const text = source.slice(span.start, span.end);
    if (text.length > 0) {
      segments.push({ id, text });
    }
  });

  const frontmatterNode = ast.children.find(
    (child): child is Yaml => child.type === "yaml",
  );
  if (frontmatterNode) {
    const keys = resolveFrontmatterKeys(opts.sourcePath, opts.frontmatter);
    if (keys.length > 0) {
      const data = parseYaml(frontmatterNode.value) as Record<string, unknown>;
      for (const key of keys) {
        const value = data[key];
        if (typeof value === "string") {
          segments.push({ id: `fm:${key}`, text: value });
        } else if (Array.isArray(value)) {
          value.forEach((item, i) => {
            if (typeof item === "string") {
              segments.push({ id: `fm:${key}[${i}]`, text: item });
            }
          });
        }
        // Numbers, dates, nested objects, mixed-type arrays: not translatable.
      }
    }
  }

  return segments;
}

/**
 * Resolve which frontmatter keys to translate for `sourcePath`, by
 * unioning the key lists of every matching glob in `rules`.
 */
export function resolveFrontmatterKeys(
  sourcePath: string,
  rules: Record<string, string[]>,
): string[] {
  const matched = new Set<string>();
  for (const [pattern, keys] of Object.entries(rules)) {
    if (picomatch.isMatch(sourcePath, pattern)) {
      for (const key of keys) {
        matched.add(key);
      }
    }
  }
  return [...matched];
}

/**
 * Read the per-entry `noTranslate` frontmatter flag.
 *
 * Returns `true` only when the source's frontmatter has a top-level
 * `noTranslate: true` boolean (or `noTranslate: "true"` / `"yes"`
 * string forms — small-case YAML aliases that intent-equivalent and
 * are common in hand-edited frontmatter). Anything else — including
 * a missing frontmatter block, a missing key, a non-boolean truthy
 * value like `noTranslate: 1`, or any other shape — returns `false`.
 *
 * The build hook uses this to decide whether to skip a source from
 * the translation loop entirely (no AI call, no R2 write, no staging
 * file written for non-default locales). The runtime helper later
 * notices the absence of a sibling entry and falls back per the
 * `noTranslateBehavior` policy.
 *
 * Pure: no I/O. Returns `false` if the YAML parser doesn't recognise
 * the input as an object (defensive — `parseYaml` returns `null` for
 * empty frontmatter).
 */
export function peekNoTranslate(ast: Root): boolean {
  const frontmatterNode = ast.children.find(
    (child): child is Yaml => child.type === "yaml",
  );
  if (!frontmatterNode) return false;

  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatterNode.value);
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object") return false;
  const value = (parsed as Record<string, unknown>).noTranslate;
  if (value === true) return true;
  // String aliases for the boolean true. Operators editing frontmatter
  // by hand sometimes write `noTranslate: "true"` (especially after
  // copying values around in YAML); accepting the common spellings
  // avoids a confusing "I set the flag and it didn't take" debug
  // session. Matches YAML 1.1's truthy aliases minus the non-obvious
  // ones (`on`, `y`) that would risk false positives on real strings.
  if (typeof value === "string") {
    const normalised = value.toLowerCase().trim();
    return normalised === "true" || normalised === "yes";
  }
  return false;
}

/**
 * Pull the configured translatable-frontmatter values out of a parsed
 * source AST, keyed by the same names the rules use. Returned values
 * are the raw parsed-YAML scalars/arrays/objects without further
 * normalisation; `computeSourceHash` canonicalises them downstream.
 *
 * Exists separately from `extractSegments` because the cache-key
 * hash needs structured `Record<key, value>` data (so reordering or
 * adding non-translatable keys is invisible to the hash), whereas the
 * translation segments are flat `{id, text}` records keyed by
 * `fm:<key>` / `fm:<key>[<i>]`. Keeping the two operations distinct
 * also means the hash captures the value of a translatable key even
 * when the value type isn't itself translatable (e.g. a numeric key
 * we configured to translate but a content editor set to `2025` —
 * the hash still reflects the change so a later edit re-keys the
 * cache).
 *
 * Returns an empty object when the source has no frontmatter, when
 * no rules match `sourcePath`, or when a configured key is absent
 * from the actual frontmatter.
 */
export function selectTranslatableFrontmatter(
  ast: Root,
  opts: ExtractOptions,
): Record<string, unknown> {
  const frontmatterNode = ast.children.find(
    (child): child is Yaml => child.type === "yaml",
  );
  if (!frontmatterNode) return {};

  const keys = resolveFrontmatterKeys(opts.sourcePath, opts.frontmatter);
  if (keys.length === 0) return {};

  const data = parseYaml(frontmatterNode.value) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in data) {
      result[key] = data[key];
    }
  }
  return result;
}
