/**
 * `polystella translate-ui` — sync (key add/remove) followed by AI
 * fill of empty values, one batched LLM call per locale. Uses the
 * same provider stack as the markdown pipeline. Token placeholders
 * (`{{name}}`) are validated post-translation; failures retry the
 * batch and, if persistent, leave the key empty for manual fix-up.
 *
 * R2 caching is intentionally NOT used here: ~118 strings × 3
 * locales is a trivial workload and the cache-key design (per-file
 * sha256) would force a full re-translation on every key change.
 * If translation volume grows materially, revisit per-string caching
 * via a dedicated `i18n-ui/` R2 prefix.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveOptions, type PolyStellaResolvedOptions } from "../config/options.js";
import { EMPTY_GLOSSARY, loadGlossaries } from "../glossary/glossary.js";
import { applySyncToDisk, formatLocaleFile, formatSyncSummary, parseSourceLayout, syncLocaleDict } from "../i18n/sync.js";
import { translateUiStringsForLocale, type TokenValidationIssue } from "../i18n/ui-translate.js";
import { DEFAULT_I18N_BASE } from "../i18n/loader.js";
import { runWithConcurrency } from "../source/pool.js";
import { createTranslator } from "../translation/provider.js";

import { loadAstroI18n, loadPolystellaConfig } from "./i18n-config.js";

export interface TranslateUiArgs {
  base?: string | undefined;
  /** Restrict to one locale. Must be declared in i18n.locales. */
  locale?: string | undefined;
  /** Don't call the provider — only run the sync step. Useful for dry-runs. */
  syncOnly: boolean;
  help: boolean;
}

export const TRANSLATE_UI_USAGE = `polystella translate-ui

Sync UI-string JSON files (key add/remove) and fill empty placeholders
via the configured AI provider. One batched LLM call per locale.
Locales run in parallel up to the \`concurrency\` cap in
polystella.config.mjs (default 4).

Usage:
  polystella translate-ui [flags]

Flags:
  --base <dir>     UI-strings base directory, relative to project root.
                   Default: ${DEFAULT_I18N_BASE}.
  --locale <code>  Restrict to a single locale; must be declared in
                   astro.config.mjs i18n.locales.
  --sync-only      Run the sync step only — no AI calls. Equivalent
                   to \`polystella sync-ui\` but exits with the same
                   summary format.
  --help           Print this message.

Exit codes:
  0  every empty placeholder was filled successfully (and tokens
     preserved); or --sync-only completed cleanly.
  1  config error (missing astro.config.mjs, no provider, etc).
  2  AI translation failed for at least one (locale, key) pair AND
     the token validator never converged after maxRetries attempts.
     The unaffected pairs ARE still written; only the unresolved
     ones are left empty.
`;

export interface TranslateUiDeps {
  cwd: string;
  log: (msg: string) => void;
  warn: (msg: string) => void;
  err: (msg: string) => void;
  signal?: AbortSignal | undefined;
}

export function parseTranslateUiArgs(argv: ReadonlyArray<string>): TranslateUiArgs {
  const out: TranslateUiArgs = { syncOnly: false, help: false };
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
      case "--sync-only":
        out.syncOnly = true;
        break;
      case "--base": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) {
          throw new Error(`--base requires a value (got: ${value ?? "<end>"})`);
        }
        out.base = value;
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
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return out;
}

