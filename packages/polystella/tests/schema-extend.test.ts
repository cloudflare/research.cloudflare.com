import { z } from "astro/zod";
import { describe, expect, it, vi } from "vitest";

import {
  AI_MARKER_KEYS,
  extendSchemaWithAiMarker,
  type ExtendSchemaOpts,
} from "../src/content/extend-schema.js";

/**
 * Tests pin the contracts the helper exposes to `polystellaCollections`:
 *
 *   1. Plain `z.object({...})` → `.extend({...})` adds the marker fields.
 *   2. `.refine()` / `.passthrough()` / `.strict()` extend cleanly
 *      because Astro's Zod surfaces real ZodObjects with `.extend()`.
 *   3. Function-form (`({image}) => z.object({...})`) is wrapped: the
 *      function is invoked with deps, the result is extended.
 *   4. Collision: consumer pre-declares one of the marker keys → warn
 *      AND preserve the consumer's declaration (only add missing keys).
 *   5. Unsupported Zod shapes (`.transform()`, `.intersection()`,
 *      `.union()`) → warn, pass schema through unchanged.
 *   6. Non-Zod schemas (custom validators, test stubs) → silent
 *      passthrough so exotic setups don't trigger false warnings.
 *   7. `undefined` schema (loader-only collection) → undefined.
 */

const OPTS_BASE: ExtendSchemaOpts = { collectionName: "publications" };

function makeWarnSpy(): { warn: (m: string) => void; calls: string[] } {
  const calls: string[] = [];
  return {
    warn: (m: string) => {
      calls.push(m);
    },
    calls,
  };
}

describe("extendSchemaWithAiMarker — plain ZodObject", () => {
  it("adds all three marker fields when none are present", () => {
    const schema = z.object({ title: z.string() });
    const extended = extendSchemaWithAiMarker(schema, OPTS_BASE) as z.ZodObject<z.ZodRawShape>;

    expect(Object.keys(extended.shape).sort()).toEqual(
      ["title", ...AI_MARKER_KEYS].sort(),
    );
  });

  it("keeps marker fields optional (source entries with no values still validate)", () => {
    const schema = z.object({ title: z.string() });
    const extended = extendSchemaWithAiMarker(schema, OPTS_BASE) as z.ZodObject<z.ZodRawShape>;

    // No marker on source entries — extended schema must still parse.
    const parsed = extended.parse({ title: "Hello" });
    expect(parsed).toEqual({ title: "Hello" });
  });

  it("populated marker fields round-trip through the extended schema", () => {
    const schema = z.object({ title: z.string() });
    const extended = extendSchemaWithAiMarker(schema, OPTS_BASE) as z.ZodObject<z.ZodRawShape>;

    const parsed = extended.parse({
      title: "Hello",
      aiTranslated: true,
      aiTranslationModel: "@cf/meta/llama-3.1-8b-instruct",
      aiTranslatedAt: "2026-05-06T10:00:00Z",
    });
    expect(parsed).toEqual({
      title: "Hello",
      aiTranslated: true,
      aiTranslationModel: "@cf/meta/llama-3.1-8b-instruct",
      aiTranslatedAt: "2026-05-06T10:00:00Z",
    });
  });
});

describe("extendSchemaWithAiMarker — ZodObject variants", () => {
  it("extends `.passthrough()` schemas — extra keys still flow through", () => {
    const schema = z.object({ title: z.string() }).passthrough();
    const extended = extendSchemaWithAiMarker(schema, OPTS_BASE) as z.ZodObject<z.ZodRawShape>;

    const parsed = extended.parse({ title: "Hello", custom: "kept", aiTranslated: true });
    expect(parsed).toMatchObject({ title: "Hello", custom: "kept", aiTranslated: true });
  });

  it("extends `.strict()` schemas without losing strictness on declared keys", () => {
    const schema = z.object({ title: z.string() }).strict();
    const extended = extendSchemaWithAiMarker(schema, OPTS_BASE) as z.ZodObject<z.ZodRawShape>;

    // Marker keys are now declared, so they're allowed.
    expect(() => extended.parse({ title: "Hello", aiTranslated: true })).not.toThrow();
    // Truly extra keys still rejected.
    expect(() => extended.parse({ title: "Hello", random: 1 })).toThrow();
  });

  it("extends `.refine()` schemas (refinements still apply)", () => {
    const schema = z
      .object({ title: z.string() })
      .refine((v) => v.title.length >= 3, { message: "title too short" });
    const extended = extendSchemaWithAiMarker(schema, OPTS_BASE) as z.ZodObject<z.ZodRawShape>;

    expect(() => extended.parse({ title: "OK", aiTranslated: true })).toThrow(/title too short/);
    expect(() => extended.parse({ title: "Hello", aiTranslated: true })).not.toThrow();
  });
});

describe("extendSchemaWithAiMarker — function-form schemas", () => {
  it("wraps function-form schemas and extends the result of invocation", () => {
    type Deps = { image: () => z.ZodTypeAny };
    const factory = ({ image }: Deps) => z.object({ title: z.string(), cover: image() });

    const wrapped = extendSchemaWithAiMarker(factory, OPTS_BASE);
    expect(typeof wrapped).toBe("function");

    const extended = (wrapped as (d: Deps) => z.ZodObject<z.ZodRawShape>)({
      image: () => z.string(),
    });
    expect(Object.keys(extended.shape).sort()).toEqual(
      ["cover", "title", ...AI_MARKER_KEYS].sort(),
    );
  });

  it("re-invokes the user factory each call (Astro's content pipeline expects fresh schemas)", () => {
    type Deps = { tag: string };
    let calls = 0;
    const factory = (_d: Deps) => {
      calls++;
      return z.object({ title: z.string() });
    };

    const wrapped = extendSchemaWithAiMarker(factory, OPTS_BASE);
    (wrapped as (d: Deps) => unknown)({ tag: "first" });
    (wrapped as (d: Deps) => unknown)({ tag: "second" });

    // Wrapped factory is invoked once per call.
    expect(calls).toBe(2);
  });
});

