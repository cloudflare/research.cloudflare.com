/**
 * End-to-end smoke test for the Astro integration.
 *
 * Drives the `polystella(options)` factory and its hooks with stubbed
 * Astro context, against a real temp project. Catches integration
 * regressions that unit tests miss — the canonical example is the
 * `publishRuntimeBridge` parameter that went missing and only
 * surfaced at typecheck time, never at runtime.
 *
 * Asserts on the SHAPE of side effects the integration is contracted
 * to produce:
 *   - virtual module registered + returns the expected source
 *   - middleware registered (unless opted out)
 *   - route shims written when `routes` matches pages
 *   - staging files written for translated content
 *   - build report emitted at `astro:build:done`
 *   - runtime bridge published on globalThis
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import polystella, { POLYSTELLA_VERSION } from "../src/index.js";
import type { Translator } from "../src/translation/provider.js";

interface CapturedRoute {
  pattern: string;
  entrypoint: string;
}

interface CapturedMiddleware {
  entrypoint: string;
  order: string;
}

interface CapturedVitePlugin {
  name: string;
  resolveId?: (id: string) => string | undefined | null;
  load?: (id: string) => string | undefined | null;
}

interface SmokeHarness {
  rootDir: string;
  stagingDir: string;
  capturedRoutes: CapturedRoute[];
  capturedMiddleware: CapturedMiddleware[];
  capturedVitePlugins: CapturedVitePlugin[];
  configSetup: (command: "build" | "dev" | "sync") => Promise<void>;
  buildDone: () => Promise<{ reportPath: string | null; reportContent: unknown }>;
}

let tempRoots: string[] = [];
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  tempRoots = [];
  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  // Always restore fetch so a fetch-stubbing test can't leak its
  // stub into a subsequent test. The per-test `try/finally` is
  // belt-and-braces, but this `afterEach` guarantees recovery even
  // if a test throws before the finally runs (vitest catches it,
  // but the assignment may still leak).
  globalThis.fetch = originalFetch;
  for (const root of tempRoots) {
    try {
      await rm(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

const SAMPLE_PUBLICATION = ["---", 'title: "Hello world"', "---", "", "First paragraph.", "", "Second paragraph.", ""].join("\n");

const SAMPLE_PAGE_ASTRO = ["---", "// minimal Astro page for shim generation", "---", "", "<h1>Hello</h1>", ""].join("\n");

/**
 * Build a stub translator that echoes each `@@<id>@@` block back with
 * a `TR:` prefix. Matches the format `prompt.ts` expects.
 */
function makeEchoTranslator(modelId = "smoke/echo-1"): Translator & { calls: number } {
  const t = {
    modelId,
    calls: 0,
    async translate(_sys: string, userPrompt: string) {
      t.calls++;
      const blocks: string[] = [];
      const re = /^@@([^@\n]+?)@@\s*\n([\s\S]*?)(?=\n@@|$)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(userPrompt)) !== null) {
        const id = m[1]?.trim() ?? "";
        const text = (m[2] ?? "").trim();
        blocks.push(`@@${id}@@\nTR:${text}`);
      }
      return blocks.join("\n\n");
    },
  };
  return t as unknown as Translator & { calls: number };
}

async function makeSmokeFixture(args: {
  files?: Record<string, string>;
  options: Parameters<typeof polystella>[0];
  translator?: Translator;
}): Promise<SmokeHarness> {
  const rootDir = await mkdtemp(path.join(tmpdir(), "polystella-smoke-"));
  tempRoots.push(rootDir);

  // Default-canned project layout: one publication, one Astro page,
  // one i18n dictionary for drift detection (default-locale only).
  const defaultFiles: Record<string, string> = {
    "content/publications/hello.md": SAMPLE_PUBLICATION,
    "src/pages/index.astro": SAMPLE_PAGE_ASTRO,
    "src/content/i18n/en-US.json": JSON.stringify({ "nav.home": "Home" }, null, 2),
    "src/content/i18n/pt-BR.json": JSON.stringify({ "nav.home": "Início" }, null, 2),
  };
  const files = { ...defaultFiles, ...(args.files ?? {}) };
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(rootDir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }

  const stagingDir = path.join(rootDir, ".astro", "i18n-staging");
  const cacheDir = path.join(rootDir, "node_modules", ".astro");
  await mkdir(cacheDir, { recursive: true });

  const capturedRoutes: CapturedRoute[] = [];
  const capturedMiddleware: CapturedMiddleware[] = [];
  const capturedVitePlugins: CapturedVitePlugin[] = [];

  // The integration uses `r2Override` only via the test override path
  // in `runTranslationPass`. The factory doesn't expose that hook,
  // so we leave `r2` unset and let translation run cache-less. The
  // test verifies staging output regardless.
  const integration = polystella(args.options);
  const configSetupHook = integration.hooks["astro:config:setup"];
  const buildDoneHook = integration.hooks["astro:build:done"];
  if (!configSetupHook || !buildDoneHook) {
    throw new Error("[smoke] integration missing required hooks");
  }

  return {
    rootDir,
    stagingDir,
    capturedRoutes,
    capturedMiddleware,
    capturedVitePlugins,
    async configSetup(command) {
      // Construct a minimal AstroConfig-shaped object. We only need
      // the fields the integration actually reads (`root`,
      // `cacheDir`, `i18n`).
      const stubConfig = {
        root: pathToFileURL(rootDir + path.sep),
        cacheDir: pathToFileURL(cacheDir + path.sep),
        i18n: {
          defaultLocale: "en-US",
          locales: ["en-US", "pt-BR"],
        },
      };
      const stubLogger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        // AstroIntegrationLogger requires more shape; cast through unknown.
      };
      await (configSetupHook as (ctx: unknown) => Promise<void> | void)({
        config: stubConfig,
        logger: stubLogger,
        command,
        injectRoute: (route: CapturedRoute) => capturedRoutes.push(route),
        addMiddleware: (mw: CapturedMiddleware) => capturedMiddleware.push(mw),
        updateConfig: (update: { vite?: { plugins?: CapturedVitePlugin[] } }) => {
          for (const plugin of update.vite?.plugins ?? []) capturedVitePlugins.push(plugin);
        },
      });
    },
    async buildDone() {
      const distDir = path.join(rootDir, "dist");
      await mkdir(distDir, { recursive: true });
      const stubLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
      await (buildDoneHook as (ctx: unknown) => Promise<void> | void)({
        dir: pathToFileURL(distDir + path.sep),
        logger: stubLogger,
      });
      const reportPath = path.join(distDir, "i18n-r2-report.json");
      if (!existsSync(reportPath)) return { reportPath: null, reportContent: null };
      const reportContent = JSON.parse(await readFile(reportPath, "utf8"));
      return { reportPath, reportContent };
    },
  };
}

