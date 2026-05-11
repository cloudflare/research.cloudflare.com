/**
 * Dotted key-path utilities shared by structured-data adapters
 * (TOML / JSON / YAML).
 *
 * **Path grammar.**
 *
 *   `key`                    top-level scalar
 *   `a.b.c`                  nested scalar
 *   `a[0]`                   array element by index
 *   `a.b[3].c`               mixed
 *   `a[*]`                   wildcard array (every element)
 *   `a.*`                    wildcard object (every value)
 *   `a[*].b.*.c`             wildcards compose
 *
 * **Wildcards are extract-time only.** They expand against the parsed
 * structure into a list of concrete paths, then the adapter reads /
 * writes scalars at each. Concrete paths never contain `*`.
 *
 * **Stable string ID.** Each concrete path serialises back to a
 * canonical dotted+bracket form; IDs round-trip through the
 * translator response and back to the apply step.
 */

export type PathSegment = string | number;

/**
 * Parse a dotted/bracketed path into segments. Returns the parsed
 * segments plus a flag for whether any wildcards appeared.
 *
 * Throws on syntactically malformed input (mismatched brackets,
 * trailing dot) so misconfigured `tomlKeys` surfaces early in the
 * build, not silently mid-pair.
 */
export function parsePath(path: string): { segments: (PathSegment | "*")[]; hasWildcard: boolean } {
  if (path.length === 0) {
    throw new Error(`[polystella] empty key path is invalid`);
  }
  const segments: (PathSegment | "*")[] = [];
  let hasWildcard = false;
  let i = 0;

  while (i < path.length) {
    if (path[i] === ".") {
      // Leading dot or doubled dot.
      throw new Error(`[polystella] malformed key path "${path}": unexpected "." at index ${i}`);
    }
    // Bracket form: `[N]` or `[*]`.
    if (path[i] === "[") {
      const closeIdx = path.indexOf("]", i);
      if (closeIdx === -1) {
        throw new Error(`[polystella] malformed key path "${path}": unclosed "[" at index ${i}`);
      }
      const inner = path.slice(i + 1, closeIdx);
      if (inner === "*") {
        segments.push("*");
        hasWildcard = true;
      } else if (/^\d+$/.test(inner)) {
        segments.push(Number(inner));
      } else {
        throw new Error(`[polystella] malformed key path "${path}": "[${inner}]" must be a non-negative integer or "*"`);
      }
      i = closeIdx + 1;
      // Bracket may be followed by `.next`, `[next]`, or end-of-string.
      if (i < path.length && path[i] === ".") {
        i++;
        if (i === path.length) {
          throw new Error(`[polystella] malformed key path "${path}": trailing "."`);
        }
      }
      continue;
    }
    // Dotted form: read until next `.` or `[`.
    let j = i;
    while (j < path.length && path[j] !== "." && path[j] !== "[") j++;
    const key = path.slice(i, j);
    if (key.length === 0) {
      throw new Error(`[polystella] malformed key path "${path}": empty segment near index ${i}`);
    }
    if (key === "*") {
      segments.push("*");
      hasWildcard = true;
    } else {
      segments.push(key);
    }
    i = j;
    if (i < path.length && path[i] === ".") {
      i++;
      if (i === path.length) {
        throw new Error(`[polystella] malformed key path "${path}": trailing "."`);
      }
    }
  }

  return { segments, hasWildcard };
}

/**
 * Render concrete (no-wildcard) segments back to canonical string
 * form. Numbers become bracketed indices; first segment never gets
 * a leading dot. Used as segment IDs so the translator response
 * round-trips back to the same concrete path.
 */
export function formatPath(segments: readonly PathSegment[]): string {
  let out = "";
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (typeof seg === "number") {
      out += `[${seg}]`;
    } else {
      out += i === 0 ? seg : `.${seg}`;
    }
  }
  return out;
}

/**
 * Expand a (possibly wildcard-bearing) path against `data` into the
 * list of concrete paths the wildcards resolve to. Non-wildcard
 * paths return `[path]` verbatim, regardless of whether the path
 * actually points at anything in `data`.
 *
 * Wildcards over absent / non-iterable nodes silently expand to no
 * paths — better than throwing on partial data shapes (e.g. a TOML
 * file with no `paths.*` keys yet).
 */
export function expandPath(path: string, data: unknown): string[] {
  const { segments, hasWildcard } = parsePath(path);
  if (!hasWildcard) return [path];
  return expandSegments(segments, data, []);
}

/**
 * Recursive worker for `expandPath`. Walks `segments` left-to-right,
 * accumulating a concrete path; on `*` segments, branches once per
 * matching child of the current node.
 */
