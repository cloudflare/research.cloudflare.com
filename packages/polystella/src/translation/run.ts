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
 * Standalone translation pass extracted from the Astro integration's
 * `astro:config:setup` hook. The same code path runs from:
 *   - the integration (passing Astro's logger + paths in), and
 *   - the `polystella-translate` CLI (passing a console-backed logger
 *     and the project root resolved from `process.cwd()`).
 *
 * Lives separately from `index.ts` so it has zero direct dependency
 * on Astro's `AstroIntegration` types — the CLI must be runnable
 * without Astro on the import path.
 *
 * What this function does NOT do:
 *   - Inject Astro routes / shims (purely build-time concern).
 *   - Run UI-strings drift detection (the integration runs that
 *     before calling here so its error path matches the build's
 *     fail-fast behaviour; the CLI runs it separately if requested).
 *   - Emit the build report to disk (callers do that, since the
 *     output directory differs between `dist/` and CLI use cases).
 */

/**
 * Minimal logger surface we lean on. Compatible with Astro's
 * `AstroIntegrationLogger` and easy to satisfy from a console-backed
 * stub in the CLI / tests.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface RunTranslationOptions {
  /**
   * Already-validated options. Callers must pass a fully-resolved
   * config (run through `resolveOptions`) — `runTranslationPass`
   * trusts the schema-level invariants (e.g. `r2.prefix` ends with
   * `/`) instead of re-validating.
   */
  resolved: PolyStellaResolvedOptions;
  /** Absolute path to the Astro project root. */
  rootDir: string;
  /**
   * Absolute path to the directory where translated files will land
   * (typically `<rootDir>/.astro/i18n-staging`). Created if missing.
   */
  stagingDir: string;
  logger: Logger;
  /**
   * Version string baked into R2 metadata + the build report. Threaded
   * in (rather than hardcoded) so a single source-of-truth in
   * `index.ts` doesn't get split when packagers add a build step.
   */
  polystellaVersion: string;
  /**
   * Bypass `createR2Client(resolved.r2)`. `null` skips caching even
   * if `resolved.r2` is set; an R2Client redirects storage to a
   * test fixture or a local development bucket. When `undefined`
   * (the default), `runTranslationPass` builds the client from
   * `resolved.r2` normally.
   */
  r2Override?: R2Client | null;
  /**
   * Per-locale Translator overrides. Locales present in the map skip
   * `createTranslator(resolved.provider, locale)` and use the
   * supplied translator instead; missing locales fall back to the
   * standard factory.
   *
   * Used by tests for deterministic translators and by callers that
   * want to swap the provider for a single run (e.g. a debug mode
   * that records prompts to disk).
   */
  translatorOverrides?: Map<string, Translator>;
}

export interface RunTranslationCounts {
  hit: number;
  miss: number;
  override: number;
  failed: number;
  /**
   * Pairs short-circuited by the on-disk staging index (matching
   * source hash + staged file present, no R2 GET issued). Distinct
   * from `hit` so reports and logs can quantify R2 traffic saved.
   */
  localSkipped: number;
}

export interface RunTranslationResult {
  /** Build-report entries (one per processed (source, locale) pair). */
  entries: BuildReportEntry[];
  /** Prune outcome; `deletedKeys` empty when no prune ran. */
  pruning: BuildReportPruning;
  /**
   * Per-locale glossary metadata (file path + content hash) for
   * locales whose glossary loaded successfully. Used by the build
   * report's top-level glossary inventory.
   */
  glossariesForReport: Record<string, { file: string; sha256: string }>;
  /**
   * Pairs the run actually processed (translated, cached-hit, or
   * override-applied). Surfaced for tests + diagnostic logging; not
   * required by callers that only need the build report.
   */
  touchedPairs: Set<string>;
  counts: RunTranslationCounts;
  /** Sources flagged with `noTranslate: true` and consequently skipped. */
  noTranslateSources: number;
  /**
   * `false` when the run skipped the actual translation step (no
   * provider configured, `dryRun` true, or zero matching sources).
   * Callers (e.g. the integration) use this to decide whether to
   * emit a build report.
   */
  liveRan: boolean;
}

