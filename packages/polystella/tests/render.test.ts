import { describe, expect, it, vi } from "vitest";

import {
  computeBuildEpoch,
  computeMdHash,
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
const BUILD_EPOCH = "epoch-stub-0000";
const POLYSTELLA_VERSION = "0.1.0";

interface StubFs {
  mkdir: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
}

/**
 * Default stub fs: no files exist (`readFile` returns null), writes
 * are no-ops. Tests that need pre-populated content override
 * `readFile` via `withFiles`.
 */
function makeStubFs(
  files: Record<string, string | null> = {},
): StubFs {
  return {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(async (p: string) => (p in files ? files[p] : null)),
  };
}

/**
 * Boilerplate-minimiser: every `renderToStaging` call needs the
 * build epoch + version. Encapsulating them keeps the test bodies
 * focused on the behaviour under test.
 */
function baseArgs(
  overrides: Partial<Parameters<typeof renderToStaging>[0]> = {},
) {
  return {
    stagingDir: STAGING_DIR,
    locale: "pt-BR",
    relativeSourcePath: "publications/Antunes2025.md",
    translatedBytes: "Body",
    sourceFileURL: new URL(
      "file:///abs/source/publications/Antunes2025.md",
    ),
    buildEpoch: BUILD_EPOCH,
    polystellaVersion: POLYSTELLA_VERSION,
    ...overrides,
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

    const outcome = await renderToStaging({
      ...baseArgs({
        translatedBytes: '---\ntitle: "Olá"\n---\n\nOlá Mundo.',
      }),
      renderer,
      fs,
    });

    expect(outcome).toBe("rendered");
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
    // The render-cache sidecar gets written too. Don't pin the
    // exact bytes here (renderedAt timestamp varies) — the
    // dedicated cache tests below cover its content.
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/abs/staging/pt-BR/publications/Antunes2025.render-cache.json",
      expect.any(String),
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
      ...baseArgs({ translatedBytes: "body", sourceFileURL }),
      renderer,
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

    const outcome = await renderToStaging({
      ...baseArgs({
        relativeSourcePath: "posts/foo.mdx",
        translatedBytes: "---\ntitle: Foo\n---\nBody",
        sourceFileURL: new URL("file:///abs/source/posts/foo.mdx"),
      }),
      renderer,
      onMdxSkip,
      fs,
    });

    expect(outcome).toBe("mdx-skip");
    // .md (well, .mdx — same staging filename as source) is written.
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/abs/staging/pt-BR/posts/foo.mdx",
      "---\ntitle: Foo\n---\nBody",
      "utf8",
    );
    // No .html, no .meta.json, no render-cache.json.
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(onMdxSkip).toHaveBeenCalledWith("posts/foo.mdx");
  });

  it("treats .MDX (uppercase) the same as .mdx", async () => {
    // Ext normalisation matters on case-insensitive filesystems
    // (mac default, Windows); match by lowercased extension.
    const fs = makeStubFs();
    const renderer = makeStubRenderer();

    const outcome = await renderToStaging({
      ...baseArgs({
        relativeSourcePath: "posts/Foo.MDX",
        sourceFileURL: new URL("file:///abs/source/posts/Foo.MDX"),
      }),
      renderer,
      fs,
    });

    expect(outcome).toBe("mdx-skip");
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it("writes only the .md sidecar when renderer is undefined", async () => {
    // The opt-out path: a consumer who never uses `<Content />` or
    // `entry.rendered.html` can pass `renderer: undefined` to skip
    // the rendering work entirely. The translated `.md` still
    // stages so `entry.body` and `entry.data` overlay correctly.
    const fs = makeStubFs();

    const outcome = await renderToStaging({
      ...baseArgs(),
      renderer: undefined,
      fs,
    });

    expect(outcome).toBe("no-renderer");
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
      ...baseArgs({
        relativeSourcePath: "deep/nested/dir/foo.md",
        sourceFileURL: new URL(
          "file:///abs/source/deep/nested/dir/foo.md",
        ),
      }),
      renderer,
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
      ...baseArgs({ locale: "ja-JP" }),
      renderer,
      fs,
    });

    expect(fs.writeFile).toHaveBeenCalledWith(
      "/abs/staging/ja-JP/publications/Antunes2025.md",
      expect.any(String),
      "utf8",
    );
  });
});

