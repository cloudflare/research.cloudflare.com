/**
 * UI-string AI translation — fills empty placeholders in non-default
 * locale JSON files via the same provider stack the markdown pipeline
 * uses, but at a much smaller scale: ~118 keys × N locales, all
 * tiny short strings.
 *
 * Three pure helpers + one batched orchestrator:
 *   - `extractTokens` — set of `{{name}}` placeholders in a string
 *   - `validateTokenPreservation` — same set source vs. translation
 *   - `selectEmptyKeys` — pairs that need translating
 *   - `translateUiStringsForLocale` — one `translateBatch` round-trip
 *     per locale, plus a post-hoc token validator that re-throws to
 *     trigger the existing retry loop.
 *
 * Token preservation matters because the runtime `interpolate()`
 * (`i18n/translate.ts`) replaces `{{name}}` with caller-supplied
 * params — a dropped or mangled token silently breaks the page.
 * The validator is wired as a final check inside the retry surface,
 * not as a prompt-only instruction.
 */

import type { Glossary } from "../glossary/glossary.js";
import type { Segment } from "../parsing/extract.js";
import type { Translator } from "../translation/provider.js";
import { translateBatch, type TranslateBatchRetryEvent } from "../translation/provider.js";

/**
 * `{{token}}` extractor. The runtime grammar in `translate.ts` uses
 * `\w+` (word chars only — letters, digits, underscore), so we match
 * that for parity. Whitespace inside the braces is rejected by the
 * runtime; we reject it here too so a translation introducing
 * `{{ year }}` fails validation.
 */
const TOKEN_RE = /\{\{(\w+)\}\}/g;

/**
 * Set of distinct token names appearing in `text`. Empty for strings
 * without any `{{...}}` placeholders.
 */
export function extractTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(TOKEN_RE)) {
    if (match[1] !== undefined) out.add(match[1]);
  }
  return out;
}

export interface TokenValidationIssue {
  key: string;
  /** Tokens in source but absent from the translation. */
  missing: string[];
  /** Tokens in the translation but absent from the source. */
  spurious: string[];
}

/**
 * Compare token sets. Returns `null` if the translation preserves
 * every source token verbatim (and adds none extra); otherwise a
 * structured issue. The orchestrator wraps a returned issue in a
 * plain `Error` so `translateBatch`'s retry loop picks it up.
 */
export function validateTokenPreservation(key: string, source: string, translation: string): TokenValidationIssue | null {
  const sourceTokens = extractTokens(source);
  const translationTokens = extractTokens(translation);
  const missing = [...sourceTokens].filter((t) => !translationTokens.has(t));
  const spurious = [...translationTokens].filter((t) => !sourceTokens.has(t));
  if (missing.length === 0 && spurious.length === 0) return null;
  return { key, missing: missing.sort(), spurious: spurious.sort() };
}

export interface EmptyKeyPair {
  key: string;
  /** Source-locale value (always non-empty by `selectEmptyKeys`). */
  source: string;
}

/**
 * Find every key where the source has a non-empty value AND the
 * locale's value is `""`. Intentionally-blank source strings (empty
 * in `en-US.json`) are skipped — there's nothing to translate, and
 * the empty intent should propagate verbatim.
 */
export function selectEmptyKeys(sourceDict: Record<string, string>, localeDict: Record<string, string>): EmptyKeyPair[] {
  const out: EmptyKeyPair[] = [];
  for (const [key, source] of Object.entries(sourceDict)) {
    if (source.length === 0) continue;
    const existing = localeDict[key];
    if (existing === undefined || existing.length === 0) {
      out.push({ key, source });
    }
  }
  return out;
}

/**
 * Append a `{{token}}`-preservation style rule to a glossary in
 * memory so the system prompt instructs the model to keep
 * placeholders verbatim. Cheap layer-1 defence; the post-hoc
 * validator is the load-bearing one.
 *
 * Pure: returns a new glossary, doesn't mutate.
 */
export function withTokenPreservationRule(glossary: Glossary): Glossary {
  return {
    ...glossary,
    styleRules: [
      ...glossary.styleRules,
      {
        category: "placeholders",
        instruction:
          "Preserve every `{{token}}` placeholder verbatim — same name, same braces, same position relative to the surrounding text. Do not translate, rename, or remove them.",
        example: "Copyright ©{{year}}. -> Copyright ©{{year}}.",
      },
    ],
  };
}

export interface TranslateUiStringsOptions {
  translator: Translator;
  /** Glossary for the target locale (token-preservation rule is appended internally). */
  glossary: Glossary;
  /** Source-locale dict (typically `en-US`). */
  sourceDict: Record<string, string>;
  /** Existing locale dict; empty values flag keys for translation. */
  localeDict: Record<string, string>;
  sourceLocale: string;
  targetLocale: string;
  /** Optional system-prompt extension forwarded to `buildPrompt`. */
  context?: string | undefined;
  /** Same default as `translateBatch`; tests pass `0`. */
  maxRetries?: number;
  retryMinTimeoutMs?: number;
  retryFactor?: number;
  retryRandomize?: boolean;
  signal?: AbortSignal;
  /** Fires after each failed attempt that triggers another retry. */
  onRetry?: (event: TranslateBatchRetryEvent) => void;
}

