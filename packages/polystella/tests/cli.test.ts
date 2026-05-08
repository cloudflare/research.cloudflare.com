import { describe, expect, it } from "vitest";

import { applyCliOverrides, parseCliArgs, resolveCliBranch } from "../src/cli.js";
import { resolveOptions } from "../src/config/options.js";

/**
 * CLI surface tests.
 *
 * The CLI's contract has two failure modes worth pinning:
 *   1. Flag parsing — typos and missing values must throw, not be
 *      silently dropped.
 *   2. Override application — `--branch`, `--prefix`, `--locale`, and
 *      `--file` each have a single, documented effect on the
 *      resolved options. Any drift from that contract changes the
 *      operator-facing behaviour.
 *
 * The actual orchestration (running translations) is covered by
 * `run.test.ts`; this file focuses on argv → resolved-options.
 */

function makeResolved(
  overrides: {
    withR2?: boolean;
    locales?: string[];
  } = {},
) {
  return resolveOptions(
    overrides.withR2
      ? {
          r2: {
            accountId: "acct",
            bucket: "test-bucket",
            accessKeyId: "ak",
            secretAccessKey: "sk",
          },
        }
      : {},
    {
      defaultLocale: "en-US",
      locales: ["en-US", ...(overrides.locales ?? ["pt-BR", "ja-JP"])],
    },
  );
}

describe("parseCliArgs — happy paths", () => {
  it("parses an empty argv to defaults", () => {
    expect(parseCliArgs([])).toEqual({ dryRun: false, help: false });
  });

  it("parses --dry-run as a boolean toggle", () => {
    const args = parseCliArgs(["--dry-run"]);
    expect(args.dryRun).toBe(true);
  });

  it("parses --branch <name>", () => {
    const args = parseCliArgs(["--branch", "my-feature"]);
    expect(args.branch).toBe("my-feature");
  });

  it("parses --prefix <prefix>", () => {
    const args = parseCliArgs(["--prefix", "previews/feat/i18n/"]);
    expect(args.prefix).toBe("previews/feat/i18n/");
  });

  it("parses --locale <code>", () => {
    expect(parseCliArgs(["--locale", "pt-BR"]).locale).toBe("pt-BR");
  });

  it("parses --file <glob>", () => {
    expect(parseCliArgs(["--file", "publications/foo.md"]).file).toBe("publications/foo.md");
  });

  it("parses --report <path>", () => {
    expect(parseCliArgs(["--report", "./tmp/report.json"]).reportPath).toBe("./tmp/report.json");
  });

  it("parses --help (and -h) as a help request", () => {
    expect(parseCliArgs(["--help"]).help).toBe(true);
    expect(parseCliArgs(["-h"]).help).toBe(true);
  });

  it("silently drops a bare `--` separator (pnpm/npm forwarding compat)", () => {
    // `pnpm translate -- --branch x` injects a literal `--` token
    // before the user's flags. Treating it as an unknown flag would
    // break the conventional invocation form, so the parser drops
    // it. The CLI takes no positional args, so this is unambiguous.
    expect(parseCliArgs(["--", "--branch", "main"])).toEqual({
      dryRun: false,
      help: false,
      branch: "main",
    });
  });

  it("parses multiple flags in any order", () => {
    const args = parseCliArgs(["--dry-run", "--branch", "main", "--locale", "ja-JP", "--file", "**/*.md"]);
    expect(args).toEqual({
      dryRun: true,
      help: false,
      branch: "main",
      locale: "ja-JP",
      file: "**/*.md",
    });
  });
});

