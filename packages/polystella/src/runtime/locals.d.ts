/**
 * Ambient `App.Locals` augmentation contributed by polystella's
 * runtime middleware. When `options.middleware` is enabled (the
 * default), every request gets these properties set; consumers can
 * read them in any `.astro` template without imports:
 *
 *   const { t, lhref, getLocalizedEntry, getLocalizedCollection } = Astro.locals;
 *
 *   <a href={lhref("/foo")}>{t("nav.home")}</a>
 *
 *   const publication = await getLocalizedEntry("publications", "antunes2025");
 *   const people = await getLocalizedCollection("people", ({ data }) => data.type === "active");
 *
 * All fields are typed as required because the integration's
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

import type { CollectionEntry } from "astro:content";

import type { CollectionEntryRef, LocalizedEntry } from "./get-localized-entry.js";
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

      /**
       * Locale-bound `getLocalizedEntry` — the request's locale is
       * closed over by the middleware, so consumers don't need to
       * thread `Astro.currentLocale` through every call site.
       *
       *   const entry = await Astro.locals.getLocalizedEntry("publications", "foo");
       *   const author = await Astro.locals.getLocalizedEntry({ collection: "people", id: "alice" });
       *
       * For non-template contexts (`getStaticPaths`, build helpers,
       * React islands), use the explicit-import surface:
       * `getLocalizedEntry(collection, id, locale)` from
       * `polystella/runtime`.
       *
       * The collection-pinned generic resolves the entry shape to
       * Astro's `CollectionEntry<C>` so consumers (after `astro
       * sync`) get full schema-aware inference on `entry.data.*`.
       */
      getLocalizedEntry: {
        <C extends string>(
          ref: { collection: C; id: string },
        ): Promise<LocalizedEntry<CollectionEntry<C>> | undefined>;
        <C extends string>(
          collection: C,
          id: string,
        ): Promise<LocalizedEntry<CollectionEntry<C>> | undefined>;
      };

      /**
       * Locale-bound `getLocalizedCollection` — drop-in for Astro's
       * `getCollection` that returns the per-locale view: source
       * entries replaced by their `<collection>__<locale>` siblings
       * where translations exist, source entries kept (or dropped,
       * per `fallback`/`noTranslateBehavior`) where they don't.
       *
       *   const items = await Astro.locals.getLocalizedCollection("people");
       *   const active = await Astro.locals.getLocalizedCollection(
       *     "people",
       *     ({ data }) => data.type === "active",
       *   );
       *
       * The filter receives the merged-and-tagged shape
       * (`LocalizedEntry<CollectionEntry<C>>`), so it can branch on
       * `entry.isLocalized` / `entry.locale` if it wants. Existing
       * `({ data }) => ...` filters work unchanged because the
       * extension fields don't shadow `data`.
       *
       * Filter return type is `unknown` (matching Astro's
       * `getCollection` convention) so callers can return a
       * `boolean | undefined` from an optional chain
       * (`(pub) => pub.data.authors?.some(...)`) without explicit
       * coercion. `Array.prototype.filter` truthiness-checks the
       * result at runtime.
       *
       * Like `getLocalizedEntry`, this is unavailable in
       * `getStaticPaths` (which runs at build time outside the
       * request lifecycle) — use the explicit-import
       * `getLocalizedCollection(collection, filter?, locale?)` from
       * `polystella/runtime` there.
       */
      getLocalizedCollection: <C extends string>(
        collection: C,
        filter?: (entry: LocalizedEntry<CollectionEntry<C>>) => unknown,
      ) => Promise<LocalizedEntry<CollectionEntry<C>>[]>;
    }
  }
}

export type { CollectionEntryRef, LocalizedEntry };
