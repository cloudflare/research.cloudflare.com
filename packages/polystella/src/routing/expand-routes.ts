import picomatch from "picomatch";

/**
 * Glob-expand `routes` entries against a list of available files,
 * returning a flat list of concrete (non-glob) entries ready for
 * shim generation.
 *
 * The schema accepts either a literal path (`"src/pages/about.astro"`)
 * or a glob (`"src/pages/**\/*.astro"`). Globs expand against
 * `availableFiles`; literal paths pass through. Each expanded entry
 * inherits the source entry's `imports` array.
 *
 * **Auto-exclusions** applied during glob expansion (NOT to literal
 * paths — operators who explicitly list a path get exactly that
 * path):
 *
 *   - `404.astro` at any depth — Astro's special error-page fallback;
 *     a locale-prefixed shim of it would create real `/<locale>/404`
 *     routes that don't behave as fallbacks.
 *   - Files where any path segment starts with `_` — Astro's
 *     convention for non-route files (layouts, partials, etc.).
 *
 * Operators can still wrap an excluded file by listing it as a
 * literal-path entry alongside their globs.
 *
 * Pure: no filesystem access. The integration provides
 * `availableFiles` from a separate filesystem walk so this function
 * stays unit-testable with fixtures.
 */

export interface RouteEntry {
  source: string;
  imports: string[];
}

/**
 * @param entries Route entries (post-zod transform — every entry has
 *   `source: string` and `imports: string[]`).
 * @param availableFiles Forward-slash-normalised paths relative to
 *   the project root, e.g. `"src/pages/people/[slug].astro"`. The
 *   integration's filesystem walk produces this list.
 * @returns Concrete route entries with all globs expanded. Order
 *   preserves the original `entries` order (and within each glob,
 *   `availableFiles` order). Duplicates by `source` are deduplicated
 *   on first occurrence.
 */
export function expandRoutes(entries: ReadonlyArray<RouteEntry>, availableFiles: ReadonlyArray<string>): RouteEntry[] {
  const out: RouteEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!hasGlobChars(entry.source)) {
      // Literal path: pass through verbatim. The integration is
      // responsible for surfacing missing-file errors when it tries
      // to resolve the path against disk.
      addUnique(out, seen, entry);
      continue;
    }

    // Glob entry: filter availableFiles by picomatch.
    const matcher = picomatch(entry.source);
    for (const file of availableFiles) {
      if (!matcher(file)) continue;
      if (isExcluded(file)) continue;
      addUnique(out, seen, { source: file, imports: entry.imports });
    }
  }

  return out;
}

/**
 * Heuristic: a string is a glob when it contains any of `*`, `?`, or
 * `[`. Mirrors picomatch's "is this glob-like" detection without
 * importing picomatch's internals.
 *
 * Brackets in literal filenames (`[slug].astro`) DO match — and that's
 * the right behaviour: you should pass them as literal paths, not
 * globs. A path containing only `[` (no `*`/`?`) is technically a
 * glob in picomatch's grammar, but the operator's intent for
 * `[slug].astro` is virtually always literal-path resolution.
 *
 * Compromise: treat `[` as a glob-marker (so `routes: ["src/pages/
 * **\/[slug].astro"]` works), but document that operators wanting
 * literal `[slug].astro` should list the full path explicitly. In
 * practice every literal-path entry the integration sees today does
 * exactly that.
 */
function hasGlobChars(s: string): boolean {
  return /[*?[]/.test(s);
}

/**
 * Auto-exclusions for glob expansion. Returns `true` when the file
 * should be SKIPPED.
 */
function isExcluded(file: string): boolean {
  const segments = file.split("/");
  // Astro convention: any path segment starting with `_` is not a
  // route. Layouts and partials usually live under `_components/`,
  // `_layouts/`, etc. Skipping them avoids false-positive shims.
  if (segments.some((seg) => seg.startsWith("_"))) return true;
  // Astro's special fallback page; never a translation target.
  const basename = segments[segments.length - 1];
  if (basename === "404.astro") return true;
  return false;
}

/** Push `entry` to `out` only if `entry.source` hasn't been seen. */
function addUnique(out: RouteEntry[], seen: Set<string>, entry: RouteEntry): void {
  if (seen.has(entry.source)) return;
  seen.add(entry.source);
  out.push(entry);
}
