import type { Segment } from "./extract.js";
import type { Glossary } from "./glossary.js";
import type { PolyStellaResolvedOptions } from "./options.js";
import { buildPrompt, parseResponse } from "./prompt.js";

/**
 * Provider abstraction for the translation step.
 *
 * A `Translator` is bound to one (provider, locale) pair. It exposes:
 *   - `modelId`, the resolved model identifier — folded into the cache
 *     key so that switching models invalidates only that locale's
 *     cached translations,
 *   - `translate(systemPrompt, userPrompt)`, which performs one HTTP
 *     round-trip and returns the model's raw text response.
 *
 * Two concrete providers ship today: Workers AI (Cloudflare's
 * `@cf/...` model catalogue) and Anthropic (`claude-...`). Both speak
 * the same prompt-and-JSON-back contract enforced by `prompt.ts`, so
 * the rest of the integration treats them uniformly.
 */
export interface Translator {
  /** The resolved model id used by this translator (per-locale). */
  readonly modelId: string;
  /**
   * Run a translation request. Returns the model's raw text output
   * (caller passes it to `parseResponse` for validation).
   */
  translate(systemPrompt: string, userPrompt: string): Promise<string>;
}

type ProviderConfig = NonNullable<PolyStellaResolvedOptions["provider"]>;
type WorkersAIConfig = Extract<ProviderConfig, { kind: "workers-ai" }>;
type AnthropicConfig = Extract<ProviderConfig, { kind: "anthropic" }>;
type ModelSpec = WorkersAIConfig["model"];

export interface CreateTranslatorOptions {
  /**
   * Optional fetch implementation, used by tests to capture and stub
   * outbound HTTP. Defaults to the global `fetch` in production.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Construct a `Translator` for one (provider, locale) pair.
 *
 * Throws on an unknown provider kind. Does NOT validate credentials —
 * the first `translate()` call will surface auth failures from the
 * upstream API with that provider's error message.
 */
export function createTranslator(
  provider: ProviderConfig,
  locale: string,
  options: CreateTranslatorOptions = {},
): Translator {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (provider.kind === "workers-ai") {
    return createWorkersAITranslator(provider, locale, fetchImpl);
  }
  if (provider.kind === "anthropic") {
    return createAnthropicTranslator(provider, locale, fetchImpl);
  }
  throw new Error(
    `[polystella] unknown provider kind: ${
      (provider as { kind: string }).kind
    }`,
  );
}

/**
 * Resolve a (possibly per-locale) model spec to a concrete model id.
 *
 *   "claude-3-5-sonnet-latest"          → returned as-is
 *   { default: "X", "ja-JP": "Y" }, locale="ja-JP" → "Y"
 *   { default: "X", "ja-JP": "Y" }, locale="pt-BR" → "X"
 *
 * Exported because the cache key needs the resolved id BEFORE we
 * actually call `translate()`.
 */
export function resolveModelId(spec: ModelSpec, locale: string): string {
  if (typeof spec === "string") return spec;
  return spec[locale] ?? spec.default;
}

function createWorkersAITranslator(
  provider: WorkersAIConfig,
  locale: string,
  fetchImpl: typeof fetch,
): Translator {
  const modelId = resolveModelId(provider.model, locale);
  // Cloudflare's Workers AI run endpoint embeds the model id directly.
  // `provider.endpoint` overrides for testing or alternate gateways.
  const endpoint =
    provider.endpoint ??
    `https://api.cloudflare.com/client/v4/accounts/${provider.accountId}/ai/run/${modelId}`;

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
          // Workers AI defaults to a small output cap (typically 256
          // tokens), which truncates a multi-segment translation
          // mid-string and produces unparseable JSON. 4096 fits well
          // under llama-3.1-8b-instruct's 8k output ceiling and covers
          // an abstract-sized batch comfortably; a future config knob
          // will make this tunable per-provider.
          max_tokens: 4096,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `[polystella] Workers AI request failed: ${res.status} ${
            res.statusText
          }${text ? `\n${text}` : ""}`,
        );
      }
      const data = (await res.json()) as {
        result?: { response?: unknown };
        success?: boolean;
        errors?: unknown[];
      };
      if (data.success === false) {
        throw new Error(
          `[polystella] Workers AI returned errors: ${JSON.stringify(
            data.errors ?? [],
          )}`,
        );
      }
      const response = data.result?.response;

      // Standard shape: response is the model's raw text. parseResponse
      // strips code fences and parses the JSON downstream.
      if (typeof response === "string") return response;

      // Some WAI models (observed: @cf/qwen/qwen2.5-coder-32b-instruct)
      // detect JSON-output prompts and pre-parse the model's response
      // server-side, returning result.response as an already-parsed
      // object. Round-trip it through JSON.stringify so parseResponse
      // sees a string and can validate the segment-id contract
      // uniformly across providers. This is strictly a win — it
      // sidesteps any code-fence/preamble quirks for those models.
      if (response !== null && typeof response === "object") {
        return JSON.stringify(response);
      }

      // Anything else (null, undefined, number, …) is genuinely
      // unexpected. Dump the envelope so the operator can see what
      // came back; caps at ~800 chars to keep build logs readable.
      const dump = JSON.stringify(data);
      const preview =
        dump.length > 800
          ? `${dump.slice(0, 800)}\n... [truncated, total length ${
              dump.length
            }]`
          : dump;
      throw new Error(
        `[polystella] unexpected Workers AI response shape (model="${modelId}"): result.response missing or of unsupported type "${typeof response}". Raw response was:\n${preview}`,
      );
    },
  };
}

function createAnthropicTranslator(
  provider: AnthropicConfig,
  locale: string,
  fetchImpl: typeof fetch,
): Translator {
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
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `[polystella] Anthropic request failed: ${res.status} ${
            res.statusText
          }${text ? `\n${text}` : ""}`,
        );
      }
      const data = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const textBlock = data.content?.find((b) => b.type === "text");
      const text = textBlock?.text;
      if (typeof text !== "string") {
        throw new Error(
          `[polystella] unexpected Anthropic response shape: no text content block`,
        );
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
}

/**
 * High-level glue: build the prompt, hit the provider, parse the
 * response. The result is a `Map<segmentId, translatedText>` ready to
 * hand to `applyTranslations`.
 *
 * Returns an empty map (and skips the network call) when `segments`
 * is empty — there's nothing to translate, and we shouldn't burn API
 * budget on no-ops.
 */
export async function translateBatch(
  opts: TranslateBatchOptions,
): Promise<Map<string, string>> {
  const {
    translator,
    segments,
    glossary,
    sourceLocale,
    targetLocale,
    context,
  } = opts;
  if (segments.length === 0) return new Map();

  const { systemPrompt, userPrompt } = buildPrompt({
    segments,
    glossary,
    sourceLocale,
    targetLocale,
    context,
  });
  const rawText = await translator.translate(systemPrompt, userPrompt);
  return parseResponse(
    rawText,
    segments.map((s) => s.id),
  );
}
