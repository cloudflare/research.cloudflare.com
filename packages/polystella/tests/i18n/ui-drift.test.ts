import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { checkI18nDrift, formatDriftIssues, loadAndCheckDrift } from "../../src/i18n/drift.js";

/**
 * Tests for the drift-detection helpers — both the pure
 * `checkI18nDrift` over loaded dicts and the disk-loading
 * `loadAndCheckDrift` wrapper.
 *
 * The pure layer carries the contract; the disk layer is tested
 * with tmp directories so the loader/parser/error path are
 * exercised end-to-end without an Astro project.
 */

describe("checkI18nDrift — pure", () => {
  it("returns ok when every locale has the same key set", () => {
    const result = checkI18nDrift({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR", "ja-JP"],
      dictionaries: {
        "en-US": { "nav.home": "Home", "nav.about": "About" },
        "pt-BR": { "nav.home": "Início", "nav.about": "Sobre" },
        "ja-JP": { "nav.home": "ホーム", "nav.about": "概要" },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags missing keys per locale", () => {
    const result = checkI18nDrift({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      dictionaries: {
        "en-US": { "nav.home": "Home", "nav.about": "About" },
        "pt-BR": { "nav.home": "Início" }, // missing "nav.about"
      },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      locale: "pt-BR",
      missing: ["nav.about"],
      extra: [],
      missingFile: false,
    });
  });

  it("flags extra keys per locale", () => {
    const result = checkI18nDrift({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      dictionaries: {
        "en-US": { "nav.home": "Home" },
        "pt-BR": { "nav.home": "Início", "stale.key": "obsoleto" },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.extra).toEqual(["stale.key"]);
  });

  it("flags missing AND extra keys in the same locale", () => {
    const result = checkI18nDrift({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      dictionaries: {
        "en-US": { "nav.home": "Home", "nav.about": "About" },
        "pt-BR": { "nav.home": "Início", "stale.key": "obsoleto" },
      },
    });
    expect(result.issues[0]).toMatchObject({
      locale: "pt-BR",
      missing: ["nav.about"],
      extra: ["stale.key"],
    });
  });

  it("flags a fully-missing locale file with missingFile=true", () => {
    const result = checkI18nDrift({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR", "ja-JP"],
      dictionaries: {
        "en-US": { "nav.home": "Home", "nav.about": "About" },
        "pt-BR": { "nav.home": "Início", "nav.about": "Sobre" },
        // ja-JP missing entirely.
      },
    });
    expect(result.ok).toBe(false);
    const jaIssue = result.issues.find((i) => i.locale === "ja-JP");
    expect(jaIssue).toMatchObject({
      missingFile: true,
      missing: ["nav.about", "nav.home"],
      extra: [],
    });
  });

  it("returns ok silently when the default-locale dict is missing", () => {
    // Operator hasn't authored UI strings yet; we don't want to
    // force them to stub out an empty file before they start.
    const result = checkI18nDrift({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      dictionaries: {},
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("treats an empty default-locale dict as the canonical key set (== empty)", () => {
    // Once the operator HAS started authoring (the file exists, even
    // empty), other locales must also be empty to pass.
    const result = checkI18nDrift({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      dictionaries: {
        "en-US": {},
        "pt-BR": { "stale.key": "x" },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.extra).toEqual(["stale.key"]);
  });

  it("skips the default locale in its loop (default vs. default = trivially in sync)", () => {
    const result = checkI18nDrift({
      defaultLocale: "en-US",
      locales: ["en-US"],
      dictionaries: { "en-US": { "nav.home": "Home" } },
    });
    expect(result.ok).toBe(true);
  });

  it("sorts missing/extra lists for stable error messages", () => {
    const result = checkI18nDrift({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      dictionaries: {
        "en-US": { z: "z", a: "a", m: "m" },
        "pt-BR": {},
      },
    });
    expect(result.issues[0]?.missing).toEqual(["a", "m", "z"]);
  });

  it("flags empty-placeholder keys (synced but untranslated)", () => {
    // The canonical "sync ran but translate didn't" state — every
    // key exists in every locale, but some non-default values are
    // empty strings. Shipping this means visitors see blank labels.
    const result = checkI18nDrift({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      dictionaries: {
        "en-US": { "nav.home": "Home", "nav.about": "About" },
        "pt-BR": { "nav.home": "Início", "nav.about": "" }, // untranslated
      },
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({
      locale: "pt-BR",
      missing: [],
      extra: [],
      emptyPlaceholders: ["nav.about"],
      missingFile: false,
    });
  });

  it("does NOT flag empty values when source is ALSO empty (intentional blank)", () => {
    // If the operator wrote `""` as the source value, they meant it
    // — propagating that blank to every locale is correct.
    const result = checkI18nDrift({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      dictionaries: {
        "en-US": { "deliberately.blank": "", "nav.home": "Home" },
        "pt-BR": { "deliberately.blank": "", "nav.home": "Início" },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("composes empty-placeholder detection with missing/extra in the same locale", () => {
    const result = checkI18nDrift({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      dictionaries: {
        "en-US": { a: "A", b: "B", c: "C" },
        "pt-BR": { a: "", b: "BLocale", stale: "x" }, // empty a, missing c, extra stale
      },
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({
      locale: "pt-BR",
      missing: ["c"],
      extra: ["stale"],
      emptyPlaceholders: ["a"],
    });
  });

  it("sorts emptyPlaceholders alphabetically for stable error messages", () => {
    const result = checkI18nDrift({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      dictionaries: {
        "en-US": { z: "Z", a: "A", m: "M" },
        "pt-BR": { z: "", a: "", m: "" },
      },
    });
    expect(result.issues[0]?.emptyPlaceholders).toEqual(["a", "m", "z"]);
  });

  it("treats a key missing entirely from a locale as `missing`, NOT as `emptyPlaceholder`", () => {
    // Disambiguation: a missing key is fixed by sync (which adds an
    // empty placeholder); an empty placeholder is fixed by
    // translate. Conflating them would either double-count or hide
    // the right remediation.
    const result = checkI18nDrift({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      dictionaries: {
        "en-US": { "nav.about": "About" },
        "pt-BR": {}, // key entirely absent
      },
    });
    expect(result.issues[0]).toMatchObject({
      missing: ["nav.about"],
      emptyPlaceholders: [], // not double-counted
    });
  });
});

describe("formatDriftIssues", () => {
  it("returns the empty string when there are no issues", () => {
    expect(formatDriftIssues([])).toBe("");
  });

  it("formats missing-keys lines per locale", () => {
    const out = formatDriftIssues([{ locale: "pt-BR", missing: ["a", "b"], extra: [], emptyPlaceholders: [], missingFile: false }]);
    expect(out).toContain("Missing keys in pt-BR.json: a, b");
  });

  it("formats extra-keys lines per locale", () => {
    const out = formatDriftIssues([{ locale: "pt-BR", missing: [], extra: ["stale"], emptyPlaceholders: [], missingFile: false }]);
    expect(out).toContain("Extra keys in pt-BR.json");
    expect(out).toContain("stale");
  });

  it("formats empty-placeholder lines per locale", () => {
    const out = formatDriftIssues([
      { locale: "pt-BR", missing: [], extra: [], emptyPlaceholders: ["nav.home", "footer.copyright"], missingFile: false },
    ]);
    expect(out).toContain("Empty placeholders in pt-BR.json");
    expect(out).toContain("nav.home");
    expect(out).toContain("footer.copyright");
  });

  it("emits a starter block for missingFile locales", () => {
    const out = formatDriftIssues([
      {
        locale: "ja-JP",
        missing: ["nav.home"],
        extra: [],
        emptyPlaceholders: [],
        missingFile: true,
      },
    ]);
    expect(out).toContain("ja-JP: file is missing");
    // The starter block lists each key as a JSON-formatted entry the
    // operator can paste into the new file.
    expect(out).toContain('"nav.home": ""');
  });

  it("aggregates issues across multiple locales", () => {
    const out = formatDriftIssues([
      { locale: "pt-BR", missing: ["a"], extra: [], emptyPlaceholders: [], missingFile: false },
      { locale: "ja-JP", missing: ["b"], extra: [], emptyPlaceholders: [], missingFile: false },
    ]);
    expect(out).toContain("pt-BR.json");
    expect(out).toContain("ja-JP.json");
  });
});

describe("loadAndCheckDrift — disk", () => {
  async function makeFixture(files: Record<string, string>): Promise<{ rootDir: string; baseDir: string }> {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "polystella-drift-"));
    const baseDir = "src/content/i18n";
    const absBase = path.join(rootDir, baseDir);
    await mkdir(absBase, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(absBase, name), content, "utf8");
    }
    return { rootDir, baseDir: `./${baseDir}` };
  }

  it("returns ok when every JSON file exists with matching keys", async () => {
    const { rootDir, baseDir } = await makeFixture({
      "en-US.json": JSON.stringify({ "nav.home": "Home" }),
      "pt-BR.json": JSON.stringify({ "nav.home": "Início" }),
    });
    const result = await loadAndCheckDrift({
      rootDir,
      baseDir,
      locales: ["en-US", "pt-BR"],
      defaultLocale: "en-US",
    });
    expect(result.ok).toBe(true);
  });

  it("flags missingFile when a locale's JSON is absent", async () => {
    const { rootDir, baseDir } = await makeFixture({
      "en-US.json": JSON.stringify({ "nav.home": "Home" }),
      // pt-BR.json deliberately not created
    });
    const result = await loadAndCheckDrift({
      rootDir,
      baseDir,
      locales: ["en-US", "pt-BR"],
      defaultLocale: "en-US",
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({
      locale: "pt-BR",
      missingFile: true,
    });
  });

  it("returns ok silently when the default-locale JSON itself is missing", async () => {
    const { rootDir, baseDir } = await makeFixture({}); // empty
    const result = await loadAndCheckDrift({
      rootDir,
      baseDir,
      locales: ["en-US", "pt-BR"],
      defaultLocale: "en-US",
    });
    expect(result.ok).toBe(true);
  });

  it("throws on malformed JSON (the file exists but parse fails)", async () => {
    const { rootDir, baseDir } = await makeFixture({
      "en-US.json": "{ this is not valid JSON }",
    });
    await expect(
      loadAndCheckDrift({
        rootDir,
        baseDir,
        locales: ["en-US"],
        defaultLocale: "en-US",
      }),
    ).rejects.toThrow(/failed to parse UI-strings JSON/);
  });

  it("throws when a JSON file is an array instead of an object", async () => {
    const { rootDir, baseDir } = await makeFixture({
      "en-US.json": JSON.stringify(["not", "an", "object"]),
    });
    await expect(
      loadAndCheckDrift({
        rootDir,
        baseDir,
        locales: ["en-US"],
        defaultLocale: "en-US",
      }),
    ).rejects.toThrow(/must be a JSON object/);
  });
});
