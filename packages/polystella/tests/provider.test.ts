import { describe, expect, it, vi } from "vitest";
import type { Segment } from "../src/parsing/extract.js";
import { EMPTY_GLOSSARY } from "../src/glossary/glossary.js";
import { createTranslator, resolveModelId, translateBatch, type Translator } from "../src/translation/provider.js";

/**
 * Build a fetch stub that returns a single canned response. Each test
 * builds its own so we can assert on the request and tailor the
 * response without state leaking between cases.
 */
function makeFetchStub(body: unknown, init: { status?: number; statusText?: string; rawText?: string } = {}) {
  const responseBody = init.rawText ?? JSON.stringify(body);
  return vi.fn().mockResolvedValue(
    new Response(responseBody, {
      status: init.status ?? 200,
      statusText: init.statusText ?? "OK",
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("resolveModelId", () => {
  it("returns a string spec verbatim", () => {
    expect(resolveModelId("@cf/meta/llama-3.1-8b-instruct", "pt-BR")).toBe("@cf/meta/llama-3.1-8b-instruct");
  });

  it("looks up the locale in a per-locale map", () => {
    expect(
      resolveModelId(
        {
          default: "@cf/meta/llama-3.1-8b-instruct",
          "ja-JP": "@cf/qwen/qwen2.5-7b-instruct",
        },
        "ja-JP",
      ),
    ).toBe("@cf/qwen/qwen2.5-7b-instruct");
  });

  it("falls back to `default` when the locale is missing from the map", () => {
    expect(
      resolveModelId(
        {
          default: "@cf/meta/llama-3.1-8b-instruct",
          "ja-JP": "@cf/qwen/qwen2.5-7b-instruct",
        },
        "pt-BR",
      ),
    ).toBe("@cf/meta/llama-3.1-8b-instruct");
  });
});

describe("createTranslator", () => {
  it("constructs a Workers AI translator that exposes the resolved model id", () => {
    const t = createTranslator(
      {
        kind: "workers-ai",
        accountId: "acct",
        apiToken: "tok",
        model: "@cf/meta/llama-3.1-8b-instruct",
        maxTokens: 8192,
      },
      "pt-BR",
      { fetchImpl: makeFetchStub({}) },
    );
    expect(t.modelId).toBe("@cf/meta/llama-3.1-8b-instruct");
  });

  it("constructs an Anthropic translator that exposes the resolved model id", () => {
    const t = createTranslator(
      {
        kind: "anthropic",
        apiKey: "sk-ant-test",
        model: "claude-3-5-haiku-latest",
        maxTokens: 8192,
      },
      "pt-BR",
      { fetchImpl: makeFetchStub({}) },
    );
    expect(t.modelId).toBe("claude-3-5-haiku-latest");
  });

  it("throws on an unknown provider kind", () => {
    expect(() => createTranslator({ kind: "unknown" } as unknown as Parameters<typeof createTranslator>[0], "pt-BR")).toThrow(
      /unknown provider kind/,
    );
  });
});

describe("Workers AI translator", () => {
  const provider = {
    kind: "workers-ai" as const,
    accountId: "ACCT",
    apiToken: "TOKEN",
    model: "@cf/meta/llama-3.1-8b-instruct",
    maxTokens: 8192,
  };

  it("POSTs to the run endpoint with bearer auth and a chat-style body", async () => {
    const fetchStub = makeFetchStub({
      result: { response: "OK" },
      success: true,
    });
    const t = createTranslator(provider, "pt-BR", { fetchImpl: fetchStub });
    await t.translate("system", "user");

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0]!;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/ACCT/ai/run/@cf/meta/llama-3.1-8b-instruct");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer TOKEN");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "user" },
      ],
    });
    // max_tokens must be set high enough to fit a real translation
    // batch — Workers AI's default truncates mid-response otherwise.
    expect(typeof body.max_tokens).toBe("number");
    expect(body.max_tokens).toBeGreaterThanOrEqual(2048);
  });

  it("uses a custom endpoint when provider.endpoint is set", async () => {
    const fetchStub = makeFetchStub({
      result: { response: "OK" },
      success: true,
    });
    const t = createTranslator({ ...provider, endpoint: "https://gateway.example/run" }, "pt-BR", { fetchImpl: fetchStub });
    await t.translate("s", "u");
    expect(fetchStub.mock.calls[0]![0]).toBe("https://gateway.example/run");
  });

  it("returns the result.response text", async () => {
    const fetchStub = makeFetchStub({
      result: { response: "model output" },
      success: true,
    });
    const t = createTranslator(provider, "pt-BR", { fetchImpl: fetchStub });
    expect(await t.translate("s", "u")).toBe("model output");
  });

  it("throws on HTTP failure with status info", async () => {
    const fetchStub = makeFetchStub(
      {},
      {
        status: 500,
        statusText: "Internal Server Error",
        rawText: "boom",
      },
    );
    const t = createTranslator(provider, "pt-BR", { fetchImpl: fetchStub });
    await expect(t.translate("s", "u")).rejects.toThrow(/Workers AI request failed: 500 Internal Server Error/);
  });

  it("throws when success === false", async () => {
    const fetchStub = makeFetchStub({
      result: null,
      success: false,
      errors: [{ message: "auth failed" }],
    });
    const t = createTranslator(provider, "pt-BR", { fetchImpl: fetchStub });
    await expect(t.translate("s", "u")).rejects.toThrow(/Workers AI returned errors/);
  });

  it("throws when the response shape is unexpected", async () => {
    const fetchStub = makeFetchStub({ result: {}, success: true });
    const t = createTranslator(provider, "pt-BR", { fetchImpl: fetchStub });
    await expect(t.translate("s", "u")).rejects.toThrow(/unexpected Workers AI response shape/);
  });

  it("accepts an already-parsed-object response and stringifies it", async () => {
    // Some WAI models (e.g. qwen2.5-coder-32b-instruct) auto-parse the
    // model's JSON output server-side and return result.response as an
    // object. The translator must round-trip it back through
    // JSON.stringify so parseResponse downstream can validate it.
    const parsedPayload = {
      "fm:title": "ある古い暗号化への謝罪",
      "body:0": "ご**迷惑**をおかけして申し訳ありません。",
    };
    const fetchStub = makeFetchStub({
      result: { response: parsedPayload, tool_calls: [], usage: {} },
      success: true,
    });
    const t = createTranslator(provider, "ja-JP", { fetchImpl: fetchStub });
    const out = await t.translate("s", "u");
    expect(typeof out).toBe("string");
    expect(JSON.parse(out)).toEqual(parsedPayload);
  });

  it("includes the probed-locations message and dump in the unexpected-shape error", async () => {
    // None of the known shapes hold a usable string/object: legacy
    // `result.response` is 42 (number), and there's no chat-completion
    // shape either. The error should call out which fields we tried.
    const fetchStub = makeFetchStub({
      result: { response: 42 },
      success: true,
    });
    const t = createTranslator(provider, "pt-BR", { fetchImpl: fetchStub });
    await expect(t.translate("s", "u")).rejects.toThrow(
      /none of result\.response, result\.choices\[0\]\.message\.content, or choices\[0\]\.message\.content held a usable string or object.*"response":42/s,
    );
  });

  it("accepts the OpenAI-compatible chat-completion shape (qwen3-30b-a3b-fp8 etc.)", async () => {
    // Newer Workers AI models (observed: @cf/qwen/qwen3-30b-a3b-fp8)
    // return responses in the OpenAI chat-completion envelope rather
    // than the legacy `result.response` field. The translator must
    // recognise both shapes — operators upgrading models shouldn't
    // get cryptic "unsupported type undefined" errors.
    const translatedJson = JSON.stringify({
      "fm:title": "ハイブリッド公開鍵暗号",
      "body:0": "このドキュメントでは、HPKEを説明します。",
    });
    const fetchStub = makeFetchStub({
      result: {
        id: "chatcmpl-abc",
        object: "chat.completion",
        created: 1777896071,
        model: "@cf/qwen/qwen3-30b-a3b-fp8",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: translatedJson,
              refusal: null,
              tool_calls: [],
            },
          },
        ],
      },
      success: true,
    });
    const t = createTranslator(provider, "ja-JP", { fetchImpl: fetchStub });
    const out = await t.translate("s", "u");
    expect(typeof out).toBe("string");
    expect(JSON.parse(out)).toEqual({
      "fm:title": "ハイブリッド公開鍵暗号",
      "body:0": "このドキュメントでは、HPKEを説明します。",
    });
  });

  it("accepts a top-level `choices` array (gateway-flattened envelope)", async () => {
    // Some gateway configurations strip the `result` wrapper and
    // surface `choices` at the top level. We probe that location too
    // as a defensive fallback before raising the unknown-shape error.
    const translatedJson = '{"fm:title": "テスト"}';
    const fetchStub = makeFetchStub({
      choices: [
        {
          message: { role: "assistant", content: translatedJson },
        },
      ],
      success: true,
    });
    const t = createTranslator(provider, "ja-JP", { fetchImpl: fetchStub });
    const out = await t.translate("s", "u");
    expect(JSON.parse(out)).toEqual({ "fm:title": "テスト" });
  });

  it("accepts a parsed-object content in the chat-completion shape", async () => {
    // If a model + gateway combination ever auto-parses the JSON
    // server-side under the chat-completion envelope, the translator
    // should round-trip via JSON.stringify just like for the legacy
    // shape. Symmetry across both response paths.
    const fetchStub = makeFetchStub({
      result: {
        choices: [
          {
            message: {
              role: "assistant",
              content: { "fm:title": "テスト", "body:0": "本文" },
            },
          },
        ],
      },
      success: true,
    });
    const t = createTranslator(provider, "ja-JP", { fetchImpl: fetchStub });
    const out = await t.translate("s", "u");
    expect(JSON.parse(out)).toEqual({ "fm:title": "テスト", "body:0": "本文" });
  });

  it("prefers legacy `result.response` over chat-completion when both are present", async () => {
    // If a payload contains both shapes (defensive — shouldn't happen
    // in practice), prefer the legacy field. This keeps behaviour
    // stable for any model still using the original envelope even if
    // the gateway also surfaces a stub `choices` array.
    const fetchStub = makeFetchStub({
      result: {
        response: '{"fm:title": "legacy"}',
        choices: [{ message: { content: '{"fm:title": "should-be-ignored"}' } }],
      },
      success: true,
    });
    const t = createTranslator(provider, "ja-JP", { fetchImpl: fetchStub });
    const out = await t.translate("s", "u");
    expect(JSON.parse(out)).toEqual({ "fm:title": "legacy" });
  });
});

