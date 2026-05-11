import { describe, expect, it, vi } from "vitest";

import {
  bindGetLocalizedCollection,
  bindGetLocalizedEntry,
  buildLocalizedHref,
  buildTranslator,
  createMiddleware,
  type MiddlewareDeps,
} from "../src/runtime/middleware-core.js";
import type { SourceEntryShape } from "../src/runtime/get-localized-entry.js";

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

/**
 * Build a stub for `deps.getEntry` from a name→data map. Wraps each
 * entry as a `SourceEntryShape` with a synthetic `id` (the slug)
 * and `collection`. Both the i18n translator (which only reads
 * `.data`) and the `bindGetLocalizedEntry` consumer (which reads
 * the full shape) work against the same stub.
 */
function makeGetEntry(
  entries: Record<string, Record<string, unknown> | undefined>,
): MiddlewareDeps["getEntry"] {
  return vi.fn(async (collection: string, slug: string) => {
    const data = entries[`${collection}:${slug}`];
    if (data === undefined) return undefined;
    return { collection, id: slug, data };
  });
}

/**
 * Build a stub for `deps.getCollection`. Returns the entries
 * registered under the collection name (verbatim — the test owns
 * their `id` / `collection` / `data` shape).
 */
function makeGetCollection(
  collections: Record<string, SourceEntryShape[]>,
): MiddlewareDeps["getCollection"] {
  return vi.fn(async (collection: string) => collections[collection] ?? []);
}

function makeDeps(overrides: Partial<MiddlewareDeps> = {}): MiddlewareDeps {
  return {
    defaultLocale: "en-US",
    locales: ["en-US", "pt-BR", "ja-JP"],
    noPrefixUrls: [],
    mode: "auto",
    getEntry: makeGetEntry({
      "i18n:en-us": EN_DICT,
      "i18n:pt-br": PT_BR_DICT,
    }),
    getCollection: makeGetCollection({}),
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
    const link = buildLocalizedHref("pt-BR", { defaultLocale: "en-US", locales: ["en-US", "pt-BR"], noPrefixUrls: [] });
    expect(link("/foo")).toBe("/pt-BR/foo");
    expect(link("/foo/bar?ref=home")).toBe("/pt-BR/foo/bar?ref=home");
  });

  it("returns externals untouched", () => {
    const link = buildLocalizedHref("pt-BR", { defaultLocale: "en-US", locales: ["en-US", "pt-BR"], noPrefixUrls: [] });
    expect(link("https://example.com/foo")).toBe("https://example.com/foo");
    expect(link("#section")).toBe("#section");
  });

  it("honours noPrefixUrls", () => {
    const link = buildLocalizedHref("pt-BR", { defaultLocale: "en-US", locales: ["en-US", "pt-BR"], noPrefixUrls: ["/api-docs/**"] });
    expect(link("/api-docs/intro")).toBe("/api-docs/intro");
    expect(link("/blog")).toBe("/pt-BR/blog");
  });

  it("returns input unchanged for the default locale", () => {
    const link = buildLocalizedHref("en-US", { defaultLocale: "en-US", locales: ["en-US", "pt-BR"], noPrefixUrls: [] });
    expect(link("/foo")).toBe("/foo");
  });
});

describe("buildTranslator — locale fallback chain", () => {
  it("returns the visitor-locale dictionary when present", async () => {
    const t = await buildTranslator("pt-BR", {
      defaultLocale: "en-US",
      getEntry: makeGetEntry({ "i18n:en-us": EN_DICT, "i18n:pt-br": PT_BR_DICT }),
    });
    expect(t("nav.home")).toBe("Início");
    expect(t("greeting", { name: "Diogo" })).toBe("Olá, Diogo");
  });

  it("falls back to the default-locale dictionary on missing visitor entry", async () => {
    const t = await buildTranslator("ja-JP", {
      defaultLocale: "en-US",
      getEntry: makeGetEntry({ "i18n:en-us": EN_DICT, "i18n:ja-jp": undefined }),
    });
    expect(t("nav.home")).toBe("Home");
  });

  it("returns the literal key when no dictionary loads", async () => {
    const t = await buildTranslator("xx", {
      defaultLocale: "en-US",
      getEntry: makeGetEntry({}),
    });
    expect(t("any.key")).toBe("any.key");
  });

  it("returns the literal key when the loader throws", async () => {
    const t = await buildTranslator("pt-BR", {
      defaultLocale: "en-US",
      getEntry: vi.fn().mockRejectedValue(new Error("boom")),
    });
    expect(t("nav.home")).toBe("nav.home");
  });

  it("lowercases the visitor locale for the entry lookup", async () => {
    // Astro stores entry IDs lowercased; `Astro.currentLocale` keeps
    // the configured casing. The translator bridges that gap.
    const getEntry = makeGetEntry({ "i18n:en-us": EN_DICT, "i18n:pt-br": PT_BR_DICT });
    const t = await buildTranslator("PT-BR", { defaultLocale: "en-US", getEntry });
    expect(t("nav.home")).toBe("Início");
  });

  it("falls back to default locale when the visitor locale is empty / undefined", async () => {
    const getEntry = makeGetEntry({ "i18n:en-us": EN_DICT });
    const t1 = await buildTranslator(undefined, { defaultLocale: "en-US", getEntry });
    expect(t1("nav.home")).toBe("Home");
    const t2 = await buildTranslator("", { defaultLocale: "en-US", getEntry });
    expect(t2("nav.home")).toBe("Home");
  });
});

