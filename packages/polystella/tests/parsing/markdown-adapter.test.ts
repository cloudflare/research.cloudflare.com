import { describe, expect, it } from "vitest";

import { markdownAdapter } from "../../src/parsing/adapters/markdown.js";
import type { Segment } from "../../src/parsing/extract.js";

/**
 * Markdown adapter — `rewriteUrls` covers FRONTMATTER URL fields
 * only. Body inline links are handled separately by the bytes-level
 * `rewriteInternalLinks` (tested in rewrite-links.test.ts), which the
 * pipeline runs alongside `rewriteUrls` for markdown sources.
 *
 * Like all adapter URL rewriters, this operates on serialised bytes
 * (post-cache) so editing `noPrefixUrls` doesn't bust cached entries.
 */

const localePrefix = (url: string) => (url.startsWith("/") ? `/pt-BR${url}` : `/pt-BR/${url}`);

describe("markdownAdapter — rewriteUrls (frontmatter)", () => {
  it("rewrites a single URL key in frontmatter", () => {
    const source = ["---", 'title: "Hello"', "heroImage: /images/hero.png", "---", "", "Body content."].join("\n");
    const out = markdownAdapter.rewriteUrls!(source, {
      paths: ["heroImage"],
      rewriter: (url) => (url.startsWith("/") ? localePrefix(url) : null),
    });
    expect(out).toContain("heroImage: /pt-BR/images/hero.png");
    // Title is unaffected.
    expect(out).toContain("title: Hello");
    // Body is unaffected.
    expect(out).toContain("Body content.");
  });

  it("rewrites multiple URL keys in one pass", () => {
    const source = ["---", 'title: "Hello"', "heroImage: /a.png", "pdfLink: /docs/paper.pdf", "---", "", "Body."].join("\n");
    const out = markdownAdapter.rewriteUrls!(source, {
      paths: ["heroImage", "pdfLink"],
      rewriter: (url) => (url.startsWith("/") ? localePrefix(url) : null),
    });
    expect(out).toContain("heroImage: /pt-BR/a.png");
    expect(out).toContain("pdfLink: /pt-BR/docs/paper.pdf");
  });

  it("returns input unchanged when paths list is empty", () => {
    const source = "---\ntitle: Hello\nheroImage: /a.png\n---\n\nBody.\n";
    const out = markdownAdapter.rewriteUrls!(source, { paths: [], rewriter: () => "/x" });
    expect(out).toBe(source);
  });

  it("returns input unchanged when no configured key exists in frontmatter", () => {
    const source = "---\ntitle: Hello\n---\n\nBody.\n";
    const out = markdownAdapter.rewriteUrls!(source, {
      paths: ["heroImage", "pdfLink"],
      rewriter: () => "/anything",
    });
    expect(out).toBe(source);
  });

  it("returns input unchanged when there is no frontmatter", () => {
    const source = "# Hello\n\nNo frontmatter here.\n";
    const out = markdownAdapter.rewriteUrls!(source, {
      paths: ["heroImage"],
      rewriter: () => "/anything",
    });
    expect(out).toBe(source);
  });

  it("returns input unchanged when rewriter returns null for every match", () => {
    const source = "---\ntitle: Hello\nheroImage: https://cdn.example.com/a.png\n---\n\nBody.\n";
    const out = markdownAdapter.rewriteUrls!(source, {
      paths: ["heroImage"],
      // External URL: real `rewriteUrlIfInternal` returns null.
      rewriter: () => null,
    });
    expect(out).toBe(source);
  });

  it("skips non-string frontmatter values", () => {
    // A configured URL key could point at a non-string (e.g. a number
    // value if the schema was misdesigned). Skip rather than throw.
    const source = "---\ntitle: Hello\nyear: 2026\n---\n\nBody.\n";
    const out = markdownAdapter.rewriteUrls!(source, {
      paths: ["year"],
      rewriter: () => "/whatever",
    });
    expect(out).toBe(source);
  });

  it("preserves body links untouched (not its responsibility)", () => {
    // Body link rewriting is rewriteInternalLinks's job, not the
    // adapter's. The adapter must not double up.
    const source = ["---", "heroImage: /a.png", "---", "", "See [docs](/docs/intro)."].join("\n");
    const out = markdownAdapter.rewriteUrls!(source, {
      paths: ["heroImage"],
      rewriter: (url) => (url.startsWith("/") ? localePrefix(url) : null),
    });
    expect(out).toContain("heroImage: /pt-BR/a.png");
    // Body link is still raw — the pipeline runs rewriteInternalLinks
    // separately for body links.
    expect(out).toContain("See [docs](/docs/intro).");
  });

  it("is idempotent on already-rewritten bytes", () => {
    const source = "---\ntitle: Hello\nheroImage: /a.png\n---\n\nBody.\n";
    const onceWith = (s: string) =>
      markdownAdapter.rewriteUrls!(s, {
        paths: ["heroImage"],
        rewriter: (url) => (url.startsWith("/pt-BR/") ? null : localePrefix(url)),
      });
    const once = onceWith(source);
    const twice = onceWith(once);
    expect(twice).toBe(once);
  });
});

