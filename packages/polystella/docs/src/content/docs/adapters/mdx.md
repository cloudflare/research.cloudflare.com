---
title: MDX adapter
description: "Translating .mdx files — what's supported and what's not."
---

The MDX adapter reuses most of the Markdown adapter's logic but
parses with `remark-mdx` to recognise JSX and ESM constructs.

## What translates

Same as Markdown:

- Frontmatter scalars for keys listed in `markdown.keys` (the
  config is shared between `.md` and `.mdx`; the adapter just
  registers under both extensions).
- Body inline text inside paragraphs, headings, lists, table cells.

## What stays verbatim

- **ESM imports/exports** at the top of the file.
- **JSX component invocations** — `<MyComponent prop="value" />`
  is preserved entirely. The model doesn't see component names,
  props, or attribute values.
- **Expressions** — `{frontmatter.title}`, `{1 + 1}`, etc. Treated
  as opaque.
- **Code blocks, fences, raw HTML** — same as `.md`.

## What's NOT supported

JSX **children** are currently preserved as opaque markup, not
translated. If you have:

```mdx
<Callout type="warning">This page is in beta. Some sections may be incomplete.</Callout>
```

…the text inside `<Callout>` doesn't go to the translator. The
component's children are part of the JSX subtree, not a markdown
paragraph.

Workarounds today:

- Move translatable copy to frontmatter (`metaDescription`-style
  fields) and have the component pull it from there.
- Move translatable copy to the UI-strings JSON and have the
  component pull it via `t()`.
- Or pull it out of the component entirely — write it as plain
  markdown and have the component wrap surrounding context.

JSX-child translation is on the roadmap but the model contract is
non-trivial (you need to preserve component boundaries while
translating children) and there's no clear "right answer" yet.

## Practical guidance

For an MDX-heavy docs site, the most common pattern is:

- Plain markdown for prose-heavy pages.
- MDX for pages with significant component composition, where the
  components own their own translatable strings via the UI-strings
  JSON.

Mixing the two within one page works but produces fewer translation
points than a pure-markdown page; the AI marker still applies to
the file as a whole.
