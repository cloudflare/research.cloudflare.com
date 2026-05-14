---
title: React hooks
description: useTranslations and useLocalizedHref for React islands.
---

For client-rendered React islands inside an Astro project,
PolyStella exports two hooks:

```tsx
import { useTranslations, useLocalizedHref } from "polystella/react";
```

## Pattern: dictionary fetched server-side

The recommended pattern is:

1. Pass the dictionary into the island as a prop, server-side.
2. The island uses `useTranslations(dict)` to memoise the `t`
   function.
3. URLs go through `useLocalizedHref(locale)`.

```astro
---
// src/pages/[lang]/index.astro
import { getDictionary } from "polystella/i18n";
import { NavMenu } from "../components/NavMenu";

const navDict = await getDictionary(Astro.currentLocale, "nav");
---

<NavMenu client:load locale={Astro.currentLocale} dict={navDict} />
```

```tsx
// src/components/NavMenu.tsx
import { useTranslations, useLocalizedHref } from "polystella/react";

export function NavMenu({ locale, dict }: { locale: string | undefined; dict: Record<string, string> }) {
  const t = useTranslations(dict);
  const link = useLocalizedHref(locale);
  return (
    <nav>
      <a href={link("/")}>{t("nav.home")}</a>
      <a href={link("/about")}>{t("nav.about")}</a>
    </nav>
  );
}
```

## Why pass dictionary as a prop?

PolyStella's content collections are an Astro-runtime concern; the
React island doesn't have access to Astro's content layer at render
time. Passing the dictionary down via props is the cleanest way to
get the strings into the island without bundling the whole
collection.

`getDictionary` reads from the `i18n` collection server-side and
returns the locale-appropriate dictionary as a plain object. The
island gets exactly the keys it needs, nothing more.

## `useTranslations(dict)`

Returns a `t(key, params?)` function with the same shape as
`Astro.locals.t`:

```tsx
const t = useTranslations(dict);
t("greeting"); // "Hello"
t("greeting.named", { name: "Alice" }); // "Hello, Alice"
```

Missing keys return the key string unchanged. Same fallback chain
as `Astro.locals.t`.

## `useLocalizedHref(locale)`

Returns a `link(href)` function:

```tsx
const link = useLocalizedHref(locale);
link("/about"); // "/pt-BR/about" if locale is "pt-BR"
link("https://..."); // unchanged
link("/api"); // unchanged if "/api" is in noPrefixUrls
```

`noPrefixUrls` is read from the build-time `polystella:runtime-config`
virtual module so the hook can apply the same exemption rules as
the server.

## Why these are hooks

They're memoised — `t` and `link` are stable across re-renders as
long as their inputs don't change. That's important for React
optimisations like `React.memo` and `useCallback`.

If you don't care about referential stability, you could call the
underlying functions directly (`buildTranslateFn(dict)`,
`resolveLocalizedHref(...)`). The hooks just save you that
plumbing.