describe("parseCliArgs — failure modes", () => {
  it("throws on an unknown flag", () => {
    expect(() => parseCliArgs(["--unknown"])).toThrowError(/Unknown flag: --unknown/);
  });

  it("throws when --branch is followed by another flag (missing value)", () => {
    // The next argv is another flag, so we treat it as missing
    // rather than silently consuming it.
    expect(() => parseCliArgs(["--branch", "--dry-run"])).toThrowError(/--branch requires a value/);
  });

  it("throws when --branch is the final argv (off-end)", () => {
    expect(() => parseCliArgs(["--branch"])).toThrowError(/--branch requires a value/);
  });

  it("throws when --prefix is missing a value", () => {
    expect(() => parseCliArgs(["--prefix"])).toThrowError(/--prefix requires a value/);
  });

  it("throws when --locale is missing a value", () => {
    expect(() => parseCliArgs(["--locale"])).toThrowError(/--locale requires a value/);
  });

  it("throws when --file is missing a value", () => {
    expect(() => parseCliArgs(["--file"])).toThrowError(/--file requires a value/);
  });
});

describe("applyCliOverrides — single-flag effects", () => {
  it("--dry-run flips resolved.dryRun to true", () => {
    const resolved = makeResolved();
    expect(resolved.dryRun).toBe(false);
    const next = applyCliOverrides(resolved, { dryRun: true, help: false });
    expect(next.dryRun).toBe(true);
  });

  it("--locale narrows resolved.locales to a single declared locale", () => {
    const resolved = makeResolved();
    const next = applyCliOverrides(resolved, {
      dryRun: false,
      help: false,
      locale: "pt-BR",
    });
    expect(next.locales).toEqual(["pt-BR"]);
  });

  it("--locale errors when the locale isn't declared in Astro's i18n", () => {
    const resolved = makeResolved();
    expect(() =>
      applyCliOverrides(resolved, {
        dryRun: false,
        help: false,
        locale: "zh-CN",
      }),
    ).toThrowError(/--locale zh-CN not declared/);
  });

  it("--file replaces resolved.include with a single-element array", () => {
    const resolved = makeResolved();
    const next = applyCliOverrides(resolved, {
      dryRun: false,
      help: false,
      file: "publications/foo.md",
    });
    expect(next.include).toEqual(["publications/foo.md"]);
  });

  it("--prefix overrides resolved.r2.prefix when r2 is configured", () => {
    const resolved = makeResolved({ withR2: true });
    expect(resolved.r2!.prefix).toBe("i18n/");
    const next = applyCliOverrides(resolved, {
      dryRun: false,
      help: false,
      prefix: "previews/feat-x/i18n/",
    });
    expect(next.r2!.prefix).toBe("previews/feat-x/i18n/");
  });

  it("--prefix errors when r2 is not configured (operator typo guard)", () => {
    const resolved = makeResolved({ withR2: false });
    expect(() =>
      applyCliOverrides(resolved, {
        dryRun: false,
        help: false,
        prefix: "previews/feat-x/i18n/",
      }),
    ).toThrowError(/--prefix requires `r2` to be configured/);
  });

  it("--prefix errors when value doesn't end with `/`", () => {
    const resolved = makeResolved({ withR2: true });
    expect(() =>
      applyCliOverrides(resolved, {
        dryRun: false,
        help: false,
        prefix: "previews/feat-x/i18n",
      }),
    ).toThrowError(/--prefix must end with "\/"/);
  });
});

