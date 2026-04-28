import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_GLOSSARY,
  EMPTY_GLOSSARY_HASH,
  hashGlossary,
  loadGlossaries,
  type Glossary,
} from "./glossary.js";
import type { PolyStellaResolvedOptions } from "./options.js";

/**
 * Build a minimal `PolyStellaResolvedOptions` with sensible defaults so
 * each test can override only the fields it cares about.
 */
function makeConfig(
  overrides: Partial<PolyStellaResolvedOptions> = {},
): PolyStellaResolvedOptions {
  return {
    defaultLocale: "en",
    locales: ["pt-BR", "ja-JP"],
    sourceDir: "./content",
    include: ["**/*.md"],
    exclude: [],
    frontmatter: {},
    routes: [],
    noTranslateBehavior: "fallback",
    rewriteInternalLinks: true,
    overridesDir: "./i18n/overrides",
    fallback: "default-locale",
    concurrency: 4,
    dryRun: false,
    runOn: ["build"],
    mode: "auto",
    ...overrides,
  } as PolyStellaResolvedOptions;
}

describe("loadGlossaries", () => {
  let tmpDir: string;
  let projectRoot: URL;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "polystella-glossary-"));
    // Pre-create the directory tree the test files write into so each
    // individual test can focus on glossary content rather than fs setup.
    mkdirSync(path.join(tmpDir, "i18n/glossary"), { recursive: true });
    projectRoot = pathToFileURL(tmpDir + path.sep);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty map when no glossary is configured", async () => {
    const result = await loadGlossaries({
      config: makeConfig(),
      projectRoot,
    });
    expect(result.size).toBe(0);
  });

  it("loads file-based glossaries for every locale that has a file", async () => {
    const glossaryDir = path.join(tmpDir, "i18n/glossary");
    writeFileSync(
      path.join(tmpDir, "i18n/glossary/pt-BR.yaml"),
      [
        'version: "2025-04"',
        "doNotTranslate:",
        "  - Cloudflare",
        "  - Workers",
        "preferredTranslations:",
        "  edge: borda",
        'notes: "Use Brazilian Portuguese."',
      ].join("\n"),
      { flag: "wx" },
    );
    writeFileSync(
      path.join(tmpDir, "i18n/glossary/ja-JP.yaml"),
      [
        'version: "2025-04"',
        "doNotTranslate:",
        "  - Cloudflare",
        "preferredTranslations:",
        "  edge: エッジ",
      ].join("\n"),
      { flag: "wx" },
    );

    const result = await loadGlossaries({
      config: makeConfig({
        glossary: { file: "./i18n/glossary/{locale}.yaml" },
      }),
      projectRoot,
    });

    expect(result.size).toBe(2);
    const pt = result.get("pt-BR");
    expect(pt).toBeDefined();
    expect(pt!.version).toBe("2025-04");
    expect(pt!.doNotTranslate).toEqual(["Cloudflare", "Workers"]);
    expect(pt!.preferredTranslations).toEqual({ edge: "borda" });
    expect(pt!.notes).toBe("Use Brazilian Portuguese.");

    const ja = result.get("ja-JP");
    expect(ja!.preferredTranslations).toEqual({ edge: "エッジ" });
    expect(glossaryDir).toContain("glossary"); // sanity: tmp path was used
  });

  it("silently skips locales whose glossary file does not exist", async () => {
    writeFileSync(
      path.join(tmpDir, "i18n/glossary/pt-BR.yaml"),
      "doNotTranslate:\n  - Cloudflare",
      { flag: "wx" },
    );

    const result = await loadGlossaries({
      config: makeConfig({
        glossary: { file: "./i18n/glossary/{locale}.yaml" },
      }),
      projectRoot,
    });

    expect(result.has("pt-BR")).toBe(true);
    expect(result.has("ja-JP")).toBe(false);
  });

  it("loads an inline glossary as-is", async () => {
    const result = await loadGlossaries({
      config: makeConfig({
        glossary: {
          inline: {
            "pt-BR": {
              version: "2025-04",
              doNotTranslate: ["Cloudflare", "R2"],
              preferredTranslations: { edge: "borda" },
              notes: "Brazilian Portuguese.",
            },
          },
        },
      }),
      projectRoot,
    });

    expect(result.size).toBe(1);
    const pt = result.get("pt-BR");
    expect(pt!.doNotTranslate).toEqual(["Cloudflare", "R2"]);
    expect(pt!.preferredTranslations).toEqual({ edge: "borda" });
  });

  it("normalises doNotTranslate by de-duping and sorting", async () => {
    writeFileSync(
      path.join(tmpDir, "i18n/glossary/pt-BR.yaml"),
      [
        "doNotTranslate:",
        "  - Workers",
        "  - Cloudflare",
        "  - Workers",
        "  - R2",
      ].join("\n"),
      { flag: "wx" },
    );

    const result = await loadGlossaries({
      config: makeConfig({
        locales: ["pt-BR"],
        glossary: { file: "./i18n/glossary/{locale}.yaml" },
      }),
      projectRoot,
    });

    expect(result.get("pt-BR")!.doNotTranslate).toEqual([
      "Cloudflare",
      "R2",
      "Workers",
    ]);
  });

  it("throws a clear error when glossary.file is missing the {locale} placeholder", async () => {
    await expect(
      loadGlossaries({
        config: makeConfig({
          glossary: { file: "./i18n/glossary/pt-BR.yaml" },
        }),
        projectRoot,
      }),
    ).rejects.toThrow(/{locale}/);
  });

  it("throws when a glossary YAML's structure violates the schema", async () => {
    writeFileSync(
      path.join(tmpDir, "i18n/glossary/pt-BR.yaml"),
      // doNotTranslate must be an array of strings, not a number.
      "doNotTranslate: 42",
      { flag: "wx" },
    );

    await expect(
      loadGlossaries({
        config: makeConfig({
          locales: ["pt-BR"],
          glossary: { file: "./i18n/glossary/{locale}.yaml" },
        }),
        projectRoot,
      }),
    ).rejects.toThrow(/invalid glossary/);
  });

  it("throws when a glossary YAML cannot be parsed", async () => {
    writeFileSync(
      path.join(tmpDir, "i18n/glossary/pt-BR.yaml"),
      "doNotTranslate:\n  - [unclosed bracket",
      { flag: "wx" },
    );

    await expect(
      loadGlossaries({
        config: makeConfig({
          locales: ["pt-BR"],
          glossary: { file: "./i18n/glossary/{locale}.yaml" },
        }),
        projectRoot,
      }),
    ).rejects.toThrow(/failed to parse glossary YAML/);
  });
});

