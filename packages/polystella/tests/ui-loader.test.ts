import { describe, expect, it, vi } from "vitest";
import {
  buildI18nLoader,
  DEFAULT_I18N_BASE,
  DEFAULT_I18N_PATTERN,
  i18nSchema,
} from "../src/ui/loader.js";

/**
 * Tests for the dependency-injected loader factory and the i18n
 * schema. The wrapper at `src/ui/index.ts` imports Astro's real
 * `glob`; tests pass a stub so we can assert on the `(base, pattern)`
 * pair without needing `astro/loaders` resolved.
 */

describe("buildI18nLoader", () => {
  it("calls glob with the default base and pattern when no options are passed", () => {
    const glob = vi.fn(() => ({ name: "glob-loader" }));
    const result = buildI18nLoader({ glob });
    expect(glob).toHaveBeenCalledTimes(1);
    expect(glob).toHaveBeenCalledWith({
      base: DEFAULT_I18N_BASE,
      pattern: DEFAULT_I18N_PATTERN,
    });
    expect(result).toEqual({ name: "glob-loader" });
  });

  it("propagates a custom base", () => {
    const glob = vi.fn();
    buildI18nLoader({ glob }, { base: "./content/translations" });
    expect(glob).toHaveBeenCalledWith({
      base: "./content/translations",
      pattern: DEFAULT_I18N_PATTERN,
    });
  });

  it("propagates a custom pattern", () => {
    const glob = vi.fn();
    buildI18nLoader({ glob }, { pattern: "*.json" });
    expect(glob).toHaveBeenCalledWith({
      base: DEFAULT_I18N_BASE,
      pattern: "*.json",
    });
  });

  it("propagates both custom base and pattern", () => {
    const glob = vi.fn();
    buildI18nLoader({ glob }, { base: "./i18n", pattern: "ui/*.json" });
    expect(glob).toHaveBeenCalledWith({
      base: "./i18n",
      pattern: "ui/*.json",
    });
  });

  it("returns whatever the glob factory returns (opaque type)", () => {
    const sentinel = { __sentinel: true };
    const glob = vi.fn(() => sentinel);
    expect(buildI18nLoader({ glob })).toBe(sentinel);
  });
});

describe("i18nSchema", () => {
  it("accepts a flat record of string→string", () => {
    const schema = i18nSchema();
    const result = schema.safeParse({
      "nav.home": "Home",
      "nav.research": "Research",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty record", () => {
    const schema = i18nSchema();
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("accepts blank string values (some labels are intentionally empty)", () => {
    const schema = i18nSchema();
    const result = schema.safeParse({ "spacer.label": "" });
    expect(result.success).toBe(true);
  });

  it("rejects empty keys", () => {
    // An empty key would make `t("")` legal but practically useless;
    // rejecting at schema time prevents that footgun.
    const schema = i18nSchema();
    const result = schema.safeParse({ "": "value" });
    expect(result.success).toBe(false);
  });

  it("rejects non-string values", () => {
    const schema = i18nSchema();
    expect(schema.safeParse({ "nav.home": 42 }).success).toBe(false);
    expect(schema.safeParse({ "nav.home": null }).success).toBe(false);
    expect(schema.safeParse({ "nav.home": ["a", "b"] }).success).toBe(false);
  });

  it("rejects nested objects (flat dictionary contract)", () => {
    const schema = i18nSchema();
    const result = schema.safeParse({
      nav: { home: "Home" },
    });
    expect(result.success).toBe(false);
  });

  it("returns a fresh schema instance per call (no shared mutable state)", () => {
    const a = i18nSchema();
    const b = i18nSchema();
    expect(a).not.toBe(b);
  });
});
