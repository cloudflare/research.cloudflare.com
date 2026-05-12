import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOCAL_CACHE_INDEX_FILENAME,
  localCacheKey,
  readLocalCacheIndex,
  stagedFileExists,
  writeLocalCacheIndex,
  type LocalCacheEntry,
} from "../../src/storage/local-cache.js";

/**
 * Unit tests for the on-disk staging index.
 *
 * The integration tests in `run.test.ts` cover the end-to-end
 * "second-run skip" behaviour. These pin the file format
 * (round-trip, schema-version handling) and the failure modes
 * (corrupt JSON, missing file, unreadable entries) so a regression
 * in either path turns red here rather than at the orchestrator
 * level where the cause is harder to localise.
 */

let tempRoots: string[] = [];

async function makeStagingDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "polystella-local-cache-"));
  tempRoots.push(dir);
  return dir;
}

beforeEach(() => {
  tempRoots = [];
});

afterEach(async () => {
  for (const root of tempRoots) {
    try {
      await rm(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("localCacheKey", () => {
  it("encodes (locale, sourcePath) deterministically", () => {
    expect(localCacheKey("pt-BR", "publications/foo.md")).toBe("pt-BR::publications/foo.md");
  });

  it("matches `encodeTouchedPair`'s separator (so future helpers can convert)", () => {
    // Same `::` separator as `encodeTouchedPair` from prune.ts.
    // Locking it here means a future cross-helper conversion (e.g.
    // a single key-encoder utility) doesn't need to reconcile two
    // different formats.
    expect(localCacheKey("ja-JP", "weird::source.md")).toBe("ja-JP::weird::source.md");
  });
});

describe("readLocalCacheIndex / writeLocalCacheIndex — round-trip", () => {
  it("round-trips a populated index losslessly", async () => {
    const stagingDir = await makeStagingDir();
    const original = new Map<string, LocalCacheEntry>([
      ["pt-BR::publications/a.md", { hash: "abc123", stagedAt: "2026-04-29T12:00:00.000Z" }],
      ["ja-JP::publications/b.md", { hash: "def456", stagedAt: "2026-04-29T12:01:00.000Z" }],
    ]);
    await writeLocalCacheIndex(stagingDir, original);
    const loaded = await readLocalCacheIndex(stagingDir);
    expect(loaded).toEqual(original);
  });

  it("writes deterministic, sorted keys (diff-friendly across builds)", async () => {
    const stagingDir = await makeStagingDir();
    // Insert in a deliberately non-alphabetic order; the writer
    // must sort on output so the resulting JSON is stable across
    // runs with different insertion order.
    const entries = new Map<string, LocalCacheEntry>([
      ["pt-BR::z.md", { hash: "z", stagedAt: "2026-04-29T00:00:00.000Z" }],
      ["pt-BR::a.md", { hash: "a", stagedAt: "2026-04-29T00:00:00.000Z" }],
      ["ja-JP::m.md", { hash: "m", stagedAt: "2026-04-29T00:00:00.000Z" }],
    ]);
    await writeLocalCacheIndex(stagingDir, entries);
    const raw = await readFile(path.join(stagingDir, LOCAL_CACHE_INDEX_FILENAME), "utf8");
    const keyOrder = Object.keys(JSON.parse(raw).entries);
    expect(keyOrder).toEqual(["ja-JP::m.md", "pt-BR::a.md", "pt-BR::z.md"]);
  });

  it("round-trips an empty index (no entries) without error", async () => {
    const stagingDir = await makeStagingDir();
    await writeLocalCacheIndex(stagingDir, new Map());
    const loaded = await readLocalCacheIndex(stagingDir);
    expect(loaded.size).toBe(0);
  });
});

describe("readLocalCacheIndex — failure modes", () => {
  it("returns an empty map when the file doesn't exist", async () => {
    const stagingDir = await makeStagingDir();
    const loaded = await readLocalCacheIndex(stagingDir);
    expect(loaded.size).toBe(0);
  });

  it("returns an empty map for malformed JSON", async () => {
    const stagingDir = await makeStagingDir();
    await writeFile(path.join(stagingDir, LOCAL_CACHE_INDEX_FILENAME), "{ this is not valid json", "utf8");
    const loaded = await readLocalCacheIndex(stagingDir);
    expect(loaded.size).toBe(0);
  });

  it("returns an empty map for wrong schema version", async () => {
    // A future bumped-version index is incompatible by definition;
    // we treat it as missing and let the run rebuild a fresh one.
    const stagingDir = await makeStagingDir();
    await writeFile(path.join(stagingDir, LOCAL_CACHE_INDEX_FILENAME), JSON.stringify({ version: 2, entries: { "x::y": {} } }), "utf8");
    const loaded = await readLocalCacheIndex(stagingDir);
    expect(loaded.size).toBe(0);
  });

  it("skips malformed entries within an otherwise valid index", async () => {
    // One good entry, one with a missing `hash` field. The good
    // one must survive; the bad one must be dropped silently (no
    // throw) so a single bad key doesn't poison the whole cache.
    const stagingDir = await makeStagingDir();
    await writeFile(
      path.join(stagingDir, LOCAL_CACHE_INDEX_FILENAME),
      JSON.stringify({
        version: 1,
        entries: {
          "pt-BR::good.md": {
            hash: "abc",
            stagedAt: "2026-04-29T00:00:00.000Z",
          },
          "pt-BR::bad.md": { stagedAt: "2026-04-29T00:00:00.000Z" },
        },
      }),
      "utf8",
    );
    const loaded = await readLocalCacheIndex(stagingDir);
    expect(loaded.size).toBe(1);
    expect(loaded.has("pt-BR::good.md")).toBe(true);
    expect(loaded.has("pt-BR::bad.md")).toBe(false);
  });
});

describe("writeLocalCacheIndex — atomicity", () => {
  it("writes via a tmp file and renames (no torn read on crash)", async () => {
    // Best-effort check: after a successful write, the tmp file
    // should NOT exist (rename consumed it). A reader that
    // observes the destination file must see a complete document.
    const stagingDir = await makeStagingDir();
    await writeLocalCacheIndex(stagingDir, new Map([["pt-BR::a.md", { hash: "x", stagedAt: "2026-04-29T00:00:00.000Z" }]]));
    const indexPath = path.join(stagingDir, LOCAL_CACHE_INDEX_FILENAME);
    const tmpPath = `${indexPath}.tmp`;
    // Reading the destination should succeed.
    await expect(readFile(indexPath, "utf8")).resolves.toContain("hash");
    // The tmp file must NOT linger after a successful rename.
    await expect(readFile(tmpPath, "utf8")).rejects.toThrow();
  });
});

describe("stagedFileExists", () => {
  it("returns true when the staged file is on disk", async () => {
    const stagingDir = await makeStagingDir();
    const target = path.join(stagingDir, "pt-BR", "publications/foo.md");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "# hello\n", "utf8");
    expect(await stagedFileExists(stagingDir, "pt-BR", "publications/foo.md")).toBe(true);
  });

  it("returns false when the staged file is missing", async () => {
    const stagingDir = await makeStagingDir();
    expect(await stagedFileExists(stagingDir, "pt-BR", "publications/missing.md")).toBe(false);
  });

  it("returns false when the path resolves to a directory (not a file)", async () => {
    // Defensive: a dangling directory at the staged path is NOT a
    // staged file, even if it happens to have the same name. The
    // skip path must require an actual file.
    const stagingDir = await makeStagingDir();
    const target = path.join(stagingDir, "pt-BR", "publications/foo.md");
    await mkdir(target, { recursive: true });
    expect(await stagedFileExists(stagingDir, "pt-BR", "publications/foo.md")).toBe(false);
  });
});