describe("bindGetLocalizedEntry — locale-bound entry fetcher", () => {
  it("closes over the bound locale (sibling-hit case)", async () => {
    const getEntry = makeGetEntry({
      "publications__pt-BR:foo": { title: "Translated" },
    });
    const get = bindGetLocalizedEntry("pt-BR", { defaultLocale: "en-US", getEntry });

    const result = await get("publications", "foo");
    expect(result?.isLocalized).toBe(true);
    expect(result?.locale).toBe("pt-BR");
    expect(result?.data.title).toBe("Translated");
  });

  it("supports the ref overload", async () => {
    const getEntry = makeGetEntry({
      "publications__pt-BR:foo": { title: "Translated" },
    });
    const get = bindGetLocalizedEntry("pt-BR", { defaultLocale: "en-US", getEntry });

    const result = await get({ collection: "publications", id: "foo" });
    expect(result?.data.title).toBe("Translated");
  });

  it("returns the source entry on the default-locale path", async () => {
    const getEntry = makeGetEntry({
      "publications:foo": { title: "Source" },
    });
    const get = bindGetLocalizedEntry("en-US", { defaultLocale: "en-US", getEntry });

    const result = await get("publications", "foo");
    expect(result?.isLocalized).toBe(false);
    expect(result?.locale).toBe("en-US");
    expect(result?.data.title).toBe("Source");
  });

  it("does not probe siblings when the bound locale is undefined", async () => {
    const getEntry = makeGetEntry({
      "publications:foo": { title: "Source" },
    });
    const get = bindGetLocalizedEntry(undefined, { defaultLocale: "en-US", getEntry });

    await get("publications", "foo");
    expect(getEntry).toHaveBeenCalledTimes(1);
    expect(getEntry).toHaveBeenCalledWith("publications", "foo");
  });

  it("propagates fallback / noTranslateBehavior through the binding", async () => {
    const getEntry = makeGetEntry({
      "publications:foo": { title: "Universal", noTranslate: true },
    });
    const get = bindGetLocalizedEntry("pt-BR", {
      defaultLocale: "en-US",
      noTranslateBehavior: "404",
      getEntry,
    });

    const result = await get("publications", "foo");
    expect(result).toBeUndefined();
  });
});

describe("bindGetLocalizedCollection — locale-bound collection fetcher", () => {
  it("merges sibling and source entries under the bound locale", async () => {
    const getCollection = makeGetCollection({
      publications: [
        { collection: "publications", id: "a", data: { title: "A (en)" } },
        { collection: "publications", id: "b", data: { title: "B (en)" } },
      ],
      "publications__pt-BR": [
        { collection: "publications__pt-BR", id: "b", data: { title: "B (pt-BR)" } },
      ],
    });
    const get = bindGetLocalizedCollection("pt-BR", { defaultLocale: "en-US", getCollection });

    const result = await get("publications");
    expect(result).toHaveLength(2);
    expect(result[0]?.isLocalized).toBe(false);
    expect(result[1]?.isLocalized).toBe(true);
    expect(result[1]?.data.title).toBe("B (pt-BR)");
  });

  it("forwards the filter to the resolver (sees merged shape)", async () => {
    const getCollection = makeGetCollection({
      publications: [
        { collection: "publications", id: "a", data: {} },
        { collection: "publications", id: "b", data: {} },
      ],
      "publications__pt-BR": [
        { collection: "publications__pt-BR", id: "a", data: {} },
      ],
    });
    const get = bindGetLocalizedCollection("pt-BR", { defaultLocale: "en-US", getCollection });

    // Filter only entries that came from a sibling translation.
    const result = await get("publications", (e) => e.isLocalized);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("a");
  });

  it("returns the full source list with isLocalized=false on the default-locale path", async () => {
    const getCollection = makeGetCollection({
      publications: [
        { collection: "publications", id: "a", data: {} },
        { collection: "publications", id: "b", data: {} },
      ],
    });
    const get = bindGetLocalizedCollection("en-US", { defaultLocale: "en-US", getCollection });

    const result = await get("publications");
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.isLocalized === false)).toBe(true);
    // Default-locale path issues a single getCollection call.
    expect(getCollection).toHaveBeenCalledTimes(1);
    expect(getCollection).toHaveBeenCalledWith("publications");
  });
});

