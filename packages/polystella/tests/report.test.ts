import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  computeBuildReportTotals,
  emitBuildReport,
  type BuildReport,
  type BuildReportEntry,
} from "../src/storage/report.js";

/**
 * Two layers:
 *   - `computeBuildReportTotals`: pure aggregator over entries.
 *   - `emitBuildReport`: serialise + write, tested with a real tmpdir.
 *
 * Build-hook integration (populating the report during a build) is
 * exercised via the manual smoke flow; this file pins the totals
 * arithmetic and the on-disk shape.
 */

function makeEntry(
  overrides: Partial<BuildReportEntry> = {},
): BuildReportEntry {
  return {
    sourcePath: "publications/foo.md",
    locale: "pt-BR",
    sourceHash: "deadbeef",
    r2Key: "i18n/pt-BR/publications/foo.md#deadbeef.md",
    outcome: "cache-hit",
    model: "@cf/meta/llama-3.1-8b-instruct",
    durationMs: 42,
    ...overrides,
  };
}

describe("computeBuildReportTotals", () => {
  it("returns zero counts for an empty entry list", () => {
    expect(computeBuildReportTotals([])).toEqual({
      cacheHits: 0,
      aiTranslated: 0,
      overrides: 0,
      skipped: 0,
      errors: 0,
    });
  });

  it("counts each outcome category independently", () => {
    const entries: BuildReportEntry[] = [
      makeEntry({ outcome: "cache-hit" }),
      makeEntry({ outcome: "cache-hit" }),
      makeEntry({ outcome: "ai-translated" }),
      makeEntry({ outcome: "override" }),
      makeEntry({ outcome: "skipped-no-translate" }),
      makeEntry({ outcome: "error", errorMessage: "boom" }),
    ];
    expect(computeBuildReportTotals(entries)).toEqual({
      cacheHits: 2,
      aiTranslated: 1,
      overrides: 1,
      skipped: 1,
      errors: 1,
    });
  });

  it("sums tokens only when at least one entry reports them", () => {
    // Provider doesn't always surface in/out token counts; the
    // aggregator must distinguish "every entry was 0 tokens" from
    // "no entry reported tokens" — only the latter omits the field.
    const withTokens = computeBuildReportTotals([
      makeEntry({ outcome: "ai-translated", tokens: { in: 100, out: 200 } }),
      makeEntry({ outcome: "ai-translated", tokens: { in: 50, out: 75 } }),
      makeEntry({ outcome: "cache-hit" }),
    ]);
    expect(withTokens.tokensIn).toBe(150);
    expect(withTokens.tokensOut).toBe(275);
  });

  it("omits token totals entirely when no entry reports them", () => {
    const noTokens = computeBuildReportTotals([
      makeEntry({ outcome: "cache-hit" }),
      makeEntry({ outcome: "override" }),
    ]);
    expect(noTokens.tokensIn).toBeUndefined();
    expect(noTokens.tokensOut).toBeUndefined();
  });
});

describe("emitBuildReport", () => {
  async function makeTempDir(): Promise<string> {
    return mkdtemp(path.join(os.tmpdir(), "polystella-report-"));
  }

  function makeReport(): BuildReport {
    return {
      build: {
        startedAt: "2026-04-25T08:13:42.000Z",
        durationMs: 12340,
        mode: "standalone",
        polystellaVersion: "0.1.0",
      },
      locales: ["en", "pt-BR", "ja-JP"],
      defaultLocale: "en",
      glossaries: {
        "pt-BR": { file: "i18n/glossary/pt-BR.yaml", sha256: "abc" },
        "ja-JP": { file: "i18n/glossary/ja-JP.yaml", sha256: "def" },
      },
      entries: [
        makeEntry({ outcome: "cache-hit" }),
        makeEntry({
          outcome: "ai-translated",
          tokens: { in: 100, out: 200 },
        }),
      ],
      totals: {
        cacheHits: 1,
        aiTranslated: 1,
        overrides: 0,
        skipped: 0,
        errors: 0,
        tokensIn: 100,
        tokensOut: 200,
      },
      pruning: {
        deletedKeys: ["i18n/pt-BR/publications/old.md#oldhash.md"],
        byLocale: { "pt-BR": 1 },
      },
    };
  }

  it("writes the report to <outDir>/i18n-r2-report.json by default", async () => {
    const outDir = await makeTempDir();
    try {
      const report = makeReport();
      const written = await emitBuildReport({ outDir, report });
      expect(written).toBe(path.resolve(outDir, "i18n-r2-report.json"));
      const onDisk = await readFile(written, "utf8");
      const parsed = JSON.parse(onDisk);
      expect(parsed).toEqual(report);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("respects a custom filename", async () => {
    const outDir = await makeTempDir();
    try {
      const written = await emitBuildReport({
        outDir,
        filename: "custom-name.json",
        report: makeReport(),
      });
      expect(path.basename(written)).toBe("custom-name.json");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("writes pretty-printed JSON with a trailing newline", async () => {
    const outDir = await makeTempDir();
    try {
      const written = await emitBuildReport({ outDir, report: makeReport() });
      const onDisk = await readFile(written, "utf8");
      // Two-space indent for diffability.
      expect(onDisk).toContain('\n  "build":');
      // Trailing newline for POSIX-friendly tooling.
      expect(onDisk.endsWith("\n")).toBe(true);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("creates the output directory if it doesn't exist", async () => {
    const parent = await makeTempDir();
    try {
      const outDir = path.join(parent, "nested", "dist");
      const written = await emitBuildReport({
        outDir,
        report: makeReport(),
      });
      expect(written.startsWith(outDir)).toBe(true);
      await readFile(written, "utf8");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