/**
 * `groupSegments` — heading-anchored partitioning (ARCHITECTURE.md §17).
 *
 * Each heading node starts a new group; non-heading translatable blocks
 * (paragraphs, table cells) append to the current group. Frontmatter
 * segments are emitted as a single trailing group regardless of body
 * shape. The flat-equality invariant guards against future AST changes
 * silently dropping or reordering segments.
 */

const extractFor = (source: string, opts: { sourcePath: string; translatableKeys?: Record<string, string[]> }): Segment[] => {
  const parsed = markdownAdapter.parse(source, opts.sourcePath);
  return markdownAdapter.extractSegments(parsed, source, {
    sourcePath: opts.sourcePath,
    translatableKeys: opts.translatableKeys ?? {},
  });
};

const groupsFor = (source: string, opts: { sourcePath: string; translatableKeys?: Record<string, string[]> }): Segment[][] => {
  const parsed = markdownAdapter.parse(source, opts.sourcePath);
  const segments = markdownAdapter.extractSegments(parsed, source, {
    sourcePath: opts.sourcePath,
    translatableKeys: opts.translatableKeys ?? {},
  });
  return markdownAdapter.groupSegments!(parsed, segments);
};

describe("markdownAdapter — groupSegments", () => {
  it("returns a single body group when the document has paragraphs but no headings", () => {
    const source = ["First paragraph.", "", "Second paragraph.", "", "Third paragraph."].join("\n");
    const groups = groupsFor(source, { sourcePath: "publications/sample.md" });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.map((s) => s.id)).toEqual(["body:0", "body:1", "body:2"]);
  });

  it("groups paragraphs under a single H1 as one group anchored by the heading", () => {
    const source = ["# Title", "", "Paragraph one.", "", "Paragraph two.", "", "Paragraph three."].join("\n");
    const groups = groupsFor(source, { sourcePath: "publications/sample.md" });
    expect(groups).toHaveLength(1);
    // body:0 = the H1, body:1..3 = the paragraphs.
    expect(groups[0]?.map((s) => s.id)).toEqual(["body:0", "body:1", "body:2", "body:3"]);
  });

  it("splits at every heading boundary uniformly (H1 -> H2 -> H3)", () => {
    const source = [
      "# Top",
      "",
      "Lede paragraph.",
      "",
      "## Section A",
      "",
      "Section A body.",
      "",
      "### Subsection",
      "",
      "Subsection body.",
      "",
      "## Section B",
      "",
      "Section B body.",
    ].join("\n");
    const groups = groupsFor(source, { sourcePath: "publications/sample.md" });
    // [H1, lede] / [H2-A, body-A] / [H3-sub, body-sub] / [H2-B, body-B]
    expect(groups).toHaveLength(4);
    expect(groups.map((g) => g.length)).toEqual([2, 2, 2, 2]);
  });

  it("handles two H2 sections with paragraphs under each", () => {
    const source = ["## Alpha", "", "Body of alpha.", "", "## Beta", "", "Body of beta.", "", "Another beta paragraph."].join("\n");
    const groups = groupsFor(source, { sourcePath: "publications/sample.md" });
    expect(groups).toHaveLength(2);
    expect(groups[0]?.length).toBe(2); // [H2-alpha, body-alpha]
    expect(groups[1]?.length).toBe(3); // [H2-beta, body-beta-1, body-beta-2]
  });

  it("emits frontmatter as a single trailing group when frontmatter keys are translatable", () => {
    const source = ["---", "title: Hello", "metaDescription: A short intro", "---", "", "# Body", "", "Paragraph."].join("\n");
    const groups = groupsFor(source, {
      sourcePath: "publications/sample.md",
      translatableKeys: { "publications/**": ["title", "metaDescription"] },
    });
    // Body groups first, frontmatter last.
    expect(groups[groups.length - 1]?.every((s) => s.id.startsWith("fm:"))).toBe(true);
    // Trailing group has both fm segments.
    expect(groups[groups.length - 1]?.map((s) => s.id).sort()).toEqual(["fm:metaDescription", "fm:title"]);
  });

  it("emits consecutive heading-only groups when headings touch with no body between", () => {
    // Algorithmically clean even if cosmetically rare: each heading
    // starts a fresh group, so two adjacent headings produce two
    // single-segment groups.
    const source = ["## First", "", "## Second", "", "Body of second."].join("\n");
    const groups = groupsFor(source, { sourcePath: "publications/sample.md" });
    expect(groups).toHaveLength(2);
    expect(groups[0]?.length).toBe(1); // just the first heading
    expect(groups[1]?.length).toBe(2); // second heading + paragraph
  });

  it("returns an empty array for a document with no translatable segments", () => {
    const source = "";
    const groups = groupsFor(source, { sourcePath: "publications/empty.md" });
    expect(groups).toEqual([]);
  });

  it("preserves the flat(groups) === segments invariant on a 5-section fixture (reference-equal)", () => {
    // Share the parse + extract pass so we can assert reference
    // equality: `groupSegments` partitions the array, it does not
    // clone segments. Reference equality is the strongest contract
    // we can pin without re-traversing the AST.
    const source = [
      "---",
      "title: Top",
      "---",
      "",
      "Lede.",
      "",
      "## A",
      "Body A.",
      "",
      "## B",
      "Body B.",
      "",
      "### B.1",
      "Body B.1.",
      "",
      "## C",
      "Body C.",
      "",
      "## D",
      "Body D.",
    ].join("\n");
    const sourcePath = "publications/sample.md";
    const parsed = markdownAdapter.parse(source, sourcePath);
    const segments = markdownAdapter.extractSegments(parsed, source, {
      sourcePath,
      translatableKeys: { "publications/**": ["title"] },
    });
    const groups = markdownAdapter.groupSegments!(parsed, segments);
    const flat = groups.flat();
    expect(flat).toHaveLength(segments.length);
    for (let i = 0; i < flat.length; i++) {
      // Reference equality (toBe), not structural (toEqual).
      expect(flat[i]).toBe(segments[i]);
    }
  });
});

