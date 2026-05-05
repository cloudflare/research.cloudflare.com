import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Translation overrides — checked-in human edits at
 * `<rootDir>/<overridesDir>/<locale>/<relativeSourcePath>` that
 * take precedence over both cache and translator. Staged verbatim;
 * never cached in R2 (source-controlled, not machine-generated).
 *
 * Path mirrors source layout including extension: `.mdx` source
 * → `.mdx` override.
 */

export interface ReadOverrideOptions {
  /** Absolute project root. */
  rootDir: string;
  /** Resolved-options `overridesDir`, e.g. `"./i18n/overrides"`. */
  overridesDir: string;
  /** Target locale. */
  locale: string;
  /** Path relative to `sourceDir`. */
  relativeSourcePath: string;
}

/**
 * Returns file contents on hit, `null` on miss. Errors other than
 * ENOENT propagate so permission problems surface loudly.
 */
export async function readOverride(opts: ReadOverrideOptions): Promise<string | null> {
  const overridePath = resolveOverridePath(opts);
  try {
    return await readFile(overridePath, "utf8");
  } catch (err) {
    if (isNodeNotFoundError(err)) return null;
    throw err;
  }
}

/** Absolute path; exposed so callers can log it without duplicating the join. */
export function resolveOverridePath(opts: ReadOverrideOptions): string {
  return path.resolve(opts.rootDir, opts.overridesDir, opts.locale, opts.relativeSourcePath);
}

function isNodeNotFoundError(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
}
