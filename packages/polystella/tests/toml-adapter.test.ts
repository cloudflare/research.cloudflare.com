import { describe, expect, it } from "vitest";

import type { AdapterExtractOptions } from "../src/parsing/adapter.js";
import { tomlAdapter } from "../src/parsing/adapters/toml.js";

/**
 * TOML adapter — extract / apply / hash / noTranslate behaviour.
 *
 * Round-trip fidelity is intentionally relaxed: the staged
 * translation file is canonicalised by `smol-toml.stringify`, which
 * means comments and exact key ordering may shift. Source files are
 * never rewritten by polystella, so this only affects translation
 * outputs (regenerated each build).
 */

const SITE_TOML = `# Site-wide config consumed by FeaturedResearch.astro

[main.featuredResearch]
publication = "nikulin2026"
title = "Unweight: Lossless MLP Weight Compression"
description = "Unweight is a lossless compression system for LLM weight tensors."
link = "/nikulin2026"
buttonLabel = "Read the Full Article"
`;

function makeOpts(translatableKeys: Record<string, string[]>): AdapterExtractOptions {
  return {
    sourcePath: "site.toml",
    translatableKeys,
  };
}

describe("tomlAdapter — extension claim", () => {
  it("claims .toml exclusively", () => {
    expect(tomlAdapter.extensions).toEqual([".toml"]);
  });
});

describe("tomlAdapter — extractSegments", () => {
  it("emits one segment per configured translatable scalar", () => {
    const parsed = tomlAdapter.parse(SITE_TOML);
    const segs = tomlAdapter.extractSegments(
      parsed,
      SITE_TOML,
      makeOpts({
        "site.toml": [
          "main.featuredResearch.title",
          "main.featuredResearch.description",
          "main.featuredResearch.buttonLabel",
        ],
      }),
    );

    expect(segs).toEqual([
      { id: "main.featuredResearch.title", text: "Unweight: Lossless MLP Weight Compression" },
      {
        id: "main.featuredResearch.description",
        text: "Unweight is a lossless compression system for LLM weight tensors.",
      },
      { id: "main.featuredResearch.buttonLabel", text: "Read the Full Article" },
    ]);
  });

  it("ignores keys outside the configured rules", () => {
    const parsed = tomlAdapter.parse(SITE_TOML);
    const segs = tomlAdapter.extractSegments(
      parsed,
      SITE_TOML,
      makeOpts({
        "site.toml": ["main.featuredResearch.title"],
      }),
    );

    expect(segs).toHaveLength(1);
    expect(segs[0]?.id).toBe("main.featuredResearch.title");
  });

  it("expands wildcards against the parsed structure", () => {
    const src = `
[[publications]]
title = "First Pub"
year = 2024

[[publications]]
title = "Second Pub"
year = 2025

[[publications]]
title = "Third Pub"
year = 2026
`;
    const parsed = tomlAdapter.parse(src);
    const segs = tomlAdapter.extractSegments(parsed, src, {
      sourcePath: "publications.toml",
      translatableKeys: { "publications.toml": ["publications[*].title"] },
    });

    expect(segs.map((s) => s.id)).toEqual([
      "publications[0].title",
      "publications[1].title",
      "publications[2].title",
    ]);
    expect(segs.map((s) => s.text)).toEqual(["First Pub", "Second Pub", "Third Pub"]);
  });

  it("skips non-string values silently", () => {
    const src = `
[main.featuredResearch]
title = "Hello"
year = 2025
isPublished = true
`;
    const parsed = tomlAdapter.parse(src);
    const segs = tomlAdapter.extractSegments(
      parsed,
      src,
      makeOpts({
        "site.toml": [
          "main.featuredResearch.title",
          "main.featuredResearch.year",
          "main.featuredResearch.isPublished",
        ],
      }),
    );

    // Only the string scalar survives — numbers and booleans pass
    // through untouched (and feed `selectedValuesForHash` separately).
    expect(segs).toEqual([{ id: "main.featuredResearch.title", text: "Hello" }]);
  });

  it("skips empty strings", () => {
    const src = `[meta]\ntitle = ""\nsubtitle = "Real"\n`;
    const parsed = tomlAdapter.parse(src);
    const segs = tomlAdapter.extractSegments(
      parsed,
      src,
      makeOpts({ "site.toml": ["meta.title", "meta.subtitle"] }),
    );

    expect(segs).toEqual([{ id: "meta.subtitle", text: "Real" }]);
  });

  it("returns an empty array when no rules match the source path", () => {
    const parsed = tomlAdapter.parse(SITE_TOML);
    const segs = tomlAdapter.extractSegments(
      parsed,
      SITE_TOML,
      makeOpts({ "publications/**": ["title"] }),
    );

    expect(segs).toEqual([]);
  });
});

