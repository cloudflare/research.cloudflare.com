/**
 * Build-report schema and helpers.
 *
 * The integration accumulates one `BuildReportEntry` per
 * (sourcePath, locale) pair the build touches, then emits the full
 * report at `astro:build:done` to `dist/i18n-r2-report.json`.
 *
 * Used as: an audit trail (what translated when, with which model
 * and glossary version), a debug aid (the `outcome` field explains
 * why a pair didn't produce fresh AI output), a CI artefact
 * (reviewers diff the report between PR builds), a cost-tracking
 * input (token totals), and a rollback aid (R2 keys for prior
 * translations).
 *
 * Pure module — no I/O at the data layer. `emitBuildReport`
 * handles disk writes; tests build reports in memory.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Outcome categories. Precedence: `override` > `skipped-no-translate`
 * (when no override) > `cache-hit` / `ai-translated` > `error`.
 */
/**
 * Outcome categories.
 *
 * `local-skipped` records that the on-disk staging index already had
 * a matching source-hash entry and the staged file was present, so
 * the run skipped the R2 GET and the staging write. Functionally a
 * cache hit at the filesystem-local layer (vs. `cache-hit` which is
 * R2-side); tracked separately so build reports can quantify how
 * much R2 traffic the local cache saved.
 */
export type BuildReportOutcome = "cache-hit" | "ai-translated" | "override" | "skipped-no-translate" | "local-skipped" | "error";

export interface BuildReportEntry {
  /** Source-relative path, normalised to forward slashes. */
  sourcePath: string;
  /** Target locale, e.g. `"pt-BR"`. */
  locale: string;
  /** Cache-key hash. Always present, even on `error` outcomes. */
  sourceHash: string;
  /** Full R2 object key. */
  r2Key: string;
  outcome: BuildReportOutcome;
  /**
   * Resolved model id. On override / skipped / pre-translation error
   * this is the model that WOULD have been used — keeps the field
   * non-nullable and surfaces the config in effect at build time.
   */
  model: string;
  /** Provider-reported token counts when available. */
  tokens?: { in: number; out: number };
  /** Wall-clock milliseconds from cache lookup through staging. */
  durationMs: number;
  /** On `error` outcome only. Stack traces stay in the build log. */
  errorMessage?: string;
}

export interface BuildReportPruning {
  /** R2 keys deleted this build. Empty when no pruning ran. */
  deletedKeys: string[];
  /** Per-locale deletion count for at-a-glance auditing. */
  byLocale: Record<string, number>;
}

export interface BuildReportTotals {
  cacheHits: number;
  aiTranslated: number;
  overrides: number;
  skipped: number;
  /**
   * Pairs the run skipped via the on-disk staging index — staged
   * file already current, no R2 GET needed. Separate from
   * `cacheHits` (which counts R2-side hits) so reports can
   * distinguish "saved an R2 round-trip" from "R2 reused".
   */
  localSkipped: number;
  errors: number;
  /** Undefined when no entry reported tokens (vs. summed-zero). */
  tokensIn?: number;
  tokensOut?: number;
}

export interface BuildReport {
  build: {
    /** ISO-8601 from integration setup. */
    startedAt: string;
    /** Wall-clock setup-start → build:done. */
    durationMs: number;
    mode: "standalone" | "starlight";
    polystellaVersion: string;
  };
  /** Full locale set INCLUDING the default. */
  locales: string[];
  defaultLocale: string;
  /** Per-locale glossary metadata; missing locales = no glossary. */
  glossaries: Record<string, { file: string; sha256: string }>;
  entries: BuildReportEntry[];
  totals: BuildReportTotals;
  pruning: BuildReportPruning;
}

/**
 * Compute totals from a flat entry list. Tokens are summed only when
 * AT LEAST ONE entry reported them — distinguishes "no entry was
 * instrumented" from "every entry was 0 tokens".
 */
export function computeBuildReportTotals(entries: ReadonlyArray<BuildReportEntry>): BuildReportTotals {
  let cacheHits = 0;
  let aiTranslated = 0;
  let overrides = 0;
  let skipped = 0;
  let localSkipped = 0;
  let errors = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let anyTokens = false;
  for (const entry of entries) {
    switch (entry.outcome) {
      case "cache-hit":
        cacheHits++;
        break;
      case "ai-translated":
        aiTranslated++;
        break;
      case "override":
        overrides++;
        break;
      case "skipped-no-translate":
        skipped++;
        break;
      case "local-skipped":
        localSkipped++;
        break;
      case "error":
        errors++;
        break;
    }
    if (entry.tokens) {
      anyTokens = true;
      tokensIn += entry.tokens.in;
      tokensOut += entry.tokens.out;
    }
  }
  const totals: BuildReportTotals = {
    cacheHits,
    aiTranslated,
    overrides,
    skipped,
    localSkipped,
    errors,
  };
  if (anyTokens) {
    totals.tokensIn = tokensIn;
    totals.tokensOut = tokensOut;
  }
  return totals;
}

export interface EmitBuildReportOptions {
  /** Astro project's `dist/` (or equivalent) output directory. */
  outDir: string;
  /** Filename within `outDir`. Defaults to `i18n-r2-report.json`. */
  filename?: string;
  report: BuildReport;
}

/**
 * Serialise and write the report. Two-space indent for diffability,
 * trailing newline for POSIX tooling. `mkdir({ recursive: true })`
 * defensively in case the output directory hasn't been created yet.
 */
export async function emitBuildReport(opts: EmitBuildReportOptions): Promise<string> {
  const filename = opts.filename ?? "i18n-r2-report.json";
  const target = path.resolve(opts.outDir, filename);
  await mkdir(path.dirname(target), { recursive: true });
  const json = `${JSON.stringify(opts.report, null, 2)}\n`;
  await writeFile(target, json, "utf8");
  return target;
}
