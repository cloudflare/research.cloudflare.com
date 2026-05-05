import { rename, stat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * On-disk index of "what's currently staged at `<stagingDir>` and
 * with what source hash". Sits alongside the staged files at
 * `<stagingDir>/.polystella-index.json` so it shares the lifecycle
 * of the staging dir itself — `rm -rf .astro/i18n-staging` clears
 * both the staged files and the index in one shot, no special
 * cleanup step required.
 *
 * Why an index instead of (e.g.) embedding the hash in each staged
 * file's frontmatter:
 *   - Reading one JSON file at startup is cheaper than parsing the
 *     frontmatter of every staged MDX before the pool worker runs.
 *   - The staged MDX is the operator-visible artefact; we don't want
 *     to clutter it with bookkeeping that has nothing to do with the
 *     translation itself.
 *   - The index can carry per-entry metadata (last-staged timestamp,
 *     outcome category) without bloating the staged files.
 *
 * Why not a sidecar `.hash` file per staged file:
 *   - Doubles the inode count under the staging dir.
 *   - Same read-cost win as the index in aggregate, but harder to
 *     diff/debug than a single JSON.
 *
 * Schema is versioned (`version: 1`); a mismatch on read is treated
 * as a missing index (full run, then rewrite). Same for parse
 * failures and any other corruption — never propagate; always
 * degrade to "do the full run". Skipping an unchanged pair is an
 * optimisation, not a correctness requirement.
 */

export interface LocalCacheEntry {
  /**
   * Hash that determines whether the staged file is current. For
   * regular translations this is the source-content hash (the same
   * value baked into the R2 key). Mismatch → re-fetch / re-translate.
   */
  hash: string;
  /** ISO-8601. Operator-facing audit field; not used for staleness. */
  stagedAt: string;
}

interface LocalCacheIndexFile {
  version: 1;
  entries: Record<string, LocalCacheEntry>;
}

/**
 * Index filename, relative to `stagingDir`. Co-located with the
 * staged content so a single `rm -rf` clears both.
 */
export const LOCAL_CACHE_INDEX_FILENAME = ".polystella-index.json";

/**
 * Encode a (locale, sourcePath) tuple to the index's key shape.
 * Mirrors `encodeTouchedPair` from `prune.ts` — same separator so
 * a future helper can convert between the two without re-parsing.
 */
export function localCacheKey(locale: string, sourcePath: string): string {
  return `${locale}::${sourcePath}`;
}

/**
 * Read the index at `<stagingDir>/<LOCAL_CACHE_INDEX_FILENAME>`.
 *
 * Always resolves with a `Map` (never throws) — a missing,
 * unreadable, malformed, or wrong-version file degrades to an empty
 * map so the caller does a full run and writes a fresh index at the
 * end.
 */
export async function readLocalCacheIndex(stagingDir: string): Promise<Map<string, LocalCacheEntry>> {
  const filePath = path.join(stagingDir, LOCAL_CACHE_INDEX_FILENAME);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { entries?: unknown }).entries !== "object" ||
    (parsed as { entries: unknown }).entries === null
  ) {
    return new Map();
  }
  const entries = (parsed as LocalCacheIndexFile).entries;
  const result = new Map<string, LocalCacheEntry>();
  for (const [k, v] of Object.entries(entries)) {
    if (
      v &&
      typeof v === "object" &&
      typeof (v as LocalCacheEntry).hash === "string" &&
      typeof (v as LocalCacheEntry).stagedAt === "string"
    ) {
      result.set(k, {
        hash: (v as LocalCacheEntry).hash,
        stagedAt: (v as LocalCacheEntry).stagedAt,
      });
    }
  }
  return result;
}

/**
 * Atomically write the index. Two-step `write tmp → rename` keeps
 * concurrent reads from observing a torn file: rename(2) is atomic
 * on POSIX, and the index is small enough that the temp-file write
 * is effectively instantaneous.
 *
 * Sorted keys produce deterministic JSON, which makes the file
 * diff-friendly across builds (helpful when the staging dir is
 * version-controlled or attached to a build artefact).
 */
export async function writeLocalCacheIndex(stagingDir: string, entries: Map<string, LocalCacheEntry>): Promise<void> {
  const filePath = path.join(stagingDir, LOCAL_CACHE_INDEX_FILENAME);
  const sortedKeys = [...entries.keys()].sort();
  const sortedEntries: Record<string, LocalCacheEntry> = {};
  for (const k of sortedKeys) sortedEntries[k] = entries.get(k)!;
  const data: LocalCacheIndexFile = {
    version: 1,
    entries: sortedEntries,
  };
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

/**
 * Returns `true` iff `<stagingDir>/<locale>/<sourcePath>` exists as a
 * file. Used to gate the local-cache skip path: an index entry alone
 * isn't sufficient — the staged file itself must still be on disk
 * (someone may have manually deleted it).
 *
 * Errors other than ENOENT propagate, since they indicate a real
 * filesystem problem (permissions, FS unmount) rather than the
 * benign "file not yet staged" case.
 */
export async function stagedFileExists(stagingDir: string, locale: string, sourcePath: string): Promise<boolean> {
  const target = path.join(stagingDir, locale, sourcePath);
  try {
    const s = await stat(target);
    return s.isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
