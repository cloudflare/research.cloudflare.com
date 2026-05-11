import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import type { AdapterExtractOptions } from "../src/parsing/adapter.js";
import { yamlAdapter } from "../src/parsing/adapters/yaml.js";

/**
 * YAML adapter — extract / apply / hash / noTranslate / URL-rewrite
 * behaviour. Mirrors `toml-adapter.test.ts` and `json-adapter.test.ts`;
 * differences are called out per-test (string-aliased noTranslate,
 * Date auto-parsing, top-level sequence support).
 *
 * Round-trip fidelity is intentionally relaxed: comments, anchors /
 * aliases, exact key ordering, and quoting style are NOT preserved
 * by `yaml.stringify`. Source files are never rewritten by polystella.
 */

const SITE_YAML = `# Site-wide config consumed by FeaturedResearch.astro
main:
  featuredResearch:
    publication: nikulin2026
    title: "Unweight: Lossless MLP Weight Compression"
    description: Unweight is a lossless compression system for LLM weight tensors.
    link: /nikulin2026
    buttonLabel: Read the Full Article
`;

function makeOpts(translatableKeys: Record<string, string[]>, sourcePath = "site.yaml"): AdapterExtractOptions {
  return { sourcePath, translatableKeys };
}

describe("yamlAdapter — extension claim", () => {
  it("claims .yaml and .yml", () => {
    expect(yamlAdapter.extensions).toEqual([".yaml", ".yml"]);
  });
});

