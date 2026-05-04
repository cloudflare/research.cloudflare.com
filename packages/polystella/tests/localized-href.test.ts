import { describe, expect, it } from "vitest";
import {
  resolveLocalizedHref,
  type LocalizedHrefDeps,
} from "../src/runtime/localized-href.js";

/**
 * Tests for the pure `localizedHref` helper. Mirrors the URL
 * classification rules of the build-time markdown link rewriter; the
 * suite deliberately covers the same edge cases (external URLs,
 * fragments, queries, idempotency) so the two surfaces stay
 * indistinguishable from a consumer's perspective.
 */

const DEPS: LocalizedHrefDeps = {
  defaultLocale: "en",
  // Includes the default; the helper checks "is this URL already
  // prefixed with any known locale?" against this full list.
  locales: ["en", "pt-BR", "ja-JP"],
};

describe("resolveLocalizedHref — short-circuit branches", () => {
  it("returns href unchanged when locale is undefined", () => {
    expect(resolveLocalizedHref("/Smith2017", undefined, DEPS)).toBe(
      "/Smith2017",
    );
  });

  it("returns href unchanged when locale is the empty string", () => {
    expect(resolveLocalizedHref("/Smith2017", "", DEPS)).toBe("/Smith2017");
  });

  it("returns href unchanged when locale equals defaultLocale", () => {
    // Default-locale routes live at the unprefixed root with the
    // canonical `prefixDefaultLocale: false` setup; nothing to do.
    expect(resolveLocalizedHref("/Smith2017", "en", DEPS)).toBe("/Smith2017");
  });

  it("returns href unchanged when input is empty", () => {
    expect(resolveLocalizedHref("", "pt-BR", DEPS)).toBe("");
  });
});

describe("resolveLocalizedHref — external URLs left alone", () => {
  it.each([
    ["https://example.com/x", "pt-BR"],
    ["http://example.com/x", "pt-BR"],
    ["//cdn.example.com/img.png", "pt-BR"],
    ["mailto:research@cloudflare.com", "pt-BR"],
    ["tel:+15551234567", "pt-BR"],
  ])("leaves %s unchanged for locale %s", (href, locale) => {
    expect(resolveLocalizedHref(href, locale, DEPS)).toBe(href);
  });
});

describe("resolveLocalizedHref — anchors and fragments", () => {
  it("leaves anchor-only hrefs unchanged", () => {
    expect(resolveLocalizedHref("#section-1", "pt-BR", DEPS)).toBe("#section-1");
  });

  it("preserves the fragment after the locale prefix", () => {
    expect(resolveLocalizedHref("/Smith2017#methods", "pt-BR", DEPS)).toBe(
      "/pt-BR/Smith2017#methods",
    );
  });

  it("preserves the query string after the locale prefix", () => {
    expect(resolveLocalizedHref("/search?q=privacy", "pt-BR", DEPS)).toBe(
      "/pt-BR/search?q=privacy",
    );
  });

  it("preserves both query and fragment", () => {
    expect(
      resolveLocalizedHref("/search?q=privacy#hits", "pt-BR", DEPS),
    ).toBe("/pt-BR/search?q=privacy#hits");
  });
});

describe("resolveLocalizedHref — idempotency on already-prefixed URLs", () => {
  it("leaves a URL prefixed with the target locale alone", () => {
    expect(resolveLocalizedHref("/pt-BR/Smith2017", "pt-BR", DEPS)).toBe(
      "/pt-BR/Smith2017",
    );
  });

  it("leaves a URL prefixed with a *different* declared locale alone", () => {
    // A page rendered under pt-BR that contains a deliberate link to
    // the ja-JP version of another article shouldn't get
    // double-prefixed to `/pt-BR/ja-JP/...`.
    expect(resolveLocalizedHref("/ja-JP/Smith2017", "pt-BR", DEPS)).toBe(
      "/ja-JP/Smith2017",
    );
  });

  it("leaves a URL prefixed with the default locale alone", () => {
    // Operators sometimes author `/en/...` paths explicitly to opt
    // out of locale-prefixing. Treat as already-prefixed.
    expect(resolveLocalizedHref("/en/Smith2017", "pt-BR", DEPS)).toBe(
      "/en/Smith2017",
    );
  });

  it("treats a bare `/{locale}` (no trailing slash) as already prefixed", () => {
    expect(resolveLocalizedHref("/pt-BR", "pt-BR", DEPS)).toBe("/pt-BR");
  });

  it("does NOT confuse a path that starts with locale-like text", () => {
    // `/pt-BR-foo` is NOT `/pt-BR/foo`; the path starts with text that
    // looks like the locale but isn't followed by `/`. Normal prefix.
    expect(resolveLocalizedHref("/pt-BR-foo", "pt-BR", DEPS)).toBe(
      "/pt-BR/pt-BR-foo",
    );
  });
});

describe("resolveLocalizedHref — happy path prefixing", () => {
  it("prefixes a leading-slash internal path", () => {
    expect(resolveLocalizedHref("/Smith2017", "pt-BR", DEPS)).toBe(
      "/pt-BR/Smith2017",
    );
  });

  it("prefixes a relative path (no leading slash) with one slash", () => {
    expect(resolveLocalizedHref("Smith2017", "pt-BR", DEPS)).toBe(
      "/pt-BR/Smith2017",
    );
  });

  it("preserves nested paths", () => {
    expect(resolveLocalizedHref("/people/alex-davidson", "pt-BR", DEPS)).toBe(
      "/pt-BR/people/alex-davidson",
    );
  });

  it("uses ja-JP as the prefix when locale is ja-JP", () => {
    expect(resolveLocalizedHref("/Smith2017", "ja-JP", DEPS)).toBe(
      "/ja-JP/Smith2017",
    );
  });

  it("works with an unfamiliar (not-in-locales) locale string", () => {
    // The helper doesn't validate `locale` against `deps.locales` —
    // only uses `locales` for the idempotency check. A consumer
    // passing a locale not in the declared set still gets the prefix
    // applied (with the same idempotency trade-off: the helper won't
    // recognise pre-prefixed URLs of that locale on later renders).
    expect(resolveLocalizedHref("/foo", "fr-FR", DEPS)).toBe("/fr-FR/foo");
  });
});
