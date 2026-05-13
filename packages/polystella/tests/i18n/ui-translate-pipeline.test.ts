import { describe, expect, it, vi } from "vitest";

import { EMPTY_GLOSSARY } from "../../src/glossary/glossary.js";
import type { Translator } from "../../src/translation/provider.js";
import {
  extractTokens,
  selectEmptyKeys,
  translateUiStringsForLocale,
  validateTokenPreservation,
  withTokenPreservationRule,
} from "../../src/i18n/ui-translate.js";

/**
 * Tests for the UI-string AI translation orchestrator.
 *
 * Pure helpers are tested directly (token extraction / validation /
 * empty-key selection). The orchestrator is tested with a stub
 * `Translator` that emits valid marker output — same pattern as
 * `tests/translation/provider.test.ts`.
 *
 * The token validator is the load-bearing safety check; its retry
 * behaviour and partial-result reporting are pinned by name.
 */

function makeStubTranslator(responses: string[]): Translator & { calls: number } {
  let i = 0;
  const t = {
    modelId: "stub/ui",
    translate: vi.fn(async () => {
      const next = responses[i++];
      if (next === undefined) {
        throw new Error("stub translator exhausted");
      }
      return next;
    }),
    calls: 0,
  } as Translator & { calls: number };
  // Expose the call count for assertions.
  Object.defineProperty(t, "calls", {
    get: () => (t.translate as ReturnType<typeof vi.fn>).mock.calls.length,
  });
  return t;
}

/** Build a valid marker-format response for a set of (id, text) pairs. */
function markerResponse(pairs: Array<[string, string]>): string {
  return pairs
    .flatMap(([id, text]) => [`@@${id}@@`, text, ""])
    .join("\n")
    .trim();
}

describe("extractTokens", () => {
  it("finds `{{name}}` placeholders with word-char names", () => {
    expect(extractTokens("Copyright ©{{year}}.")).toEqual(new Set(["year"]));
    expect(extractTokens("Hello {{name}}, you have {{count}} items.")).toEqual(new Set(["name", "count"]));
  });

  it("returns an empty set when no placeholders are present", () => {
    expect(extractTokens("Just plain text.")).toEqual(new Set());
  });

  it("dedupes repeated tokens", () => {
    expect(extractTokens("{{a}} and {{a}} again")).toEqual(new Set(["a"]));
  });

  it("ignores `{{ name }}` (whitespace inside braces — runtime rejects too)", () => {
    expect(extractTokens("{{ year }}")).toEqual(new Set());
  });

  it("ignores `{{name.dotted}}` (runtime grammar is `\\w+` only)", () => {
    expect(extractTokens("{{user.name}}")).toEqual(new Set());
  });
});

describe("validateTokenPreservation", () => {
  it("returns null when tokens match exactly", () => {
    expect(validateTokenPreservation("k", "Hello {{name}}", "Olá {{name}}")).toBeNull();
  });

  it("returns null for strings with no tokens on either side", () => {
    expect(validateTokenPreservation("k", "Hello", "Olá")).toBeNull();
  });

  it("flags a missing token (source has, translation doesn't)", () => {
    const issue = validateTokenPreservation("k", "Hello {{name}}", "Olá");
    expect(issue).toEqual({ key: "k", missing: ["name"], spurious: [] });
  });

  it("flags a spurious token (translation has, source doesn't)", () => {
    const issue = validateTokenPreservation("k", "Hello", "Olá {{name}}");
    expect(issue).toEqual({ key: "k", missing: [], spurious: ["name"] });
  });

  it("flags a renamed token as both missing and spurious", () => {
    const issue = validateTokenPreservation("k", "Hi {{name}}", "Olá {{nome}}");
    expect(issue).toEqual({ key: "k", missing: ["name"], spurious: ["nome"] });
  });

  it("flags multi-token mismatches with sorted output", () => {
    const issue = validateTokenPreservation("k", "{{z}}, {{a}}, {{m}}", "{{a}}");
    expect(issue?.missing).toEqual(["m", "z"]);
  });
});

