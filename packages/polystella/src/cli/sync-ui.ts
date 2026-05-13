/**
 * `polystella sync-ui` — mechanical (no AI) key reconciliation. Adds
 * missing keys to non-default locales as empty strings, drops keys
 * not in the default. Preserves existing values (empty or not),
 * source-file key order, and blank-line section layout.
 *
 * Pair with `pnpm i18n:translate` to fill the empty placeholders
 * with AI-generated strings.
 */

import path from "node:path";

import { DEFAULT_I18N_BASE } from "../i18n/loader.js";
import { applySyncToDisk, formatSyncSummary } from "../i18n/sync.js";

import { loadAstroI18n } from "./i18n-config.js";

export interface SyncUiArgs {
  base?: string | undefined;
  /** Exit non-zero when changes are needed (CI/verify mode). Default false. */
  check: boolean;
  help: boolean;
}

export const SYNC_UI_USAGE = `polystella sync-ui

Reconcile non-default-locale UI-string JSON files against the default.
Adds missing keys (empty placeholders), removes extra keys, preserves
existing values, source key order, and blank-line section layout.

Usage:
  polystella sync-ui [flags]

Flags:
  --base <dir>   UI-strings base directory, relative to project root.
                 Default: ${DEFAULT_I18N_BASE}.
  --check        Don't write — exit 2 if changes would be made.
                 Useful for CI verification of an already-synced tree.
  --help         Print this message.

Exit codes:
  0  no changes needed (or changes applied successfully).
  1  config error.
  2  --check requested and changes would be needed.
`;

export interface SyncUiDeps {
  cwd: string;
  log: (msg: string) => void;
  err: (msg: string) => void;
}

export function parseSyncUiArgs(argv: ReadonlyArray<string>): SyncUiArgs {
  const out: SyncUiArgs = { check: false, help: false };
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
      case "--check":
        out.check = true;
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

export async function runSyncUi(args: SyncUiArgs, deps: SyncUiDeps): Promise<number> {
  if (args.help) {
    deps.log(SYNC_UI_USAGE);
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
    deps.err(`[polystella] astro.config.mjs is missing an \`i18n\` block — nothing to sync.`);
    return 1;
  }

  const localeStrings = (i18n.locales as Array<string | { path: string }>).filter((entry): entry is string => typeof entry === "string");
  if (localeStrings.length === 0 || !localeStrings.includes(i18n.defaultLocale)) {
    deps.err(`[polystella] astro.config.mjs i18n.locales must include defaultLocale (${i18n.defaultLocale}).`);
    return 1;
  }

  const baseDir = args.base ?? DEFAULT_I18N_BASE;

  if (args.check) {
    // Dry-run path: compute the result but never write.
    return runSyncCheck({ cwd: deps.cwd, baseDir, defaultLocale: i18n.defaultLocale, locales: localeStrings, deps });
  }

  let result;
  try {
    result = await applySyncToDisk({
      rootDir: deps.cwd,
      baseDir,
      defaultLocale: i18n.defaultLocale,
      locales: localeStrings,
    });
  } catch (err) {
    deps.err(`[polystella] ${(err as Error).message}`);
    return 1;
  }

  if (!result.changed) {
    deps.log(`[polystella] UI-strings already in sync (${localeStrings.length} locales, base: ${path.normalize(baseDir)}).`);
    return 0;
  }

  deps.log(`[polystella] UI-strings sync:`);
  deps.log(formatSyncSummary(result));
  deps.log("");
  deps.log("Next step: `pnpm i18n:translate` to fill empty placeholders, or edit the locale files by hand.");
  return 0;
}

interface SyncCheckArgs {
  cwd: string;
  baseDir: string;
  defaultLocale: string;
  locales: ReadonlyArray<string>;
  deps: SyncUiDeps;
}

/**
 * `--check` semantics: run the sync logic against an in-memory copy
 * of the existing files, report what *would* change without writing
 * anything. Implemented by re-using `applySyncToDisk` and then
 * inspecting the bytes — but we can't avoid the write that way, so
 * we re-implement the loop in-memory.
 *
 * Kept here (rather than in `sync.ts`) because it's CLI-only and the
 * pure module shouldn't carry the dual-mode complexity.
 */
async function runSyncCheck(args: SyncCheckArgs): Promise<number> {
  const { readFile } = await import("node:fs/promises");
  const { applySyncToDisk: _apply, syncLocaleDict, parseSourceLayout, formatLocaleFile } = await import("../i18n/sync.js");
  // Re-walk in-memory.
  const sourcePath = path.resolve(args.cwd, args.baseDir, `${args.defaultLocale}.json`);
  let sourceRaw: string;
  try {
    sourceRaw = await readFile(sourcePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      args.deps.err(`[polystella] default-locale UI-strings file not found at ${sourcePath}.`);
      return 1;
    }
    throw err;
  }
  const sourceDict = JSON.parse(sourceRaw) as Record<string, string>;
  const layout = parseSourceLayout(sourceRaw);

  const changes: string[] = [];
  for (const locale of args.locales) {
    if (locale === args.defaultLocale) continue;
    const filePath = path.resolve(args.cwd, args.baseDir, `${locale}.json`);
    let existingRaw: string | undefined;
    try {
      existingRaw = await readFile(filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        existingRaw = undefined;
      } else {
        throw err;
      }
    }
    const existingDict = existingRaw === undefined ? {} : (JSON.parse(existingRaw) as Record<string, string>);
    const sync = syncLocaleDict({ source: sourceDict, existing: existingDict, sourceKeyOrder: layout.keys });
    const nextText = formatLocaleFile({ dict: sync.dict, layout });
    const created = existingRaw === undefined;
    const changed = created || existingRaw !== nextText;
    if (changed) {
      const parts: string[] = [];
      if (sync.added.length > 0) parts.push(`+${sync.added.length} added`);
      if (sync.removed.length > 0) parts.push(`-${sync.removed.length} removed`);
      if (parts.length === 0) parts.push("layout-only");
      const tag = created ? "would-create" : "would-update";
      changes.push(`  • ${locale} (${tag}): ${parts.join(", ")}`);
    }
  }

  if (changes.length === 0) {
    args.deps.log(`[polystella] UI-strings already in sync (--check ok).`);
    return 0;
  }
  args.deps.err(`[polystella] UI-strings sync changes pending (--check):`);
  args.deps.err(changes.join("\n"));
  args.deps.err("");
  args.deps.err("Run `pnpm i18n:sync` to apply.");
  return 2;
}