/**
 * Stage translated bytes at `<stagingDir>/<locale>/<relativeSourcePath>`.
 * Layout matches what `polystellaCollections` registers as the sibling
 * collection's glob base.
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
 * Resolve which per-glob → key-paths map an adapter consumes for
 * translatable scalars. Markdown reads `markdown.keys`; TOML reads
 * `toml.keys`; JSON reads `json.keys`; YAML reads `yaml.keys`.
 * For extensions an adapter doesn't claim, this returns `{}` so the
 * adapter sees no translatable keys at all (a defensible default —
 * the source still passes through, segments are empty, no cache
 * miss is generated).
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
 * Resolve which per-glob → URL-path map an adapter consumes. Same
 * dispatch shape as `pickTranslatableKeysForAdapter` but for URL
 * fields. Markdown URLs cover frontmatter only; body inline links
 * are handled separately by the bytes-level rewriter.
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

/**
 * Resolve the URL path list for a single source. Same logic as the
 * translatable-keys resolver in the markdown extractor: union every
 * matching glob's list, deduplicated, in insertion order.
 */
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

/**
 * Build the ordered list of fallback R2 keys for a (locale, hash, source)
 * tuple. Resolves each configured `readFallbackPrefixes` entry through
 * `buildR2Key` so callers don't need their own key concatenation logic.
 */
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
 * Execute the full translation pass: walk sources, load glossaries,
 * build translators + R2 client, run the cache-aware orchestrator
 * across every (file, locale) pair, then optionally prune.
 *
 * Returns the data necessary to emit a build report — the caller is
 * responsible for serialising it.
 */