describe("createMiddleware — locals population", () => {
  it("sets t, lhref, getLocalizedEntry, getLocalizedCollection in standalone/auto mode", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const middleware = createMiddleware(makeDeps({ mode: "auto" }));
    const ctx = makeContext("pt-BR");

    await middleware(ctx, next);

    expect(typeof ctx.locals.t).toBe("function");
    expect(typeof ctx.locals.lhref).toBe("function");
    expect(typeof ctx.locals.getLocalizedEntry).toBe("function");
    expect(typeof ctx.locals.getLocalizedCollection).toBe("function");
    expect(next).toHaveBeenCalledTimes(1);

    expect((ctx.locals.t as (k: string) => string)("nav.home")).toBe("Início");
    expect((ctx.locals.lhref as (h: string) => string)("/foo")).toBe("/pt-BR/foo");
  });

  it("skips locals.t in starlight mode but still sets the others", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const middleware = createMiddleware(makeDeps({ mode: "starlight" }));
    const ctx = makeContext("pt-BR");

    await middleware(ctx, next);

    // Starlight installs its own `t` via i18next; we don't touch it.
    expect(ctx.locals.t).toBeUndefined();
    // But lhref + the content-fetcher bindings still install — they
    // don't conflict with anything Starlight provides.
    expect(typeof ctx.locals.lhref).toBe("function");
    expect(typeof ctx.locals.getLocalizedEntry).toBe("function");
    expect(typeof ctx.locals.getLocalizedCollection).toBe("function");
    expect(next).toHaveBeenCalled();
  });

  it("does not call getEntry in starlight mode (avoids unnecessary work for the translator)", async () => {
    // The translator's `getEntry` probe is the only mode-conditional
    // call; the entry/collection bindings don't touch `getEntry` /
    // `getCollection` until they're invoked from page code.
    const getEntry = makeGetEntry({ "i18n:en-us": EN_DICT });
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
    const ctx = makeContext("en-US");
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

  it("locale closure isolates per-request: two contexts get independent bindings", async () => {
    // Each request gets its own bound closures — proves the
    // middleware doesn't carry state across invocations.
    const getCollection = makeGetCollection({
      people: [
        { collection: "people", id: "alice", data: { title: "Alice (en)" } },
      ],
      "people__pt-BR": [
        { collection: "people__pt-BR", id: "alice", data: { title: "Alice (pt-BR)" } },
      ],
    });
    const middleware = createMiddleware(makeDeps({ getCollection }));

    const ctxEn = makeContext("en-US");
    const ctxPt = makeContext("pt-BR");
    await middleware(ctxEn, vi.fn());
    await middleware(ctxPt, vi.fn());

    type Bound = (collection: string) => Promise<Array<{ data: { title: string }; isLocalized: boolean; locale: string }>>;
    const enList = await (ctxEn.locals.getLocalizedCollection as Bound)("people");
    const ptList = await (ctxPt.locals.getLocalizedCollection as Bound)("people");

    expect(enList[0]?.isLocalized).toBe(false);
    expect(enList[0]?.data.title).toBe("Alice (en)");
    expect(ptList[0]?.isLocalized).toBe(true);
    expect(ptList[0]?.data.title).toBe("Alice (pt-BR)");
  });

  it("getLocalizedEntry binding resolves the bound locale on the cross-locale path", async () => {
    const getEntry = makeGetEntry({
      "publications__pt-BR:foo": { title: "Translated" },
    });
    const middleware = createMiddleware(makeDeps({ getEntry }));
    const ctx = makeContext("pt-BR");
    await middleware(ctx, vi.fn());

    type Bound = (collection: string, id: string) => Promise<{ isLocalized: boolean; locale: string; data: { title: string } } | undefined>;
    const result = await (ctx.locals.getLocalizedEntry as Bound)("publications", "foo");
    expect(result?.isLocalized).toBe(true);
    expect(result?.locale).toBe("pt-BR");
    expect(result?.data.title).toBe("Translated");
  });
});
