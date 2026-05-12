import { describe, expect, it, vi } from "vitest";
import { pruneCacheByPair, encodeTouchedPair, decodeTouchedPair } from "../src/storage/prune.js";
import type { R2Client, R2ListEntry } from "../src/storage/r2.js";

/**
 * Build an in-memory R2 fixture pre-populated with a fixed list of
 * keys, each timestamped at a deterministic offset. Records `del`
 * calls so tests can assert exactly which keys were pruned.
 */
function makeFixtureR2(initialKeys: Array<{ key: string; lastModifiedMs: number }>) {
  const store = new Map<string, R2ListEntry>(
    initialKeys.map(({ key, lastModifiedMs }) => [
      key,
      {
        key,
        size: 100,
        lastModified: new Date(lastModifiedMs),
        etag: "",
      },
    ]),
  );
  const deleted: string[] = [];

  const client: R2Client = {
    async exists(key) {
      return store.has(key);
    },
    async get() {
      return null;
    },
    async put() {},
    async list(prefix) {
      return [...store.values()].filter((e) => e.key.startsWith(prefix));
    },
    async del(key) {
      deleted.push(key);
      store.delete(key);
    },
  };
  return { client, deleted, store };
}

describe("encodeTouchedPair / decodeTouchedPair", () => {
  it("round-trips a (locale, sourcePath) tuple losslessly", () => {
    const encoded = encodeTouchedPair("pt-BR", "publications/sample.md");
    expect(decodeTouchedPair(encoded)).toEqual({
      locale: "pt-BR",
      sourcePath: "publications/sample.md",
    });
  });

  it("preserves '::' inside sourcePath (the separator is matched at the FIRST occurrence)", () => {
    // Defensive: an exotic sourcePath containing '::' should still
    // decode the locale segment correctly.
    const encoded = encodeTouchedPair("pt-BR", "weird::path.md");
    expect(decodeTouchedPair(encoded)).toEqual({
      locale: "pt-BR",
      sourcePath: "weird::path.md",
    });
  });

  it("returns null for malformed encodings (no '::' separator)", () => {
    expect(decodeTouchedPair("plain-string")).toBeNull();
  });
});

describe("pruneCacheByPair — keep top N by lastModified", () => {
  it("deletes everything past the N most-recent variants per pair", async () => {
    // Five hash variants for one pair, each 1 day apart. Newest is
    // 2026-04-29, oldest is 2026-04-25. With keepLastN=2 we expect
    // the three oldest to be deleted.
    const fixture = makeFixtureR2([
      {
        key: "i18n/pt-BR/publications/sample.md#hash5.md",
        lastModifiedMs: Date.UTC(2026, 3, 29),
      },
      {
        key: "i18n/pt-BR/publications/sample.md#hash4.md",
        lastModifiedMs: Date.UTC(2026, 3, 28),
      },
      {
        key: "i18n/pt-BR/publications/sample.md#hash3.md",
        lastModifiedMs: Date.UTC(2026, 3, 27),
      },
      {
        key: "i18n/pt-BR/publications/sample.md#hash2.md",
        lastModifiedMs: Date.UTC(2026, 3, 26),
      },
      {
        key: "i18n/pt-BR/publications/sample.md#hash1.md",
        lastModifiedMs: Date.UTC(2026, 3, 25),
      },
    ]);

    const result = await pruneCacheByPair({
      r2: fixture.client,
      touchedPairs: [encodeTouchedPair("pt-BR", "publications/sample.md")],
      keepLastN: 2,
    });

    expect(result).toMatchObject({
      deleted: 3,
      prunedPairs: 1,
      consideredPairs: 1,
    });
    // `deletedKeys` records the actual keys the pruner DELETE'd
    // (used by the build report). Same set as the fixture-tracked
    // victims below; no order constraint because the pruner walks
    // variants in last-modified order which the fixture doesn't
    // constrain.
    expect(new Set(result.deletedKeys)).toEqual(new Set(fixture.deleted));
    // The three oldest are gone, in any order — the pruner deletes
    // sequentially but the test asserts on the SET of victims.
    expect(new Set(fixture.deleted)).toEqual(
      new Set([
        "i18n/pt-BR/publications/sample.md#hash3.md",
        "i18n/pt-BR/publications/sample.md#hash2.md",
        "i18n/pt-BR/publications/sample.md#hash1.md",
      ]),
    );
    // The two newest survive.
    expect(fixture.store.has("i18n/pt-BR/publications/sample.md#hash5.md")).toBe(true);
    expect(fixture.store.has("i18n/pt-BR/publications/sample.md#hash4.md")).toBe(true);
  });

  it("is a no-op when variant count <= keepLastN", async () => {
    const fixture = makeFixtureR2([
      {
        key: "i18n/pt-BR/publications/a.md#hash1.md",
        lastModifiedMs: 1000,
      },
      {
        key: "i18n/pt-BR/publications/a.md#hash2.md",
        lastModifiedMs: 2000,
      },
    ]);

    const result = await pruneCacheByPair({
      r2: fixture.client,
      touchedPairs: [encodeTouchedPair("pt-BR", "publications/a.md")],
      keepLastN: 5,
    });

    expect(result.deleted).toBe(0);
    expect(result.prunedPairs).toBe(0);
    expect(fixture.deleted).toEqual([]);
  });

  it("returns immediately when keepLastN is false (pruning disabled)", async () => {
    // Even with 100 stale variants, `false` short-circuits the entire
    // function — no list() call, no del() call.
    const listSpy = vi.fn(async () => [] as R2ListEntry[]);
    const delSpy = vi.fn(async () => {});
    const r2: R2Client = {
      async exists() {
        return false;
      },
      async get() {
        return null;
      },
      async put() {},
      list: listSpy,
      del: delSpy,
    };

    const result = await pruneCacheByPair({
      r2,
      touchedPairs: [encodeTouchedPair("pt-BR", "publications/sample.md")],
      keepLastN: false,
    });

    expect(result).toEqual({
      deleted: 0,
      deletedKeys: [],
      prunedPairs: 0,
      consideredPairs: 0,
    });
    expect(listSpy).not.toHaveBeenCalled();
    expect(delSpy).not.toHaveBeenCalled();
  });
});

