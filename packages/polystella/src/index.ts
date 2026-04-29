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
import { extractSegments } from "./parsing/extract.js";
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
import { createTranslator, type Translator } from "./translation/provider.js";
import { walkSources } from "./source/walk.js";
import { computeSourceHash } from "./storage/hash.js";
import { buildR2Key, createR2Client, type R2Client } from "./storage/r2.js";

/**
 * Hardcoded for now — read from package.json once the package version
 * stabilises and we want it surfaced in build reports / R2 metadata
 * without a stale string drifting between releases.
 */
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
  extractSegments,
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

/**
 * PolyStella — AI-driven content localization for Astro.
 *
 * Standalone-mode pilot integration.
 *
 * Current behaviour:
 *   - options validated at `astro:config:setup`,
 *   - source tree walked at `astro:build:start`,
 *   - per-(file, locale) R2 cache keys computed and logged,
 *   - when live mode is on (provider configured + `dryRun` false), each
 *     (file, locale) pair runs through the cache-aware orchestrator:
 *     R2 hit → reuse cached bytes; R2 miss → translate, apply, write
 *     back to R2 with structured metadata. Translated MDX is staged
 *     under `<cacheDir>/i18n-staging/{locale}/...` ready for the
 *     route-injection layer to consume.
 */
export default function polystella(
  options: PolyStellaOptions,
): AstroIntegration {
  let resolved: PolyStellaResolvedOptions | undefined;
  let configRoot: URL | undefined;
  let configCacheDir: URL | undefined;

  return {
    name: "polystella",
    hooks: {
      "astro:config:setup": ({ logger, config }) => {
        resolved = resolveOptions(options);
        configRoot = config.root;
        // `config.cacheDir` is a URL pointing at `<root>/.astro/` by
        // default. We capture it here because `astro:build:start` (where
        // the staging writes happen) doesn't expose `config`.
        configCacheDir = config.cacheDir;
        logger.info(
          `validated options: defaultLocale=${
            resolved.defaultLocale
          }, locales=[${resolved.locales.join(", ")}], mode=${resolved.mode}`,
        );
      },

      "astro:build:start": async ({ logger }) => {
        if (!resolved || !configRoot || !configCacheDir) return;

        const rootDir = fileURLToPath(configRoot);
        const sourceDirAbs = path.resolve(rootDir, resolved.sourceDir);
        // Translations land here on every successful (file, locale) pass,
        // whether they came from the cache or from a fresh translation.
        // The route-injection layer (M7) will read from this same path.
        const stagingDir = path.resolve(
          fileURLToPath(configCacheDir),
          "i18n-staging",
        );

        // Load all per-locale glossaries up front and pre-compute their
        // hashes. The hash is the same for every (file, locale) pair
        // sharing a glossary, so doing it once here avoids hashing the
        // same glossary content N-files times below.
        const glossaries = await loadGlossaries({
          config: resolved,
          projectRoot: configRoot,
        });
        const glossaryHashByLocale = new Map<string, string>();
        for (const locale of resolved.locales) {
          const glossary = glossaries.get(locale);
          glossaryHashByLocale.set(
            locale,
            glossary ? hashGlossary(glossary) : EMPTY_GLOSSARY_HASH,
          );
        }
        if (glossaries.size > 0) {
          logger.info(
            `loaded glossaries for: ${[...glossaries.keys()]
              .sort()
              .join(", ")}`,
          );
        }

        // Build one Translator per locale when a provider is configured.
        // Done here (rather than per file) so model-id resolution and any
        // per-translator state happen once. If `provider` is omitted from
        // config, the map stays empty and modelId in the cache key is "".
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

        // Build the R2 client when r2 is configured. A null client means
        // the operator opted out of caching (or hasn't provisioned R2
        // yet); the orchestrator handles that gracefully by skipping
        // both lookup and write-back, so smoke tests can run without R2.
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

        // Compute hashes in parallel; we don't fetch anything yet, just log.
        let pairCount = 0;
        await Promise.all(
          sources.map(async (source) => {
            const body = await readFile(source.absolutePath, "utf8");
            for (const locale of resolved!.locales) {
              const hash = computeSourceHash({
                body,
                frontmatter: {}, // populated once the parser is wired in
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

        // Live mode gates: provider must be configured AND dry-run must
        // be off. With no provider, there's nothing to call. With dry-run
        // on, the operator has explicitly opted out of network calls
        // (useful in CI). The cache key already reflects the model id in
        // both branches, so dry-run output is a faithful preview of what
        // a live run would key against.
        const liveMode = resolved.provider !== undefined && !resolved.dryRun;
        if (!liveMode) return;

        logger.info(
          `live: processing ${sources.length} × ${resolved.locales.length} (file, locale) pairs sequentially`,
        );

        // Per-pair counters. "hit" = served from cache, no provider
        // call; "miss" = freshly translated and (if r2 is configured)
        // written back; "override" = a checked-in human-edited file
        // under `overridesDir` short-circuited both cache and
        // translator (counted as a hit for cost accounting but tracked
        // separately so the operator sees overrides taking effect).
        // Sequential per-pair execution keeps the smoke test honest
        // and avoids hammering the provider; the `concurrency` option
        // will gate this once parallelism is proven safe end-to-end.
        const counts: Record<CacheOutcome | "override" | "failed", number> = {
          hit: 0,
          miss: 0,
          override: 0,
          failed: 0,
        };
        // Pairs the build actually processed (override OR translation).
        // Fed to the prune step so we only consider locales/sources
        // this build saw — a stale source still in R2 from a previous
        // run won't be touched, which is what `pruneCacheByPair` wants.
        const touchedPairs = new Set<string>();
        // Global cache-write bookkeeping. We log a single "starting
        // writes…" line on the first PUT (gated by `announced`) and a
        // single "completed N write(s)" line after the loop. Per-write
        // chatter would drown the build log on a cold cache. Failures
        // get a per-file warning (so the operator sees which pair
        // failed) plus a contribution to the closing summary.
        let cacheWritesCount = 0;
        let cacheWritesFailed = 0;
        let cacheWritesAnnounced = false;
        for (const source of sources) {
          const body = await readFile(source.absolutePath, "utf8");
          const ast = parseMarkdown(body);
          const segments = extractSegments(
            ast,
            {
              sourcePath: source.relativePath,
              frontmatter: resolved.frontmatter,
            },
            body,
          );
          // Note: the segments-empty check moved inside the per-locale
          // loop. A source with zero translatable segments may still
          // have manual overrides for some locales, and those should
          // still be staged.

          for (const locale of resolved.locales) {
            try {
              // Override pre-pass: a file at
              //   <root>/<overridesDir>/<locale>/<relativeSourcePath>
              // takes precedence over both cache and translator. We
              // stage it directly, count it as an override (separate
              // from hit/miss), and skip the rest of the pipeline for
              // this pair. Overrides are deliberately NOT written to
              // R2 — they're source-controlled artefacts the operator
              // manages by hand, not machine-generated bytes.
              const override = await readOverride({
                rootDir,
                overridesDir: resolved.overridesDir,
                locale,
                relativeSourcePath: source.relativePath,
              });
              if (override !== null) {
                const stagingPath = path.join(
                  stagingDir,
                  locale,
                  source.relativePath,
                );
                await mkdir(path.dirname(stagingPath), { recursive: true });
                await writeFile(stagingPath, override, "utf8");
                counts.override++;
                touchedPairs.add(
                  encodeTouchedPair(locale, source.relativePath),
                );
                logger.info(`◆ ${source.relativePath} → ${locale} [override]`);
                if (resolved.debug.previewDir) {
                  const previewPath = path.resolve(
                    rootDir,
                    resolved.debug.previewDir,
                    locale,
                    source.relativePath,
                  );
                  await mkdir(path.dirname(previewPath), { recursive: true });
                  await writeFile(previewPath, override, "utf8");
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
                frontmatter: {}, // populated once the parser is wired in
                glossaryHash,
                modelId: translator.modelId,
              });
              const key = buildR2Key({
                locale,
                sourcePath: source.relativePath,
                hash: sourceHash,
              });
              const result = await translateOrLoadFromCache({
                ast,
                segments,
                sourceBody: body,
                locale,
                key,
                r2,
                translator,
                glossary,
                sourceLocale: resolved.defaultLocale,
                context: resolved.prompt.context,
                metadata: buildCacheMetadata({
                  sourcePath: source.relativePath,
                  locale,
                  sourceHash,
                  glossaryHash,
                  modelId: translator.modelId,
                  translatedAt: new Date().toISOString(),
                  polystellaVersion: POLYSTELLA_VERSION,
                }),
                // Quiet bookkeeping for the global cache-write
                // bracket. The first write across the whole build
                // emits the announcement line; subsequent writes
                // just bump the counter for the closing summary.
                // `onWriteFailed` is the one per-file noisy event:
                // a failed PUT means the translator's output won't
                // be cached for the next build, and the operator
                // needs to see which pair was affected.
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

              // Stage the translated bytes for the route-injection layer.
              // Mirror the source's relative path under the staging root
              // so locale-aware lookup is a straight join.
              const stagingPath = path.join(
                stagingDir,
                locale,
                source.relativePath,
              );
              await mkdir(path.dirname(stagingPath), { recursive: true });
              await writeFile(stagingPath, result.body, "utf8");

              const marker = result.outcome === "hit" ? "●" : "✓";
              logger.info(
                `${marker} ${source.relativePath} → ${locale} [${result.outcome}] (${segments.length} segs)`,
              );

              // Optional debug-write: same content as staging but at a
              // user-visible path for inspection. No-op when previewDir
              // is unset.
              if (resolved.debug.previewDir) {
                const previewPath = path.resolve(
                  rootDir,
                  resolved.debug.previewDir,
                  locale,
                  source.relativePath,
                );
                await mkdir(path.dirname(previewPath), { recursive: true });
                await writeFile(previewPath, result.body, "utf8");
              }
            } catch (err) {
              counts.failed++;
              logger.error(
                `✗ ${source.relativePath} → ${locale}: ${
                  (err as Error).message
                }`,
              );
            }
          }
        }

        // Closing bracket for the cache-write phase. Stays silent
        // when nothing was written (all hits, or `r2: null`); the
        // start line is gated on the same condition so the pair
        // either both fire or neither does. Failures are surfaced
        // here (in addition to the per-pair warnings) so the
        // build-end report tells the operator the cache state at a
        // glance.
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

        logger.info(
          `live: ${counts.hit} hit, ${counts.miss} miss, ${counts.override} override, ${counts.failed} failed`,
        );
      },
    },
  };
}
