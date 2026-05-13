import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { parseSyncUiArgs, runSyncUi } from "../../src/cli/sync-ui.js";

/**
 * Tests for the `polystella sync-ui` subcommand.
 *
 * The pure sync layer is tested in `tests/i18n/sync.test.ts`; these
 * tests pin the CLI wiring (argv, exit codes, --check semantics).
 */

async function tmpProjectWithAstroConfig(opts: {
  defaultLocale: string;
  locales: string[];
  files?: Record<string, string>;
}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "polystella-sync-ui-"));
  await mkdir(path.join(dir, "src", "content", "i18n"), { recursive: true });
  await writeFile(
    path.join(dir, "astro.config.mjs"),
    `export default {
  i18n: {
    defaultLocale: ${JSON.stringify(opts.defaultLocale)},
    locales: ${JSON.stringify(opts.locales)},
  },
};
`,
    "utf8",
  );
  for (const [rel, contents] of Object.entries(opts.files ?? {})) {
    const abs = path.resolve(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, contents, "utf8");
  }
  return dir;
}

describe("parseSyncUiArgs", () => {
  it("parses an empty argv to defaults", () => {
    expect(parseSyncUiArgs([])).toEqual({ check: false, help: false });
  });

  it("parses --check", () => {
    expect(parseSyncUiArgs(["--check"])).toEqual({ check: true, help: false });
  });

  it("parses --base", () => {
    expect(parseSyncUiArgs(["--base", "./locales"])).toEqual({
      check: false,
      help: false,
      base: "./locales",
    });
  });

  it("throws on unknown flag", () => {
    expect(() => parseSyncUiArgs(["--bogus"])).toThrowError(/Unknown flag/);
  });
});

describe("runSyncUi", () => {
  it("creates missing locale files and reports counts", async () => {
    const cwd = await tmpProjectWithAstroConfig({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      files: {
        "src/content/i18n/en-US.json": `{ "a": "A", "b": "B" }`,
      },
    });
    const log = vi.fn();
    const err = vi.fn();
    const code = await runSyncUi({ check: false, help: false }, { cwd, log, err });
    expect(code).toBe(0);
    const ptText = await readFile(path.resolve(cwd, "src/content/i18n/pt-BR.json"), "utf8");
    expect(ptText).toBe('{\n  "a": "",\n  "b": ""\n}\n');
    expect(log.mock.calls.some((c) => c[0].includes("pt-BR (created)"))).toBe(true);
  });

  it("logs 'already in sync' and exits 0 on a no-op", async () => {
    const cwd = await tmpProjectWithAstroConfig({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      files: {
        "src/content/i18n/en-US.json": `{ "a": "A" }`,
        "src/content/i18n/pt-BR.json": `{\n  "a": "ALocale"\n}\n`,
      },
    });
    const log = vi.fn();
    const code = await runSyncUi({ check: false, help: false }, { cwd, log, err: vi.fn() });
    expect(code).toBe(0);
    expect(log.mock.calls.some((c) => c[0].includes("already in sync"))).toBe(true);
  });

  it("--check exits 2 and lists pending changes without writing", async () => {
    const cwd = await tmpProjectWithAstroConfig({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      files: {
        "src/content/i18n/en-US.json": `{ "a": "A", "b": "B" }`,
        "src/content/i18n/pt-BR.json": `{ "a": "ALocale" }`, // missing "b"
      },
    });
    const log = vi.fn();
    const err = vi.fn();
    const code = await runSyncUi({ check: true, help: false }, { cwd, log, err });
    expect(code).toBe(2);
    const errOutput = err.mock.calls.map((c) => c[0]).join("\n");
    expect(errOutput).toContain("pt-BR (would-update)");
    expect(errOutput).toContain("+1 added");

    // File must NOT have been written.
    const ptText = await readFile(path.resolve(cwd, "src/content/i18n/pt-BR.json"), "utf8");
    expect(ptText).toBe(`{ "a": "ALocale" }`);
  });

  it("--check exits 0 on a clean tree", async () => {
    const cwd = await tmpProjectWithAstroConfig({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      files: {
        "src/content/i18n/en-US.json": `{\n  "a": "A"\n}\n`,
        "src/content/i18n/pt-BR.json": `{\n  "a": "ALocale"\n}\n`,
      },
    });
    const code = await runSyncUi(
      { check: true, help: false },
      {
        cwd,
        log: vi.fn(),
        err: vi.fn(),
      },
    );
    expect(code).toBe(0);
  });

  it("returns 1 when astro.config.mjs is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "polystella-sync-ui-noconfig-"));
    const err = vi.fn();
    const code = await runSyncUi({ check: false, help: false }, { cwd: dir, log: vi.fn(), err });
    expect(code).toBe(1);
  });

  it("prints help and exits 0 when --help is set", async () => {
    const log = vi.fn();
    const code = await runSyncUi(
      { check: false, help: true },
      {
        cwd: "/dev/null",
        log,
        err: vi.fn(),
      },
    );
    expect(code).toBe(0);
    expect(log.mock.calls[0]?.[0]).toMatch(/polystella sync-ui/);
  });
});