describe("tomlAdapter — applyTranslations", () => {
  it("writes translations at their key paths and re-stringifies", () => {
    const parsed = tomlAdapter.parse(SITE_TOML);
    const out = tomlAdapter.applyTranslations(
      parsed,
      SITE_TOML,
      new Map([
        ["main.featuredResearch.title", "Unweight: Compressão sem perdas"],
        ["main.featuredResearch.buttonLabel", "Leia o artigo completo"],
      ]),
      {},
    );

    // Re-parse the output to assert structurally (avoids depending on
    // smol-toml's exact whitespace).
    const reparsed = tomlAdapter.parse(out);
    const fr = (reparsed as { main: { featuredResearch: Record<string, unknown> } }).main.featuredResearch;
    expect(fr.title).toBe("Unweight: Compressão sem perdas");
    expect(fr.buttonLabel).toBe("Leia o artigo completo");
    // Untranslated fields preserved verbatim.
    expect(fr.publication).toBe("nikulin2026");
    expect(fr.description).toBe("Unweight is a lossless compression system for LLM weight tensors.");
    expect(fr.link).toBe("/nikulin2026");
  });

  it("injects topLevelAdditions inside each top-level object (per-entry, not at file root)", () => {
    // Astro's `file()` loader maps each top-level TOML key to a
    // separate collection entry. The marker fields therefore live
    // inside each top-level object so they become part of that
    // entry's data — file-root injection would produce bogus extra
    // entries whose data is the marker scalar.
    const parsed = tomlAdapter.parse(SITE_TOML);
    const out = tomlAdapter.applyTranslations(
      parsed,
      SITE_TOML,
      new Map([["main.featuredResearch.title", "Olá"]]),
      {
        topLevelAdditions: {
          aiTranslated: true,
          aiTranslationModel: "@cf/meta/llama-3.1-8b-instruct",
          aiTranslatedAt: "2026-05-06T10:00:00Z",
        },
      },
    );

    const reparsed = tomlAdapter.parse(out);
    // Marker fields live inside `main`, not at the file root.
    const main = (reparsed as { main: Record<string, unknown> }).main;
    expect(main.aiTranslated).toBe(true);
    expect(main.aiTranslationModel).toBe("@cf/meta/llama-3.1-8b-instruct");
    expect(main.aiTranslatedAt).toBe("2026-05-06T10:00:00Z");
    // Translation also applied.
    expect((main.featuredResearch as { title: string }).title).toBe("Olá");
    // File root has only the original top-level keys, not the marker.
    expect(reparsed).not.toHaveProperty("aiTranslated");
  });

  it("injects the marker into every top-level object-valued key (multi-entry files)", () => {
    // For TOML files with multiple top-level entries (each becomes
    // its own collection entry under the file() loader), every
    // entry gets the marker.
    const src = `
[entry-a]
title = "A"

[entry-b]
title = "B"
`;
    const parsed = tomlAdapter.parse(src);
    const out = tomlAdapter.applyTranslations(parsed, src, new Map(), {
      topLevelAdditions: { aiTranslated: true },
    });

    const reparsed = tomlAdapter.parse(out);
    expect((reparsed["entry-a"] as { aiTranslated?: boolean }).aiTranslated).toBe(true);
    expect((reparsed["entry-b"] as { aiTranslated?: boolean }).aiTranslated).toBe(true);
  });

  it("skips top-level scalar keys when injecting the marker (they're already valid entry data)", () => {
    // Top-level scalars (numbers / strings / booleans) are valid
    // entry data on their own; we have nowhere to attach the marker
    // to them.
    const src = `
version = 1
flag = true

[main]
title = "Hello"
`;
    const parsed = tomlAdapter.parse(src);
    const out = tomlAdapter.applyTranslations(parsed, src, new Map(), {
      topLevelAdditions: { aiTranslated: true },
    });

    const reparsed = tomlAdapter.parse(out);
    expect(reparsed.version).toBe(1); // untouched
    expect(reparsed.flag).toBe(true); // untouched
    expect((reparsed.main as { aiTranslated?: boolean }).aiTranslated).toBe(true); // injected
  });

  it("does not mutate the input parsed object (clone-then-mutate)", () => {
    // The cache layer parses once per source, then calls apply
    // potentially across multiple cache misses on different locales.
    // Apply MUST NOT mutate the shared parsed object — otherwise the
    // second locale would read translations from the first.
    const parsed = tomlAdapter.parse(SITE_TOML);
    const before = JSON.stringify(parsed);

    tomlAdapter.applyTranslations(
      parsed,
      SITE_TOML,
      new Map([["main.featuredResearch.title", "MUTATED"]]),
      {},
    );

    expect(JSON.stringify(parsed)).toBe(before);
  });

  it("output is parseable by smol-toml (round-trip integrity)", () => {
    const parsed = tomlAdapter.parse(SITE_TOML);
    const out = tomlAdapter.applyTranslations(
      parsed,
      SITE_TOML,
      new Map([["main.featuredResearch.title", "Olá"]]),
      { topLevelAdditions: { aiTranslated: true } },
    );

    expect(() => tomlAdapter.parse(out)).not.toThrow();
  });

  it("throws on translations targeting a path that doesn't exist in source", () => {
    const parsed = tomlAdapter.parse(SITE_TOML);
    expect(() =>
      tomlAdapter.applyTranslations(
        parsed,
        SITE_TOML,
        new Map([["main.totally.bogus.key", "uh oh"]]),
        {},
      ),
    ).toThrow();
  });
});

