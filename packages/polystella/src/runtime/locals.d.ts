/**
 * Ambient `App.Locals` augmentation contributed by polystella's
 * runtime middleware. When `options.middleware` is enabled (the
 * default), every request gets these properties set; consumers can
 * read them in any `.astro` template without imports:
 *
 *   <a href={Astro.locals.lhref("/foo")}>foo</a>
 *   <p>{Astro.locals.t("nav.home")}</p>
 *
 * Both fields are typed as required because the integration's
 * default config registers the middleware. If a consumer disables
 * middleware via `middleware: false` AND doesn't manually compose
 * polystella's middleware via `sequence(...)`, these fields will be
 * undefined at runtime — that's an opt-in to runtime risk in
 * exchange for full middleware control.
 *
 * Starlight mode caveat: `t` is set by Starlight's middleware when
 * starlight mode is active (polystella's middleware skips the field
 * to avoid clobbering). The augmentation is shared, so the type
 * stays correct.
 */

import type { TranslateFn } from "../i18n/translate.js";

declare global {
  namespace App {
    interface Locals {
      /**
       * Translate a UI-strings key for the visitor's locale.
       * Falls back to the default-locale dictionary on missing keys,
       * then to the literal key. Set per request by polystella's
       * (or, in starlight mode, Starlight's) middleware.
       */
      t: TranslateFn;

      /**
       * Locale-prefix an internal URL for the visitor's locale.
       * Returns the input unchanged for external URLs, anchors,
       * already-prefixed paths, the default locale, and operator-
       * declared exemptions in `noPrefixUrls`.
       *
       * Short name (`lhref`, not `localizedHref`) so templates stay
       * terse: `<a href={Astro.locals.lhref("/foo")}>`. The verbose
       * name is preserved on the explicit-import surface
       * (`polystella/runtime`'s `localizedHref(href, locale?)`).
       */
      lhref: (href: string) => string;
    }
  }
}

export {};
