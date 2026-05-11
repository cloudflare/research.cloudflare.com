/**
 * Dotted key-path utilities for structured-data adapters (TOML / JSON / YAML).
 *
 * Grammar:
 *   `key` / `a.b.c`        nested scalars
 *   `a[0]` / `a.b[3].c`    array index, mixed
 *   `a[*]` / `a.*`         wildcards (array elements / object values)
 *   `a[*].b.*.c`           compose
 *
 * Wildcards expand at extract time into concrete paths; concrete
 * paths never contain `*`. Each path serialises to a canonical
 * dotted+bracket form so IDs round-trip through the translator.
 */

export type PathSegment = string | number;

/**
 * Prototype-chain segments rejected at `parsePath` time so
 * misconfigured `translatableKeys` can't drive `readAtPath` into
 * `Object.prototype` or pollute it via `writeAtPath`.
 */
const FORBIDDEN_SEGMENT_NAMES = new Set(["__proto__", "prototype", "constructor"]);

function assertSafeSegment(seg: string, path: string): void {
  if (FORBIDDEN_SEGMENT_NAMES.has(seg)) {
    throw new Error(
      `[polystella] key path "${path}" contains reserved segment "${seg}". ` +
        `Segments named __proto__, prototype, or constructor are rejected ` +
        `because they traverse the JavaScript prototype chain.`,
    );
  }
}

/**
 * Parse a dotted/bracketed path. Throws on malformed input
 * (mismatched brackets, trailing dot) and on prototype-chain segments.
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
      assertSafeSegment(key, path);
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
 * Expand wildcards against `data`. Non-wildcard paths return
 * `[path]` verbatim. Wildcards over absent/non-iterable nodes
 * silently expand to no paths (partial data shapes are common).
 */
export function expandPath(path: string, data: unknown): string[] {
  const { segments, hasWildcard } = parsePath(path);
  if (!hasWildcard) return [path];
  return expandSegments(segments, data, []);
}

/** Recursive `expandPath` worker; branches on `*` segments. */
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
      // `Object.keys` only returns OWN enumerable string keys, so no
      // prototype-chain entries leak into the expansion.
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
  // `Object.hasOwn` gates prototype-chain traversal. `parsePath`
  // already rejects __proto__/prototype/constructor segments, but
  // this is the same defence on the access side in case a caller
  // builds `PathSegment[]` directly.
  if (!Object.hasOwn(node as object, head as string)) return [];
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
      // `Object.hasOwn` gates prototype-chain access so a segment like
      // `__proto__` reads as "missing" rather than returning the
      // object's prototype. `parsePath` already rejects those names;
      // this is defence in depth for any caller that builds
      // `PathSegment[]` directly (Semgrep
      // js/prototype-pollution-loop).
      if (!Object.hasOwn(current as object, seg)) return undefined;
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
      // `Object.hasOwn` gates prototype-chain traversal. When the
      // intermediate property doesn't exist we fall through to
      // `undefined`, and the next iteration's null/undefined guard
      // surfaces the existing "parent is null/undefined" error. This
      // preserves the original error shape while blocking
      // `current = current["__proto__"]` from landing on
      // `Object.prototype` (Semgrep js/prototype-pollution-loop).
      current = Object.hasOwn(current as object, seg) ? (current as Record<string, unknown>)[seg] : undefined;
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
    // Terminal write: forbid any segment that would land on the
    // prototype chain. `parsePath` blocks these at config parse
    // time; this guard catches direct `PathSegment[]` callers (and
    // satisfies Semgrep's pollution-loop detector at the actual
    // sink).
    if (FORBIDDEN_SEGMENT_NAMES.has(last)) {
      throw new Error(`[polystella] cannot write at ${formatPath(segments)}: terminal segment "${last}" is reserved (prototype-chain).`);
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
 * Resolve concrete translatable paths for a source. Union matching
 * globs' paths, expand wildcards against `parsed`, dedupe by first
 * occurrence (order matters for ID stability).
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