describe("tomlAdapter — selectedValuesForHash", () => {
  it("captures translatable keys' values for cache-key composition", () => {
    const parsed = tomlAdapter.parse(SITE_TOML);
    const values = tomlAdapter.selectedValuesForHash(
      parsed,
      SITE_TOML,
      makeOpts({
        "site.toml": [
          "main.featuredResearch.title",
          "main.featuredResearch.description",
        ],
      }),
    );

    expect(values).toEqual({
      "main.featuredResearch.title": "Unweight: Lossless MLP Weight Compression",
      "main.featuredResearch.description": "Unweight is a lossless compression system for LLM weight tensors.",
    });
  });

  it("captures non-string translatable keys too (numbers, booleans)", () => {
    // The hash should bust on `year: 2025 → 2026` even though the
    // year isn't a translation target — it's still listed in the
    // rules, so a value change MUST invalidate the cache.
    const src = `[meta]\ntitle = "Hello"\nyear = 2025\nactive = true\n`;
    const parsed = tomlAdapter.parse(src);
    const values = tomlAdapter.selectedValuesForHash(
      parsed,
      src,
      makeOpts({ "site.toml": ["meta.title", "meta.year", "meta.active"] }),
    );

    expect(values).toEqual({
      "meta.title": "Hello",
      "meta.year": 2025,
      "meta.active": true,
    });
  });

  it("omits absent keys silently (don't bust cache on optional fields not present)", () => {
    const src = `[meta]\ntitle = "Hello"\n`;
    const parsed = tomlAdapter.parse(src);
    const values = tomlAdapter.selectedValuesForHash(
      parsed,
      src,
      makeOpts({ "site.toml": ["meta.title", "meta.subtitle"] }),
    );

    expect(values).toEqual({ "meta.title": "Hello" });
  });
});

