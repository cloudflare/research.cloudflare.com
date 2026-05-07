import { describe, expect, it } from "vitest";

import { markdownAdapter } from "../src/parsing/adapters/markdown.js";

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
    const source = ['---', 'title: "Hello"', "heroImage: /images/hero.png", "---", "", "Body content."].join("\n");
    const out = markdownAdapter.rewriteUrls!(source, {
      paths: ["heroImage"],
      rewriter: (url) => (url.startsWith("/") ? localePrefix(url) : null),
    });
    expect(out).toContain("heroImage: /pt-BR/images/hero.png");
    // Title is unaffected.
    expect(out).toContain('title: Hello');
    // Body is unaffected.
    expect(out).toContain("Body content.");
  });

  it("rewrites multiple URL keys in one pass", () => {
    const source = [
      "---",
      'title: "Hello"',
      "heroImage: /a.png",
      "pdfLink: /docs/paper.pdf",
      "---",
      "",
      "Body.",
    ].join("\n");
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
    const source = ['---', 'heroImage: /a.png', "---", "", "See [docs](/docs/intro)."].join("\n");
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
