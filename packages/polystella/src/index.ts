import type { AstroIntegration } from "astro";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveOptions, type PolyStellaOptions, type PolyStellaResolvedOptions } from "./config/options.js";
import { EMPTY_GLOSSARY_HASH, hashGlossary, loadGlossaries, type Glossary } from "./glossary/glossary.js";
import { formatDriftIssues, loadAndCheckDrift } from "./i18n/drift.js";
import { setRuntimeBridge, type CustomLoaderTranslateRecord, type PolystellaRuntimeBridge } from "./runtime/custom-loader-runtime.js";
import { computeBuildReportTotals, emitBuildReport, type BuildReport } from "./storage/report.js";
import { DEFAULT_STAGING_DIR } from "./storage/paths.js";
import { createR2Client, type R2Client } from "./storage/r2.js";
import { expandRoutes } from "./routing/expand-routes.js";
import { deriveUrlPattern, generateShimSource } from "./routing/shim.js";
import { walkPages } from "./routing/walk-pages.js";
import { createTranslator, type Translator } from "./translation/provider.js";
import { runTranslationPass, type RunTranslationResult } from "./translation/run.js";

export { POLYSTELLA_VERSION } from "./version.js";
import { POLYSTELLA_VERSION } from "./version.js";

export type { PolyStellaOptions, PolyStellaResolvedOptions };
export { computeSourceHash, type HashInput } from "./storage/hash.js";
export { walkSources, type SourceFile, type WalkOptions } from "./source/walk.js";
export {
  EMPTY_GLOSSARY,
  EMPTY_GLOSSARY_HASH,
  hashGlossary,
  loadGlossaries,
  type Glossary,
  type LoadGlossariesOptions,
  type StyleRule,
} from "./glossary/glossary.js";
export { applyTranslations } from "./parsing/apply.js";
export { rewriteInternalLinks, rewriteUrlIfInternal, type RewriteInternalLinksOptions } from "./parsing/rewrite-links.js";
export {
  extractSegments,
  peekNoTranslate,
  resolveFrontmatterKeys,
  selectTranslatableFrontmatter,
  type Segment,
  type ExtractOptions,
} from "./parsing/extract.js";
export { parseMarkdown, createMarkdownProcessor } from "./parsing/parse.js";
export { buildPrompt, parseResponse, type BuildPromptInput, type BuiltPrompt } from "./translation/prompt.js";
export {
  createTranslator,
  PermanentProviderError,
  resolveModelId,
  translateBatch,
  type CreateTranslatorOptions,
  type TranslateBatchOptions,
  type TranslateBatchRetryEvent,
  type Translator,
} from "./translation/provider.js";
export {
  buildR2Key,
  createR2Client,
  DEFAULT_R2_KEY_PREFIX,
  type R2Client,
  type R2ConnectionOptions,
  type R2GetResult,
  type R2ListEntry,
  type R2PutOptions,
} from "./storage/r2.js";
export { DEFAULT_STAGING_DIR, DEFAULT_STAGING_GLOB } from "./storage/paths.js";
export {
  buildCacheMetadata,
  translateOrLoadFromCache,
  type BuildCacheMetadataInput,
  type CacheEvents,
  type CacheOutcome,
  type TranslateOrLoadOptions,
  type TranslateOrLoadResult,
} from "./storage/cache.js";
export { readOverride, resolveOverridePath, type ReadOverrideOptions } from "./source/overrides.js";
export { pruneCacheByPair, encodeTouchedPair, decodeTouchedPair, type PruneCacheByPairOptions, type PruneResult } from "./storage/prune.js";
export {
  LOCAL_CACHE_INDEX_FILENAME,
  localCacheKey,
  readLocalCacheIndex,
  stagedFileExists,
  writeLocalCacheIndex,
  type LocalCacheEntry,
} from "./storage/local-cache.js";
export {
  computeBuildReportTotals,
  emitBuildReport,
  type BuildReport,
  type BuildReportEntry,
  type BuildReportOutcome,
  type BuildReportPruning,
  type BuildReportTotals,
  type EmitBuildReportOptions,
} from "./storage/report.js";
export { deriveUrlPattern, generateShimSource, type DerivedUrlPattern, type GenerateShimSourceInput } from "./routing/shim.js";
export {
  runTranslationPass,
  type Logger,
  type RunTranslationOptions,
  type RunTranslationResult,
  type RunTranslationCounts,
} from "./translation/run.js";
export { loadAndCheckDrift, formatDriftIssues } from "./i18n/drift.js";
export { astroSitemapI18n, type AstroSitemapI18nInput, type AstroSitemapI18nOptions, type AstroSitemapI18nOutput } from "./i18n/sitemap.js";

