import { describe, expect, it, vi } from "vitest";

import {
  buildLocalizedHref,
  buildTranslator,
  createMiddleware,
  type MiddlewareDeps,
} from "../src/runtime/middleware-core.js";

/**
 * Tests for the polystella request middleware. Exercises the
 * deps-injected `createMiddleware` so we never need to provide the
 * `polystella:runtime-config` / `astro:content` virtual modules in
 * vitest. The production wrapper `polystellaMiddleware()` is a thin
 * delegate that closes over those imports — its behaviour is
 * identical to `createMiddleware` once the deps resolve.
 */

const PT_BR_DICT = { "nav.home": "Início", greeting: "Olá, {{name}}" };
const EN_DICT = { "nav.home": "Home", greeting: "Hi, {{name}}" };

function makeGetEntry(entries: Record<string, Record<string, string> | undefined>): MiddlewareDeps["getEntry"] {
  return vi.fn(async (collection: string, slug: string) => {
    const data = entries[`${collection}:${slug}`];
    return data === undefined ? undefined : { data };
  });
}

function makeDeps(overrides: Partial<MiddlewareDeps> = {}): MiddlewareDeps {
  return {
    defaultLocale: "en",
    locales: ["en", "pt-BR", "ja-JP"],
    noPrefixUrls: [],
    mode: "auto",
    getEntry: makeGetEntry({
      "i18n:en": EN_DICT,
      "i18n:pt-br": PT_BR_DICT,
    }),
    ...overrides,
  };
}

function makeContext(currentLocale: string | undefined) {
  return {
    currentLocale,
    locals: {} as Record<string, unknown>,
  };
}

describe("buildLocalizedHref — locale-bound closure", () => {
  it("rewrites internal paths for the bound locale", () => {
    const link = buildLocalizedHref("pt-BR", { defaultLocale: "en", locales: ["en", "pt-BR"], noPrefixUrls: [] });
    expect(link("/foo")).toBe("/pt-BR/foo");
    expect(link("/foo/bar?ref=home")).toBe("/pt-BR/foo/bar?ref=home");
  });

  it("returns externals untouched", () => {
    const link = buildLocalizedHref("pt-BR", { defaultLocale: "en", locales: ["en", "pt-BR"], noPrefixUrls: [] });
    expect(link("https://example.com/foo")).toBe("https://example.com/foo");
    expect(link("#section")).toBe("#section");
  });

  it("honours noPrefixUrls", () => {
    const link = buildLocalizedHref("pt-BR", { defaultLocale: "en", locales: ["en", "pt-BR"], noPrefixUrls: ["/api-docs/**"] });
    expect(link("/api-docs/intro")).toBe("/api-docs/intro");
    expect(link("/blog")).toBe("/pt-BR/blog");
  });

  it("returns input unchanged for the default locale", () => {
    const link = buildLocalizedHref("en", { defaultLocale: "en", locales: ["en", "pt-BR"], noPrefixUrls: [] });
    expect(link("/foo")).toBe("/foo");
  });
});

describe("buildTranslator — locale fallback chain", () => {
  it("returns the visitor-locale dictionary when present", async () => {
    const t = await buildTranslator("pt-BR", {
      defaultLocale: "en",
      getEntry: makeGetEntry({ "i18n:en": EN_DICT, "i18n:pt-br": PT_BR_DICT }),
    });
    expect(t("nav.home")).toBe("Início");
    expect(t("greeting", { name: "Diogo" })).toBe("Olá, Diogo");
  });

  it("falls back to the default-locale dictionary on missing visitor entry", async () => {
    const t = await buildTranslator("ja-JP", {
      defaultLocale: "en",
      getEntry: makeGetEntry({ "i18n:en": EN_DICT, "i18n:ja-jp": undefined }),
    });
    expect(t("nav.home")).toBe("Home");
  });

  it("returns the literal key when no dictionary loads", async () => {
    const t = await buildTranslator("xx", {
      defaultLocale: "en",
      getEntry: makeGetEntry({}),
    });
    expect(t("any.key")).toBe("any.key");
  });

  it("returns the literal key when the loader throws", async () => {
    const t = await buildTranslator("pt-BR", {
      defaultLocale: "en",
      getEntry: vi.fn().mockRejectedValue(new Error("boom")),
    });
    expect(t("nav.home")).toBe("nav.home");
  });

  it("lowercases the visitor locale for the entry lookup", async () => {
    // Astro stores entry IDs lowercased; `Astro.currentLocale` keeps
    // the configured casing. The translator bridges that gap.
    const getEntry = makeGetEntry({ "i18n:en": EN_DICT, "i18n:pt-br": PT_BR_DICT });
    const t = await buildTranslator("PT-BR", { defaultLocale: "en", getEntry });
    expect(t("nav.home")).toBe("Início");
  });

  it("falls back to default locale when the visitor locale is empty / undefined", async () => {
    const getEntry = makeGetEntry({ "i18n:en": EN_DICT });
    const t1 = await buildTranslator(undefined, { defaultLocale: "en", getEntry });
    expect(t1("nav.home")).toBe("Home");
    const t2 = await buildTranslator("", { defaultLocale: "en", getEntry });
    expect(t2("nav.home")).toBe("Home");
  });
});