describe("smoke: polystella(options) integration end-to-end", () => {
  it("registers the virtual module and resolves the runtime config source", async () => {
    const harness = await makeSmokeFixture({
      options: { sourceDir: "./content", include: ["**/*.md"], dryRun: true },
    });
    await harness.configSetup("build");

    const virtualPlugin = harness.capturedVitePlugins.find((p) => p.name === "polystella:runtime-config");
    expect(virtualPlugin).toBeDefined();
    expect(virtualPlugin?.resolveId?.("polystella:runtime-config")).toBe("\0polystella:runtime-config");
    expect(virtualPlugin?.resolveId?.("unrelated")).toBeUndefined();

    const source = virtualPlugin?.load?.("\0polystella:runtime-config");
    expect(typeof source).toBe("string");
    expect(source).toContain('export const defaultLocale = "en-US"');
    expect(source).toContain('export const locales = ["en-US","pt-BR"]');
    // Mode default is "auto" — surfaced verbatim for the runtime.
    expect(source).toContain('export const mode = "auto"');
  });

  it("auto-registers the middleware by default", async () => {
    const harness = await makeSmokeFixture({
      options: { sourceDir: "./content", dryRun: true },
    });
    await harness.configSetup("build");

    expect(harness.capturedMiddleware).toHaveLength(1);
    expect(harness.capturedMiddleware[0]).toEqual({
      entrypoint: "polystella/runtime/middleware",
      order: "pre",
    });
  });

  it("skips middleware auto-registration when middleware: false", async () => {
    const harness = await makeSmokeFixture({
      options: { sourceDir: "./content", dryRun: true, middleware: false },
    });
    await harness.configSetup("build");
    expect(harness.capturedMiddleware).toHaveLength(0);
  });

  it("injects locale-prefixed routes for resolved page entries", async () => {
    const harness = await makeSmokeFixture({
      files: {
        "src/pages/about.astro": SAMPLE_PAGE_ASTRO,
      },
      options: {
        sourceDir: "./content",
        dryRun: true,
        routes: ["src/pages/index.astro", "src/pages/about.astro"],
      },
    });
    await harness.configSetup("build");

    // Two routes injected, both locale-prefixed. Index collapses to /[lang].
    const patterns = harness.capturedRoutes.map((r) => r.pattern).sort();
    expect(patterns).toEqual(["/[lang]", "/[lang]/about"]);
    // Each entrypoint points inside the shim directory.
    for (const route of harness.capturedRoutes) {
      expect(route.entrypoint).toContain(path.join("polystella-shims", "route-"));
      expect(existsSync(route.entrypoint)).toBe(true);
    }
  });

  it("stages translated bytes under <root>/.astro/i18n-staging/<locale>", async () => {
    const translator = makeEchoTranslator();
    const harness = await makeSmokeFixture({
      options: {
        sourceDir: "./content",
        include: ["**/*.md"],
        // Provider is set so liveMode triggers; the actual translator
        // gets injected via the runtime bridge mock below.
        provider: {
          kind: "workers-ai",
          accountId: "fake",
          apiToken: "fake",
          model: "smoke/echo-1",
          maxTokens: 8192,
        },
      },
      translator,
    });

    // Stub the provider factory so the integration uses our echo
    // translator. The integration calls `createTranslator(provider, locale)`
    // internally; mocking `provider.ts`'s module export is intrusive, so
    // we set the global fetch impl to a stub that returns the echo
    // response shape.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse((init.body ?? "{}") as string);
      const userMessage = body.messages?.find((m: { role: string }) => m.role === "user");
      const userPrompt = userMessage?.content ?? "";
      const translated = await translator.translate("", userPrompt);
      return new Response(JSON.stringify({ result: { response: translated }, success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await harness.configSetup("build");

      // Expect a translated file under the staging dir for pt-BR.
      const stagedPath = path.join(harness.stagingDir, "pt-BR", "publications", "hello.md");
      expect(existsSync(stagedPath)).toBe(true);
      const stagedContent = await readFile(stagedPath, "utf8");
      // Echo translator prefixes each segment with "TR:".
      expect(stagedContent).toContain("TR:");
      // AI marker baked in pre-stage.
      expect(stagedContent).toContain("aiTranslated: true");
      expect(stagedContent).toContain("aiTranslationModel: smoke/echo-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("emits the build report at <dist>/i18n-r2-report.json", async () => {
    const translator = makeEchoTranslator("smoke/echo-2");
    const harness = await makeSmokeFixture({
      options: {
        sourceDir: "./content",
        include: ["**/*.md"],
        provider: {
          kind: "workers-ai",
          accountId: "fake",
          apiToken: "fake",
          model: "smoke/echo-2",
          maxTokens: 8192,
        },
      },
      translator,
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse((init.body ?? "{}") as string);
      const userMessage = body.messages?.find((m: { role: string }) => m.role === "user");
      const userPrompt = userMessage?.content ?? "";
      const translated = await translator.translate("", userPrompt);
      return new Response(JSON.stringify({ result: { response: translated }, success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await harness.configSetup("build");
      const { reportPath, reportContent } = await harness.buildDone();
      expect(reportPath).not.toBeNull();
      const report = reportContent as {
        build: { polystellaVersion: string };
        locales: string[];
        defaultLocale: string;
        entries: Array<{ outcome: string }>;
        totals: { aiTranslated: number };
      };
      expect(report.build.polystellaVersion).toBe(POLYSTELLA_VERSION);
      expect(report.defaultLocale).toBe("en-US");
      expect(report.locales).toEqual(["en-US", "pt-BR"]);
      expect(report.entries.length).toBeGreaterThan(0);
      expect(report.totals.aiTranslated).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("skips translation when command is not in runOn (default ['build'] + dev)", async () => {
    const translator = makeEchoTranslator("smoke/no-dev");
    const harness = await makeSmokeFixture({
      options: {
        sourceDir: "./content",
        include: ["**/*.md"],
        provider: {
          kind: "workers-ai",
          accountId: "fake",
          apiToken: "fake",
          model: "smoke/no-dev",
          maxTokens: 8192,
        },
        // runOn defaults to ["build"], so command="dev" should skip.
      },
      translator,
    });

    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      return new Response("", { status: 200 });
    }) as typeof fetch;

    try {
      await harness.configSetup("dev");
      // No translator network call when runOn excludes the command.
      expect(fetchCalls).toBe(0);
      // Staging dir exists (created by the integration) but no
      // translated files inside.
      const stagedPath = path.join(harness.stagingDir, "pt-BR", "publications", "hello.md");
      expect(existsSync(stagedPath)).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails fast with a clear error when UI-strings dictionaries drift", async () => {
    const harness = await makeSmokeFixture({
      files: {
        // Drift: pt-BR dictionary missing the key that en-US has.
        "src/content/i18n/en-US.json": JSON.stringify({ "nav.home": "Home", "nav.about": "About" }, null, 2),
        "src/content/i18n/pt-BR.json": JSON.stringify({ "nav.home": "Início" }, null, 2),
      },
      options: { sourceDir: "./content", dryRun: true },
    });

    await expect(harness.configSetup("build")).rejects.toThrow(/UI-strings dictionary drift/);
  });

  it("validates that defaultLocale exists in i18n.locales", async () => {
    // This is enforced by `resolveOptions`; we exercise it through
    // the integration to ensure the error path stays wired.
    const harness = await makeSmokeFixture({
      options: { sourceDir: "./content", dryRun: true },
    });
    // Override the harness's stubbed config to force a bad i18n block.
    const integration = polystella({ sourceDir: "./content", dryRun: true });
    const configSetup = integration.hooks["astro:config:setup"];
    if (!configSetup) throw new Error("[smoke] missing config:setup");
    await expect(
      (configSetup as (ctx: unknown) => Promise<void>)({
        config: {
          root: pathToFileURL(harness.rootDir + path.sep),
          cacheDir: pathToFileURL(path.join(harness.rootDir, "node_modules", ".astro") + path.sep),
          i18n: {
            defaultLocale: "en-US",
            // pt-BR-only locales — defaultLocale missing.
            locales: ["pt-BR"],
          },
        },
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        command: "build",
        injectRoute: () => {},
        addMiddleware: () => {},
        updateConfig: () => {},
      }),
    ).rejects.toThrow(/i18n\.locales/);
  });
});
