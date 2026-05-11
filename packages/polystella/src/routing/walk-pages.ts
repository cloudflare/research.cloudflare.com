import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Recursively walk `rootDir` returning forward-slash-normalised
 * relative paths to every `.astro` file, ignoring directories that
 * don't contain page sources by convention.
 *
 * Used by the integration to feed `expandRoutes` with the candidate
 * file list. Glob entries in `routes` match against the result.
 *
 * **Why `.astro` only.** Astro supports other file types as page
 * entrypoints (`.md`, `.mdx`, `.ts`, `.html`, etc.), but polystella's
 * shim wraps the source as a JSX component (`<SourcePage />`) — that
 * only works for `.astro`. Operators with non-Astro page files who
 * want them shimmed should list literal-path entries; the glob path
 * doesn't claim to enumerate them.
 *
 * **Ignored directories.** `node_modules`, `.git`, `.astro`,
 * `.cache`, `dist`, `coverage` — none contain user page sources, and
 * walking them would balloon the file list (especially `node_modules`).
 * The list mirrors common project conventions; not configurable
 * because anything sensible-named is included.
 */

const IGNORED_DIRS = new Set(["node_modules", ".git", ".astro", ".cache", "dist", "coverage"]);

/**
 * Optional dependency injection for testing. Production callers omit
 * it and get the real `node:fs/promises.readdir` behaviour.
 */
export interface WalkPagesDeps {
  readdir?: typeof readdir;
}

/**
 * Walk `rootDir` and return forward-slash-normalised relative paths
 * to every `.astro` file outside the ignored directories.
 *
 * Order is filesystem-iteration order (typically lexical on macOS /
 * Linux ext4; not guaranteed). Callers that need stable ordering
 * should sort the result.
 */
export async function walkPages(rootDir: string, deps: WalkPagesDeps = {}): Promise<string[]> {
  const reader = deps.readdir ?? readdir;
  const results: string[] = [];
  await walkInto(rootDir, "", reader, results);
  return results;
}

async function walkInto(absRoot: string, relPrefix: string, reader: typeof readdir, out: string[]): Promise<void> {
  // Force the string-encoding overload — the default Buffer overload
  // makes `entry.name` a NonSharedBuffer in TS' typings, which
  // doesn't have `endsWith` and would force per-entry coercion.
  // `encoding: "utf8"` is the same default Node uses at runtime.
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = (await reader(path.join(absRoot, relPrefix), {
      withFileTypes: true,
      encoding: "utf8",
    })) as Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  } catch {
    // Swallow: rootDir might not exist on a fresh project. The
    // integration handles "no routes resolved" downstream by
    // logging a warning.
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const childRel = relPrefix === "" ? entry.name : `${relPrefix}/${entry.name}`;
      await walkInto(absRoot, childRel, reader, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".astro")) continue;
    const full = relPrefix === "" ? entry.name : `${relPrefix}/${entry.name}`;
    out.push(full);
  }
}
