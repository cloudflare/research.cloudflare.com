import { readdir } from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";

export interface SourceFile {
  /** Forward-slash path relative to `sourceDir`. */
  relativePath: string;
  absolutePath: string;
}

export interface WalkOptions {
  sourceDir: string;
  /** Globs matched against `relativePath`. */
  include: string[];
  exclude: string[];
}

/**
 * Recursively walk `sourceDir`. Missing dir → empty array (lets
 * callers handle "no content yet"). Results sorted by relativePath
 * for cross-platform determinism.
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
