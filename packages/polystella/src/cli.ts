#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * `polystella` — single CLI entry point with verb-style subcommands:
 *
 *   polystella translate      Run the markdown translation pipeline.
 *   polystella check-ui       Detect drift in UI-string JSONs.
 *   polystella sync-ui        Reconcile UI-string JSON key sets.
 *   polystella translate-ui   Sync + AI-fill empty placeholders.
 *
 * The pre-rename binary `polystella-translate` is gone — this is a
 * breaking change documented in the package README and AGENTS.md.
 * The legacy `pnpm translate` shell script in the host project now
 * invokes `polystella translate` to preserve operator muscle memory.
 *
 * Dispatch is a thin layer: each subcommand owns its argv parsing and
 * `runX(args, deps)` handler. This file only routes.
 */

import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { resolveOptions, type PolyStellaResolvedOptions } from "./config/options.js";
import { computeBuildReportTotals, emitBuildReport, type BuildReport } from "./storage/report.js";
import { DEFAULT_STAGING_DIR } from "./storage/paths.js";
import { runTranslationPass, type Logger } from "./translation/run.js";
import { POLYSTELLA_VERSION } from "./version.js";

import { loadAstroI18n, loadPolystellaConfig } from "./cli/i18n-config.js";
import { parseCheckUiArgs, runCheckUi, CHECK_UI_USAGE } from "./cli/check-ui.js";
import { parseSyncUiArgs, runSyncUi, SYNC_UI_USAGE } from "./cli/sync-ui.js";
import { parseTranslateUiArgs, runTranslateUi, TRANSLATE_UI_USAGE } from "./cli/translate-ui.js";

// ---------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------

export type Subcommand = "translate" | "check-ui" | "sync-ui" | "translate-ui";

export const TOP_LEVEL_USAGE = `polystella v${POLYSTELLA_VERSION}

Astro integration for AI-driven content + UI-string localization.

Usage:
  polystella <subcommand> [flags]

Subcommands:
  translate       Run the markdown translation pipeline (R2 cache, AI provider).
  check-ui        Detect drift in UI-string JSONs. Runs offline.
  sync-ui         Reconcile UI-string key sets (add missing as empty,
                  remove extras). Runs offline.
  translate-ui    sync-ui, then AI-fill empty placeholders via the
                  configured provider.

Run \`polystella <subcommand> --help\` for subcommand-specific flags.

Top-level flags:
  --help, -h      Print this message.
  --version, -v   Print the CLI version.
`;

export interface SubcommandDispatch {
  /** Parsed subcommand name. `"help"` for top-level help; `"unknown"` for an unrecognised first arg. */
  name: Subcommand | "help" | "version" | "unknown";
  /** First-arg literal when `name === "unknown"`, for error reporting. */
  raw?: string;
  /** Remaining argv to forward to the subcommand's own parser. */
  rest: string[];
}

/**
 * Peel the subcommand off argv. Top-level `--help` / `-h` /
 * `--version` / `-v` short-circuit. Subcommand names are
 * case-sensitive and exact.
 */
export function parseSubcommand(argv: ReadonlyArray<string>): SubcommandDispatch {
  if (argv.length === 0) {
    return { name: "help", rest: [] };
  }
  const first = argv[0];
  if (first === undefined) return { name: "help", rest: [] };
  if (first === "--help" || first === "-h") {
    return { name: "help", rest: argv.slice(1) };
  }
  if (first === "--version" || first === "-v") {
    return { name: "version", rest: argv.slice(1) };
  }
  if (first === "translate" || first === "check-ui" || first === "sync-ui" || first === "translate-ui") {
    return { name: first, rest: argv.slice(1) };
  }
  return { name: "unknown", raw: first, rest: argv.slice(1) };
}

// ---------------------------------------------------------------
// `translate` subcommand
//
// This is the original markdown-translation orchestrator. The argv
// parser, branch resolver, and option overrides used to be the
// only CLI surface and are still exported under their original
// names because external callers (and tests) consume them directly.
// ---------------------------------------------------------------

