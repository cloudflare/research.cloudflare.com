/**
 * Build-time drift detection for UI-string dictionaries.
 *
 * The contract: every locale declared in Astro's `i18n.locales` must
 * have a JSON file under `src/content/i18n/<locale>.json` with the
 * same key set as the default-locale file. Missing keys, extra keys,
 * and missing files are all hard-failures — a build that passed
 * drift detection has guaranteed parity, so the runtime translator
 * (`useTranslations`) doesn't need to handle the missing-key path
 * for drift-related reasons.
 *
 * Detection runs at `astro:config:setup` so failures land before the
 * build does any other work — the operator sees the missing-keys
 * list in the first build log line, not after a multi-minute build
 * succeeds with stale strings.
 *
 * Silent no-op when the operator hasn't authored UI strings yet
 * (no default-locale JSON file exists). The cost of authoring per-
 * page UI strings is real and we don't want to force consumers to
 * stub out empty JSON files just to satisfy the integration. Once
 * the default-locale JSON appears, drift detection activates.
 *
 * The pure detection logic is split from the disk-loading logic so
 * tests can pin behaviour without writing JSON to a tmp dir.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Single-locale issue surfaced by `checkI18nDrift`. One issue per
 * locale that has a problem; an empty `issues` array means the
 * dictionaries are in sync.
 */
export interface DriftIssue {
  locale: string;
  /**
   * Keys present in the default-locale dictionary but missing from
   * this locale's dictionary. A non-empty list means consumer pages
   * referencing those keys would fall through to the default-locale
   * fallback at runtime — usable, but a sign the translator hasn't
   * caught up.
   */
  missing: string[];
  /**
   * Keys present in this locale's dictionary but absent from the
   * default. Indicates a typo or a stale entry in the locale file
   * that should be removed (or added to the default).
   */
  extra: string[];
  /**
   * `true` when the locale's JSON file is missing entirely (the
   * operator added a locale to `i18n.locales` but hasn't authored
   * the UI-strings file yet). `missing` will list every default-
   * locale key in this case so the operator can copy-paste the
   * starter set into the new file.
   */
  missingFile: boolean;
}

export interface DriftCheckInput {
  /** The site's source/canonical locale, as derived from `config.i18n`. */
  defaultLocale: string;
  /**
   * The full list of locales the site declares (including the
   * default). The detector skips the default in its loop — any
   * key drift between "default vs. default" is by definition zero.
   */
  locales: ReadonlyArray<string>;
  /**
   * Loaded dictionaries keyed by locale name. A locale missing from
   * this map is treated as "file not on disk" (sets `missingFile:
   * true` in the issue). The map's values are flat
   * `Record<string, string>`s, matching the loader's schema.
   */
  dictionaries: Record<string, Record<string, string>>;
}

export interface DriftCheckResult {
  /** Convenience flag; equivalent to `issues.length === 0`. */
  ok: boolean;
  /** One entry per locale that has a problem; empty when no drift. */
  issues: DriftIssue[];
}

/**
 * Pure drift-detection over loaded dictionaries. Exported so tests
 * can construct synthetic input without touching disk; the
 * integration's setup hook loads from disk and feeds in.
 *
 * Edge cases:
 *   - No default-locale dictionary in `dictionaries`: returns
 *     `{ ok: true, issues: [] }` silently. The operator hasn't
 *     authored UI strings yet; drift is only meaningful once the
 *     default exists. Loud-failing here would force every consumer
 *     to author at least an empty JSON to satisfy the integration,
 *     which trades silent drift for noisy onboarding.
 *   - Default locale's dictionary is empty (`{}`): every other
 *     locale must also be empty to pass. Effectively forces the
 *     operator to keep all dictionaries in sync from the moment they
 *     start authoring.
 */
