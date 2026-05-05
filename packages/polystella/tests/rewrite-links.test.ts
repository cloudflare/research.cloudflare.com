import { describe, expect, it } from "vitest";
import { rewriteInternalLinks, rewriteUrlIfInternal, type RewriteInternalLinksOptions } from "../src/parsing/rewrite-links.js";

const opts: RewriteInternalLinksOptions = {
  targetLocale: "pt-BR",
  locales: ["en", "pt-BR", "ja-JP"],
};

describe("rewriteUrlIfInternal", () => {
  it("rewrites a leading-slash absolute path to be locale-prefixed", () => {
    expect(rewriteUrlIfInternal("/foo", opts)).toBe("/pt-BR/foo");
    expect(rewriteUrlIfInternal("/foo/bar", opts)).toBe("/pt-BR/foo/bar");
  });

  it("rewrites a relative path with no leading slash", () => {
    expect(rewriteUrlIfInternal("foo", opts)).toBe("/pt-BR/foo");
    expect(rewriteUrlIfInternal("foo/bar", opts)).toBe("/pt-BR/foo/bar");
  });

  it("preserves a query string when rewriting", () => {
    expect(rewriteUrlIfInternal("/foo?ref=home", opts)).toBe("/pt-BR/foo?ref=home");
  });

  it("preserves a fragment when rewriting", () => {
    expect(rewriteUrlIfInternal("/foo#section", opts)).toBe("/pt-BR/foo#section");
  });

  it("preserves both query and fragment when rewriting", () => {
    expect(rewriteUrlIfInternal("/foo?ref=home#section", opts)).toBe("/pt-BR/foo?ref=home#section");
  });

  it("leaves http(s) URLs untouched", () => {
    expect(rewriteUrlIfInternal("https://example.com/foo", opts)).toBeNull();
    expect(rewriteUrlIfInternal("http://example.com/foo", opts)).toBeNull();
  });

  it("leaves protocol-relative URLs untouched", () => {
    // `//foo.com/bar` is the browser-native shorthand for "same scheme
    // as the page". External by definition.
    expect(rewriteUrlIfInternal("//example.com/foo", opts)).toBeNull();
  });

  it("leaves mailto:/tel: URLs untouched", () => {
    expect(rewriteUrlIfInternal("mailto:hi@example.com", opts)).toBeNull();
    expect(rewriteUrlIfInternal("tel:+15551234567", opts)).toBeNull();
  });

  it("leaves anchor-only URLs untouched", () => {
    expect(rewriteUrlIfInternal("#section", opts)).toBeNull();
  });

  it("leaves an empty URL untouched", () => {
    expect(rewriteUrlIfInternal("", opts)).toBeNull();
  });

  it("is idempotent for URLs already prefixed with the target locale", () => {
    expect(rewriteUrlIfInternal("/pt-BR/foo", opts)).toBeNull();
    expect(rewriteUrlIfInternal("/pt-BR", opts)).toBeNull();
  });

  it("is idempotent for URLs prefixed with any other declared locale", () => {
    // A re-translation pass running on a sibling locale's cached
    // bytes shouldn't accidentally produce `/pt-BR/ja-JP/foo`.
    expect(rewriteUrlIfInternal("/ja-JP/foo", opts)).toBeNull();
    expect(rewriteUrlIfInternal("/en/foo", opts)).toBeNull();
  });

  it("does NOT treat substrings of locale codes as already-prefixed", () => {
    // `/pt-BRX/foo` shares a prefix with `/pt-BR` but isn't actually
    // locale-prefixed. The matcher requires `/<locale>` followed by
    // either end-of-string or `/`, so this should still rewrite.
    expect(rewriteUrlIfInternal("/pt-BRX/foo", opts)).toBe("/pt-BR/pt-BRX/foo");
  });
});

