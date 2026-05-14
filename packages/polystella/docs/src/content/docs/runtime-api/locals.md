---
title: Astro.locals
description: "t, lhref, getLocalizedEntry, getLocalizedCollection."
---

PolyStella's middleware populates four properties on `Astro.locals`
per request. All four close over the request's locale, so you don't
have to thread `Astro.currentLocale` everywhere.

## The four locals

```ts
const { t, lhref, getLocalizedEntry, getLocalizedCollection } = Astro.locals;
```

### `t(key: string, params?: Record<string, string | number>): string`

Look up a UI string. Returns the translation in the request's
locale; falls back to the default locale if the key isn't in this
locale's dictionary, then to the key itself.

```astro
<a href={lhref("/about")}>{t("nav.about")}</a>
<p>{t("welcome.greeting", { name: user.name })}</p>
```

The `{{name}}` placeholder interpolation is built in. Token-name
preservation is validated post-translation; see
[CLI → translate-ui](/cli/translate-ui/).

### `lhref(href: string): string`

Locale-prefix an internal URL. Idempotent — already-prefixed URLs
pass through.

```astro
<a href={lhref("/publications")}>...</a>
<!-- → /pt-BR/publications -->

<a href={lhref("https://cloudflare.com")}>...</a>
<!-- → https://cloudflare.com (external, unchanged) -->

<a href={lhref("#section")}>...</a>
<!-- → #section (anchor-only, unchanged) -->

<a href={lhref("/pt-BR/publications")}>...</a>
<!-- → /pt-BR/publications (already prefixed, unchanged) -->
```

Paths matching `noPrefixUrls` in your config are also left alone.

### `getLocalizedEntry<C>(collection: C, slug: string): Promise<LocalizedEntry<...> | undefined>`

Read one entry, returning the locale-appropriate version.

```ts
const entry = await getLocalizedEntry("publications", "Davidson2018");
if (!entry) return Astro.redirect("/404");

const isTranslated = entry.isLocalized; // boolean
const sourceLocale = entry.locale; // "pt-BR" if translated, "en-US" if fallback
```

The returned `LocalizedEntry` shape extends Astro's entry with two
fields:

- **`isLocalized`** — `true` when the per-locale sibling collection
  had this entry; `false` when fallback to source happened.
- **`locale`** — the locale this entry represents.

### `getLocalizedCollection<C>(collection: C, filter?: (entry) => boolean): Promise<LocalizedEntry<...>[]>`

Read a whole collection. Each entry is `LocalizedEntry`-shaped.

```ts
const activePeople = await getLocalizedCollection("people", ({ data }) => data.type === "active");
```

The filter receives the merged shape, so it can branch on
`entry.isLocalized` or `entry.locale` if that matters.

## What "locale" means here

`Astro.currentLocale` is Astro's request-scoped locale, derived
from the URL's `[lang]` segment when present, otherwise from the
client's `Accept-Language`, otherwise the configured default.

PolyStella's middleware uses this same value. The "request's
locale" in the local-bound functions above is whatever
`Astro.currentLocale` resolves to for this request.

## Opting out

If you've set `middleware: false` in your config (because you're
composing middleware manually via `astro:middleware`'s
`sequence(...)`), `Astro.locals` won't be populated by PolyStella.

You have two options:

- Compose `polystellaMiddleware()` into your sequence yourself.
- Use the [explicit imports](/runtime-api/explicit-imports/) form,
  passing `locale` directly to each call.

## See also

- [Middleware](/runtime-api/middleware/) — how the locals are
  installed.
- [Explicit imports](/runtime-api/explicit-imports/) — calling
  these functions outside `.astro` templates.
