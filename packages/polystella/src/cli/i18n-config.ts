/**
 * Shared CLI helpers for loading the host project's Astro / PolyStella
 * config. Extracted from the original monolithic `cli.ts` so the new
 * UI-string subcommands can reuse the same loading semantics without
 * pulling in the entire translation orchestrator.
 *
 * Two public functions:
 *   - `loadAstroI18n(cwd)` — returns the `i18n` object from
 *     `astro.config.mjs`, or `undefined` if absent.
 *   - `loadPolystellaConfig(cwd)` — default-exports from
 *     `polystella.config.mjs`, used as input to `resolveOptions`.
 *
 * Both keep their error surface narrow: file-not-found becomes a
 * thrown `Error` with the offending path so CLI dispatch can format
 * remediation uniformly.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

import type { AstroI18nLike } from "../config/options.js";

export async function loadAstroI18n(cwd: string): Promise<AstroI18nLike | undefined> {
  const candidatePath = path.resolve(cwd, "astro.config.mjs");
  let module: { default?: unknown };
  try {
    module = await import(pathToFileURL(candidatePath).href);
  } catch (err) {
    throw new Error(`failed to load ${candidatePath}: ${(err as Error).message}`);
  }
  const exported = module.default ?? module;
  if (typeof exported !== "object" || exported === null) {
    return undefined;
  }
  const i18n = (exported as { i18n?: unknown }).i18n;
  if (typeof i18n !== "object" || i18n === null) {
    return undefined;
  }
  return i18n as AstroI18nLike;
}

export async function loadPolystellaConfig(cwd: string): Promise<unknown> {
  const candidatePath = path.resolve(cwd, "polystella.config.mjs");
  try {
    const module = (await import(pathToFileURL(candidatePath).href)) as {
      default: unknown;
    };
    return module.default;
  } catch (err) {
    throw new Error(`failed to load ${candidatePath}: ${(err as Error).message}`);
  }
}
