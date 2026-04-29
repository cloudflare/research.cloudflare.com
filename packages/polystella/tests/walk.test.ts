import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { walkSources } from "../src/source/walk.js";

let fixtureDir: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(path.join(tmpdir(), "polystella-walk-"));
  // Layout:
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
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("walkSources", () => {
  it("returns matching .md and .mdx files with stable, sorted order", async () => {
    const sources = await walkSources({
      sourceDir: fixtureDir,
      include: ["**/*.md", "**/*.mdx"],
      exclude: [],
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
      sourceDir: fixtureDir,
      include: ["**/*.md"],
      exclude: ["_drafts/**"],
    });

    const rels = sources.map((s) => s.relativePath);
    expect(rels).toContain("publications/foo.md");
    expect(rels).not.toContain("_drafts/skipme.md");
  });

  it("returns relative paths with forward slashes regardless of platform", async () => {
    const sources = await walkSources({
      sourceDir: fixtureDir,
      include: ["**/*.md"],
      exclude: [],
    });

    for (const s of sources) {
      expect(s.relativePath).not.toContain("\\");
      expect(path.isAbsolute(s.absolutePath)).toBe(true);
    }
  });

  it("returns an empty array (not throw) when sourceDir does not exist", async () => {
    const result = await walkSources({
      sourceDir: path.join(fixtureDir, "does-not-exist"),
      include: ["**/*.md"],
      exclude: [],
    });
    expect(result).toEqual([]);
  });
});
