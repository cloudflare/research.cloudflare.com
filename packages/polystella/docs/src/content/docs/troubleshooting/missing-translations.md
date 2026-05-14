---
title: Missing translations
description: Diagnosing when a translated page doesn't render.
---

A page that should be translated isn't showing up under
`/pt-BR/...`. Where to look.

## Check the staging directory

PolyStella stages translated bytes at
`<root>/.astro/i18n-staging/<locale>/<relative-source-path>`. After
a build, look for the expected file there.

- **File missing entirely** — the integration didn't translate the
  file. Likely causes: `include` glob doesn't match; file's path is
  in `exclude`; the source file's frontmatter has `noTranslate: true`.
- **File present** — translation happened, but Astro isn't routing
  to it. Continue below.

## Check the per-locale sibling collection

Translated content is consumed by per-locale sibling collections
named `<source>__<locale>` (e.g. `publications__pt-BR`).

Astro's content collection sync runs after PolyStella stages
files. If the staging directory has the expected file but the
sibling collection doesn't see it, the loader's `base` doesn't
match where PolyStella wrote.

Inspect the generated `content.config.ts` output (or set
`verbose: true` in PolyStella config) to see what's registered.

## Check the route shim

For pages in `routes`, PolyStella generates shims at
`<cacheDir>/polystella-shims/route-N.astro` and injects them via
`injectRoute`. To verify:

```bash
ls .astro/polystella-shims/
```

You should see one shim per `routes` entry × locale set. If a
shim is missing for the route you expected, the route entry
probably doesn't match.

If the shim is present but the page still 404s, the shim's
`getStaticPaths` is generating zero paths. Open the shim file and
look at the source's `getStaticPaths` — it might be returning
empty (e.g. because content collection content isn't loaded yet).

## Check `Astro.locals.getLocalizedEntry`

In your page template:

```astro
---
const entry = await Astro.locals.getLocalizedEntry("publications", slug);
console.log("entry:", entry?.id, entry?.locale, entry?.isLocalized);
---
```

- **`undefined`** — neither the sibling collection nor the source
  has the slug. Check the slug spelling.
- **`isLocalized: false`** — the sibling miss-fell back to source.
  Either the sibling collection doesn't have this entry, OR the
  current locale is the default locale (which always uses source).
- **`isLocalized: true`** — the translated entry is loaded. If the
  page still renders source-language text, the template might be
  reading from the source collection directly somewhere. Search
  for `getEntry("publications", ...)` (the un-localized form) and
  replace with `getLocalizedEntry`.

## Check the build report

`dist/i18n-r2-report.json` after a build summarises every pair.

Look for the entry corresponding to the file × locale that's
missing:

```json
{
  "sourcePath": "publications/foo.md",
  "locale": "pt-BR",
  "outcome": "skipped-no-translate",
  "model": "@cf/meta/llama-3.1-8b-instruct"
}
```

`outcome` values:

- `cache-hit` — translation came from R2 cache.
- `ai-translated` — fresh translation this build.
- `override` — hand-translated override file was used.
- `skipped-no-translate` — source has `noTranslate: true`.
- `skipped-no-translator` — no provider configured.
- `error` — translation failed; `errorMessage` field has detail.

`skipped-no-*` outcomes tell you why a file didn't translate.

## Common gotchas

- **`noTranslate: true` in frontmatter.** Skips the file entirely.
  Configure `noTranslateBehavior: "fallback"` to still serve
  source content at the prefixed URL.
- **File extension not in `include`.** Default is `["**/*.md",
"**/*.mdx"]`. If your file is `.markdown` or somewhere else,
  add it.
- **Source file is in `exclude`.** Check the resolved config.
- **Glob mismatch in `markdown.keys`.** The pipeline translates
  the body, but if `markdown.keys` doesn't list any keys for the
  glob, no frontmatter scalars translate. Check the resolved keys
  for the file's path.

## Still stuck?

Set `verbose: true` in `polystella.config.mjs` and run
`pnpm translate --dry-run` (or `pnpm build` with the integration).
The output shows, per file, exactly what the pipeline decided.
