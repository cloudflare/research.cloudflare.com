---
title: Batching
description: "How translateBatch groups segments into LLM calls; batchInputTokenBudget."
---

For small files the translator processes the entire file in a
single LLM call. For larger files PolyStella splits segments into
batches that fit under `batchInputTokenBudget`.

## Why batch

Two reasons split is preferable to "one giant call":

1. **Output truncation.** Models have a per-call output token cap.
   A 50-page document with all segments in one call exceeds the
   cap; the model truncates and PolyStella has to throw away the
   partial output.
2. **Retry granularity.** If one segment fails (token-preservation
   mismatch, hallucinated id), the retry budget is per-batch.
   Splitting limits the blast radius.

## How batches are formed

Segments arrive from the adapter's `extractSegments` step in
document order. The pipeline:

1. Groups segments by structural boundary. For Markdown, the
   grouping is **heading-anchored** — a heading starts a new
   group, so a "natural section" of body text translates together
   even if the file is long.
2. Walks groups in order, packing them into batches under the
   `batchInputTokenBudget` ceiling.
3. Each batch carries its own **document-context block** — the
   source-language values of `markdown.contextKeys` (typically
   `title`, `excerpt`). This keeps terminology consistent across
   batches even when the file is split.

The token count is approximated by `text.length / 4`; this is rough
but conservative enough that real-world batches don't exceed the
provider's cap.

## Tuning `batchInputTokenBudget`

Default: 4000.

- **Smaller** (e.g. 2000): more, smaller batches. Better retry
  granularity. Marginally higher per-build cost (more LLM calls).
  More LLM round-trips → slightly slower builds.
- **Larger** (e.g. 8000): fewer, larger batches. Less retry
  granularity (a token-mismatch error blows away a bigger chunk
  of work). Marginally cheaper builds.

The default 4000 is a deliberate compromise. Tune it if profiling
shows a specific bottleneck; the value isn't sacred.

## Cache implications

Batching is invisible to the cache. The cache key is over the whole
source file. A file translated in three batches produces the same
R2 entry as a file translated in one batch — the batch boundaries
are a runtime concern, not a content-addressing one.

This also means **changing `batchInputTokenBudget` doesn't
invalidate the cache**. The next build re-batches but every cache
key matches.

## Document context

The per-batch context block is built from
`markdown.contextKeys[<glob>]`'s values:

```js
markdown: {
  keys: { "publications/**": ["title", "abstract"] },
  contextKeys: { "publications/**": ["title", "abstract"] },
}
```

With this config, every batch translating a `publications/*` file
gets a system-prompt prefix like:

```text
You are translating sections of a longer document. Context:
- Title: "Quantum advantage in shallow circuits"
- Abstract: "We demonstrate a separation between..."

Maintain consistent terminology across sections.
```

`contextKeys` is **NOT** in the cache hash. Adding or removing a
`contextKeys` entry doesn't invalidate existing translations; they
keep using their original (or no) context until natural body-edit
turnover re-translates them. The trade-off is intentional —
context tuning shouldn't cost a full retranslation.

See ARCHITECTURE.md `#translation-batching` for the implementation
detail.
