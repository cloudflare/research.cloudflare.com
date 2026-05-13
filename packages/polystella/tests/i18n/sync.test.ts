import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { applySyncToDisk, formatLocaleFile, formatSyncSummary, parseSourceLayout, syncLocaleDict } from "../../src/i18n/sync.js";

/**
 * Tests for the UI-strings sync layer:
 *   - layout parser (key order + section-break recovery)
 *   - pure dict reconciliation (preserve existing, add empty, drop extras)
 *   - JSON writer (2-space indent + blank-line layout + trailing newline)
 *   - disk-bound wrapper (file creation, idempotency, no-op detection)
 *
 * Layout preservation is the diff-friendliness contract — without it
 * every sync run reorders keys and the resulting churn drowns
 * meaningful changes.
 */

describe("parseSourceLayout", () => {
  it("extracts top-level keys in source order", () => {
    const raw = `{
  "a": "1",
  "b": "2",
  "c": "3"
}
`;
    const layout = parseSourceLayout(raw);
    expect(layout.keys).toEqual(["a", "b", "c"]);
    expect(layout.blankBefore.size).toBe(0);
  });

  it("flags keys with a blank line immediately before them as section starts", () => {
    const raw = `{
  "first": "1",

  "second": "2",
  "third": "3",

  "fourth": "4"
}
`;
    const layout = parseSourceLayout(raw);
    expect(layout.keys).toEqual(["first", "second", "third", "fourth"]);
    // First key is never in blankBefore.
    expect(layout.blankBefore.has("first")).toBe(false);
    expect(layout.blankBefore.has("second")).toBe(true);
    expect(layout.blankBefore.has("third")).toBe(false);
    expect(layout.blankBefore.has("fourth")).toBe(true);
  });

  it("tolerates trailing whitespace on blank lines", () => {
    const raw = "{\n" + '  "a": "1",\n' + "  \t  \n" + '  "b": "2"\n' + "}\n";
    const layout = parseSourceLayout(raw);
    expect(layout.blankBefore.has("b")).toBe(true);
  });

  it("decodes escaped characters in keys", () => {
    const raw = `{
  "key\\"with\\"quotes": "v"
}
`;
    const layout = parseSourceLayout(raw);
    expect(layout.keys).toEqual([`key"with"quotes`]);
  });

  it("handles CRLF line endings", () => {
    const raw = '{\r\n  "a": "1",\r\n\r\n  "b": "2"\r\n}\r\n';
    const layout = parseSourceLayout(raw);
    expect(layout.keys).toEqual(["a", "b"]);
    expect(layout.blankBefore.has("b")).toBe(true);
  });

  it("returns empty layout for `{}`", () => {
    const layout = parseSourceLayout(`{}\n`);
    expect(layout.keys).toEqual([]);
    expect(layout.blankBefore.size).toBe(0);
  });
});

