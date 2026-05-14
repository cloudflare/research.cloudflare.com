---
title: Glossaries
description: Per-locale YAML files that pin do-not-translate terms, preferred translations, and style rules.
---

A glossary tells the translator how to handle terminology that
shouldn't drift between builds. Brand names that stay in English.
Technical terms with a preferred per-locale rendering. Style rules
that apply to a whole locale (formality, capitalisation
conventions).

## File layout

Configured via `glossary.file` in `polystella.config.mjs`:

```js
export default {
  glossary: {
    file: "./i18n/glossary/{locale}.yaml",
  },
};
```

The `{locale}` placeholder is mandatory. PolyStella reads one file
per non-default locale.

A typical glossary:

```yaml
# i18n/glossary/pt-BR.yaml
version: "2025-04-01"

doNotTranslate:
  - Cloudflare
  - Workers
  - PolyStella

preferredTranslations:
  research: pesquisa
  paper: artigo

notes: |
  Use Brazilian Portuguese conventions throughout. Numeric
  conventions follow ABNT (e.g. "1,5" not "1.5").

styleRules:
  - category: formality
    instruction: Use the formal "você" address consistently.
  - category: numerals
    instruction: Write small numbers as words (e.g. "três" not "3")
                 when they appear in body prose.
    example: "três experimentos" not "3 experimentos"
```

## How edits propagate

The glossary hash is part of the cache key. When you edit a
glossary file:

1. PolyStella re-hashes the glossary for that locale.
2. Every cached translation for that locale is invalidated.
3. The next build retranslates the affected pages.

In practice the cost is bounded — the hash includes the entire
glossary file content, so adding one term retranslates every page
that mentions that locale, but the translations all still go
through R2 and cache hit on the second build.

## Inline glossaries

For one-off projects or testing:

```js
export default {
  glossary: {
    inline: {
      "pt-BR": {
        doNotTranslate: ["Cloudflare"],
        notes: "Use Brazilian Portuguese.",
      },
    },
  },
};
```

The inline form is identical in semantics to the file form; the
hash includes the inline object's stable JSON serialisation.

## Notes vs style rules

Two free-form text fields with subtly different purposes:

- **`notes`** is a single string. Read by the model once at the
  top of the system prompt. Good for "use this dialect", "the
  audience is academic".
- **`styleRules`** is a list of `{ category, instruction, example? }`
  objects. Each rule reads as a separate constraint to the model
  and is more easily honoured for specific rules. Good for things
  like "always use the formal address", "expand abbreviations".

When in doubt, use `styleRules` — the structure helps the model
follow specific rules more reliably than a long `notes` block.
