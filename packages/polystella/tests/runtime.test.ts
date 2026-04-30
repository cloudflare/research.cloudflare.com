import { describe, expect, it, vi } from "vitest";

import {
  normaliseGetLocalizedEntryArgs,
  resolveLocalizedEntry,
  splitFrontmatter,
  type ResolveLocalizedEntryDeps,
} from "../src/runtime/get-localized-entry.js";

/**
 * Tests for the pure runtime helper that powers `getLocalizedEntry`.
 *
 * The helper is tiny but lives on the hot path of every locale-prefixed
 * page render, so each branch (default-locale fallback, .md hit,
 * .mdx hit, miss-then-fallback, missing source) gets a dedicated
 * test rather than relying on the public wrapper to exercise them.
 *
 * All deps are injected so the suite never touches the real
 * filesystem and never imports `astro:content` (which has no
 * meaningful types in the package's standalone tsconfig).
 */

const DEFAULT_LOCALE = "en";
const STAGING_DIR = "/abs/staging";

/**
 * Tiny `resolveKeys` stub that matches the build-hook contract: a
 * `<collection>/**` glob unions the keys of every matching rule into
 * a single list. Real builds pass `resolveFrontmatterKeys` (powered
 * by picomatch) here — the stub is shape-equivalent for the
 * single-glob-per-collection rules these tests use.
 */
function stubResolveKeys(
  sourcePath: string,
  rules: Record<string, string[]>,
): string[] {
  const matched = new Set<string>();
  for (const [pattern, keys] of Object.entries(rules)) {
    const prefix = pattern.replace(/\/\*\*$/, "");
    if (sourcePath === prefix || sourcePath.startsWith(`${prefix}/`)) {
      for (const k of keys) matched.add(k);
    }
  }
  return [...matched];
}

function makeDeps(
  overrides: Partial<ResolveLocalizedEntryDeps> = {},
): ResolveLocalizedEntryDeps {
  return {
    defaultLocale: DEFAULT_LOCALE,
    stagingDir: STAGING_DIR,
    // Default: no staged file. Tests that need a hit override this.
    // Wrapped in vi.fn so the default-locale guard tests can assert
    // probing did or did not happen.
    readFile: vi.fn(() => null),
    // Posix-style path join keeps the tests stable across OSes; the
    // real wrapper passes node:path's `path.join`.
    joinPath: (...parts) => parts.join("/"),
    // Default: source entry exists with a known shape. Tests that
    // need missing-source behaviour override this to return undefined.
    // The merge-over-source model calls this on EVERY lookup — not
    // just the fallback path — because the source entry is the
    // skeleton onto which translations overlay.
    getEntry: vi.fn(async (collection, slug) => ({
      id: slug,
      collection,
      data: { title: `Source: ${slug}` },
      body: "Source body",
    })),
    // Default: no fields are translatable. Suites that exercise the
    // overlay branch override this with a per-collection map.
    frontmatterRules: {},
    resolveKeys: stubResolveKeys,
    ...overrides,
  };
}

describe("resolveLocalizedEntry — default-locale path", () => {
  it("returns the source entry verbatim when locale is undefined", async () => {
    // The merge-over-source model uses the source entry as the
    // skeleton on every call — default-locale lookups round-trip
    // it byte-for-byte and just attach the extension fields.
    const deps = makeDeps();
    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: undefined,
      deps,
    });
    expect(result).toEqual({
      collection: "publications",
      id: "foo",
      data: { title: "Source: foo" },
      body: "Source body",
      isLocalized: false,
      locale: DEFAULT_LOCALE,
    });
    expect(deps.getEntry).toHaveBeenCalledWith("publications", "foo");
    expect(deps.readFile).not.toHaveBeenCalled();
  });

  it("treats the empty string as the default locale", async () => {
    // Astro's `Astro.currentLocale` can be `""` for the default locale
    // depending on routing config — treating it identically to
    // `undefined` keeps consumer code free of an extra guard.
    const deps = makeDeps();
    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "",
      deps,
    });
    expect(result?.isLocalized).toBe(false);
    expect(deps.readFile).not.toHaveBeenCalled();
  });

  it("skips the staging probe when locale equals defaultLocale", async () => {
    const deps = makeDeps();
    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: DEFAULT_LOCALE,
      deps,
    });
    expect(result?.isLocalized).toBe(false);
    // No filesystem probing on the default-locale path — the
    // early-exit guard fires before the staging branch.
    expect(deps.readFile).not.toHaveBeenCalled();
  });

  it("preserves arbitrary extra fields on the source entry", async () => {
    // Astro's real CollectionEntry carries `filePath`, `digest`,
    // `rendered`, etc. — the helper's SourceEntryShape doesn't
    // enumerate them, but the {...source} spread must round-trip
    // them so consumers using `<Content />` or `entry.filePath`
    // see the same shape `getEntry` would have given them.
    const sourceEntry = {
      id: "foo",
      collection: "publications",
      data: { title: "Source: foo" },
      body: "Source body",
      filePath: "content/publications/Foo.md",
      digest: "abc123",
      rendered: { html: "<p>HTML</p>", metadata: { headings: [] } },
    };
    const deps = makeDeps({
      getEntry: async () => sourceEntry,
    });
    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: undefined,
      deps,
    });
    expect(result).toMatchObject({
      filePath: "content/publications/Foo.md",
      digest: "abc123",
      rendered: { html: "<p>HTML</p>", metadata: { headings: [] } },
      isLocalized: false,
    });
  });

  it("returns undefined when the source entry itself is missing", async () => {
    // Mirrors `getEntry`'s missing-entry sentinel exactly so the
    // helper is a true drop-in. A `null` here would slip through
    // consumer `(e) => e !== undefined` filters and crash the
    // first time the page reads `entry.data`.
    const deps = makeDeps({
      getEntry: async () => undefined,
    });
    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "ghost",
      locale: DEFAULT_LOCALE,
      deps,
    });
    expect(result).toBeUndefined();
  });
});

