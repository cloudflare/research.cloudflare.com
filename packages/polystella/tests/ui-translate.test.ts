import { describe, expect, it, vi } from "vitest";
import {
  buildTranslateFn,
  interpolate,
  resolveTranslations,
  type GetI18nEntry,
} from "../src/ui/translate.js";

/**
 * Tests for the runtime translator. Three layers:
 *
 *   - `interpolate`: pure string-template interpolation.
 *   - `buildTranslateFn`: pure dispatcher over a primary + optional
 *     fallback dictionary.
 *   - `resolveTranslations`: glue that fetches dictionaries via an
 *     injected `getI18nEntry` and binds the dispatcher.
 *
 * The Astro-bound public wrapper (`useTranslations` in
 * `src/ui/index.ts`) is just `resolveTranslations` with Astro's
 * `getEntry` and the default-locale virtual-module export. Testing
 * the pure layers here covers the runtime contract without booting
 * Astro.
 */

describe("interpolate", () => {
  it("replaces `{{name}}` placeholders with string params", () => {
    expect(interpolate("Hello, {{name}}!", { name: "Diogo" })).toBe(
      "Hello, Diogo!",
    );
  });

  it("coerces number params to strings", () => {
    expect(interpolate("{{count}} results", { count: 42 })).toBe("42 results");
  });

  it("coerces boolean params to strings", () => {
    expect(interpolate("Enabled: {{flag}}", { flag: true })).toBe(
      "Enabled: true",
    );
  });

  it("handles multiple placeholders in one template", () => {
    expect(
      interpolate("{{greeting}}, {{name}}!", {
        greeting: "Hi",
        name: "Diogo",
      }),
    ).toBe("Hi, Diogo!");
  });

  it("repeats the same placeholder when it appears multiple times", () => {
    expect(interpolate("{{x}}, {{x}}, {{x}}", { x: "Doug" })).toBe(
      "Doug, Doug, Doug",
    );
  });

  it("leaves unknown placeholders in place (helps catch typos in templates)", () => {
    expect(
      interpolate("Hello, {{name}}! Today is {{day}}.", { name: "Diogo" }),
    ).toBe("Hello, Diogo! Today is {{day}}.");
  });

  it("treats placeholders as word characters only (no dotted paths)", () => {
    // `{{user.name}}` is NOT supported in v0.1; the dot makes it not
    // match the `\w+` placeholder grammar, so it survives unchanged.
    // The flat-dictionary contract precludes nested keys anyway.
    expect(interpolate("Welcome {{user.name}}", { "user.name": "Diogo" })).toBe(
      "Welcome {{user.name}}",
    );
  });

  it("returns the template unchanged when no placeholders match", () => {
    expect(interpolate("Plain text.", { unused: "x" })).toBe("Plain text.");
  });
});

describe("buildTranslateFn", () => {
  it("returns the value from the primary dictionary on hit", () => {
    const t = buildTranslateFn({ "nav.home": "Início" });
    expect(t("nav.home")).toBe("Início");
  });

  it("interpolates params on hit", () => {
    const t = buildTranslateFn({ greeting: "Olá, {{name}}!" });
    expect(t("greeting", { name: "Diogo" })).toBe("Olá, Diogo!");
  });

  it("falls back to the secondary dictionary on primary miss", () => {
    const t = buildTranslateFn(
      { "nav.home": "Início" },
      { "nav.home": "Home", "nav.about": "About" },
    );
    expect(t("nav.about")).toBe("About");
  });

  it("returns the key itself when neither dictionary has it", () => {
    const t = buildTranslateFn({ "nav.home": "Início" });
    expect(t("nav.missing")).toBe("nav.missing");
  });

  it("interpolates against the fallback dictionary too", () => {
    const t = buildTranslateFn({}, { greeting: "Hello, {{name}}!" });
    expect(t("greeting", { name: "Diogo" })).toBe("Hello, Diogo!");
  });

  it("returns the key as-is on full miss even when params are provided", () => {
    // Don't try to interpolate the key string itself — that would
    // produce surprising output if the key happens to look like a
    // template (`"missing.{{x}}"` etc.).
    const t = buildTranslateFn({});
    expect(t("missing.key", { x: "y" })).toBe("missing.key");
  });

  it("works with no fallback supplied", () => {
    const t = buildTranslateFn({ ok: "ok" });
    expect(t("ok")).toBe("ok");
    expect(t("missing")).toBe("missing");
  });
});

describe("resolveTranslations", () => {
  function makeGetEntry(
    entries: Record<string, Record<string, string>>,
  ): GetI18nEntry {
    return vi.fn(async (locale: string) => {
      if (locale in entries) {
        return { data: entries[locale]! };
      }
      return undefined;
    });
  }

  it("uses the requested locale's dictionary on hit", async () => {
    const t = await resolveTranslations("pt-BR", {
      defaultLocale: "en",
      getI18nEntry: makeGetEntry({
        en: { "nav.home": "Home" },
        "pt-BR": { "nav.home": "Início" },
      }),
    });
    expect(t("nav.home")).toBe("Início");
  });

  it("falls back to default-locale on missing key in the requested locale", async () => {
    const t = await resolveTranslations("pt-BR", {
      defaultLocale: "en",
      getI18nEntry: makeGetEntry({
        en: { "nav.home": "Home", "nav.about": "About" },
        "pt-BR": { "nav.home": "Início" },
      }),
    });
    expect(t("nav.about")).toBe("About");
  });

  it("returns key string when it's missing from both", async () => {
    const t = await resolveTranslations("pt-BR", {
      defaultLocale: "en",
      getI18nEntry: makeGetEntry({
        en: { "nav.home": "Home" },
        "pt-BR": { "nav.home": "Início" },
      }),
    });
    expect(t("nav.missing")).toBe("nav.missing");
  });

  it("does not load the fallback when the requested locale IS the default", async () => {
    // Optimisation: same locale → no fallback needed → `getEntry`
    // called once, not twice.
    const get = makeGetEntry({ en: { "nav.home": "Home" } });
    await resolveTranslations("en", {
      defaultLocale: "en",
      getI18nEntry: get,
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("en");
  });

  it("treats `undefined` locale as the default locale", async () => {
    const get = makeGetEntry({ en: { "nav.home": "Home" } });
    const t = await resolveTranslations(undefined, {
      defaultLocale: "en",
      getI18nEntry: get,
    });
    expect(t("nav.home")).toBe("Home");
    // Same single-call optimisation as the explicit-default case.
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("en");
  });

  it("returns a usable t() even when neither dict exists", async () => {
    // Defensive: drift detection makes this unreachable in practice,
    // but the helper shouldn't throw on a content-layer miss.
    const t = await resolveTranslations("ja-JP", {
      defaultLocale: "en",
      getI18nEntry: makeGetEntry({}),
    });
    expect(t("any.key")).toBe("any.key");
  });
});
