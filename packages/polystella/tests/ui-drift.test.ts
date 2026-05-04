import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  checkI18nDrift,
  formatDriftIssues,
  loadAndCheckDrift,
} from "../src/ui/drift.js";

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
      defaultLocale: "en",
      locales: ["en", "pt-BR", "ja-JP"],
      dictionaries: {
        en: { "nav.home": "Home", "nav.about": "About" },
        "pt-BR": { "nav.home": "Início", "nav.about": "Sobre" },
        "ja-JP": { "nav.home": "ホーム", "nav.about": "概要" },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags missing keys per locale", () => {
    const result = checkI18nDrift({
      defaultLocale: "en",
      locales: ["en", "pt-BR"],
      dictionaries: {
        en: { "nav.home": "Home", "nav.about": "About" },
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
      defaultLocale: "en",
      locales: ["en", "pt-BR"],
      dictionaries: {
        en: { "nav.home": "Home" },
        "pt-BR": { "nav.home": "Início", "stale.key": "obsoleto" },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.extra).toEqual(["stale.key"]);
  });

  it("flags missing AND extra keys in the same locale", () => {
    const result = checkI18nDrift({
      defaultLocale: "en",
      locales: ["en", "pt-BR"],
      dictionaries: {
        en: { "nav.home": "Home", "nav.about": "About" },
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
      defaultLocale: "en",
      locales: ["en", "pt-BR", "ja-JP"],
      dictionaries: {
        en: { "nav.home": "Home", "nav.about": "About" },
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
      defaultLocale: "en",
      locales: ["en", "pt-BR"],
      dictionaries: {},
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("treats an empty default-locale dict as the canonical key set (== empty)", () => {
    // Once the operator HAS started authoring (the file exists, even
    // empty), other locales must also be empty to pass.
    const result = checkI18nDrift({
      defaultLocale: "en",
      locales: ["en", "pt-BR"],
      dictionaries: {
        en: {},
        "pt-BR": { "stale.key": "x" },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.extra).toEqual(["stale.key"]);
  });

  it("skips the default locale in its loop (default vs. default = trivially in sync)", () => {
    const result = checkI18nDrift({
      defaultLocale: "en",
      locales: ["en"],
      dictionaries: { en: { "nav.home": "Home" } },
    });
    expect(result.ok).toBe(true);
  });

  it("sorts missing/extra lists for stable error messages", () => {
    const result = checkI18nDrift({
      defaultLocale: "en",
      locales: ["en", "pt-BR"],
      dictionaries: {
        en: { z: "z", a: "a", m: "m" },
        "pt-BR": {},
      },
    });
    expect(result.issues[0]?.missing).toEqual(["a", "m", "z"]);
  });
});

describe("formatDriftIssues", () => {
  it("returns the empty string when there are no issues", () => {
    expect(formatDriftIssues([])).toBe("");
  });

  it("formats missing-keys lines per locale", () => {
    const out = formatDriftIssues([
      { locale: "pt-BR", missing: ["a", "b"], extra: [], missingFile: false },
    ]);
    expect(out).toContain("Missing keys in pt-BR.json: a, b");
  });

  it("formats extra-keys lines per locale", () => {
    const out = formatDriftIssues([
      { locale: "pt-BR", missing: [], extra: ["stale"], missingFile: false },
    ]);
    expect(out).toContain("Extra keys in pt-BR.json");
    expect(out).toContain("stale");
  });

  it("emits a starter block for missingFile locales", () => {
    const out = formatDriftIssues([
      {
        locale: "ja-JP",
        missing: ["nav.home"],
        extra: [],
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
      { locale: "pt-BR", missing: ["a"], extra: [], missingFile: false },
      { locale: "ja-JP", missing: ["b"], extra: [], missingFile: false },
    ]);
    expect(out).toContain("pt-BR.json");
    expect(out).toContain("ja-JP.json");
  });
});

describe("loadAndCheckDrift — disk", () => {
  async function makeFixture(
    files: Record<string, string>,
  ): Promise<{ rootDir: string; baseDir: string }> {
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
      "en.json": JSON.stringify({ "nav.home": "Home" }),
      "pt-BR.json": JSON.stringify({ "nav.home": "Início" }),
    });
    const result = await loadAndCheckDrift({
      rootDir,
      baseDir,
      locales: ["en", "pt-BR"],
      defaultLocale: "en",
    });
    expect(result.ok).toBe(true);
  });

  it("flags missingFile when a locale's JSON is absent", async () => {
    const { rootDir, baseDir } = await makeFixture({
      "en.json": JSON.stringify({ "nav.home": "Home" }),
      // pt-BR.json deliberately not created
    });
    const result = await loadAndCheckDrift({
      rootDir,
      baseDir,
      locales: ["en", "pt-BR"],
      defaultLocale: "en",
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
      locales: ["en", "pt-BR"],
      defaultLocale: "en",
    });
    expect(result.ok).toBe(true);
  });

  it("throws on malformed JSON (the file exists but parse fails)", async () => {
    const { rootDir, baseDir } = await makeFixture({
      "en.json": "{ this is not valid JSON }",
    });
    await expect(
      loadAndCheckDrift({
        rootDir,
        baseDir,
        locales: ["en"],
        defaultLocale: "en",
      }),
    ).rejects.toThrow(/failed to parse UI-strings JSON/);
  });

  it("throws when a JSON file is an array instead of an object", async () => {
    const { rootDir, baseDir } = await makeFixture({
      "en.json": JSON.stringify(["not", "an", "object"]),
    });
    await expect(
      loadAndCheckDrift({
        rootDir,
        baseDir,
        locales: ["en"],
        defaultLocale: "en",
      }),
    ).rejects.toThrow(/must be a JSON object/);
  });
});
