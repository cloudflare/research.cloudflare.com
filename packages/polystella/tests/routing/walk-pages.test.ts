import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { walkPages } from "../../src/routing/walk-pages.js";

/**
 * Filesystem walker tests. Use real temp directories rather than a
 * mocked `readdir` because the function's contract is "find these
 * files on disk" and the failure modes are filesystem-shaped (missing
 * directory, ignored directory, mixed file types). Mocking would
 * obscure them.
 */

let tempRoots: string[] = [];

async function makeFixture(files: string[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "polystella-walk-"));
  tempRoots.push(root);
  for (const rel of files) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, "// fixture", "utf8");
  }
  return root;
}

beforeEach(() => {
  tempRoots = [];
});

afterEach(async () => {
  for (const root of tempRoots) {
    await import("node:fs/promises").then((fs) => fs.rm(root, { recursive: true, force: true }));
  }
});

describe("walkPages", () => {
  it("returns every .astro file under the root with forward-slash paths", async () => {
    const root = await makeFixture([
      "src/pages/index.astro",
      "src/pages/[slug].astro",
      "src/pages/people/index.astro",
      "src/pages/people/[slug].astro",
    ]);
    const result = await walkPages(root);
    expect(result.sort()).toEqual([
      "src/pages/[slug].astro",
      "src/pages/index.astro",
      "src/pages/people/[slug].astro",
      "src/pages/people/index.astro",
    ]);
  });

  it("ignores non-.astro files", async () => {
    const root = await makeFixture(["src/pages/index.astro", "src/pages/about.md", "src/pages/script.ts", "src/styles/global.css"]);
    const result = await walkPages(root);
    expect(result).toEqual(["src/pages/index.astro"]);
  });

  it("ignores `node_modules`, `.git`, `.astro`, `.cache`, `dist`, `coverage`", async () => {
    const root = await makeFixture([
      "src/pages/index.astro",
      "node_modules/some-pkg/foo.astro",
      ".git/hooks/foo.astro",
      ".astro/cache/foo.astro",
      ".cache/foo.astro",
      "dist/foo.astro",
      "coverage/foo.astro",
    ]);
    const result = await walkPages(root);
    expect(result).toEqual(["src/pages/index.astro"]);
  });

  it("returns an empty array when the root doesn't exist", async () => {
    const result = await walkPages("/this/does/not/exist/anywhere");
    expect(result).toEqual([]);
  });

  it("handles deeply nested .astro files", async () => {
    const root = await makeFixture(["src/pages/a/b/c/deep.astro", "src/pages/a/b/sibling.astro"]);
    const result = await walkPages(root);
    expect(result.sort()).toEqual(["src/pages/a/b/c/deep.astro", "src/pages/a/b/sibling.astro"]);
  });

  it("returns nothing when the project has no .astro files", async () => {
    const root = await makeFixture(["README.md", "package.json"]);
    const result = await walkPages(root);
    expect(result).toEqual([]);
  });
});
