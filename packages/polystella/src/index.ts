import type { AstroIntegration } from "astro";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCacheMetadata,
  translateOrLoadFromCache,
  type CacheOutcome,
} from "./storage/cache.js";
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
  type CacheOutcome,
  type TranslateOrLoadOptions,
  type TranslateOrLoadResult,
} from "./storage/cache.js";

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
        // written back. Sequential per-pair execution keeps the smoke
        // test honest and avoids hammering the provider; the
        // `concurrency` option will gate this once parallelism is
        // proven safe end-to-end.
        const counts: Record<CacheOutcome | "failed", number> = {
          hit: 0,
          miss: 0,
          failed: 0,
        };
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
          if (segments.length === 0) continue;

          for (const locale of resolved.locales) {
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
            try {
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
              });
              counts[result.outcome]++;

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

        logger.info(
          `live: ${counts.hit} hit, ${counts.miss} miss, ${counts.failed} failed`,
        );
      },
    },
  };
}
