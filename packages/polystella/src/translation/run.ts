import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import picomatch from "picomatch";

import type { PolyStellaResolvedOptions } from "../config/options.js";
import { EMPTY_GLOSSARY, EMPTY_GLOSSARY_HASH, hashGlossary, loadGlossaries } from "../glossary/glossary.js";
import type { AdapterExtractOptions, FileTypeAdapter } from "../parsing/adapter.js";
import { rewriteInternalLinks, rewriteUrlIfInternal, type RewriteInternalLinksOptions } from "../parsing/rewrite-links.js";
import { getAdapter, listRegisteredExtensions } from "../parsing/registry.js";
import { readOverride } from "../source/overrides.js";
import { runWithConcurrency } from "../source/pool.js";
import { walkSources } from "../source/walk.js";
import { buildCacheMetadata, translateOrLoadFromCache, type CacheOutcome } from "../storage/cache.js";
import { computeSourceHash } from "../storage/hash.js";
import {
  localCacheKey,
  readLocalCacheIndex,
  stagedFileExists,
  writeLocalCacheIndex,
  type LocalCacheEntry,
} from "../storage/local-cache.js";
import { encodeTouchedPair, pruneCacheByPair } from "../storage/prune.js";
import { buildR2Key, createR2Client, type R2Client } from "../storage/r2.js";
import type { BuildReportEntry, BuildReportPruning } from "../storage/report.js";
import { createTranslator, type Translator } from "./provider.js";

/**
 * Translation pass shared between the Astro integration and the
 * standalone CLI. Zero direct dependency on Astro's types so the CLI
 * can run without Astro on the import path.
 *
 * Does NOT inject routes/shims, run UI-strings drift detection, or
 * write the build report — those are caller responsibilities.
 */

/** Astro-compatible logger surface; trivially stub-able from console. */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface RunTranslationOptions {
  /** Pre-validated via `resolveOptions`; schema invariants are trusted. */
  resolved: PolyStellaResolvedOptions;
  /** Absolute path to the Astro project root. */
  rootDir: string;
  /** Absolute path for translated output (typically `<rootDir>/.astro/i18n-staging`). */
  stagingDir: string;
  logger: Logger;
  /** Version baked into R2 metadata + the build report. */
  polystellaVersion: string;
  /**
   * Bypass `createR2Client(resolved.r2)`. `null` disables caching;
   * an R2Client redirects to a fixture/local bucket. `undefined`
   * (default) uses `resolved.r2`.
   */
  r2Override?: R2Client | null;
  /** Per-locale Translator overrides. Used by tests + debug-mode callers. */
  translatorOverrides?: Map<string, Translator>;
  /**
   * Cancellation signal. Threaded into per-pair workers, the cache
   * layer, the translator's HTTP fetch, and the retry loop. On
   * abort, in-flight work cleans up and `runTranslationPass` rejects
   * with an `AbortError`. Already-staged files survive.
   */
  signal?: AbortSignal;
}

export interface RunTranslationCounts {
  hit: number;
  miss: number;
  override: number;
  failed: number;
  /** Pairs short-circuited by the on-disk staging index — no R2 GET issued. */
  localSkipped: number;
}

export interface RunTranslationResult {
  /** Build-report entries (one per processed (source, locale) pair). */
  entries: BuildReportEntry[];
  /** Prune outcome; `deletedKeys` empty when no prune ran. */
  pruning: BuildReportPruning;
  /** Per-locale glossary metadata for the build report's inventory. */
  glossariesForReport: Record<string, { file: string; sha256: string }>;
  /** Pairs the run processed (translated / hit / override). For diagnostics. */
  touchedPairs: Set<string>;
  counts: RunTranslationCounts;
  /** Sources with `noTranslate: true`. */
  noTranslateSources: number;
  /** `false` when the run skipped translation (no provider, dryRun, no sources). */
  liveRan: boolean;
}

/**
 * Stage at `<stagingDir>/<locale>/<relativeSourcePath>` — matches the
 * glob base `polystellaCollections` registers for sibling collections.
 */
async function writeStagedTranslation(args: {
  stagingDir: string;
  locale: string;
  relativeSourcePath: string;
  bytes: string;
}): Promise<void> {
  const target = path.join(args.stagingDir, args.locale, args.relativeSourcePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, args.bytes, "utf8");
}

