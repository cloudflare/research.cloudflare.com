/**
 * `polystella check-ui` — pure drift detection over the host
 * project's UI-string JSON files. Reads `astro.config.mjs` for the
 * locale set, then runs `loadAndCheckDrift` against
 * `src/content/i18n/` (or a custom base, via `--base`).
 *
 * Exit codes:
 *   0  no drift; every non-default locale's key set matches the default
 *   1  drift detected, OR a config error
 *
 * Designed for pre-commit-hook use: fast (no AI, no network), prints
 * actionable next-step commands on failure.
 */

import path from "node:path";

import { DEFAULT_I18N_BASE } from "../i18n/loader.js";
import { formatDriftIssues, loadAndCheckDrift } from "../i18n/drift.js";

import { loadAstroI18n } from "./i18n-config.js";

export interface CheckUiArgs {
  /** Override the UI-strings base directory (default: `./src/content/i18n`). */
  base?: string | undefined;
  help: boolean;
}

export const CHECK_UI_USAGE = `polystella check-ui

Verify every non-default locale's UI-string JSON has the same key set as
the default locale. Runs offline — suitable for a pre-commit hook.

Usage:
  polystella check-ui [flags]

Flags:
  --base <dir>   UI-strings base directory, relative to project root.
                 Default: ${DEFAULT_I18N_BASE}.
  --help         Print this message.

Exit codes:
  0  no drift detected; every locale matches the default.
  1  drift detected, or config error (missing astro.config.mjs etc).
`;

export interface CheckUiDeps {
  cwd: string;
  log: (msg: string) => void;
  err: (msg: string) => void;
}

export function parseCheckUiArgs(argv: ReadonlyArray<string>): CheckUiArgs {
  const out: CheckUiArgs = { help: false };
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
      case "--base": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) {
          throw new Error(`--base requires a value (got: ${value ?? "<end>"})`);
        }
        out.base = value;
        break;
      }
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return out;
}

export async function runCheckUi(args: CheckUiArgs, deps: CheckUiDeps): Promise<number> {
  if (args.help) {
    deps.log(CHECK_UI_USAGE);
    return 0;
  }

  let i18n: Awaited<ReturnType<typeof loadAstroI18n>>;
  try {
    i18n = await loadAstroI18n(deps.cwd);
  } catch (err) {
    deps.err(`[polystella] ${(err as Error).message}`);
    return 1;
  }
  if (i18n === undefined) {
    deps.err(`[polystella] astro.config.mjs is missing an \`i18n\` block — nothing to check.`);
    return 1;
  }

  // Astro's locale list may contain object-form entries; the
  // standalone CLI only supports plain strings (same constraint as
  // `runTranslationPass`).
  const localeStrings = (i18n.locales as Array<string | { path: string }>).filter((entry): entry is string => typeof entry === "string");
  if (localeStrings.length === 0 || !localeStrings.includes(i18n.defaultLocale)) {
    deps.err(`[polystella] astro.config.mjs i18n.locales must include defaultLocale (${i18n.defaultLocale}).`);
    return 1;
  }

  const baseDir = args.base ?? DEFAULT_I18N_BASE;
  const result = await loadAndCheckDrift({
    rootDir: deps.cwd,
    baseDir,
    locales: localeStrings,
    defaultLocale: i18n.defaultLocale,
  });

  if (result.ok) {
    deps.log(`[polystella] UI-strings drift check passed (${localeStrings.length} locales, base: ${path.normalize(baseDir)}).`);
    return 0;
  }

  deps.err(`[polystella] UI-strings drift detected:`);
  deps.err(formatDriftIssues(result.issues));
  deps.err("");
  deps.err("To resolve:");
  deps.err("  • `pnpm i18n:sync` (offline, no AI) — adds missing keys as empty strings, removes extras.");
  deps.err("  • `pnpm i18n:translate` (AI) — same as sync, then fills empty values via the configured provider.");
  deps.err("  • Or edit the locale JSON files by hand.");
  return 1;
}
