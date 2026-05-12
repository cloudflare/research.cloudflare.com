import { afterEach, describe, expect, it } from "vitest";

import type { AdapterApplyOptions, AdapterExtractOptions, FileTypeAdapter } from "../src/parsing/adapter.js";
import { jsonAdapter } from "../src/parsing/adapters/json.js";
import { markdownAdapter } from "../src/parsing/adapters/markdown.js";
import { tomlAdapter } from "../src/parsing/adapters/toml.js";
import { yamlAdapter } from "../src/parsing/adapters/yaml.js";
import { getAdapter, listRegisteredExtensions, registerAdapter, resetRegistry } from "../src/parsing/registry.js";
import type { Segment } from "../src/parsing/extract.js";

/**
 * Registry tests pin three contracts:
 *   1. Built-in markdown adapter is registered automatically at import time.
 *   2. Lookup is case-insensitive on the extension; misses return undefined.
 *   3. First-registered wins on extension collisions; later registrations no-op.
 *
 * The registry's module-scoped state means tests that reset it MUST
 * re-register the built-ins before yielding back to other suites.
 * `afterEach(...)` handles that here.
 */

function reseedBuiltins(): void {
  resetRegistry();
  registerAdapter(markdownAdapter);
  registerAdapter(tomlAdapter);
  registerAdapter(jsonAdapter);
  registerAdapter(yamlAdapter);
}

afterEach(() => {
  reseedBuiltins();
});

/**
 * Minimal stub adapter for collision / dispatch tests. The methods
 * are intentionally tagged with the adapter's identity so `getAdapter`
 * can be observed to return the correct one.
 */
function makeStubAdapter(label: string, exts: readonly string[]): FileTypeAdapter<{ tag: string }> {
  return {
    extensions: exts,
    parse(): { tag: string } {
      return { tag: label };
    },
    extractSegments(_p: { tag: string }, _src: string, _opts: AdapterExtractOptions): Segment[] {
      return [];
    },
    applyTranslations(_p: { tag: string }, src: string, _t: Map<string, string>, _opts: AdapterApplyOptions): string {
      return src;
    },
    selectedValuesForHash(): Record<string, unknown> {
      return {};
    },
    peekNoTranslate(): boolean {
      return false;
    },
  };
}

describe("registry — built-ins", () => {
  it("registers markdown automatically for .md and .mdx", () => {
    expect(getAdapter(".md")).toBe(markdownAdapter);
    expect(getAdapter(".mdx")).toBe(markdownAdapter);
  });

  it("registers TOML automatically for .toml", () => {
    expect(getAdapter(".toml")).toBe(tomlAdapter);
  });

  it("registers JSON automatically for .json", () => {
    expect(getAdapter(".json")).toBe(jsonAdapter);
  });

  it("registers YAML automatically for .yaml and .yml", () => {
    expect(getAdapter(".yaml")).toBe(yamlAdapter);
    expect(getAdapter(".yml")).toBe(yamlAdapter);
  });

  it("listRegisteredExtensions returns built-in extensions sorted", () => {
    expect(listRegisteredExtensions()).toEqual([".json", ".md", ".mdx", ".toml", ".yaml", ".yml"]);
  });
});

describe("registry — dispatch", () => {
  it("returns undefined for unknown extensions", () => {
    expect(getAdapter(".html")).toBeUndefined();
    expect(getAdapter(".csv")).toBeUndefined();
    expect(getAdapter(".xml")).toBeUndefined();
  });

  it("normalises extension lookup to lowercase", () => {
    // Source paths can carry mixed-case extensions (`README.MD`,
    // `Site.TOML`); the dispatcher lowercases before lookup so the
    // adapter table only stores canonical lowercase keys.
    expect(getAdapter(".MD")).toBe(markdownAdapter);
    expect(getAdapter(".MdX")).toBe(markdownAdapter);
  });
});

describe("registry — first-registered wins", () => {
  it("ignores subsequent registrations for an already-claimed extension", () => {
    const intruder = makeStubAdapter("intruder", [".md"]);
    registerAdapter(intruder);

    // Markdown still owns `.md` — the intruder is silently ignored,
    // not promoted, not warned. (Production callers register exactly
    // one adapter per extension; collisions only matter in tests.)
    expect(getAdapter(".md")).toBe(markdownAdapter);
  });

  it("registers the new adapter for fresh extensions even when others collide", () => {
    // An adapter that claims both `.md` (already taken) and `.foo`
    // (fresh) should still own `.foo`. Per-extension claims are
    // independent.
    const mixed = makeStubAdapter("mixed", [".md", ".foo"]);
    registerAdapter(mixed);

    expect(getAdapter(".md")).toBe(markdownAdapter);
    expect(getAdapter(".foo")).toBe(mixed);
  });
});

describe("registry — reset", () => {
  it("resetRegistry clears all registrations", () => {
    resetRegistry();

    expect(getAdapter(".md")).toBeUndefined();
    expect(listRegisteredExtensions()).toEqual([]);
  });

  it("supports clean re-registration after reset", () => {
    resetRegistry();
    const fresh = makeStubAdapter("fresh", [".bar"]);
    registerAdapter(fresh);

    expect(getAdapter(".bar")).toBe(fresh);
    expect(listRegisteredExtensions()).toEqual([".bar"]);
  });
});

describe("markdownAdapter — interface conformance", () => {
  it("declares .md and .mdx as its extensions", () => {
    expect(markdownAdapter.extensions).toEqual([".md", ".mdx"]);
  });

  it("parses + extracts segments preserving the body:N grammar", () => {
    const source = "# Title\n\nBody paragraph.\n";
    const parsed = markdownAdapter.parse(source);
    const segs = markdownAdapter.extractSegments(parsed, source, {
      sourcePath: "x.md",
      translatableKeys: {},
    });
    expect(segs).toEqual([
      { id: "body:0", text: "Title" },
      { id: "body:1", text: "Body paragraph." },
    ]);
  });

  it("applies translations and re-injects topLevelAdditions as frontmatter", () => {
    const source = "# Title\n\nBody.\n";
    const parsed = markdownAdapter.parse(source);
    const out = markdownAdapter.applyTranslations(parsed, source, new Map([["body:0", "Título"]]), {
      topLevelAdditions: { aiTranslated: true },
    });
    expect(out).toContain("aiTranslated: true");
    expect(out).toContain("Título");
  });

  it("peekNoTranslate honours noTranslate: true frontmatter", () => {
    const yes = markdownAdapter.parse("---\nnoTranslate: true\n---\n\nBody.\n");
    const no = markdownAdapter.parse("---\ntitle: Hello\n---\n\nBody.\n");
    expect(markdownAdapter.peekNoTranslate(yes)).toBe(true);
    expect(markdownAdapter.peekNoTranslate(no)).toBe(false);
  });

  it("selectedValuesForHash threads translatableKeys through to the underlying selector", () => {
    const parsed = markdownAdapter.parse("---\ntitle: Hello\nyear: 2025\n---\n\nBody.\n");
    const values = markdownAdapter.selectedValuesForHash(parsed, "irrelevant", {
      sourcePath: "publications/sample.md",
      translatableKeys: { "publications/**": ["title"] },
    });
    // Only `title` is configured translatable, so `year` is excluded.
    expect(values).toEqual({ title: "Hello" });
  });
});
