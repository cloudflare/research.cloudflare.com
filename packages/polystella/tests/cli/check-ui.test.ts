import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { parseCheckUiArgs, runCheckUi } from "../../src/cli/check-ui.js";

/**
 * Tests for the `polystella check-ui` subcommand.
 *
 * The drift detector itself is covered by `tests/i18n/ui-drift.test.ts`;
 * these tests pin the CLI wiring: argv parsing, exit codes, the
 * remediation message on failure, and the missing-config error path.
 *
 * A tmp project is scaffolded with a minimal `astro.config.mjs` so
 * the loader's import-from-disk path is exercised end-to-end.
 */

async function tmpProjectWithAstroConfig(opts: {
  defaultLocale: string;
  locales: string[];
  files?: Record<string, string>;
}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "polystella-check-ui-"));
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

describe("parseCheckUiArgs", () => {
  it("parses an empty argv to defaults", () => {
    expect(parseCheckUiArgs([])).toEqual({ help: false });
  });

  it("parses --base", () => {
    expect(parseCheckUiArgs(["--base", "./locales"])).toEqual({
      help: false,
      base: "./locales",
    });
  });

  it("parses --help / -h", () => {
    expect(parseCheckUiArgs(["--help"]).help).toBe(true);
    expect(parseCheckUiArgs(["-h"]).help).toBe(true);
  });

  it("throws on unknown flag", () => {
    expect(() => parseCheckUiArgs(["--unknown"])).toThrowError(/Unknown flag/);
  });

  it("throws when --base is missing a value", () => {
    expect(() => parseCheckUiArgs(["--base"])).toThrowError(/--base requires a value/);
  });
});

describe("runCheckUi", () => {
  it("prints help and exits 0 when --help is set", async () => {
    const log = vi.fn();
    const err = vi.fn();
    const code = await runCheckUi({ help: true }, { cwd: "/dev/null", log, err });
    expect(code).toBe(0);
    expect(log.mock.calls[0]?.[0]).toMatch(/polystella check-ui/);
    expect(err).not.toHaveBeenCalled();
  });

  it("returns 1 when astro.config.mjs is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "polystella-check-ui-noconfig-"));
    const err = vi.fn();
    const code = await runCheckUi({ help: false }, { cwd: dir, log: vi.fn(), err });
    expect(code).toBe(1);
    expect(err.mock.calls.some((c) => c[0].includes("astro.config.mjs"))).toBe(true);
  });

  it("returns 0 when every locale matches the default", async () => {
    const cwd = await tmpProjectWithAstroConfig({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      files: {
        "src/content/i18n/en-US.json": `{ "a": "A", "b": "B" }`,
        "src/content/i18n/pt-BR.json": `{ "a": "ALocale", "b": "BLocale" }`,
      },
    });
    const log = vi.fn();
    const err = vi.fn();
    const code = await runCheckUi({ help: false }, { cwd, log, err });
    expect(code).toBe(0);
    expect(log.mock.calls.some((c) => c[0].includes("drift check passed"))).toBe(true);
    expect(err).not.toHaveBeenCalled();
  });

  it("returns 1 and prints remediation guidance when drift is detected", async () => {
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
    const code = await runCheckUi({ help: false }, { cwd, log, err });
    expect(code).toBe(1);
    const errOutput = err.mock.calls.map((c) => c[0]).join("\n");
    expect(errOutput).toContain("drift detected");
    expect(errOutput).toContain("Missing keys in pt-BR.json");
    expect(errOutput).toContain("pnpm i18n:sync");
    expect(errOutput).toContain("pnpm i18n:translate");
  });

  it("returns 1 when empty-placeholder values exist in a non-default locale", async () => {
    // Synced-but-untranslated state. The pre-commit hook must catch
    // this — shipping `""` is a real bug, not a soft drift.
    const cwd = await tmpProjectWithAstroConfig({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      files: {
        "src/content/i18n/en-US.json": `{ "nav.home": "Home", "nav.about": "About" }`,
        "src/content/i18n/pt-BR.json": `{ "nav.home": "Início", "nav.about": "" }`,
      },
    });
    const err = vi.fn();
    const code = await runCheckUi({ help: false }, { cwd, log: vi.fn(), err });
    expect(code).toBe(1);
    const errOutput = err.mock.calls.map((c) => c[0]).join("\n");
    expect(errOutput).toContain("Empty placeholders in pt-BR.json");
    expect(errOutput).toContain("nav.about");
  });

  it("returns 1 when astro i18n.locales does not include defaultLocale", async () => {
    const cwd = await tmpProjectWithAstroConfig({
      defaultLocale: "en-US",
      locales: ["pt-BR"], // misconfigured
    });
    const err = vi.fn();
    const code = await runCheckUi({ help: false }, { cwd, log: vi.fn(), err });
    expect(code).toBe(1);
    expect(err.mock.calls.some((c) => c[0].includes("must include defaultLocale"))).toBe(true);
  });

  it("respects --base override", async () => {
    const cwd = await tmpProjectWithAstroConfig({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      files: {
        "locales/en-US.json": `{ "a": "A" }`,
        "locales/pt-BR.json": `{ "a": "ALocale" }`,
      },
    });
    const log = vi.fn();
    const err = vi.fn();
    const code = await runCheckUi({ help: false, base: "./locales" }, { cwd, log, err });
    expect(code).toBe(0);
  });
});
