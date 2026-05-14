---
title: LocalePicker component
description: Unstyled, accessible locale switcher shipped with the integration.
---

PolyStella ships a minimal locale-switcher component you can drop
into your layout:

```astro
---
import LocalePicker from "polystella/components/LocalePicker.astro";
---

<LocalePicker />
```

## What it does

Renders a list of `<a>` elements, one per declared locale, linking
to the current page in each locale. The current locale's link gets
`aria-current="true"`. No JS required — it's a server-rendered
list of anchors.

## What it doesn't do

- **It doesn't style itself.** The component is unstyled HTML; your
  site's CSS owns the visual treatment.
- **It doesn't persist the user's choice.** Each click is a normal
  navigation. If you want to remember a user's locale preference,
  wire a cookie / `localStorage` in your own middleware.
- **It doesn't translate locale names.** Locale codes (`pt-BR`,
  `ja-JP`) are rendered as-is. If you want native names ("Português",
  "日本語"), wrap the component or override it.

These omissions are deliberate. A locale switcher is so site-
specific in styling and behaviour that anything beyond "list of
links to other locales" tends to fight what consumers actually want.

## Styling

The component uses semantic HTML:

```html
<nav class="polystella-locale-picker" aria-label="Choose language">
  <ul>
    <li><a href="/" aria-current="true" lang="en-US">en-US</a></li>
    <li><a href="/pt-BR/" lang="pt-BR">pt-BR</a></li>
    <li><a href="/ja-JP/" lang="ja-JP">ja-JP</a></li>
  </ul>
</nav>
```

Target the class in your CSS:

```css
.polystella-locale-picker ul {
  display: flex;
  list-style: none;
  gap: 1rem;
}
.polystella-locale-picker [aria-current="true"] {
  font-weight: bold;
}
```

## Replacing it

If you need more — locale name translation, dropdown UI, persistence
— the component is small enough to copy and modify. The source is
at `packages/polystella/components/LocalePicker.astro` in the repo.

The key thing the component does, that you'd want to keep, is
**preserving the current path across locales** — clicking the
"pt-BR" link from `/publications/foo` should land on
`/pt-BR/publications/foo`, not `/pt-BR/`. The component reads
`Astro.url.pathname` and strips any existing locale prefix before
re-prefixing.