/**
 * Per-glob → translatable-keys map for an adapter. Unknown
 * extensions return `{}` — segments empty, source passes through.
 */
function pickTranslatableKeysForAdapter(adapter: FileTypeAdapter, resolved: PolyStellaResolvedOptions): Record<string, string[]> {
  for (const ext of adapter.extensions) {
    switch (ext) {
      case ".md":
      case ".mdx":
        return resolved.markdown.keys;
      case ".toml":
        return resolved.toml.keys;
      case ".json":
        return resolved.json.keys;
      case ".yaml":
      case ".yml":
        return resolved.yaml.keys;
    }
  }
  return {};
}

/**
 * Per-glob → URL-path map for an adapter. Markdown URLs are
 * frontmatter-only; body inline links are rewritten separately at
 * the bytes level.
 */
function pickUrlKeysForAdapter(adapter: FileTypeAdapter, resolved: PolyStellaResolvedOptions): Record<string, string[]> {
  for (const ext of adapter.extensions) {
    switch (ext) {
      case ".md":
      case ".mdx":
        return resolved.markdown.urls;
      case ".toml":
        return resolved.toml.urls;
      case ".json":
        return resolved.json.urls;
      case ".yaml":
      case ".yml":
        return resolved.yaml.urls;
    }
  }
  return {};
}

/** Union every matching glob's URL paths, deduped, insertion-ordered. */
function resolveUrlPathsForSource(rules: Record<string, string[]>, sourcePath: string): string[] {
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const [pattern, paths] of Object.entries(rules)) {
    if (picomatch.isMatch(sourcePath, pattern)) {
      for (const p of paths) {
        if (!seen.has(p)) {
          seen.add(p);
          matched.push(p);
        }
      }
    }
  }
  return matched;
}

/** Ordered fallback R2 keys (one per `readFallbackPrefixes` entry). */
function buildFallbackKeys(args: { resolved: PolyStellaResolvedOptions; locale: string; sourcePath: string; hash: string }): string[] {
  const fallbackPrefixes = args.resolved.r2?.readFallbackPrefixes ?? [];
  if (fallbackPrefixes.length === 0) return [];
  return fallbackPrefixes.map((prefix) =>
    buildR2Key({
      locale: args.locale,
      sourcePath: args.sourcePath,
      hash: args.hash,
      prefix,
    }),
  );
}

/**
 * Walk sources → load glossaries → build translators + R2 client →
 * orchestrate every (file, locale) pair → optionally prune. Returns
 * the data needed to emit a build report; caller serialises.
 */
