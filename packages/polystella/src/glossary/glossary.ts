import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "astro/zod";
import { parse as parseYaml } from "yaml";
import type { PolyStellaResolvedOptions } from "../config/options.js";

/**
 * A single categorised style rule. `category` is a short tag that
 * groups related rules in the rendered prompt (e.g. `numbers`,
 * `dates`, `tone`). `instruction` is the imperative the model must
 * follow. `example` is an optional source-→-target illustration —
 * leave it off when the instruction stands alone.
 */
export interface StyleRule {
  category: string;
  instruction: string;
  example?: string;
}

/**
 * Validated, normalised glossary for one locale.
 *
 * Normalisation: `doNotTranslate` deduped + sorted, preferred-
 * translation keys sorted on serialisation, `styleRules` preserved
 * in author order (curator intent matters; reordering the YAML is
 * a meaningful edit and re-hashes), optional fields default to
 * `""` / `[]` / `{}`. Two glossaries with the same semantic content
 * hash identically regardless of YAML formatting, key order, or
 * comments — but reordering style rules DOES change the hash.
 */
export interface Glossary {
  version: string;
  doNotTranslate: string[];
  preferredTranslations: Record<string, string>;
  styleRules: StyleRule[];
  notes: string;
}

/** Sentinel "no glossary" value; hashes to `EMPTY_GLOSSARY_HASH`. */
export const EMPTY_GLOSSARY: Glossary = {
  version: "",
  doNotTranslate: [],
  preferredTranslations: {},
  styleRules: [],
  notes: "",
};

const styleRuleSchema = z
  .object({
    category: z.string().min(1),
    instruction: z.string().min(1),
    example: z.string().min(1).optional(),
  })
  .strict();

const glossaryDataSchema = z
  .object({
    version: z.string().optional(),
    doNotTranslate: z.array(z.string().min(1)).optional(),
    preferredTranslations: z.record(z.string().min(1), z.string().min(1)).optional(),
    styleRules: z.array(styleRuleSchema).optional(),
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
export async function loadGlossaries(opts: LoadGlossariesOptions): Promise<Map<string, Glossary>> {
  const { config, projectRoot } = opts;
  if (!config.glossary) return new Map();

  const projectRootPath = fileURLToPath(projectRoot);
  const result = new Map<string, Glossary>();

  if ("file" in config.glossary) {
    const template = config.glossary.file;
    if (!template.includes("{locale}")) {
      throw new Error(`[polystella] glossary.file must contain the "{locale}" placeholder (got: ${JSON.stringify(template)})`);
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
        throw new Error(`[polystella] failed to parse glossary YAML at ${absPath}: ${(err as Error).message}`);
      }
      result.set(locale, validateGlossary(parsed ?? {}, absPath));
    }
    return result;
  }

  // Inline glossary.
  for (const [locale, data] of Object.entries(config.glossary.inline)) {
    result.set(locale, validateGlossary(data, `inline glossary for locale "${locale}"`));
  }
  return result;
}

/**
 * SHA-256 hex of the glossary's canonical content. Stable across
 * YAML formatting, key order in the top-level object, and comments.
 * Folded into the cache key so glossary edits invalidate only the
 * affected locale.
 *
 * `styleRules` is hashed in author order — the curator's sequence
 * is rendered verbatim into the prompt, so reordering rules in the
 * YAML is a meaningful edit. Within each rule object, JSON.stringify
 * always emits keys in property-definition order (`category`,
 * `instruction`, `example`), which matches our `StyleRule` interface,
 * so YAML key reordering at the rule level doesn't perturb the hash.
 */
export function hashGlossary(glossary: Glossary): string {
  const canonical = JSON.stringify({
    version: glossary.version,
    doNotTranslate: glossary.doNotTranslate,
    preferredTranslations: sortedRecord(glossary.preferredTranslations),
    styleRules: glossary.styleRules.map(canonicaliseStyleRule),
    notes: glossary.notes,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Force a stable property order on `StyleRule` so the hash is
 * insensitive to whatever order Zod / YAML produced them in. We
 * also drop `example` when undefined so a rule with `example:
 * undefined` and a rule without the key produce identical bytes.
 */
function canonicaliseStyleRule(rule: StyleRule): { category: string; instruction: string; example?: string } {
  const out: { category: string; instruction: string; example?: string } = {
    category: rule.category,
    instruction: rule.instruction,
  };
  if (rule.example !== undefined) out.example = rule.example;
  return out;
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
    styleRules: (data.styleRules ?? []).map((rule) => ({
      category: rule.category,
      instruction: rule.instruction,
      // Drop `example` entirely when absent so consumers don't have
      // to distinguish `undefined` from "missing key".
      ...(rule.example !== undefined ? { example: rule.example } : {}),
    })),
    notes: data.notes ?? "",
  };
}

function dedupeAndSort(items: string[]): string[] {
  return Array.from(new Set(items)).sort();
}

function sortedRecord(rec: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(rec).sort()) {
    const value = rec[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function isNodeNotFoundError(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
}