describe("selectEmptyKeys", () => {
  it("returns keys with empty locale values when source is non-empty", () => {
    const pairs = selectEmptyKeys({ a: "A", b: "B", c: "C" }, { a: "ALocale", b: "" });
    expect(pairs).toEqual([
      { key: "b", source: "B" },
      { key: "c", source: "C" },
    ]);
  });

  it("skips keys with intentionally-empty source values", () => {
    const pairs = selectEmptyKeys({ blank: "", filled: "F" }, {});
    expect(pairs).toEqual([{ key: "filled", source: "F" }]);
  });

  it("returns no pairs when every key already has a locale value", () => {
    const pairs = selectEmptyKeys({ a: "A" }, { a: "ALocale" });
    expect(pairs).toEqual([]);
  });
});

describe("withTokenPreservationRule", () => {
  it("appends a placeholders style rule to the glossary", () => {
    const next = withTokenPreservationRule(EMPTY_GLOSSARY);
    expect(next.styleRules).toHaveLength(1);
    expect(next.styleRules[0]?.category).toBe("placeholders");
    expect(next.styleRules[0]?.instruction).toContain("`{{token}}`");
  });

  it("doesn't mutate the input glossary", () => {
    const before = JSON.stringify(EMPTY_GLOSSARY);
    withTokenPreservationRule(EMPTY_GLOSSARY);
    expect(JSON.stringify(EMPTY_GLOSSARY)).toBe(before);
  });

  it("preserves existing style rules and appends after them", () => {
    const seed = {
      ...EMPTY_GLOSSARY,
      styleRules: [{ category: "tone", instruction: "Use formal voice." }],
    };
    const next = withTokenPreservationRule(seed);
    expect(next.styleRules).toHaveLength(2);
    expect(next.styleRules[0]?.category).toBe("tone");
    expect(next.styleRules[1]?.category).toBe("placeholders");
  });
});

