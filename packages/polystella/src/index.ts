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
import {
  formatDriftIssues,
  loadAndCheckDrift,
} from "./ui/drift.js";
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
export {
  DEFAULT_STAGING_DIR,
  DEFAULT_STAGING_GLOB,
} from "./storage/paths.js";
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
 * Write translated bytes to the staging directory in the layout
 * `polystellaCollections` expects: `<stagingDir>/<locale>/<relativeSourcePath>`.
 *
 * The convention assumes the source path's first segment is the
 * collection name (`publications/Antunes2025.md`,
 * `people/alice.md`), which matches the standard Astro layout where
 * `glob({ base: "./content/<collection>" })` is the dominant
 * pattern. When `polystellaCollections` registers the
 * `<collection>__<locale>` sibling, its loader sees this exact tree
 * and Astro compiles each entry through the normal pipeline.
 *
 * `mkdir({ recursive: true })` is idempotent across (file × locale)
 * fan-out; we don't bother caching the "directory exists" set since
 * Node's syscall is cheap and the cache would muddy concurrent
 * builds.
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

  // Cross-hook state. `astro:config:setup` does the heavy lifting
  // (translation, staging, cache writes); `astro:build:done` reads
  // the accumulated bookkeeping to emit the report. Held in closure
  // because Astro's hook signatures don't pass arbitrary state
  // between hooks. Mutable; populated during setup, read at done.
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
        // PolyStella's locale set (defaultLocale + targets) is derived
        // from Astro's native `config.i18n` block — single source of
        // truth, never injected. `resolveOptions` throws with a
        // copy-pasteable starter block when `i18n` is absent or
        // misconfigured.
        resolved = resolveOptions(options, config.i18n);
        logger.info(
          `validated options: defaultLocale=${
            resolved.defaultLocale
          }, locales=[${resolved.locales.join(", ")}], mode=${resolved.mode}`,
        );

        // Compute the staging dir once and share it with both the
        // build hook (where translated bytes are written) and the
        // runtime helper (where they're read at page-render time).
        //
        // Anchored at `<root>/.astro/i18n-staging` (project root, NOT
        // `config.cacheDir`). In Astro 6 `cacheDir` resolves to
        // `<root>/node_modules/.astro/` by default, but the user's
        // `polystellaCollections({ stagingDir: ".astro/i18n-staging" })`
        // (the documented default) reads relative to project root.
        // Using `cacheDir` here would silently desync writer and
        // reader paths and the sibling collections would always be
        // empty.
        //
        // `cacheDirPath` is still computed because the polystella-shim
        // route generator below uses `cacheDir` for the shim source
        // location — that one is fine because shims are imported via
        // the path Astro returns from `injectRoute`'s `entrypoint`
        // arg, never read off disk by a separate reader.
        const cacheDirPath = fileURLToPath(config.cacheDir);
        const rootDirPath = fileURLToPath(config.root);
        const stagingDir = path.resolve(rootDirPath, DEFAULT_STAGING_DIR);

        // Register the `polystella:runtime-config` virtual module.
        // The runtime helpers import the locale set from this module
        // at page-render time — known at config-setup but not via
        // `process.env`, so a Vite-resolved virtual module is the
        // cleanest way to thread it through. The `\0` prefix on the
        // resolved id is Vite's convention to signal that other
        // plugins should leave the module alone.
        //
        // The exports here are exactly the data the runtime needs to
        // dispatch and link-rewrite without having to read configs
        // again on the page-render side:
        //   - `defaultLocale`: source/canonical locale (used by
        //     `getLocalizedEntry` to decide source vs sibling, and by
        //     `localizedHref` to no-op on default-locale calls).
        //   - `locales`: the full set including the default — used
        //     by `localizedHref` for its idempotency check (so an
        //     already-prefixed URL isn't double-prefixed on re-render).
        //   - `fallback`: governs whether `getLocalizedEntry` returns
        //     source content on a sibling miss (`"default-locale"`)
        //     or `undefined` so the page 404s (`"skip"`).
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

        // Generate one shim per `routes` entry and inject it under
        // `/[lang]/<sourcePattern>`. Each shim imports the user's
        // source page as a child component and runs its own
        // `getStaticPaths` enumerating non-default locales — see
        // `routing/shim.ts` for the templates and the rationale.
        // Skipped entirely when `routes` is empty so a PolyStella
        // build with no routing yet (the M2–M6 milestones) is a no-op
        // here.
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

        // UI-string drift detection (M8.3). Runs as early as possible
        // — before the translation loop — so a missing-key list lands
        // on the first build log line instead of after a multi-minute
        // translation pass succeeds with stale dictionaries.
        //
        // Silent no-op when the default-locale JSON file isn't on
        // disk: the operator hasn't authored UI strings yet, and we
        // don't want to force every consumer to stub out empty JSON
        // files just to satisfy the integration. Activates the moment
        // `<defaultLocale>.json` exists.
        //
        // Drift detection covers ALL declared locales — including the
        // default — so adding a locale to `i18n.locales` without
        // creating its JSON file is caught immediately.
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
            `[polystella] UI-strings dictionary drift detected. Every declared locale must have a \`src/content/i18n/<locale>.json\` file with the same key set as the default-locale file (${resolved.defaultLocale}.json):\n${formatDriftIssues(
              driftResult.issues,
            )}\n\nFix the listed locales and rebuild. To opt out of drift detection entirely, remove the default-locale JSON file (the integration silently skips drift checks until that file exists).`,
          );
        }

        // Translation pipeline. Runs HERE (in config:setup), not in
        // `astro:build:start`, because `polystellaCollections` registers
        // per-locale sibling collections whose loaders read from
        // `<stagingDir>/<locale>/<collection>/...`. Astro syncs the
        // content layer between config:setup and build:start — if we
        // staged translations in build:start, the sibling collections
        // would have already been synced as empty and the runtime
        // dispatcher would always fall back to source.
        //
        // Gated on `runOn` (default `["build"]`) intersecting Astro's
        // current `command`. `astro dev` reuses the prior build's
        // staged content unless the operator opts in via
        // `runOn: ["build", "dev"]`.
        //
        // Explicit narrowing rather than a cast: Astro can pass
        // commands beyond `"build"` and `"dev"` (e.g. `"sync"`,
        // `"preview"`) into `astro:config:setup` depending on what
        // CLI subcommand was invoked. The cast `as "build" | "dev"`
        // would have those silently fall through to whichever runOn
        // entry happens to match by string identity, which is
        // confusing if the operator's `runOn` is `["build"]` and a
        // `sync` command sneaks past. Narrowing first means anything
        // unrecognised hits the early-return branch cleanly.
        if (command !== "build" && command !== "dev") {
          return;
        }
        if (!resolved.runOn.includes(command)) {
          return;
        }

        const rootDir = fileURLToPath(config.root);
        const sourceDirAbs = path.resolve(rootDir, resolved.sourceDir);

        // Load all per-locale glossaries up front and pre-compute their
        // hashes. The hash is the same for every (file, locale) pair
        // sharing a glossary, so doing it once here avoids hashing the
        // same glossary content N-files times below.
        const glossaries = await loadGlossaries({
          config: resolved,
          projectRoot: config.root,
        });
        const glossaryHashByLocale = new Map<string, string>();
        for (const locale of resolved.locales) {
          const glossary = glossaries.get(locale);
          const hash = glossary ? hashGlossary(glossary) : EMPTY_GLOSSARY_HASH;
          glossaryHashByLocale.set(locale, hash);
          // Capture for the build report (M9.2). The `file` field
          // surfaces which YAML produced the hash; the `sha256` is
          // the canonical content hash so a CI diff over the report
          // surfaces glossary edits cleanly.
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
        // We parse and select translatable frontmatter even on the dry-run
        // pass so the keys we log are the same ones the live pass would
        // PUT/GET — otherwise a metaDescription edit produces matching
        // dry-run logs but a cache-busting live hash, which is a confusing
        // diagnostic split between modes.
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

        // Live mode gates: provider must be configured AND dry-run must
        // be off. With no provider, there's nothing to call. With dry-run
        // on, the operator has explicitly opted out of network calls
        // (useful in CI). The cache key already reflects the model id in
        // both branches, so dry-run output is a faithful preview of what
        // a live run would key against.
        const liveMode = resolved.provider !== undefined && !resolved.dryRun;
        if (!liveMode) return;

        logger.info(
          `live: processing ${sources.length} × ${resolved.locales.length} (file, locale) pairs at concurrency ${resolved.concurrency}`,
        );

        // Per-pair counters. "hit" = served from cache, no provider
        // call; "miss" = freshly translated and (if r2 is configured)
        // written back; "override" = a checked-in human-edited file
        // under `overridesDir` short-circuited both cache and
        // translator (counted as a hit for cost accounting but tracked
        // separately so the operator sees overrides taking effect).
        // Sources are processed up to `concurrency` in parallel; each
        // source's per-locale loop stays sequential so we don't
        // over-fan against a single provider for one document.
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

        // Internal-link rewrite plumbing. Built once per build so the
        // per-pair loop pays no setup cost. The "all locales" array
        // includes the default locale because the rewriter needs to
        // recognise `/${defaultLocale}/...` as already-prefixed (an
        // operator might author such links by hand to opt out of
        // rewriting on a case-by-case basis). When
        // `rewriteInternalLinks` is false we leave the helper unset
        // and the per-pair loop skips the call entirely.
        //
        // Capturing `resolved` into a `const` here so the closure
        // below sees the post-narrowing non-undefined type without TS
        // re-widening on every reference.
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
        // Per-source counter so the closing summary can report how many
        // sources were skipped due to `noTranslate: true` separate from
        // the per-locale outcome counters below. Useful for the
        // operator to spot a misnamed flag (e.g. `noTranslated: true`)
        // when the count looks unexpectedly low.
        let noTranslateSources = 0;
        // The per-source body runs as a worker fed by the
        // `runWithConcurrency` pool. State mutations across workers
        // (counts, touchedPairs, noTranslateSources, the cache-write
        // bookkeeping) are JS-object operations that don't need
        // synchronisation in a single-threaded runtime: increment
        // order doesn't matter, and nothing reads these values
        // mid-run. The pool resolves once every source has been
        // processed; the closing-summary log lines below run after.
        // Re-bind a non-undefined-typed alias for use inside the pool
        // worker. `resolved` is narrowed to non-undefined at this
        // point in the outer scope, but TS widens it back across the
        // async-closure boundary, which would force us to repeat
        // `resolved!` everywhere. The capture also keeps the closure's
        // dependency on the outer state explicit.
        const cfg = resolved;
        await runWithConcurrency(sources, cfg.concurrency, async (source) => {
          const body = await readFile(source.absolutePath, "utf8");
          const ast = parseMarkdown(body);
          // Frontmatter values + AST extraction lifted up to the top
          // of the worker so all branches (noTranslate-skip, override,
          // translate, error) can compute the cache key consistently
          // and push report entries with the same `sourceHash` shape.
          // The cost is one parse + extract per source even on the
          // noTranslate branch, which is negligible compared to a
          // single Workers AI round-trip.
          const extractOptsForReport = {
            sourcePath: source.relativePath,
            frontmatter: cfg.frontmatter,
          };
          const fmValuesForReport = selectTranslatableFrontmatter(
            ast,
            extractOptsForReport,
          );
          // Helper that materialises the (sourceHash, r2Key, modelId)
          // triple for a given locale. Used at every terminal branch
          // below to push consistent report entries.
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
          // Per-entry opt-out (RFC §2.2). When the source's frontmatter
          // has `noTranslate: true`, skip the entire translation loop
          // for this file: no AI call, no R2 write, no staging file
          // written for any non-default locale. The runtime helper
          // (`getLocalizedEntry`) will subsequently notice the missing
          // sibling and apply `noTranslateBehavior` — `"fallback"` to
          // serve source content under the locale URL, or `"404"` to
          // return undefined and let the page produce a 404.
          //
          // A `noTranslate: true` source can still receive an override
          // (`i18n/overrides/<locale>/<rel>`); overrides are
          // operator-curated and explicitly opt back in for one
          // locale at a time. We deliberately don't enforce mutual
          // exclusion — if both are set, the override wins, which
          // mirrors the precedence overrides have everywhere else in
          // the pipeline.
          if (peekNoTranslate(ast)) {
            noTranslateSources++;
            // Run the override pre-pass for any locale that has a
            // hand-translation; everything else is skipped silently.
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
                // No override for this locale on a noTranslate source
                // — record the deliberate skip in the report so a CI
                // diff makes the operator's intent visible.
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
            // `return` (not `continue`) — we're inside the pool
            // worker function for this source, not the outer for-loop.
            // Returns this worker's promise; the pool picks up the
            // next source.
            return;
          }
          const extractOpts = {
            sourcePath: source.relativePath,
            frontmatter: cfg.frontmatter,
          };
          const segments = extractSegments(ast, extractOpts, body);
          // Translatable frontmatter values feed the cache-key hash so
          // editing e.g. `metaDescription` busts the cache for that
          // (file, locale) pair. Without this, the prior implementation
          // hashed `frontmatter: {}` and a metaDescription edit
          // silently re-used the stale translation. Computed once per
          // source and reused across the per-locale loop.
          const fmValues = selectTranslatableFrontmatter(ast, extractOpts);
          // Note: the segments-empty check moved inside the per-locale
          // loop. A source with zero translatable segments may still
          // have manual overrides for some locales, and those should
          // still be staged.

          for (const locale of cfg.locales) {
            const pairStart = Date.now();
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
                overridesDir: cfg.overridesDir,
                locale,
                relativeSourcePath: source.relativePath,
              });
              if (override !== null) {
                // Run the rewriter on overrides too: an operator's
                // hand-translated file may legitimately contain raw
                // internal links that need locale-prefixing for the
                // built site. Idempotent for already-prefixed URLs.
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
              // ISO-8601 stamp computed once per pair so the
              // R2-metadata `translated-at` header and the in-bytes
              // `aiTranslatedAt` marker share the exact same value.
              // Two-source-of-truth would surface as a confusing
              // mismatch if anyone diffs the cache against the
              // staged file.
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
                // AI-translation marker (RFC §3.11). Baked into the
                // translated bytes BEFORE the R2 PUT so cache hits
                // on subsequent builds return the marker verbatim
                // without re-stringifying. `aiTranslatedAt` reflects
                // the original translation time even on hits, which
                // is what consumers want for "page first translated
                // on YYYY-MM-DD" disclaimer copy.
                frontmatterAdditions: {
                  aiTranslated: true,
                  aiTranslationModel: translator.modelId,
                  aiTranslatedAt: translatedAt,
                },
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
              reportState.entries.push({
                sourcePath: source.relativePath,
                locale,
                sourceHash,
                r2Key: key,
                outcome: result.outcome === "hit" ? "cache-hit" : "ai-translated",
                model: translator.modelId,
                durationMs: Date.now() - pairStart,
              });

              // Stage the translated bytes for `polystellaCollections` to
              // pick up. The sibling collection's loader watches
              // `<stagingDir>/<locale>/<collection>/<rest>` and Astro's
              // content layer compiles each entry through the normal
              // pipeline (schema validation, MDX compilation,
              // `entry.rendered.html`, custom remark/rehype plugins) —
              // no overlay logic needed at runtime.
              // Apply internal-link rewriting AFTER the cache layer
              // returns. This way the cache stores the
              // translation-only output; toggling
              // `rewriteInternalLinks` doesn't invalidate cached
              // bytes, and the rewriter's idempotent guard prevents
              // double-prefixing on cache hits whose stored bytes
              // already happen to contain locale-prefixed URLs.
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

              // Optional debug-write: same content as staging but at a
              // user-visible path for inspection. No-op when previewDir
              // is unset.
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
              logger.error(
                `✗ ${source.relativePath} → ${locale}: ${message}`,
              );
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
            // Wire into the build report — keep both the flat key
            // list (for forensic spelunking) and a per-locale count
            // (for the at-a-glance "did we prune more than expected
            // somewhere" check). We re-derive the locale from each
            // key rather than threading state through the pruner so
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
        // Emit the build report (M9.2 / RFC §3.9). Runs at the very
        // end of the build, after Astro itself has populated the
        // output directory and after PolyStella's prune step has
        // recorded its deletions into `reportState.pruning`.
        //
        // No-op when `resolved` is undefined (the integration was
        // never configured — shouldn't happen, but defensive) or
        // when the build hook never ran in `live` mode (e.g. dev
        // mode without `runOn: ["dev"]`, or `dryRun: true`). In
        // those cases the entries list is empty and emitting an
        // empty report just clutters the dist directory.
        if (!resolved) return;
        if (reportState.entries.length === 0) return;

        const report: BuildReport = {
          build: {
            startedAt: reportState.startedAt,
            durationMs: Date.now() - reportState.startedAtMs,
            mode:
              resolved.mode === "starlight" ? "starlight" : "standalone",
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
          const reportPath = await emitBuildReport({
            outDir,
            report,
          });
          logger.info(
            `i18n build report: ${path.relative(
              fileURLToPath(resolved ? new URL("./", dir) : dir),
              reportPath,
            )} (${report.entries.length} entries, ${
              report.totals.cacheHits
            } hit / ${report.totals.aiTranslated} miss / ${
              report.totals.overrides
            } override / ${report.totals.errors} error)`,
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

