import type { AstroIntegration } from "astro";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCacheMetadata,
  translateOrLoadFromCache,
  type CacheOutcome,
} from "./storage/cache.js";
import { readOverride } from "./source/overrides.js";
import { encodeTouchedPair, pruneCacheByPair } from "./storage/prune.js";
import {
  extractSegments,
  peekNoTranslate,
  selectTranslatableFrontmatter,
} from "./parsing/extract.js";
import {
  EMPTY_GLOSSARY,
  EMPTY_GLOSSARY_HASH,
  hashGlossary,
  loadGlossaries,
} from "./glossary/glossary.js";
import {
  resolveOptions,
  type PolyStellaOptions,
  type PolyStellaResolvedOptions,
} from "./config/options.js";
import { parseMarkdown } from "./parsing/parse.js";
import {
  rewriteInternalLinks,
  type RewriteInternalLinksOptions,
} from "./parsing/rewrite-links.js";
import { createTranslator, type Translator } from "./translation/provider.js";
import { walkSources } from "./source/walk.js";
import { runWithConcurrency } from "./source/pool.js";
import { formatDriftIssues, loadAndCheckDrift } from "./ui/drift.js";
import {
  computeBuildReportTotals,
  emitBuildReport,
  type BuildReport,
  type BuildReportEntry,
  type BuildReportPruning,
} from "./storage/report.js";
import { computeSourceHash } from "./storage/hash.js";
import { buildR2Key, createR2Client, type R2Client } from "./storage/r2.js";
import { DEFAULT_STAGING_DIR } from "./storage/paths.js";
import { deriveUrlPattern, generateShimSource } from "./routing/shim.js";

// TODO: read from package.json once we want the version surfaced in
// build reports / R2 metadata without manual edits per release.
const POLYSTELLA_VERSION = "0.1.0";

export type { PolyStellaOptions, PolyStellaResolvedOptions };
export { computeSourceHash, type HashInput } from "./storage/hash.js";
export {
  walkSources,
  type SourceFile,
  type WalkOptions,
} from "./source/walk.js";
export {
  EMPTY_GLOSSARY,
  EMPTY_GLOSSARY_HASH,
  hashGlossary,
  loadGlossaries,
  type Glossary,
  type LoadGlossariesOptions,
} from "./glossary/glossary.js";
export { applyTranslations } from "./parsing/apply.js";
export {
  rewriteInternalLinks,
  rewriteUrlIfInternal,
  type RewriteInternalLinksOptions,
} from "./parsing/rewrite-links.js";
export {
  extractSegments,
  peekNoTranslate,
  resolveFrontmatterKeys,
  selectTranslatableFrontmatter,
  type Segment,
  type ExtractOptions,
} from "./parsing/extract.js";
export { parseMarkdown, createMarkdownProcessor } from "./parsing/parse.js";
export {
  buildPrompt,
  parseResponse,
  type BuildPromptInput,
  type BuiltPrompt,
} from "./translation/prompt.js";
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
export {
  readOverride,
  resolveOverridePath,
  type ReadOverrideOptions,
} from "./source/overrides.js";
export {
  pruneCacheByPair,
  encodeTouchedPair,
  decodeTouchedPair,
  type PruneCacheByPairOptions,
  type PruneResult,
} from "./storage/prune.js";
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
export {
  deriveUrlPattern,
  generateShimSource,
  type DerivedUrlPattern,
  type GenerateShimSourceInput,
} from "./routing/shim.js";

/**
 * Write translated bytes to `<stagingDir>/<locale>/<relativeSourcePath>`.
 * The path layout matches what `polystellaCollections` registers as
 * the sibling collection's glob base.
 */
async function writeStagedTranslation(args: {
  stagingDir: string;
  locale: string;
  relativeSourcePath: string;
  bytes: string;
}): Promise<void> {
  const target = path.join(
    args.stagingDir,
    args.locale,
    args.relativeSourcePath,
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, args.bytes, "utf8");
}