describe("translateUiStringsForLocale", () => {
  it("returns dict unchanged + empty filled list when no empties to translate", async () => {
    const translator = makeStubTranslator([]);
    const result = await translateUiStringsForLocale({
      translator,
      glossary: EMPTY_GLOSSARY,
      sourceDict: { a: "A" },
      localeDict: { a: "ALocale" },
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
    });
    expect(result.dict).toEqual({ a: "ALocale" });
    expect(result.filled).toEqual([]);
    expect(result.tokenFailures).toEqual([]);
    expect(translator.calls).toBe(0);
  });

  it("batches every empty key into one LLM call", async () => {
    const translator = makeStubTranslator([
      markerResponse([
        ["a", "Atrad"],
        ["b", "Btrad"],
        ["c", "Ctrad"],
      ]),
    ]);
    const result = await translateUiStringsForLocale({
      translator,
      glossary: EMPTY_GLOSSARY,
      sourceDict: { a: "A", b: "B", c: "C" },
      localeDict: { a: "", b: "", c: "" },
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
    });
    expect(translator.calls).toBe(1);
    expect(result.dict).toEqual({ a: "Atrad", b: "Btrad", c: "Ctrad" });
    expect(result.filled).toEqual(["a", "b", "c"]);
    expect(result.tokenFailures).toEqual([]);
  });

  it("preserves existing non-empty locale values", async () => {
    const translator = makeStubTranslator([markerResponse([["b", "Btrad"]])]);
    const result = await translateUiStringsForLocale({
      translator,
      glossary: EMPTY_GLOSSARY,
      sourceDict: { a: "A", b: "B" },
      localeDict: { a: "ALocaleKept", b: "" },
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
    });
    expect(result.dict).toEqual({ a: "ALocaleKept", b: "Btrad" });
    expect(result.filled).toEqual(["b"]);
  });

  it("retries the whole batch on token-validation failure (with sampling variance)", async () => {
    // First attempt drops the {{year}} token; second preserves it.
    const translator = makeStubTranslator([
      markerResponse([["copyright", "Direitos reservados."]]),
      markerResponse([["copyright", "Direitos reservados {{year}}."]]),
    ]);
    const result = await translateUiStringsForLocale({
      translator,
      glossary: EMPTY_GLOSSARY,
      sourceDict: { copyright: "Copyright ©{{year}}." },
      localeDict: { copyright: "" },
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
      maxRetries: 1,
    });
    expect(translator.calls).toBe(2);
    expect(result.dict.copyright).toBe("Direitos reservados {{year}}.");
    expect(result.tokenFailures).toEqual([]);
  });

  it("reports token failures and leaves the key empty when retries exhaust", async () => {
    // Both attempts drop the token.
    const translator = makeStubTranslator([
      markerResponse([["copyright", "Direitos reservados."]]),
      markerResponse([["copyright", "Direitos reservados."]]),
    ]);
    const result = await translateUiStringsForLocale({
      translator,
      glossary: EMPTY_GLOSSARY,
      sourceDict: { copyright: "Copyright ©{{year}}." },
      localeDict: { copyright: "" },
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
      maxRetries: 1,
    });
    expect(translator.calls).toBe(2);
    // Key stays empty (load-bearing: a broken `{{year}}` page is
    // worse than an obviously-untranslated string).
    expect(result.dict.copyright).toBe("");
    expect(result.filled).toEqual([]);
    expect(result.tokenFailures).toHaveLength(1);
    expect(result.tokenFailures[0]).toEqual({
      key: "copyright",
      missing: ["year"],
      spurious: [],
    });
  });

  it("lands token-valid keys even when one key fails validation", async () => {
    // One bad translation in a batch shouldn't kill the others.
    const translator = makeStubTranslator([
      markerResponse([
        ["good", "Bom"],
        ["bad", "Sem placeholder"], // drops {{token}}
      ]),
      markerResponse([
        ["good", "Bom"],
        ["bad", "Sem placeholder ainda"], // still no token
      ]),
    ]);
    const result = await translateUiStringsForLocale({
      translator,
      glossary: EMPTY_GLOSSARY,
      sourceDict: { good: "Good", bad: "Hello {{token}}" },
      localeDict: { good: "", bad: "" },
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
      maxRetries: 1,
    });
    expect(result.dict.good).toBe("Bom");
    expect(result.dict.bad).toBe("");
    expect(result.filled).toEqual(["good"]);
    expect(result.tokenFailures).toHaveLength(1);
  });

  it("fires onRetry between failing attempts", async () => {
    const translator = makeStubTranslator([markerResponse([["k", "no token"]]), markerResponse([["k", "with {{token}}"]])]);
    const onRetry = vi.fn();
    await translateUiStringsForLocale({
      translator,
      glossary: EMPTY_GLOSSARY,
      sourceDict: { k: "{{token}}" },
      localeDict: { k: "" },
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
      maxRetries: 1,
      onRetry,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0]?.attempt).toBe(1);
    expect(onRetry.mock.calls[0]?.[0]?.totalAttempts).toBe(2);
  });

  it("re-throws provider errors on the final attempt", async () => {
    const translator: Translator = {
      modelId: "stub",
      translate: vi.fn(async () => {
        throw new Error("network ECONNRESET");
      }),
    };
    await expect(
      translateUiStringsForLocale({
        translator,
        glossary: EMPTY_GLOSSARY,
        sourceDict: { a: "A" },
        localeDict: { a: "" },
        sourceLocale: "en-US",
        targetLocale: "pt-BR",
        maxRetries: 0,
      }),
    ).rejects.toThrow(/ECONNRESET/);
  });

  it("retries provider errors that aren't permanent", async () => {
    const translate = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient 5xx"))
      .mockResolvedValueOnce(markerResponse([["a", "Atrad"]]));
    const translator: Translator = { modelId: "stub", translate };
    const result = await translateUiStringsForLocale({
      translator,
      glossary: EMPTY_GLOSSARY,
      sourceDict: { a: "A" },
      localeDict: { a: "" },
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
      maxRetries: 1,
    });
    expect(translate).toHaveBeenCalledTimes(2);
    expect(result.dict.a).toBe("Atrad");
  });

  it("does not mutate the input localeDict", async () => {
    const localeDict = { a: "", b: "BLocale" };
    const before = JSON.stringify(localeDict);
    const translator = makeStubTranslator([markerResponse([["a", "Atrad"]])]);
    await translateUiStringsForLocale({
      translator,
      glossary: EMPTY_GLOSSARY,
      sourceDict: { a: "A", b: "B" },
      localeDict,
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
    });
    expect(JSON.stringify(localeDict)).toBe(before);
  });
});
