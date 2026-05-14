---
title: Public exports
description: "Every export path in package.json — what it provides and when to import from it."
---

PolyStella ships eight public import paths. Each has a narrow,
documented purpose; mixing them up rarely produces a useful build.

| Path                                       | Purpose                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `polystella`                               | Default export: the Astro integration factory.                                                               |
| `polystella/content`                       | Content-config helpers: `polystellaCollections`, `file`, `polystellaLoader`.                                 |
| `polystella/runtime`                       | Runtime API: `getLocalizedEntry`, `getLocalizedCollection`, `localizedHref`, `polystellaMiddleware`.         |
| `polystella/runtime/middleware`            | Direct middleware entrypoint — used by the integration's `addMiddleware` call. Rarely imported by consumers. |
| `polystella/i18n`                          | UI-strings glue: `i18nLoader`, `i18nSchema`, `getTranslations`, `getDictionary`, drift helpers.              |
| `polystella/react`                         | React hooks: `useTranslations`, `useLocalizedHref` — for islands.                                            |
| `polystella/client`                        | Types only. Reference from `src/env.d.ts` for virtual-module types. No runtime import.                       |
| `polystella/components/LocalePicker.astro` | Unstyled, accessible locale-switcher component.                                                              |

## Which import goes where

### `astro.config.mjs`

```js
import polystella from "polystella";
```

### `polystella.config.mjs`

No imports needed — it's a plain config object.

### `src/content.config.ts`

```ts
import { polystellaCollections } from "polystella/content";
import { i18nLoader, i18nSchema } from "polystella/i18n";
```

### `src/env.d.ts`

```ts
/// <reference types="polystella/client" />
```

### `.astro` page templates

Use `Astro.locals` for the locale-bound runtime — no explicit import
required. The middleware populates these automatically.

For explicit imports (uncommon — `getStaticPaths` and similar):

```ts
import { getLocalizedEntry, getLocalizedCollection, localizedHref } from "polystella/runtime";
```

### React islands

```tsx
import { useTranslations, useLocalizedHref } from "polystella/react";
```

### Locale switcher

```astro
---
import LocalePicker from "polystella/components/LocalePicker.astro";
---

<LocalePicker />
```

## What's NOT public

Anything not in the table above is implementation detail and may
move between minor versions. The package's `package.json` `exports`
field is the source of truth — if it isn't listed there, importing
it directly is unsupported.

The full list of internal subpaths under `src/` (which are
reachable via the `.` default export's `main` field for now) is
**not** a public API. We may add `"./internal/*": null` to
`exports` in a future minor to enforce this.
