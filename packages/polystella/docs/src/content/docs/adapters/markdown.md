---
title: Markdown adapter
description: "Translating .md files: frontmatter keys, body inline text, internal links."
---

The Markdown adapter handles `.md` files via `remark-parse` plus
`remark-frontmatter` and `remark-gfm`. It's the default adapter
and the most-used in practice.

## What it translates

- **Frontmatter scalar values** for keys listed in
  `markdown.keys[<glob>]`. The adapter walks the YAML frontmatter
  and pulls out the matching scalars; everything else (dates,
  booleans, numbers, arrays of non-strings) passes through
  verbatim.
- **Body inline text** — every text node inside paragraphs,
  headings, lists, blockquotes, and table cells. Inline formatting
  (`**bold**`, `_italic_`, `` `code` ``, `[link](url)`) is preserved
  via byte-splice; only the text content goes to the model.

## What it doesn't translate

- **Code blocks** (fenced or indented). Verbatim.
- **HTML blocks** raw in markdown. Verbatim.
- **YAML keys themselves.** Only values listed in
  `markdown.keys[<glob>]`.
- **URL targets.** The text of `[text](url)` is translated; the
  `url` is not. URL rewriting is a separate post-cache step.

## Configuration

```js
markdown: {
  keys: {
    "publications/**": ["title", "metaDescription"],
    "blog/**": ["title", "excerpt", "tags"],
  },
  urls: {
    "publications/**": ["heroImage"],
  },
  contextKeys: {
    "publications/**": ["title", "abstract"],
  },
}
```

- **`keys`** — frontmatter scalars to translate.
- **`urls`** — frontmatter URL keys to locale-prefix at staging
  (e.g. `heroImage: /images/...` becomes `heroImage: /pt-BR/images/...`).
- **`contextKeys`** — frontmatter scalars whose source-language
  values are inserted as topical framing in the per-batch document-
  context block. Used to keep terminology consistent across batches
  for long documents. May overlap with `keys`.

## Body link rewriting

Independently of frontmatter URL rewriting, the adapter rewrites
inline markdown links (`[text](/internal/path)`) at staging time.
External URLs (`https://...`, `mailto:`), anchor-only URLs (`#foo`),
and paths matching `noPrefixUrls` are left alone.

This means a single source paragraph:

```markdown
See the [paper](/publications/Davidson2018) for context.
```

Becomes, in the pt-BR staging file:

```markdown
Veja o [artigo](/pt-BR/publications/Davidson2018) para contexto.
```

The model translated "See the … for context" and "paper"; the URL
was locale-prefixed by the post-cache rewriter without involving
the AI.

## Round-trip guarantee

The adapter is byte-stable: parsing a source file, extracting
segments, and applying an empty translation map produces output
identical to the input. This is what makes the unit-test suite's
`round-trip.test.ts` possible — every publication in the host
corpus survives `parse → extract → apply(empty) → stringify`.

## See also

- [Adapter contract in ARCHITECTURE.md](https://github.com/cloudflare/polystella/blob/main/ARCHITECTURE.md#adapter-contract)
  — the interface every adapter implements.
