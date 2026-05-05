import { createHash } from "node:crypto";

/**
 * Per-(file, locale) cache-key hash. Composition:
 *
 *     sha256( body || canonicalFrontmatter || glossaryHash || modelId )
 *
 * Each component is length-prefixed and null-terminated so component
 * bytes can never collide with another's separator.
 *
 * Stable across frontmatter key reorderings; sensitive to body /
 * translatable-frontmatter / glossary / model changes.
 */
export interface HashInput {
  /** Raw source body (UTF-8). */
  body: string;
  /** Frontmatter values selected by the configured per-glob rules. */
  frontmatter: Record<string, unknown>;
  /** SHA-256 hex of the locale's glossary, or "" when none configured. */
  glossaryHash: string;
  /** Resolved model id for this locale. */
  modelId: string;
}

/** 64-char lowercase hex SHA-256 digest. */
export function computeSourceHash(input: HashInput): string {
  const segments: string[] = [input.body, canonicalJSON(input.frontmatter), input.glossaryHash, input.modelId];

  const hasher = createHash("sha256");
  for (const segment of segments) {
    // Length-prefix + NUL so component boundaries are unambiguous.
    hasher.update(`${segment.length}:`, "utf8");
    hasher.update(segment, "utf8");
    hasher.update("\0", "utf8");
  }
  return hasher.digest("hex");
}

/**
 * Sort keys recursively, no whitespace, undefined properties dropped.
 * Sufficient for deterministic hashing; not full RFC 8785.
 */
function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJSON(v)}`).join(",")}}`;
}
