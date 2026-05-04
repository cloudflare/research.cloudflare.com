import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "astro/zod";
import { parse as parseYaml } from "yaml";
import type { PolyStellaResolvedOptions } from "../config/options.js";

/**
 * Validated, normalised glossary for one locale.
 *
 * Normalisation: `doNotTranslate` deduped + sorted, preferred-
 * translation keys sorted on serialisation, optional fields default
 * to `""`. Two glossaries with the same semantic content hash
 * identically regardless of YAML formatting, key order, or comments.
 */
export interface Glossary {
  version: string;
  doNotTranslate: string[];
  preferredTranslations: Record<string, string>;
  notes: string;
}

/** Sentinel "no glossary" value; hashes to `EMPTY_GLOSSARY_HASH`. */
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
  config: PolyStellaResolvedOptions;
  /** Pass `config.root` from `astro:config:setup`. */
  projectRoot: URL;
}

/**
 * Returns `Map<locale, Glossary>`. Missing-from-map → caller should
 * treat as `EMPTY_GLOSSARY`. Missing files are silently skipped (so a
 * glossary for one locale can ship before another); malformed YAML
 * or schema violations throw.
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
 * SHA-256 hex of the glossary's canonical content. Stable across
 * YAML formatting, key order, and comments. Folded into the cache
 * key so glossary edits invalidate only the affected locale.
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
 * Pre-computed hash for the no-glossary case. Distinct from a hash
 * of an empty configured file because the bytes here are
 * caller-controlled.
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
    throw new Error(`[polystella] invalid glossary at ${context}:\n${issues}`);
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
    err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}
