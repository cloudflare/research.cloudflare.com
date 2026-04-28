import { describe, it, expect } from "vitest";
import { computeSourceHash } from "./hash.js";

const baseInput = {
  body: "# Hello\n\nA paragraph.\n",
  frontmatter: { title: "Hello", year: 2025 },
  glossaryHash: "g0",
  modelId: "@cf/meta/llama-3.1-8b-instruct",
};

describe("computeSourceHash", () => {
  it("returns a 64-char lowercase hex sha256", () => {
    const hash = computeSourceHash(baseInput);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for identical inputs", () => {
    expect(computeSourceHash(baseInput)).toBe(computeSourceHash(baseInput));
  });

  it("is stable across reorderings of frontmatter keys", () => {
    const a = computeSourceHash({
      ...baseInput,
      frontmatter: { title: "Hello", year: 2025 },
    });
    const b = computeSourceHash({
      ...baseInput,
      frontmatter: { year: 2025, title: "Hello" },
    });
    expect(a).toBe(b);
  });

  it("is stable across reorderings of nested frontmatter keys", () => {
    const a = computeSourceHash({
      ...baseInput,
      frontmatter: { meta: { author: "Ada", date: "2025-01-01" } },
    });
    const b = computeSourceHash({
      ...baseInput,
      frontmatter: { meta: { date: "2025-01-01", author: "Ada" } },
    });
    expect(a).toBe(b);
  });

  it("is sensitive to body changes (even whitespace)", () => {
    const a = computeSourceHash(baseInput);
    const b = computeSourceHash({ ...baseInput, body: baseInput.body + " " });
    expect(a).not.toBe(b);
  });

  it("is sensitive to frontmatter value changes", () => {
    const a = computeSourceHash(baseInput);
    const b = computeSourceHash({
      ...baseInput,
      frontmatter: { ...baseInput.frontmatter, title: "Hello!" },
    });
    expect(a).not.toBe(b);
  });

  it("is sensitive to glossaryHash changes (per-locale invalidation)", () => {
    const a = computeSourceHash(baseInput);
    const b = computeSourceHash({ ...baseInput, glossaryHash: "g1" });
    expect(a).not.toBe(b);
  });

  it("is sensitive to model id changes (per-locale invalidation)", () => {
    const a = computeSourceHash(baseInput);
    const b = computeSourceHash({
      ...baseInput,
      modelId: "@cf/qwen/qwen2.5-7b-instruct",
    });
    expect(a).not.toBe(b);
  });

  it("treats segment boundaries unambiguously (length-prefixing)", () => {
    // If we just concatenated body + frontmatter + glossary + model, then
    // moving content between adjacent segments would yield the same hash.
    // Length-prefixing must prevent that.
    const a = computeSourceHash({
      body: "ab",
      frontmatter: { x: "cd" },
      glossaryHash: "ef",
      modelId: "gh",
    });
    const b = computeSourceHash({
      body: "abc",
      frontmatter: { x: "d" },
      glossaryHash: "ef",
      modelId: "gh",
    });
    expect(a).not.toBe(b);
  });
});
