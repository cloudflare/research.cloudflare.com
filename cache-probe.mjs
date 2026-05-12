/**
 * TEMPORARY — Workers Builds cacheDir probe.
 *
 * Purpose: settle three open questions before deciding whether to relocate
 * PolyStella's i18n staging dir into Astro's `cacheDir`
 * (= `node_modules/.astro`) so it gets picked up by the Workers Builds
 * Build Caching beta:
 *
 *   Q1. Where does `config.cacheDir` actually resolve in Astro 6?
 *       (We expect `<root>/node_modules/.astro/`; PolyStella's
 *       `storage/paths.ts` comment asserts this. Confirm empirically.)
 *
 *   Q2. Does a file written to `cacheDir` at `astro:config:setup` survive
 *       every later lifecycle hook in the SAME build? If Astro itself
 *       wipes `cacheDir` between phases, the relocation idea is dead.
 *
 *   Q3. Does Workers Builds restore the contents of `cacheDir` from the
 *       previous build, and is the restore scoped per-branch or shared
 *       across all branches in the project? (The docs say "project-wide
 *       shared cache" but don't define branch scoping.)
 *
 * Mechanism:
 *   - Probe A (in-build survival): drop a file with a unique nonce at
 *     `astro:config:setup`. At every subsequent hook, re-read it. Log
 *     whether it survived and whether the nonce matches.
 *   - Probe B (cross-build restoration): at `astro:config:setup`, read
 *     the file written by the PREVIOUS build (if any) and log its
 *     branch / buildId / timestamp. At `astro:build:done`, write a
 *     fresh fingerprint for the NEXT build to find.
 *
 * Interpretation guide (grep `[cache-probe]` in the build log):
 *   - "RESTORED from prior build … branch=<X>" with X = current branch
 *       → cache is restored, within-branch.
 *   - "RESTORED from prior build … branch=<Y>" with Y ≠ current branch
 *       → cache is restored, CROSS-BRANCH (= shared across branches).
 *   - "no prior probe found"
 *       → cold cache. Either first build with caching on, or per-branch
 *         isolation + first build on this branch, or the beta isn't
 *         actually enabled.
 *   - "probe-A VANISHED at <hook>"
 *       → Astro is wiping cacheDir mid-build. Relocation idea is dead.
 *
 * To collect data:
 *   1. Enable Build Caching beta on the Worker in the Cloudflare dashboard.
 *   2. Push a commit to branch A. Capture the build log.
 *   3. Push a commit to branch A again (different content). Capture again.
 *      → first push tells us if cacheDir survives one build.
 *      → second push tells us if Workers Builds restored A's cache.
 *   4. Push a commit to branch B (any other branch). Capture the build log.
 *      → tells us whether B sees A's probe-B (cross-branch) or not
 *        (per-branch).
 *
 * To remove: delete this file and the import/registration in
 * `astro.config.mjs`.
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PROBE_A_NAME = ".polystella-probe-A-in-build.txt";
const PROBE_B_NAME = ".polystella-probe-B-cross-build.json";

/**
 * @returns {import('astro').AstroIntegration}
 */