export async function runTranslateUi(args: TranslateUiArgs, deps: TranslateUiDeps): Promise<number> {
  if (args.help) {
    deps.log(TRANSLATE_UI_USAGE);
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
    deps.err(`[polystella] astro.config.mjs is missing an \`i18n\` block.`);
    return 1;
  }

  const localeStrings = (i18n.locales as Array<string | { path: string }>).filter((entry): entry is string => typeof entry === "string");
  if (localeStrings.length === 0 || !localeStrings.includes(i18n.defaultLocale)) {
    deps.err(`[polystella] astro.config.mjs i18n.locales must include defaultLocale (${i18n.defaultLocale}).`);
    return 1;
  }
  if (args.locale !== undefined && !localeStrings.includes(args.locale)) {
    deps.err(`[polystella] --locale ${args.locale} not declared in astro.config.mjs i18n.locales (${localeStrings.join(", ")}).`);
    return 1;
  }

  const baseDir = args.base ?? DEFAULT_I18N_BASE;

  // Step 1 — sync (mechanical).
  let syncResult;
  try {
    syncResult = await applySyncToDisk({
      rootDir: deps.cwd,
      baseDir,
      defaultLocale: i18n.defaultLocale,
      locales: localeStrings,
    });
  } catch (err) {
    deps.err(`[polystella] ${(err as Error).message}`);
    return 1;
  }
  if (syncResult.changed) {
    deps.log(`[polystella] sync step:`);
    deps.log(formatSyncSummary(syncResult));
  } else {
    deps.log(`[polystella] sync step: no key changes needed.`);
  }

  if (args.syncOnly) {
    return 0;
  }

  // Step 2 — AI fill. Requires PolyStella config + provider.
  let resolved: PolyStellaResolvedOptions;
  try {
    const polyConfig = await loadPolystellaConfig(deps.cwd);
    resolved = resolveOptions(polyConfig, i18n);
  } catch (err) {
    deps.err(`[polystella] ${(err as Error).message}`);
    return 1;
  }
  if (resolved.provider === undefined) {
    deps.err(
      `[polystella] no provider configured in polystella.config.mjs — translate-ui needs one. Add a \`provider\` block or use \`pnpm i18n:sync\` for offline key reconciliation only.`,
    );
    return 1;
  }
  // `dryRun` is intentionally NOT honoured here. It governs the
  // markdown pipeline (R2 writes, paid provider calls, branch
  // dispatch) where a no-op preview run is genuinely useful. UI-
  // string translation writes to local files only and the workload
  // is small (~118 keys × N locales), so a dryRun-aware path would
  // just be a hidden way to skip work. Operators who want a no-AI
  // run should use `--sync-only`.

  // Re-read the synced source + locale files. (applySyncToDisk
  // already wrote them; we re-read so the in-memory state matches
  // what landed on disk byte-for-byte.)
  const sourcePath = path.resolve(deps.cwd, baseDir, `${resolved.defaultLocale}.json`);
  const sourceRaw = await readFile(sourcePath, "utf8");
  const sourceDict = JSON.parse(sourceRaw) as Record<string, string>;
  const layout = parseSourceLayout(sourceRaw);

  // Glossaries live under `projectRoot` per `loadGlossaries`'s
  // contract. The standalone CLI doesn't have an Astro `URL` for
  // root, so synthesise one.
  const projectRoot = pathToFileURL(deps.cwd + path.sep);
  let glossaries: Awaited<ReturnType<typeof loadGlossaries>>;
  try {
    glossaries = await loadGlossaries({ config: resolved, projectRoot });
  } catch (err) {
    deps.err(`[polystella] ${(err as Error).message}`);
    return 1;
  }

  const targets = args.locale !== undefined ? [args.locale] : resolved.locales;
  if (targets.length === 0) {
    return 0;
  }

  // Per-locale work runs in parallel. Each locale = one batched LLM
  // round-trip + one file write — independent, no shared state. The
  // concurrency cap comes from polystella.config.mjs (`concurrency`,
  // default 4); same knob the markdown pipeline uses, so an operator
  // who's already capped for rate-limit reasons doesn't have to
  // configure a second one. With ~3 typical non-default locales the
  // cap is rarely hit; with many locales the cap is what keeps us
  // from torching the provider's per-account rate limit.
  //
  // Output is buffered per-locale and flushed in `targets` order so
  // the final log block is deterministic even though completion
  // order is non-deterministic. A single "starting" line per locale
  // fires live so the user has progress signal during the wait.
  const results: PerLocaleOutcome[] = targets.map((locale) => ({
    locale,
    filled: [],
    tokenFailures: [],
    error: undefined,
    logs: [],
  }));

  for (const locale of targets) {
    deps.log(`[polystella] translate-ui: starting locale ${locale} …`);
  }

  await runWithConcurrency(targets, resolved.concurrency, async (locale) => {
    const idx = targets.indexOf(locale);
    const outcome = results[idx];
    if (outcome === undefined) return;
    // Local logger writes to the per-locale buffer. The pool's
    // worker contract is `Promise<void>` with rejection short-
    // circuiting the pool (matches Promise.all), so we MUST catch
    // every error in here — a single locale's provider failure
    // can't be allowed to kill the rest of the run.
    const log = (msg: string) => outcome.logs.push({ level: "log", msg });
    const warn = (msg: string) => outcome.logs.push({ level: "warn", msg });
    const err = (msg: string) => outcome.logs.push({ level: "err", msg });

    try {
      const localePath = path.resolve(deps.cwd, baseDir, `${locale}.json`);
      let localeRaw: string;
      try {
        localeRaw = await readFile(localePath, "utf8");
      } catch (readErr) {
        err(`[polystella]   ${locale}: failed to read ${localePath}: ${(readErr as Error).message}`);
        outcome.error = readErr as Error;
        return;
      }
      const localeDict = JSON.parse(localeRaw) as Record<string, string>;

      const translator = createTranslator(resolved.provider!, locale);
      const glossary = glossaries.get(locale) ?? EMPTY_GLOSSARY;

      const result = await translateUiStringsForLocale({
        translator,
        glossary,
        sourceDict,
        localeDict,
        sourceLocale: resolved.defaultLocale,
        targetLocale: locale,
        ...(resolved.prompt.context !== undefined ? { context: resolved.prompt.context } : {}),
        maxRetries: resolved.maxRetries,
        retryMinTimeoutMs: 250,
        retryFactor: 2,
        retryRandomize: true,
        ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
        onRetry: ({ attempt, totalAttempts, error: retryErr }) => {
          warn(`[polystella]   ${locale}: attempt ${attempt}/${totalAttempts} failed: ${retryErr.message}`);
        },
      });

      // Re-sync against the source one more time so any keys that
      // came in or out between the sync step and now are reflected.
      // (Belt-and-braces; in practice no other writer touches the
      // file mid-run.)
      const reconciled = syncLocaleDict({
        source: sourceDict,
        existing: result.dict,
        sourceKeyOrder: layout.keys,
      });
      const nextText = formatLocaleFile({ dict: reconciled.dict, layout });
      if (nextText !== localeRaw) {
        await writeFile(localePath, nextText, "utf8");
      }

      outcome.filled = result.filled;
      outcome.tokenFailures = result.tokenFailures;

      if (result.filled.length > 0) {
        log(`[polystella] translate-ui: ${locale} — filled ${result.filled.length} key(s): ${result.filled.join(", ")}`);
      } else {
        log(`[polystella] translate-ui: ${locale} — no empty placeholders to fill.`);
      }
      if (result.tokenFailures.length > 0) {
        warn(`[polystella]   ${locale}: token-preservation failed for ${result.tokenFailures.length} key(s):`);
        for (const f of result.tokenFailures) {
          warn(`      - ${f.key}: missing=[${f.missing.join(", ")}], spurious=[${f.spurious.join(", ")}]`);
        }
        warn(`[polystella]   ${locale}: these keys were left empty; fix manually then re-run.`);
      }
    } catch (caught) {
      outcome.error = caught as Error;
      err(`[polystella] translate-ui: ${locale} — failed: ${(caught as Error).message}`);
    }
  });

  // Flush in target order so logs are stable across runs even when
  // completion order varies.
  for (const r of results) {
    for (const { level, msg } of r.logs) {
      if (level === "log") deps.log(msg);
      else if (level === "warn") deps.warn(msg);
      else deps.err(msg);
    }
  }

  const anyTokenFailures = results.some((r) => r.tokenFailures.length > 0 || r.error !== undefined);
  return anyTokenFailures ? 2 : 0;
}

interface PerLocaleOutcome {
  locale: string;
  filled: string[];
  tokenFailures: TokenValidationIssue[];
  /** Set on read failure or unexpected throw inside the worker. */
  error: Error | undefined;
  logs: Array<{ level: "log" | "warn" | "err"; msg: string }>;
}