describe("rewriteInternalLinks", () => {
  it("rewrites a single inline link inside a paragraph", () => {
    const input = "See [the docs](/docs/intro) for more.";
    const output = rewriteInternalLinks(input, opts);
    expect(output).toBe("See [the docs](/pt-BR/docs/intro) for more.");
  });

  it("rewrites multiple links in a single paragraph", () => {
    const input = "Read [intro](/intro) then [advanced](/advanced).";
    const output = rewriteInternalLinks(input, opts);
    expect(output).toBe("Read [intro](/pt-BR/intro) then [advanced](/pt-BR/advanced).");
  });

  it("preserves external links untouched alongside rewritten internal ones", () => {
    const input = "See [the spec](https://example.com/spec) and [the README](/readme).";
    const output = rewriteInternalLinks(input, opts);
    expect(output).toBe("See [the spec](https://example.com/spec) and [the README](/pt-BR/readme).");
  });

  it("preserves the markdown structure (headings, lists, blockquotes)", () => {
    const input = [
      "# Heading with a [link](/somewhere)",
      "",
      "- list with [item](/item)",
      "- and [another](/x)",
      "",
      "> quote with [a link](/q)",
      "",
    ].join("\n");
    const output = rewriteInternalLinks(input, opts);
    expect(output).toBe(
      [
        "# Heading with a [link](/pt-BR/somewhere)",
        "",
        "- list with [item](/pt-BR/item)",
        "- and [another](/pt-BR/x)",
        "",
        "> quote with [a link](/pt-BR/q)",
        "",
      ].join("\n"),
    );
  });

  it("does not touch URLs inside fenced code blocks", () => {
    // Code blocks are not link-bearing in mdast — the body is a single
    // `code` node. A regex-based rewriter would be tempted to rewrite
    // anything that LOOKS like a link inside the code; the AST-based
    // walker correctly ignores it.
    const input = ["Real link: [foo](/foo)", "", "```", "Not a link: [bar](/bar)", "```", ""].join("\n");
    const output = rewriteInternalLinks(input, opts);
    expect(output).toBe(["Real link: [foo](/pt-BR/foo)", "", "```", "Not a link: [bar](/bar)", "```", ""].join("\n"));
  });

  it("does not touch URLs inside inline code", () => {
    const input = "Use `[foo](/foo)` like this, but [bar](/bar) is real.";
    const output = rewriteInternalLinks(input, opts);
    expect(output).toBe("Use `[foo](/foo)` like this, but [bar](/pt-BR/bar) is real.");
  });

  it("leaves autolinks (`<https://...>`) untouched", () => {
    const input = "See <https://example.com/spec> for the spec.";
    const output = rewriteInternalLinks(input, opts);
    expect(output).toBe(input);
  });

  it("returns the input unchanged when there are no internal links", () => {
    const input = "Plain paragraph with no links.";
    const output = rewriteInternalLinks(input, opts);
    expect(output).toBe(input);
  });

  it("returns the input unchanged when every link is external", () => {
    const input = "Mixed [external](https://x.com) [mailto](mailto:a@b.c) [tel](tel:+1) [anchor](#s) links.";
    const output = rewriteInternalLinks(input, opts);
    expect(output).toBe(input);
  });

  it("is idempotent: a second pass produces the same output", () => {
    const input = "See [the docs](/docs) and [the spec](https://x.com/spec).";
    const once = rewriteInternalLinks(input, opts);
    const twice = rewriteInternalLinks(once, opts);
    expect(twice).toBe(once);
  });

  it("is idempotent across different target locales applied in sequence", () => {
    // pt-BR pass produces `/pt-BR/foo`. A subsequent ja-JP pass with
    // the same `locales` array must not turn that into
    // `/ja-JP/pt-BR/foo` — that's exactly the scenario the
    // already-prefixed guard exists for.
    const input = "See [docs](/docs).";
    const ptBR = rewriteInternalLinks(input, opts);
    expect(ptBR).toBe("See [docs](/pt-BR/docs).");
    const jaJP = rewriteInternalLinks(ptBR, {
      targetLocale: "ja-JP",
      locales: ["en", "pt-BR", "ja-JP"],
    });
    expect(jaJP).toBe(ptBR);
  });

  it("preserves a link's title attribute", () => {
    // Inline links may have an optional `"title"` after the URL. Only
    // the URL group should change.
    const input = 'See [the docs](/docs "The Manual") for more.';
    const output = rewriteInternalLinks(input, opts);
    expect(output).toBe('See [the docs](/pt-BR/docs "The Manual") for more.');
  });

  it("preserves frontmatter unchanged", () => {
    // Frontmatter is YAML, not markdown link syntax. Even if a value
    // happens to look like a URL, the rewriter shouldn't touch it.
    const input = ["---", 'title: "Hello"', "url: /not-a-link", "---", "", "Body with [real link](/real).", ""].join("\n");
    const output = rewriteInternalLinks(input, opts);
    expect(output).toBe(["---", 'title: "Hello"', "url: /not-a-link", "---", "", "Body with [real link](/pt-BR/real).", ""].join("\n"));
  });

  it("rewrites links inside tables", () => {
    const input = ["| Col | Link |", "| --- | ---- |", "| a   | [x](/x) |", ""].join("\n");
    const output = rewriteInternalLinks(input, opts);
    expect(output).toBe(["| Col | Link |", "| --- | ---- |", "| a   | [x](/pt-BR/x) |", ""].join("\n"));
  });
});
