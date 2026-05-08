import type { Segment } from "../parsing/extract.js";
import type { Glossary } from "../glossary/glossary.js";
import type { PolyStellaResolvedOptions } from "../config/options.js";
import { buildPrompt, parseResponse } from "./prompt.js";

/**
 * One `Translator` per (provider, locale). Two concrete providers
 * ship: Workers AI and Anthropic. Both speak the same prompt-and-
 * JSON-back contract enforced by `prompt.ts`.
 */
export interface Translator {
  /** Resolved model id (per-locale). Folded into the cache key. */
  readonly modelId: string;
  /** Returns the model's raw text; caller validates via `parseResponse`. */
  translate(systemPrompt: string, userPrompt: string): Promise<string>;
}

type ProviderConfig = NonNullable<PolyStellaResolvedOptions["provider"]>;
type WorkersAIConfig = Extract<ProviderConfig, { kind: "workers-ai" }>;
type AnthropicConfig = Extract<ProviderConfig, { kind: "anthropic" }>;
type ModelSpec = WorkersAIConfig["model"];

export interface CreateTranslatorOptions {
  /** Defaults to global `fetch`; tests pass a stub. */
  fetchImpl?: typeof fetch;
}

/**
 * Throws on unknown provider kind. Doesn't validate credentials —
 * auth failures surface from the first `translate()` call.
 */
export function createTranslator(provider: ProviderConfig, locale: string, options: CreateTranslatorOptions = {}): Translator {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (provider.kind === "workers-ai") {
    return createWorkersAITranslator(provider, locale, fetchImpl);
  }
  if (provider.kind === "anthropic") {
    return createAnthropicTranslator(provider, locale, fetchImpl);
  }
  throw new Error(`[polystella] unknown provider kind: ${(provider as { kind: string }).kind}`);
}

/**
 * Resolve a (possibly per-locale) model spec to a concrete model id:
 *   "x"                            → "x"
 *   { default: "X", "ja-JP": "Y" } → locale-keyed lookup, falls to default.
 *
 * Exported because the cache key needs the resolved id before
 * `translate()` runs.
 */
export function resolveModelId(spec: ModelSpec, locale: string): string {
  if (typeof spec === "string") return spec;
  return spec[locale] ?? spec.default;
}

function createWorkersAITranslator(provider: WorkersAIConfig, locale: string, fetchImpl: typeof fetch): Translator {
  const modelId = resolveModelId(provider.model, locale);
  const endpoint = provider.endpoint ?? `https://api.cloudflare.com/client/v4/accounts/${provider.accountId}/ai/run/${modelId}`;

  return {
    modelId,
    async translate(systemPrompt, userPrompt) {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${provider.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          // WAI's default cap (~256 tokens) truncates multi-segment
          // translations and breaks JSON. Schema default 8192.
          max_tokens: provider.maxTokens,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`[polystella] Workers AI request failed: ${res.status} ${res.statusText}${text ? `\n${text}` : ""}`);
      }
      // Three response shapes observed in the wild:
      //   - `result.response` — legacy text-generation envelope.
      //   - `result.choices[0].message.content` — OpenAI-compatible
      //     chat-completion (qwen3-30b-a3b-fp8 etc.).
      //   - `choices[0].message.content` — gateway-flattened variant.
      const data = (await res.json()) as {
        result?: {
          response?: unknown;
          choices?: Array<{ message?: { content?: unknown } }>;
        };
        choices?: Array<{ message?: { content?: unknown } }>;
        success?: boolean;
        errors?: unknown[];
      };
      if (data.success === false) {
        throw new Error(`[polystella] Workers AI returned errors: ${JSON.stringify(data.errors ?? [])}`);
      }

      // Probe legacy `result.response` first (most text models),
      // then chat-completion shapes. Some models pre-parse JSON
      // server-side and return an object; round-trip via stringify
      // so `parseResponse` sees a string regardless of provider.
      const candidates: Array<unknown> = [
        data.result?.response,
        data.result?.choices?.[0]?.message?.content,
        data.choices?.[0]?.message?.content,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string") return candidate;
        if (candidate !== null && typeof candidate === "object") {
          return JSON.stringify(candidate);
        }
      }

      // None of the known shapes matched. Dump the envelope so the
      // operator can see what came back; caps at ~800 chars to keep
      // build logs readable. The error message is intentionally
      // explicit about which fields we probed so a future shape
      // surfaces with a clear "we tried these places" trail.
      const dump = JSON.stringify(data);
      const preview = dump.length > 800 ? `${dump.slice(0, 800)}\n... [truncated, total length ${dump.length}]` : dump;
      throw new Error(
        `[polystella] unexpected Workers AI response shape (model="${modelId}"): none of result.response, result.choices[0].message.content, or choices[0].message.content held a usable string or object. Raw response was:\n${preview}`,
      );
    },
  };
}

