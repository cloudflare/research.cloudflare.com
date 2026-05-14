---
title: Permanent errors
description: PermanentProviderError vs retriable failures — how the retry loop decides.
---

When a provider call fails, PolyStella has to decide: retry, or
give up? The `PermanentProviderError` class encodes that decision.

## The class

Exported from `polystella` as a named export:

```ts
import { PermanentProviderError } from "polystella";
```

Both built-in providers (`workers-ai`, `anthropic`) throw it from
their `translate(...)` method on specific HTTP statuses.

## Which statuses are "permanent"

| HTTP status | Classification | Reasoning                                                                                          |
| ----------- | -------------- | -------------------------------------------------------------------------------------------------- |
| 401         | Permanent      | Auth failure. Retries with the same credentials will fail the same way.                            |
| 403         | Permanent      | Forbidden — wrong account, wrong model permission, gated feature. Retry won't fix.                 |
| 404         | Permanent      | Model id is wrong (or revoked). Retry against the same id will fail.                               |
| 422         | Permanent      | Request shape rejected at validation. Retries with the same body will fail.                        |
| 408         | Retriable      | Timeout. Backoff before retry.                                                                     |
| 425, 429    | Retriable      | Rate-limited / too-early. Backoff before retry.                                                    |
| 5xx         | Retriable      | Server-side error. Backoff before retry.                                                           |
| Other 4xx   | Retriable      | Default — but if the request body is permanently bad, retries won't help. Caller sees the failure. |

## What the retry loop does

PolyStella uses `p-retry` for the translator retry loop:

```ts
await pRetry(() => translator.translate(prompt), {
  retries: maxRetries, // default 2 → up to 3 attempts
  factor: 2,
  randomize: true,
  shouldRetry: (err) => !(err instanceof PermanentProviderError),
});
```

If `translator.translate(...)` throws a `PermanentProviderError`,
the retry loop short-circuits and propagates the error. The build
fails fast.

For any other error (network drop, 5xx, malformed model output that
the parser rejects), the retry loop backs off and tries again. The
backoff is exponential with jitter to avoid thundering-herd against
the provider.

## When you'd write your own

If you implement a custom provider (rare; the two built-in
providers cover the common cases), throw `PermanentProviderError`
for any failure that retries can't fix:

```ts
async translate(prompt) {
  const res = await fetch(this.endpoint, { ... });
  if (res.status === 401) {
    throw new PermanentProviderError("authentication failed");
  }
  if (!res.ok) {
    throw new Error(`provider error ${res.status}: ${await res.text()}`);
  }
  return await res.text();
}
```

The retry loop sees `PermanentProviderError` and stops. Anything
else gets retried.

## AbortSignal

Independently of the permanent/retriable distinction, every
translator call respects an `AbortSignal`. Hitting Ctrl-C during a
build aborts in-flight provider calls cleanly. See ARCHITECTURE.md
`#abortsignal` for the threading model.
