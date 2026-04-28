import type { AstroIntegration } from "astro";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveOptions,
  type PolyStellaOptions,
  type PolyStellaResolvedOptions,
} from "./options.js";
import { walkSources } from "./walk.js";
import { computeSourceHash } from "./hash.js";
import { buildR2Key } from "./r2.js";

export type { PolyStellaOptions, PolyStellaResolvedOptions };
export { computeSourceHash, type HashInput } from "./hash.js";
export { walkSources, type SourceFile, type WalkOptions } from "./walk.js";
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
 * v0.1: standalone-mode pilot.
 *
 * Current behaviour:
 *   - options validated at `astro:config:setup`,
 *   - source tree walked at `astro:build:start`,
 *   - per-(file, locale) R2 cache keys computed and logged (dry-run).
 *
 * Real R2 fetches, AI translation, and route injection arrive in later
 * milestones (M3 parser, M4 glossary, M5 provider, M6 R2 cache, …).
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
                frontmatter: {}, // populated by the M3 parser
                glossaryHash: "", // populated when M4 lands
                modelId: "", // populated when M5 lands
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
      },
    },
  };
}