describe("Anthropic translator", () => {
  const provider = {
    kind: "anthropic" as const,
    apiKey: "sk-ant-test",
    model: "claude-3-5-haiku-latest",
    maxTokens: 8192,
  };

  it("POSTs to /v1/messages with the documented headers and body", async () => {
    const fetchStub = makeFetchStub({
      content: [{ type: "text", text: "OK" }],
    });
    const t = createTranslator(provider, "pt-BR", { fetchImpl: fetchStub });
    await t.translate("system", "user");

    const [url, init] = fetchStub.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      model: "claude-3-5-haiku-latest",
      system: "system",
      messages: [{ role: "user", content: "user" }],
    });
    expect(typeof body.max_tokens).toBe("number");
  });

  it("returns the text from the first text content block", async () => {
    const fetchStub = makeFetchStub({
      content: [
        { type: "tool_use", id: "x" },
        { type: "text", text: "translated" },
      ],
    });
    const t = createTranslator(provider, "pt-BR", { fetchImpl: fetchStub });
    expect(await t.translate("s", "u")).toBe("translated");
  });

  it("throws on HTTP failure", async () => {
    const fetchStub = makeFetchStub(
      {},
      {
        status: 401,
        statusText: "Unauthorized",
      },
    );
    const t = createTranslator(provider, "pt-BR", { fetchImpl: fetchStub });
    await expect(t.translate("s", "u")).rejects.toThrow(/Anthropic request failed: 401 Unauthorized/);
  });

  it("throws when the response has no text content", async () => {
    const fetchStub = makeFetchStub({
      content: [{ type: "tool_use", id: "x" }],
    });
    const t = createTranslator(provider, "pt-BR", { fetchImpl: fetchStub });
    await expect(t.translate("s", "u")).rejects.toThrow(/unexpected Anthropic response shape/);
  });
});