describe("yamlAdapter — extractSegments", () => {
  it("emits one segment per configured translatable scalar", () => {
    const parsed = yamlAdapter.parse(SITE_YAML);
    const segs = yamlAdapter.extractSegments(
      parsed,
      SITE_YAML,
      makeOpts({
        "site.yaml": ["main.featuredResearch.title", "main.featuredResearch.description", "main.featuredResearch.buttonLabel"],
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
    const parsed = yamlAdapter.parse(SITE_YAML);
    const segs = yamlAdapter.extractSegments(parsed, SITE_YAML, makeOpts({ "site.yaml": ["main.featuredResearch.title"] }));

    expect(segs).toHaveLength(1);
    expect(segs[0]?.id).toBe("main.featuredResearch.title");
  });

  it("expands wildcards against top-level sequences", () => {
    // YAML files Astro loads as multi-entry sequences — wildcard
    // over the top level targets each element's translatable
    // scalars uniformly.
    const src = `- id: a
  title: First Pub
- id: b
  title: Second Pub
- id: c
  title: Third Pub
`;
    const parsed = yamlAdapter.parse(src);
    const segs = yamlAdapter.extractSegments(parsed, src, {
      sourcePath: "publications.yaml",
      translatableKeys: { "publications.yaml": ["[*].title"] },
    });

    expect(segs.map((s) => s.id)).toEqual(["[0].title", "[1].title", "[2].title"]);
    expect(segs.map((s) => s.text)).toEqual(["First Pub", "Second Pub", "Third Pub"]);
  });

  it("expands wildcards over nested mapping structures", () => {
    const src = `paths:
  foo:
    summary: Foo summary
  bar:
    summary: Bar summary
`;
    const parsed = yamlAdapter.parse(src);
    const segs = yamlAdapter.extractSegments(parsed, src, {
      sourcePath: "openapi.yaml",
      translatableKeys: { "openapi.yaml": ["paths.*.summary"] },
    });

    expect(segs.map((s) => s.id).sort()).toEqual(["paths.bar.summary", "paths.foo.summary"]);
  });

  it("skips non-string values silently", () => {
    const src = `meta:
  title: Hello
  year: 2025
  isPublished: true
  count: null
`;
    const parsed = yamlAdapter.parse(src);
    const segs = yamlAdapter.extractSegments(
      parsed,
      src,
      makeOpts({ "site.yaml": ["meta.title", "meta.year", "meta.isPublished", "meta.count"] }),
    );

    expect(segs).toEqual([{ id: "meta.title", text: "Hello" }]);
  });

  it("skips empty strings", () => {
    const src = `meta:
  title: ""
  subtitle: Real
`;
    const parsed = yamlAdapter.parse(src);
    const segs = yamlAdapter.extractSegments(parsed, src, makeOpts({ "site.yaml": ["meta.title", "meta.subtitle"] }));

    expect(segs).toEqual([{ id: "meta.subtitle", text: "Real" }]);
  });
});

describe("yamlAdapter — applyTranslations", () => {
  it("writes translations at their key paths and re-stringifies", () => {
    const parsed = yamlAdapter.parse(SITE_YAML);
    const out = yamlAdapter.applyTranslations(
      parsed,
      SITE_YAML,
      new Map([
        ["main.featuredResearch.title", "Unweight: Compressão sem perdas"],
        ["main.featuredResearch.buttonLabel", "Leia o artigo completo"],
      ]),
      {},
    );

    const reparsed = yamlAdapter.parse(out) as { main: { featuredResearch: Record<string, unknown> } };
    expect(reparsed.main.featuredResearch.title).toBe("Unweight: Compressão sem perdas");
    expect(reparsed.main.featuredResearch.buttonLabel).toBe("Leia o artigo completo");
    expect(reparsed.main.featuredResearch.publication).toBe("nikulin2026");
    expect(reparsed.main.featuredResearch.link).toBe("/nikulin2026");
  });

  it("injects topLevelAdditions inside each top-level mapping (per-entry)", () => {
    const parsed = yamlAdapter.parse(SITE_YAML);
    const out = yamlAdapter.applyTranslations(parsed, SITE_YAML, new Map([["main.featuredResearch.title", "Olá"]]), {
      topLevelAdditions: {
        aiTranslated: true,
        aiTranslationModel: "@cf/meta/llama-3.1-8b-instruct",
        aiTranslatedAt: "2026-05-07T10:00:00.000Z",
      },
    });

    const reparsed = yamlAdapter.parse(out) as { main: Record<string, unknown> };
    expect(reparsed.main.aiTranslated).toBe(true);
    expect(reparsed.main.aiTranslationModel).toBe("@cf/meta/llama-3.1-8b-instruct");
    // YAML parses unquoted ISO-8601 timestamps as Date objects.
    // Schema-extender's `aiTranslatedAt: z.union([z.string(), z.date()])`
    // accepts either, but the extracted value here may be string or
    // Date depending on yaml's default quoting on output.
    const timestamp = reparsed.main.aiTranslatedAt;
    if (timestamp instanceof Date) {
      expect(timestamp.toISOString()).toBe("2026-05-07T10:00:00.000Z");
    } else {
      expect(timestamp).toBe("2026-05-07T10:00:00.000Z");
    }
    expect(reparsed).not.toHaveProperty("aiTranslated");
  });

  it("injects the marker into every element of a top-level sequence", () => {
    const src = `- id: a
  title: First
- id: b
  title: Second
`;
    const parsed = yamlAdapter.parse(src);
    const out = yamlAdapter.applyTranslations(parsed, src, new Map(), {
      topLevelAdditions: { aiTranslated: true },
    });

    const reparsed = yamlAdapter.parse(out) as Array<Record<string, unknown>>;
    expect(reparsed[0]?.aiTranslated).toBe(true);
    expect(reparsed[1]?.aiTranslated).toBe(true);
  });

  it("skips top-level scalar keys when injecting the marker", () => {
    const src = `version: 1
flag: true
main:
  title: Hello
`;
    const parsed = yamlAdapter.parse(src);
    const out = yamlAdapter.applyTranslations(parsed, src, new Map(), {
      topLevelAdditions: { aiTranslated: true },
    });

    const reparsed = yamlAdapter.parse(out) as Record<string, unknown>;
    expect(reparsed.version).toBe(1);
    expect(reparsed.flag).toBe(true);
    expect((reparsed.main as { aiTranslated?: boolean }).aiTranslated).toBe(true);
  });

  it("does not mutate the input parsed object (clone-then-mutate)", () => {
    const parsed = yamlAdapter.parse(SITE_YAML);
    const before = JSON.stringify(parsed);

    yamlAdapter.applyTranslations(parsed, SITE_YAML, new Map([["main.featuredResearch.title", "MUTATED"]]), {});

    expect(JSON.stringify(parsed)).toBe(before);
  });

  it("output is parseable YAML (round-trip integrity)", () => {
    const parsed = yamlAdapter.parse(SITE_YAML);
    const out = yamlAdapter.applyTranslations(parsed, SITE_YAML, new Map([["main.featuredResearch.title", "Olá"]]), {
      topLevelAdditions: { aiTranslated: true },
    });
    expect(() => yamlAdapter.parse(out)).not.toThrow();
    // Bonus: parses correctly under another YAML lib too (Astro's
    // file() loader uses js-yaml, not the `yaml` package). The
    // shape should be identical after a round-trip.
    expect(() => parseYaml(out)).not.toThrow();
  });

  it("throws on translations targeting a path that doesn't exist in source", () => {
    const parsed = yamlAdapter.parse(SITE_YAML);
    expect(() => yamlAdapter.applyTranslations(parsed, SITE_YAML, new Map([["main.totally.bogus.key", "uh oh"]]), {})).toThrow();
  });
});

describe("yamlAdapter — selectedValuesForHash", () => {
  it("captures translatable keys' values for cache-key composition", () => {
    const parsed = yamlAdapter.parse(SITE_YAML);
    const values = yamlAdapter.selectedValuesForHash(
      parsed,
      SITE_YAML,
      makeOpts({
        "site.yaml": ["main.featuredResearch.title", "main.featuredResearch.description"],
      }),
    );

    expect(values).toEqual({
      "main.featuredResearch.title": "Unweight: Lossless MLP Weight Compression",
      "main.featuredResearch.description": "Unweight is a lossless compression system for LLM weight tensors.",
    });
  });

  it("captures non-string translatable keys (numbers, booleans, null)", () => {
    const src = `meta:
  title: Hello
  year: 2025
  active: true
  deprecated: null
`;
    const parsed = yamlAdapter.parse(src);
    const values = yamlAdapter.selectedValuesForHash(
      parsed,
      src,
      makeOpts({ "site.yaml": ["meta.title", "meta.year", "meta.active", "meta.deprecated"] }),
    );

    expect(values).toEqual({
      "meta.title": "Hello",
      "meta.year": 2025,
      "meta.active": true,
      "meta.deprecated": null,
    });
  });

  it("treats unquoted and quoted ISO 8601 timestamps identically (eemeli/yaml v2 returns strings either way)", () => {
    // The `yaml` package keeps unquoted ISO timestamps as strings
    // by default (unlike `js-yaml`, which auto-parses to Date).
    // Both forms produce the same hash output, so quoting-style
    // edits don't bust the cache.
    const unquoted = yamlAdapter.parse(`meta:\n  ts: 2026-05-07T10:00:00Z\n`);
    const quoted = yamlAdapter.parse(`meta:\n  ts: "2026-05-07T10:00:00Z"\n`);

    const opts = makeOpts({ "site.yaml": ["meta.ts"] });
    const v1 = yamlAdapter.selectedValuesForHash(unquoted, "", opts);
    const v2 = yamlAdapter.selectedValuesForHash(quoted, "", opts);

    expect(typeof v1["meta.ts"]).toBe("string");
    expect(typeof v2["meta.ts"]).toBe("string");
    expect(v1["meta.ts"]).toBe(v2["meta.ts"]);
    expect(v1["meta.ts"]).toBe("2026-05-07T10:00:00Z");
  });

  it("omits absent keys silently", () => {
    const src = `meta:\n  title: Hello\n`;
    const parsed = yamlAdapter.parse(src);
    const values = yamlAdapter.selectedValuesForHash(parsed, src, makeOpts({ "site.yaml": ["meta.title", "meta.subtitle"] }));

    expect(values).toEqual({ "meta.title": "Hello" });
  });
});

describe("yamlAdapter — peekNoTranslate", () => {
  it("returns true when top-level noTranslate = true (boolean)", () => {
    const parsed = yamlAdapter.parse(`noTranslate: true\nmain:\n  title: x\n`);
    expect(yamlAdapter.peekNoTranslate(parsed)).toBe(true);
  });

  it("returns true for the string aliases 'true' / 'yes' (parity with markdown frontmatter)", () => {
    // YAML frontmatter (markdown) historically accepts these
    // string aliases; the YAML adapter does too for consistency.
    const yes = yamlAdapter.parse(`noTranslate: "yes"\nmain:\n  title: x\n`);
    const trueStr = yamlAdapter.parse(`noTranslate: "true"\nmain:\n  title: x\n`);
    const upper = yamlAdapter.parse(`noTranslate: "YES"\nmain:\n  title: x\n`);
    expect(yamlAdapter.peekNoTranslate(yes)).toBe(true);
    expect(yamlAdapter.peekNoTranslate(trueStr)).toBe(true);
    expect(yamlAdapter.peekNoTranslate(upper)).toBe(true);
  });

  it("returns false when noTranslate is absent", () => {
    expect(yamlAdapter.peekNoTranslate(yamlAdapter.parse(SITE_YAML))).toBe(false);
  });

  it("returns false when noTranslate = false explicitly", () => {
    const parsed = yamlAdapter.parse(`noTranslate: false\nmain:\n  title: x\n`);
    expect(yamlAdapter.peekNoTranslate(parsed)).toBe(false);
  });

  it("returns false for unrelated string values", () => {
    const parsed = yamlAdapter.parse(`noTranslate: "no"\nmain:\n  title: x\n`);
    expect(yamlAdapter.peekNoTranslate(parsed)).toBe(false);
  });

  it("returns false for top-level sequence roots (no place for noTranslate)", () => {
    expect(yamlAdapter.peekNoTranslate(yamlAdapter.parse(`- id: a\n`))).toBe(false);
  });
});

describe("yamlAdapter — cache-key behaviour", () => {
  it("translatable-value edits change selectedValuesForHash output", () => {
    const before = yamlAdapter.parse(SITE_YAML);
    const after = yamlAdapter.parse(SITE_YAML.replace("Unweight: Lossless", "DIFFERENT TITLE"));

    const opts = makeOpts({ "site.yaml": ["main.featuredResearch.title"] });
    const v1 = yamlAdapter.selectedValuesForHash(before, SITE_YAML, opts);
    const v2 = yamlAdapter.selectedValuesForHash(after, SITE_YAML, opts);

    expect(JSON.stringify(v1)).not.toBe(JSON.stringify(v2));
  });

  it("non-translatable-key edits don't change selectedValuesForHash output", () => {
    const before = yamlAdapter.parse(SITE_YAML);
    const after = yamlAdapter.parse(SITE_YAML.replace("/nikulin2026", "/different-link"));

    const opts = makeOpts({
      "site.yaml": ["main.featuredResearch.title", "main.featuredResearch.description"],
    });
    const v1 = yamlAdapter.selectedValuesForHash(before, SITE_YAML, opts);
    const v2 = yamlAdapter.selectedValuesForHash(after, SITE_YAML, opts);

    expect(JSON.stringify(v1)).toBe(JSON.stringify(v2));
  });

  it("comment edits don't change selectedValuesForHash output", () => {
    const withComment = yamlAdapter.parse(SITE_YAML);
    const noComment = yamlAdapter.parse(SITE_YAML.replace(/^# .*\n/m, ""));

    const opts = makeOpts({
      "site.yaml": ["main.featuredResearch.title", "main.featuredResearch.description"],
    });
    const v1 = yamlAdapter.selectedValuesForHash(withComment, SITE_YAML, opts);
    const v2 = yamlAdapter.selectedValuesForHash(noComment, SITE_YAML, opts);

    expect(JSON.stringify(v1)).toBe(JSON.stringify(v2));
  });
});

describe("yamlAdapter — rewriteUrls", () => {
  it("rewrites string values at configured URL paths", () => {
    const out = yamlAdapter.rewriteUrls!(SITE_YAML, {
      paths: ["main.featuredResearch.link"],
      rewriter: (url) => (url === "/nikulin2026" ? "/pt-BR/nikulin2026" : null),
    });
    const reparsed = yamlAdapter.parse(out) as { main: { featuredResearch: { link: string } } };
    expect(reparsed.main.featuredResearch.link).toBe("/pt-BR/nikulin2026");
  });

  it("returns input bytes unchanged when no rules apply", () => {
    const out = yamlAdapter.rewriteUrls!(SITE_YAML, { paths: [], rewriter: () => "/never" });
    expect(out).toBe(SITE_YAML);
  });

  it("returns input bytes unchanged when the rewriter passes everything through unchanged", () => {
    const out = yamlAdapter.rewriteUrls!(SITE_YAML, {
      paths: ["main.featuredResearch.link"],
      rewriter: () => null,
    });
    expect(out).toBe(SITE_YAML);
  });

  it("expands wildcards against the post-apply structure", () => {
    const src = `tags:
  - name: a
    url: /tag-a
  - name: b
    url: /tag-b
`;
    const out = yamlAdapter.rewriteUrls!(src, {
      paths: ["tags[*].url"],
      rewriter: (url) => `/pt-BR${url}`,
    });
    const reparsed = yamlAdapter.parse(out) as { tags: Array<{ url: string }> };
    expect(reparsed.tags.map((t) => t.url)).toEqual(["/pt-BR/tag-a", "/pt-BR/tag-b"]);
  });

  it("ignores non-string values at configured URL paths", () => {
    const src = `meta:\n  url: 42\n`;
    const out = yamlAdapter.rewriteUrls!(src, {
      paths: ["meta.url"],
      rewriter: () => "/wrong",
    });
    expect(out).toBe(src);
  });
});