describe("syncLocaleDict", () => {
  it("adds missing keys with empty-string placeholders", () => {
    const result = syncLocaleDict({
      source: { a: "A", b: "B", c: "C" },
      existing: { a: "ALocale" },
      sourceKeyOrder: ["a", "b", "c"],
    });
    expect(result.dict).toEqual({ a: "ALocale", b: "", c: "" });
    expect(result.added).toEqual(["b", "c"]);
    expect(result.removed).toEqual([]);
  });

  it("drops keys not present in the source", () => {
    const result = syncLocaleDict({
      source: { a: "A" },
      existing: { a: "ALocale", stale: "old", legacy: "older" },
      sourceKeyOrder: ["a"],
    });
    expect(result.dict).toEqual({ a: "ALocale" });
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual(["legacy", "stale"]);
  });

  it("preserves existing non-empty values", () => {
    const result = syncLocaleDict({
      source: { greeting: "Hello", farewell: "Goodbye" },
      existing: { greeting: "Olá", farewell: "Adeus" },
      sourceKeyOrder: ["greeting", "farewell"],
    });
    expect(result.dict).toEqual({ greeting: "Olá", farewell: "Adeus" });
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("preserves existing empty-string values (re-translation marker)", () => {
    // Authors may delete a value to flag it for re-translation.
    // Sync must NOT clobber that intent with a non-empty source.
    const result = syncLocaleDict({
      source: { a: "Updated source" },
      existing: { a: "" },
      sourceKeyOrder: ["a"],
    });
    expect(result.dict).toEqual({ a: "" });
  });

  it("emits keys in source order, ignoring existing order", () => {
    const result = syncLocaleDict({
      source: { a: "A", b: "B", c: "C" },
      existing: { c: "Cx", a: "Ax", b: "Bx" },
      sourceKeyOrder: ["a", "b", "c"],
    });
    expect(Object.keys(result.dict)).toEqual(["a", "b", "c"]);
  });

  it("falls back gracefully when source has a key not in the layout (defensive)", () => {
    // sourceKeyOrder is normally derived from the same file as
    // source, so this is a defensive contract.
    const result = syncLocaleDict({
      source: { a: "A", orphan: "O" },
      existing: {},
      sourceKeyOrder: ["a"], // missing "orphan"
    });
    expect(result.dict).toEqual({ a: "", orphan: "" });
    expect(result.added.sort()).toEqual(["a", "orphan"]);
  });

  it("returns deterministically-sorted added/removed lists", () => {
    const result = syncLocaleDict({
      source: { z: "Z", a: "A", m: "M" },
      existing: { gone2: "x", gone1: "y" },
      sourceKeyOrder: ["z", "a", "m"],
    });
    expect(result.added).toEqual(["a", "m", "z"]);
    expect(result.removed).toEqual(["gone1", "gone2"]);
  });

  it("handles empty source dict (every existing key is removed)", () => {
    const result = syncLocaleDict({
      source: {},
      existing: { a: "1", b: "2" },
      sourceKeyOrder: [],
    });
    expect(result.dict).toEqual({});
    expect(result.removed).toEqual(["a", "b"]);
  });
});

describe("formatLocaleFile", () => {
  it("emits 2-space-indented JSON with a trailing newline", () => {
    const text = formatLocaleFile({
      dict: { a: "1", b: "2" },
      layout: { keys: ["a", "b"], blankBefore: new Set() },
    });
    expect(text).toBe('{\n  "a": "1",\n  "b": "2"\n}\n');
  });

  it("inserts a blank line before each section-start key", () => {
    const text = formatLocaleFile({
      dict: { a: "1", b: "2", c: "3" },
      layout: { keys: ["a", "b", "c"], blankBefore: new Set(["b"]) },
    });
    expect(text).toBe('{\n  "a": "1",\n\n  "b": "2",\n  "c": "3"\n}\n');
  });

  it("renders `{}` for an empty dict", () => {
    const text = formatLocaleFile({
      dict: {},
      layout: { keys: [], blankBefore: new Set() },
    });
    expect(text).toBe("{}\n");
  });

  it("escapes special characters in keys and values", () => {
    const text = formatLocaleFile({
      dict: { 'k"': "v\nv" },
      layout: { keys: ['k"'], blankBefore: new Set() },
    });
    expect(text).toBe('{\n  "k\\"": "v\\nv"\n}\n');
  });

  it("emits no trailing comma on the last entry", () => {
    const text = formatLocaleFile({
      dict: { a: "1", b: "2", c: "3" },
      layout: { keys: ["a", "b", "c"], blankBefore: new Set() },
    });
    expect(text.endsWith('  "c": "3"\n}\n')).toBe(true);
  });

  it("ignores blankBefore for the first key", () => {
    // First key with blankBefore = no-op. Defends against an
    // upstream bug in `parseSourceLayout` ever adding the first key.
    const text = formatLocaleFile({
      dict: { a: "1" },
      layout: { keys: ["a"], blankBefore: new Set(["a"]) },
    });
    expect(text).toBe('{\n  "a": "1"\n}\n');
  });
});

describe("applySyncToDisk", () => {
  async function tmpProject(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "polystella-sync-"));
    await mkdir(path.join(dir, "src", "content", "i18n"), { recursive: true });
    return dir;
  }

  it("creates a missing locale file with empty placeholders", async () => {
    const root = await tmpProject();
    const baseDir = "./src/content/i18n";
    await writeFile(
      path.resolve(root, baseDir, "en-US.json"),
      `{
  "nav.home": "Home",
  "nav.about": "About"
}
`,
      "utf8",
    );

    const result = await applySyncToDisk({
      rootDir: root,
      baseDir,
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
    });

    expect(result.changed).toBe(true);
    const ptResult = result.results.find((r) => r.locale === "pt-BR");
    expect(ptResult).toMatchObject({
      added: ["nav.about", "nav.home"],
      removed: [],
      changed: true,
      created: true,
    });

    const ptContents = await readFile(path.resolve(root, baseDir, "pt-BR.json"), "utf8");
    expect(ptContents).toBe('{\n  "nav.home": "",\n  "nav.about": ""\n}\n');
  });

  it("adds missing keys and removes extras in a single pass", async () => {
    const root = await tmpProject();
    const baseDir = "./src/content/i18n";
    await writeFile(
      path.resolve(root, baseDir, "en-US.json"),
      `{
  "keep.me": "Keep",
  "new.one": "New"
}
`,
      "utf8",
    );
    await writeFile(
      path.resolve(root, baseDir, "pt-BR.json"),
      `{
  "keep.me": "Manter",
  "stale.one": "Obsoleto"
}
`,
      "utf8",
    );

    const result = await applySyncToDisk({
      rootDir: root,
      baseDir,
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
    });

    const ptResult = result.results.find((r) => r.locale === "pt-BR");
    expect(ptResult).toMatchObject({
      added: ["new.one"],
      removed: ["stale.one"],
      changed: true,
      created: false,
    });

    const ptContents = await readFile(path.resolve(root, baseDir, "pt-BR.json"), "utf8");
    expect(ptContents).toBe('{\n  "keep.me": "Manter",\n  "new.one": ""\n}\n');
  });

  it("is a no-op when locales are already in sync", async () => {
    const root = await tmpProject();
    const baseDir = "./src/content/i18n";
    const sourceText = `{
  "a": "A",
  "b": "B"
}
`;
    const ptText = `{
  "a": "ALocale",
  "b": "BLocale"
}
`;
    await writeFile(path.resolve(root, baseDir, "en-US.json"), sourceText, "utf8");
    await writeFile(path.resolve(root, baseDir, "pt-BR.json"), ptText, "utf8");

    const result = await applySyncToDisk({
      rootDir: root,
      baseDir,
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
    });

    expect(result.changed).toBe(false);
    const ptResult = result.results.find((r) => r.locale === "pt-BR");
    expect(ptResult?.changed).toBe(false);
    expect(ptResult?.added).toEqual([]);
    expect(ptResult?.removed).toEqual([]);

    // Bytes must be untouched (mtime stability isn't asserted but
    // exact-content equality is).
    const afterPt = await readFile(path.resolve(root, baseDir, "pt-BR.json"), "utf8");
    expect(afterPt).toBe(ptText);
  });

  it("preserves the source's section-break layout in the locale file", async () => {
    const root = await tmpProject();
    const baseDir = "./src/content/i18n";
    await writeFile(
      path.resolve(root, baseDir, "en-US.json"),
      `{
  "globals.a": "A",
  "globals.b": "B",

  "nav.home": "Home",
  "nav.about": "About"
}
`,
      "utf8",
    );

    await applySyncToDisk({
      rootDir: root,
      baseDir,
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
    });

    const ptContents = await readFile(path.resolve(root, baseDir, "pt-BR.json"), "utf8");
    expect(ptContents).toBe('{\n  "globals.a": "",\n  "globals.b": "",\n\n  "nav.home": "",\n  "nav.about": ""\n}\n');
  });

  it("rewrites the locale file when the existing layout differs (key order or section breaks)", async () => {
    const root = await tmpProject();
    const baseDir = "./src/content/i18n";
    await writeFile(
      path.resolve(root, baseDir, "en-US.json"),
      `{
  "a": "A",
  "b": "B"
}
`,
      "utf8",
    );
    // Locale has reverse key order (older edit).
    await writeFile(
      path.resolve(root, baseDir, "pt-BR.json"),
      `{
  "b": "BLocale",
  "a": "ALocale"
}
`,
      "utf8",
    );

    const result = await applySyncToDisk({
      rootDir: root,
      baseDir,
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
    });

    const ptResult = result.results.find((r) => r.locale === "pt-BR");
    expect(ptResult?.changed).toBe(true); // layout-only change still triggers rewrite
    expect(ptResult?.added).toEqual([]);
    expect(ptResult?.removed).toEqual([]);

    const ptContents = await readFile(path.resolve(root, baseDir, "pt-BR.json"), "utf8");
    // Reordered to match the source.
    expect(ptContents).toBe('{\n  "a": "ALocale",\n  "b": "BLocale"\n}\n');
  });

  it("never modifies the default-locale file", async () => {
    const root = await tmpProject();
    const baseDir = "./src/content/i18n";
    const sourceText = `{
  "a": "A"
}
`;
    await writeFile(path.resolve(root, baseDir, "en-US.json"), sourceText, "utf8");

    await applySyncToDisk({
      rootDir: root,
      baseDir,
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
    });

    const after = await readFile(path.resolve(root, baseDir, "en-US.json"), "utf8");
    expect(after).toBe(sourceText);
  });

  it("throws a clear error when the default-locale file is missing", async () => {
    const root = await tmpProject();
    await expect(
      applySyncToDisk({
        rootDir: root,
        baseDir: "./src/content/i18n",
        defaultLocale: "en-US",
        locales: ["en-US", "pt-BR"],
      }),
    ).rejects.toThrow(/default-locale UI-strings file not found/);
  });

  it("throws a clear error on malformed source JSON", async () => {
    const root = await tmpProject();
    const baseDir = "./src/content/i18n";
    await writeFile(path.resolve(root, baseDir, "en-US.json"), `{ not json`, "utf8");

    await expect(
      applySyncToDisk({
        rootDir: root,
        baseDir,
        defaultLocale: "en-US",
        locales: ["en-US"],
      }),
    ).rejects.toThrow(/failed to parse/);
  });
});