export interface TranslateCliArgs {
  branch?: string;
  prefix?: string;
  dryRun: boolean;
  locale?: string;
  file?: string;
  reportPath?: string;
  help: boolean;
}

export const TRANSLATE_USAGE = `polystella translate

Run the translation pipeline outside an Astro build. Reads
\`astro.config.mjs\` and \`polystella.config.mjs\` from the current
working directory, then walks sources, translates, caches, and stages
results under \`<root>/.astro/i18n-staging\` — exactly as \`astro
build\` would.

Usage:
  polystella translate [flags]

Flags:
  --branch <name>     Set process.env.WORKERS_CI_BRANCH before loading
                      the config. Useful for targeting a specific
                      branch's R2 prefix when the config is branch-
                      aware. Example: \`--branch main\`.
  --prefix <prefix>   Override the resolved \`r2.prefix\` after the
                      config loads. Escape hatch for one-off targets
                      the branch-dispatch logic doesn't produce. Must
                      end with \`/\`.
  --dry-run           Skip provider + R2 writes; only log the planned
                      key set. Same effect as \`dryRun: true\` in
                      polystella.config.mjs.
  --locale <code>     Restrict the run to one target locale. Errors
                      if the locale isn't declared in Astro's i18n.
  --file <glob>       Replace \`include\` with this single glob.
                      Useful for re-translating one file without a
                      full sweep.
  --report <path>     Emit the build report to a custom path (default:
                      \`./i18n-r2-report.json\` in the project root).
  --help              Print this message.

Exit codes:
  0  every (file, locale) pair succeeded (cache hit, override, or
     fresh translation).
  1  config error (bad flags, missing astro.config.mjs, etc).
  2  one or more (file, locale) pairs failed during translation.
`;

/**
 * Parse argv → TranslateCliArgs. Throws on unknown flag or missing
 * value (accept-then-reject would silently swallow typos).
 *
 * Argv must NOT include the leading "translate" subcommand token —
 * the dispatcher peels that off before calling.
 */
export function parseTranslateArgs(argv: ReadonlyArray<string>): TranslateCliArgs {
  const out: TranslateCliArgs = { dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case "--":
        continue;
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--branch": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) {
          throw new Error(`--branch requires a value (got: ${value ?? "<end>"})`);
        }
        out.branch = value;
        break;
      }
      case "--prefix": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) {
          throw new Error(`--prefix requires a value (got: ${value ?? "<end>"})`);
        }
        out.prefix = value;
        break;
      }
      case "--locale": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) {
          throw new Error(`--locale requires a value (got: ${value ?? "<end>"})`);
        }
        out.locale = value;
        break;
      }
      case "--file": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) {
          throw new Error(`--file requires a value (got: ${value ?? "<end>"})`);
        }
        out.file = value;
        break;
      }
      case "--report": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) {
          throw new Error(`--report requires a value (got: ${value ?? "<end>"})`);
        }
        out.reportPath = value;
        break;
      }
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return out;
}

/** Console-backed logger matching Astro's channel contract. */
const cliLogger: Logger = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
  // Default to silent debug; `LOG_LEVEL=debug` opts in.
  debug: process.env["LOG_LEVEL"] === "debug" ? (msg) => console.log(msg) : () => {},
};

/** Apply translate-subcommand flag overrides to a resolved options object. */
export function applyCliOverrides(resolved: PolyStellaResolvedOptions, args: TranslateCliArgs): PolyStellaResolvedOptions {
  let next = resolved;

  if (args.dryRun) {
    next = { ...next, dryRun: true };
  }

  if (args.locale !== undefined) {
    if (!next.locales.includes(args.locale)) {
      throw new Error(
        `--locale ${args.locale} not declared in Astro's i18n.locales (declared: ${next.locales.join(", ")} + default ${next.defaultLocale})`,
      );
    }
    next = { ...next, locales: [args.locale] };
  }

  if (args.file !== undefined) {
    next = { ...next, include: [args.file] };
  }

  if (args.prefix !== undefined) {
    if (!next.r2) {
      throw new Error("--prefix requires `r2` to be configured in polystella.config.mjs");
    }
    if (args.prefix.length > 0 && !args.prefix.endsWith("/")) {
      throw new Error(`--prefix must end with "/" (got: ${JSON.stringify(args.prefix)})`);
    }
    next = {
      ...next,
      r2: { ...next.r2, prefix: args.prefix },
    };
  }

  return next;
}

