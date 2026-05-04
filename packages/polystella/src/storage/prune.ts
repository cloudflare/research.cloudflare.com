import type { R2Client, R2ListEntry } from "./r2.js";

/**
 * Count-based cache pruner.
 *
 * For every (locale, sourcePath) pair the build touched, list every
 * hash variant in R2, sort by `lastModified` descending, keep the
 * most-recent N, DELETE the rest. Glossary/model/source edits each
 * produce a new hash → new R2 key, so without pruning R2 accumulates
 * stale objects forever.
 *
 * Only pairs the current build saw get pruned — a buggy include-glob
 * change can't accidentally drop the cache for renamed/deleted
 * sources. Orphan-hash cleanup is a separate concern.
 *
 * Batched by locale: one `list()` per locale prefix instead of one
 * per pair (200 sources × 3 locales = 3 list calls, not 600).
 */

export interface PruneCacheByPairOptions {
  r2: R2Client;
  /**
   * (locale, sourcePath) pairs the build touched, encoded via
   * `encodeTouchedPair`. Opaque format — callers must use the helper.
   */
  touchedPairs: Iterable<string>;
  /** Max hash variants per pair. `false` disables pruning entirely. */
  keepLastN: number | false;
}

export interface PruneResult {
  /** Total objects deleted across all pairs. */
  deleted: number;
  /** Actual R2 keys deleted (for the build report's audit trail). */
  deletedKeys: string[];
  /** Pairs that had at least one deletion. */
  prunedPairs: number;
  /** Pairs the pruner considered (touchedPairs minus malformed). */
  consideredPairs: number;
}

/**
 * Encode a (locale, sourcePath) pair into the touched-set string used
 * by `pruneCacheByPair`. Co-locating the encoder with the consumer
 * stops a subtle "what's the separator again?" bug from sneaking in.
 */
export function encodeTouchedPair(locale: string, sourcePath: string): string {
  return `${locale}::${sourcePath}`;
}

/**
 * Inverse of `encodeTouchedPair`. Returns `null` if the encoding is
 * malformed (defensive — should never fire when both ends use
 * `encodeTouchedPair`).
 */
export function decodeTouchedPair(
  encoded: string,
): { locale: string; sourcePath: string } | null {
  const idx = encoded.indexOf("::");
  if (idx < 0) return null;
  return {
    locale: encoded.slice(0, idx),
    sourcePath: encoded.slice(idx + 2),
  };
}

export async function pruneCacheByPair(
  opts: PruneCacheByPairOptions,
): Promise<PruneResult> {
  if (opts.keepLastN === false) {
    return {
      deleted: 0,
      deletedKeys: [],
      prunedPairs: 0,
      consideredPairs: 0,
    };
  }
  const keep = opts.keepLastN;
  const deletedKeys: string[] = [];

  // Group touched pairs by locale so we can issue one list() per
  // locale prefix rather than one per pair.
  const sourcePathsByLocale = new Map<string, Set<string>>();
  let consideredPairs = 0;
  for (const encoded of opts.touchedPairs) {
    const decoded = decodeTouchedPair(encoded);
    if (!decoded) continue;
    consideredPairs++;
    let bucket = sourcePathsByLocale.get(decoded.locale);
    if (!bucket) {
      bucket = new Set();
      sourcePathsByLocale.set(decoded.locale, bucket);
    }
    bucket.add(decoded.sourcePath);
  }

  let deleted = 0;
  let prunedPairs = 0;

  for (const [locale, sourcePaths] of sourcePathsByLocale) {
    const prefix = `i18n/${locale}/`;
    const all = await opts.r2.list(prefix);

    // Recover sourcePath from each key (`i18n/<locale>/<src>#<hash>.md`)
    // via `lastIndexOf("#")` — tolerates `#` inside a sourcePath
    // since the trailing hash is the last `#` by construction.
    const variantsBySourcePath = new Map<string, R2ListEntry[]>();
    for (const entry of all) {
      if (!entry.key.startsWith(prefix)) continue; // defensive
      const hashStart = entry.key.lastIndexOf("#");
      if (hashStart < prefix.length) continue; // malformed; skip
      const sourcePath = entry.key.slice(prefix.length, hashStart);
      let bucket = variantsBySourcePath.get(sourcePath);
      if (!bucket) {
        bucket = [];
        variantsBySourcePath.set(sourcePath, bucket);
      }
      bucket.push(entry);
    }

    for (const sourcePath of sourcePaths) {
      const variants = variantsBySourcePath.get(sourcePath);
      if (!variants || variants.length <= keep) continue;
      // Newest first.
      variants.sort(
        (a, b) => b.lastModified.getTime() - a.lastModified.getTime(),
      );
      const toDelete = variants.slice(keep);
      for (const entry of toDelete) {
        await opts.r2.del(entry.key);
        deletedKeys.push(entry.key);
        deleted++;
      }
      prunedPairs++;
    }
  }

  return { deleted, deletedKeys, prunedPairs, consideredPairs };
}