/**
 * PolyStella — AI-driven content localization for Astro.
 *
 * At `astro:config:setup`:
 *   - validate options + cross-check Astro's `i18n` block,
 *   - register the `polystella:runtime-config` virtual module,
 *   - inject locale-prefixed route shims,
 *   - run UI-strings drift detection,
 *   - load glossaries, build R2 client + per-locale translators,
 *   - in live mode (provider configured + `dryRun: false`), walk
 *     `sourceDir` and process each (file, locale) pair through the
 *     cache-aware orchestrator: R2 hit → reuse cached bytes; R2
 *     miss → translate, apply, write back to R2 with metadata.
 *     Translated bytes land in `<root>/.astro/i18n-staging/{locale}/...`
 *     where `polystellaCollections` (called from the user's
 *     `content.config.ts`) picks them up via per-locale sibling
 *     content collections.
 *
 * At `astro:build:done`, emit `dist/i18n-r2-report.json` and run
 * the count-based R2 prune step.
 */
export default function polystella(
  options: PolyStellaOptions,
): AstroIntegration {
  let resolved: PolyStellaResolvedOptions | undefined;

  // Cross-hook state. Astro's hook signatures don't pass state
  // between hooks, so the build-report bookkeeping lives in closure
  // — populated during setup, read at done.
  const reportState: {
    startedAt: string;
    startedAtMs: number;
    entries: BuildReportEntry[];
    pruning: BuildReportPruning;
    glossariesForReport: Record<string, { file: string; sha256: string }>;
  } = {
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    entries: [],
    pruning: { deletedKeys: [], byLocale: {} },
    glossariesForReport: {},
  };

  return {
    name: "polystella",
    hooks: {
      "astro:config:setup": async ({
        logger,
        config,
        injectRoute,
        updateConfig,
        command,
      }) => {
        resolved = resolveOptions(options, config.i18n);
        logger.info(
          `validated options: defaultLocale=${
            resolved.defaultLocale
          }, locales=[${resolved.locales.join(", ")}], mode=${resolved.mode}`,
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
        const allLocalesIncludingDefault = [
          resolved.defaultLocale,
          ...resolved.locales,
        ];
        const runtimeConfigSource = [
          `export const defaultLocale = ${JSON.stringify(
            resolved.defaultLocale,
          )};`,
          `export const locales = ${JSON.stringify(
            allLocalesIncludingDefault,
          )};`,
          `export const fallback = ${JSON.stringify(resolved.fallback)};`,
          `export const noTranslateBehavior = ${JSON.stringify(
            resolved.noTranslateBehavior,
          )};`,
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

        // For each `routes` entry, generate a shim under
        // `<cacheDir>/polystella-shims/route-<idx>.astro` that
        // imports the source page and re-exports its `getStaticPaths`
        // expanded over non-default locales. See `routing/shim.ts`
        // for the templates.
        if (resolved.routes.length > 0) {
          const rootDir = fileURLToPath(config.root);
          const shimDir = path.resolve(cacheDirPath, "polystella-shims");
          await mkdir(shimDir, { recursive: true });

          for (let i = 0; i < resolved.routes.length; i++) {
            const sourceRel = resolved.routes[i]!;
            const sourceAbs = path.resolve(rootDir, sourceRel);
            const { pattern, isDynamic } = deriveUrlPattern(sourceRel);

            const shimPath = path.join(shimDir, `route-${i}.astro`);
            const importPath = path
              .relative(path.dirname(shimPath), sourceAbs)
              .replace(/\\/g, "/");
            await writeFile(
              shimPath,
              generateShimSource({
                relativeImportPath: importPath,
                isDynamic,
                locales: resolved.locales,
              }),
              "utf8",
            );

            // Empty `pattern` means the source was an index (or the
            // homepage); the locale-prefixed pattern collapses to
            // just `/[lang]` in that case.
            const injectPattern =
              pattern === "" ? "/[lang]" : `/[lang]/${pattern}`;
            injectRoute({
              pattern: injectPattern,
              entrypoint: shimPath,
            });
            logger.info(
              `injected localized route: ${injectPattern} → ${sourceRel}`,
            );
          }
        }

        // UI-strings drift detection. Runs before translation so a
        // missing-key list lands early in the build log. Silent
        // no-op when the default-locale JSON doesn't exist (operators
        // can onboard incrementally).
        const allLocalesIncludingDefaultForDrift = [
          resolved.defaultLocale,
          ...resolved.locales,
        ];
        const driftResult = await loadAndCheckDrift({
          rootDir: rootDirPath,
          baseDir: "./src/content/i18n",
          locales: allLocalesIncludingDefaultForDrift,
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

        const rootDir = fileURLToPath(config.root);
        const sourceDirAbs = path.resolve(rootDir, resolved.sourceDir);

        // Load + hash glossaries once. The hash is shared across every
        // (file, locale) pair using the same glossary, so doing it
        // here avoids re-hashing in the per-file loop.
        const glossaries = await loadGlossaries({
          config: resolved,
          projectRoot: config.root,
        });
        const glossaryHashByLocale = new Map<string, string>();
        for (const locale of resolved.locales) {
          const glossary = glossaries.get(locale);
          const hash = glossary ? hashGlossary(glossary) : EMPTY_GLOSSARY_HASH;
          glossaryHashByLocale.set(locale, hash);
          if (glossary) {
            const fileTemplate =
              resolved.glossary && "file" in resolved.glossary
                ? resolved.glossary.file
                : "<inline>";
            reportState.glossariesForReport[locale] = {
              file: fileTemplate.replace("{locale}", locale),
              sha256: hash,
            };
          }
        }
        if (glossaries.size > 0) {
          logger.info(
            `loaded glossaries for: ${[...glossaries.keys()].sort().join(", ")}`,
          );
        }

        // One Translator per locale, built once so model-id
        // resolution happens up front. Empty when `provider` is
        // omitted (modelId in the cache key is then "").
        const translatorByLocale = new Map<string, Translator>();
        if (resolved.provider) {
          for (const locale of resolved.locales) {
            translatorByLocale.set(
              locale,
              createTranslator(resolved.provider, locale),
            );
          }
          const summary = resolved.locales
            .map((l) => `${l}=${translatorByLocale.get(l)!.modelId}`)
            .join(", ");
          logger.info(`provider: ${resolved.provider.kind} (${summary})`);
        }

        // `null` means the operator opted out of caching; the
        // orchestrator skips both lookup and write-back in that case.
        const r2: R2Client | null = resolved.r2
          ? createR2Client({
              accountId: resolved.r2.accountId,
              bucket: resolved.r2.bucket,
              accessKeyId: resolved.r2.accessKeyId,
              secretAccessKey: resolved.r2.secretAccessKey,
              ...(resolved.r2.endpoint
                ? { endpoint: resolved.r2.endpoint }
                : {}),
            })
          : null;
        if (r2) {
          logger.info(
            `R2 cache: bucket=${resolved.r2!.bucket}, prefix=${
              resolved.r2!.prefix
            }`,
          );
        } else {
          logger.info(
            `R2 cache: not configured — translations will not be cached or shared`,
          );
        }

        const sources = await walkSources({
          sourceDir: sourceDirAbs,
          include: resolved.include,
          exclude: resolved.exclude,
        });

        if (sources.length === 0) {
          logger.warn(
            `dry-run: no source files matched include=${JSON.stringify(
              resolved.include,
            )} under ${resolved.sourceDir}`,
          );
          return;
        }

        // Dry-run logging: compute the same hashes the live pass
        // would, so the logged keys match what'll actually be
        // PUT/GET'd if `dryRun` flips off.
        let pairCount = 0;
        await Promise.all(
          sources.map(async (source) => {
            const body = await readFile(source.absolutePath, "utf8");
            const ast = parseMarkdown(body);
            const fmValues = selectTranslatableFrontmatter(ast, {
              sourcePath: source.relativePath,
              frontmatter: resolved!.frontmatter,
            });
            for (const locale of resolved!.locales) {
              const hash = computeSourceHash({
                body,
                frontmatter: fmValues,
                glossaryHash:
                  glossaryHashByLocale.get(locale) ?? EMPTY_GLOSSARY_HASH,
                modelId: translatorByLocale.get(locale)?.modelId ?? "",
              });
              const key = buildR2Key({
                locale,
                sourcePath: source.relativePath,
                hash,
              });
              logger.debug(`would check cache for ${key}`);
              pairCount++;
            }
          }),
        );

        logger.info(
          `dry-run: ${pairCount} R2 keys across ${sources.length} source file${
            sources.length === 1 ? "" : "s"
          } × ${resolved.locales.length} locale${
            resolved.locales.length === 1 ? "" : "s"
          }`,
        );

        // Live mode requires a provider AND dryRun off. The dry-run
        // hash output above already reflects the resolved model id,
        // so it's a faithful preview.
        const liveMode = resolved.provider !== undefined && !resolved.dryRun;
        if (!liveMode) return;

        logger.info(
          `live: processing ${sources.length} × ${resolved.locales.length} (file, locale) pairs at concurrency ${resolved.concurrency}`,
        );

        const counts: Record<CacheOutcome | "override" | "failed", number> = {
          hit: 0,
          miss: 0,
          override: 0,
          failed: 0,
        };
        // Pairs the build actually processed (override OR translation).
        // Fed to the prune step so it only considers locales/sources
        // this build saw — a stale source still in R2 from a previous
        // run won't be touched.
        const touchedPairs = new Set<string>();
        // Cache-write bookkeeping. Single "starting writes…" line on
        // the first PUT and a single closing summary, so per-write
        // chatter doesn't drown the build log on a cold cache.
        let cacheWritesCount = 0;
        let cacheWritesFailed = 0;
        let cacheWritesAnnounced = false;

        // Locale list passed to the link rewriter includes the default
        // so already-prefixed `/${defaultLocale}/...` URLs (rare but
        // legitimate) aren't treated as rewriteable.
        const resolvedConfig = resolved;
        const allLocalesForRewrite = [
          resolvedConfig.defaultLocale,
          ...resolvedConfig.locales,
        ];
        const maybeRewrite = (bytes: string, locale: string): string => {
          if (!resolvedConfig.rewriteInternalLinks) return bytes;
          const opts: RewriteInternalLinksOptions = {
            targetLocale: locale,
            locales: allLocalesForRewrite,
          };
          return rewriteInternalLinks(bytes, opts);
        };
        let noTranslateSources = 0;
        // Per-source body runs as a pool worker. State mutations
        // across workers (counts, touchedPairs, etc.) are safe in
        // single-threaded JS; nothing reads these mid-run, only at
        // synchronisation; the pool resolves once every source has
        // been processed and the closing-summary log lines run after.
        //
        // `cfg` is a non-undefined-typed alias for `resolved`; TS
        // widens the narrowed type back across the async-closure
        // boundary so the alias avoids `resolved!` everywhere.
        const cfg = resolved;
        await runWithConcurrency(sources, cfg.concurrency, async (source) => {
          const body = await readFile(source.absolutePath, "utf8");
          const ast = parseMarkdown(body);
          // Computed once per source so all branches (noTranslate,
          // override, translate, error) push consistent report entries.
          const extractOptsForReport = {
            sourcePath: source.relativePath,
            frontmatter: cfg.frontmatter,
          };
          const fmValuesForReport = selectTranslatableFrontmatter(
            ast,
            extractOptsForReport,
          );
          const reportKeysFor = (locale: string) => {
            const modelId = translatorByLocale.get(locale)?.modelId ?? "";
            const sourceHash = computeSourceHash({
              body,
              frontmatter: fmValuesForReport,
              glossaryHash:
                glossaryHashByLocale.get(locale) ?? EMPTY_GLOSSARY_HASH,
              modelId,
            });
            const r2Key = buildR2Key({
              locale,
              sourcePath: source.relativePath,
              hash: sourceHash,
            });
            return { modelId, sourceHash, r2Key };
          };
          // `noTranslate: true` skips translation entirely. Overrides
          // still apply (operator opt-back-in, per-locale).
          if (peekNoTranslate(ast)) {
            noTranslateSources++;
            for (const locale of cfg.locales) {
              const pairStart = Date.now();
              const { modelId, sourceHash, r2Key } = reportKeysFor(locale);
              const override = await readOverride({
                rootDir,
                overridesDir: cfg.overridesDir,
                locale,
                relativeSourcePath: source.relativePath,
              });
              if (override === null) {
                reportState.entries.push({
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
              const overrideStaged = maybeRewrite(override, locale);
              await writeStagedTranslation({
                stagingDir,
                locale,
                relativeSourcePath: source.relativePath,
                bytes: overrideStaged,
              });
              counts.override++;
              touchedPairs.add(encodeTouchedPair(locale, source.relativePath));
              reportState.entries.push({
                sourcePath: source.relativePath,
                locale,
                sourceHash,
                r2Key,
                outcome: "override",
                model: modelId,
                durationMs: Date.now() - pairStart,
              });
              if (cfg.verbose) {
                logger.info(
                  `◆ ${source.relativePath} → ${locale} [override, noTranslate-source]`,
                );
              }
            }
            if (cfg.verbose) {
              logger.info(
                `⊘ ${source.relativePath} [noTranslate=true; skipping AI translation]`,
              );
            }
            // `return` (not `continue`) — this is the pool worker, not
            // a for-loop body.
            return;
          }
          const extractOpts = {
            sourcePath: source.relativePath,
            frontmatter: cfg.frontmatter,
          };
          const segments = extractSegments(ast, extractOpts, body);
          // Reused across the per-locale loop below.
          const fmValues = selectTranslatableFrontmatter(ast, extractOpts);

          for (const locale of cfg.locales) {
            const pairStart = Date.now();
            try {
              // Overrides take precedence over cache + translator and
              // are deliberately NOT written to R2 (they're source-
              // controlled artefacts, not machine-generated).
              const override = await readOverride({
                rootDir,
                overridesDir: cfg.overridesDir,
                locale,
                relativeSourcePath: source.relativePath,
              });
              if (override !== null) {
                // Run the rewriter on overrides so an operator's
                // hand-translated file with raw internal links still
                // gets locale-prefixed. Idempotent.
                const overrideStaged = maybeRewrite(override, locale);
                await writeStagedTranslation({
                  stagingDir,
                  locale,
                  relativeSourcePath: source.relativePath,
                  bytes: overrideStaged,
                });
                counts.override++;
                touchedPairs.add(
                  encodeTouchedPair(locale, source.relativePath),
                );
                {
                  const { modelId, sourceHash, r2Key } = reportKeysFor(locale);
                  reportState.entries.push({
                    sourcePath: source.relativePath,
                    locale,
                    sourceHash,
                    r2Key,
                    outcome: "override",
                    model: modelId,
                    durationMs: Date.now() - pairStart,
                  });
                }
                if (cfg.verbose) {
                  logger.info(
                    `◆ ${source.relativePath} → ${locale} [override]`,
                  );
                }
                if (cfg.debug.previewDir) {
                  const previewPath = path.resolve(
                    rootDir,
                    cfg.debug.previewDir,
                    locale,
                    source.relativePath,
                  );
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
              const glossaryHash =
                glossaryHashByLocale.get(locale) ?? EMPTY_GLOSSARY_HASH;
              const sourceHash = computeSourceHash({
                body,
                frontmatter: fmValues,
                glossaryHash,
                modelId: translator.modelId,
              });
              const key = buildR2Key({
                locale,
                sourcePath: source.relativePath,
                hash: sourceHash,
              });
              // Single timestamp shared between the R2 metadata and
              // the in-bytes `aiTranslatedAt` marker so they don't
              // drift if anyone diffs cache vs. staged file.
              const translatedAt = new Date().toISOString();
              const result = await translateOrLoadFromCache({
                ast,
                segments,
                sourceBody: body,
                locale,
                key,
                r2,
                translator,
                glossary,
                sourceLocale: cfg.defaultLocale,
                context: cfg.prompt.context,
                metadata: buildCacheMetadata({
                  sourcePath: source.relativePath,
                  locale,
                  sourceHash,
                  glossaryHash,
                  modelId: translator.modelId,
                  translatedAt,
                  polystellaVersion: POLYSTELLA_VERSION,
                }),
                // AI-translation marker. Baked in BEFORE the R2 PUT
                // so cache hits on later builds return the marker
                // verbatim and `aiTranslatedAt` keeps the original
                // translation time.
                frontmatterAdditions: {
                  aiTranslated: true,
                  aiTranslationModel: translator.modelId,
                  aiTranslatedAt: translatedAt,
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
                    logger.warn(
                      `⚠ ${source.relativePath} → ${locale}: cache write failed: ${error.message}`,
                    );
                  },
                },
              });
              counts[result.outcome]++;
              touchedPairs.add(encodeTouchedPair(locale, source.relativePath));
              reportState.entries.push({
                sourcePath: source.relativePath,
                locale,
                sourceHash,
                r2Key: key,
                outcome:
                  result.outcome === "hit" ? "cache-hit" : "ai-translated",
                model: translator.modelId,
                durationMs: Date.now() - pairStart,
              });

              // Link rewrite happens AFTER the cache layer so cached
              // bytes store the translation-only output; toggling
              // `rewriteInternalLinks` doesn't invalidate the cache,
              // and the rewriter's idempotent guard prevents
              // double-prefixing on cache hits.
              const stagedBody = maybeRewrite(result.body, locale);
              await writeStagedTranslation({
                stagingDir,
                locale,
                relativeSourcePath: source.relativePath,
                bytes: stagedBody,
              });

              if (cfg.verbose) {
                const marker = result.outcome === "hit" ? "●" : "✓";
                logger.info(
                  `${marker} ${source.relativePath} → ${locale} [${result.outcome}] (${segments.length} segs)`,
                );
              }

              // Optional inspection copy. No-op when previewDir unset.
              if (cfg.debug.previewDir) {
                const previewPath = path.resolve(
                  rootDir,
                  cfg.debug.previewDir,
                  locale,
                  source.relativePath,
                );
                await mkdir(path.dirname(previewPath), { recursive: true });
                await writeFile(previewPath, stagedBody, "utf8");
              }
            } catch (err) {
              counts.failed++;
              const message = (err as Error).message;
              logger.error(`✗ ${source.relativePath} → ${locale}: ${message}`);
              const { modelId, sourceHash, r2Key } = reportKeysFor(locale);
              reportState.entries.push({
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

        // Cache-write closing summary. Silent when nothing was
        // written (all hits, or `r2: null`).
        if (cacheWritesCount > 0 || cacheWritesFailed > 0) {
          const writeWord = (n: number) => `${n} write${n === 1 ? "" : "s"}`;
          if (cacheWritesFailed === 0) {
            logger.info(`R2 cache: completed ${writeWord(cacheWritesCount)}`);
          } else if (cacheWritesCount === 0) {
            logger.warn(`R2 cache: ${writeWord(cacheWritesFailed)} failed`);
          } else {
            logger.warn(
              `R2 cache: completed ${writeWord(
                cacheWritesCount,
              )} (${cacheWritesFailed} failed)`,
            );
          }
        }

        // Count-based prune. Walk only the (locale, sourcePath) pairs
        // this build actually saw and keep at most `keepLastN` hash
        // variants per pair (variants accumulate from glossary edits,
        // model bumps, source edits, etc.). Gated on:
        //   - R2 actually configured (no-op without a client),
        //   - keepLastN not explicitly disabled,
        //   - at least one pair was touched (avoids a useless list call
        //     on a build with zero pairs, e.g. an empty source dir).
        // Wrapped in try/catch so a flaky R2 list/del during prune
        // doesn't fail the build — the staging files are already
        // written, and the next build will retry the prune.
        if (
          r2 &&
          resolved.r2 &&
          resolved.r2.keepLastN !== false &&
          touchedPairs.size > 0
        ) {
          const keepLastN = resolved.r2.keepLastN;
          try {
            const pruneResult = await pruneCacheByPair({
              r2,
              touchedPairs,
              keepLastN,
            });
            // Record into the build report. Locale is re-derived from
            // each key (rather than threaded through the pruner) so
            // the prune module stays focused on R2 operations.
            reportState.pruning.deletedKeys.push(...pruneResult.deletedKeys);
            for (const key of pruneResult.deletedKeys) {
              const localeMatch = /^i18n\/([^/]+)\//.exec(key);
              if (!localeMatch) continue;
              const locale = localeMatch[1]!;
              reportState.pruning.byLocale[locale] =
                (reportState.pruning.byLocale[locale] ?? 0) + 1;
            }
            if (pruneResult.deleted > 0) {
              logger.info(
                `R2 cache: pruned ${pruneResult.deleted} stale variant${
                  pruneResult.deleted === 1 ? "" : "s"
                } across ${pruneResult.prunedPairs} pair${
                  pruneResult.prunedPairs === 1 ? "" : "s"
                } (kept last ${keepLastN} per pair)`,
              );
            }
          } catch (err) {
            logger.warn(
              `R2 cache: prune step failed: ${(err as Error).message}`,
            );
          }
        }

        const noTranslateSummary =
          noTranslateSources > 0
            ? `, ${noTranslateSources} noTranslate source${
                noTranslateSources === 1 ? "" : "s"
              } skipped`
            : "";
        logger.info(
          `live: ${counts.hit} hit, ${counts.miss} miss, ${counts.override} override, ${counts.failed} failed${noTranslateSummary}`,
        );
      },
      "astro:build:done": async ({ dir, logger }) => {
        // Emit the build report. No-op when the integration never
        // ran in live mode (entries empty), so dev / dryRun builds
        // don't clutter the dist directory.
        if (!resolved) return;
        if (reportState.entries.length === 0) return;

        const report: BuildReport = {
          build: {
            startedAt: reportState.startedAt,
            durationMs: Date.now() - reportState.startedAtMs,
            mode: resolved.mode === "starlight" ? "starlight" : "standalone",
            polystellaVersion: POLYSTELLA_VERSION,
          },
          locales: [resolved.defaultLocale, ...resolved.locales],
          defaultLocale: resolved.defaultLocale,
          glossaries: reportState.glossariesForReport,
          entries: reportState.entries,
          totals: computeBuildReportTotals(reportState.entries),
          pruning: reportState.pruning,
        };

        try {
          const outDir = fileURLToPath(dir);
          const reportPath = await emitBuildReport({ outDir, report });
          logger.info(
            `i18n build report: ${path.relative(outDir, reportPath)} (${
              report.entries.length
            } entries, ${report.totals.cacheHits} hit / ${
              report.totals.aiTranslated
            } miss / ${report.totals.overrides} override / ${
              report.totals.errors
            } error)`,
          );
        } catch (err) {
          logger.warn(
            `i18n build report: failed to write: ${(err as Error).message}`,
          );
        }
      },
    },
  };
}