/**
 * Current git branch via `git rev-parse --abbrev-ref HEAD`. Returns
 * `null` on: git not on PATH, no `.git/`, detached HEAD, empty
 * output. Used to default `--branch` so `polystella translate` from
 * a feature branch writes to the matching preview prefix.
 */
export function detectGitBranch(): string | null {
  let raw: string;
  try {
    raw = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "HEAD") return null;
  return trimmed;
}

/**
 * Branch precedence: `--branch` flag → `WORKERS_CI_BRANCH` env →
 * `gitBranchProvider()`. Returns `{ ok, reason }` instead of throwing
 * so the caller formats remediation hints uniformly.
 */
export function resolveCliBranch(args: {
  flag: string | undefined;
  envBranch: string | undefined;
  gitBranchProvider: () => string | null;
}): { ok: true; branch: string; source: "flag" | "env" | "git" } | { ok: false; reason: string } {
  if (args.flag !== undefined) {
    return { ok: true, branch: args.flag, source: "flag" };
  }
  if (args.envBranch !== undefined && args.envBranch.length > 0) {
    return { ok: true, branch: args.envBranch, source: "env" };
  }
  const detected = args.gitBranchProvider();
  if (detected !== null) {
    return { ok: true, branch: detected, source: "git" };
  }
  return {
    ok: false,
    reason:
      "couldn't detect current git branch (detached HEAD, missing .git, or git unavailable). Pass --branch <name> explicitly to target a specific R2 prefix.",
  };
}

async function runTranslateSubcommand(rest: ReadonlyArray<string>): Promise<number> {
  let args: TranslateCliArgs;
  try {
    args = parseTranslateArgs(rest);
  } catch (err) {
    console.error(`[polystella] ${(err as Error).message}\n`);
    console.error(TRANSLATE_USAGE);
    return 1;
  }

  if (args.help) {
    console.log(TRANSLATE_USAGE);
    return 0;
  }

  // Mark CLI dispatch BEFORE the config imports — config reads this
  // to allow R2 writes from outside CI.
  process.env["POLYSTELLA_CLI"] = "1";

  const branchResolution = resolveCliBranch({
    flag: args.branch,
    envBranch: process.env["WORKERS_CI_BRANCH"],
    gitBranchProvider: detectGitBranch,
  });
  if (!branchResolution.ok) {
    console.error(`[polystella] ${branchResolution.reason}`);
    return 1;
  }
  process.env["WORKERS_CI_BRANCH"] = branchResolution.branch;
  if (branchResolution.source === "git") {
    console.log(`[polystella] no --branch / WORKERS_CI_BRANCH; using current git branch: ${branchResolution.branch}`);
  }

  const cwd = process.cwd();

  let resolved: PolyStellaResolvedOptions;
  try {
    const [i18n, polyConfig] = await Promise.all([loadAstroI18n(cwd), loadPolystellaConfig(cwd)]);
    resolved = resolveOptions(polyConfig, i18n);
  } catch (err) {
    console.error(`[polystella] ${(err as Error).message}`);
    return 1;
  }

  try {
    resolved = applyCliOverrides(resolved, args);
  } catch (err) {
    console.error(`[polystella] ${(err as Error).message}`);
    return 1;
  }

  const stagingDir = path.resolve(cwd, DEFAULT_STAGING_DIR);
  await mkdir(stagingDir, { recursive: true });

  cliLogger.info(
    `polystella translate v${POLYSTELLA_VERSION}: locales=${[resolved.defaultLocale, ...resolved.locales].join(", ")}, dryRun=${resolved.dryRun}, prefix=${resolved.r2?.prefix ?? "<no r2>"}`,
  );

  const controller = new AbortController();
  let interruptCount = 0;
  const onSignal = (signal: NodeJS.Signals) => {
    interruptCount++;
    if (interruptCount === 1) {
      cliLogger.warn(`received ${signal} — cancelling in-flight translations…`);
      controller.abort(new Error(`cancelled by ${signal}`));
    } else {
      cliLogger.error(`received ${signal} again — exiting now`);
      process.exit(130);
    }
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  let result;
  try {
    result = await runTranslationPass({
      resolved,
      rootDir: cwd,
      stagingDir,
      logger: cliLogger,
      polystellaVersion: POLYSTELLA_VERSION,
      signal: controller.signal,
    });
  } catch (err) {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (controller.signal.aborted) {
      cliLogger.warn(`translation pass aborted: ${(err as Error).message}`);
      return 130;
    }
    throw err;
  }
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);

  if (result.liveRan && result.entries.length > 0) {
    const report: BuildReport = {
      build: {
        startedAt: new Date().toISOString(),
        durationMs: 0,
        mode: resolved.mode === "starlight" ? "starlight" : "standalone",
        polystellaVersion: POLYSTELLA_VERSION,
      },
      locales: [resolved.defaultLocale, ...resolved.locales],
      defaultLocale: resolved.defaultLocale,
      glossaries: result.glossariesForReport,
      entries: result.entries,
      totals: computeBuildReportTotals(result.entries),
      pruning: result.pruning,
    };
    const reportTarget = args.reportPath ? path.resolve(cwd, args.reportPath) : path.resolve(cwd, "i18n-r2-report.json");
    try {
      const reportPath = await emitBuildReport({
        outDir: path.dirname(reportTarget),
        filename: path.basename(reportTarget),
        report,
      });
      cliLogger.info(
        `i18n build report: ${path.relative(cwd, reportPath)} (${report.entries.length} entries, ${report.totals.cacheHits} hit / ${report.totals.aiTranslated} miss / ${report.totals.overrides} override / ${report.totals.errors} error)`,
      );
    } catch (err) {
      cliLogger.warn(`i18n build report: failed to write: ${(err as Error).message}`);
    }
  }

  return result.counts.failed > 0 ? 2 : 0;
}

