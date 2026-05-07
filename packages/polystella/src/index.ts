import type { AstroIntegration } from "astro";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveOptions, type PolyStellaOptions, type PolyStellaResolvedOptions } from "./config/options.js";
import { formatDriftIssues, loadAndCheckDrift } from "./i18n/drift.js";
import { computeBuildReportTotals, emitBuildReport, type BuildReport } from "./storage/report.js";
import { DEFAULT_STAGING_DIR } from "./storage/paths.js";
import { deriveUrlPattern, generateShimSource } from "./routing/shim.js";
import { runTranslationPass, type RunTranslationResult } from "./translation/run.js";

/**
 * PolyStella's externally-visible version. Baked into R2 metadata
 * + the build report; lives at module scope so the integration AND
 * the standalone CLI/`runTranslationPass` callers all stamp the
 * same value (no per-caller drift).
 *
 * TODO: derive from `package.json` once a build step is in place;
 * keeping it manual today avoids needing to thread JSON imports
 * through the export shape.
 */
export const POLYSTELLA_VERSION = "0.2.0";

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
  resolveModelId,
  translateBatch,
  type CreateTranslatorOptions,
  type TranslateBatchOptions,
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

/**
 * PolyStella — AI-driven content localization for Astro.
 *
 * At `astro:config:setup`:
 *   - validate options + cross-check Astro's `i18n` block,
 *   - register the `polystella:runtime-config` virtual module,
 *   - inject locale-prefixed route shims,
 *   - run UI-strings drift detection,
 *   - in live mode (provider configured + `dryRun: false`), call
 *     `runTranslationPass` to walk `sourceDir` and process each
 *     (file, locale) pair through the cache-aware orchestrator.
 *     Translated bytes land in `<root>/.astro/i18n-staging/{locale}/...`
 *     where `polystellaCollections` (called from the user's
 *     `content.config.ts`) picks them up via per-locale sibling
 *     content collections.
 *
 * At `astro:build:done`, emit `dist/i18n-r2-report.json`.
 *
 * The orchestration loop itself lives in `translation/run.ts` so
 * the same code path runs from the standalone `polystella-translate`
 * CLI without booting Astro.
 */
