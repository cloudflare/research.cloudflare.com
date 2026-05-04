/**
 * Runtime UI-string translator.
 *
 * Pages and components call `useTranslations(locale)` to get a
 * `t(key, params?)` function bound to the visitor's locale. The
 * returned function reads from the `i18n` content collection (one
 * entry per locale) populated via `i18nLoader()` in
 * `content.config.ts`.
 *
 * Resolution order on missing keys:
 *
 *   1. Requested-locale dictionary — primary path; drift detection
 *      ensures every locale has the same key set, so this hits in
 *      steady state.
 *   2. Default-locale dictionary — defensive fallback. Should never
 *      fire in a build that passed drift detection, but covers the
 *      transient state where a locale's JSON has been edited in-tree
 *      and the build hasn't been rerun yet.
 *   3. The key itself, returned as a string. Last-resort fallback so
 *      a page never crashes on a missing key; surfaces the raw key
 *      in the rendered output instead, which is preferable to an
 *      uncaught exception during render.
 *
 * Interpolation uses `{{name}}` placeholders matching Starlight /
 * i18next conventions. Unknown placeholders are left in place
 * (helps spot typos in templates without crashing).
 *
 * The pure interpolator and the pure dispatch logic are exported so
 * tests can pin behaviour without going through Astro's content
 * layer.
 */

/** Plain interpolation parameters: key → scalar that gets coerced to string. */
export type InterpolateParams = Record<string, string | number | boolean>;

/**
 * Interpolate `{{name}}` placeholders in `template` with values from
 * `params`. Unknown placeholders pass through unchanged (the literal
 * `{{name}}` survives in the output). This is intentional: a missing
 * placeholder during template authoring is more easily caught when
 * the rendered page surfaces the raw `{{name}}` than when it
 * silently renders empty.
 *
 * Pure: no I/O, no global state. Exported for direct unit testing
 * and for consumer code that wants to interpolate an already-
 * resolved template (e.g. from a custom translation source).
 */
export function interpolate(
  template: string,
  params: InterpolateParams,
): string {
  // Word characters only: `{{user_name}}` works, `{{user.name}}`
  // doesn't (nested keys aren't part of the v0.1 contract). Matches
  // i18next's default placeholder grammar.
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in params) {
      return String(params[key]);
    }
    return match;
  });
}

/**
 * The shape `useTranslations` returns. A consumer call like
 * `t("nav.home")` returns the matching string; `t("greeting",
 * { name: "Diogo" })` interpolates parameters in.
 */
export type TranslateFn = (key: string, params?: InterpolateParams) => string;

/**
 * Build a `t()` function bound to a primary dictionary and an
 * optional fallback dictionary. Pure — no Astro coupling — so tests
 * can exercise the dispatch logic without standing up `getEntry`.
 *
 * Behaviour:
 *   1. If `key` exists in `primary`, use that template.
 *   2. Else if `fallback` exists and contains `key`, use that template.
 *   3. Else return `key` itself.
 * 4. Interpolate `params` if provided.
 */
export function buildTranslateFn(
  primary: Record<string, string>,
  fallback?: Record<string, string>,
): TranslateFn {
  return function t(key, params) {
    let raw = primary[key];
    if (raw === undefined && fallback) {
      raw = fallback[key];
    }
    if (raw === undefined) {
      return key;
    }
    return params ? interpolate(raw, params) : raw;
  };
}

/**
 * What `useTranslations` needs from Astro's content layer at
 * page-render time. Defined as a structural dep so tests can pass a
 * synthetic implementation without booting Astro.
 *
 * Returns the entry's `data` (a flat dict) on hit, or `undefined` on
 * miss. Mirrors Astro's `getEntry` contract.
 */
export type GetI18nEntry = (
  locale: string,
) => Promise<{ data: Record<string, string> } | undefined>;

export interface UseTranslationsDeps {
  defaultLocale: string;
  getI18nEntry: GetI18nEntry;
}

/**
 * Pure core of `useTranslations`. Resolves the primary and fallback
 * dictionaries, then delegates to `buildTranslateFn`. The thin
 * wrapper in `./index.ts` provides Astro-bound deps; tests pass stubs.
 *
 * `locale === undefined` is treated the same as `defaultLocale`:
 * pages that don't have a locale set on `Astro.currentLocale` (e.g.
 * the homepage when `prefixDefaultLocale: false`) get the default
 * locale's strings, which is the expected behaviour.
 */
export async function resolveTranslations(
  locale: string | undefined,
  deps: UseTranslationsDeps,
): Promise<TranslateFn> {
  const effectiveLocale = locale ?? deps.defaultLocale;
  const primaryEntry = await deps.getI18nEntry(effectiveLocale);
  const primary = primaryEntry?.data ?? {};

  // Fallback is only meaningful when the requested locale isn't the
  // default — there's no fallback to load otherwise.
  let fallback: Record<string, string> | undefined;
  if (effectiveLocale !== deps.defaultLocale) {
    const fallbackEntry = await deps.getI18nEntry(deps.defaultLocale);
    fallback = fallbackEntry?.data;
  }

  return buildTranslateFn(primary, fallback);
}