describe("pruneCacheByPair — scoping", () => {
  it("only prunes pairs included in `touchedPairs`; leaves untouched pairs alone", async () => {
    // Two pairs in R2: publications/a.md (touched) and
    // publications/b.md (NOT touched). Each has 4 variants. keepLastN=1.
    const fixture = makeFixtureR2([
      // pair A — touched
      { key: "i18n/pt-BR/publications/a.md#h1.md", lastModifiedMs: 1000 },
      { key: "i18n/pt-BR/publications/a.md#h2.md", lastModifiedMs: 2000 },
      { key: "i18n/pt-BR/publications/a.md#h3.md", lastModifiedMs: 3000 },
      { key: "i18n/pt-BR/publications/a.md#h4.md", lastModifiedMs: 4000 },
      // pair B — NOT touched, must remain intact even though it has
      // more than keepLastN variants
      { key: "i18n/pt-BR/publications/b.md#h1.md", lastModifiedMs: 1000 },
      { key: "i18n/pt-BR/publications/b.md#h2.md", lastModifiedMs: 2000 },
      { key: "i18n/pt-BR/publications/b.md#h3.md", lastModifiedMs: 3000 },
      { key: "i18n/pt-BR/publications/b.md#h4.md", lastModifiedMs: 4000 },
    ]);

    const result = await pruneCacheByPair({
      r2: fixture.client,
      touchedPairs: [encodeTouchedPair("pt-BR", "publications/a.md")],
      keepLastN: 1,
    });

    expect(result.deleted).toBe(3);
    // All four b.md variants must survive — they were never touched.
    for (const h of ["h1", "h2", "h3", "h4"]) {
      expect(fixture.store.has(`i18n/pt-BR/publications/b.md#${h}.md`)).toBe(true);
    }
    // Only the newest a.md variant survives.
    expect(fixture.store.has("i18n/pt-BR/publications/a.md#h4.md")).toBe(true);
  });

  it("only prunes within the locale's prefix; pairs in other locales are untouched", async () => {
    // pt-BR pair has 3 variants; ja-JP pair has 3. We touch only
    // pt-BR with keepLastN=1, so ja-JP must keep all three.
    const fixture = makeFixtureR2([
      { key: "i18n/pt-BR/publications/a.md#h1.md", lastModifiedMs: 1000 },
      { key: "i18n/pt-BR/publications/a.md#h2.md", lastModifiedMs: 2000 },
      { key: "i18n/pt-BR/publications/a.md#h3.md", lastModifiedMs: 3000 },
      { key: "i18n/ja-JP/publications/a.md#h1.md", lastModifiedMs: 1000 },
      { key: "i18n/ja-JP/publications/a.md#h2.md", lastModifiedMs: 2000 },
      { key: "i18n/ja-JP/publications/a.md#h3.md", lastModifiedMs: 3000 },
    ]);

    const result = await pruneCacheByPair({
      r2: fixture.client,
      touchedPairs: [encodeTouchedPair("pt-BR", "publications/a.md")],
      keepLastN: 1,
    });

    expect(result.deleted).toBe(2);
    // ja-JP fully intact.
    for (const h of ["h1", "h2", "h3"]) {
      expect(fixture.store.has(`i18n/ja-JP/publications/a.md#${h}.md`)).toBe(true);
    }
  });

  it("issues exactly one list() call per touched locale (batched), not one per pair", async () => {
    // 5 sourcePaths under pt-BR, all touched. Pruner should call
    // r2.list("i18n/pt-BR/") exactly once.
    const listSpy = vi.fn(async (prefix: string): Promise<R2ListEntry[]> => {
      if (prefix !== "i18n/pt-BR/") return [];
      return [];
    });
    const r2: R2Client = {
      async exists() {
        return false;
      },
      async get() {
        return null;
      },
      async put() {},
      list: listSpy,
      async del() {},
    };

    await pruneCacheByPair({
      r2,
      touchedPairs: Array.from({ length: 5 }, (_, i) => encodeTouchedPair("pt-BR", `publications/file-${i}.md`)),
      keepLastN: 5,
    });

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledWith("i18n/pt-BR/");
  });
});

