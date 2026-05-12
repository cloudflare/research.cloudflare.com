import pRetry, { AbortError } from "p-retry";

import type { Segment } from "../parsing/extract.js";
import type { Glossary } from "../glossary/glossary.js";
import type { PolyStellaResolvedOptions } from "../config/options.js";
import { buildPrompt, parseResponse } from "./prompt.js";

/**
 * Permanent translator failure — `translateBatch` does NOT retry
 * these. Throw for: auth errors (401/403), bad-request (400),
 * not-found (404), unsupported-model. Anything network-flaky or
 * model-glitchy must be a plain Error so the retry loop catches it.
 */
export class PermanentProviderError extends Error {
  readonly _tag = "PermanentProviderError" as const;
  constructor(message: string) {
    super(message);
    this.name = "PermanentProviderError";
  }
}

/**
 * HTTP status codes the provider treats as permanent.
 *   400 — bad request (malformed prompt / unsupported parameter)
 *   401 — unauthenticated (wrong / missing API key)
 *   403 — forbidden (permission / quota / account state)
 *   404 — not found (wrong model id / endpoint)
 *   422 — semantic-invalid request body
 * Everything else (incl. 408, 425, 429, 500-599) is treated as
 * retriable; the model is the operator's problem to fix when 4xx
 * (other than retry-after) reaches us, not ours to paper over.
 */
const PERMANENT_HTTP_STATUSES = new Set([400, 401, 403, 404, 422]);

/**
 * One `Translator` per (provider, locale). Two concrete providers
 * ship: Workers AI and Anthropic. Both speak the same prompt-and-
 * JSON-back contract enforced by `prompt.ts`.
 */
export interface Translator {
  /** Resolved model id (per-locale). Folded into the cache key. */
  readonly modelId: string;
  /**
   * Returns the model's raw text; caller validates via `parseResponse`.
   * `signal` cancels in-flight HTTP and propagates `AbortError`.
   */
  translate(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string>;
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
    async translate(systemPrompt, userPrompt, signal) {
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
        ...(signal !== undefined ? { signal } : {}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const message = `[polystella] Workers AI request failed: ${res.status} ${res.statusText}${text ? `\n${text}` : ""}`;
        if (PERMANENT_HTTP_STATUSES.has(res.status)) {
          throw new PermanentProviderError(message);
        }
        throw new Error(message);
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
    async translate(systemPrompt, userPrompt, signal) {
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
        ...(signal !== undefined ? { signal } : {}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const message = `[polystella] Anthropic request failed: ${res.status} ${res.statusText}${text ? `\n${text}` : ""}`;
        if (PERMANENT_HTTP_STATUSES.has(res.status)) {
          throw new PermanentProviderError(message);
        }
        throw new Error(message);
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
   * Retries on transient failure (network 5xx, parse errors, model
   * hallucinations). `0` (default) = single attempt. `N` allows up
   * to `N+1` total attempts. `PermanentProviderError` (4xx auth /
   * bad request) short-circuits regardless of `maxRetries`.
   */
  maxRetries?: number;
  /**
   * Fires after each failed attempt that's followed by another
   * retry; does NOT fire on the final (failing) attempt.
   */
  onRetry?: (event: TranslateBatchRetryEvent) => void;
  /**
   * Backoff between retries. Defaults are zero-wait so tests and
   * unit callers stay fast; production callers (`runTranslationPass`)
   * pass real backoff for thundering-herd avoidance.
   */
  retryMinTimeoutMs?: number;
  retryFactor?: number;
  retryRandomize?: boolean;
  /** Abort in-flight translations cleanly when the build is cancelled. */
  signal?: AbortSignal;
}

export interface TranslateBatchRetryEvent {
  /** 1-indexed attempt number that just failed. */
  attempt: number;
  /** Total attempts that will be made (= 1 + maxRetries). */
  totalAttempts: number;
  /** Error from the failed attempt. */
  error: Error;
}

/**
 * Build prompt → translate → parse → return `Map<segmentId, text>`.
 * Empty segments short-circuit with no network call.
 *
 * Retries with exponential backoff + jitter on transient failures.
 * `PermanentProviderError` (4xx auth/bad-request) skips retries.
 * `signal` cancels in-flight work; the AbortError propagates.
 *
 * The final-failure throw carries the last attempt's error so logs
 * reflect the actual death mode, not the first attempt's.
 */
export async function translateBatch(opts: TranslateBatchOptions): Promise<Map<string, string>> {
  const {
    translator,
    segments,
    glossary,
    sourceLocale,
    targetLocale,
    context,
    maxRetries = 0,
    onRetry,
    retryMinTimeoutMs = 0,
    retryFactor = 2,
    retryRandomize = false,
    signal,
  } = opts;
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

  return pRetry(
    async () => {
      // p-retry doesn't auto-check the signal between attempts in
      // older versions; cheap inline guard keeps the contract sharp.
      signal?.throwIfAborted();
      const rawText = await translator.translate(systemPrompt, userPrompt, signal);
      return parseResponse(rawText, expectedIds);
    },
    {
      retries: maxRetries,
      minTimeout: retryMinTimeoutMs,
      factor: retryFactor,
      randomize: retryRandomize,
      ...(signal !== undefined ? { signal } : {}),
      // Wrap permanent provider errors in AbortError so p-retry
      // skips the remaining attempts. Plain Errors retry normally.
      shouldRetry: ({ error }) => !(error instanceof PermanentProviderError),
      onFailedAttempt: ({ error, attemptNumber, retriesLeft }) => {
        // Mirror the legacy contract: fire `onRetry` ONLY when
        // another attempt is coming. p-retry calls
        // `onFailedAttempt` on every failure (incl. the last).
        if (retriesLeft > 0 && !(error instanceof PermanentProviderError)) {
          onRetry?.({ attempt: attemptNumber, totalAttempts, error });
        }
      },
    },
  );
}
