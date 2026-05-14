---
title: AI marker
description: The aiTranslated frontmatter fields baked into every translated file.
---

Every AI-translated file gets three frontmatter fields added during
the apply step:

```yaml
aiTranslated: true
aiTranslationModel: "@cf/meta/llama-3.1-8b-instruct"
aiTranslatedAt: "2025-04-12T14:23:01.000Z"
```

These are the **AI marker**. They sit alongside any frontmatter
your source file declared.

## Why bake it into the staged file

The marker is part of the staged bytes, not metadata sitting
somewhere else. That makes three things straightforward:

- **Display in the UI.** Page templates can read
  `entry.data.aiTranslated` and surface an "Auto-translated by AI"
  badge to the reader.
- **Audit trails.** Diffing two builds' staging directories shows
  the model and timestamp; correlating with the build report gives
  full provenance.
- **Cache-safe.** The marker is baked in BEFORE the R2 PUT, so
  cache hits return the marker verbatim. There's no separate path
  for "translated bytes" vs "translated metadata".

## What gets set when

- **`aiTranslated`** — always `true` for AI output. Overrides also
  receive `aiTranslated: false` on the staged file so consumer
  schemas can distinguish (the override is hand-written; the marker
  reflects that).
- **`aiTranslationModel`** — the resolved model id at translation
  time. Different from a fresh build because the model id is part
  of the cache key (a model bump triggers re-translation; the
  marker reflects the new model).
- **`aiTranslatedAt`** — ISO-8601 timestamp at the moment the
  translator was invoked. On a cache hit this stays pinned to the
  original translation time; on a miss it updates.

## Source-content marker

If your **source** file declares `aiTranslated: true` in
frontmatter, PolyStella respects it: the AI marker on the staged
output reflects what the AI produced for that build. Sources don't
usually declare this; it'd be unusual.

If your source declares any of the three marker fields with
different values, the staged version's marker fields override them
— the AI translation generated those bytes, so the marker has to
reflect that.

## Schema extension

When you register source collections via `polystellaCollections`,
the helper automatically extends the schema to include the optional
marker fields:

```ts
// What you declare:
publications: defineCollection({
  schema: z.object({
    title: z.string(),
    abstract: z.string(),
  }),
});

// What the per-locale sibling collections see:
publications__pt_BR: defineCollection({
  schema: z.object({
    title: z.string(),
    abstract: z.string(),
    aiTranslated: z.boolean().optional(),
    aiTranslationModel: z.string().optional(),
    aiTranslatedAt: z.string().optional(),
  }),
});
```

This means you don't have to add the marker fields to your source
schema manually. The helper handles it.

## Using the marker in templates

```astro
---
const { getLocalizedEntry } = Astro.locals;
const entry = await getLocalizedEntry("publications", Astro.params.slug);
---

{entry?.data.aiTranslated && (
  <p class="ai-translation-notice">
    This page was automatically translated by AI on
    {new Date(entry.data.aiTranslatedAt!).toLocaleDateString()}.
  </p>
)}
```

The `LocalizedEntry` shape also includes the `isLocalized` /
`locale` extension fields PolyStella adds on top of Astro's entry
shape; see [Runtime API → Astro.locals](/runtime-api/locals/).
