import { describe, expect, it } from "vitest";

import type { AdapterExtractOptions } from "../src/parsing/adapter.js";
import { jsonAdapter } from "../src/parsing/adapters/json.js";

/**
 * JSON adapter — extract / apply / hash / noTranslate / URL-rewrite
 * behaviour. Mirrors `toml-adapter.test.ts`; differences are called
 * out per-test (e.g. JSON has no comments, has top-level array
 * support, no ISO-date auto-parsing).
 *
 * Round-trip fidelity is intentionally relaxed: `JSON.stringify(_, null, 2)`
 * canonicalises output (key order preserved by spec, but indent /
 * trailing newline normalised). Source files are never rewritten.
 */

const SITE_JSON = JSON.stringify(
  {
    main: {
      featuredResearch: {
        publication: "nikulin2026",
        title: "Unweight: Lossless MLP Weight Compression",
        description: "Unweight is a lossless compression system for LLM weight tensors.",
        link: "/nikulin2026",
        buttonLabel: "Read the Full Article",
      },
    },
  },
  null,
  2,
);

function makeOpts(translatableKeys: Record<string, string[]>, sourcePath = "site.json"): AdapterExtractOptions {
  return { sourcePath, translatableKeys };
}

describe("jsonAdapter — extension claim", () => {
  it("claims .json exclusively", () => {
    expect(jsonAdapter.extensions).toEqual([".json"]);
  });
});

