import { describe, expect, it } from "vitest";

import { resolveOptions, type AstroI18nLike } from "../src/config/options.js";

/**
 * Contract tests for the locale derivation introduced when PolyStella
 * stopped owning `defaultLocale`/`locales` and started reading them
 * from Astro's `config.i18n` instead.
 *
 * The split between "PolyStella options" (zod-validated) and "locale
 * fields" (derived) means `resolveOptions` has two distinct failure
 * surfaces and we want both pinned: a missing/malformed `i18n` block
 * must produce a copy-pasteable error, and a happy `i18n` block must
 * yield the canonical `(defaultLocale, locales)` shape every other
 * substep consumes via `resolved`.
 */

const MINIMAL_USER_OPTS = {} as const;

const HAPPY_I18N: AstroI18nLike = {
  defaultLocale: "en-US",
  locales: ["en-US", "pt-BR", "ja-JP"],
  routing: { prefixDefaultLocale: false },
};

describe("resolveOptions — locale derivation from Astro's i18n config", () => {
  it("derives defaultLocale and target locales (default filtered out) from a happy i18n block", () => {
    const resolved = resolveOptions(MINIMAL_USER_OPTS, HAPPY_I18N);
    expect(resolved.defaultLocale).toBe("en-US");
    expect(resolved.locales).toEqual(["pt-BR", "ja-JP"]);
  });

  it("preserves the order of i18n.locales when filtering out the default", () => {
    const resolved = resolveOptions(MINIMAL_USER_OPTS, {
      defaultLocale: "en-US",
      locales: ["pt-BR", "en-US", "ja-JP"],
    });
    // Order from i18n.locales matters: it's the order Astro's router
    // and our staging writer iterate in, so a stable derivation keeps
    // build logs and prune behaviour deterministic across runs.
    expect(resolved.locales).toEqual(["pt-BR", "ja-JP"]);
  });

  it("merges the rest of the user-supplied options through unchanged", () => {
    const resolved = resolveOptions({ sourceDir: "./custom-content", overridesDir: "./custom-overrides" }, HAPPY_I18N);
    expect(resolved.sourceDir).toBe("./custom-content");
    expect(resolved.overridesDir).toBe("./custom-overrides");
    // Sanity: derivation didn't clobber the rest of the resolved shape.
    expect(resolved.defaultLocale).toBe("en-US");
    expect(resolved.locales).toEqual(["pt-BR", "ja-JP"]);
  });
});

