import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { walkSources } from "../src/source/walk.js";

let fixtureDir: string;
let secondaryDir: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(path.join(tmpdir(), "polystella-walk-"));
  // Layout (primary):
  //   publications/foo.md
  //   publications/bar.md
  //   publications/.draft.md       (dotfile — included only with dot:true; we expect it skipped)
  //   people/alice.md
  //   people/bob.mdx
  //   site.toml                    (non-markdown)
  //   _drafts/skipme.md            (excluded via pattern)
  await mkdir(path.join(fixtureDir, "publications"), { recursive: true });
  await mkdir(path.join(fixtureDir, "people"), { recursive: true });
  await mkdir(path.join(fixtureDir, "_drafts"), { recursive: true });

  await writeFile(path.join(fixtureDir, "publications/foo.md"), "# Foo");
  await writeFile(path.join(fixtureDir, "publications/bar.md"), "# Bar");
  await writeFile(path.join(fixtureDir, "publications/.draft.md"), "# Draft");
  await writeFile(path.join(fixtureDir, "people/alice.md"), "# Alice");
  await writeFile(path.join(fixtureDir, "people/bob.mdx"), "# Bob");
  await writeFile(path.join(fixtureDir, "site.toml"), "[meta]\nx=1\n");
  await writeFile(path.join(fixtureDir, "_drafts/skipme.md"), "# Skip");

  // Layout (secondary — simulates a snapshot dir from
  // polystellaLoader):
  //   abc123.json
  //   def456.json
  secondaryDir = await mkdtemp(path.join(tmpdir(), "polystella-walk-snap-"));
  await writeFile(path.join(secondaryDir, "abc123.json"), '{}\n');
  await writeFile(path.join(secondaryDir, "def456.json"), '{}\n');
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
  await rm(secondaryDir, { recursive: true, force: true });
});

describe("walkSources — single root", () => {
  it("returns matching .md and .mdx files with stable, sorted order", async () => {
    const sources = await walkSources({
      roots: [{ baseDir: fixtureDir, include: ["**/*.md", "**/*.mdx"], exclude: [] }],
    });

    const rels = sources.map((s) => s.relativePath);
    expect(rels).toContain("publications/foo.md");
    expect(rels).toContain("publications/bar.md");
    expect(rels).toContain("people/alice.md");
    expect(rels).toContain("people/bob.mdx");
    // dotfiles are excluded by `dot: false`
    expect(rels).not.toContain("publications/.draft.md");
    // non-markdown is excluded
    expect(rels).not.toContain("site.toml");

    // Sorted determinism check
    const sorted = [...rels].sort();
    expect(rels).toEqual(sorted);
  });

  it("respects exclude patterns", async () => {
    const sources = await walkSources({
      roots: [{ baseDir: fixtureDir, include: ["**/*.md"], exclude: ["_drafts/**"] }],
    });

    const rels = sources.map((s) => s.relativePath);
    expect(rels).toContain("publications/foo.md");
    expect(rels).not.toContain("_drafts/skipme.md");
  });

  it("returns relative paths with forward slashes regardless of platform", async () => {
    const sources = await walkSources({
      roots: [{ baseDir: fixtureDir, include: ["**/*.md"], exclude: [] }],
    });

    for (const s of sources) {
      expect(s.relativePath).not.toContain("\\");
      expect(path.isAbsolute(s.absolutePath)).toBe(true);
    }
  });

  it("returns an empty array (not throw) when sourceDir does not exist", async () => {
    const result = await walkSources({
      roots: [{ baseDir: path.join(fixtureDir, "does-not-exist"), include: ["**/*.md"], exclude: [] }],
    });
    expect(result).toEqual([]);
  });
});

describe("walkSources — multi-root", () => {
  it("concatenates files from multiple roots", async () => {
    const sources = await walkSources({
      roots: [
        { baseDir: fixtureDir, include: ["publications/*.md"], exclude: [] },
        { baseDir: secondaryDir, include: ["*.json"], exclude: [] },
      ],
    });

    const rels = sources.map((s) => s.relativePath);
    expect(rels).toContain("publications/foo.md");
    expect(rels).toContain("publications/bar.md");
    expect(rels).toContain("abc123.json");
    expect(rels).toContain("def456.json");
  });

  it("applies pathPrefix to a root's relative paths", async () => {
    // Snapshot dir simulation: prefix the loader name onto every
    // captured file so the translation pipeline sees stable paths
    // like `blog/<id>.json`.
    const sources = await walkSources({
      roots: [
        { baseDir: secondaryDir, include: ["*.json"], exclude: [], pathPrefix: "blog" },
      ],
    });

    const rels = sources.map((s) => s.relativePath);
    expect(rels).toEqual(["blog/abc123.json", "blog/def456.json"]);
  });

  it("sorts the merged result across roots", async () => {
    const sources = await walkSources({
      roots: [
        // Order in the input is reversed vs. expected output to
        // prove sorting is global (not per-root).
        { baseDir: secondaryDir, include: ["*.json"], exclude: [], pathPrefix: "blog" },
        { baseDir: fixtureDir, include: ["people/*.{md,mdx}"], exclude: [] },
      ],
    });

    const rels = sources.map((s) => s.relativePath);
    expect(rels).toEqual([
      "blog/abc123.json",
      "blog/def456.json",
      "people/alice.md",
      "people/bob.mdx",
    ]);
  });

  it("first root wins on relative-path collision", async () => {
    // Construct two roots whose relativePaths could collide.
    // The first one's entries should appear; the second's should
    // be silently dropped.
    const sources = await walkSources({
      roots: [
        // First root: secondaryDir with no prefix, so files are
        // `abc123.json` / `def456.json`.
        { baseDir: secondaryDir, include: ["*.json"], exclude: [] },
        // Second root: same files, would have produced the same
        // relativePath. Should not appear in the output.
        { baseDir: secondaryDir, include: ["*.json"], exclude: [] },
      ],
    });

    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.relativePath).sort()).toEqual(["abc123.json", "def456.json"]);
  });

  it("missing root does not abort the rest of the walk", async () => {
    const sources = await walkSources({
      roots: [
        { baseDir: path.join(fixtureDir, "no-such-dir"), include: ["**/*"], exclude: [] },
        { baseDir: secondaryDir, include: ["*.json"], exclude: [] },
      ],
    });

    expect(sources.map((s) => s.relativePath).sort()).toEqual(["abc123.json", "def456.json"]);
  });

  it("empty roots list returns an empty array", async () => {
    const sources = await walkSources({ roots: [] });
    expect(sources).toEqual([]);
  });
});
