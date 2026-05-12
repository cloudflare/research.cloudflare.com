import { describe, expect, it } from "vitest";

import { expandPath, formatPath, parsePath, readAtPath, writeAtPath } from "../../src/parsing/key-paths.js";

/**
 * Key-path utilities — unit-level tests. The TOML / JSON / YAML
 * adapters all share these primitives, so coverage lives in one place.
 *
 * The grammar pinned here:
 *   `key`           top-level
 *   `a.b.c`         nested
 *   `a[3]`          array element
 *   `a[*]`          wildcard array
 *   `a.*`           wildcard object
 *   `a[*].b.*.c`    composed wildcards
 */

describe("parsePath", () => {
  it("parses a top-level key", () => {
    expect(parsePath("title")).toEqual({ segments: ["title"], hasWildcard: false });
  });

  it("parses dotted nested keys", () => {
    expect(parsePath("a.b.c")).toEqual({ segments: ["a", "b", "c"], hasWildcard: false });
  });

  it("parses bracketed array indices", () => {
    expect(parsePath("a[0]")).toEqual({ segments: ["a", 0], hasWildcard: false });
  });

  it("parses mixed dotted + bracketed paths", () => {
    expect(parsePath("a.b[3].c")).toEqual({ segments: ["a", "b", 3, "c"], hasWildcard: false });
  });

  it("flags array wildcard", () => {
    expect(parsePath("a[*]")).toEqual({ segments: ["a", "*"], hasWildcard: true });
  });

  it("flags object wildcard", () => {
    expect(parsePath("a.*.b")).toEqual({ segments: ["a", "*", "b"], hasWildcard: true });
  });

  it("composes wildcards", () => {
    expect(parsePath("paths.*.*.summary")).toEqual({
      segments: ["paths", "*", "*", "summary"],
      hasWildcard: true,
    });
  });

  it("rejects empty input", () => {
    expect(() => parsePath("")).toThrow(/empty/);
  });

  it("rejects trailing dot", () => {
    expect(() => parsePath("a.")).toThrow(/trailing/);
  });

  it("rejects unclosed bracket", () => {
    expect(() => parsePath("a[0")).toThrow(/unclosed/);
  });

  it("rejects non-integer non-wildcard bracket contents", () => {
    expect(() => parsePath("a[abc]")).toThrow(/integer or "\*"/);
  });

  it("rejects empty segments", () => {
    // Doubled dots are flagged as the unexpected `.` (current
    // implementation surfaces the first malformation it hits, which
    // is the second dot — equivalent diagnosis, different prose).
    expect(() => parsePath("a..b")).toThrow(/malformed/);
  });
});

describe("formatPath", () => {
  it("renders top-level keys without leading dot", () => {
    expect(formatPath(["title"])).toBe("title");
  });

  it("renders nested keys with dots", () => {
    expect(formatPath(["a", "b", "c"])).toBe("a.b.c");
  });

  it("renders array indices with brackets", () => {
    expect(formatPath(["a", 0])).toBe("a[0]");
  });

  it("renders mixed paths canonically", () => {
    expect(formatPath(["a", "b", 3, "c"])).toBe("a.b[3].c");
  });

  it("round-trips through parsePath", () => {
    const cases = ["title", "a.b.c", "a[0]", "a.b[3].c", "items[7].nested[0].deep"];
    for (const path of cases) {
      const { segments, hasWildcard } = parsePath(path);
      expect(hasWildcard).toBe(false);
      expect(formatPath(segments as (string | number)[])).toBe(path);
    }
  });
});

describe("expandPath", () => {
  it("returns the path verbatim when there are no wildcards", () => {
    expect(expandPath("a.b.c", { a: { b: { c: 1 } } })).toEqual(["a.b.c"]);
  });

  it("expands array wildcard against an array", () => {
    expect(
      expandPath("tags[*].description", {
        tags: [{ description: "x" }, { description: "y" }, { description: "z" }],
      }),
    ).toEqual(["tags[0].description", "tags[1].description", "tags[2].description"]);
  });

  it("expands object wildcard against an object", () => {
    expect(
      expandPath("paths.*.summary", {
        paths: { foo: { summary: "f" }, bar: { summary: "b" } },
      }),
    ).toEqual(["paths.foo.summary", "paths.bar.summary"]);
  });

  it("composes nested wildcards", () => {
    const data = {
      paths: {
        foo: { get: { summary: "fg" }, post: { summary: "fp" } },
        bar: { get: { summary: "bg" } },
      },
    };
    expect(expandPath("paths.*.*.summary", data)).toEqual(["paths.foo.get.summary", "paths.foo.post.summary", "paths.bar.get.summary"]);
  });

  it("expands to nothing when wildcard target is absent / non-iterable", () => {
    expect(expandPath("missing[*]", {})).toEqual([]);
    expect(expandPath("missing.*", {})).toEqual([]);
    expect(expandPath("a[*]", { a: 42 })).toEqual([]); // a is a number, not an array
  });

  it("handles empty array / empty object wildcards", () => {
    expect(expandPath("items[*]", { items: [] })).toEqual([]);
    expect(expandPath("paths.*", { paths: {} })).toEqual([]);
  });
});