describe("pruneCacheByPair — configurable prefix (branch isolation)", () => {
  // Branch isolation is the entire point of a configurable prefix:
  // a preview build operating on `previews/<branch>/i18n/` MUST NOT
  // be able to evict variants under production's `i18n/` even if
  // its touched-pairs set names the same (locale, sourcePath).

  it("prunes only within the configured prefix, leaving sibling prefixes untouched", async () => {
    const fixture = makeFixtureR2([
      // Production prefix — three variants, all should survive.
      { key: "i18n/pt-BR/publications/a.md#h1.md", lastModifiedMs: 1000 },
      { key: "i18n/pt-BR/publications/a.md#h2.md", lastModifiedMs: 2000 },
      { key: "i18n/pt-BR/publications/a.md#h3.md", lastModifiedMs: 3000 },
      // Preview prefix — three variants for the same logical pair;
      // keepLastN=1 should leave only the newest under this prefix.
      {
        key: "previews/feat-x/i18n/pt-BR/publications/a.md#h1.md",
        lastModifiedMs: 1000,
      },
      {
        key: "previews/feat-x/i18n/pt-BR/publications/a.md#h2.md",
        lastModifiedMs: 2000,
      },
      {
        key: "previews/feat-x/i18n/pt-BR/publications/a.md#h3.md",
        lastModifiedMs: 3000,
      },
    ]);

    const result = await pruneCacheByPair({
      r2: fixture.client,
      prefix: "previews/feat-x/i18n/",
      touchedPairs: [encodeTouchedPair("pt-BR", "publications/a.md")],
      keepLastN: 1,
    });

    // Two preview variants pruned (h1 and h2), the newest (h3) kept.
    expect(result.deleted).toBe(2);
    expect(new Set(fixture.deleted)).toEqual(
      new Set(["previews/feat-x/i18n/pt-BR/publications/a.md#h1.md", "previews/feat-x/i18n/pt-BR/publications/a.md#h2.md"]),
    );

    // All three production variants survive — the pruner is forbidden
    // from looking outside its configured prefix even when the same
    // (locale, sourcePath) pair lives there.
    for (const h of ["h1", "h2", "h3"]) {
      expect(fixture.store.has(`i18n/pt-BR/publications/a.md#${h}.md`)).toBe(true);
    }
  });

  it("issues list() against `<prefix><locale>/`, not the legacy `i18n/<locale>/`", async () => {
    // Catches a regression where the prune scanner forgot to thread
    // the configured prefix through and silently fell back to
    // `i18n/`.
    const listSpy = vi.fn(async (): Promise<R2ListEntry[]> => []);
    const r2: R2Client = {
      async exists() {
        return false;
      },
      async get() {
        return null;
      },
      async put() {},
      list: listSpy,
      async del() {},
    };

    await pruneCacheByPair({
      r2,
      prefix: "previews/feat-x/i18n/",
      touchedPairs: [encodeTouchedPair("pt-BR", "publications/a.md")],
      keepLastN: 1,
    });

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledWith("previews/feat-x/i18n/pt-BR/");
  });

  it("rejects a non-empty prefix that doesn't end with `/` (config typo guard)", async () => {
    // Symmetric with `buildR2Key`'s contract — a malformed prefix
    // would silently mis-scope the scan.
    const fixture = makeFixtureR2([]);
    await expect(
      pruneCacheByPair({
        r2: fixture.client,
        prefix: "previews/feat-x",
        touchedPairs: [encodeTouchedPair("pt-BR", "publications/a.md")],
        keepLastN: 1,
      }),
    ).rejects.toThrow(/prefix must end with "\/"/);
  });

  it("defaults to the legacy `i18n/` prefix when none is supplied", async () => {
    // Back-compat: callers that pre-date the prefix knob keep the
    // exact same scan range.
    const fixture = makeFixtureR2([
      { key: "i18n/pt-BR/publications/a.md#h1.md", lastModifiedMs: 1000 },
      { key: "i18n/pt-BR/publications/a.md#h2.md", lastModifiedMs: 2000 },
    ]);
    const result = await pruneCacheByPair({
      r2: fixture.client,
      touchedPairs: [encodeTouchedPair("pt-BR", "publications/a.md")],
      keepLastN: 1,
    });
    expect(result.deleted).toBe(1);
    expect(fixture.deleted).toEqual(["i18n/pt-BR/publications/a.md#h1.md"]);
  });
});