export function checkI18nDrift(input: DriftCheckInput): DriftCheckResult {
  const defaultDict = input.dictionaries[input.defaultLocale];
  if (defaultDict === undefined) {
    return { ok: true, issues: [] };
  }
  const defaultKeys = new Set(Object.keys(defaultDict));
  const issues: DriftIssue[] = [];

  for (const locale of input.locales) {
    if (locale === input.defaultLocale) continue;
    const localeDict = input.dictionaries[locale];
    if (localeDict === undefined) {
      issues.push({
        locale,
        missing: [...defaultKeys].sort(),
        extra: [],
        missingFile: true,
      });
      continue;
    }
    const localeKeys = new Set(Object.keys(localeDict));
    const missing = [...defaultKeys]
      .filter((k) => !localeKeys.has(k))
      .sort();
    const extra = [...localeKeys]
      .filter((k) => !defaultKeys.has(k))
      .sort();
    if (missing.length > 0 || extra.length > 0) {
      issues.push({
        locale,
        missing,
        extra,
        missingFile: false,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Format a `DriftCheckResult.issues` list into a human-readable
 * multi-line message suitable for inclusion in a thrown error. The
 * shape mirrors the engineering-plan promise:
 *
 *   Missing keys in pt-BR.json: foo, bar
 *   Extra keys in pt-BR.json: baz
 *
 * Splits the format into a separate function so the integration's
 * hook builds the error message identically to what tests assert on,
 * and so a future CI presenter can re-use it without re-running the
 * check.
 */
export function formatDriftIssues(issues: ReadonlyArray<DriftIssue>): string {
  if (issues.length === 0) return "";
  const lines: string[] = [];
  for (const issue of issues) {
    if (issue.missingFile) {
      lines.push(
        `  • ${issue.locale}: file is missing. Create it and copy these keys (values are placeholders for translation):`,
      );
      for (const key of issue.missing) {
        lines.push(`      "${key}": ""`);
      }
      continue;
    }
    if (issue.missing.length > 0) {
      lines.push(
        `  • Missing keys in ${issue.locale}.json: ${issue.missing.join(
          ", ",
        )}`,
      );
    }
    if (issue.extra.length > 0) {
      lines.push(
        `  • Extra keys in ${issue.locale}.json (not in default-locale file): ${issue.extra.join(
          ", ",
        )}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Disk-loading wrapper. Reads `<rootDir>/<baseDir>/<locale>.json`
 * for each declared locale (skipping silently when the file doesn't
 * exist; the pure check then categorises that locale as
 * `missingFile`). Hard-fails on malformed JSON because that's a
 * fix-by-hand bug, not a transient state.
 *
 * Used by the integration's `astro:config:setup` hook. Operator-
 * facing errors flow through `formatDriftIssues` for consistency.
 */
export interface LoadAndCheckDriftOptions {
  /** Astro project root (absolute filesystem path). */
  rootDir: string;
  /**
   * UI-strings base directory relative to the project root. Default
   * matches the Starlight convention (`./src/content/i18n`); kept
   * configurable so consumers with non-standard layouts (e.g.
   * monorepos with shared dictionaries) can override.
   */
  baseDir: string;
  /** Full locale set including the default. */
  locales: ReadonlyArray<string>;
  /** Source/canonical locale. */
  defaultLocale: string;
}

export async function loadAndCheckDrift(
  opts: LoadAndCheckDriftOptions,
): Promise<DriftCheckResult> {
  const dictionaries: Record<string, Record<string, string>> = {};
  for (const locale of opts.locales) {
    const filePath = path.resolve(
      opts.rootDir,
      opts.baseDir,
      `${locale}.json`,
    );
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // Missing file — the pure check categorises as missingFile.
        continue;
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `[polystella] failed to parse UI-strings JSON at ${filePath}: ${
          (err as Error).message
        }`,
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        `[polystella] UI-strings file at ${filePath} must be a JSON object of string→string entries (got ${
          Array.isArray(parsed) ? "array" : typeof parsed
        }).`,
      );
    }
    // We accept the parsed object as-is for drift purposes; the
    // schema (i18nSchema) validates value types at content-sync
    // time. The drift check itself only cares about the key sets,
    // so a non-string value here doesn't break anything we test.
    dictionaries[locale] = parsed as Record<string, string>;
  }
  return checkI18nDrift({
    defaultLocale: opts.defaultLocale,
    locales: opts.locales,
    dictionaries,
  });
}