describe("resolveOptions — Astro i18n cross-check failures", () => {
  it("throws with a copy-pasteable starter block when config.i18n is missing", () => {
    expect(() => resolveOptions(MINIMAL_USER_OPTS, undefined)).toThrowError(
      // We deliberately assert on the recognisable shape of the starter
      // block — that's the operator-facing contract this milestone
      // promises. If the wording ever drifts, this test should drift
      // with it (and a human reviewer should sanity-check the change).
      /i18n: \{[\s\S]+defaultLocale: "en-US"[\s\S]+locales: \[/,
    );
  });

  it("throws when defaultLocale is missing from i18n.locales", () => {
    expect(() =>
      resolveOptions(MINIMAL_USER_OPTS, {
        defaultLocale: "en-US",
        locales: ["pt-BR", "ja-JP"],
      }),
    ).toThrowError(/i18n\.locales` must include `defaultLocale`/);
  });

  it("throws when i18n.locales contains object-form entries", () => {
    expect(() =>
      resolveOptions(MINIMAL_USER_OPTS, {
        defaultLocale: "en-US",
        locales: ["en-US", { path: "pt", codes: ["pt-BR", "pt-PT"] }],
      } as AstroI18nLike),
    ).toThrowError(/object-form entries.*only supports plain string locales/);
  });

  it('rejects routing: "manual"', () => {
    expect(() =>
      resolveOptions(MINIMAL_USER_OPTS, {
        ...HAPPY_I18N,
        routing: "manual",
      }),
    ).toThrowError(/routing: "manual"` is not supported/);
  });

  it("throws when i18n.locales is empty", () => {
    expect(() =>
      resolveOptions(MINIMAL_USER_OPTS, {
        defaultLocale: "en-US",
        locales: [],
      }),
    ).toThrowError(/`i18n\.locales` is required/);
  });

  it("throws when i18n.locales contains duplicates", () => {
    expect(() =>
      resolveOptions(MINIMAL_USER_OPTS, {
        defaultLocale: "en-US",
        locales: ["en-US", "pt-BR", "pt-BR"],
      }),
    ).toThrowError(/contains duplicates: pt-BR/);
  });

  it("aggregates user-options and i18n issues into a single error", () => {
    // `concurrency: 0` violates the schema (positive int required) and
    // the i18n block is missing — both should appear in the same
    // throw, so the operator fixes everything in one pass instead of
    // playing whack-a-mole.
    let caught: Error | undefined;
    try {
      resolveOptions({ concurrency: 0 }, undefined);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/Invalid PolyStella options/);
    expect(caught!.message).toMatch(/Invalid Astro `i18n` config/);
  });
});

describe("resolveOptions — option-surface", () => {
  it('rejects mode: "starlight"', () => {
    expect(() => resolveOptions({ mode: "starlight" }, HAPPY_I18N)).toThrowError(/mode: "starlight" is not yet supported/);
  });

  it('accepts mode: "auto" (the default)', () => {
    const resolved = resolveOptions({ mode: "auto" }, HAPPY_I18N);
    expect(resolved.mode).toBe("auto");
  });

  it('accepts mode: "standalone"', () => {
    const resolved = resolveOptions({ mode: "standalone" }, HAPPY_I18N);
    expect(resolved.mode).toBe("standalone");
  });

  it("rejects the removed `failOnMissingCredentials` option (strict schema)", () => {
    // The schema is strict, so passing the removed option name
    // surfaces the deprecation as a parse error rather than silently
    // ignoring it. Operators upgrading from a draft that had the
    // option get a clear "this is gone" signal.
    expect(() => resolveOptions({ failOnMissingCredentials: true } as Record<string, unknown>, HAPPY_I18N)).toThrowError(
      /failOnMissingCredentials/,
    );
  });

  it("defaults `concurrency` to 4", () => {
    const resolved = resolveOptions({}, HAPPY_I18N);
    expect(resolved.concurrency).toBe(4);
  });

  it("defaults `fallback` to default-locale", () => {
    const resolved = resolveOptions({}, HAPPY_I18N);
    expect(resolved.fallback).toBe("default-locale");
  });

  it("defaults `noTranslateBehavior` to fallback", () => {
    const resolved = resolveOptions({}, HAPPY_I18N);
    expect(resolved.noTranslateBehavior).toBe("fallback");
  });
});

describe("resolveOptions — routes normalisation", () => {
  // The `routes` field accepts either bare strings (`"src/pages/x.astro"`)
  // or full objects (`{ source, imports }`) so the user can opt into
  // per-route shim CSS imports incrementally. The schema normalises
  // both shapes to the object form so the integration's shim-creation
  // loop has one shape to consume.

  it("normalises bare-string entries to { source, imports: [] }", () => {
    const resolved = resolveOptions({ routes: ["src/pages/index.astro", "src/pages/[slug].astro"] }, HAPPY_I18N);
    expect(resolved.routes).toEqual([
      { source: "src/pages/index.astro", imports: [] },
      { source: "src/pages/[slug].astro", imports: [] },
    ]);
  });

  it("preserves object-form entries with imports", () => {
    const resolved = resolveOptions(
      {
        routes: [
          {
            source: "src/pages/[slug].astro",
            imports: ["./src/styles/global.css"],
          },
        ],
      },
      HAPPY_I18N,
    );
    expect(resolved.routes).toEqual([
      {
        source: "src/pages/[slug].astro",
        imports: ["./src/styles/global.css"],
      },
    ]);
  });

  it("treats object-form entries without `imports` as having an empty list", () => {
    const resolved = resolveOptions({ routes: [{ source: "src/pages/about.astro" }] }, HAPPY_I18N);
    expect(resolved.routes).toEqual([{ source: "src/pages/about.astro", imports: [] }]);
  });

  it("supports mixed bare-string + object-form in the same array", () => {
    const resolved = resolveOptions(
      {
        routes: [
          "src/pages/index.astro",
          {
            source: "src/pages/[slug].astro",
            imports: ["./src/styles/global.css"],
          },
        ],
      },
      HAPPY_I18N,
    );
    expect(resolved.routes).toEqual([
      { source: "src/pages/index.astro", imports: [] },
      {
        source: "src/pages/[slug].astro",
        imports: ["./src/styles/global.css"],
      },
    ]);
  });

  it("rejects object-form entries with unknown keys (strict schema)", () => {
    // zod's union surfaces a generic `Invalid input` for the route
    // entry when neither the bare-string nor the strict-object
    // variant matches. The exact wording isn't load-bearing — what
    // matters is that the operator gets a configuration error
    // pointed at `routes.0` rather than silent acceptance of a
    // typo'd field name.
    expect(() =>
      resolveOptions(
        {
          routes: [
            {
              source: "src/pages/x.astro",
              importz: ["./typo.css"], // typo of `imports`
            },
          ],
        } as Record<string, unknown>,
        HAPPY_I18N,
      ),
    ).toThrowError(/routes\.0/);
  });

  it("defaults `routesImports` to an empty array", () => {
    const resolved = resolveOptions({}, HAPPY_I18N);
    expect(resolved.routesImports).toEqual([]);
  });

  it("accepts a `routesImports` list", () => {
    const resolved = resolveOptions(
      {
        routesImports: ["./src/styles/global.css"],
      },
      HAPPY_I18N,
    );
    expect(resolved.routesImports).toEqual(["./src/styles/global.css"]);
  });
});

describe("resolveOptions — per-format keys/urls", () => {
  // The redesigned per-format blocks: every format has a `keys` map
  // (translatable scalars) and a `urls` map (URL fields to rewrite).
  // The cross-check rejects a path listed in BOTH maps for the same
  // glob — translation + URL rewriting on the same field is never
  // intentional.

  it("accepts well-formed markdown / toml blocks with disjoint keys and urls", () => {
    const resolved = resolveOptions(
      {
        markdown: {
          keys: { "publications/**": ["title", "metaDescription"] },
          urls: { "publications/**": ["heroImage"] },
        },
        toml: {
          keys: { "site.toml": ["main.featuredResearch.title"] },
          urls: { "site.toml": ["main.featuredResearch.link"] },
        },
      },
      HAPPY_I18N,
    );
    expect(resolved.markdown.keys["publications/**"]).toEqual(["title", "metaDescription"]);
    expect(resolved.markdown.urls["publications/**"]).toEqual(["heroImage"]);
    expect(resolved.toml.urls["site.toml"]).toEqual(["main.featuredResearch.link"]);
  });

  it("defaults markdown / toml blocks to empty maps when omitted", () => {
    const resolved = resolveOptions({}, HAPPY_I18N);
    expect(resolved.markdown.keys).toEqual({});
    expect(resolved.markdown.urls).toEqual({});
    expect(resolved.toml.keys).toEqual({});
    expect(resolved.toml.urls).toEqual({});
  });

  it("rejects a path listed in both keys and urls for the same markdown glob", () => {
    expect(() =>
      resolveOptions(
        {
          markdown: {
            keys: { "publications/**": ["heroImage"] },
            urls: { "publications/**": ["heroImage"] },
          },
        },
        HAPPY_I18N,
      ),
    ).toThrowError(/markdown.*publications\/\*\*.*heroImage.*both/i);
  });

  it("rejects a path listed in both keys and urls for the same toml glob", () => {
    expect(() =>
      resolveOptions(
        {
          toml: {
            keys: { "site.toml": ["main.featuredResearch.link"] },
            urls: { "site.toml": ["main.featuredResearch.link"] },
          },
        },
        HAPPY_I18N,
      ),
    ).toThrowError(/toml.*site\.toml.*main\.featuredResearch\.link.*both/i);
  });

  it("does NOT reject the same path in keys for one glob and urls for another", () => {
    // Cross-glob overlap is fine — each glob is its own contract.
    expect(() =>
      resolveOptions(
        {
          markdown: {
            keys: { "publications/**": ["title"] },
            urls: { "people/**": ["title"] },
          },
        },
        HAPPY_I18N,
      ),
    ).not.toThrow();
  });

  it("rejects unknown fields inside the markdown block (strict)", () => {
    // The block is `.strict()` — typo'd field names surface as errors.
    expect(() =>
      resolveOptions(
        {
          markdown: { keys: {}, urls: {}, frontmatter: {} } as Record<string, unknown>,
        },
        HAPPY_I18N,
      ),
    ).toThrowError();
  });
});

describe("resolveOptions — noPrefixUrls", () => {
  it("defaults to an empty array", () => {
    const resolved = resolveOptions({}, HAPPY_I18N);
    expect(resolved.noPrefixUrls).toEqual([]);
  });

  it("accepts a list of glob strings", () => {
    const resolved = resolveOptions({ noPrefixUrls: ["/api-docs", "/api-docs/**", "/legal/*"] }, HAPPY_I18N);
    expect(resolved.noPrefixUrls).toEqual(["/api-docs", "/api-docs/**", "/legal/*"]);
  });
});

describe("resolveOptions — middleware flag", () => {
  it("defaults to true (middleware auto-registered)", () => {
    const resolved = resolveOptions({}, HAPPY_I18N);
    expect(resolved.middleware).toBe(true);
  });

  it("accepts explicit true", () => {
    const resolved = resolveOptions({ middleware: true }, HAPPY_I18N);
    expect(resolved.middleware).toBe(true);
  });

  it("accepts explicit false (consumer wants manual composition)", () => {
    const resolved = resolveOptions({ middleware: false }, HAPPY_I18N);
    expect(resolved.middleware).toBe(false);
  });
});