describe("tomlAdapter — peekNoTranslate", () => {
  it("returns true when top-level noTranslate = true", () => {
    const parsed = tomlAdapter.parse(`noTranslate = true\n[meta]\ntitle = "x"\n`);
    expect(tomlAdapter.peekNoTranslate(parsed)).toBe(true);
  });

  it("returns false when noTranslate is absent", () => {
    const parsed = tomlAdapter.parse(SITE_TOML);
    expect(tomlAdapter.peekNoTranslate(parsed)).toBe(false);
  });

  it("returns false when noTranslate = false explicitly", () => {
    const parsed = tomlAdapter.parse(`noTranslate = false\n[meta]\ntitle = "x"\n`);
    expect(tomlAdapter.peekNoTranslate(parsed)).toBe(false);
  });

  it("returns false for non-boolean noTranslate (TOML's stricter typing means no string aliases)", () => {
    // TOML doesn't have YAML's flexible boolean parsing — `"true"`
    // is a string, not a boolean. We only honor literal `true`.
    const parsed = tomlAdapter.parse(`noTranslate = "true"\n[meta]\ntitle = "x"\n`);
    expect(tomlAdapter.peekNoTranslate(parsed)).toBe(false);
  });
});

describe("tomlAdapter — cache-key behaviour", () => {
  it("translatable-value edits change selectedValuesForHash output", () => {
    const before = tomlAdapter.parse(SITE_TOML);
    const after = tomlAdapter.parse(SITE_TOML.replace("Unweight: Lossless", "DIFFERENT TITLE"));

    const opts = makeOpts({ "site.toml": ["main.featuredResearch.title"] });
    const v1 = tomlAdapter.selectedValuesForHash(before, SITE_TOML, opts);
    const v2 = tomlAdapter.selectedValuesForHash(after, SITE_TOML, opts);

    expect(JSON.stringify(v1)).not.toBe(JSON.stringify(v2));
  });

  it("non-translatable-key edits don't change selectedValuesForHash output", () => {
    // `link` isn't in `translatableKeys`, so an edit to it must not
    // change the selected-values snapshot. (Today the wider source-
    // bytes input still busts the runtime hash; M3 documents this
    // structured-data variant as future work.)
    const before = tomlAdapter.parse(SITE_TOML);
    const after = tomlAdapter.parse(SITE_TOML.replace("/nikulin2026", "/different-link"));

    const opts = makeOpts({
      "site.toml": ["main.featuredResearch.title", "main.featuredResearch.description"],
    });
    const v1 = tomlAdapter.selectedValuesForHash(before, SITE_TOML, opts);
    const v2 = tomlAdapter.selectedValuesForHash(after, SITE_TOML, opts);

    expect(JSON.stringify(v1)).toBe(JSON.stringify(v2));
  });

  it("comment edits don't change selectedValuesForHash output", () => {
    const withComment = tomlAdapter.parse(SITE_TOML);
    const noComment = tomlAdapter.parse(SITE_TOML.replace(/^# .*\n/m, ""));

    const opts = makeOpts({
      "site.toml": ["main.featuredResearch.title", "main.featuredResearch.description"],
    });
    const v1 = tomlAdapter.selectedValuesForHash(withComment, SITE_TOML, opts);
    const v2 = tomlAdapter.selectedValuesForHash(noComment, SITE_TOML, opts);

    expect(JSON.stringify(v1)).toBe(JSON.stringify(v2));
  });
});

describe("tomlAdapter — rewriteUrls", () => {
  // The post-cache URL rewriter. Operates on serialised bytes, parses
  // them, walks configured URL paths, applies the rewriter, and
  // re-serialises. Cached bytes are URL-rewrite-naïve so a config
  // change to `noPrefixUrls` doesn't bust them.

  const localePrefix = (url: string) => (url.startsWith("/") ? `/pt-BR${url}` : `/pt-BR/${url}`);

  it("rewrites a single URL path", () => {
    const out = tomlAdapter.rewriteUrls!(SITE_TOML, {
      paths: ["main.featuredResearch.link"],
      rewriter: (url) => (url.startsWith("/") ? localePrefix(url) : null),
    });
    expect(out).toContain('link = "/pt-BR/nikulin2026"');
    // Unrelated translatable scalars stay verbatim.
    expect(out).toContain('title = "Unweight: Lossless MLP Weight Compression"');
  });

  it("returns input bytes unchanged when paths list is empty", () => {
    const out = tomlAdapter.rewriteUrls!(SITE_TOML, {
      paths: [],
      rewriter: () => "/should-not-be-called",
    });
    expect(out).toBe(SITE_TOML);
  });

  it("returns input bytes unchanged when no path matches", () => {
    const out = tomlAdapter.rewriteUrls!(SITE_TOML, {
      paths: ["main.featuredResearch.nonExistentKey"],
      rewriter: () => "/anything",
    });
    expect(out).toBe(SITE_TOML);
  });

  it("returns input bytes unchanged when rewriter returns null", () => {
    // External URLs / anchors return null in the real rewriter.
    // Mirroring that here, the adapter should leave bytes alone when
    // every matched value passes the rewriter unmodified.
    const out = tomlAdapter.rewriteUrls!(SITE_TOML, {
      paths: ["main.featuredResearch.link"],
      rewriter: () => null,
    });
    expect(out).toBe(SITE_TOML);
  });

  it("skips non-string values without throwing", () => {
    // A configured URL path could legally point at a non-string value
    // if the operator misconfigured. Pass through unchanged.
    const tomlWithNumber = `[main.featuredResearch]
link = 42
`;
    const out = tomlAdapter.rewriteUrls!(tomlWithNumber, {
      paths: ["main.featuredResearch.link"],
      rewriter: () => "/anything",
    });
    expect(out).toBe(tomlWithNumber);
  });

  it("expands wildcard paths against the parsed structure", () => {
    const tomlWithArray = `[main]
[[main.items]]
url = "/foo"

[[main.items]]
url = "/bar"

[[main.items]]
url = "/baz"
`;
    const out = tomlAdapter.rewriteUrls!(tomlWithArray, {
      paths: ["main.items[*].url"],
      rewriter: (url) => `/pt-BR${url}`,
    });
    expect(out).toContain('url = "/pt-BR/foo"');
    expect(out).toContain('url = "/pt-BR/bar"');
    expect(out).toContain('url = "/pt-BR/baz"');
  });

  it("is idempotent on already-rewritten bytes when the rewriter returns null for prefixed paths", () => {
    // Mirroring `rewriteUrlIfInternal`'s actual behaviour: paths
    // already prefixed with a known locale return null. So a second
    // pass over the staged bytes is a no-op.
    const stagedOnce = tomlAdapter.rewriteUrls!(SITE_TOML, {
      paths: ["main.featuredResearch.link"],
      rewriter: (url) => (url.startsWith("/pt-BR/") ? null : `/pt-BR${url}`),
    });
    const stagedTwice = tomlAdapter.rewriteUrls!(stagedOnce, {
      paths: ["main.featuredResearch.link"],
      rewriter: (url) => (url.startsWith("/pt-BR/") ? null : `/pt-BR${url}`),
    });
    expect(stagedTwice).toBe(stagedOnce);
  });
});