describe("extendSchemaWithAiMarker — collisions", () => {
  it("preserves consumer's declaration when one marker key already exists", () => {
    // Consumer typed `aiTranslated` as a string. We refuse to override
    // their type; we only add the *missing* fields.
    const schema = z.object({
      title: z.string(),
      aiTranslated: z.string(), // wrong type, but consumer's call
    });
    const spy = makeWarnSpy();

    const extended = extendSchemaWithAiMarker(schema, {
      ...OPTS_BASE,
      logger: spy,
    }) as z.ZodObject<z.ZodRawShape>;

    expect(spy.calls.length).toBe(1);
    expect(spy.calls[0]).toContain("aiTranslated");
    expect(spy.calls[0]).toContain("publications");

    // aiTranslated still typed as string (consumer's declaration).
    expect(() => extended.parse({ title: "Hello", aiTranslated: "yes" })).not.toThrow();
    // Other two added.
    expect(Object.keys(extended.shape).sort()).toEqual(
      ["aiTranslated", "aiTranslatedAt", "aiTranslationModel", "title"].sort(),
    );
  });

  it("returns the original schema unchanged when all three marker keys collide", () => {
    const schema = z.object({
      title: z.string(),
      aiTranslated: z.boolean().optional(),
      aiTranslationModel: z.string().optional(),
      aiTranslatedAt: z.string().optional(),
    });
    const spy = makeWarnSpy();

    const extended = extendSchemaWithAiMarker(schema, {
      ...OPTS_BASE,
      logger: spy,
    });

    // Single warning lists all three as collisions.
    expect(spy.calls.length).toBe(1);
    expect(spy.calls[0]).toContain("aiTranslated");
    expect(spy.calls[0]).toContain("aiTranslationModel");
    expect(spy.calls[0]).toContain("aiTranslatedAt");

    // No-op extension — return the same schema by reference so
    // downstream identity short-circuits in build.ts work.
    expect(extended).toBe(schema);
  });

  it("warns once per collision regardless of how many fields collide", () => {
    const schema = z.object({
      title: z.string(),
      aiTranslated: z.boolean().optional(),
      aiTranslatedAt: z.string().optional(),
    });
    const spy = makeWarnSpy();

    extendSchemaWithAiMarker(schema, { ...OPTS_BASE, logger: spy });

    expect(spy.calls.length).toBe(1);
  });
});

describe("extendSchemaWithAiMarker — unsupported Zod shapes", () => {
  it("warns and passes `.transform()` through unchanged", () => {
    const schema = z.object({ title: z.string() }).transform((v) => v.title.toUpperCase());
    const spy = makeWarnSpy();

    const result = extendSchemaWithAiMarker(schema, { ...OPTS_BASE, logger: spy });

    expect(spy.calls.length).toBe(1);
    expect(spy.calls[0]).toMatch(/aiTranslated/);
    expect(spy.calls[0]).toMatch(/manually/);
    expect(result).toBe(schema);
  });

  it("warns and passes `z.intersection(...)` through unchanged", () => {
    const schema = z.intersection(
      z.object({ title: z.string() }),
      z.object({ year: z.number() }),
    );
    const spy = makeWarnSpy();

    const result = extendSchemaWithAiMarker(schema, { ...OPTS_BASE, logger: spy });

    expect(spy.calls.length).toBe(1);
    expect(result).toBe(schema);
  });

  it("warns and passes `z.union(...)` through unchanged", () => {
    const schema = z.union([z.object({ kind: z.literal("a") }), z.object({ kind: z.literal("b") })]);
    const spy = makeWarnSpy();

    const result = extendSchemaWithAiMarker(schema, { ...OPTS_BASE, logger: spy });

    expect(spy.calls.length).toBe(1);
    expect(result).toBe(schema);
  });
});

describe("extendSchemaWithAiMarker — degenerate inputs", () => {
  it("returns undefined when schema is undefined (loader-only collections)", () => {
    expect(extendSchemaWithAiMarker(undefined, OPTS_BASE)).toBeUndefined();
  });

  it("silently passes non-Zod schemas through (no warning)", () => {
    // Test stubs and the rare consumer who supplies a custom non-Zod
    // schema both fall here. Passing-through silently keeps fixture
    // setups quiet; production consumers who hit this can declare
    // the marker fields manually.
    const stub = { __not_zod: true, validate: () => true };
    const spy = makeWarnSpy();

    const result = extendSchemaWithAiMarker(stub, { ...OPTS_BASE, logger: spy });

    expect(spy.calls.length).toBe(0);
    expect(result).toBe(stub);
  });

  it("silently passes plain object stubs through (no warning)", () => {
    const stub = { tag: "fixture-schema" };
    const spy = makeWarnSpy();

    const result = extendSchemaWithAiMarker(stub, { ...OPTS_BASE, logger: spy });

    expect(spy.calls.length).toBe(0);
    expect(result).toBe(stub);
  });
});

describe("extendSchemaWithAiMarker — defaults to console.warn", () => {
  it("uses console.warn when no logger is supplied", () => {
    const schema = z.object({ title: z.string(), aiTranslated: z.boolean() });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    extendSchemaWithAiMarker(schema, { collectionName: "publications" });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
