---
title: Anthropic provider
description: Anthropic Claude as the translation provider.
---

The Anthropic provider routes translation through Anthropic's
Messages API. Useful when the host project wants Claude's
translation quality and is willing to pay for it.

## Configuration

```js
export default {
  provider: {
    kind: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: "claude-3-5-sonnet-latest",
    maxTokens: 8192,
    batchInputTokenBudget: 4000,
  },
};
```

Required: `apiKey`, `model`.

## Models

Same per-locale map pattern as Workers AI:

```js
model: {
  default: "claude-3-5-haiku-latest",
  "ja-JP": "claude-3-5-sonnet-latest",
}
```

The model id is part of the cache key; switching is an explicit
invalidation.

## Cost

Anthropic bills per token at production rates. For a research-site
corpus (~hundreds of files × N locales), expect a single full
translation pass to cost a few dollars. Subsequent builds hit the
R2 cache and cost effectively nothing.

For preview / development workflows, prefer Workers AI as the
provider and reserve Anthropic for builds where quality matters
more than cost — typically the main branch and explicit re-
translation runs.

## Mixing providers

You can only configure one provider per project. To translate the
same content with different providers (e.g. compare Claude and
llama outputs), use distinct `r2.prefix` values for the two runs:

```bash
# llama, writes to i18n/...
WORKERS_CI_BRANCH=main pnpm translate

# claude, writes to claude/i18n/...
POLYSTELLA_CONFIG=polystella.claude.config.mjs pnpm translate
```

This is unusual but supported. The R2 keys distinguish by prefix
so the runs don't collide.
