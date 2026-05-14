---
title: Middleware
description: How polystella's request middleware is auto-registered; opting out.
---

PolyStella registers a request middleware via Astro's
`addMiddleware` API during `astro:config:setup`. The middleware
populates four `Astro.locals` properties per request — see
[Astro.locals](/runtime-api/locals/) for the API.

## Default behaviour

The middleware is auto-registered with `order: "pre"`, meaning it
runs **before** any user middleware. Most projects don't need to
think about this.

```js
// polystella.config.mjs
export default {
  // middleware: true is the default
};
```

## Opting out

Set `middleware: false` to disable auto-registration. Useful when
you want to compose middleware manually:

```js
// polystella.config.mjs
export default {
  middleware: false,
};
```

```ts
// src/middleware.ts
import { sequence } from "astro:middleware";
import { polystellaMiddleware } from "polystella/runtime";

import { myAuthMiddleware } from "./auth";

export const onRequest = sequence(
  myAuthMiddleware,
  polystellaMiddleware(), // factory; returns a fresh handler per call
);
```

`polystellaMiddleware()` is a factory because the middleware closes
over the resolved options and the locale set. Each call returns a
fresh handler.

## Order matters

The middleware reads `Astro.currentLocale` and populates locals
from it. If you have middleware that **changes** the current locale
(unusual, but conceivable for a multi-domain setup), it has to run
**before** PolyStella's middleware.

The default `order: "pre"` puts PolyStella first, which is right
for the common case (locale is determined by URL alone). If you
need it to run after your own middleware, opt out of auto-
registration and compose explicitly.

## What the middleware does NOT do

The middleware doesn't:

- Translate content at request time. Translations are baked in at
  build time; the middleware just looks up which sibling entry to
  read.
- Persist anything to the request. Each request gets a fresh set
  of locals.
- Mutate `Astro.currentLocale`. The locale is what Astro decided
  it was.

This is by design — the middleware is a thin lookup layer, not a
piece of business logic.

## See also

- [Astro.locals](/runtime-api/locals/) — the four properties the
  middleware installs.
- [Explicit imports](/runtime-api/explicit-imports/) — calling the
  same functions outside a request context.