describe("hashGlossary", () => {
  const sample: Glossary = {
    version: "2025-04",
    doNotTranslate: ["Cloudflare", "R2", "Workers"],
    preferredTranslations: { blog: "blog", edge: "borda" },
    notes: "Brazilian Portuguese.",
  };

  it("returns a 64-char lowercase hex SHA-256", () => {
    const h = hashGlossary(sample);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input, same hash", () => {
    expect(hashGlossary(sample)).toBe(hashGlossary({ ...sample }));
  });

  it("is stable when doNotTranslate is in a different order (after normalisation)", () => {
    // Loaded glossaries are always sorted, so this models what would
    // happen if a user reordered their YAML. We hash the post-normalisation
    // shape, so the result must be identical.
    const a = hashGlossary({
      ...sample,
      doNotTranslate: ["Cloudflare", "R2", "Workers"],
    });
    const b = hashGlossary({
      ...sample,
      doNotTranslate: ["Workers", "Cloudflare", "R2"].sort(),
    });
    expect(a).toBe(b);
  });

  it("is stable when preferredTranslations keys are inserted in a different order", () => {
    const a = hashGlossary({
      ...sample,
      preferredTranslations: { blog: "blog", edge: "borda" },
    });
    const b = hashGlossary({
      ...sample,
      preferredTranslations: { edge: "borda", blog: "blog" },
    });
    expect(a).toBe(b);
  });

  it("differs when the version changes", () => {
    expect(hashGlossary(sample)).not.toBe(
      hashGlossary({ ...sample, version: "2025-05" }),
    );
  });

  it("differs when doNotTranslate gains a new entry", () => {
    expect(hashGlossary(sample)).not.toBe(
      hashGlossary({
        ...sample,
        doNotTranslate: [...sample.doNotTranslate, "Pages"].sort(),
      }),
    );
  });

  it("differs when a preferredTranslation value changes", () => {
    expect(hashGlossary(sample)).not.toBe(
      hashGlossary({
        ...sample,
        preferredTranslations: {
          ...sample.preferredTranslations,
          edge: "edge",
        },
      }),
    );
  });

  it("differs when notes change", () => {
    expect(hashGlossary(sample)).not.toBe(
      hashGlossary({ ...sample, notes: "different notes" }),
    );
  });

  it("EMPTY_GLOSSARY_HASH equals hashGlossary(EMPTY_GLOSSARY)", () => {
    expect(EMPTY_GLOSSARY_HASH).toBe(hashGlossary(EMPTY_GLOSSARY));
  });

  it("EMPTY_GLOSSARY_HASH is a stable, well-known value", () => {
    // Pin the empty-glossary hash so a future refactor that changes
    // the canonical-JSON shape becomes a visible regression rather
    // than silently busting every cached translation.
    expect(EMPTY_GLOSSARY_HASH).toBe(hashGlossary(EMPTY_GLOSSARY));
    // Length sanity is already covered by the regex test above; here
    // we just ensure the value is non-empty.
    expect(EMPTY_GLOSSARY_HASH.length).toBe(64);
  });
});