/**
 * `documentContext` — per-batch framing block (ARCHITECTURE.md §17).
 *
 * Reads configured `contextKeys` for the source's glob and emits one
 * `<Title-Cased Key>: <value>` line per resolved string. Returns
 * `undefined` when nothing resolves; the caller omits the DOCUMENT
 * CONTEXT block from the prompt entirely in that case.
 */

const contextFor = (source: string, opts: { sourcePath: string; contextKeys: Record<string, string[]> }): string | undefined => {
  const parsed = markdownAdapter.parse(source, opts.sourcePath);
  return markdownAdapter.documentContext!(parsed, opts);
};

describe("markdownAdapter — documentContext", () => {
  it("emits a single configured key with a string value", () => {
    const source = ["---", "title: Echo State Networks", "---", "", "Body."].join("\n");
    const out = contextFor(source, {
      sourcePath: "publications/echo.md",
      contextKeys: { "publications/**": ["title"] },
    });
    expect(out).toBe("Title: Echo State Networks");
  });

  it("skips configured keys that are missing from frontmatter (no blank line)", () => {
    const source = ["---", "title: Only Title", "---", "", "Body."].join("\n");
    const out = contextFor(source, {
      sourcePath: "publications/sample.md",
      contextKeys: { "publications/**": ["title", "excerpt"] },
    });
    expect(out).toBe("Title: Only Title");
    expect(out).not.toMatch(/Excerpt/);
  });

  it("returns undefined when none of the configured keys resolve", () => {
    const source = ["---", "year: 2026", "---", "", "Body."].join("\n");
    const out = contextFor(source, {
      sourcePath: "publications/sample.md",
      contextKeys: { "publications/**": ["title", "excerpt"] },
    });
    expect(out).toBeUndefined();
  });

  it("flattens a multi-line excerpt to a single line", () => {
    const source = [
      "---",
      "excerpt: |",
      "  First line of excerpt.",
      "  Second line continues.",
      "",
      "  Third line after blank.",
      "---",
      "",
      "Body.",
    ].join("\n");
    const out = contextFor(source, {
      sourcePath: "publications/sample.md",
      contextKeys: { "publications/**": ["excerpt"] },
    });
    expect(out).toBeDefined();
    // The flattened excerpt should appear as one line with no
    // embedded newlines.
    expect(out!.split("\n")).toHaveLength(1);
    expect(out!).toContain("First line of excerpt.");
    expect(out!).toContain("Second line continues.");
    expect(out!).toContain("Third line after blank.");
    // No embedded \n in the value portion.
    expect(out!).not.toMatch(/\n/);
  });

  it("emits multiple configured keys in config order, one per line", () => {
    const source = ["---", "title: T", "excerpt: E", "---", "", "Body."].join("\n");
    const out = contextFor(source, {
      sourcePath: "publications/sample.md",
      contextKeys: { "publications/**": ["title", "excerpt"] },
    });
    expect(out).toBe("Title: T\nExcerpt: E");
  });

  it("unions keys across multiple matching globs (deduped, insertion-ordered)", () => {
    const source = ["---", "title: T", "subtitle: S", "excerpt: E", "---", "", "Body."].join("\n");
    const out = contextFor(source, {
      sourcePath: "publications/sample.md",
      contextKeys: {
        "publications/**": ["title", "subtitle"],
        "**/*.md": ["title", "excerpt"], // `title` duplicated; dedup keeps first
      },
    });
    expect(out).toBe("Title: T\nSubtitle: S\nExcerpt: E");
  });

  it("returns undefined when the document has no frontmatter at all", () => {
    const source = "# Body-only doc\n\nNo frontmatter.";
    const out = contextFor(source, {
      sourcePath: "publications/sample.md",
      contextKeys: { "publications/**": ["title"] },
    });
    expect(out).toBeUndefined();
  });

  it("returns undefined when contextKeys is empty for the source", () => {
    const source = ["---", "title: Hello", "---", "", "Body."].join("\n");
    const out = contextFor(source, {
      sourcePath: "publications/sample.md",
      contextKeys: {},
    });
    expect(out).toBeUndefined();
  });

  it("title-cases snake_case and kebab-case keys", () => {
    const source = ["---", "og_description: A long description.", "seo-meta-image: /img.png", "---", "", "Body."].join("\n");
    const out = contextFor(source, {
      sourcePath: "publications/sample.md",
      contextKeys: { "**/*.md": ["og_description", "seo-meta-image"] },
    });
    expect(out).toBe("Og Description: A long description.\nSeo Meta Image: /img.png");
  });

  it("skips non-string values silently", () => {
    const source = ["---", "title: Hello", "year: 2026", "tags:", "  - one", "  - two", "---", "", "Body."].join("\n");
    const out = contextFor(source, {
      sourcePath: "publications/sample.md",
      contextKeys: { "**/*.md": ["title", "year", "tags"] },
    });
    // Only `title` is a string; `year` (number) and `tags` (array) are skipped.
    expect(out).toBe("Title: Hello");
  });
});
