import { readdir } from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";

export interface SourceFile {
  /** Forward-slash path relative to the source root (after `pathPrefix` is applied, if any). */
  relativePath: string;
  absolutePath: string;
}

/**
 * One source root to walk. Multiple roots are concatenated by
 * `walkSources` so polystella's main `sourceDir` and the
 * custom-loader snapshot dirs (`.astro/polystella-snapshots/<name>/`)
 * can feed the translation pass through a single call.
 */
export interface SourceRoot {
  /** Absolute or project-relative path. `walkSources` resolves it. */
  baseDir: string;
  /** Globs matched against the root-relative path. */
  include: string[];
  exclude: string[];
  /**
   * Optional virtual prefix prepended to the source's `relativePath`.
   * The snapshot root uses `<name>` so files appear as
   * `<name>/<id>.json` rather than `<id>.json` only — gives the
   * translation pipeline a stable identifier for cache keys + R2
   * paths that doesn't conflict with the main `sourceDir`'s entries.
   */
  pathPrefix?: string;
}

export interface WalkOptions {
  /**
   * Roots to walk. Order matters for collision resolution: the
   * first root that produces a given `relativePath` wins; later
   * matches are silently skipped (first-wins, mirrors the adapter
   * registry's convention).
   */
  roots: SourceRoot[];
}

/**
 * Recursively walk every root. Missing directories return empty
 * lists (lets callers handle "no content yet" without pre-checking).
 * Results are sorted by `relativePath` for cross-platform
 * determinism.
 *
 * Collision handling: if two roots produce the same `relativePath`,
 * the first root wins. Realistic only if a custom loader's `name`
 * collides with a directory under the main `sourceDir` AND the IDs
 * happen to match an existing filename — extremely unlikely in
 * practice, surfaced silently for now.
 */
export async function walkSources(opts: WalkOptions): Promise<SourceFile[]> {
  const seenRelativePaths = new Set<string>();
  const collected: SourceFile[] = [];

  for (const root of opts.roots) {
    const baseDir = path.resolve(root.baseDir);
    const matchInclude = picomatch(root.include, { dot: false });
    const matchExclude = root.exclude.length > 0 ? picomatch(root.exclude, { dot: false }) : () => false;

    let entries;
    try {
      entries = await readdir(baseDir, {
        recursive: true,
        withFileTypes: true,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        // Missing root → contributes zero files. Subsequent roots
        // are unaffected.
        continue;
      }
      throw e;
    }

    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const abs = path.join(ent.parentPath, ent.name);
      const relWithinRoot = path.relative(baseDir, abs).split(path.sep).join("/");
      if (!matchInclude(relWithinRoot)) continue;
      if (matchExclude(relWithinRoot)) continue;

      // Apply pathPrefix (if any) AFTER include/exclude matching —
      // user globs run against the root-local path, the prefix is a
      // pipeline-side namespacing concern.
      const finalRel = root.pathPrefix ? `${root.pathPrefix}/${relWithinRoot}` : relWithinRoot;
      if (seenRelativePaths.has(finalRel)) continue;
      seenRelativePaths.add(finalRel);
      collected.push({ relativePath: finalRel, absolutePath: abs });
    }
  }

  collected.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return collected;
}
