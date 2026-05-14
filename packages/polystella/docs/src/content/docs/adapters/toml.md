---
title: TOML adapter
description: "Translating structured TOML config: keys, urls, wildcards."
---

The TOML adapter translates structured data files like
`site.toml`, where the source isn't prose but a tree of named
values. The adapter walks the parsed tree and translates exactly
the keys you configure.

## Configuration

```js
toml: {
  keys: {
    "site.toml": ["main.featuredResearch.title", "main.featuredResearch.subtitle"],
    "navigation/*.toml": ["title", "items[*].label"],
  },
  urls: {
    "site.toml": ["main.featuredResearch.link"],
    "navigation/*.toml": ["items[*].href"],
  },
}
```

## Path syntax

Paths are dotted with bracket access:

- `foo` — top-level scalar.
- `foo.bar.baz` — nested scalar.
- `items[0]` — specific array element by index.
- `items[*]` — every element of an array (wildcard).
- `groups[*].items[*].label` — wildcards compose.

Wildcards expand against the parsed structure into a list of
concrete paths at extract time. Concrete paths never contain `*`.

## Round-trip behaviour

The adapter uses `smol-toml` for parsing and stringification. The
stringifier preserves:

- Key order in tables.
- Inline table vs standard table.
- Single-quoted vs double-quoted strings (where it can determine
  the original form).

It does NOT preserve:

- Comments. Translation strips them.
- Trailing whitespace at the end of lines.

If you have TOML files with significant comments, consider whether
they should live in TOML (which is a config format) or in another
format that handles comments better.

## Same-glob `keys` / `urls` conflict

PolyStella errors at config-parse time if the same key path appears
in both `keys` and `urls` for the same glob — that would double-
process the field (translate the URL, then locale-prefix the
already-translated URL).

If you genuinely need both behaviours (rare), use distinct globs:

```js
toml: {
  keys: { "site.toml": ["main.title"] },
  urls: { "site-urls.toml": ["main.link"] },
}
```
