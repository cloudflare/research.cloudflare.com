/**
 * Build-time drift detection for UI-string dictionaries.
 *
 * Every locale declared in Astro's `i18n.locales` must have a JSON
 * file under `src/content/i18n/<locale>.json` with the same key set
 * as the default-locale file. Missing keys, extra keys, and missing
 * files are all hard-failures — a build that passed drift detection
 * has guaranteed parity, so the runtime translator's missing-key
 * fallback only fires on transient in-tree edits.
 *
 * Detection runs at `astro:config:setup` so failures surface before
 * the build does any other work. Silent no-op when the operator
 * hasn't authored UI strings yet (no default-locale JSON file
 * exists) — onboarding stays incremental.
 *
 * Pure detection split from disk-loading so tests can pin behaviour
 * without writing JSON to a tmpdir.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export interface DriftIssue {
  locale: string;
  /** Default-locale keys missing from this locale. */
  missing: string[];
  /** Keys in this locale absent from the default. */
  extra: string[];
  /**
   * `true` when the locale's JSON file is absent entirely. `missing`
   * lists every default-locale key for copy-paste seeding.
   */
  missingFile: boolean;
}

export interface DriftCheckInput {
  defaultLocale: string;
  /** Full set INCLUDING the default. */
  locales: ReadonlyArray<string>;
  /** Locale → dict. Missing key = file not on disk. */
  dictionaries: Record<string, Record<string, string>>;
}

export interface DriftCheckResult {
  /** Equivalent to `issues.length === 0`. */
  ok: boolean;
  issues: DriftIssue[];
}

/**
 * Pure drift check. No-default-locale-dict returns `ok` silently so
 * onboarding doesn't require stub JSON. Empty default dict forces
 * every other locale to be empty too.
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
    const missing = [...defaultKeys].filter((k) => !localeKeys.has(k)).sort();
    const extra = [...localeKeys].filter((k) => !defaultKeys.has(k)).sort();
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
 * Format issues into a human-readable error message:
 *
 *   Missing keys in pt-BR.json: foo, bar
 *   Extra keys in pt-BR.json (not in default-locale file): baz
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
        `  • Missing keys in ${issue.locale}.json: ${issue.missing.join(", ")}`,
      );
    }
    if (issue.extra.length > 0) {
      lines.push(
        `  • Extra keys in ${
          issue.locale
        }.json (not in default-locale file): ${issue.extra.join(", ")}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Disk-loading wrapper. Reads `<rootDir>/<baseDir>/<locale>.json` for
 * each declared locale; missing files become `missingFile` issues.
 * Hard-fails on malformed JSON.
 */
export interface LoadAndCheckDriftOptions {
  /** Absolute project root. */
  rootDir: string;
  /** Relative to project root. */
  baseDir: string;
  /** Full locale set INCLUDING the default. */
  locales: ReadonlyArray<string>;
  defaultLocale: string;
}

export async function loadAndCheckDrift(
  opts: LoadAndCheckDriftOptions,
): Promise<DriftCheckResult> {
  const dictionaries: Record<string, Record<string, string>> = {};
  for (const locale of opts.locales) {
    const filePath = path.resolve(opts.rootDir, opts.baseDir, `${locale}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
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
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error(
        `[polystella] UI-strings file at ${filePath} must be a JSON object of string→string entries (got ${
          Array.isArray(parsed) ? "array" : typeof parsed
        }).`,
      );
    }
    // Drift only cares about key sets; value-type validation lives
    // in `i18nSchema` at content-sync time.
    dictionaries[locale] = parsed as Record<string, string>;
  }
  return checkI18nDrift({
    defaultLocale: opts.defaultLocale,
    locales: opts.locales,
    dictionaries,
  });
}
