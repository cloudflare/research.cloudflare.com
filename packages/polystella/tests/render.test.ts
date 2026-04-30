import { describe, expect, it, vi } from "vitest";

import {
  createRenderer,
  renderToStaging,
  type Renderer,
} from "../src/rendering/render.js";

/**
 * Tests for the build-time rendering helper.
 *
 * The suite is split into two parts:
 *
 *   1. `renderToStaging` write-orchestration tests with a stubbed
 *      renderer and stubbed fs — these pin the file-naming convention
 *      (`<id>.md` + `<id>.html` + `<id>.meta.json`), the MDX-skip
 *      policy, the renderer-disabled short-circuit, and the
 *      directory-creation contract. No real markdown processing
 *      happens, so they're fast and deterministic.
 *
 *   2. `createRenderer` integration tests against a real
 *      `@astrojs/markdown-remark` processor — these confirm the
 *      Astro pipeline is reachable, the result shape matches the
 *      contract the runtime helper expects, and frontmatter survives
 *      the render cycle.
 *
 * The two halves stay decoupled so the bulk of the suite can run
 * without spinning up the markdown processor (which is slow on a
 * cold cache because of Shiki).
 */

const STAGING_DIR = "/abs/staging";

interface StubFs {
  mkdir: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
}

function makeStubFs(): StubFs {
  return {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
}

function makeStubRenderer(
  result: { code: string; metadata: unknown } = {
    code: "<p>Hello</p>",
    metadata: { headings: [] },
  },
): Renderer {
  return {
    render: vi.fn(async () => result as never),
  };
}

describe("renderToStaging — file orchestration", () => {
  it("writes the .md sidecar alongside .html and .meta.json on a .md source", async () => {
    const fs = makeStubFs();
    const renderer = makeStubRenderer({
      code: "<p>Olá Mundo</p>",
      metadata: { headings: [{ depth: 1, slug: "ola", text: "Olá" }] },
    });

    await renderToStaging({
      renderer,
      stagingDir: STAGING_DIR,
      locale: "pt-BR",
      relativeSourcePath: "publications/Antunes2025.md",
      translatedBytes: '---\ntitle: "Olá"\n---\n\nOlá Mundo.',
      sourceFileURL: new URL("file:///abs/source/publications/Antunes2025.md"),
      fs,
    });

    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining("/abs/staging/pt-BR/publications"),
      { recursive: true },
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/abs/staging/pt-BR/publications/Antunes2025.md",
      '---\ntitle: "Olá"\n---\n\nOlá Mundo.',
      "utf8",
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/abs/staging/pt-BR/publications/Antunes2025.html",
      "<p>Olá Mundo</p>",
      "utf8",
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/abs/staging/pt-BR/publications/Antunes2025.meta.json",
      '{"headings":[{"depth":1,"slug":"ola","text":"Olá"}]}',
      "utf8",
    );
  });

  it("forwards the source fileURL (not the staging path) to the renderer", async () => {
    // Relative image paths and rehype plugins that resolve files
    // anchor at `fileURL`. Anchoring at the staging path would
    // resolve them at non-existent paths under `.astro/i18n-staging`;
    // anchoring at the source path matches Astro's own rendering of
    // source pages.
    const fs = makeStubFs();
    const renderer = makeStubRenderer();
    const sourceFileURL = new URL(
      "file:///abs/source/publications/Antunes2025.md",
    );

    await renderToStaging({
      renderer,
      stagingDir: STAGING_DIR,
      locale: "pt-BR",
      relativeSourcePath: "publications/Antunes2025.md",
      translatedBytes: "body",
      sourceFileURL,
      fs,
    });

    expect(renderer.render).toHaveBeenCalledWith("body", sourceFileURL);
  });

  it("skips HTML rendering on .mdx sources and calls onMdxSkip", async () => {
    // MDX is a separate pipeline (`@astrojs/mdx`) that produces a
    // component, not HTML — out of scope for now. The .md is still
    // staged so frontmatter+body translation works; the runtime
    // helper falls back to source's `rendered` for HTML.
    const fs = makeStubFs();
    const renderer = makeStubRenderer();
    const onMdxSkip = vi.fn();

    await renderToStaging({
      renderer,
      stagingDir: STAGING_DIR,
      locale: "pt-BR",
      relativeSourcePath: "posts/foo.mdx",
      translatedBytes: "---\ntitle: Foo\n---\nBody",
      sourceFileURL: new URL("file:///abs/source/posts/foo.mdx"),
      onMdxSkip,
      fs,
    });

    // .md (well, .mdx — same staging filename as source) is written.
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/abs/staging/pt-BR/posts/foo.mdx",
      "---\ntitle: Foo\n---\nBody",
      "utf8",
    );
    // No .html, no .meta.json.
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(onMdxSkip).toHaveBeenCalledWith("posts/foo.mdx");
  });

  it("treats .MDX (uppercase) the same as .mdx", async () => {
    // Ext normalisation matters on case-insensitive filesystems
    // (mac default, Windows); match by lowercased extension.
    const fs = makeStubFs();
    const renderer = makeStubRenderer();

    await renderToStaging({
      renderer,
      stagingDir: STAGING_DIR,
      locale: "pt-BR",
      relativeSourcePath: "posts/Foo.MDX",
      translatedBytes: "Body",
      sourceFileURL: new URL("file:///abs/source/posts/Foo.MDX"),
      fs,
    });

    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it("writes only the .md sidecar when renderer is undefined", async () => {
    // The opt-out path: a consumer who never uses `<Content />` or
    // `entry.rendered.html` can pass `renderer: undefined` to skip
    // the rendering work entirely. The translated `.md` still
    // stages so `entry.body` and `entry.data` overlay correctly.
    const fs = makeStubFs();

    await renderToStaging({
      renderer: undefined,
      stagingDir: STAGING_DIR,
      locale: "pt-BR",
      relativeSourcePath: "publications/Antunes2025.md",
      translatedBytes: "Body",
      sourceFileURL: new URL("file:///abs/source/publications/Antunes2025.md"),
      fs,
    });

    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/abs/staging/pt-BR/publications/Antunes2025.md",
      "Body",
      "utf8",
    );
  });

  it("creates the staging subdirectory before any write", async () => {
    // mkdir-recursive must run before writeFile or the writes ENOENT
    // on a fresh build. Asserting call order would over-couple to
    // implementation; assert that mkdir was called with the right
    // arg, since the writeFile errors will surface naturally if the
    // dir isn't there.
    const fs = makeStubFs();
    const renderer = makeStubRenderer();

    await renderToStaging({
      renderer,
      stagingDir: STAGING_DIR,
      locale: "pt-BR",
      relativeSourcePath: "deep/nested/dir/foo.md",
      translatedBytes: "Body",
      sourceFileURL: new URL("file:///abs/source/deep/nested/dir/foo.md"),
      fs,
    });

    expect(fs.mkdir).toHaveBeenCalledWith(
      "/abs/staging/pt-BR/deep/nested/dir",
      { recursive: true },
    );
  });

  it("scopes the staging path by locale", async () => {
    // Two locales must never write to the same path — the locale
    // prefix is the only thing keeping translations from clobbering
    // each other.
    const fs = makeStubFs();
    const renderer = makeStubRenderer();

    await renderToStaging({
      renderer,
      stagingDir: STAGING_DIR,
      locale: "ja-JP",
      relativeSourcePath: "publications/Antunes2025.md",
      translatedBytes: "Body",
      sourceFileURL: new URL("file:///abs/source/publications/Antunes2025.md"),
      fs,
    });

    expect(fs.writeFile).toHaveBeenCalledWith(
      "/abs/staging/ja-JP/publications/Antunes2025.md",
      expect.any(String),
      "utf8",
    );
  });
});

