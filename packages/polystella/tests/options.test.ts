import { describe, expect, it } from "vitest";

import {
  resolveOptions,
  type AstroI18nLike,
} from "../src/config/options.js";

/**
 * Contract tests for the locale derivation introduced when PolyStella
 * stopped owning `defaultLocale`/`locales` and started reading them
 * from Astro's `config.i18n` instead.
 *
 * The split between "PolyStella options" (zod-validated) and "locale
 * fields" (derived) means `resolveOptions` has two distinct failure
 * surfaces and we want both pinned: a missing/malformed `i18n` block
 * must produce a copy-pasteable error, and a happy `i18n` block must
 * yield the canonical `(defaultLocale, locales)` shape every other
 * substep consumes via `resolved`.
 */

const MINIMAL_USER_OPTS = {} as const;

const HAPPY_I18N: AstroI18nLike = {
  defaultLocale: "en",
  locales: ["en", "pt-BR", "ja-JP"],
  routing: { prefixDefaultLocale: false },
};

describe("resolveOptions — locale derivation from Astro's i18n config", () => {
  it("derives defaultLocale and target locales (default filtered out) from a happy i18n block", () => {
    const resolved = resolveOptions(MINIMAL_USER_OPTS, HAPPY_I18N);
    expect(resolved.defaultLocale).toBe("en");
    expect(resolved.locales).toEqual(["pt-BR", "ja-JP"]);
  });

  it("preserves the order of i18n.locales when filtering out the default", () => {
    const resolved = resolveOptions(MINIMAL_USER_OPTS, {
      defaultLocale: "en",
      locales: ["pt-BR", "en", "ja-JP"],
    });
    // Order from i18n.locales matters: it's the order Astro's router
    // and our staging writer iterate in, so a stable derivation keeps
    // build logs and prune behaviour deterministic across runs.
    expect(resolved.locales).toEqual(["pt-BR", "ja-JP"]);
  });

  it("merges the rest of the user-supplied options through unchanged", () => {
    const resolved = resolveOptions(
      { sourceDir: "./custom-content", overridesDir: "./custom-overrides" },
      HAPPY_I18N,
    );
    expect(resolved.sourceDir).toBe("./custom-content");
    expect(resolved.overridesDir).toBe("./custom-overrides");
    // Sanity: derivation didn't clobber the rest of the resolved shape.
    expect(resolved.defaultLocale).toBe("en");
    expect(resolved.locales).toEqual(["pt-BR", "ja-JP"]);
  });
});

describe("resolveOptions — Astro i18n cross-check failures", () => {
  it("throws with a copy-pasteable starter block when config.i18n is missing", () => {
    expect(() => resolveOptions(MINIMAL_USER_OPTS, undefined)).toThrowError(
      // We deliberately assert on the recognisable shape of the starter
      // block — that's the operator-facing contract this milestone
      // promises. If the wording ever drifts, this test should drift
      // with it (and a human reviewer should sanity-check the change).
      /i18n: \{[\s\S]+defaultLocale: "en"[\s\S]+locales: \[/,
    );
  });

  it("throws when defaultLocale is missing from i18n.locales", () => {
    expect(() =>
      resolveOptions(MINIMAL_USER_OPTS, {
        defaultLocale: "en",
        locales: ["pt-BR", "ja-JP"],
      }),
    ).toThrowError(/i18n\.locales` must include `defaultLocale`/);
  });

  it("throws when i18n.locales contains object-form entries (v0.1 limitation)", () => {
    expect(() =>
      resolveOptions(MINIMAL_USER_OPTS, {
        defaultLocale: "en",
        locales: [
          "en",
          { path: "pt", codes: ["pt-BR", "pt-PT"] },
        ],
      } as AstroI18nLike),
    ).toThrowError(
      /object-form entries.*PolyStella v0\.1 only supports plain string locales/,
    );
  });

  it('rejects routing: "manual"', () => {
    expect(() =>
      resolveOptions(MINIMAL_USER_OPTS, {
        ...HAPPY_I18N,
        routing: "manual",
      }),
    ).toThrowError(
      /routing: "manual"` is not supported by PolyStella v0\.1/,
    );
  });

  it("throws when i18n.locales is empty", () => {
    expect(() =>
      resolveOptions(MINIMAL_USER_OPTS, {
        defaultLocale: "en",
        locales: [],
      }),
    ).toThrowError(/`i18n\.locales` is required/);
  });

  it("throws when i18n.locales contains duplicates", () => {
    expect(() =>
      resolveOptions(MINIMAL_USER_OPTS, {
        defaultLocale: "en",
        locales: ["en", "pt-BR", "pt-BR"],
      }),
    ).toThrowError(/contains duplicates: pt-BR/);
  });

  it("aggregates user-options and i18n issues into a single error", () => {
    // `concurrency: 0` violates the schema (positive int required) and
    // the i18n block is missing — both should appear in the same
    // throw, so the operator fixes everything in one pass instead of
    // playing whack-a-mole.
    let caught: Error | undefined;
    try {
      resolveOptions({ concurrency: 0 }, undefined);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/Invalid PolyStella options/);
    expect(caught!.message).toMatch(/Invalid Astro `i18n` config/);
  });
});