describe("jsonAdapter — extractSegments", () => {
  it("emits one segment per configured translatable scalar", () => {
    const parsed = jsonAdapter.parse(SITE_JSON);
    const segs = jsonAdapter.extractSegments(
      parsed,
      SITE_JSON,
      makeOpts({
        "site.json": ["main.featuredResearch.title", "main.featuredResearch.description", "main.featuredResearch.buttonLabel"],
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
    const parsed = jsonAdapter.parse(SITE_JSON);
    const segs = jsonAdapter.extractSegments(parsed, SITE_JSON, makeOpts({ "site.json": ["main.featuredResearch.title"] }));

    expect(segs).toHaveLength(1);
    expect(segs[0]?.id).toBe("main.featuredResearch.title");
  });

  it("expands wildcards against array roots (top-level array)", () => {
    // JSON with a top-level array — Astro's file() loader uses each
    // element's `id`/`slug` as the entry id. Wildcards over the
    // array let the user target every element uniformly.
    const src = JSON.stringify(
      [
        { id: "a", title: "First Pub", year: 2024 },
        { id: "b", title: "Second Pub", year: 2025 },
        { id: "c", title: "Third Pub", year: 2026 },
      ],
      null,
      2,
    );
    const parsed = jsonAdapter.parse(src);
    const segs = jsonAdapter.extractSegments(parsed, src, {
      sourcePath: "publications.json",
      translatableKeys: { "publications.json": ["[*].title"] },
    });

    expect(segs.map((s) => s.id)).toEqual(["[0].title", "[1].title", "[2].title"]);
    expect(segs.map((s) => s.text)).toEqual(["First Pub", "Second Pub", "Third Pub"]);
  });

  it("expands wildcards over nested object structures", () => {
    const src = JSON.stringify({
      paths: {
        foo: { summary: "Foo summary" },
        bar: { summary: "Bar summary" },
      },
    });
    const parsed = jsonAdapter.parse(src);
    const segs = jsonAdapter.extractSegments(parsed, src, {
      sourcePath: "openapi.json",
      translatableKeys: { "openapi.json": ["paths.*.summary"] },
    });

    expect(segs.map((s) => s.id).sort()).toEqual(["paths.bar.summary", "paths.foo.summary"]);
  });

  it("skips non-string values silently", () => {
    const src = JSON.stringify({ meta: { title: "Hello", year: 2025, isPublished: true, count: null } });
    const parsed = jsonAdapter.parse(src);
    const segs = jsonAdapter.extractSegments(
      parsed,
      src,
      makeOpts({ "site.json": ["meta.title", "meta.year", "meta.isPublished", "meta.count"] }),
    );

    expect(segs).toEqual([{ id: "meta.title", text: "Hello" }]);
  });

  it("skips empty strings", () => {
    const src = JSON.stringify({ meta: { title: "", subtitle: "Real" } });
    const parsed = jsonAdapter.parse(src);
    const segs = jsonAdapter.extractSegments(parsed, src, makeOpts({ "site.json": ["meta.title", "meta.subtitle"] }));

    expect(segs).toEqual([{ id: "meta.subtitle", text: "Real" }]);
  });

  it("returns an empty array when no rules match the source path", () => {
    const parsed = jsonAdapter.parse(SITE_JSON);
    const segs = jsonAdapter.extractSegments(parsed, SITE_JSON, makeOpts({ "publications/**": ["title"] }));
    expect(segs).toEqual([]);
  });
});

describe("jsonAdapter — applyTranslations", () => {
  it("writes translations at their key paths and re-stringifies with 2-space indent", () => {
    const parsed = jsonAdapter.parse(SITE_JSON);
    const out = jsonAdapter.applyTranslations(
      parsed,
      SITE_JSON,
      new Map([
        ["main.featuredResearch.title", "Unweight: Compressão sem perdas"],
        ["main.featuredResearch.buttonLabel", "Leia o artigo completo"],
      ]),
      {},
    );

    const reparsed = jsonAdapter.parse(out) as { main: { featuredResearch: Record<string, unknown> } };
    expect(reparsed.main.featuredResearch.title).toBe("Unweight: Compressão sem perdas");
    expect(reparsed.main.featuredResearch.buttonLabel).toBe("Leia o artigo completo");
    expect(reparsed.main.featuredResearch.publication).toBe("nikulin2026");
    expect(reparsed.main.featuredResearch.link).toBe("/nikulin2026");

    // Stable indent.
    expect(out).toMatch(/^\{\n {2}"main": \{/);
  });

  it("injects topLevelAdditions inside each top-level object (per-entry)", () => {
    const parsed = jsonAdapter.parse(SITE_JSON);
    const out = jsonAdapter.applyTranslations(parsed, SITE_JSON, new Map([["main.featuredResearch.title", "Olá"]]), {
      topLevelAdditions: {
        aiTranslated: true,
        aiTranslationModel: "@cf/meta/llama-3.1-8b-instruct",
        aiTranslatedAt: "2026-05-07T10:00:00Z",
      },
    });

    const reparsed = jsonAdapter.parse(out) as { main: Record<string, unknown> };
    expect(reparsed.main.aiTranslated).toBe(true);
    expect(reparsed.main.aiTranslationModel).toBe("@cf/meta/llama-3.1-8b-instruct");
    expect(reparsed.main.aiTranslatedAt).toBe("2026-05-07T10:00:00Z");
    // File-root has only original top-level keys, not the marker.
    expect(reparsed).not.toHaveProperty("aiTranslated");
  });

  it("injects the marker into every element of a top-level array", () => {
    // For JSON files Astro loads as multi-entry arrays, every
    // object element gets the marker so each translated entry's
    // data carries it.
    const src = JSON.stringify(
      [
        { id: "a", title: "First" },
        { id: "b", title: "Second" },
      ],
      null,
      2,
    );
    const parsed = jsonAdapter.parse(src);
    const out = jsonAdapter.applyTranslations(parsed, src, new Map(), {
      topLevelAdditions: { aiTranslated: true },
    });

    const reparsed = jsonAdapter.parse(out) as Array<Record<string, unknown>>;
    expect(reparsed[0]?.aiTranslated).toBe(true);
    expect(reparsed[1]?.aiTranslated).toBe(true);
  });

  it("skips top-level scalar keys when injecting the marker", () => {
    // Top-level scalars become entries with non-object data; the
    // marker has nowhere to attach. They're left alone.
    const src = JSON.stringify({ version: 1, flag: true, main: { title: "Hello" } });
    const parsed = jsonAdapter.parse(src);
    const out = jsonAdapter.applyTranslations(parsed, src, new Map(), {
      topLevelAdditions: { aiTranslated: true },
    });

    const reparsed = jsonAdapter.parse(out) as Record<string, unknown>;
    expect(reparsed.version).toBe(1);
    expect(reparsed.flag).toBe(true);
    expect((reparsed.main as { aiTranslated?: boolean }).aiTranslated).toBe(true);
  });

  it("does not mutate the input parsed object (clone-then-mutate)", () => {
    const parsed = jsonAdapter.parse(SITE_JSON);
    const before = JSON.stringify(parsed);

    jsonAdapter.applyTranslations(parsed, SITE_JSON, new Map([["main.featuredResearch.title", "MUTATED"]]), {});

    expect(JSON.stringify(parsed)).toBe(before);
  });

  it("output is parseable JSON (round-trip integrity)", () => {
    const parsed = jsonAdapter.parse(SITE_JSON);
    const out = jsonAdapter.applyTranslations(parsed, SITE_JSON, new Map([["main.featuredResearch.title", "Olá"]]), {
      topLevelAdditions: { aiTranslated: true },
    });
    expect(() => jsonAdapter.parse(out)).not.toThrow();
  });

  it("throws on translations targeting a path that doesn't exist in source", () => {
    const parsed = jsonAdapter.parse(SITE_JSON);
    expect(() => jsonAdapter.applyTranslations(parsed, SITE_JSON, new Map([["main.totally.bogus.key", "uh oh"]]), {})).toThrow();
  });
});

describe("jsonAdapter — selectedValuesForHash", () => {
  it("captures translatable keys' values for cache-key composition", () => {
    const parsed = jsonAdapter.parse(SITE_JSON);
    const values = jsonAdapter.selectedValuesForHash(
      parsed,
      SITE_JSON,
      makeOpts({
        "site.json": ["main.featuredResearch.title", "main.featuredResearch.description"],
      }),
    );

    expect(values).toEqual({
      "main.featuredResearch.title": "Unweight: Lossless MLP Weight Compression",
      "main.featuredResearch.description": "Unweight is a lossless compression system for LLM weight tensors.",
    });
  });

  it("captures non-string translatable keys (numbers, booleans, null)", () => {
    const src = JSON.stringify({ meta: { title: "Hello", year: 2025, active: true, deprecated: null } });
    const parsed = jsonAdapter.parse(src);
    const values = jsonAdapter.selectedValuesForHash(
      parsed,
      src,
      makeOpts({ "site.json": ["meta.title", "meta.year", "meta.active", "meta.deprecated"] }),
    );

    expect(values).toEqual({
      "meta.title": "Hello",
      "meta.year": 2025,
      "meta.active": true,
      "meta.deprecated": null,
    });
  });

  it("omits absent keys silently (don't bust cache on optional fields not present)", () => {
    const src = JSON.stringify({ meta: { title: "Hello" } });
    const parsed = jsonAdapter.parse(src);
    const values = jsonAdapter.selectedValuesForHash(parsed, src, makeOpts({ "site.json": ["meta.title", "meta.subtitle"] }));

    expect(values).toEqual({ "meta.title": "Hello" });
  });
});

describe("jsonAdapter — peekNoTranslate", () => {
  it("returns true when top-level noTranslate = true", () => {
    expect(jsonAdapter.peekNoTranslate(JSON.parse('{ "noTranslate": true, "main": {} }'))).toBe(true);
  });

  it("returns false when noTranslate is absent", () => {
    expect(jsonAdapter.peekNoTranslate(JSON.parse(SITE_JSON))).toBe(false);
  });

  it("returns false when noTranslate = false explicitly", () => {
    expect(jsonAdapter.peekNoTranslate(JSON.parse('{ "noTranslate": false, "main": {} }'))).toBe(false);
  });

  it("returns false for non-boolean noTranslate (JSON's strict typing means no string aliases)", () => {
    expect(jsonAdapter.peekNoTranslate(JSON.parse('{ "noTranslate": "true" }'))).toBe(false);
  });

  it("returns false for top-level array roots (no place for noTranslate)", () => {
    expect(jsonAdapter.peekNoTranslate(JSON.parse('[{"id":"a"}]'))).toBe(false);
  });

  it("returns false for top-level scalar roots (degenerate)", () => {
    expect(jsonAdapter.peekNoTranslate(42)).toBe(false);
    expect(jsonAdapter.peekNoTranslate(null)).toBe(false);
    expect(jsonAdapter.peekNoTranslate("string")).toBe(false);
  });
});

describe("jsonAdapter — cache-key behaviour", () => {
  it("translatable-value edits change selectedValuesForHash output", () => {
    const before = jsonAdapter.parse(SITE_JSON);
    const after = jsonAdapter.parse(SITE_JSON.replace("Unweight: Lossless", "DIFFERENT TITLE"));

    const opts = makeOpts({ "site.json": ["main.featuredResearch.title"] });
    const v1 = jsonAdapter.selectedValuesForHash(before, SITE_JSON, opts);
    const v2 = jsonAdapter.selectedValuesForHash(after, SITE_JSON, opts);

    expect(JSON.stringify(v1)).not.toBe(JSON.stringify(v2));
  });

  it("non-translatable-key edits don't change selectedValuesForHash output", () => {
    const before = jsonAdapter.parse(SITE_JSON);
    const after = jsonAdapter.parse(SITE_JSON.replace("/nikulin2026", "/different-link"));

    const opts = makeOpts({
      "site.json": ["main.featuredResearch.title", "main.featuredResearch.description"],
    });
    const v1 = jsonAdapter.selectedValuesForHash(before, SITE_JSON, opts);
    const v2 = jsonAdapter.selectedValuesForHash(after, SITE_JSON, opts);

    expect(JSON.stringify(v1)).toBe(JSON.stringify(v2));
  });
});

describe("jsonAdapter — rewriteUrls", () => {
  it("rewrites string values at configured URL paths", () => {
    const out = jsonAdapter.rewriteUrls!(SITE_JSON, {
      paths: ["main.featuredResearch.link"],
      rewriter: (url) => (url === "/nikulin2026" ? "/pt-BR/nikulin2026" : null),
    });
    const reparsed = JSON.parse(out) as { main: { featuredResearch: { link: string } } };
    expect(reparsed.main.featuredResearch.link).toBe("/pt-BR/nikulin2026");
  });

  it("returns input bytes unchanged when no rules apply (perf invariant)", () => {
    const out = jsonAdapter.rewriteUrls!(SITE_JSON, { paths: [], rewriter: () => "/never" });
    expect(out).toBe(SITE_JSON);
  });

  it("returns input bytes unchanged when the rewriter passes everything through unchanged", () => {
    const out = jsonAdapter.rewriteUrls!(SITE_JSON, {
      paths: ["main.featuredResearch.link"],
      rewriter: () => null,
    });
    expect(out).toBe(SITE_JSON);
  });

  it("expands wildcards against the post-apply structure", () => {
    const src = JSON.stringify(
      {
        tags: [
          { name: "a", url: "/tag-a" },
          { name: "b", url: "/tag-b" },
        ],
      },
      null,
      2,
    );
    const out = jsonAdapter.rewriteUrls!(src, {
      paths: ["tags[*].url"],
      rewriter: (url) => `/pt-BR${url}`,
    });
    const reparsed = JSON.parse(out) as { tags: Array<{ url: string }> };
    expect(reparsed.tags.map((t) => t.url)).toEqual(["/pt-BR/tag-a", "/pt-BR/tag-b"]);
  });

  it("ignores non-string values at configured URL paths", () => {
    const src = JSON.stringify({ meta: { url: 42 } });
    const out = jsonAdapter.rewriteUrls!(src, {
      paths: ["meta.url"],
      rewriter: () => "/wrong",
    });
    expect(out).toBe(src);
  });
});