export async function runTranslationPass(opts: RunTranslationOptions): Promise<RunTranslationResult> {
  const { resolved, rootDir, stagingDir, logger, polystellaVersion, r2Override, translatorOverrides, signal } = opts;
  // Fail fast if the caller pre-aborted; cheaper than spinning up
  // the whole pipeline only to throw at the first await.
  signal?.throwIfAborted();
  const sourceDirAbs = path.resolve(rootDir, resolved.sourceDir);

  const entries: BuildReportEntry[] = [];
  const pruning: BuildReportPruning = { deletedKeys: [], byLocale: {} };
  const glossariesForReport: Record<string, { file: string; sha256: string }> = {};
  const touchedPairs = new Set<string>();
  const counts: RunTranslationCounts = {
    hit: 0,
    miss: 0,
    override: 0,
    failed: 0,
    localSkipped: 0,
  };
  let noTranslateSources = 0;

  // Load + hash glossaries once; shared across every (file, locale)
  // pair using the same glossary. `pathToFileURL` handles spaces/
  // unicode in paths that manual concatenation would mishandle.
  const glossaries = await loadGlossaries({
    config: resolved,
    projectRoot: pathToFileURL(rootDir + path.sep),
  });
  const glossaryHashByLocale = new Map<string, string>();
  for (const locale of resolved.locales) {
    const glossary = glossaries.get(locale);
    const hash = glossary ? hashGlossary(glossary) : EMPTY_GLOSSARY_HASH;
    glossaryHashByLocale.set(locale, hash);
    if (glossary) {
      const fileTemplate = resolved.glossary && "file" in resolved.glossary ? resolved.glossary.file : "<inline>";
      glossariesForReport[locale] = {
        file: fileTemplate.replace("{locale}", locale),
        sha256: hash,
      };
    }
  }
  if (glossaries.size > 0) {
    logger.info(`loaded glossaries for: ${[...glossaries.keys()].sort().join(", ")}`);
  }

  // One Translator per locale. Empty when no provider — model-id in
  // the cache key collapses to "". Per-locale overrides win.
  const translatorByLocale = new Map<string, Translator>();
  if (resolved.provider || translatorOverrides) {
    for (const locale of resolved.locales) {
      const override = translatorOverrides?.get(locale);
      if (override) {
        translatorByLocale.set(locale, override);
      } else if (resolved.provider) {
        translatorByLocale.set(locale, createTranslator(resolved.provider, locale));
      }
    }
    if (translatorByLocale.size > 0) {
      const summary = [...translatorByLocale.entries()].map(([locale, translator]) => `${locale}=${translator.modelId}`).join(", ");
      const providerLabel = resolved.provider ? resolved.provider.kind : "override";
      logger.info(`provider: ${providerLabel} (${summary})`);
    }
  }

  // `null` = caching opted out; orchestrator skips lookup + write.
  // `r2Override` wins when supplied (tests, local fixtures).
  const r2: R2Client | null =
    r2Override !== undefined
      ? r2Override
      : resolved.r2
        ? createR2Client({
            accountId: resolved.r2.accountId,
            bucket: resolved.r2.bucket,
            accessKeyId: resolved.r2.accessKeyId,
            secretAccessKey: resolved.r2.secretAccessKey,
            ...(resolved.r2.endpoint ? { endpoint: resolved.r2.endpoint } : {}),
          })
        : null;
  if (r2) {
    if (resolved.r2) {
      const fallbackSummary =
        resolved.r2.readFallbackPrefixes.length > 0 ? `, fallbackPrefixes=[${resolved.r2.readFallbackPrefixes.join(", ")}]` : "";
      const readOnlySummary = resolved.r2.readOnly ? ", readOnly=true" : "";
      logger.info(`R2 cache: bucket=${resolved.r2.bucket}, prefix=${resolved.r2.prefix}${readOnlySummary}${fallbackSummary}`);
    } else {
      // `r2Override` without `resolved.r2` — log without asserting
      // on credentials we don't have.
      logger.info(`R2 cache: using injected client`);
    }
  } else {
    logger.info(`R2 cache: not configured — translations will not be cached or shared`);
  }

  const sources = await walkSources({
    roots: [
      {
        baseDir: sourceDirAbs,
        include: resolved.include,
        exclude: resolved.exclude,
      },
    ],
  });

  if (sources.length === 0) {
    logger.warn(`no source files matched include=${JSON.stringify(resolved.include)} under ${resolved.sourceDir}`);
    return {
      entries,
      pruning,
      glossariesForReport,
      touchedPairs,
      counts,
      noTranslateSources,
      liveRan: false,
    };
  }

  // Dry-run logging: compute the same hashes the live pass would,
  // so the logged keys match what'll actually be PUT/GET'd if
  // `dryRun` flips off.
  let pairCount = 0;
  await Promise.all(
    sources.map(async (source) => {
      const ext = path.extname(source.relativePath).toLowerCase();
      const adapter = getAdapter(ext);
      if (!adapter) {
        logger.warn(
          `no adapter registered for "${ext}" (source: ${source.relativePath}); known: ${listRegisteredExtensions().join(", ") || "none"}. Skipping.`,
        );
        return;
      }
      const body = await readFile(source.absolutePath, "utf8");
      const parsed = adapter.parse(body, source.relativePath);
      const adapterOpts: AdapterExtractOptions = {
        sourcePath: source.relativePath,
        translatableKeys: pickTranslatableKeysForAdapter(adapter, resolved),
      };
      const selectedValues = adapter.selectedValuesForHash(parsed, body, adapterOpts);
      for (const locale of resolved.locales) {
        const hash = computeSourceHash({
          body,
          frontmatter: selectedValues,
          glossaryHash: glossaryHashByLocale.get(locale) ?? EMPTY_GLOSSARY_HASH,
          modelId: translatorByLocale.get(locale)?.modelId ?? "",
        });
        const key = buildR2Key({
          locale,
          sourcePath: source.relativePath,
          hash,
          prefix: resolved.r2?.prefix,
        });
        logger.debug(`would check cache for ${key}`);
        pairCount++;
      }
    }),
  );

  logger.info(
    `dry-run: ${pairCount} R2 keys across ${sources.length} source file${
      sources.length === 1 ? "" : "s"
    } × ${resolved.locales.length} locale${resolved.locales.length === 1 ? "" : "s"}`,
  );

  // Live mode requires a provider AND dryRun off. Otherwise return
  // early with dry-run-only counts so callers can still log planned
  // keys without writing.
  const liveMode = resolved.provider !== undefined && !resolved.dryRun;
  if (!liveMode) {
    return {
      entries,
      pruning,
      glossariesForReport,
      touchedPairs,
      counts,
      noTranslateSources,
      liveRan: false,
    };
  }

  const totalPairs = sources.length * resolved.locales.length;
  logger.info(
    `live: processing ${sources.length} × ${resolved.locales.length} (file, locale) pairs at concurrency ${resolved.concurrency}`,
  );

  // Heartbeat keeps the build feed alive on cold-cache runs.
  // See ARCHITECTURE.md §10 for the timing rationale.
  const heartbeatThreshold = 10;
  const heartbeatIntervalMs = 15_000;
  const heartbeatPctStep = 5;
  let processedPairs = 0;
  let lastReportedPct = 0;
  let lastReportedAt = 0;
  const heartbeatStart = Date.now();
  const heartbeatEnabled = !resolved.verbose && totalPairs >= heartbeatThreshold;
  const emitProgress = () => {
    const elapsedSec = Math.round((Date.now() - heartbeatStart) / 1000);
    const pct = Math.floor((processedPairs / totalPairs) * 100);
    logger.info(
      `progress: ${processedPairs}/${totalPairs} pairs (${pct}%) — ${counts.hit} hit, ${counts.miss} miss, ${counts.override} override${
        counts.localSkipped > 0 ? `, ${counts.localSkipped} local-skipped` : ""
      }${counts.failed > 0 ? `, ${counts.failed} failed` : ""} — ${elapsedSec}s elapsed`,
    );
    lastReportedPct = pct;
    lastReportedAt = Date.now();
  };
  // Called by the pool after every completed pair. Fires only on
  // ≥5% advancement — naturally rate-limited since each pair moves
  // the percent by `100/totalPairs`%.
  const maybeEmitProgress = heartbeatEnabled
    ? () => {
        if (processedPairs === 0) return;
        const pct = Math.floor((processedPairs / totalPairs) * 100);
        if (pct - lastReportedPct >= heartbeatPctStep) {
          emitProgress();
        }
      }
    : () => {};
  const heartbeatHandle = heartbeatEnabled
    ? setInterval(() => {
        // Skip the first tick if nothing's finished yet; the
        // "live: processing N × M" line already covered that case.
        if (processedPairs === 0) return;
        // 15s is the floor between lines regardless of trigger.
        if (lastReportedAt > 0 && Date.now() - lastReportedAt < heartbeatIntervalMs) return;
        emitProgress();
      }, heartbeatIntervalMs)
    : null;
  // unref() so a stalled pool doesn't block process exit.
  heartbeatHandle?.unref();

  // On-disk staging index: skip pairs whose source hash matches the
  // last run AND whose staged file is still present (no R2 GET, no
  // staging write). Read map is immutable during the run; workers
  // write to a separate `nextLocalCacheIndex` for deterministic
  // skip decisions. See ARCHITECTURE.md §8.
  const localCacheIndex = await readLocalCacheIndex(stagingDir);
  const nextLocalCacheIndex = new Map<string, LocalCacheEntry>();
  if (localCacheIndex.size > 0) {
    logger.debug(`local staging index: ${localCacheIndex.size} entries from previous run`);
  }

  // Cache-write bookkeeping: announce on first PUT, summarise at end.
  let cacheWritesCount = 0;
  let cacheWritesFailed = 0;
  let cacheWritesAnnounced = false;

  // Include default locale in the rewriter's known set so already-
  // prefixed `/${defaultLocale}/...` URLs aren't treated as rewriteable.
  const allLocalesForRewrite = [resolved.defaultLocale, ...resolved.locales];
  const buildRewriteOpts = (locale: string): RewriteInternalLinksOptions => ({
    targetLocale: locale,
    locales: allLocalesForRewrite,
    ...(resolved.noPrefixUrls.length > 0 ? { noPrefixUrls: resolved.noPrefixUrls } : {}),
  });
  /** Apply post-cache URL rewrites to staged bytes. See ARCHITECTURE.md §12. */
  const maybeRewrite = (bytes: string, locale: string, adapter: FileTypeAdapter, urlPathsForSource: string[]): string => {
    if (!resolved.rewriteInternalLinks) return bytes;
    const rewriteOpts = buildRewriteOpts(locale);
    let next = bytes;
    if (adapter.rewriteUrls && urlPathsForSource.length > 0) {
      const rewriter = (url: string) => rewriteUrlIfInternal(url, rewriteOpts);
      next = adapter.rewriteUrls(next, { paths: urlPathsForSource, rewriter });
    }
    // Body-link rewriter is markdown-only (parses with `parseMarkdown`).
    const isMarkdown = adapter.extensions.includes(".md") || adapter.extensions.includes(".mdx");
    if (isMarkdown) {
      next = rewriteInternalLinks(next, rewriteOpts);
    }
    return next;
  };

  // Per-source body runs as a pool worker. State mutations across
  // workers (counts, touchedPairs, etc.) are safe in single-threaded
  // JS; nothing reads these mid-run, only at synchronisation; the
  // pool resolves once every source has been processed and the
  // closing-summary log lines run after.
  await runWithConcurrency(sources, resolved.concurrency, async (source) => {
    // Check cancellation at every worker entry — a long pipeline
    // shouldn't start a new pair after Ctrl-C just because a
    // worker happened to grab one before the signal propagated.
    signal?.throwIfAborted();
    const ext = path.extname(source.relativePath).toLowerCase();
    const adapter = getAdapter(ext);
    if (!adapter) {
      // Already warned in the dry-run pass above; silently drop here
      // so a single source file with an unsupported extension doesn't
      // double-log on every run. Account for the would-be pairs in
      // the heartbeat denominator so progress still ticks toward 100%.
      processedPairs += resolved.locales.length;
      maybeEmitProgress();
      return;
    }
    const body = await readFile(source.absolutePath, "utf8");
    const parsed = adapter.parse(body, source.relativePath);
    const adapterOpts: AdapterExtractOptions = {
      sourcePath: source.relativePath,
      translatableKeys: pickTranslatableKeysForAdapter(adapter, resolved),
    };
    // URL key paths apply per-source via the configured globs.
    // Resolved once per source so the adapter's `applyTranslations`
    // closure can re-use the same list across the per-locale loop.
    const urlPathsForSource = resolveUrlPathsForSource(pickUrlKeysForAdapter(adapter, resolved), source.relativePath);

    // Computed once per source so all branches (noTranslate, override,
    // translate, error) push consistent report entries.
    const selectedValuesForReport = adapter.selectedValuesForHash(parsed, body, adapterOpts);
    const reportKeysFor = (locale: string) => {
      const modelId = translatorByLocale.get(locale)?.modelId ?? "";
      const sourceHash = computeSourceHash({
        body,
        frontmatter: selectedValuesForReport,
        glossaryHash: glossaryHashByLocale.get(locale) ?? EMPTY_GLOSSARY_HASH,
        modelId,
      });
      const r2Key = buildR2Key({
        locale,
        sourcePath: source.relativePath,
        hash: sourceHash,
        prefix: resolved.r2?.prefix,
      });
      return { modelId, sourceHash, r2Key };
    };

    // `noTranslate: true` skips translation entirely; overrides
    // still apply (per-locale opt-back-in).
    if (adapter.peekNoTranslate(parsed)) {
      noTranslateSources++;
      for (const locale of resolved.locales) {
        const pairStart = Date.now();
        try {
          const { modelId, sourceHash, r2Key } = reportKeysFor(locale);
          const override = await readOverride({
            rootDir,
            overridesDir: resolved.overridesDir,
            locale,
            relativeSourcePath: source.relativePath,
          });
          if (override === null) {
            entries.push({
              sourcePath: source.relativePath,
              locale,
              sourceHash,
              r2Key,
              outcome: "skipped-no-translate",
              model: modelId,
              durationMs: Date.now() - pairStart,
            });
            continue;
          }
          const overrideStaged = maybeRewrite(override, locale, adapter, urlPathsForSource);
          await writeStagedTranslation({
            stagingDir,
            locale,
            relativeSourcePath: source.relativePath,
            bytes: overrideStaged,
          });
          counts.override++;
          touchedPairs.add(encodeTouchedPair(locale, source.relativePath));
          entries.push({
            sourcePath: source.relativePath,
            locale,
            sourceHash,
            r2Key,
            outcome: "override",
            model: modelId,
            durationMs: Date.now() - pairStart,
          });
          if (resolved.verbose) {
            logger.info(`◆ ${source.relativePath} → ${locale} [override, noTranslate-source]`);
          }
        } finally {
          processedPairs++;
          maybeEmitProgress();
        }
      }
      if (resolved.verbose) {
        logger.info(`⊘ ${source.relativePath} [noTranslate=true; skipping AI translation]`);
      }
      // `return`, not `continue` — this is the pool worker.
      return;
    }

    const segments = adapter.extractSegments(parsed, body, adapterOpts);
    const selectedValues = adapter.selectedValuesForHash(parsed, body, adapterOpts);

    for (const locale of resolved.locales) {
      signal?.throwIfAborted();
      const pairStart = Date.now();
      try {
        // Overrides win over cache + translator; deliberately NOT
        // written to R2 (source-controlled, not machine-generated).
        const override = await readOverride({
          rootDir,
          overridesDir: resolved.overridesDir,
          locale,
          relativeSourcePath: source.relativePath,
        });
        if (override !== null) {
          // Rewrite overrides too so hand-translated files with raw
          // internal links still get locale-prefixed. Idempotent.
          const overrideStaged = maybeRewrite(override, locale, adapter, urlPathsForSource);
          await writeStagedTranslation({
            stagingDir,
            locale,
            relativeSourcePath: source.relativePath,
            bytes: overrideStaged,
          });
          counts.override++;
          touchedPairs.add(encodeTouchedPair(locale, source.relativePath));
          {
            const { modelId, sourceHash, r2Key } = reportKeysFor(locale);
            entries.push({
              sourcePath: source.relativePath,
              locale,
              sourceHash,
              r2Key,
              outcome: "override",
              model: modelId,
              durationMs: Date.now() - pairStart,
            });
          }
          if (resolved.verbose) {
            logger.info(`◆ ${source.relativePath} → ${locale} [override]`);
          }
          if (resolved.debug.previewDir) {
            const previewPath = path.resolve(rootDir, resolved.debug.previewDir, locale, source.relativePath);
            await mkdir(path.dirname(previewPath), { recursive: true });
            await writeFile(previewPath, overrideStaged, "utf8");
          }
          continue;
        }

        // No override — fall through to the cache + translator path.
        if (segments.length === 0) continue;
        const translator = translatorByLocale.get(locale);
        if (!translator) continue;
        const glossary = glossaries.get(locale) ?? EMPTY_GLOSSARY;
        const glossaryHash = glossaryHashByLocale.get(locale) ?? EMPTY_GLOSSARY_HASH;
        const sourceHash = computeSourceHash({
          body,
          frontmatter: selectedValues,
          glossaryHash,
          modelId: translator.modelId,
        });
        const key = buildR2Key({
          locale,
          sourcePath: source.relativePath,
          hash: sourceHash,
          prefix: resolved.r2?.prefix,
        });

        // Local-cache skip: hash match + staged file present means
        // we can skip the R2 GET and staging write. Still record
        // `local-skipped` and mark `touchedPairs` alive so the
        // pruner doesn't evict R2 variants this build needs.
        const lcKey = localCacheKey(locale, source.relativePath);
        const cachedLocal = localCacheIndex.get(lcKey);
        if (cachedLocal?.hash === sourceHash && (await stagedFileExists(stagingDir, locale, source.relativePath))) {
          counts.localSkipped++;
          touchedPairs.add(encodeTouchedPair(locale, source.relativePath));
          entries.push({
            sourcePath: source.relativePath,
            locale,
            sourceHash,
            r2Key: key,
            outcome: "local-skipped",
            model: translator.modelId,
            durationMs: Date.now() - pairStart,
          });
          // Carry forward so the next run skips this pair again.
          nextLocalCacheIndex.set(lcKey, cachedLocal);
          if (resolved.verbose) {
            logger.info(`▷ ${source.relativePath} → ${locale} [local-skipped] (${segments.length} segs)`);
          }
          continue;
        }

        const fallbackKeys = buildFallbackKeys({
          resolved,
          locale,
          sourcePath: source.relativePath,
          hash: sourceHash,
        });
        // Single timestamp shared between R2 metadata and the in-bytes
        // marker so cache/staged-file diffs stay consistent.
        const translatedAt = new Date().toISOString();
        // AI-translation marker baked in pre-PUT so cache hits return
        // a truthful `aiTranslatedAt`. See ARCHITECTURE.md §11.
        const topLevelAdditions: Record<string, unknown> = {
          aiTranslated: true,
          aiTranslationModel: translator.modelId,
          aiTranslatedAt: translatedAt,
        };
        const result = await translateOrLoadFromCache({
          segments,
          apply: (translations) =>
            adapter.applyTranslations(parsed, body, translations, {
              topLevelAdditions,
            }),
          locale,
          key,
          r2,
          translator,
          glossary,
          sourceLocale: resolved.defaultLocale,
          ...(resolved.prompt.context !== undefined ? { context: resolved.prompt.context } : {}),
          metadata: buildCacheMetadata({
            sourcePath: source.relativePath,
            locale,
            sourceHash,
            glossaryHash,
            modelId: translator.modelId,
            translatedAt,
            polystellaVersion,
          }),
          ...(resolved.r2?.readOnly ? { readOnly: true } : {}),
          ...(fallbackKeys.length > 0 ? { fallbackKeys } : {}),
          maxRetries: resolved.maxRetries,
          // Production backoff: 100ms minimum, exponential, jittered.
          // Avoids thundering-herd against the AI provider on a
          // cold-cache build that misses across many concurrent pairs.
          retryMinTimeoutMs: 100,
          retryFactor: 2,
          retryRandomize: true,
          ...(signal !== undefined ? { signal } : {}),
          onRetry: ({ attempt, totalAttempts, error }) => {
            // First line only — provider errors may include multi-line
            // `Raw response was:` dumps that clutter the log.
            const headline = error.message.split("\n", 1)[0];
            logger.warn(`↻ ${source.relativePath} → ${locale}: attempt ${attempt}/${totalAttempts} failed (${headline}); retrying`);
          },
          events: {
            onWriteStart: () => {
              if (!cacheWritesAnnounced) {
                logger.info("R2 cache: starting writes…");
                cacheWritesAnnounced = true;
              }
            },
            onWriteDone: () => {
              cacheWritesCount++;
            },
            onWriteFailed: ({ error }) => {
              cacheWritesFailed++;
              logger.warn(`⚠ ${source.relativePath} → ${locale}: cache write failed: ${error.message}`);
            },
          },
        });
        const outcomeKey: keyof RunTranslationCounts = result.outcome === "hit" ? "hit" : "miss";
        counts[outcomeKey] = (counts[outcomeKey] as number) + 1;
        touchedPairs.add(encodeTouchedPair(locale, source.relativePath));
        entries.push({
          sourcePath: source.relativePath,
          locale,
          sourceHash,
          r2Key: key,
          outcome: result.outcome === "hit" ? "cache-hit" : "ai-translated",
          model: translator.modelId,
          durationMs: Date.now() - pairStart,
        });

        // Rewrite happens POST-cache: cached bytes are translation-
        // only output; toggling `rewriteInternalLinks` or editing
        // `noPrefixUrls` doesn't invalidate the cache; rewriter is
        // idempotent so cache hits don't double-prefix.
        const stagedBody = maybeRewrite(result.body, locale, adapter, urlPathsForSource);
        await writeStagedTranslation({
          stagingDir,
          locale,
          relativeSourcePath: source.relativePath,
          bytes: stagedBody,
        });
        // Record staged hash AFTER the write so a crashed build
        // can't leave a "we have this staged" claim that contradicts
        // disk state.
        nextLocalCacheIndex.set(lcKey, {
          hash: sourceHash,
          stagedAt: translatedAt,
        });

        if (resolved.verbose) {
          // Distinct marker for fallback hits so log readers can
          // tell when a preview build pulled from main's cache.
          let marker: string;
          if (result.outcome === "hit") {
            marker = result.hitKey && result.hitKey !== key ? "◐" : "●";
          } else {
            marker = "✓";
          }
          const fallbackSuffix = result.outcome === "hit" && result.hitKey && result.hitKey !== key ? " via fallback" : "";
          logger.info(`${marker} ${source.relativePath} → ${locale} [${result.outcome}${fallbackSuffix}] (${segments.length} segs)`);
        }

        // Optional inspection copy. No-op when previewDir unset.
        if (resolved.debug.previewDir) {
          const previewPath = path.resolve(rootDir, resolved.debug.previewDir, locale, source.relativePath);
          await mkdir(path.dirname(previewPath), { recursive: true });
          await writeFile(previewPath, stagedBody, "utf8");
        }
      } catch (err) {
        counts.failed++;
        const message = (err as Error).message;
        logger.error(`✗ ${source.relativePath} → ${locale}: ${message}`);
        const { modelId, sourceHash, r2Key } = reportKeysFor(locale);
        entries.push({
          sourcePath: source.relativePath,
          locale,
          sourceHash,
          r2Key,
          outcome: "error",
          model: modelId,
          durationMs: Date.now() - pairStart,
          errorMessage: message,
        });
      } finally {
        processedPairs++;
        maybeEmitProgress();
      }
    }
  }).finally(() => {
    // Stop the heartbeat regardless of outcome; throws still propagate.
    if (heartbeatHandle) {
      clearInterval(heartbeatHandle);
    }
  });

  // Closing summary. Silent when nothing was written (all hits,
  // `r2: null`, or readOnly).
  if (cacheWritesCount > 0 || cacheWritesFailed > 0) {
    const writeWord = (n: number) => `${n} write${n === 1 ? "" : "s"}`;
    if (cacheWritesFailed === 0) {
      logger.info(`R2 cache: completed ${writeWord(cacheWritesCount)}`);
    } else if (cacheWritesCount === 0) {
      logger.warn(`R2 cache: ${writeWord(cacheWritesFailed)} failed`);
    } else {
      logger.warn(`R2 cache: completed ${writeWord(cacheWritesCount)} (${cacheWritesFailed} failed)`);
    }
  }

  // Count-based prune over (locale, sourcePath) pairs this build
  // saw; keep at most `keepLastN` hash variants per pair. Gated:
  // R2 configured, `keepLastN` enabled, not `readOnly` (preview
  // builds don't delete from production), at least one touched pair.
  // Wrapped in try/catch — staging files are already written; a
  // flaky prune isn't worth failing the build for.
  if (r2 && resolved.r2 && resolved.r2.keepLastN !== false && !resolved.r2.readOnly && touchedPairs.size > 0) {
    const keepLastN = resolved.r2.keepLastN;
    const prunePrefix = resolved.r2.prefix;
    try {
      const pruneResult = await pruneCacheByPair({
        r2,
        touchedPairs,
        keepLastN,
        prefix: prunePrefix,
      });
      pruning.deletedKeys.push(...pruneResult.deletedKeys);
      // Build the locale-extraction regex from the configured prefix
      // so non-default namespaces (e.g. `previews/<branch>/i18n/`)
      // extract correctly.
      const escapedPrefix = prunePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const localeRe = new RegExp(`^${escapedPrefix}([^/]+)/`);
      for (const k of pruneResult.deletedKeys) {
        const localeMatch = localeRe.exec(k);
        if (!localeMatch) continue;
        const locale = localeMatch[1]!;
        pruning.byLocale[locale] = (pruning.byLocale[locale] ?? 0) + 1;
      }
      if (pruneResult.deleted > 0) {
        logger.info(
          `R2 cache: pruned ${pruneResult.deleted} stale variant${
            pruneResult.deleted === 1 ? "" : "s"
          } across ${pruneResult.prunedPairs} pair${pruneResult.prunedPairs === 1 ? "" : "s"} (kept last ${keepLastN} per pair)`,
        );
      }
    } catch (err) {
      logger.warn(`R2 cache: prune step failed: ${(err as Error).message}`);
    }
  }

  // Persist the local staging index. Non-fatal on failure: a
  // missing/stale index just means the next run does a full pass.
  try {
    await writeLocalCacheIndex(stagingDir, nextLocalCacheIndex);
  } catch (err) {
    logger.warn(`local staging index: failed to write: ${(err as Error).message}`);
  }

  const noTranslateSummary =
    noTranslateSources > 0 ? `, ${noTranslateSources} noTranslate source${noTranslateSources === 1 ? "" : "s"} skipped` : "";
  const localSkipSummary = counts.localSkipped > 0 ? `, ${counts.localSkipped} local-skipped` : "";
  logger.info(
    `live: ${counts.hit} hit, ${counts.miss} miss, ${counts.override} override, ${counts.failed} failed${localSkipSummary}${noTranslateSummary}`,
  );

  return {
    entries,
    pruning,
    glossariesForReport,
    touchedPairs,
    counts,
    noTranslateSources,
    liveRan: true,
  };
}