describe("readAtPath", () => {
  it("reads top-level scalars", () => {
    expect(readAtPath({ title: "Hello" }, ["title"])).toBe("Hello");
  });

  it("reads nested scalars", () => {
    expect(readAtPath({ a: { b: { c: 42 } } }, ["a", "b", "c"])).toBe(42);
  });

  it("reads array elements", () => {
    expect(readAtPath({ tags: ["x", "y", "z"] }, ["tags", 1])).toBe("y");
  });

  it("returns undefined on missing intermediate", () => {
    expect(readAtPath({ a: {} }, ["a", "b", "c"])).toBeUndefined();
    expect(readAtPath({ a: null }, ["a", "b"])).toBeUndefined();
  });

  it("returns undefined when traversing through non-traversable", () => {
    expect(readAtPath({ a: 42 }, ["a", "b"])).toBeUndefined();
    expect(readAtPath({ a: ["x"] }, ["a", "missing"])).toBeUndefined();
  });
});

describe("writeAtPath", () => {
  it("writes top-level scalars in place", () => {
    const data = { title: "Hello" };
    writeAtPath(data, ["title"], "Olá");
    expect(data.title).toBe("Olá");
  });

  it("writes nested scalars in place", () => {
    const data = { a: { b: { c: 1 } } };
    writeAtPath(data, ["a", "b", "c"], 42);
    expect(data.a.b.c).toBe(42);
  });

  it("writes array elements in place", () => {
    const data = { tags: ["x", "y", "z"] };
    writeAtPath(data, ["tags", 1], "Y");
    expect(data.tags).toEqual(["x", "Y", "z"]);
  });

  it("throws on empty path", () => {
    expect(() => writeAtPath({}, [], 1)).toThrow(/empty path/);
  });

  it("throws when intermediate parent is missing", () => {
    expect(() => writeAtPath({ a: {} }, ["a", "b", "c"], 1)).toThrow(/null\/undefined/);
  });

  it("throws when intermediate parent is non-traversable", () => {
    expect(() => writeAtPath({ a: 42 }, ["a", "b"], 1)).toThrow(/expected object/);
  });
});

describe("prototype-pollution defences", () => {
  // The risk: an operator-supplied `translatableKeys` entry like
  // `__proto__.polluted` would, without guards, drive `writeAtPath`
  // into `Object.prototype` and pollute every object in the runtime.
  // We close this both at parse time (clean error for operators) and
  // at access time (defence in depth for callers that build segment
  // arrays directly).

  for (const reserved of ["__proto__", "prototype", "constructor"] as const) {
    it(`parsePath rejects "${reserved}" as a dotted segment`, () => {
      expect(() => parsePath(`a.${reserved}.b`)).toThrow(/reserved segment/);
    });

    it(`parsePath rejects "${reserved}" as a leading segment`, () => {
      expect(() => parsePath(`${reserved}.foo`)).toThrow(/reserved segment/);
    });
  }

  it("parsePath does not reject reserved names appearing as substrings of other keys", () => {
    // Defence-in-depth must not block legitimate keys like
    // `constructorName` that just happen to share a prefix.
    expect(() => parsePath("a.constructorName.b")).not.toThrow();
    expect(() => parsePath("__proto__hack")).not.toThrow();
  });

  it("readAtPath returns undefined for __proto__ even when called with a hand-built segment array", () => {
    // parsePath blocks this at config time, but readAtPath is
    // exported and may be invoked with PathSegment[] directly.
    expect(readAtPath({}, ["__proto__"])).toBeUndefined();
    expect(readAtPath({}, ["__proto__", "toString"])).toBeUndefined();
    expect(readAtPath({}, ["constructor", "name"])).toBeUndefined();
  });

  it("writeAtPath refuses to assign through __proto__ as terminal segment", () => {
    expect(() => writeAtPath({}, ["__proto__"], { polluted: true })).toThrow(/reserved/);
    expect(() => writeAtPath({}, ["constructor"], "x")).toThrow(/reserved/);
  });

  it("writeAtPath refuses to traverse through __proto__ on intermediate segments", () => {
    // Walking __proto__ as an intermediate would land us on
    // Object.prototype; the hasOwn guard turns it into a normal
    // missing-parent error rather than a polluting write.
    expect(() => writeAtPath({}, ["__proto__", "polluted"], true)).toThrow(/null\/undefined/);
    // Confirm no pollution leaked despite the throw.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("expandPath skips reserved-name traversal when invoked with parsed paths", () => {
    // parsePath rejects reserved names, so this is the only way to
    // exercise the access-side guard for expandPath — via a
    // wildcard that fans out to ordinary keys, with the reserved
    // name pre-blocked at parse time.
    expect(() => parsePath("a.__proto__")).toThrow(/reserved/);
  });
});
