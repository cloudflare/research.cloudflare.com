---
title: Workers AI provider
description: Cloudflare Workers AI as the translation provider.
---

The Workers AI provider routes translation through Cloudflare's
Workers AI inference platform. It's the default choice when the
host project is itself a Cloudflare site.

## Configuration

```js
// polystella.config.mjs
export default {
  provider: {
    kind: "workers-ai",
    accountId: process.env.CF_ACCOUNT_ID,
    apiToken: process.env.CF_API_TOKEN,
    model: "@cf/meta/llama-3.1-8b-instruct",
    maxTokens: 8192,
    batchInputTokenBudget: 4000,
  },
};
```

Required: `accountId`, `apiToken`, `model`. The rest have sensible
defaults.

## Models

The model id is part of the cache key. Switching models is an
explicit cache invalidation. For per-locale model selection (e.g.
larger model for CJK locales):

```js
model: {
  default: "@cf/meta/llama-3.1-8b-instruct",
  "ja-JP": "@cf/qwen/qwen3-30b-a3b-fp8",
  "zh-CN": "@cf/qwen/qwen3-30b-a3b-fp8",
}
```

The `default` key is consulted for any locale not in the map.

## Endpoint override

For AI Gateway proxying:

```js
endpoint: "https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/workers-ai/run",
```

The endpoint is template-substituted at request time; account /
model identifiers are URL-path components in Workers AI's native
API.

## Token budgets

- **`maxTokens`** — max output tokens per call. Workers AI's
  default is ~256, which truncates multi-segment translations.
  PolyStella's default of 8192 fits under llama-3.1-8b's cap.
- **`batchInputTokenBudget`** — soft cap on per-batch input tokens.
  The pipeline groups adapter segments into batches that fit under
  this budget. See [Providers → Batching](/providers/batching/).

## Permanent vs retriable errors

Workers AI returns three classes of HTTP error PolyStella treats
differently:

- **401, 403, 404, 422** — permanent. `PermanentProviderError`
  short-circuits the retry loop. Fix your credentials / model id
  and rerun.
- **429, 500, 502, 503, 504** — retriable. `p-retry` retries with
  exponential backoff and jitter.
- **Other 4xx (e.g. 400)** — treated as retriable by default. If
  the request shape is malformed, retries won't help; PolyStella
  logs the response body and exits non-zero.

See [Providers → Permanent errors](/providers/permanent-errors/)
for the contract.