/**
 * PolyStella — AI-driven content localization for Astro.
 *
 * Two hooks: `astro:config:setup` runs the full pipeline (validate,
 * stage translations, register virtual module + middleware, inject
 * shims, drift-check); `astro:build:done` emits the build report.
 * Orchestration lives in `translation/run.ts` so the same code path
 * powers the standalone CLI. See ARCHITECTURE.md §1, §2.
 */
export default function polystella(options: PolyStellaOptions): AstroIntegration {
  let resolved: PolyStellaResolvedOptions | undefined;

  // Cross-hook state lives in closure since Astro's hook signatures
  // don't pass state between hooks. `bridgeReportSink` is shared with
  // the runtime bridge — custom-loader siblings push per-(entry,
  // locale) outcomes at content-sync time, `build:done` surfaces them.
  const reportState: {
    startedAt: string;
    startedAtMs: number;
    runResult: RunTranslationResult | undefined;
    bridgeReportSink: CustomLoaderTranslateRecord[];
  } = {
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    runResult: undefined,
    bridgeReportSink: [],
  };

  return {
    name: "polystella",
    hooks: {
      "astro:config:setup": async ({ logger, config, injectRoute, updateConfig, command, addMiddleware }) => {
        resolved = resolveOptions(options, config.i18n);
        logger.info(
          `validated options: defaultLocale=${resolved.defaultLocale}, locales=[${resolved.locales.join(", ")}], mode=${resolved.mode}`,
        );

        // Staging lives under the project root, not `config.cacheDir`,
        // so `polystellaCollections` reads from the same place. See
        // ARCHITECTURE.md §3.
        const cacheDirPath = fileURLToPath(config.cacheDir);
        const rootDirPath = fileURLToPath(config.root);
        const stagingDir = path.resolve(rootDirPath, DEFAULT_STAGING_DIR);

        // Virtual module read by `getLocalizedEntry` / `localizedHref`
        // / the middleware at page-render time. `\0` prefix is Vite's
        // virtual-module convention. `mode` is exposed so the
        // middleware can defer to Starlight's `t` when that mode lands.
        const allLocalesIncludingDefault = [resolved.defaultLocale, ...resolved.locales];
        const runtimeConfigSource = [
          `export const defaultLocale = ${JSON.stringify(resolved.defaultLocale)};`,
          `export const locales = ${JSON.stringify(allLocalesIncludingDefault)};`,
          `export const fallback = ${JSON.stringify(resolved.fallback)};`,
          `export const noTranslateBehavior = ${JSON.stringify(resolved.noTranslateBehavior)};`,
          `export const noPrefixUrls = ${JSON.stringify(resolved.noPrefixUrls)};`,
          `export const mode = ${JSON.stringify(resolved.mode)};`,
          "",
        ].join("\n");
        updateConfig({
          vite: {
            plugins: [
              {
                name: "polystella:runtime-config",
                resolveId(id: string) {
                  if (id === "polystella:runtime-config") {
                    return "\0polystella:runtime-config";
                  }
                  return undefined;
                },
                load(id: string) {
                  if (id === "\0polystella:runtime-config") {
                    return runtimeConfigSource;
                  }
                  return undefined;
                },
              },
            ],
          },
        });

        // Auto-register per-request middleware exposing `Astro.locals.t`
        // and `lhref`. Order `pre` so user middleware reads these
        // downstream. Entrypoint is a package specifier (not a file
        // URL) so Vite resolves through the package's `exports` map.
        // Opt out via `middleware: false` + manual `sequence(...)`.
        if (resolved.middleware) {
          addMiddleware({ entrypoint: "polystella/runtime/middleware", order: "pre" });
          logger.info("registered Astro.locals middleware (t + lhref)");
        }

        // Nuke stale shims unconditionally — a previous build with a
        // different `routes` config can leave entries we no longer want.
        const shimDir = path.resolve(cacheDirPath, "polystella-shims");
        await rm(shimDir, { recursive: true, force: true });

        // Glob-expand `routes` against on-disk pages. Literals pass
        // through; globs match every available page outside the
        // auto-exclusion list (404.astro, `_*` segments).
        const availablePages = await walkPages(rootDirPath);
        const expandedRoutes = expandRoutes(resolved.routes, availablePages);
        if (resolved.routes.length > 0 && expandedRoutes.length === 0) {
          logger.warn(
            `routes config produced no matches against the project. Configured patterns: ${resolved.routes.map((r) => r.source).join(", ")}`,
          );
        } else if (expandedRoutes.length !== resolved.routes.length) {
          logger.info(`routes: ${resolved.routes.length} pattern(s) → ${expandedRoutes.length} resolved page(s)`);
        }

        // For each resolved route, write a shim that imports the
        // source page and re-exports `getStaticPaths` expanded over
        // non-default locales. See `routing/shim.ts` + ARCHITECTURE.md §14.
        if (expandedRoutes.length > 0) {
          await mkdir(shimDir, { recursive: true });

          // Global `routesImports` apply to every shim; deduped against
          // per-route extras by absolute path at emission.
          const globalImportsAbs = resolved.routesImports.map((p) => path.resolve(rootDirPath, p));

          for (let i = 0; i < expandedRoutes.length; i++) {
            const route = expandedRoutes[i];
            if (route === undefined) continue;
            const sourceRel = route.source;
            const sourceAbs = path.resolve(rootDirPath, sourceRel);
            const { pattern, isDynamic } = deriveUrlPattern(sourceRel);

            const shimPath = path.join(shimDir, `route-${i}.astro`);
            const shimDirOfFile = path.dirname(shimPath);
            const importPath = path.relative(shimDirOfFile, sourceAbs).replace(/\\/g, "/");

            // Combine global + per-route, dedupe by absolute path,
            // emit relative-to-shim.
            const perRouteAbs = route.imports.map((p) => path.resolve(rootDirPath, p));
            const allAbs = [...globalImportsAbs, ...perRouteAbs];
            const seen = new Set<string>();
            const importPaths: string[] = [];
            for (const abs of allAbs) {
              if (seen.has(abs)) continue;
              seen.add(abs);
              importPaths.push(path.relative(shimDirOfFile, abs).replace(/\\/g, "/"));
            }

            await writeFile(
              shimPath,
              generateShimSource({
                relativeImportPath: importPath,
                isDynamic,
                locales: resolved.locales,
                imports: importPaths,
              }),
              "utf8",
            );

            // Empty pattern = index/homepage; collapse to `/[lang]`.
            const injectPattern = pattern === "" ? "/[lang]" : `/[lang]/${pattern}`;
            injectRoute({
              pattern: injectPattern,
              entrypoint: shimPath,
            });
            logger.info(
              `injected localized route: ${injectPattern} → ${sourceRel}${
                importPaths.length > 0 ? ` (with ${importPaths.length} extra import${importPaths.length === 1 ? "" : "s"})` : ""
              }`,
            );
          }
        }

        // UI-strings drift detection runs before translation so a
        // missing-key list lands early. Silent no-op when the default-
        // locale JSON doesn't exist (incremental onboarding).
        const driftResult = await loadAndCheckDrift({
          rootDir: rootDirPath,
          baseDir: "./src/content/i18n",
          locales: allLocalesIncludingDefault,
          defaultLocale: resolved.defaultLocale,
        });
        if (!driftResult.ok) {
          throw new Error(
            `[polystella] UI-strings dictionary drift detected. Every declared locale must have a \`src/content/i18n/<locale>.json\` file with the same key set as the default-locale file (${
              resolved.defaultLocale
            }.json):\n${formatDriftIssues(
              driftResult.issues,
            )}\n\nFix the listed locales and rebuild. To opt out of drift detection entirely, remove the default-locale JSON file (the integration silently skips drift checks until that file exists).`,
          );
        }

        const bridgeReportSink: CustomLoaderTranslateRecord[] = [];
        reportState.bridgeReportSink = bridgeReportSink;

        // Translation runs HERE (config:setup), not in `build:start`.
        // See ARCHITECTURE.md §2 — this is the single most surprising
        // ordering constraint in the integration.
        //
        // Explicit `command` narrowing — Astro can pass `"sync"`,
        // `"preview"`, etc.; a bare cast would let those slip past
        // the `runOn` check.
        const willRun = (command === "build" || command === "dev") && resolved.runOn.includes(command);
        if (willRun) {
          reportState.runResult = await runTranslationPass({
            resolved,
            rootDir: rootDirPath,
            stagingDir,
            logger,
            polystellaVersion: POLYSTELLA_VERSION,
          });
        }

        // Publish the runtime bridge so custom-loader siblings (which
        // run later, at content-sync time) can translate captured
        // entries inline. Reuses glossaries the translation pass
        // already loaded (when it ran); falls back to a fresh load
        // otherwise. See ARCHITECTURE.md §4.
        await publishRuntimeBridge({
          resolved,
          rootDirPath,
          stagingDir,
          bridgeReportSink,
          preloadedGlossaries: reportState.runResult?.glossariesByLocale,
          preloadedGlossaryHashes: reportState.runResult?.glossaryHashByLocale,
        });
      },
      "astro:build:done": async ({ dir, logger }) => {
        if (!resolved) return;

        // Custom-loader summary runs first so dev / dryRun builds
        // (where the file pipeline produces no entries) still surface
        // sibling-loader outcomes.
        const sink = reportState.bridgeReportSink;
        if (sink.length > 0) {
          const counts = sink.reduce(
            (acc, rec) => {
              acc[rec.outcome] = (acc[rec.outcome] ?? 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          );
          const summary = Object.entries(counts)
            .map(([outcome, n]) => `${n} ${outcome}`)
            .join(", ");
          logger.info(`i18n custom-loader summary: ${sink.length} entry/locale pair(s) — ${summary}`);
        }

        // Emit `dist/i18n-r2-report.json`. No-op when nothing ran
        // in live mode, so dev / dryRun builds stay clean.
        const runResult = reportState.runResult;
        if (!runResult || runResult.entries.length === 0) return;

        const report: BuildReport = {
          build: {
            startedAt: reportState.startedAt,
            durationMs: Date.now() - reportState.startedAtMs,
            mode: resolved.mode === "starlight" ? "starlight" : "standalone",
            polystellaVersion: POLYSTELLA_VERSION,
          },
          locales: [resolved.defaultLocale, ...resolved.locales],
          defaultLocale: resolved.defaultLocale,
          glossaries: runResult.glossariesForReport,
          entries: runResult.entries,
          totals: computeBuildReportTotals(runResult.entries),
          pruning: runResult.pruning,
        };

        try {
          const outDir = fileURLToPath(dir);
          const reportPath = await emitBuildReport({ outDir, report });
          logger.info(
            `i18n build report: ${path.relative(outDir, reportPath)} (${report.entries.length} entries, ${report.totals.cacheHits} hit / ${
              report.totals.aiTranslated
            } miss / ${report.totals.overrides} override / ${report.totals.errors} error)`,
          );
        } catch (err) {
          logger.warn(`i18n build report: failed to write: ${(err as Error).message}`);
        }
      },
    },
  };
}

/**
 * Build + publish the per-build runtime bridge. Read at content-sync
 * time by per-locale sibling loaders derived from `polystellaLoader`-
 * wrapped sources. Deps duplicate `runTranslationPass`'s setup; the
 * Reuses glossaries from a prior `runTranslationPass` when supplied
 * (saves one FS read per locale). Falls back to fresh loads when
 * the translation pass didn't run (e.g. `runOn: ["build"]` + dev
 * command). See ARCHITECTURE.md §4.
 *
 * Empty translator map ⇒ sibling loader degrades to passthrough so
 * routes still render with source content.
 */
async function publishRuntimeBridge(opts: {
  resolved: PolyStellaResolvedOptions;
  rootDirPath: string;
  stagingDir: string;
  bridgeReportSink: CustomLoaderTranslateRecord[];
  preloadedGlossaries?: Map<string, Glossary> | undefined;
  preloadedGlossaryHashes?: Map<string, string> | undefined;
}): Promise<void> {
  const { resolved, rootDirPath, stagingDir, bridgeReportSink, preloadedGlossaries, preloadedGlossaryHashes } = opts;

  const glossaries: Map<string, Glossary> =
    preloadedGlossaries ??
    (await loadGlossaries({
      config: resolved,
      projectRoot: pathToFileURL(rootDirPath + path.sep),
    }));
  const glossaryHashByLocale = preloadedGlossaryHashes ?? new Map<string, string>();
  if (preloadedGlossaryHashes === undefined) {
    for (const locale of resolved.locales) {
      const glossary = glossaries.get(locale);
      glossaryHashByLocale.set(locale, glossary ? hashGlossary(glossary) : EMPTY_GLOSSARY_HASH);
    }
  }

  const translatorsByLocale = new Map<string, Translator>();
  if (resolved.provider && !resolved.dryRun) {
    for (const locale of resolved.locales) {
      translatorsByLocale.set(locale, createTranslator(resolved.provider, locale));
    }
  }

  // `readOnly` is preserved so preview builds don't write back to
  // the primary cache.
  const r2: R2Client | null = resolved.r2
    ? createR2Client({
        accountId: resolved.r2.accountId,
        bucket: resolved.r2.bucket,
        accessKeyId: resolved.r2.accessKeyId,
        secretAccessKey: resolved.r2.secretAccessKey,
        ...(resolved.r2.endpoint ? { endpoint: resolved.r2.endpoint } : {}),
      })
    : null;

  const bridge: PolystellaRuntimeBridge = {
    defaultLocale: resolved.defaultLocale,
    polystellaVersion: POLYSTELLA_VERSION,
    ...(resolved.prompt?.context !== undefined ? { context: resolved.prompt.context } : {}),
    r2,
    ...(resolved.r2?.prefix !== undefined ? { r2Prefix: resolved.r2.prefix } : {}),
    r2ReadOnly: resolved.r2?.readOnly ?? false,
    readFallbackPrefixes: resolved.r2?.readFallbackPrefixes ?? [],
    stagingDir,
    concurrency: resolved.concurrency,
    translatorsByLocale,
    glossariesByLocale: glossaries,
    glossaryHashByLocale,
    reportSink: bridgeReportSink,
  };

  setRuntimeBridge(bridge);
}
