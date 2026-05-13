import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { parseTranslateUiArgs, runTranslateUi } from "../../src/cli/translate-ui.js";

/**
 * Tests for the `polystella translate-ui` subcommand argv parser
 * + light wiring tests for the `--sync-only` mode (the only mode
 * that doesn't require a real or mocked provider). The AI pipeline
 * itself is covered by `tests/i18n/ui-translate-pipeline.test.ts`.
 *
 * Mocking the provider end-to-end through the CLI requires a real
 * `polystella.config.mjs` plus dynamic import of the configured
 * provider stack, which is out of scope here — that integration
 * surface is exercised by the smoke tests against fixtures.
 */

async function tmpProjectWithAstroConfig(opts: {
  defaultLocale: string;
  locales: string[];
  polystellaConfig?: string;
  files?: Record<string, string>;
}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "polystella-translate-ui-"));
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
  if (opts.polystellaConfig !== undefined) {
    await writeFile(path.join(dir, "polystella.config.mjs"), opts.polystellaConfig, "utf8");
  }
  for (const [rel, contents] of Object.entries(opts.files ?? {})) {
    const abs = path.resolve(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, contents, "utf8");
  }
  return dir;
}

describe("parseTranslateUiArgs", () => {
  it("parses an empty argv to defaults", () => {
    expect(parseTranslateUiArgs([])).toEqual({ syncOnly: false, help: false });
  });

  it("parses --sync-only", () => {
    expect(parseTranslateUiArgs(["--sync-only"])).toEqual({ syncOnly: true, help: false });
  });

  it("parses --locale <code>", () => {
    expect(parseTranslateUiArgs(["--locale", "pt-BR"])).toEqual({
      syncOnly: false,
      help: false,
      locale: "pt-BR",
    });
  });

  it("parses --base <dir>", () => {
    expect(parseTranslateUiArgs(["--base", "./locales"])).toEqual({
      syncOnly: false,
      help: false,
      base: "./locales",
    });
  });

  it("throws on unknown flag", () => {
    expect(() => parseTranslateUiArgs(["--bogus"])).toThrowError(/Unknown flag/);
  });

  it("throws when --locale is missing a value", () => {
    expect(() => parseTranslateUiArgs(["--locale"])).toThrowError(/--locale requires a value/);
  });
});

describe("runTranslateUi", () => {
  it("prints help and exits 0 when --help is set", async () => {
    const log = vi.fn();
    const code = await runTranslateUi({ syncOnly: false, help: true }, { cwd: "/dev/null", log, warn: vi.fn(), err: vi.fn() });
    expect(code).toBe(0);
    expect(log.mock.calls[0]?.[0]).toMatch(/polystella translate-ui/);
  });

  it("returns 1 when astro.config.mjs is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "polystella-translate-ui-noconfig-"));
    const err = vi.fn();
    const code = await runTranslateUi({ syncOnly: false, help: false }, { cwd: dir, log: vi.fn(), warn: vi.fn(), err });
    expect(code).toBe(1);
    expect(err.mock.calls.some((c) => c[0].includes("astro.config.mjs"))).toBe(true);
  });

  it("returns 1 when --locale isn't declared in i18n.locales", async () => {
    const cwd = await tmpProjectWithAstroConfig({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
    });
    const err = vi.fn();
    const code = await runTranslateUi({ syncOnly: false, help: false, locale: "zh-CN" }, { cwd, log: vi.fn(), warn: vi.fn(), err });
    expect(code).toBe(1);
    expect(err.mock.calls.some((c) => c[0].includes("not declared"))).toBe(true);
  });

  it("--sync-only succeeds without a polystella.config.mjs (no provider needed)", async () => {
    const cwd = await tmpProjectWithAstroConfig({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      files: {
        "src/content/i18n/en-US.json": `{ "a": "A", "b": "B" }`,
      },
    });
    const log = vi.fn();
    const code = await runTranslateUi({ syncOnly: true, help: false }, { cwd, log, warn: vi.fn(), err: vi.fn() });
    expect(code).toBe(0);
    const ptText = await readFile(path.resolve(cwd, "src/content/i18n/pt-BR.json"), "utf8");
    expect(ptText).toBe('{\n  "a": "",\n  "b": ""\n}\n');
  });

  it("returns 1 when no provider is configured", async () => {
    // Minimal polystella.config.mjs without a provider — the AI step
    // can't run, so the CLI must refuse rather than silently do nothing.
    const cwd = await tmpProjectWithAstroConfig({
      defaultLocale: "en-US",
      locales: ["en-US", "pt-BR"],
      polystellaConfig: `export default {};\n`,
      files: {
        "src/content/i18n/en-US.json": `{ "a": "A" }`,
      },
    });
    const err = vi.fn();
    const code = await runTranslateUi({ syncOnly: false, help: false }, { cwd, log: vi.fn(), warn: vi.fn(), err });
    expect(code).toBe(1);
    expect(err.mock.calls.some((c) => c[0].includes("no provider configured"))).toBe(true);
  });
});