/**
 * Integration tests against a real markdown processor.
 *
 * These are kept minimal because the suite's main job is testing
 * PolyStella's wiring, not Astro's processor. We just confirm the
 * factory returns something callable and the result shape matches
 * what `mergeStagedOnSource` will read.
 */
describe("createRenderer — Astro processor integration", () => {
  it("renders a basic markdown body to HTML with metadata", async () => {
    const { createMarkdownProcessor } = await import(
      "@astrojs/markdown-remark"
    );
    const processor = await createMarkdownProcessor();
    const renderer = createRenderer(processor);

    const result = await renderer.render(
      "# Hello\n\nA paragraph.",
      new URL("file:///abs/source/publications/Antunes2025.md"),
    );

    expect(result.code).toContain("Hello");
    expect(result.code).toContain("paragraph");
    expect(Array.isArray(result.metadata.headings)).toBe(true);
    expect(result.metadata.headings[0]).toMatchObject({
      depth: 1,
      text: "Hello",
    });
  });

  it("survives a frontmatter-prefixed body and surfaces frontmatter in metadata", async () => {
    // Astro's processor strips frontmatter into `metadata.frontmatter`
    // and renders the body. The build hook hands it the full bytes
    // (frontmatter + body) so this round-trip is the contract.
    const { createMarkdownProcessor } = await import(
      "@astrojs/markdown-remark"
    );
    const processor = await createMarkdownProcessor();
    const renderer = createRenderer(processor);

    const result = await renderer.render(
      ['---', 'title: "Olá"', 'year: 2025', '---', '', 'Olá Mundo.'].join("\n"),
      new URL("file:///abs/source/publications/Foo.md"),
    );

    expect(result.code).toContain("Olá Mundo");
    expect(result.metadata.frontmatter).toMatchObject({
      title: "Olá",
      year: 2025,
    });
  });
});
