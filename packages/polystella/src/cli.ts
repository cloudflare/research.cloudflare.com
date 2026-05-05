#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * `polystella-translate` — standalone CLI runner for the translation
 * pipeline. Loads the project's `astro.config.mjs` (for the
 * `i18n` block) and `polystella.config.mjs`, then invokes
 * `runTranslationPass` with the same orchestration logic the Astro
 * integration uses.
 *
 * Designed to be called via `pnpm translate` from the project root;
 * the workspace's `tsx` bin handles the TypeScript runtime so this
 * file can stay alongside the rest of polystella's source.
 *
 * Flag contract is enforced via `parseCliArgs`. Every flag has a
 * single, documented effect on the resolved options; the CLI never
 * mutates the actual config files on disk.
 */

import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { resolveOptions, type AstroI18nLike, type PolyStellaResolvedOptions } from "./config/options.js";
import { computeBuildReportTotals, emitBuildReport, type BuildReport } from "./storage/report.js";
import { DEFAULT_STAGING_DIR } from "./storage/paths.js";
import { runTranslationPass, type Logger } from "./translation/run.js";

const POLYSTELLA_VERSION = "0.2.0";

interface CliArgs {
  branch?: string;
  prefix?: string;
  dryRun: boolean;
  locale?: string;
  file?: string;
  reportPath?: string;
  help: boolean;
}