export default function cacheProbe() {
  /** @type {string} */ let cacheDirPath;
  /** @type {string} */ let probeAPath;
  /** @type {string} */ let probeBPath;
  /** @type {string} */ let nonceA;
  /** @type {string} */ let buildId;
  /** @type {string} */ let branch;

  return {
    name: "cache-probe",
    hooks: {
      "astro:config:setup": ({ config, logger }) => {
        cacheDirPath = fileURLToPath(config.cacheDir);
        probeAPath = path.join(cacheDirPath, PROBE_A_NAME);
        probeBPath = path.join(cacheDirPath, PROBE_B_NAME);

        // Branch + buildId from Workers Builds env (set in CI; fall back
        // to local sentinels so the probe still does something useful
        // when run via `pnpm build` on a dev machine).
        branch = process.env.WORKERS_CI_BRANCH ?? "local";
        buildId = process.env.WORKERS_CI_BUILD_UUID ?? process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 8) ?? `local-${Date.now()}`;
        nonceA = `${branch}::${buildId}::${Date.now()}`;

        logger.info(`[cache-probe] Q1 cacheDir resolves to: ${cacheDirPath}`);
        logger.info(`[cache-probe] this build: branch=${branch} buildId=${buildId}`);

        // Q3: read any prior probe-B (left by a previous build).
        try {
          const prior = JSON.parse(readFileSync(probeBPath, "utf8"));
          const sameBranch = prior.branch === branch;
          logger.info(
            `[cache-probe] Q3 RESTORED prior probe-B: branch=${prior.branch} buildId=${prior.buildId} writtenAt=${prior.writtenAt} finalPhase=${prior.finalPhase}`,
          );
          logger.info(
            sameBranch
              ? `[cache-probe] Q3   → SAME branch as current (within-branch restore)`
              : `[cache-probe] Q3   → DIFFERENT branch (CROSS-BRANCH restore — cache is shared across branches)`,
          );
        } catch (err) {
          if (err && err.code === "ENOENT") {
            logger.info(`[cache-probe] Q3 no prior probe-B found (cold cacheDir on this build)`);
          } else {
            logger.warn(`[cache-probe] Q3 prior probe-B read failed: ${err && err.message}`);
          }
        }

        // Q2: write probe-A with a unique nonce. Subsequent hooks read it back.
        try {
          mkdirSync(cacheDirPath, { recursive: true });
          writeFileSync(probeAPath, nonceA, "utf8");
          logger.info(`[cache-probe] Q2 probe-A written at config:setup (nonce=${nonceA})`);
        } catch (err) {
          logger.warn(`[cache-probe] Q2 probe-A WRITE FAILED at config:setup: ${err && err.message}`);
        }
      },

      "astro:config:done": ({ logger }) => checkProbeA(probeAPath, nonceA, "config:done", logger),
      "astro:build:start": ({ logger }) => checkProbeA(probeAPath, nonceA, "build:start", logger),
      "astro:build:setup": ({ logger }) => checkProbeA(probeAPath, nonceA, "build:setup", logger),
      "astro:build:generated": ({ logger }) => checkProbeA(probeAPath, nonceA, "build:generated", logger),

      "astro:build:done": ({ logger }) => {
        checkProbeA(probeAPath, nonceA, "build:done", logger);

        // Q3 setup: write a fresh probe-B for the NEXT build to find.
        const data = {
          writtenAt: new Date().toISOString(),
          branch,
          buildId,
          finalPhase: "build:done",
        };
        try {
          mkdirSync(cacheDirPath, { recursive: true });
          writeFileSync(probeBPath, JSON.stringify(data, null, 2), "utf8");
          logger.info(`[cache-probe] Q3 probe-B written at build:done for next build to find`);
        } catch (err) {
          logger.warn(`[cache-probe] Q3 probe-B WRITE FAILED at build:done: ${err && err.message}`);
        }
      },
    },
  };
}

/**
 * @param {string} probePath
 * @param {string} expectedNonce
 * @param {string} hook
 * @param {{ info: (s: string) => void; warn: (s: string) => void }} logger
 */
function checkProbeA(probePath, expectedNonce, hook, logger) {
  try {
    const observed = readFileSync(probePath, "utf8");
    if (observed === expectedNonce) {
      logger.info(`[cache-probe] Q2 probe-A SURVIVED at ${hook}`);
    } else {
      logger.warn(
        `[cache-probe] Q2 probe-A NONCE MISMATCH at ${hook} (observed="${observed}", expected="${expectedNonce}") — file overwritten between hooks`,
      );
    }
  } catch (err) {
    if (err && err.code === "ENOENT") {
      logger.warn(`[cache-probe] Q2 probe-A VANISHED at ${hook} — cacheDir was wiped between hooks`);
    } else {
      logger.warn(`[cache-probe] Q2 probe-A READ FAILED at ${hook}: ${err && err.message}`);
    }
  }
}
