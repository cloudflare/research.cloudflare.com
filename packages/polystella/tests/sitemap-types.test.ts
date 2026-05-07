// Type-only smoke test: verifies the helper's output is structurally
// assignable to @astrojs/sitemap's expected option shape. Catches
// the kind of structural drift the runtime tests can't see (readonly
// arrays, enum vs string, missing optional fields).
import { describe, it } from "vitest";
import sitemap from "@astrojs/sitemap";
import { astroSitemapI18n } from "../src/i18n/sitemap.js";

describe("astroSitemapI18n type compatibility with @astrojs/sitemap", () => {
  it("output is assignable to sitemap() argument (default xDefault)", () => {
    const i18n = { defaultLocale: "en", locales: ["en", "pt-BR"] };
    const _result = sitemap(astroSitemapI18n(i18n, { hreflang: { en: "en-US" } }));
  });

  it("output spreads cleanly with other sitemap options", () => {
    const i18n = { defaultLocale: "en", locales: ["en", "pt-BR"] };
    const _result = sitemap({
      ...astroSitemapI18n(i18n, { hreflang: { en: "en-US" } }),
      filter: (page: string) => !page.includes("/draft/"),
    });
  });

  it("output is assignable when xDefault: false (no serialize)", () => {
    const i18n = { defaultLocale: "en", locales: ["en", "pt-BR"] };
    const _result = sitemap(astroSitemapI18n(i18n, { xDefault: false }));
  });
});
