import type { Root, Yaml } from "mdast";
import picomatch from "picomatch";
import { parse as parseYaml } from "yaml";
import { inlineSpan, visitTranslatableBlocks } from "./traverse.js";

/**
 * A translatable unit. IDs are stable across re-runs and shared with
 * `apply.ts` for byte-replacement at matching positions.
 *
 * ID grammar:
 *   body:<n>          n-th translatable block in DFS order
 *   fm:<key>          frontmatter scalar at top-level <key>
 *   fm:<key>[<i>]     i-th element of a top-level string-array
 */
export interface Segment {
  id: string;
  text: string;
}

export interface ExtractOptions {
  /** Forward-slash path relative to `sourceDir`. */
  sourcePath: string;
  /** Per-glob → translatable frontmatter keys. */
  frontmatter: Record<string, string[]>;
}

/**
 * Body segments preserve inline formatting markers (`**bold**` etc.)
 * verbatim — the model preserves them and the applier byte-replaces
 * the same range, keeping block markers (`#`, `> `, `- `) intact.
 * Frontmatter segments hold parsed YAML scalars.
 */
export function extractSegments(ast: Root, opts: ExtractOptions, source: string): Segment[] {
  const segments: Segment[] = [];

  visitTranslatableBlocks(ast, ({ block, id }) => {
    const span = inlineSpan(block);
    if (!span) return;
    const text = source.slice(span.start, span.end);
    if (text.length > 0) {
      segments.push({ id, text });
    }
  });

  const frontmatterNode = ast.children.find((child): child is Yaml => child.type === "yaml");
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
export function resolveFrontmatterKeys(sourcePath: string, rules: Record<string, string[]>): string[] {
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
 * Read the `noTranslate` flag. Returns `true` for boolean `true` and
 * the string aliases `"true"` / `"yes"` (common in hand-edited YAML);
 * everything else returns `false`. Build hook uses this to skip the
 * translation loop entirely.
 */
export function peekNoTranslate(ast: Root): boolean {
  const frontmatterNode = ast.children.find((child): child is Yaml => child.type === "yaml");
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
  if (typeof value === "string") {
    const normalised = value.toLowerCase().trim();
    return normalised === "true" || normalised === "yes";
  }
  return false;
}

/**
 * Translatable-frontmatter values keyed by name. Feeds the cache-key
 * hash directly (separate from `extractSegments`'s flat `{id, text}`
 * shape so reordering / adding non-translatable keys is invisible to
 * the hash; non-string values still propagate to the hash so e.g. a
 * `year: 2025 → 2026` change re-keys the cache).
 */
export function selectTranslatableFrontmatter(ast: Root, opts: ExtractOptions): Record<string, unknown> {
  const frontmatterNode = ast.children.find((child): child is Yaml => child.type === "yaml");
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