export default function polystella(options: PolyStellaOptions): AstroIntegration {
  let resolved: PolyStellaResolvedOptions | undefined;

  // Cross-hook state. Astro's hook signatures don't pass state
  // between hooks, so the build-report bookkeeping lives in closure
  // — populated during setup, read at done.
  const reportState: {
    startedAt: string;
    startedAtMs: number;
    runResult: RunTranslationResult | undefined;
  } = {
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    runResult: undefined,
  };

  return {
    name: "polystella",
    hooks: {
      "astro:config:setup": async ({ logger, config, injectRoute, updateConfig, command, addMiddleware }) => {
        resolved = resolveOptions(options, config.i18n);
        logger.info(
          `validated options: defaultLocale=${resolved.defaultLocale}, locales=[${resolved.locales.join(", ")}], mode=${resolved.mode}`,
        );

        // Staging at `<root>/.astro/i18n-staging` (project root, NOT
        // `config.cacheDir` — `cacheDir` resolves to
        // `<root>/node_modules/.astro/` by default and would desync
        // from where `polystellaCollections` reads). Shims, by
        // contrast, can live under `cacheDir` because Astro imports
        // them via the path returned from `injectRoute`.
        const cacheDirPath = fileURLToPath(config.cacheDir);
        const rootDirPath = fileURLToPath(config.root);
        const stagingDir = path.resolve(rootDirPath, DEFAULT_STAGING_DIR);

        // Register the `polystella:runtime-config` virtual module so
        // `getLocalizedEntry` and `localizedHref` can read the
        // resolved locale set + fallback policies at page-render time.
        // The `\0` prefix on the resolved id is Vite's convention for
        // virtual modules.
        const allLocalesIncludingDefault = [resolved.defaultLocale, ...resolved.locales];
        const runtimeConfigSource = [
          `export const defaultLocale = ${JSON.stringify(resolved.defaultLocale)};`,
          `export const locales = ${JSON.stringify(allLocalesIncludingDefault)};`,
          `export const fallback = ${JSON.stringify(resolved.fallback)};`,
          `export const noTranslateBehavior = ${JSON.stringify(resolved.noTranslateBehavior)};`,
          `export const noPrefixUrls = ${JSON.stringify(resolved.noPrefixUrls)};`,
          // `mode` is exposed so the runtime middleware can defer to
          // Starlight's own `Astro.locals.t` when starlight mode lands;
          // standalone/auto runs install polystella's translator.
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

        // Auto-register the per-request middleware that exposes
        // `Astro.locals.t` and `Astro.locals.lhref`. Order is `pre`
        // so user-defined middleware (in `src/middleware.ts`) can
        // read these locals downstream. Consumers can opt out via
        // `middleware: false` in their polystella config and compose
        // manually via `astro:middleware`'s `sequence(...)`.
        //
        // Entrypoint is a package specifier (not a `file://` URL)
        // so Vite resolves it through the package's `exports` map.
        // That keeps the source-vs-built distinction inside the
        // package — Vite picks `./src/runtime/middleware.ts` today;
        // a future build step that ships `./dist/...` would change
        // only the package.json mapping, not this call.
        if (resolved.middleware) {
          addMiddleware({ entrypoint: "polystella/runtime/middleware", order: "pre" });
          logger.info("registered Astro.locals middleware (t + lhref)");
        }

        // For each `routes` entry, generate a shim under
        // `<cacheDir>/polystella-shims/route-<idx>.astro` that
        // imports the source page and re-exports its `getStaticPaths`
        // expanded over non-default locales. See `routing/shim.ts`
        // for the templates.
        if (resolved.routes.length > 0) {
          const shimDir = path.resolve(cacheDirPath, "polystella-shims");
          await mkdir(shimDir, { recursive: true });

          // Resolve global `routesImports` once — the same set is
          // applied to every shim, deduped against per-route extras
          // at emission time so the user can list a path in both
          // places without producing a duplicate import line.
          const globalImportsAbs = resolved.routesImports.map((p) => path.resolve(rootDirPath, p));

          for (let i = 0; i < resolved.routes.length; i++) {
            const route = resolved.routes[i]!;
            const sourceRel = route.source;
            const sourceAbs = path.resolve(rootDirPath, sourceRel);
            const { pattern, isDynamic } = deriveUrlPattern(sourceRel);

            const shimPath = path.join(shimDir, `route-${i}.astro`);
            const shimDirOfFile = path.dirname(shimPath);
            const importPath = path.relative(shimDirOfFile, sourceAbs).replace(/\\/g, "/");

            // Combine global + per-route imports, resolve each to an
            // absolute path, then convert to a path relative to the
            // shim file. Dedupe by absolute path so a shared global
            // file listed in both `routesImports` and the route's
            // `imports` only emits one import line.
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

            // Empty `pattern` means the source was an index (or the
            // homepage); the locale-prefixed pattern collapses to
            // just `/[lang]` in that case.
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

        // UI-strings drift detection. Runs before translation so a
        // missing-key list lands early in the build log. Silent
        // no-op when the default-locale JSON doesn't exist (operators
        // can onboard incrementally).
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

        // Translation pipeline. Runs HERE (in config:setup), not in
        // `astro:build:start`, because `polystellaCollections` registers
        // per-locale sibling collections whose loaders read from
        // `<stagingDir>/<locale>/<collection>/...`. Astro syncs the
        // content layer between config:setup and build:start — if we
        // staged in build:start, the siblings would already be empty
        // when sync ran and the runtime dispatcher would always fall
        // back to source.
        //
        // Explicit `command` narrowing because Astro can pass commands
        // beyond `"build"`/`"dev"` (e.g. `"sync"`, `"preview"`); a
        // bare cast would let those slip past the `runOn` check.
        if (command !== "build" && command !== "dev") {
          return;
        }
        if (!resolved.runOn.includes(command)) {
          return;
        }

        reportState.runResult = await runTranslationPass({
          resolved,
          rootDir: rootDirPath,
          stagingDir,
          logger,
          polystellaVersion: POLYSTELLA_VERSION,
        });
      },
      "astro:build:done": async ({ dir, logger }) => {
        // Emit the build report. No-op when the integration never
        // ran in live mode (entries empty), so dev / dryRun builds
        // don't clutter the dist directory.
        if (!resolved) return;
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
