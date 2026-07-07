# PolyStella

[PolyStella](https://github.com/cloudflare/polystella) is the `@cloudflare/polystella` Astro integration used by this site for locale-aware content and UI-string translation.

The source of truth remains the English content in `content/` and `src/content/i18n/en-US.json`. PolyStella translates configured fields with Workers AI, caches translated output in R2, and stages localized content during Astro builds.

## Do I Need To Care About This?

Usually, no. If you are only adding or editing English content in `content/`, you can use the normal development workflow:

```sh
pnpm dev
pnpm build
```

Local builds are safe by default: they run PolyStella in dry-run/read-only mode, do not call Workers AI, and do not write to R2. You do not need translation credentials for normal English content changes.

You should read this document when you are:

- Editing UI copy, navigation, notices, buttons, or other shared components that render on localized pages
- Adding visible English strings to Astro or React components; those should usually use the UI-string dictionaries instead of hard-coded text
- Changing `src/content/i18n/en-US.json` or any other UI-string locale file
- Adding or changing locales in `astro.config.mjs`
- Changing translation config, content collection wiring, localized routes, layout CSS, glossaries, or manual overrides
- Running `pnpm translate`, `pnpm translate:build`, or `pnpm i18n:translate`
- Reviewing generated translations or preparing a production translation update

If you add a new content field or collection that should be translated, update `polystella.config.mjs` so PolyStella knows which fields are translatable and which URL fields need locale-aware rewriting.

## What Gets Translated

PolyStella translates these source files and fields:

| Source                          | Translated fields                                                               |
| :------------------------------ | :------------------------------------------------------------------------------ |
| `content/publications/**/*.md`  | `title`, `metaDescription`, `related_interests`, body content                   |
| `content/pages/**/*.mdx`        | `title`, body content                                                           |
| `content/people/**/*.md`        | `position`, body content                                                        |
| `content/tags/**/*.md`          | `name`, `description`, body content                                             |
| `content/presentations/**/*.md` | `title`, `related_interests`, body content                                      |
| `content/site.toml`             | featured research title, description, button label, and localized internal link |
| Remote blog feed                | `title`, `excerpt`; links still point to `cloudflare.com`                       |
| `src/content/i18n/*.json`       | UI strings used by navigation, notices, buttons, and labels                     |

The exact field configuration lives in [`polystella.config.mjs`](./polystella.config.mjs). Content collections are wired through [`src/content.config.ts`](./src/content.config.ts).

## Normal Local Development

Use the normal Astro commands for routine content and UI work:

```sh
pnpm dev
pnpm build
```

Local builds run PolyStella in dry-run/read-only mode by default. They can read cached production translations, but they do not call Workers AI or write to R2. This keeps normal development safe and avoids spending translation quota.

To explicitly run translation as part of a local build:

```sh
pnpm translate:build
```

That command sets `POLYSTELLA_TRANSLATE=1` for the build. Translated bytes are still staged locally; local builds do not write to R2.

## Content Translation Commands

Preview what PolyStella would translate:

```sh
pnpm translate:dry
```

Run the standalone translation pipeline:

```sh
pnpm translate
```

The standalone CLI is the explicit path that can write translation cache entries to R2 outside CI. On `main`, it writes under `i18n/`; on other branches, it writes under `previews/<branch>/i18n/` and falls back to production cache entries on misses.

First-time content translation, or translation after a hash-affecting change such as glossary, prompt, parser, or config updates, can take a long time because this site has a large content corpus. For large translation refreshes, prefer running `pnpm translate` first so the R2 cache is populated before relying on an Astro build. If translation happens during a CI/build run and the build times out or fails partway through, restart it; already completed translations remain cached, so the next run continues from the remaining uncached work and will eventually complete.

Run this for the full CLI help:

```sh
pnpm translate --help
```

## UI String Workflow

UI strings live in [`src/content/i18n`](./src/content/i18n). Edit English first:

```text
src/content/i18n/en-US.json
```

Then reconcile and translate other locales:

```sh
pnpm i18n:translate
```

Check for drift:

```sh
pnpm i18n:check
```

`pnpm i18n:check` is offline and runs from the pre-commit hook whenever staged files under `src/content/i18n/` change.

Use this when you only want to add missing keys and remove stale keys without filling translations:

```sh
pnpm i18n:sync
```

## Credentials

Translation-producing commands require Cloudflare credentials in the environment:

```sh
CF_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
WORKERS_AI_API_TOKEN=
```

Normal `pnpm dev`, `pnpm build`, and `pnpm i18n:check` do not need translation credentials.

## Glossaries

Per-locale terminology lives in:

```text
i18n/glossaries/{locale}.yaml
```

Edit a glossary when a term should be translated consistently or must remain untranslated. Glossary contents are hashed into translation cache keys, so changing a glossary invalidates only the affected locale's translations.

## Manual Overrides

Manual translations override machine-generated output. Put them under:

```text
i18n/overrides/{locale}/...
```

Mirror the source path under the locale directory. For example:

```text
i18n/overrides/pt-BR/publications/example.md
i18n/overrides/ja-JP/pages/philosophy.mdx
```

Use overrides for high-visibility pages, legal/product-sensitive phrasing, or places where native review decides the machine translation should not be used.

## Adding Or Changing Locales

Locales are declared once in [`astro.config.mjs`](./astro.config.mjs):

```js
const i18n = {
  defaultLocale: "en-US",
  locales: ["en-US", "es-ES", "pt-BR", "ja-JP"],
  routing: { prefixDefaultLocale: false },
};
```

When adding a locale:

1. Add it to `astro.config.mjs`.
2. Add `src/content/i18n/<locale>.json` by running `pnpm i18n:sync`.
3. Add `i18n/glossaries/<locale>.yaml` if the locale needs glossary rules.
4. Run `pnpm i18n:translate` to fill UI strings.
5. Run `pnpm translate:dry` to inspect content translation scope.
6. Run `pnpm build` and spot-check representative localized pages.

## Build And Deploy Behavior

PolyStella uses a three-mode cache policy:

| Context              | R2 behavior                                                    |
| :------------------- | :------------------------------------------------------------- |
| Local build          | Reads production `i18n/`, never writes to R2                   |
| CI build on `main`   | Writes to production `i18n/`                                   |
| CI build on branch   | Writes to `previews/<branch>/i18n/`, reads `i18n/` as fallback |
| `pnpm translate` CLI | Same branch policy as CI, by explicit developer action         |

Generated files under `.astro/i18n-staging` are build artifacts. Do not edit or commit them.

Large translation refreshes may exceed a single build's practical runtime, especially the first time a locale/content set is processed or after a translation hash change invalidates many cache entries. The safest path is to pre-populate R2 with `pnpm translate`; otherwise, monitor the build and restart it if it times out or fails. PolyStella skips cached translations on the next run, so repeated runs make forward progress instead of starting over.

## Files To Know

| File                                               | Purpose                                                                         |
| :------------------------------------------------- | :------------------------------------------------------------------------------ |
| [`astro.config.mjs`](./astro.config.mjs)           | Astro locale list, route behavior, sitemap helper, integration registration     |
| [`polystella.config.mjs`](./polystella.config.mjs) | Translation fields, R2 cache, provider, glossaries, overrides, dry-run behavior |
| [`src/content.config.ts`](./src/content.config.ts) | PolyStella-aware content collections and UI-string collection                   |
| [`src/lib/i18n-utils.ts`](./src/lib/i18n-utils.ts) | Locale URL helpers and translation status logic                                 |
| [`src/content/i18n`](./src/content/i18n)           | UI-string dictionaries                                                          |
| [`i18n/glossaries`](./i18n/glossaries)             | Per-locale glossary rules                                                       |
| `i18n/overrides`                                   | Optional hand-written translation overrides                                     |

## Reviewing Output

After translating, run:

```sh
pnpm build
```

Then spot-check representative pages for each locale:

```text
/es-ES/
/pt-BR/
/ja-JP/
/es-ES/philosophy/
/pt-BR/people/<slug>/
/ja-JP/<publication-slug>/
```

AI-translated pages show a translation notice. Hand-written overrides are treated as reviewed translations and do not get the AI marker.
