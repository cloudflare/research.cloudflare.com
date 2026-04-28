import { readdir } from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";

/**
 * A markdown source file discovered under `sourceDir`.
 */
export interface SourceFile {
  /**
   * Path relative to `sourceDir`, always with forward slashes.
   * E.g. `"publications/Davidson2018.md"`.
   */
  relativePath: string;
  /** Absolute path on disk. */
  absolutePath: string;
}

export interface WalkOptions {
  /** Absolute or relative path to the content root. */
  sourceDir: string;
  /** Glob patterns to include (matched against `relativePath`). */
  include: string[];
  /** Glob patterns to exclude (matched against `relativePath`). */
  exclude: string[];
}

/**
 * Walk `sourceDir` recursively and return every regular file whose
 * relative path matches at least one `include` pattern and no `exclude`
 * pattern.
 *
 * Returns an empty array (rather than throwing) if `sourceDir` does not
 * exist; that lets callers handle the "no content yet" case explicitly.
 *
 * Results are sorted by `relativePath` for determinism across platforms
 * and filesystems.
 */
export async function walkSources(opts: WalkOptions): Promise<SourceFile[]> {
  const baseDir = path.resolve(opts.sourceDir);
  const matchInclude = picomatch(opts.include, { dot: false });
  const matchExclude =
    opts.exclude.length > 0
      ? picomatch(opts.exclude, { dot: false })
      : () => false;

  let entries;
  try {
    entries = await readdir(baseDir, {
      recursive: true,
      withFileTypes: true,
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw e;
  }

  const sources: SourceFile[] = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const abs = path.join(ent.parentPath, ent.name);
    const rel = path.relative(baseDir, abs).split(path.sep).join("/");
    if (!matchInclude(rel)) continue;
    if (matchExclude(rel)) continue;
    sources.push({ relativePath: rel, absolutePath: abs });
  }

  sources.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return sources;
}
