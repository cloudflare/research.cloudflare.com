import type { R2Client, R2ListEntry } from "./r2.js";

/**
 * Count-based cache pruner.
 *
 * For every (locale, sourcePath) pair the build touched, list every
 * hash variant currently in R2, sort by `lastModified` descending,
 * keep the most-recent N, and DELETE the rest.
 *
 * Why this exists:
 *   - Each glossary edit, model change, or source edit produces a new
 *     hash and therefore a new R2 key (see `computeSourceHash` and
 *     `buildR2Key`). Without pruning, R2 accumulates one stale object
 *     per generation, forever.
 *   - We prune *only* the pairs the current build saw. A separate
 *     "abandoned source" sweep handles pairs that no longer appear in
 *     the build (renamed/deleted files); that's intentionally out of
 *     scope here so a buggy include-glob change can't accidentally
 *     drop the entire cache.
 *
 * The function is batched by locale: instead of one `list()` call per
 * pair (cheap individually, expensive per-build), it issues one call
 * per *locale* covering the whole `i18n/<locale>/` prefix and groups
 * the results in memory. For a build with 200 sources × 3 locales
 * that's 3 list calls instead of 600.
 *
 * Sort order is purely `lastModified`: the most-recently-written
 * variants survive. This matches operator intuition ("the build I
 * just ran doesn't get pruned") without us needing to thread the
 * current build's keys into the pruner — they're newest by definition.
 */

export interface PruneCacheByPairOptions {
  /** R2 client used for `list` and `del` operations. */
  r2: R2Client;
  /**
   * The (locale, sourcePath) pairs the build touched, encoded as
   * `locale::sourcePath`. The encoding is opaque to callers; build
   * with `encodeTouchedPair` so the pruner and the build hook stay
   * in sync.
   */
  touchedPairs: Iterable<string>;
  /**
   * Maximum hash variants to keep per (locale, sourcePath). `false`
   * disables pruning entirely (the build hook short-circuits before
   * calling this so the function still returns a zero-result if
   * forwarded a `false` by accident).
   */
  keepLastN: number | false;
}

export interface PruneResult {
  /** Total number of objects deleted across all pairs. */
  deleted: number;
  /**
   * The actual R2 keys deleted, in the order the pruner DELETE'd
   * them. Used by the build report (RFC §3.9 / M9.2) so reviewers
   * can audit retention behaviour. Empty when `deleted` is 0.
   */
  deletedKeys: string[];
  /**
   * Number of (locale, sourcePath) pairs that had at least one object
   * deleted. Pairs whose variant count was already <= `keepLastN`
   * don't contribute to this number.
   */
  prunedPairs: number;
  /**
   * Number of (locale, sourcePath) pairs the pruner considered. Equal
   * to `touchedPairs.size` minus any malformed entries the encoder
   * rejected.
   */
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

    // Group every list entry under this locale by the sourcePath
    // embedded in its key. The key shape is `i18n/<locale>/<src>#<hash>.md`;
    // we recover <src> by slicing after the prefix and before the
    // last "#". `lastIndexOf` (rather than a regex) tolerates the
    // theoretical case of `#` appearing inside a sourcePath, since
    // the trailing hash is the last `#` by construction.
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
      // Newest first. `lastModified` is a Date; subtracting via
      // `getTime` keeps the comparator stable.
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
