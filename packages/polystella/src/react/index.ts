/**
 * `polystella/react` — React hook for client-side translation.
 *
 * Receives a pre-resolved dictionary (fetched server-side via
 * `getDictionary` from `polystella/ui`) and returns a `t(key,
 * params?)` function with the same interpolation behaviour as the
 * Astro-side `getTranslations`.
 *
 *   import { useTranslations } from "polystella/react";
 *
 *   export function NavMenu({ dict }: { dict: Record<string, string> }) {
 *     const t = useTranslations(dict);
 *     return <div>{t("nav.focusAreas")}</div>;
 *   }
 *
 * Pure: no Astro imports, no async, works in any React environment.
 */

import { useMemo } from "react";
import { buildTranslateFn, interpolate } from "../ui/translate.js";
import type { InterpolateParams, TranslateFn } from "../ui/translate.js";

/**
 * React hook returning a `t(key, params?)` bound to the supplied
 * dictionary. Memoised on dictionary identity so re-renders that
 * pass the same object don't rebuild the lookup function.
 */
export function useTranslations(
  dictionary: Record<string, string>,
): TranslateFn {
  return useMemo(() => buildTranslateFn(dictionary), [dictionary]);
}

export { interpolate, type InterpolateParams, type TranslateFn };