describe("renderToStaging — render cache", () => {
  // Path constants reused across the matrix below. The naming
  // convention is fixed by `renderToStaging` (extension stripped,
  // suffixed). Hard-coding the strings here pins the contract.
  const MD_PATH = "/abs/staging/pt-BR/publications/Antunes2025.md";
  const HTML_PATH = "/abs/staging/pt-BR/publications/Antunes2025.html";
  const META_PATH =
    "/abs/staging/pt-BR/publications/Antunes2025.meta.json";
  const CACHE_PATH =
    "/abs/staging/pt-BR/publications/Antunes2025.render-cache.json";

  const TRANSLATED_BYTES = "---\ntitle: \"Olá\"\n---\n\nOlá Mundo.";

  function makeFreshCacheRecord() {
    return JSON.stringify({
      version: 1,
      mdHash: computeMdHash(TRANSLATED_BYTES),
      epoch: BUILD_EPOCH,
      polystellaVersion: POLYSTELLA_VERSION,
      renderedAt: "2026-04-30T12:00:00.000Z",
    });
  }

  it("skips render when cache record + sidecars all match", async () => {
    // The full happy-path: fresh `.render-cache.json` whose `mdHash`
    // matches the translated bytes and `epoch` matches the current
    // build, with both `.html` and `.meta.json` present. Renderer
    // must NOT be invoked; outcome must be `cache-hit`.
    const fs = makeStubFs({
      [CACHE_PATH]: makeFreshCacheRecord(),
      [HTML_PATH]: "<p>previously rendered</p>",
      [META_PATH]: '{"headings":[]}',
    });
    const renderer = makeStubRenderer();

    const outcome = await renderToStaging({
      ...baseArgs({ translatedBytes: TRANSLATED_BYTES }),
      renderer,
      fs,
    });

    expect(outcome).toBe("cache-hit");
    expect(renderer.render).not.toHaveBeenCalled();
    // The .md is still (re)written every build — it's the cheap
    // floor of the staging contract and the runtime helper depends
    // on its content for body/data overlays.
    expect(fs.writeFile).toHaveBeenCalledWith(
      MD_PATH,
      TRANSLATED_BYTES,
      "utf8",
    );
    // No .html, .meta.json, or .render-cache.json writes on a hit.
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });

  it("renders when mdHash differs from the cached value", async () => {
    // Translation changed (different bytes) → stored mdHash no
    // longer matches → must re-render and rewrite the sidecars.
    const fs = makeStubFs({
      [CACHE_PATH]: JSON.stringify({
        version: 1,
        mdHash: "stale-md-hash",
        epoch: BUILD_EPOCH,
        polystellaVersion: POLYSTELLA_VERSION,
        renderedAt: "2026-04-29T00:00:00.000Z",
      }),
      [HTML_PATH]: "<p>stale</p>",
      [META_PATH]: '{"headings":[]}',
    });
    const renderer = makeStubRenderer();

    const outcome = await renderToStaging({
      ...baseArgs({ translatedBytes: TRANSLATED_BYTES }),
      renderer,
      fs,
    });

    expect(outcome).toBe("rendered");
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it("renders when epoch differs from the cached value", async () => {
    // Same bytes but markdown config (or polystella version)
    // changed → stored epoch is now stale → must re-render.
    const fs = makeStubFs({
      [CACHE_PATH]: JSON.stringify({
        version: 1,
        mdHash: computeMdHash(TRANSLATED_BYTES),
        epoch: "stale-epoch",
        polystellaVersion: POLYSTELLA_VERSION,
        renderedAt: "2026-04-29T00:00:00.000Z",
      }),
      [HTML_PATH]: "<p>stale</p>",
      [META_PATH]: '{"headings":[]}',
    });
    const renderer = makeStubRenderer();

    const outcome = await renderToStaging({
      ...baseArgs({ translatedBytes: TRANSLATED_BYTES }),
      renderer,
      fs,
    });

    expect(outcome).toBe("rendered");
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it("renders when .html sidecar is missing despite a valid cache record", async () => {
    // Defensive: a cache record without the corresponding HTML
    // sidecar is a partial state (manual rm, half-written build).
    // Treat as miss — we'd rather re-render than hand the runtime
    // a missing-file probe.
    const fs = makeStubFs({
      [CACHE_PATH]: makeFreshCacheRecord(),
      // [HTML_PATH] omitted → readFile returns null.
      [META_PATH]: '{"headings":[]}',
    });
    const renderer = makeStubRenderer();

    const outcome = await renderToStaging({
      ...baseArgs({ translatedBytes: TRANSLATED_BYTES }),
      renderer,
      fs,
    });

    expect(outcome).toBe("rendered");
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it("renders when .meta.json sidecar is missing despite a valid cache record", async () => {
    const fs = makeStubFs({
      [CACHE_PATH]: makeFreshCacheRecord(),
      [HTML_PATH]: "<p>previously rendered</p>",
      // [META_PATH] omitted.
    });
    const renderer = makeStubRenderer();

    const outcome = await renderToStaging({
      ...baseArgs({ translatedBytes: TRANSLATED_BYTES }),
      renderer,
      fs,
    });

    expect(outcome).toBe("rendered");
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it("treats malformed cache JSON as a miss without throwing", async () => {
    // A hand-edited or truncated `.render-cache.json` must not
    // break the build — silently re-render and overwrite.
    const fs = makeStubFs({
      [CACHE_PATH]: "{ not valid json",
      [HTML_PATH]: "<p>x</p>",
      [META_PATH]: '{"headings":[]}',
    });
    const renderer = makeStubRenderer();

    const outcome = await renderToStaging({
      ...baseArgs({ translatedBytes: TRANSLATED_BYTES }),
      renderer,
      fs,
    });

    expect(outcome).toBe("rendered");
  });

  it("treats an unrecognised cache version as a miss", async () => {
    // Forward-compat: when we evolve the sidecar shape (version 2,
    // 3, …) older builds reading newer sidecars must re-render
    // rather than blindly trust the foreign shape. Same applies the
    // other way for newer builds reading older shape.
    const fs = makeStubFs({
      [CACHE_PATH]: JSON.stringify({
        version: 99,
        mdHash: computeMdHash(TRANSLATED_BYTES),
        epoch: BUILD_EPOCH,
      }),
      [HTML_PATH]: "<p>x</p>",
      [META_PATH]: '{"headings":[]}',
    });
    const renderer = makeStubRenderer();

    const outcome = await renderToStaging({
      ...baseArgs({ translatedBytes: TRANSLATED_BYTES }),
      renderer,
      fs,
    });

    expect(outcome).toBe("rendered");
  });

  it("writes a v1 cache record with mdHash + epoch + polystellaVersion on a miss", async () => {
    // The fresh cache sidecar that gets written must be in the
    // version-1 shape with all required fields. Future builds will
    // gate on this exact contract.
    const fs = makeStubFs();
    const renderer = makeStubRenderer();

    await renderToStaging({
      ...baseArgs({ translatedBytes: TRANSLATED_BYTES }),
      renderer,
      fs,
    });

    const cacheCall = fs.writeFile.mock.calls.find(
      ([p]) => p === CACHE_PATH,
    );
    expect(cacheCall).toBeDefined();
    const cacheBody = JSON.parse(cacheCall![1] as string);
    expect(cacheBody).toMatchObject({
      version: 1,
      mdHash: computeMdHash(TRANSLATED_BYTES),
      epoch: BUILD_EPOCH,
      polystellaVersion: POLYSTELLA_VERSION,
    });
    expect(cacheBody.renderedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it("does not write a cache sidecar on the .mdx-skip path", async () => {
    // No render → no cache key. Writing a sidecar for a path that
    // never produced HTML would be a confusing forensic artefact
    // and would falsely advertise a cache hit on a future build if
    // we ever added MDX rendering.
    const fs = makeStubFs();
    const renderer = makeStubRenderer();

    await renderToStaging({
      ...baseArgs({
        relativeSourcePath: "posts/foo.mdx",
        sourceFileURL: new URL("file:///abs/source/posts/foo.mdx"),
      }),
      renderer,
      fs,
    });

    const cacheCall = fs.writeFile.mock.calls.find(([p]) =>
      String(p).endsWith(".render-cache.json"),
    );
    expect(cacheCall).toBeUndefined();
  });
});

describe("computeBuildEpoch", () => {
  it("is idempotent for the same inputs", async () => {
    const a = computeBuildEpoch(
      { gfm: true, smartypants: false, shikiConfig: { theme: "github-dark" } },
      "0.1.0",
    );
    const b = computeBuildEpoch(
      { gfm: true, smartypants: false, shikiConfig: { theme: "github-dark" } },
      "0.1.0",
    );
    expect(a).toBe(b);
  });

  it("is order-insensitive within the markdown config", async () => {
    // Reordering top-level keys must not bust the cache — a config
    // tidy-up that's purely cosmetic should be a no-op here.
    const a = computeBuildEpoch({ gfm: true, smartypants: false }, "0.1.0");
    const b = computeBuildEpoch({ smartypants: false, gfm: true }, "0.1.0");
    expect(a).toBe(b);
  });

  it("differs when polystellaVersion changes", async () => {
    // Bumping the package version is the catch-all rendering-
    // semantics-changed lever: the epoch must move so all sidecars
    // re-render against the new package logic.
    const a = computeBuildEpoch({ gfm: true }, "0.1.0");
    const b = computeBuildEpoch({ gfm: true }, "0.2.0");
    expect(a).not.toBe(b);
  });

  it("differs when a tracked Shiki knob changes", async () => {
    const a = computeBuildEpoch(
      { shikiConfig: { theme: "github-dark" } },
      "0.1.0",
    );
    const b = computeBuildEpoch(
      { shikiConfig: { theme: "github-light" } },
      "0.1.0",
    );
    expect(a).not.toBe(b);
  });

  it("is stable across remarkPlugins changes (deliberate exclusion)", async () => {
    // Functions don't serialise stably; we deliberately drop them
    // from the epoch and document `rm -rf .astro/i18n-staging` as
    // the manual escape hatch when plugin logic changes. This test
    // pins that contract — if it ever flips, the cache could go
    // stale-but-believed-fresh on plugin upgrades.
    const fakePluginA = (() => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return function pluginA() {};
    })();
    const fakePluginB = (() => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return function pluginB() {};
    })();
    const a = computeBuildEpoch(
      { gfm: true, remarkPlugins: [fakePluginA] },
      "0.1.0",
    );
    const b = computeBuildEpoch(
      { gfm: true, remarkPlugins: [fakePluginB] },
      "0.1.0",
    );
    expect(a).toBe(b);
  });

  it("is stable across rehypePlugins changes (deliberate exclusion)", async () => {
    const a = computeBuildEpoch(
      { gfm: true, rehypePlugins: [() => undefined] },
      "0.1.0",
    );
    const b = computeBuildEpoch(
      { gfm: true, rehypePlugins: [() => null] },
      "0.1.0",
    );
    expect(a).toBe(b);
  });

  it("is stable when shikiConfig.transformers change (deliberate exclusion)", async () => {
    const a = computeBuildEpoch(
      {
        shikiConfig: {
          theme: "github-dark",
          transformers: [{ name: "a", code: () => undefined }],
        },
      },
      "0.1.0",
    );
    const b = computeBuildEpoch(
      {
        shikiConfig: {
          theme: "github-dark",
          transformers: [{ name: "b", pre: () => undefined }],
        },
      },
      "0.1.0",
    );
    expect(a).toBe(b);
  });

  it("produces a stable epoch for an undefined markdown config", async () => {
    // Sites that set `markdown: undefined` (or omit the block) must
    // still get a deterministic epoch — otherwise the cache would
    // miss on every build.
    const a = computeBuildEpoch(undefined, "0.1.0");
    const b = computeBuildEpoch(undefined, "0.1.0");
    expect(a).toBe(b);
    // And it should differ from the empty-object form only if the
    // version differs — with the same version, both should produce
    // the same digest because the helper coerces undefined to {}.
    const c = computeBuildEpoch({}, "0.1.0");
    expect(a).toBe(c);
  });
});

describe("computeMdHash", () => {
  it("produces the same hash for identical bytes", () => {
    expect(computeMdHash("hello")).toBe(computeMdHash("hello"));
  });

  it("produces different hashes for different bytes", () => {
    expect(computeMdHash("hello")).not.toBe(computeMdHash("hello!"));
  });

  it("is stable across UTF-8 multibyte content", () => {
    // Translation output is mostly multibyte. Confirm the hash
    // doesn't depend on a particular encoding round-trip path.
    expect(computeMdHash("Olá Mundo 世界")).toBe(
      computeMdHash("Olá Mundo 世界"),
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