describe("resolveLocalizedEntry — staged hit (merge over source)", () => {
  it("overlays only the configured-translatable keys onto source data", async () => {
    // The crucial parity test: even though the staged frontmatter
    // contains all keys (the build hook copies the full frontmatter
    // for human readability), the runtime must overlay ONLY the
    // keys configured for translation. Unconfigured keys —
    // `authors` (a `reference()[]` field), `year`, `doi` — keep
    // their schema-validated values from the source entry,
    // preserving Astro's reference resolution.
    const sourceAuthors = [
      { collection: "people", id: "mario-antunes" },
      { collection: "people", id: "tyler-estro" },
    ];
    const staged = [
      "---",
      'title: "Kneeliverse: Uma biblioteca"',
      "year: 2025",
      "authors:",
      "  - mario-antunes",
      "  - tyler-estro",
      "doi: 10.1016/j.softx.2025.102161",
      "---",
      "",
      "Identificar pontos de joelho...",
    ].join("\n");

    const deps = makeDeps({
      getEntry: async (collection, slug) => ({
        id: slug,
        collection,
        data: {
          title: "Kneeliverse: A universal library",
          year: 2025,
          authors: sourceAuthors,
          doi: "10.1016/j.softx.2025.102161",
        },
        body: "Identifying knee and elbow points...",
      }),
      readFile: (p: string) => (p.endsWith(".md") ? staged : null),
      frontmatterRules: { "publications/**": ["title"] },
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "antunes2025",
      locale: "pt-BR",
      deps,
    });

    expect(result?.data.title).toBe("Kneeliverse: Uma biblioteca");
    // Authors must remain the schema-validated ref-objects from
    // source — NOT the bare strings the staged YAML carries. This
    // is the regression that broke contributors rendering before
    // the merge model.
    expect(result?.data.authors).toEqual(sourceAuthors);
    // Untranslated scalars round-trip from source.
    expect(result?.data.year).toBe(2025);
    expect(result?.data.doi).toBe("10.1016/j.softx.2025.102161");
    expect(result?.isLocalized).toBe(true);
    expect(result?.locale).toBe("pt-BR");
  });

  it("replaces the body with the staged body unconditionally", async () => {
    // Body is always translated wholesale — there's no per-key
    // gating for the markdown content the way there is for
    // frontmatter scalars.
    const staged = [
      "---",
      'title: "Translated"',
      "---",
      "",
      "Translated body content.",
    ].join("\n");
    const deps = makeDeps({
      readFile: (p: string) => (p.endsWith(".md") ? staged : null),
      frontmatterRules: { "publications/**": ["title"] },
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });
    expect(result?.body).toBe("\nTranslated body content.");
  });

  it("preserves source's filePath/digest/rendered through the merge", async () => {
    // Phase 1 punt: `rendered.html` stays source-language. Phase 2
    // will rewire the markdown renderer; until then, this test pins
    // the survive-the-merge contract for the auxiliary fields.
    const staged = ["---", 'title: "PT"', "---", "", "PT body"].join("\n");
    const deps = makeDeps({
      getEntry: async () => ({
        id: "foo",
        collection: "publications",
        data: { title: "EN" },
        body: "EN body",
        filePath: "content/publications/Foo.md",
        digest: "abc123",
        rendered: { html: "<p>EN HTML</p>", metadata: { headings: [] } },
      }),
      readFile: (p: string) => (p.endsWith(".md") ? staged : null),
      frontmatterRules: { "publications/**": ["title"] },
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(result).toMatchObject({
      filePath: "content/publications/Foo.md",
      digest: "abc123",
      rendered: { html: "<p>EN HTML</p>", metadata: { headings: [] } },
      data: { title: "PT" },
      body: "\nPT body",
    });
  });

  it("ignores staged keys not listed in frontmatterRules", async () => {
    // A staged frontmatter key that isn't in the translation
    // contract for this collection MUST NOT overlay — even if the
    // staged file contains it. This is the boundary that keeps
    // reference fields safe from the bare-string overlay problem.
    const staged = [
      "---",
      'title: "Translated title"',
      'year: "WRONG"',
      "---",
      "",
      "Body",
    ].join("\n");
    const deps = makeDeps({
      readFile: (p: string) => (p.endsWith(".md") ? staged : null),
      // Only `title` is translatable — `year` should be ignored.
      frontmatterRules: { "publications/**": ["title"] },
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });
    expect(result?.data.title).toBe("Translated title");
    // `year` is not in source's data here (the default stub only
    // sets `title`), so the overlay would have surfaced "WRONG" if
    // the gate weren't enforced. Asserting absence is the cleanest
    // signal.
    expect(result?.data.year).toBeUndefined();
  });

  it("overlays nothing when no rule matches the path", async () => {
    // A collection with NO translatable keys configured (e.g.
    // people, tags) should still fetch source and read the staged
    // body, but the data field round-trips from source unchanged.
    // This is the common case for cross-referenced collections.
    const staged = [
      "---",
      'title: "Translated title"',
      "---",
      "",
      "Body",
    ].join("\n");
    const deps = makeDeps({
      readFile: (p: string) => (p.endsWith(".md") ? staged : null),
      frontmatterRules: { "publications/**": ["title"] },
    });

    const result = await resolveLocalizedEntry({
      collection: "people",
      slug: "diogo",
      locale: "pt-BR",
      deps,
    });
    expect(result?.data).toEqual({ title: "Source: diogo" });
    expect(result?.isLocalized).toBe(true);
  });

  it("falls through to .mdx when no .md file exists", async () => {
    const staged = ["---", 'title: "MDX"', "---", "", "Body"].join("\n");
    const readFile = vi.fn((p: string) =>
      p.endsWith(".mdx") ? staged : null,
    );
    const deps = makeDeps({ readFile });

    await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    // Probe order is .md first, then .mdx — flipping the order would
    // mean `.md` overrides take precedence when both exist, which is
    // the behaviour we explicitly want.
    expect(readFile).toHaveBeenNthCalledWith(
      1,
      `${STAGING_DIR}/pt-BR/publications/foo.md`,
    );
    expect(readFile).toHaveBeenNthCalledWith(
      2,
      `${STAGING_DIR}/pt-BR/publications/foo.mdx`,
    );
  });

  it("scopes the staging path by collection and locale", async () => {
    // A staged file at the wrong locale or collection must NOT be
    // served — the filesystem layout is the security boundary
    // between locales.
    const readFile = vi.fn((p: string) =>
      p === `${STAGING_DIR}/pt-BR/publications/foo.md` ? "" : null,
    );
    const deps = makeDeps({ readFile });

    await resolveLocalizedEntry({
      collection: "people",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });
    // people/foo.md was probed, NOT publications/foo.md (which is
    // the only path the stub would have honoured).
    expect(readFile).toHaveBeenCalledWith(
      `${STAGING_DIR}/pt-BR/people/foo.md`,
    );
  });
});

describe("resolveLocalizedEntry — rendered overlay (Phase 2)", () => {
  // The build hook's renderer writes `<id>.html` and `<id>.meta.json`
  // sibling files alongside the staged `.md`. The runtime helper
  // probes for both after a staged-md hit and overlays
  // `entry.rendered.{html,metadata}` when both exist. These tests
  // pin that contract.

  const stagedMd = ["---", 'title: "Olá"', "---", "", "Olá Mundo."].join("\n");
  const stagedHtml = "<p>Olá Mundo.</p>";
  const stagedMeta = { headings: [{ depth: 1, slug: "ola", text: "Olá" }] };

  function makeStubReadFile(
    files: Record<string, string | null>,
  ): (p: string) => string | null {
    return (p: string) => (p in files ? files[p] : null);
  }

  it("overlays rendered.html and metadata when both sidecars exist", async () => {
    const deps = makeDeps({
      getEntry: async () => ({
        id: "foo",
        collection: "publications",
        data: { title: "EN" },
        body: "EN body",
        rendered: { html: "<p>EN HTML</p>", metadata: { headings: [] } },
      }),
      readFile: makeStubReadFile({
        [`${STAGING_DIR}/pt-BR/publications/foo.md`]: stagedMd,
        [`${STAGING_DIR}/pt-BR/publications/foo.html`]: stagedHtml,
        [`${STAGING_DIR}/pt-BR/publications/foo.meta.json`]: JSON.stringify(
          stagedMeta,
        ),
      }),
      frontmatterRules: { "publications/**": ["title"] },
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    // Translated HTML overlays source HTML.
    expect(result?.rendered?.html).toBe(stagedHtml);
    // Metadata round-trips through JSON.parse — same shape as the
    // build hook wrote.
    expect(result?.rendered?.metadata).toEqual(stagedMeta);
    // Body and data overlays still happen alongside.
    expect(result?.body).toBe("\nOlá Mundo.");
    expect(result?.data).toEqual({ title: "Olá" });
    expect(result?.isLocalized).toBe(true);
  });

  it("falls through to source's rendered when sidecars are missing (mdx-skip path)", async () => {
    // The renderer skips writing sidecars on `.mdx` source files;
    // the `.md` staging path still has translated body+frontmatter,
    // but no `.html`/`.meta.json`. The runtime should leave the
    // source's `rendered` untouched so `<Content />` falls back to
    // source-language HTML.
    const sourceRendered = {
      html: "<p>EN HTML</p>",
      metadata: { headings: [{ depth: 1, slug: "en", text: "EN" }] },
    };
    const deps = makeDeps({
      getEntry: async () => ({
        id: "foo",
        collection: "publications",
        data: { title: "EN" },
        body: "EN body",
        rendered: sourceRendered,
      }),
      // Only the `.md` exists; `.html` and `.meta.json` return null.
      readFile: makeStubReadFile({
        [`${STAGING_DIR}/pt-BR/publications/foo.md`]: stagedMd,
      }),
      frontmatterRules: { "publications/**": ["title"] },
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    // Source's rendered survives the merge intact.
    expect(result?.rendered).toEqual(sourceRendered);
    // Body+data overlays still happen — only the rendered overlay
    // is gated on both sidecars existing.
    expect(result?.body).toBe("\nOlá Mundo.");
    expect(result?.data).toEqual({ title: "Olá" });
    expect(result?.isLocalized).toBe(true);
  });

  it("does NOT overlay rendered when only .html exists (atomic-pair contract)", async () => {
    // Defensive: writing `.html` without `.meta.json` would mean a
    // partial render — the build hook never produces this, but if it
    // ever did (interrupted build, manual edit), we must not pretend
    // we have a complete `rendered`. Both halves or neither.
    const sourceRendered = {
      html: "<p>EN HTML</p>",
      metadata: { headings: [] },
    };
    const deps = makeDeps({
      getEntry: async () => ({
        id: "foo",
        collection: "publications",
        data: {},
        rendered: sourceRendered,
      }),
      readFile: makeStubReadFile({
        [`${STAGING_DIR}/pt-BR/publications/foo.md`]: stagedMd,
        [`${STAGING_DIR}/pt-BR/publications/foo.html`]: stagedHtml,
        // No `.meta.json`.
      }),
      frontmatterRules: {},
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(result?.rendered).toEqual(sourceRendered);
  });

  it("populates rendered on the localized result even when source has no rendered", async () => {
    // A loader-defined collection (Astro 5+) may produce entries
    // without a `rendered` field at all. The overlay still applies:
    // staged sidecars define a rendered for the localized branch
    // even when source has none.
    const deps = makeDeps({
      getEntry: async () => ({
        id: "foo",
        collection: "publications",
        data: {},
        // No `rendered` key on the source entry.
      }),
      readFile: makeStubReadFile({
        [`${STAGING_DIR}/pt-BR/publications/foo.md`]: stagedMd,
        [`${STAGING_DIR}/pt-BR/publications/foo.html`]: stagedHtml,
        [`${STAGING_DIR}/pt-BR/publications/foo.meta.json`]: JSON.stringify(
          stagedMeta,
        ),
      }),
      frontmatterRules: {},
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(result?.rendered).toEqual({
      html: stagedHtml,
      metadata: stagedMeta,
    });
  });

  it("does not probe sidecars on the default-locale path", async () => {
    // Default locale → source verbatim, no staging probe at all.
    // The source's `rendered` round-trips untouched and `readFile`
    // is never consulted. This is important: even if a stale
    // sidecar happened to live at `<stagingDir>/<defaultLocale>/...`,
    // the helper must not surface it.
    const sourceRendered = {
      html: "<p>EN HTML</p>",
      metadata: { headings: [] },
    };
    const readFile = vi.fn(() => null);
    const deps = makeDeps({
      getEntry: async () => ({
        id: "foo",
        collection: "publications",
        data: {},
        rendered: sourceRendered,
      }),
      readFile,
    });

    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: DEFAULT_LOCALE,
      deps,
    });

    expect(result?.rendered).toEqual(sourceRendered);
    expect(result?.isLocalized).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("resolveLocalizedEntry — staged miss fallback", () => {
  it("falls back to the source entry when no staged file exists", async () => {
    const deps = makeDeps();
    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "foo",
      locale: "pt-BR",
      deps,
    });

    expect(result).toMatchObject({
      collection: "publications",
      id: "foo",
      isLocalized: false,
      // Fallback resets locale to defaultLocale: that's what the
      // bytes actually represent, so a consumer rendering an
      // `<html lang>` attribute reads the truth from the helper.
      locale: DEFAULT_LOCALE,
    });
    expect(deps.getEntry).toHaveBeenCalledWith("publications", "foo");
  });

  it("returns undefined when both staging and source are empty", async () => {
    const deps = makeDeps({
      getEntry: async () => undefined,
    });
    const result = await resolveLocalizedEntry({
      collection: "publications",
      slug: "ghost",
      locale: "pt-BR",
      deps,
    });
    expect(result).toBeUndefined();
  });
});

describe("normaliseGetLocalizedEntryArgs — overload disambiguation", () => {
  it("accepts the tuple form (collection, id, locale)", () => {
    expect(
      normaliseGetLocalizedEntryArgs("publications", "foo", "pt-BR"),
    ).toEqual({ collection: "publications", id: "foo", locale: "pt-BR" });
  });

  it("accepts the tuple form with locale omitted", () => {
    expect(
      normaliseGetLocalizedEntryArgs("publications", "foo", undefined),
    ).toEqual({ collection: "publications", id: "foo", locale: undefined });
  });

  it("accepts the reference form (ref, locale)", () => {
    // Drop-in for `getEntry({ collection, id })` — the migration
    // pattern PolyStella's runtime helper supports so authors can
    // swap `getEntry(ref)` for `getLocalizedEntry(ref, locale)` in
    // a single edit.
    expect(
      normaliseGetLocalizedEntryArgs(
        { collection: "people", id: "diogo" },
        "pt-BR",
        undefined,
      ),
    ).toEqual({ collection: "people", id: "diogo", locale: "pt-BR" });
  });

  it("accepts the reference form with locale omitted", () => {
    expect(
      normaliseGetLocalizedEntryArgs(
        { collection: "people", id: "diogo" },
        undefined,
        undefined,
      ),
    ).toEqual({ collection: "people", id: "diogo", locale: undefined });
  });

  it("ignores a third positional arg in the reference form", () => {
    // No interpretation for it — silently drop rather than throw,
    // since some consumers might forward `Astro.currentLocale` and
    // `undefined` to a wrapper without checking the form first.
    expect(
      normaliseGetLocalizedEntryArgs(
        { collection: "people", id: "diogo" },
        "pt-BR",
        "ja-JP",
      ),
    ).toEqual({ collection: "people", id: "diogo", locale: "pt-BR" });
  });

  it("throws when the tuple form is missing the id arg", () => {
    expect(() =>
      normaliseGetLocalizedEntryArgs("publications", undefined, undefined),
    ).toThrowError(/`id` is required when the first argument is a string/);
  });
});

describe("splitFrontmatter", () => {
  it("returns empty data and the full body when no fence is present", () => {
    const raw = "Just a body.\n";
    expect(splitFrontmatter(raw)).toEqual({ data: {}, body: raw });
  });

  it("parses a YAML frontmatter block", () => {
    const raw = "---\ntitle: Foo\ncount: 3\n---\nBody content.\n";
    expect(splitFrontmatter(raw)).toEqual({
      data: { title: "Foo", count: 3 },
      body: "Body content.\n",
    });
  });

  it("tolerates CRLF line endings (windows-authored overrides)", () => {
    const raw = "---\r\ntitle: Foo\r\n---\r\nBody.\r\n";
    expect(splitFrontmatter(raw).data).toEqual({ title: "Foo" });
  });

  it("handles an empty frontmatter block", () => {
    const raw = "---\n\n---\nBody.\n";
    expect(splitFrontmatter(raw).data).toEqual({});
  });
});