// ---------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const dispatch = parseSubcommand(argv);

  if (dispatch.name === "version") {
    console.log(POLYSTELLA_VERSION);
    return 0;
  }
  if (dispatch.name === "help") {
    console.log(TOP_LEVEL_USAGE);
    return 0;
  }
  if (dispatch.name === "unknown") {
    console.error(`[polystella] unknown subcommand: ${dispatch.raw ?? "<empty>"}\n`);
    console.error(TOP_LEVEL_USAGE);
    return 1;
  }

  const cwd = process.cwd();
  switch (dispatch.name) {
    case "translate":
      return runTranslateSubcommand(dispatch.rest);
    case "check-ui": {
      let args;
      try {
        args = parseCheckUiArgs(dispatch.rest);
      } catch (err) {
        console.error(`[polystella] ${(err as Error).message}\n`);
        console.error(CHECK_UI_USAGE);
        return 1;
      }
      return runCheckUi(args, {
        cwd,
        log: (msg) => console.log(msg),
        err: (msg) => console.error(msg),
      });
    }
    case "sync-ui": {
      let args;
      try {
        args = parseSyncUiArgs(dispatch.rest);
      } catch (err) {
        console.error(`[polystella] ${(err as Error).message}\n`);
        console.error(SYNC_UI_USAGE);
        return 1;
      }
      return runSyncUi(args, {
        cwd,
        log: (msg) => console.log(msg),
        err: (msg) => console.error(msg),
      });
    }
    case "translate-ui": {
      let args;
      try {
        args = parseTranslateUiArgs(dispatch.rest);
      } catch (err) {
        console.error(`[polystella] ${(err as Error).message}\n`);
        console.error(TRANSLATE_UI_USAGE);
        return 1;
      }
      return runTranslateUi(args, {
        cwd,
        log: (msg) => console.log(msg),
        warn: (msg) => console.warn(msg),
        err: (msg) => console.error(msg),
      });
    }
  }
}

// Run if invoked directly. `import.meta.url` check keeps the module
// importable from tests.
const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error("[polystella] unexpected error:", err);
      process.exit(2);
    },
  );
}