const USAGE = `polystella-translate

Run the translation pipeline outside an Astro build. Reads
\`astro.config.mjs\` and \`polystella.config.mjs\` from the current
working directory, then walks sources, translates, caches, and stages
results under \`<root>/.astro/i18n-staging\` — exactly as \`astro
build\` would.

Usage:
  polystella-translate [flags]

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
 * Parse argv into a typed CliArgs. Throws (with a usage hint) on any
 * unknown flag or missing required value — accept-then-reject would
 * silently swallow typos.
 */
export function parseCliArgs(argv: ReadonlyArray<string>): CliArgs {
  const out: CliArgs = { dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      // POSIX-style "end of options" separator. pnpm/npm forward it
      // through script invocations (`pnpm translate -- --branch x`),
      // and our CLI takes no positional args, so silently dropping
      // it keeps both invocation styles working.
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

/**
 * Console-backed logger. Channels match the Astro logger's contract
 * (info → stderr keeps stdout clean for downstream piping; we mirror
 * Astro's choice of stdout for info to match operator expectations
 * during interactive runs).
 */
const cliLogger: Logger = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
  // Default to silent debug; `LOG_LEVEL=debug` opts in.
  debug: process.env["LOG_LEVEL"] === "debug" ? (msg) => console.log(msg) : () => {},
};

/**
 * Load `astro.config.mjs` from `cwd` and pluck out the bits
 * `resolveOptions` needs (just `i18n`). Defined here rather than
 * inlining to keep `main()` readable and to make the failure mode
 * explicit (the config could be a function, a default-export object,
 * or async — we handle the common cases).
 */
async function loadAstroI18n(cwd: string): Promise<AstroI18nLike | undefined> {
  const candidatePath = path.resolve(cwd, "astro.config.mjs");
  let module: { default?: unknown };
  try {
    module = await import(pathToFileURL(candidatePath).href);
  } catch (err) {
    throw new Error(`failed to load ${candidatePath}: ${(err as Error).message}`);
  }
  // Astro's `defineConfig` is a no-op identity wrapper, so the
  // default export is plain object-shaped. We support both `default`
  // and a top-level `i18n` (defensive, though Astro itself only
  // accepts the default-export form).
  const exported = module.default ?? module;
  if (typeof exported !== "object" || exported === null) {
    return undefined;
  }
  const i18n = (exported as { i18n?: unknown }).i18n;
  if (typeof i18n !== "object" || i18n === null) {
    return undefined;
  }
  return i18n as AstroI18nLike;
}

/** Load `polystella.config.mjs` from `cwd` (default-export only). */
async function loadPolystellaConfig(cwd: string): Promise<unknown> {
  const candidatePath = path.resolve(cwd, "polystella.config.mjs");
  try {
    const module = (await import(pathToFileURL(candidatePath).href)) as {
      default: unknown;
    };
    return module.default;
  } catch (err) {
    throw new Error(`failed to load ${candidatePath}: ${(err as Error).message}`);
  }
}

/**
 * Apply CLI flag overrides to an already-resolved options object.
 * Lives outside `main()` so it's testable in isolation — the
 * branch-prefix dispatch is the most error-prone bit of the CLI
 * surface, and a dedicated function makes it easy to pin the
 * contract.
 */
export function applyCliOverrides(resolved: PolyStellaResolvedOptions, args: CliArgs): PolyStellaResolvedOptions {
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
 * Read the current git branch via `git rev-parse --abbrev-ref HEAD`.
 *
 * Returns `null` when:
 *   - git isn't on PATH (returns null on ENOENT / non-zero exit),
 *   - the working tree has no `.git/` (rev-parse fails),
 *   - HEAD is detached (rev-parse prints the literal `"HEAD"`),
 *   - rev-parse prints empty string (defensive — shouldn't happen).
 *
 * The CLI uses this to default `--branch` when neither
 * `WORKERS_CI_BRANCH` nor `--branch` is supplied, so
 * `pnpm translate` from your `diogo/polystella-v1` checkout writes
 * to the matching preview prefix without any flag plumbing.
 *
 * Exported so the unit tests can drive it directly + so a future
 * caller (e.g. an editor extension) can introspect the same default
 * the CLI would pick.
 */
export function detectGitBranch(): string | null {
  let raw: string;
  try {
    raw = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      // Suppress git's stderr — we surface our own error message
      // upstream when this returns null. Letting git's "fatal: not a
      // git repository" leak would double-log the failure.
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
 * Resolve the branch the CLI should target. Precedence:
 *   1. Explicit `--branch <name>` flag (highest).
 *   2. `WORKERS_CI_BRANCH` from the environment (set by Workers
 *      Builds, or by a parent shell that pre-staged it).
 *   3. Git's current HEAD via `detectGitBranch`.
 *
 * Returns a `{ ok: true, branch }` shape on success, or
 * `{ ok: false, reason }` so the caller can format a copy-pasteable
 * remediation hint. The choice not to throw keeps the CLI's error
 * path uniform — every failure mode goes through `main()`'s
 * `console.error` + return-non-zero path.
 *
 * `gitBranchProvider` is injected for testability; production calls
 * pass `detectGitBranch`.
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

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[polystella-translate] ${(err as Error).message}\n`);
    console.error(USAGE);
    return 1;
  }

  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  // Mark this run as the explicit-CLI dispatch BEFORE the config is
  // imported. `polystella.config.mjs` reads this to distinguish a
  // CLI invocation from an incidental local `astro build` — only
  // the CLI is allowed to write to R2 from outside CI.
  process.env["POLYSTELLA_CLI"] = "1";

  // Resolve the target branch from (in order): the --branch flag,
  // an existing WORKERS_CI_BRANCH env var, or git's current HEAD.
  // Setting WORKERS_CI_BRANCH BEFORE importing the config means the
  // same dispatch logic that runs in CI runs here.
  const branchResolution = resolveCliBranch({
    flag: args.branch,
    envBranch: process.env["WORKERS_CI_BRANCH"],
    gitBranchProvider: detectGitBranch,
  });
  if (!branchResolution.ok) {
    console.error(`[polystella-translate] ${branchResolution.reason}`);
    return 1;
  }
  process.env["WORKERS_CI_BRANCH"] = branchResolution.branch;
  if (branchResolution.source === "git") {
    // Loud one-liner so an operator running `pnpm translate` from
    // an unexpected branch sees what they're about to do before
    // any provider/R2 calls fire.
    console.log(`[polystella-translate] no --branch / WORKERS_CI_BRANCH; using current git branch: ${branchResolution.branch}`);
  }

  const cwd = process.cwd();

  let resolved: PolyStellaResolvedOptions;
  try {
    const [i18n, polyConfig] = await Promise.all([loadAstroI18n(cwd), loadPolystellaConfig(cwd)]);
    resolved = resolveOptions(polyConfig, i18n);
  } catch (err) {
    console.error(`[polystella-translate] ${(err as Error).message}`);
    return 1;
  }

  try {
    resolved = applyCliOverrides(resolved, args);
  } catch (err) {
    console.error(`[polystella-translate] ${(err as Error).message}`);
    return 1;
  }

  // Mirror the integration's staging dir layout exactly so the
  // sibling content collections pick up CLI-staged files without
  // any reconfiguration. `mkdir({ recursive: true })` is idempotent.
  const stagingDir = path.resolve(cwd, DEFAULT_STAGING_DIR);
  await mkdir(stagingDir, { recursive: true });

  cliLogger.info(
    `polystella-translate v${POLYSTELLA_VERSION}: locales=${[resolved.defaultLocale, ...resolved.locales].join(", ")}, dryRun=${resolved.dryRun}, prefix=${resolved.r2?.prefix ?? "<no r2>"}`,
  );

  const result = await runTranslationPass({
    resolved,
    rootDir: cwd,
    stagingDir,
    logger: cliLogger,
    polystellaVersion: POLYSTELLA_VERSION,
  });

  // Emit a build report unconditionally for live runs (matches the
  // integration's behaviour at `astro:build:done`). Default location
  // is the project root rather than `dist/` because the CLI doesn't
  // produce a build artefact directory; `--report` overrides.
  if (result.liveRan && result.entries.length > 0) {
    const report: BuildReport = {
      build: {
        startedAt: new Date().toISOString(),
        durationMs: 0, // CLI run-time isn't tracked here; use the report's entry-level durationMs.
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

  // Non-zero exit on any pair-level failure so CI catches it.
  return result.counts.failed > 0 ? 2 : 0;
}

// Run if invoked directly (not imported). The `import.meta.url` check
// keeps the module importable from tests.
const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error("[polystella-translate] unexpected error:", err);
      process.exit(2);
    },
  );
}
