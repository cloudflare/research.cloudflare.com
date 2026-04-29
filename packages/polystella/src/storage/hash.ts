import { createHash } from "node:crypto";

/**
 * Inputs to the per-(file, locale) cache-key hash.
 *
 * Hash composition:
 *
 *     sha256( body || canonicalFrontmatter || glossaryHash || modelId )
 *
 * Each component is length-prefixed and null-terminated so its bytes
 * can never collide with another component's separator.
 */
export interface HashInput {
  /**
   * The canonical body string. Currently the raw file bytes (UTF-8);
   * once the parser is wired in this becomes the parsed-then-restringified
   * body, so cosmetic whitespace changes won't bust the cache.
   */
  body: string;
  /**
   * Frontmatter values selected by the per-glob rules in
   * `polystella({ frontmatter })`. Empty `{}` until the parser populates it.
   */
  frontmatter: Record<string, unknown>;
  /**
   * SHA-256 hex of the locale's glossary YAML, or empty string when no
   * glossary is configured. Populated once glossaries are wired in.
   */
  glossaryHash: string;
  /**
   * Resolved model id for this locale (e.g. `@cf/meta/llama-3.1-8b-instruct`).
   * Populated once provider resolution is wired in.
   */
  modelId: string;
}

/**
 * Compute the cache-key hash for a (file, locale) pair.
 *
 * Stability properties:
 *   - Stable across reorderings of frontmatter keys (canonicalised by sort).
 *   - Sensitive to body changes.
 *   - Sensitive to frontmatter value changes within the configured key set.
 *   - Sensitive to glossary version changes (per-locale).
 *   - Sensitive to model changes (per-locale).
 *
 * Returns a 64-char lowercase hex SHA-256 digest.
 */
export function computeSourceHash(input: HashInput): string {
  const segments: string[] = [
    input.body,
    canonicalJSON(input.frontmatter),
    input.glossaryHash,
    input.modelId,
  ];

  const hasher = createHash("sha256");
  for (const segment of segments) {
    // Length-prefix each segment so component boundaries are unambiguous;
    // the trailing NUL further guards against pathological inputs that
    // happen to contain the prefix bytes.
    hasher.update(`${segment.length}:`, "utf8");
    hasher.update(segment, "utf8");
    hasher.update("\0", "utf8");
  }
  return hasher.digest("hex");
}

/**
 * Canonical JSON: keys sorted recursively, no whitespace, undefined
 * properties removed. Sufficient for our deterministic-hash use case;
 * intentionally not a full RFC 8785 implementation.
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
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJSON(v)}`)
    .join(",")}}`;
}