describe("formatSyncSummary", () => {
  it("returns empty string when nothing changed", () => {
    const summary = formatSyncSummary({
      changed: false,
      results: [
        { locale: "en-US", added: [], removed: [], changed: false, filePath: "x", created: false },
        { locale: "pt-BR", added: [], removed: [], changed: false, filePath: "y", created: false },
      ],
    });
    expect(summary).toBe("");
  });

  it("groups per-locale additions and removals", () => {
    const summary = formatSyncSummary({
      changed: true,
      results: [
        { locale: "en-US", added: [], removed: [], changed: false, filePath: "x", created: false },
        {
          locale: "pt-BR",
          added: ["nav.new"],
          removed: ["nav.old"],
          changed: true,
          filePath: "y",
          created: false,
        },
      ],
    });
    expect(summary).toContain("pt-BR (updated): +1 added, -1 removed");
    expect(summary).toContain("+ nav.new");
    expect(summary).toContain("- nav.old");
  });

  it("flags created files distinctly from updated ones", () => {
    const summary = formatSyncSummary({
      changed: true,
      results: [
        {
          locale: "ja-JP",
          added: ["a", "b"],
          removed: [],
          changed: true,
          filePath: "z",
          created: true,
        },
      ],
    });
    expect(summary).toContain("ja-JP (created):");
  });

  it("reports layout-only rewrites (key set unchanged, bytes differ)", () => {
    const summary = formatSyncSummary({
      changed: true,
      results: [
        {
          locale: "pt-BR",
          added: [],
          removed: [],
          changed: true, // layout-only change
          filePath: "x",
          created: false,
        },
      ],
    });
    expect(summary).toContain("pt-BR (updated): reformatted (layout only)");
  });
});