function createAnthropicTranslator(provider: AnthropicConfig, locale: string, fetchImpl: typeof fetch): Translator {
  const modelId = resolveModelId(provider.model, locale);
  const endpoint = "https://api.anthropic.com/v1/messages";

  return {
    modelId,
    async translate(systemPrompt, userPrompt) {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "x-api-key": provider.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: provider.maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`[polystella] Anthropic request failed: ${res.status} ${res.statusText}${text ? `\n${text}` : ""}`);
      }
      const data = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const textBlock = data.content?.find((b) => b.type === "text");
      const text = textBlock?.text;
      if (typeof text !== "string") {
        throw new Error(`[polystella] unexpected Anthropic response shape: no text content block`);
      }
      return text;
    },
  };
}

export interface TranslateBatchOptions {
  translator: Translator;
  segments: Segment[];
  glossary: Glossary;
  sourceLocale: string;
  targetLocale: string;
  /** Optional site-/domain-specific prompt extension; see `BuildPromptInput.context`. */
  context?: string;
  /**
   * Number of retries on translator/parse failure. `0` (default)
   * preserves legacy behaviour — a single failed attempt throws.
   * `N` retries the same prompt up to `N` more times before
   * giving up. The model's natural sampling variance means a
   * malformed first response (empty translation, omitted segment,
   * hallucinated id) usually clears on the next attempt without
   * any prompt-engineering changes.
   */
  maxRetries?: number;
  /**
   * Fires once per failed attempt that's followed by a retry —
   * does NOT fire on the FINAL attempt (which throws). Useful for
   * surfacing retries in the build log so an operator notices a
   * model that's misbehaving more than usual.
   */
  onRetry?: (event: TranslateBatchRetryEvent) => void;
}

export interface TranslateBatchRetryEvent {
  /** 1-indexed attempt number that just failed. */
  attempt: number;
  /** Total number of attempts that will be made (1 + maxRetries). */
  totalAttempts: number;
  /** Error from the failed attempt. */
  error: Error;
}

/**
 * Build the prompt, call the provider, parse the response. Returns
 * `Map<segmentId, translatedText>` for `applyTranslations`. Empty
 * segments → empty map, no network call.
 *
 * On parse / translator failure, retries up to `maxRetries` times
 * with the SAME prompt (sampling variance handles transient model
 * glitches; deterministic failures still propagate after exhausting
 * retries). The error thrown on final failure is the LAST attempt's
 * error — not the first — so logs reflect the actual death mode.
 */
export async function translateBatch(opts: TranslateBatchOptions): Promise<Map<string, string>> {
  const { translator, segments, glossary, sourceLocale, targetLocale, context, maxRetries = 0, onRetry } = opts;
  if (segments.length === 0) return new Map();

  const { systemPrompt, userPrompt } = buildPrompt({
    segments,
    glossary,
    sourceLocale,
    targetLocale,
    context,
  });

  const expectedIds = segments.map((s) => s.id);
  const totalAttempts = Math.max(1, maxRetries + 1);
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      const rawText = await translator.translate(systemPrompt, userPrompt);
      return parseResponse(rawText, expectedIds);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < totalAttempts) {
        onRetry?.({ attempt, totalAttempts, error: lastError });
        continue;
      }
      throw lastError;
    }
  }

  // Unreachable: the loop above either returns or throws, but TS's
  // control-flow analysis can't see it. Throwing the last error
  // keeps the type narrow.
  throw lastError ?? new Error("[polystella] translateBatch exhausted retries with no recorded error");
}