export interface TranslateUiStringsResult {
  /** Post-translation locale dict (input + AI fills). */
  dict: Record<string, string>;
  /**
   * Keys for which translation succeeded AND passed token validation.
   * Sorted alphabetically for deterministic logging.
   */
  filled: string[];
  /**
   * Keys for which translation came back token-invalid even after
   * all retries — value left empty so a human can intervene.
   */
  tokenFailures: TokenValidationIssue[];
}

/**
 * Translate every empty-valued key in `localeDict` whose source is
 * non-empty. One batched LLM call per locale (the marker protocol
 * was designed for this). The token validator runs after
 * `parseResponse`; on failure we throw a plain Error so `p-retry`
 * inside `translateBatch` re-issues the same prompt — sampling
 * variance is what makes attempt N+1 succeed.
 *
 * Token failures that survive all retries are reported, NOT fatal:
 * the key is left empty and the caller surfaces the list. Hard-
 * failing here would mean a single stubborn key blocks the whole
 * locale; better to land the wins and flag the misses.
 */
export async function translateUiStringsForLocale(opts: TranslateUiStringsOptions): Promise<TranslateUiStringsResult> {
  const empties = selectEmptyKeys(opts.sourceDict, opts.localeDict);
  const dict: Record<string, string> = { ...opts.localeDict };
  if (empties.length === 0) {
    return { dict, filled: [], tokenFailures: [] };
  }

  const segments: Segment[] = empties.map(({ key, source }) => ({ id: key, text: source }));
  const glossaryWithRule = withTokenPreservationRule(opts.glossary);

  // Token validation lives outside `translateBatch`, so a validation
  // failure here doesn't trigger that function's internal retry. We
  // implement our own retry wrapping: on validation failure, throw
  // and re-invoke the whole batch. That's coarse-grained (one bad
  // segment retries every segment), but the alternative — a
  // per-segment retry — defeats the batching point. With glossary
  // + style-rule guidance the validator failure rate is low.
  const totalAttempts = Math.max(1, (opts.maxRetries ?? 0) + 1);
  let translations: Map<string, string> | undefined;
  let tokenFailures: TokenValidationIssue[] = [];
  let lastTokenErr: Error | undefined;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      const result = await translateBatch({
        translator: opts.translator,
        segments,
        glossary: glossaryWithRule,
        sourceLocale: opts.sourceLocale,
        targetLocale: opts.targetLocale,
        // Don't double-retry: we handle retries here so the token
        // validator sees every attempt's output.
        maxRetries: 0,
        ...(opts.context !== undefined ? { context: opts.context } : {}),
        ...(opts.retryMinTimeoutMs !== undefined ? { retryMinTimeoutMs: opts.retryMinTimeoutMs } : {}),
        ...(opts.retryFactor !== undefined ? { retryFactor: opts.retryFactor } : {}),
        ...(opts.retryRandomize !== undefined ? { retryRandomize: opts.retryRandomize } : {}),
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      });

      // Validate token preservation across every translated segment.
      const failures: TokenValidationIssue[] = [];
      for (const { key, source } of empties) {
        const translation = result.get(key);
        if (translation === undefined) continue;
        const issue = validateTokenPreservation(key, source, translation);
        if (issue !== null) failures.push(issue);
      }

      if (failures.length === 0) {
        translations = result;
        tokenFailures = [];
        break;
      }

      lastTokenErr = new Error(
        `[polystella] token-preservation validation failed for ${failures.length} key(s): ${failures
          .map((f) => `${f.key} (missing: [${f.missing.join(", ")}], spurious: [${f.spurious.join(", ")}])`)
          .join("; ")}`,
      );
      tokenFailures = failures;
      translations = result;

      // Last attempt → fall through to "land partial results + report".
      if (attempt < totalAttempts) {
        opts.onRetry?.({ attempt, totalAttempts, error: lastTokenErr });
        continue;
      }
    } catch (err) {
      // Provider / parse failure. Re-throw on the final attempt so the
      // caller sees the real error; otherwise log via onRetry and try
      // again. `translateBatch` itself does not retry (we set
      // maxRetries: 0 above), so this is the sole retry surface.
      if (attempt >= totalAttempts) throw err;
      opts.onRetry?.({ attempt, totalAttempts, error: err as Error });
    }
  }

  if (translations === undefined) {
    // Shouldn't be reachable: the loop either succeeds, returns a
    // partial result with tokenFailures, or rethrows. Defensive.
    return { dict, filled: [], tokenFailures };
  }

  // Apply: for every empty pair, if the model returned a token-valid
  // translation, write it. Token-invalid keys stay empty.
  const failedKeys = new Set(tokenFailures.map((f) => f.key));
  const filled: string[] = [];
  for (const { key } of empties) {
    if (failedKeys.has(key)) continue;
    const value = translations.get(key);
    if (value !== undefined) {
      dict[key] = value;
      filled.push(key);
    }
  }
  filled.sort();

  return { dict, filled, tokenFailures };
}
