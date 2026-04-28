import type { AstroIntegration } from "astro";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyTranslations } from "./apply.js";
import { extractSegments } from "./extract.js";
import {
  EMPTY_GLOSSARY,
  EMPTY_GLOSSARY_HASH,
  hashGlossary,
  loadGlossaries,
} from "./glossary.js";
import {
  resolveOptions,
  type PolyStellaOptions,
  type PolyStellaResolvedOptions,
} from "./options.js";
import { parseMarkdown } from "./parse.js";
import {
  createTranslator,
  translateBatch,
  type Translator,
} from "./provider.js";
import { walkSources } from "./walk.js";
import { computeSourceHash } from "./hash.js";
import { buildR2Key } from "./r2.js";

export type { PolyStellaOptions, PolyStellaResolvedOptions };
export { computeSourceHash, type HashInput } from "./hash.js";
export { walkSources, type SourceFile, type WalkOptions } from "./walk.js";
export {
  EMPTY_GLOSSARY,
  EMPTY_GLOSSARY_HASH,
  hashGlossary,
  loadGlossaries,
  type Glossary,
  type LoadGlossariesOptions,
} from "./glossary.js";
export { applyTranslations } from "./apply.js";
export {
  extractSegments,
  type Segment,
  type ExtractOptions,
} from "./extract.js";
export { parseMarkdown, createMarkdownProcessor } from "./parse.js";
export {
  buildPrompt,
  parseResponse,
  type BuildPromptInput,
  type BuiltPrompt,
} from "./prompt.js";
export {
  createTranslator,
  resolveModelId,
  translateBatch,
  type CreateTranslatorOptions,
  type TranslateBatchOptions,
  type Translator,
} from "./provider.js";
export {
  buildR2Key,
  createR2Client,
  type R2Client,
  type R2ConnectionOptions,
  type R2GetResult,
  type R2ListEntry,
  type R2PutOptions,
} from "./r2.js";

/**
 * PolyStella — AI-driven content localization for Astro.
 *
 * Standalone-mode pilot integration.
 *
 * Current behaviour:
 *   - options validated at `astro:config:setup`,
 *   - source tree walked at `astro:build:start`,
 *   - per-(file, locale) R2 cache keys computed and logged,
 *   - when a provider is configured AND `dryRun` is false, every (file,
 *     locale) pair is translated sequentially and a one-line preview is
 *     logged. Translations are held in memory pending the cache layer.
 */
export default function polystella(
  options: PolyStellaOptions,
): AstroIntegration {
  let resolved: PolyStellaResolvedOptions | undefined;
  let configRoot: URL | undefined;

  return {
    name: "polystella",
    hooks: {
      "astro:config:setup": ({ logger, config }) => {
        resolved = resolveOptions(options);
        configRoot = config.root;
        logger.info(
          `validated options: defaultLocale=${
            resolved.defaultLocale
          }, locales=[${resolved.locales.join(", ")}], mode=${resolved.mode}`,
        );
      },

      "astro:build:start": async ({ logger }) => {
        if (!resolved || !configRoot) return;

        const rootDir = fileURLToPath(configRoot);
        const sourceDirAbs = path.resolve(rootDir, resolved.sourceDir);

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
          `live: translating ${sources.length} × ${resolved.locales.length} (file, locale) pairs sequentially`,
        );

        // Translations are held in memory and discarded for now — a future
        // cache layer will persist them to R2 and surface them at
        // route-resolution time. Sequential per-pair execution keeps the
        // smoke test honest and avoids hammering the provider; the
        // `concurrency` option will gate this once the cache lands.
        let translatedCount = 0;
        let failedCount = 0;
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
            try {
              const translations = await translateBatch({
                translator,
                segments,
                glossary,
                sourceLocale: resolved.defaultLocale,
                targetLocale: locale,
                context: resolved.prompt.context,
              });
              const translated = applyTranslations(ast, translations, body);
              translatedCount++;
              const firstId = segments[0]!.id;
              const previewSrc = segments[0]!.text
                .replace(/\s+/g, " ")
                .slice(0, 40);
              const previewTgt = (translations.get(firstId) ?? "")
                .replace(/\s+/g, " ")
                .slice(0, 40);
              logger.info(
                `✓ ${source.relativePath} → ${locale} (${segments.length} segs) ${firstId}: ${previewSrc} → ${previewTgt}`,
              );
              // Optional debug-write: dump full translated MDX to disk
              // so a human can diff/spot-check it before the cache +
              // route-injection layers land. No-op when previewDir is
              // unset, so production builds never touch the FS here.
              if (resolved.debug.previewDir) {
                const previewPath = path.resolve(
                  rootDir,
                  resolved.debug.previewDir,
                  locale,
                  source.relativePath,
                );
                await mkdir(path.dirname(previewPath), { recursive: true });
                await writeFile(previewPath, translated, "utf8");
                logger.debug(
                  `wrote preview: ${path.relative(rootDir, previewPath)}`,
                );
              }
              // Held in memory until the cache layer lands.
              void translated;
            } catch (err) {
              failedCount++;
              logger.error(
                `✗ ${source.relativePath} → ${locale}: ${
                  (err as Error).message
                }`,
              );
            }
          }
        }

        logger.info(
          `live: translated ${translatedCount}, failed ${failedCount}`,
        );
      },
    },
  };
}
