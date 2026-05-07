import { describe, expect, it } from "vitest";
import { astroSitemapI18n } from "../src/i18n/sitemap.js";

describe("astroSitemapI18n", () => {
  describe("i18n option", () => {
    it("identity-maps every locale to itself by default", () => {
      const result = astroSitemapI18n({
        defaultLocale: "en",
        locales: ["en", "pt-BR", "ja-JP", "es-ES"],
      });

      expect(result.i18n).toEqual({
        defaultLocale: "en",
        locales: {
          en: "en",
          "pt-BR": "pt-BR",
          "ja-JP": "ja-JP",
          "es-ES": "es-ES",
        },
      });
    });

    it("applies hreflang overrides for the listed locales only", () => {
      const result = astroSitemapI18n({ defaultLocale: "en", locales: ["en", "pt-BR", "ja-JP"] }, { hreflang: { en: "en-US" } });

      expect(result.i18n.locales).toEqual({
        en: "en-US",
        "pt-BR": "pt-BR",
        "ja-JP": "ja-JP",
      });
    });

    it("preserves the order of locales from the input array", () => {
      // `@astrojs/sitemap` doesn't depend on insertion order, but
      // stable order makes diffs reviewable when the resolved config
      // is logged or serialized for debugging.
      const result = astroSitemapI18n({
        defaultLocale: "en",
        locales: ["es-ES", "ja-JP", "pt-BR", "en"],
      });
      expect(Object.keys(result.i18n.locales)).toEqual(["es-ES", "ja-JP", "pt-BR", "en"]);
    });
  });

  describe("validation", () => {
    it("throws when defaultLocale is not in the locales array", () => {
      expect(() =>
        astroSitemapI18n({
          defaultLocale: "fr",
          locales: ["en", "pt-BR"],
        }),
      ).toThrow(/defaultLocale "fr" is not present/);
    });

    it("throws on an empty locales array", () => {
      expect(() =>
        astroSitemapI18n({
          defaultLocale: "en",
          locales: [],
        }),
      ).toThrow(/at least one locale/);
    });

    it("throws on duplicate locale codes", () => {
      expect(() =>
        astroSitemapI18n({
          defaultLocale: "en",
          locales: ["en", "pt-BR", "pt-BR"],
        }),
      ).toThrow(/duplicate locale "pt-BR"/);
    });

    it("throws on the object-form locale (multi-code path groups)", () => {
      // Object-form locales (e.g. { codes: ['es-ES','es-MX'], path: 'spanish' })
      // would require multi-hreflang fan-out per URL. The helper draws
      // a clean line: refuse the input and point the caller at manual
      // configuration rather than silently producing a half-correct map.
      expect(() =>
        astroSitemapI18n({
          defaultLocale: "en",
          locales: ["en", { codes: ["es-ES", "es-MX"], path: "spanish" }],
        }),
      ).toThrow(/object form/);
    });

    it("throws when a hreflang override key is not a configured locale", () => {
      // Catch typos like { "en-US": "en-US" } when the user meant { en: "en-US" }.
      expect(() =>
        astroSitemapI18n({ defaultLocale: "en", locales: ["en", "pt-BR"] }, { hreflang: { "en-US": "en-US" } }),
      ).toThrow(/"en-US" is not a configured locale/);
    });

    it("does not mutate the input objects", () => {
      const i18n = {
        defaultLocale: "en",
        locales: ["en", "pt-BR"] as const,
      };
      const overrides = { hreflang: { en: "en-US" } };
      astroSitemapI18n(i18n, overrides);
      expect(i18n.locales).toEqual(["en", "pt-BR"]);
      expect(overrides.hreflang).toEqual({ en: "en-US" });
    });
  });

  describe("x-default serialize", () => {
    it("returns a serialize callback by default (xDefault enabled)", () => {
      const result = astroSitemapI18n({ defaultLocale: "en", locales: ["en", "pt-BR"] });
      expect(typeof result.serialize).toBe("function");
    });

    it("appends an x-default link cloning the default-locale URL", () => {
      const { serialize } = astroSitemapI18n({ defaultLocale: "en", locales: ["en", "pt-BR"] }, { hreflang: { en: "en-US" } });
      const item = {
        url: "https://example.com/foo/",
        links: [
          { url: "https://example.com/foo/", lang: "en-US" },
          { url: "https://example.com/pt-BR/foo/", lang: "pt-BR" },
        ],
      };
      const out = serialize!(item);
      expect(out.links).toEqual([
        { url: "https://example.com/foo/", lang: "en-US" },
        { url: "https://example.com/pt-BR/foo/", lang: "pt-BR" },
        { url: "https://example.com/foo/", lang: "x-default" },
      ]);
    });

    it("uses the default locale's hreflang override when looking up the default URL", () => {
      // If the default-locale URL has hreflang `en-US` (overridden),
      // x-default should clone the link tagged `en-US`, not the
      // original locale code `en`.
      const { serialize } = astroSitemapI18n({ defaultLocale: "en", locales: ["en", "pt-BR"] }, { hreflang: { en: "en-US" } });
      const item = {
        url: "https://example.com/foo/",
        links: [
          { url: "https://example.com/foo/", lang: "en-US" },
          { url: "https://example.com/pt-BR/foo/", lang: "pt-BR" },
        ],
      };
      const out = serialize!(item);
      const xDefault = out.links!.find((l) => l.lang === "x-default");
      expect(xDefault?.url).toBe("https://example.com/foo/");
    });

    it("identity-maps default locale when no override is given", () => {
      const { serialize } = astroSitemapI18n({ defaultLocale: "en", locales: ["en", "pt-BR"] });
      const item = {
        url: "https://example.com/",
        links: [
          { url: "https://example.com/", lang: "en" },
          { url: "https://example.com/pt-BR/", lang: "pt-BR" },
        ],
      };
      const out = serialize!(item);
      const xDefault = out.links!.find((l) => l.lang === "x-default");
      expect(xDefault?.url).toBe("https://example.com/");
    });

    it("passes through items with no links unchanged (no dangling x-default)", () => {
      // Standalone pages with no translation get no `links` array
      // from @astrojs/sitemap. Adding x-default to a single page is
      // meaningless and could confuse search engines.
      const { serialize } = astroSitemapI18n({ defaultLocale: "en", locales: ["en", "pt-BR"] });
      const item = { url: "https://example.com/standalone/" };
      expect(serialize!(item)).toBe(item);
    });

    it("passes through items with empty links arrays unchanged", () => {
      const { serialize } = astroSitemapI18n({ defaultLocale: "en", locales: ["en", "pt-BR"] });
      const item = { url: "https://example.com/foo/", links: [] };
      expect(serialize!(item)).toBe(item);
    });

    it("passes through (without injecting) when no link matches the default hreflang", () => {
      // Defensive: a future @astrojs/sitemap version might emit
      // alternates without including the default locale. Returning
      // the item unchanged is safer than emitting an x-default with
      // the wrong target URL.
      const { serialize } = astroSitemapI18n({ defaultLocale: "en", locales: ["en", "pt-BR"] });
      const item = {
        url: "https://example.com/pt-BR/foo/",
        links: [
          { url: "https://example.com/pt-BR/foo/", lang: "pt-BR" },
          { url: "https://example.com/ja-JP/foo/", lang: "ja-JP" },
        ],
      };
      expect(serialize!(item)).toBe(item);
    });

    it("does not mutate the input item or its links array", () => {
      const { serialize } = astroSitemapI18n({ defaultLocale: "en", locales: ["en", "pt-BR"] });
      const links = [
        { url: "https://example.com/", lang: "en" },
        { url: "https://example.com/pt-BR/", lang: "pt-BR" },
      ];
      const item = { url: "https://example.com/", links };
      const out = serialize!(item);
      expect(item.links).toBe(links);
      expect(item.links).toHaveLength(2);
      expect(out.links).not.toBe(links);
    });

    it("omits the serialize callback when xDefault: false", () => {
      const result = astroSitemapI18n({ defaultLocale: "en", locales: ["en", "pt-BR"] }, { xDefault: false });
      expect(result.serialize).toBeUndefined();
      // i18n is still returned regardless
      expect(result.i18n.locales).toEqual({ en: "en", "pt-BR": "pt-BR" });
    });

    it("treats xDefault: undefined the same as the default (enabled)", () => {
      const result = astroSitemapI18n({ defaultLocale: "en", locales: ["en", "pt-BR"] }, { xDefault: undefined });
      expect(typeof result.serialize).toBe("function");
    });
  });

  describe("composability", () => {
    it("returns a result that's safe to spread into sitemap()", () => {
      // Smoke-test: the helper's output must merge cleanly with
      // additional sitemap options via spread. Verifies the keys are
      // exactly { i18n, serialize? } and nothing else that could
      // collide with sitemap's option surface.
      const result = astroSitemapI18n({ defaultLocale: "en", locales: ["en", "pt-BR"] });
      const composed = {
        ...result,
        filter: (page: string) => !page.includes("/draft/"),
      };
      expect(Object.keys(composed).sort()).toEqual(["filter", "i18n", "serialize"]);
    });
  });
});