describe("translateBatch", () => {
  const segments: Segment[] = [
    { id: "fm:title", text: "An apology" },
    { id: "body:0", text: "We **regret** any inconvenience." },
  ];

  it("returns an empty map (and never calls the translator) for zero segments", async () => {
    const fakeTranslator: Translator = {
      modelId: "test",
      translate: vi.fn().mockResolvedValue(""),
    };
    const out = await translateBatch({
      translator: fakeTranslator,
      segments: [],
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(out.size).toBe(0);
    expect(fakeTranslator.translate).not.toHaveBeenCalled();
  });

  it("orchestrates buildPrompt → translate → parseResponse and returns the parsed map", async () => {
    const markerResponse = [
      "@@fm:title@@",
      "Um pedido de desculpas",
      "",
      "@@body:0@@",
      "Pedimos **desculpas** por qualquer inconveniência.",
    ].join("\n");
    const fakeTranslator: Translator = {
      modelId: "test",
      translate: vi.fn().mockResolvedValue(markerResponse),
    };
    const out = await translateBatch({
      translator: fakeTranslator,
      segments,
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(out.get("fm:title")).toBe("Um pedido de desculpas");
    expect(out.get("body:0")).toBe("Pedimos **desculpas** por qualquer inconveniência.");
    expect(fakeTranslator.translate).toHaveBeenCalledTimes(1);
    const [systemPrompt, userPrompt] = (fakeTranslator.translate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(systemPrompt).toMatch(/professional translator/);
    expect(userPrompt).toMatch(/@@fm:title@@/);
  });

  it("propagates errors from a strict response parse", async () => {
    const fakeTranslator: Translator = {
      modelId: "test",
      translate: vi.fn().mockResolvedValue("not a marker-delimited response"),
    };
    await expect(
      translateBatch({
        translator: fakeTranslator,
        segments,
        glossary: EMPTY_GLOSSARY,
        sourceLocale: "en",
        targetLocale: "pt-BR",
      }),
    ).rejects.toThrow(/no segment markers in the model response/);
  });
});
