/**
 * Build-report schema and helpers (RFC §3.9 / M9.2).
 *
 * The integration accumulates one `BuildReportEntry` per
 * (sourcePath, locale) pair the build touches, then emits the full
 * `BuildReport` at `astro:build:done` to `dist/i18n-r2-report.json`.
 *
 * Why a structured report (rather than just log lines):
 *   - **Audit.** Per-pair record of what was translated, by which
 *     model, against which glossary version. Survives the build log
 *     getting truncated or rotated.
 *   - **Debug.** The `outcome` field explains why a pair didn't
 *     produce fresh AI output (cache hit, override, noTranslate,
 *     skipped, error).
 *   - **CI artefact.** Reviewers can diff the report between PR
 *     builds to confirm changes look right — most fields are stable
 *     across rebuilds, so the noisy fields (durations) cluster at
 *     the bottom of a meaningful diff.
 *   - **Cost tracking.** Token totals support per-build budgeting;
 *     correlate with R2 access logs for end-to-end cost attribution.
 *   - **Rollback aid.** The R2 key for any prior translation is
 *     recoverable from the report — restore by reverting the source
 *     change that produced a different hash.
 *
 * The schema mirrors what RFC §3.9 specified, with two evolutions
 * the implementation forced:
 *   - `pruning` is a separate top-level section (the RFC put it in
 *     the prose; making it an explicit object keeps it queryable).
 *   - `tokens` per entry is optional. The Workers AI provider
 *     doesn't always surface in/out token counts in its response
 *     envelope; we'd rather omit the field than report fabricated
 *     zeros.
 *
 * Pure module: no I/O. The integration calls `emitBuildReport` to
 * write to disk; tests build reports in memory and assert on the
 * shape directly.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Outcome categories. The ordering reflects priority for the
 * disambiguation rules:
 *   - `override` wins if a hand-translated file exists.
 *   - `skipped-no-translate` wins if the source has `noTranslate: true`
 *     AND no override is present.
 *   - `cache-hit` / `ai-translated` are the standard paths.
 *   - `error` records a failure that didn't produce staged bytes.
 */
export type BuildReportOutcome =
  | "cache-hit"
  | "ai-translated"
  | "override"
  | "skipped-no-translate"
  | "error";

export interface BuildReportEntry {
  /** Source-relative path, normalised to forward slashes. */
  sourcePath: string;
  /** Target locale, e.g. `"pt-BR"`. */
  locale: string;
  /**
   * The (file, locale) hash that keys the R2 cache. Always present —
   * even on `error` outcomes the hash was computed before the
   * failure (the failure happened during translation or staging,
   * after hashing).
   */
  sourceHash: string;
  /** Full R2 object key — convenient for spelunking the bucket. */
  r2Key: string;
  outcome: BuildReportOutcome;
  /**
   * Resolved model id used for this pair. On override / skipped /
   * pre-translation error, this is the model that WOULD have been
   * used; recording it keeps the field non-nullable and lets a
   * reviewer see the configuration in effect at the time of build.
   */
  model: string;
  /** Workers AI / Anthropic token counts when the provider reports them. */
  tokens?: { in: number; out: number };
  /** Wall-clock milliseconds from cache lookup through staging. */
  durationMs: number;
  /**
   * On `error` outcome only: the error message. Stack traces are
   * deliberately omitted — they're noisy for a CI artefact and the
   * build log carries them with full context.
   */
  errorMessage?: string;
}

export interface BuildReportPruning {
  /**
   * R2 keys deleted by the count-based pruner this build. Empty
   * array when no pruning ran (e.g. `keepLastN: false`, or no
   * touched pairs had stale variants).
   */
  deletedKeys: string[];
  /**
   * Per-locale count of deletions. Useful for spotting "we
   * accidentally pruned 200 entries from one locale" kinds of
   * mistakes at a glance.
   */
  byLocale: Record<string, number>;
}

export interface BuildReportTotals {
  cacheHits: number;
  aiTranslated: number;
  overrides: number;
  skipped: number;
  errors: number;
  /** Sum across entries; undefined if no entry reported tokens. */
  tokensIn?: number;
  /** Sum across entries; undefined if no entry reported tokens. */
  tokensOut?: number;
}

export interface BuildReport {
  build: {
    /** ISO-8601; pinned at integration setup, not at build:done. */
    startedAt: string;
    /** Wall-clock milliseconds from setup-start to build:done. */
    durationMs: number;
    /** PolyStella mode this build ran in: standalone vs starlight. */
    mode: "standalone" | "starlight";
    /** Package version that produced the report — debug aid. */
    polystellaVersion: string;
  };
  /** Full locale set the build covered, INCLUDING the default. */
  locales: string[];
  defaultLocale: string;
  /**
   * Per-locale glossary metadata. Keys are locales; missing locales
   * mean no glossary was configured for that locale (legitimate).
   */
  glossaries: Record<string, { file: string; sha256: string }>;
  entries: BuildReportEntry[];
  totals: BuildReportTotals;
  pruning: BuildReportPruning;
}

/**
 * Compute totals from a flat entry list. Pure; tests pin the
 * arithmetic so a regression here would be visible in the diff.
 *
 * Tokens are summed only when AT LEAST ONE entry reported them —
 * we don't fabricate zeros for entries the provider didn't
 * instrument, and we don't report `tokensIn: 0` if no entry
 * carried tokens at all (that would imply the build produced no
 * tokens, when the truth is we didn't measure).
 */
export function computeBuildReportTotals(
  entries: ReadonlyArray<BuildReportEntry>,
): BuildReportTotals {
  let cacheHits = 0;
  let aiTranslated = 0;
  let overrides = 0;
  let skipped = 0;
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
 * Serialise and write the report. Two-space indent for diffability;
 * trailing newline for POSIX-friendly tooling.
 *
 * Uses `mkdir({ recursive: true })` defensively — the report is
 * emitted at `astro:build:done` after Astro itself has written
 * `dist/`, so the directory should exist, but a misconfigured
 * `outDir` (or a future Astro change to the build order) shouldn't
 * surface as an obscure ENOENT.
 */
export async function emitBuildReport(
  opts: EmitBuildReportOptions,
): Promise<string> {
  const filename = opts.filename ?? "i18n-r2-report.json";
  const target = path.resolve(opts.outDir, filename);
  await mkdir(path.dirname(target), { recursive: true });
  const json = `${JSON.stringify(opts.report, null, 2)}\n`;
  await writeFile(target, json, "utf8");
  return target;
}
