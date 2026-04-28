import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "astro/zod";
import { parse as parseYaml } from "yaml";
import type { PolyStellaResolvedOptions } from "./options.js";

/**
 * Validated, normalised contents of a single locale's glossary.
 *
 * Normalisation guarantees:
 *   - `doNotTranslate` is de-duplicated and sorted ascending (so the
 *     hash is stable across user edits that only reorder entries).
 *   - `preferredTranslations` keys are sorted on serialisation.
 *   - Missing optional fields (`version`, `notes`) become the empty
 *     string, never `undefined`.
 *
 * Two glossaries with the same semantic content hash identically
 * regardless of source-YAML key order, formatting, or comments.
 */
export interface Glossary {
  version: string;
  doNotTranslate: string[];
  preferredTranslations: Record<string, string>;
  notes: string;
}

/**
 * Sentinel "no glossary" value. Returned by lookups when a locale has
 * no glossary configured or its file is missing. Hashes deterministically
 * to `EMPTY_GLOSSARY_HASH`.
 */
export const EMPTY_GLOSSARY: Glossary = {
  version: "",
  doNotTranslate: [],
  preferredTranslations: {},
  notes: "",
};

const glossaryDataSchema = z
  .object({
    version: z.string().optional(),
    doNotTranslate: z.array(z.string().min(1)).optional(),
    preferredTranslations: z
      .record(z.string().min(1), z.string().min(1))
      .optional(),
    notes: z.string().optional(),
  })
  .strict();

export interface LoadGlossariesOptions {
  /** Resolved integration options (the output of `resolveOptions`). */
  config: PolyStellaResolvedOptions;
  /**
   * Astro project root, used to resolve relative paths in
   * `glossary.file` templates. Pass `config.root` from the
   * `astro:config:setup` hook.
   */
  projectRoot: URL;
}

/**
 * Load and validate per-locale glossaries.
 *
 * Returns a `Map<locale, Glossary>`. A locale missing from the result
 * means "no glossary configured (or file missing) for this locale" —
 * downstream code should treat that as `EMPTY_GLOSSARY`.
 *
 * Behaviour by config shape:
 *   - No `glossary` key: returns an empty map.
 *   - `glossary.file`: reads `<file template with {locale} substituted>`
 *     for every configured locale. Missing files are silently skipped
 *     (so you can ship a glossary for one locale before another).
 *   - `glossary.inline`: pulls per-locale entries straight from config.
 *
 * Throws when:
 *   - `glossary.file` is provided without a `{locale}` placeholder.
 *   - A YAML file fails to parse, or its structure violates the schema.
 *   - A file read fails for a reason other than "file does not exist".
 */
export async function loadGlossaries(
  opts: LoadGlossariesOptions,
): Promise<Map<string, Glossary>> {
  const { config, projectRoot } = opts;
  if (!config.glossary) return new Map();

  const projectRootPath = fileURLToPath(projectRoot);
  const result = new Map<string, Glossary>();

  if ("file" in config.glossary) {
    const template = config.glossary.file;
    if (!template.includes("{locale}")) {
      throw new Error(
        `[polystella] glossary.file must contain the "{locale}" placeholder (got: ${JSON.stringify(
          template,
        )})`,
      );
    }
    for (const locale of config.locales) {
      const relPath = template.replaceAll("{locale}", locale);
      const absPath = path.resolve(projectRootPath, relPath);
      let raw: string;
      try {
        raw = await readFile(absPath, "utf8");
      } catch (err) {
        if (isNodeNotFoundError(err)) continue;
        throw err;
      }
      let parsed: unknown;
      try {
        parsed = parseYaml(raw);
      } catch (err) {
        throw new Error(
          `[polystella] failed to parse glossary YAML at ${absPath}: ${
            (err as Error).message
          }`,
        );
      }
      result.set(locale, validateGlossary(parsed ?? {}, absPath));
    }
    return result;
  }

  // Inline glossary.
  for (const [locale, data] of Object.entries(config.glossary.inline)) {
    result.set(
      locale,
      validateGlossary(data, `inline glossary for locale "${locale}"`),
    );
  }
  return result;
}

/**
 * Compute the SHA-256 of a glossary's canonical content. The result is
 * a 64-char lowercase hex string that depends ONLY on the glossary's
 * semantic content — it does not change when the source YAML's
 * formatting, key order, or comments change.
 *
 * Used as the `glossaryHash` component of the per-(file, locale) cache
 * key, so a glossary edit invalidates only that locale's cached
 * translations, not the entire build.
 */
export function hashGlossary(glossary: Glossary): string {
  const canonical = JSON.stringify({
    version: glossary.version,
    doNotTranslate: glossary.doNotTranslate,
    preferredTranslations: sortedRecord(glossary.preferredTranslations),
    notes: glossary.notes,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Pre-computed hash of `EMPTY_GLOSSARY`. Use when a locale has no
 * glossary so the cache key still reflects "we considered the
 * glossary, and there isn't one" — which differs from a configured
 * empty file because it's a string the caller controls.
 */
export const EMPTY_GLOSSARY_HASH: string = hashGlossary(EMPTY_GLOSSARY);

function validateGlossary(raw: unknown, context: string): Glossary {
  const parsed = glossaryDataSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => {
        const p = issue.path.length > 0 ? issue.path.join(".") : "<root>";
        return `  • ${p}: ${issue.message}`;
      })
      .join("\n");
    throw new Error(
      `[polystella] invalid glossary at ${context}:\n${issues}`,
    );
  }
  const data = parsed.data;
  return {
    version: data.version ?? "",
    doNotTranslate: dedupeAndSort(data.doNotTranslate ?? []),
    preferredTranslations: data.preferredTranslations ?? {},
    notes: data.notes ?? "",
  };
}

function dedupeAndSort(items: string[]): string[] {
  return Array.from(new Set(items)).sort();
}

function sortedRecord(rec: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(rec).sort()) {
    out[key] = rec[key]!;
  }
  return out;
}

function isNodeNotFoundError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}
