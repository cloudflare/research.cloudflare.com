import type { AstroIntegration } from "astro";
import {
  resolveOptions,
  type PolyStellaOptions,
  type PolyStellaResolvedOptions,
} from "./options.js";

export type { PolyStellaOptions, PolyStellaResolvedOptions };

/**
 * PolyStella — AI-driven content localization for Astro.
 *
 * v0.1: standalone-mode pilot.
 *
 * Current state (M2.1): options validated at `astro:config:setup`. No
 * translation, no R2 calls, no route injection yet — those land in
 * subsequent milestones.
 */
export default function polystella(
  options: PolyStellaOptions,
): AstroIntegration {
  // Resolved on first use so a misconfiguration throws inside the
  // astro:config:setup hook (where Astro surfaces it cleanly to the user).
  let resolved: PolyStellaResolvedOptions | undefined;

  return {
    name: "polystella",
    hooks: {
      "astro:config:setup": ({ logger }) => {
        resolved = resolveOptions(options);
        logger.info(
          `validated options: defaultLocale=${
            resolved.defaultLocale
          }, locales=[${resolved.locales.join(", ")}], mode=${resolved.mode}`,
        );
      },
    },
  };
}
