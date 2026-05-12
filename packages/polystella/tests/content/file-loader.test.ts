import { describe, expect, it } from "vitest";

import { POLYSTELLA_SOURCE_PATH_KEY, file, readRecordedSourcePath } from "../src/content/file-loader.js";

/**
 * Polystella-flavoured `file()` loader. Forwards to Astro's `file()`
 * and adds a non-enumerable path record so `polystellaCollections`
 * can auto-derive locale siblings.
 *
 * The recorded path is the EXACT string the user passed in — no
 * normalisation, no resolution. Downstream callers
 * (`polystellaCollections`) are responsible for relativising it to
 * `sourceDir`.
 */

describe("polystella file() — recording", () => {
  it("returns a loader with name = 'file-loader' (Astro-compatible)", () => {
    const loader = file("./content/site.toml");
    expect(loader.name).toBe("file-loader");
    expect(typeof loader.load).toBe("function");
  });

  it("records the source path under the marker key", () => {
    const loader = file("./content/site.toml");
    expect(readRecordedSourcePath(loader)).toBe("./content/site.toml");
  });

  it("records the path verbatim — no normalisation", () => {
    // Trailing slashes, leading `./`, `..` segments — all left
    // untouched so the consumer's intent is preserved. Path
    // resolution happens later in polystellaCollections.
    const cases = ["./content/site.toml", "content/site.toml", "./content/configs/site.toml", "/abs/content/site.toml"];
    for (const path of cases) {
      const loader = file(path);
      expect(readRecordedSourcePath(loader)).toBe(path);
    }
  });

  it("makes the marker key non-enumerable (invisible to JSON.stringify / Object.keys)", () => {
    const loader = file("./content/site.toml");
    // Object.keys / JSON.stringify both skip non-enumerable
    // properties; this matters for any consumer that serialises
    // the loader to disk (build report, debug logs, etc.).
    expect(Object.keys(loader).sort()).toEqual(["load", "name"]);
    expect(JSON.parse(JSON.stringify(loader))).toEqual({ name: "file-loader" });
  });

  it("makes the marker key non-writable (prevents accidental override)", () => {
    const loader = file("./content/site.toml");
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (loader as any)[POLYSTELLA_SOURCE_PATH_KEY] = "tampered";
    }).toThrow();
    expect(readRecordedSourcePath(loader)).toBe("./content/site.toml");
  });
});

describe("readRecordedSourcePath — degenerate inputs", () => {
  it("returns undefined for null / non-object inputs", () => {
    expect(readRecordedSourcePath(null)).toBeUndefined();
    expect(readRecordedSourcePath(undefined)).toBeUndefined();
    expect(readRecordedSourcePath(42)).toBeUndefined();
    expect(readRecordedSourcePath("string")).toBeUndefined();
  });

  it("returns undefined for objects without the marker key", () => {
    expect(readRecordedSourcePath({})).toBeUndefined();
    expect(readRecordedSourcePath({ name: "file-loader" })).toBeUndefined();
  });

  it("returns undefined for non-string marker values (defensive)", () => {
    // A consumer (or a future bug) shoving a number / object onto
    // the marker key shouldn't crash the helper. Returning
    // undefined falls back to the warn-and-skip path naturally.
    const loader = { [POLYSTELLA_SOURCE_PATH_KEY]: 42 };
    expect(readRecordedSourcePath(loader)).toBeUndefined();
  });
});