function expandSegments(segments: readonly (PathSegment | "*")[], node: unknown, acc: PathSegment[]): string[] {
  if (segments.length === 0) {
    return [formatPath(acc)];
  }
  const [head, ...rest] = segments;
  if (head === "*") {
    if (node === null || node === undefined) return [];
    if (Array.isArray(node)) {
      const out: string[] = [];
      for (let i = 0; i < node.length; i++) {
        out.push(...expandSegments(rest, node[i], [...acc, i]));
      }
      return out;
    }
    if (typeof node === "object") {
      const out: string[] = [];
      for (const key of Object.keys(node as Record<string, unknown>)) {
        out.push(...expandSegments(rest, (node as Record<string, unknown>)[key], [...acc, key]));
      }
      return out;
    }
    return [];
  }
  if (node === null || node === undefined) {
    // Non-wildcard segment over absent node — let the caller's read
    // step decide whether to skip; emit the concrete path verbatim.
    return [formatPath([...acc, head as PathSegment, ...rest.filter((s): s is PathSegment => s !== "*")])];
  }
  if (typeof head === "number") {
    if (!Array.isArray(node)) return [];
    return expandSegments(rest, node[head], [...acc, head]);
  }
  // String key.
  if (typeof node !== "object") return [];
  return expandSegments(rest, (node as Record<string, unknown>)[head as string], [...acc, head as string]);
}

/**
 * Read the value at `segments` from `node`. Returns `undefined` when
 * any segment is absent / non-traversable. Concrete (no-wildcard)
 * paths only — wildcards must be expanded first via `expandPath`.
 */
export function readAtPath(node: unknown, segments: readonly PathSegment[]): unknown {
  let current: unknown = node;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof seg === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[seg];
    } else {
      if (typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[seg];
    }
  }
  return current;
}

/**
 * Write `value` at `segments` in `node`, mutating in place. Throws
 * when an intermediate segment doesn't traverse to a usable container
 * — better than silently dropping the write on a misconfigured path.
 *
 * Concrete paths only.
 */
export function writeAtPath(node: unknown, segments: readonly PathSegment[], value: unknown): void {
  if (segments.length === 0) {
    throw new Error(`[polystella] cannot write at empty path`);
  }
  let current: unknown = node;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (current === null || current === undefined) {
      throw new Error(`[polystella] cannot write at ${formatPath(segments)}: parent is null/undefined at segment ${i}`);
    }
    if (typeof seg === "number") {
      if (!Array.isArray(current)) {
        throw new Error(`[polystella] cannot write at ${formatPath(segments)}: expected array at segment ${i}, got ${typeof current}`);
      }
      current = current[seg];
    } else {
      if (typeof current !== "object") {
        throw new Error(`[polystella] cannot write at ${formatPath(segments)}: expected object at segment ${i}, got ${typeof current}`);
      }
      current = (current as Record<string, unknown>)[seg];
    }
  }
  const last = segments[segments.length - 1]!;
  if (current === null || current === undefined) {
    throw new Error(`[polystella] cannot write at ${formatPath(segments)}: terminal parent is null/undefined`);
  }
  if (typeof last === "number") {
    if (!Array.isArray(current)) {
      throw new Error(`[polystella] cannot write at ${formatPath(segments)}: expected array as terminal parent`);
    }
    current[last] = value;
  } else {
    if (typeof current !== "object") {
      throw new Error(`[polystella] cannot write at ${formatPath(segments)}: expected object as terminal parent`);
    }
    (current as Record<string, unknown>)[last] = value;
  }
}

/**
 * Match a relative source path against a glob (as produced by
 * `picomatch`). Re-exported here so adapters don't need a direct
 * picomatch import — picomatch is already a transitive dep.
 */
export { default as picomatchMatcher } from "picomatch";

import picomatch from "picomatch";

/**
 * Resolve translatable key paths for a single source file. Walks
 * every glob in `translatableKeys` that matches `sourcePath`,
 * unions the listed key paths, expands any wildcards (`[*]`, `.*`)
 * against the parsed structure, and returns the deduplicated
 * concrete-path list.
 *
 * Shared across structured-data adapters (TOML / JSON / YAML) since
 * the resolution is identical — only the parser differs. Markdown
 * doesn't use this helper because its key paths target frontmatter
 * keys (a flat scalar map), not nested data.
 *
 * Order matters for ID stability: concrete paths are emitted in
 * the order rules appear in the user's config (within a glob, in
 * the user's listed order; across globs, in object-iteration order).
 * Dedup preserves first occurrence.
 */
export function resolveConcretePaths(args: { parsed: unknown; sourcePath: string; translatableKeys: Record<string, string[]> }): string[] {
  const { parsed, sourcePath, translatableKeys } = args;
  const matchedRulePaths: string[] = [];
  for (const [pattern, paths] of Object.entries(translatableKeys)) {
    if (picomatch.isMatch(sourcePath, pattern)) {
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