describe("createMiddleware — locals population", () => {
  it("sets both locals.t and locals.lhref in standalone/auto mode", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const middleware = createMiddleware(makeDeps({ mode: "auto" }));
    const ctx = makeContext("pt-BR");

    await middleware(ctx, next);

    expect(typeof ctx.locals.t).toBe("function");
    expect(typeof ctx.locals.lhref).toBe("function");
    expect(next).toHaveBeenCalledTimes(1);

    expect((ctx.locals.t as (k: string) => string)("nav.home")).toBe("Início");
    expect((ctx.locals.lhref as (h: string) => string)("/foo")).toBe("/pt-BR/foo");
  });

  it("skips locals.t in starlight mode but still sets lhref", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const middleware = createMiddleware(makeDeps({ mode: "starlight" }));
    const ctx = makeContext("pt-BR");

    await middleware(ctx, next);

    // Starlight installs its own `t` via i18next; we don't touch it.
    expect(ctx.locals.t).toBeUndefined();
    expect(typeof ctx.locals.lhref).toBe("function");
    expect(next).toHaveBeenCalled();
  });

  it("does not call getEntry in starlight mode (avoids unnecessary work)", async () => {
    const getEntry = makeGetEntry({ "i18n:en": EN_DICT });
    const middleware = createMiddleware(makeDeps({ mode: "starlight", getEntry }));
    await middleware(makeContext("pt-BR"), vi.fn());
    expect(getEntry).not.toHaveBeenCalled();
  });

  it("calls next() exactly once even when t-resolution throws under the hood", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const middleware = createMiddleware(
      makeDeps({
        getEntry: vi.fn().mockRejectedValue(new Error("getEntry blew up")),
      }),
    );
    const ctx = makeContext("pt-BR");

    await middleware(ctx, next);

    // Failed dictionary load → passthrough t (returns the literal
    // key) — and the request still proceeds.
    expect(typeof ctx.locals.t).toBe("function");
    expect((ctx.locals.t as (k: string) => string)("any.key")).toBe("any.key");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("threads noPrefixUrls into lhref", async () => {
    const middleware = createMiddleware(makeDeps({ noPrefixUrls: ["/api-docs/**"] }));
    const ctx = makeContext("pt-BR");
    await middleware(ctx, vi.fn());
    const link = ctx.locals.lhref as (h: string) => string;
    expect(link("/api-docs/intro")).toBe("/api-docs/intro");
    expect(link("/blog")).toBe("/pt-BR/blog");
  });

  it("works for the default locale (no prefix added)", async () => {
    const middleware = createMiddleware(makeDeps());
    const ctx = makeContext("en");
    await middleware(ctx, vi.fn());
    const link = ctx.locals.lhref as (h: string) => string;
    expect(link("/foo")).toBe("/foo");
    const t = ctx.locals.t as (k: string) => string;
    expect(t("nav.home")).toBe("Home");
  });

  it("works when currentLocale is undefined (treated as default)", async () => {
    const middleware = createMiddleware(makeDeps());
    const ctx = makeContext(undefined);
    await middleware(ctx, vi.fn());
    const link = ctx.locals.lhref as (h: string) => string;
    expect(link("/foo")).toBe("/foo");
    const t = ctx.locals.t as (k: string) => string;
    expect(t("nav.home")).toBe("Home");
  });
});