describe("applyCliOverrides — composition", () => {
  it("--locale + --file + --prefix compose without conflict", () => {
    const resolved = makeResolved({ withR2: true });
    const next = applyCliOverrides(resolved, {
      dryRun: true,
      help: false,
      locale: "ja-JP",
      file: "publications/foo.md",
      prefix: "previews/feat/i18n/",
    });
    expect(next.dryRun).toBe(true);
    expect(next.locales).toEqual(["ja-JP"]);
    expect(next.include).toEqual(["publications/foo.md"]);
    expect(next.r2!.prefix).toBe("previews/feat/i18n/");
  });

  it("--prefix wins over a branch-driven prefix already in resolved.r2 (post-config-load override)", () => {
    // The `--branch` flag sets WORKERS_CI_BRANCH BEFORE config load
    // and therefore takes effect via polystella.config.mjs's
    // branch-dispatch logic. By the time `applyCliOverrides` runs,
    // that dispatch has already produced a prefix. `--prefix`
    // overrides that final value.
    //
    // Simulate what the config dispatch would have produced:
    const resolved = makeResolved({ withR2: true });
    const branchDriven = {
      ...resolved,
      r2: { ...resolved.r2!, prefix: "previews/branch-from-env/i18n/" },
    };
    const next = applyCliOverrides(branchDriven, {
      dryRun: false,
      help: false,
      prefix: "manual-override/i18n/",
    });
    expect(next.r2!.prefix).toBe("manual-override/i18n/");
  });

  it("does not mutate the input resolved object (immutability contract)", () => {
    const resolved = makeResolved({ withR2: true });
    const before = JSON.stringify(resolved);
    applyCliOverrides(resolved, {
      dryRun: true,
      help: false,
      locale: "pt-BR",
      file: "x.md",
      prefix: "y/",
    });
    const after = JSON.stringify(resolved);
    // Same reference, same contents — `applyCliOverrides` returns a
    // new object instead of mutating in place.
    expect(after).toBe(before);
  });
});

describe("resolveCliBranch — precedence", () => {
  // The CLI resolves the target branch via three-way precedence:
  //   --branch flag > WORKERS_CI_BRANCH env > git rev-parse HEAD.
  // These tests pin the precedence and the failure mode (no git)
  // because misordering would silently flip a developer's
  // `pnpm translate` from "writes to my branch" to "writes to main",
  // which is the entire bug the local/CI/CLI dispatch was added to
  // prevent.

  it("--branch flag wins over everything else", () => {
    const result = resolveCliBranch({
      flag: "explicit-flag",
      envBranch: "from-env",
      gitBranchProvider: () => "from-git",
    });
    expect(result).toEqual({
      ok: true,
      branch: "explicit-flag",
      source: "flag",
    });
  });

  it("WORKERS_CI_BRANCH env wins when no flag is supplied", () => {
    const result = resolveCliBranch({
      flag: undefined,
      envBranch: "from-env",
      gitBranchProvider: () => "from-git",
    });
    expect(result).toEqual({ ok: true, branch: "from-env", source: "env" });
  });

  it("git fallback fires only when neither flag nor env is set", () => {
    const result = resolveCliBranch({
      flag: undefined,
      envBranch: undefined,
      gitBranchProvider: () => "current-checkout",
    });
    expect(result).toEqual({
      ok: true,
      branch: "current-checkout",
      source: "git",
    });
  });

  it("treats an empty-string env var as unset (Workers Builds occasionally exports an empty value)", () => {
    // Empty WORKERS_CI_BRANCH with a working git fallback should
    // still resolve via git — not silently target main with an
    // empty prefix segment.
    const result = resolveCliBranch({
      flag: undefined,
      envBranch: "",
      gitBranchProvider: () => "from-git",
    });
    expect(result).toEqual({ ok: true, branch: "from-git", source: "git" });
  });

  it("returns ok:false with a remediation hint when git also fails (detached HEAD / no .git)", () => {
    const result = resolveCliBranch({
      flag: undefined,
      envBranch: undefined,
      gitBranchProvider: () => null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The error message must mention `--branch` so the operator
      // knows how to unstick themselves.
      expect(result.reason).toMatch(/--branch <name>/);
    }
  });

  it("calls the git provider only when needed (lazy evaluation contract)", () => {
    // The git provider may shell out, so we don't want it called
    // when a flag or env value already wins the precedence race.
    let providerCalled = 0;
    const provider = () => {
      providerCalled++;
      return "from-git";
    };

    resolveCliBranch({
      flag: "x",
      envBranch: undefined,
      gitBranchProvider: provider,
    });
    expect(providerCalled).toBe(0);

    resolveCliBranch({
      flag: undefined,
      envBranch: "y",
      gitBranchProvider: provider,
    });
    expect(providerCalled).toBe(0);

    resolveCliBranch({
      flag: undefined,
      envBranch: undefined,
      gitBranchProvider: provider,
    });
    expect(providerCalled).toBe(1);
  });
});