export async function runTranslationPass(opts: RunTranslationOptions): Promise<RunTranslationResult> {
  const { resolved, rootDir, stagingDir, logger, polystellaVersion, r2Override, translatorOverrides } = opts;
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

  // Load + hash glossaries once. The hash is shared across every
  // (file, locale) pair using the same glossary, so doing it here
  // avoids re-hashing in the per-file loop.
  // `pathToFileURL` produces an Astro-compatible `file://` URL even
  // for paths containing spaces or unicode — manual concatenation
  // would silently mishandle those.
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

  // One Translator per locale. Empty when `provider` is omitted (the
  // model-id field of the cache key collapses to ""). Per-locale
  // overrides win when supplied.
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

  // `null` means the operator opted out of caching; the orchestrator
  // skips both lookup and write-back in that case. `r2Override`
  // (when supplied) wins — used by tests and by CLI users redirecting
  // to a local fixture.
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
      // `r2Override` was supplied without `resolved.r2`; keep the
      // log line meaningful instead of asserting on credentials we
      // don't have.
      logger.info(`R2 cache: using injected client`);
    }
  } else {
    logger.info(`R2 cache: not configured — translations will not be cached or shared`);
  }

  const sources = await walkSources({
    sourceDir: sourceDirAbs,
    include: resolved.include,
    exclude: resolved.exclude,
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

  // Live mode requires a provider AND dryRun off. When either is
  // missing we return early with the dry-run-only counts so the
  // caller can still log the planned key set without writing
  // anywhere.
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

  logger.info(
    `live: processing ${sources.length} × ${resolved.locales.length} (file, locale) pairs at concurrency ${resolved.concurrency}`,
  );

  // On-disk staging index. Captures the source hash of every pair
  // we last staged at `<stagingDir>/<locale>/<source>` so the next
  // run can short-circuit unchanged pairs (no R2 GET, no staging
  // write). The index is loaded ONCE up front; per-pair workers
  // both read from it (skip-decision) and write to a separate
  // `nextLocalCacheIndex` Map that we persist at the end.
  //
  // Reading from `localCacheIndex` and writing to
  // `nextLocalCacheIndex` keeps the skip decision deterministic for
  // the duration of the run (a worker won't accidentally observe
  // another worker's just-written entry as a "skip me" signal).
  // Each pair's key is unique so there's no contention on the
  // write side.
  const localCacheIndex = await readLocalCacheIndex(stagingDir);
  const nextLocalCacheIndex = new Map<string, LocalCacheEntry>();
  if (localCacheIndex.size > 0) {
    logger.debug(`local staging index: ${localCacheIndex.size} entries from previous run`);
  }

  // Cache-write bookkeeping. Single "starting writes…" line on the
  // first PUT and a single closing summary, so per-write chatter
  // doesn't drown the build log on a cold cache.
  let cacheWritesCount = 0;
  let cacheWritesFailed = 0;
  let cacheWritesAnnounced = false;

  // Locale list passed to the link rewriter includes the default
  // so already-prefixed `/${defaultLocale}/...` URLs (rare but
  // legitimate) aren't treated as rewriteable.
  const allLocalesForRewrite = [resolved.defaultLocale, ...resolved.locales];
  const buildRewriteOpts = (locale: string): RewriteInternalLinksOptions => ({
    targetLocale: locale,
    locales: allLocalesForRewrite,
    ...(resolved.noPrefixUrls.length > 0 ? { noPrefixUrls: resolved.noPrefixUrls } : {}),
  });
  /**
   * Apply all post-cache URL rewrites to staged bytes:
   *
   *   1. Adapter-specific key-path-based rewriting (frontmatter URL
   *      keys for markdown; structured URL paths for TOML/etc.) via
   *      `adapter.rewriteUrls?`. No-op when the adapter doesn't
   *      implement it or `urlPathsForSource` is empty.
   *   2. Markdown body inline-link rewriting via
   *      `rewriteInternalLinks` over bytes — handled here only for
   *      markdown extensions; structured-data formats have no body
   *      links to rewrite.
   *
   * Both layers honour `noPrefixUrls` because they share
   * `rewriteUrlIfInternal` underneath. Idempotent.
   */
  const maybeRewrite = (
    bytes: string,
    locale: string,
    adapter: FileTypeAdapter,
    urlPathsForSource: string[],
  ): string => {
    if (!resolved.rewriteInternalLinks) return bytes;
    const rewriteOpts = buildRewriteOpts(locale);
    let next = bytes;
    if (adapter.rewriteUrls && urlPathsForSource.length > 0) {
      const rewriter = (url: string) => rewriteUrlIfInternal(url, rewriteOpts);
      next = adapter.rewriteUrls(next, { paths: urlPathsForSource, rewriter });
    }
    // Body-link rewriter is markdown-only (it parses with
    // `parseMarkdown`). Structured-data formats short-circuit out.
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
    const ext = path.extname(source.relativePath).toLowerCase();
    const adapter = getAdapter(ext);
    if (!adapter) {
      // Already warned in the dry-run pass above; silently drop here
      // so a single source file with an unsupported extension doesn't
      // double-log on every run.
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
    const urlPathsForSource = resolveUrlPathsForSource(
      pickUrlKeysForAdapter(adapter, resolved),
      source.relativePath,
    );

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

    // `noTranslate: true` skips translation entirely. Overrides
    // still apply (operator opt-back-in, per-locale).
    if (adapter.peekNoTranslate(parsed)) {
      noTranslateSources++;
      for (const locale of resolved.locales) {
        const pairStart = Date.now();
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
      }
      if (resolved.verbose) {
        logger.info(`⊘ ${source.relativePath} [noTranslate=true; skipping AI translation]`);
      }
      // `return` (not `continue`) — this is the pool worker, not
      // a for-loop body.
      return;
    }

    const segments = adapter.extractSegments(parsed, body, adapterOpts);
    // Reused across the per-locale loop below.
    const selectedValues = adapter.selectedValuesForHash(parsed, body, adapterOpts);

    for (const locale of resolved.locales) {
      const pairStart = Date.now();
      try {
        // Overrides take precedence over cache + translator and are
        // deliberately NOT written to R2 (they're source-controlled
        // artefacts, not machine-generated).
        const override = await readOverride({
          rootDir,
          overridesDir: resolved.overridesDir,
          locale,
          relativeSourcePath: source.relativePath,
        });
        if (override !== null) {
          // Run the rewriter on overrides so an operator's hand-
          // translated file with raw internal links still gets locale-
          // prefixed. Idempotent.
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

        // Local-cache skip: if the on-disk index already records
        // this exact source hash for this (locale, source) pair AND
        // the staged file is still on disk, skip the R2 GET and the
        // staging write entirely. The hash folds in body +
        // frontmatter + glossary + model, so a match means the
        // staged file IS the right translation.
        //
        // We still record an entry (with `local-skipped`) and add
        // to `touchedPairs` so the prune step considers this pair
        // alive (otherwise repeated unchanged builds would let the
        // pruner gradually evict R2 variants the build wants to
        // keep).
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
          // Carry the entry forward so a later run skips it again.
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
        // Single timestamp shared between the R2 metadata and the
        // in-bytes `aiTranslatedAt` marker so they don't drift if
        // anyone diffs cache vs. staged file.
        const translatedAt = new Date().toISOString();
        // AI-translation marker. Baked into the apply closure so it
        // lands in the bytes BEFORE the R2 PUT, keeping `aiTranslatedAt`
        // truthful on later cache hits.
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

        // Link rewrite happens AFTER the cache layer so cached bytes
        // store the translation-only output; toggling
        // `rewriteInternalLinks` (or editing `noPrefixUrls`) doesn't
        // invalidate the cache, and the rewriter's idempotent guard
        // prevents double-prefixing on cache hits. Same applies to
        // adapter-driven URL rewriting (frontmatter URL keys for
        // markdown, structured paths for TOML).
        const stagedBody = maybeRewrite(result.body, locale, adapter, urlPathsForSource);
        await writeStagedTranslation({
          stagingDir,
          locale,
          relativeSourcePath: source.relativePath,
          bytes: stagedBody,
        });
        // Record the staged hash so the next run can skip this pair
        // when the source is unchanged. We store AFTER the staging
        // write so a crashed build (write threw) doesn't leave a
        // "we have this staged" claim that contradicts disk state.
        nextLocalCacheIndex.set(lcKey, {
          hash: sourceHash,
          stagedAt: translatedAt,
        });

        if (resolved.verbose) {
          // Use a distinct marker for fallback hits so log readers
          // can tell when a preview build pulled from main's cache.
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
      }
    }
  });

  // Cache-write closing summary. Silent when nothing was written
  // (all hits, `r2: null`, or readOnly).
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

  // Count-based prune. Walk only the (locale, sourcePath) pairs this
  // build saw and keep at most `keepLastN` hash variants per pair.
  // Gated on:
  //   - R2 actually configured,
  //   - `keepLastN` not explicitly disabled,
  //   - `readOnly` not set (preview builds don't get to delete from
  //     production's namespace),
  //   - at least one pair was touched.
  // Wrapped in try/catch so a flaky R2 list/del during prune doesn't
  // fail the run — staging files are already written, and the next
  // run will retry the prune.
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
      // Locale extraction uses a regex built from the configured
      // prefix so non-default namespaces (e.g.
      // `previews/<branch>/i18n/`) extract correctly.
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

  // Persist the local staging index. Failures here are non-fatal:
  // the staged files are already on disk, and a missing/stale index
  // just means the next run does a full pass (which it would have
  // done anyway pre-optimisation).
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
