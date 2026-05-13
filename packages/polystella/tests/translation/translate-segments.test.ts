import { describe, expect, it, vi } from "vitest";

import { EMPTY_GLOSSARY } from "../../src/glossary/glossary.js";
import type { Segment } from "../../src/parsing/extract.js";
import { PermanentProviderError, type Translator } from "../../src/translation/provider.js";
import { translateSegments } from "../../src/translation/translate-segments.js";

/**
 * Unit tests for the multi-batch `translateSegments` wrapper.
 *
 * The wrapper packs adapter-grouped chunks under a token budget,
 * runs each batch sequentially through `translateBatch`, and merges
 * the results. We test: single-group equivalence to `translateBatch`,
 * multi-batch dispatch, document-context threading, abort
 * propagation, and `PermanentProviderError` short-circuit.
 *
 * The stub translator echoes each `@@<id>@@` block back with a
 * `TR:` prefix so we can verify both call counts and result
 * content without spinning up an HTTP fetch stack.
 */

const seg = (id: string, text: string): Segment => ({ id, text });

function makeEchoTranslator(modelId = "stub/echo-1"): Translator & { calls: number; lastSystemPrompts: string[] } {
  const t = {
    modelId,
    calls: 0,
    lastSystemPrompts: [] as string[],
    async translate(systemPrompt: string, userPrompt: string) {
      t.calls++;
      t.lastSystemPrompts.push(systemPrompt);
      const blocks: string[] = [];
      const re = /^@@([^@\n]+?)@@\s*\n([\s\S]*?)(?=\n@@|$)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(userPrompt)) !== null) {
        const id = m[1]!.trim();
        const text = (m[2] ?? "").trim();
        blocks.push(`@@${id}@@\nTR:${text}`);
      }
      return blocks.join("\n\n");
    },
  };
  return t;
}

describe("translateSegments — single-group / no-batching equivalence", () => {
  it("with no `groups`, sends all segments in one batch (one translator call)", async () => {
    const translator = makeEchoTranslator();
    const segments = [seg("body:0", "alpha"), seg("body:1", "beta")];
    const out = await translateSegments({
      translator,
      segments,
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
    });
    expect(translator.calls).toBe(1);
    expect(out.batchCount).toBe(1);
    expect(out.translations.get("body:0")).toBe("TR:alpha");
    expect(out.translations.get("body:1")).toBe("TR:beta");
  });

  it("with `groups: [segments]`, behaves identically to the no-groups path", async () => {
    const translator = makeEchoTranslator();
    const segments = [seg("body:0", "alpha"), seg("body:1", "beta")];
    const out = await translateSegments({
      translator,
      segments,
      groups: [segments],
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
    });
    expect(translator.calls).toBe(1);
    expect(out.batchCount).toBe(1);
    expect(out.translations.get("body:0")).toBe("TR:alpha");
  });

  it("returns an empty map and batchCount: 0 without invoking the translator when segments is empty", async () => {
    const translator = makeEchoTranslator();
    const out = await translateSegments({
      translator,
      segments: [],
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
    });
    expect(translator.calls).toBe(0);
    expect(out.translations.size).toBe(0);
    expect(out.batchCount).toBe(0);
  });
});

describe("translateSegments — multi-batch dispatch", () => {
  it("issues one translator call per batch when groups force multiple batches", async () => {
    const translator = makeEchoTranslator();
    // Two groups, each with ~7 estimated tokens. Budget of 7 fits
    // one group → two batches.
    const g1 = [seg("a", "hello"), seg("b", "world")];
    const g2 = [seg("c", "hello"), seg("d", "world")];
    const out = await translateSegments({
      translator,
      segments: [...g1, ...g2],
      groups: [g1, g2],
      inputTokenBudget: 7,
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
    });
    expect(translator.calls).toBe(2);
    expect(out.batchCount).toBe(2);
    // Every segment's translation lands in the merged map.
    expect(out.translations.get("a")).toBe("TR:hello");
    expect(out.translations.get("b")).toBe("TR:world");
    expect(out.translations.get("c")).toBe("TR:hello");
    expect(out.translations.get("d")).toBe("TR:world");
  });

  it("calls the translator in batch order (first batch first)", async () => {
    const callOrder: string[][] = [];
    const orderedTranslator: Translator = {
      modelId: "stub/ordered",
      async translate(_sys, userPrompt) {
        const ids: string[] = [];
        const re = /^@@([^@\n]+?)@@\s*$/gm;
        let m: RegExpExecArray | null;
        while ((m = re.exec(userPrompt)) !== null) {
          ids.push(m[1]!.trim());
        }
        callOrder.push(ids);
        // Build a minimal valid marker response.
        return ids.map((id) => `@@${id}@@\nTR:${id}`).join("\n\n");
      },
    };
    const g1 = [seg("a", "first")];
    const g2 = [seg("b", "second")];
    const g3 = [seg("c", "third")];
    await translateSegments({
      translator: orderedTranslator,
      segments: [...g1, ...g2, ...g3],
      groups: [g1, g2, g3],
      inputTokenBudget: 4, // small budget forces one group per batch
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
    });
    expect(callOrder).toEqual([["a"], ["b"], ["c"]]);
  });
});

describe("translateSegments — document context threading", () => {
  it("includes the documentContext block in every batch's system prompt when provided", async () => {
    const translator = makeEchoTranslator();
    const g1 = [seg("a", "hello"), seg("b", "world")];
    const g2 = [seg("c", "more"), seg("d", "stuff")];
    await translateSegments({
      translator,
      segments: [...g1, ...g2],
      groups: [g1, g2],
      inputTokenBudget: 7,
      documentContext: "Title: Echo State Networks\nExcerpt: A practical guide.",
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
    });
    expect(translator.calls).toBe(2);
    for (const systemPrompt of translator.lastSystemPrompts) {
      expect(systemPrompt).toContain("DOCUMENT CONTEXT");
      expect(systemPrompt).toContain("Title: Echo State Networks");
    }
  });

  it("omits the DOCUMENT CONTEXT block when documentContext is undefined (byte-identical to today)", async () => {
    const translator = makeEchoTranslator();
    await translateSegments({
      translator,
      segments: [seg("body:0", "hello")],
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
    });
    expect(translator.lastSystemPrompts[0]).not.toMatch(/DOCUMENT CONTEXT/);
  });
});

describe("translateSegments — error handling", () => {
  it("short-circuits on PermanentProviderError; subsequent batches are not called", async () => {
    const translate = vi
      .fn()
      .mockRejectedValueOnce(new PermanentProviderError("401 Unauthorized"))
      .mockResolvedValue("@@b@@\nTR:would-not-arrive");
    const translator: Translator = { modelId: "stub/perm", translate };
    const g1 = [seg("a", "hello")];
    const g2 = [seg("b", "world")];
    await expect(
      translateSegments({
        translator,
        segments: [...g1, ...g2],
        groups: [g1, g2],
        inputTokenBudget: 4,
        glossary: EMPTY_GLOSSARY,
        sourceLocale: "en-US",
        targetLocale: "pt-BR",
      }),
    ).rejects.toThrow(/401 Unauthorized/);
    // Exactly one call: batch 1 failed permanently, batch 2 not attempted.
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it("retries inside a single batch (transient error), other batches unaffected", async () => {
    // Batch 1: first attempt fails transiently, second succeeds.
    // Batch 2: succeeds on first attempt.
    const good = (ids: string[]): string => ids.map((id) => `@@${id}@@\nTR:${id}`).join("\n\n");
    const translate = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient 503"))
      .mockImplementationOnce(async () => good(["a"]))
      .mockImplementationOnce(async () => good(["b"]));
    const translator: Translator = { modelId: "stub/transient", translate };
    const g1 = [seg("a", "first")];
    const g2 = [seg("b", "second")];
    const out = await translateSegments({
      translator,
      segments: [...g1, ...g2],
      groups: [g1, g2],
      inputTokenBudget: 4,
      maxRetries: 1,
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en-US",
      targetLocale: "pt-BR",
    });
    // 3 calls total: batch 1 (fail), batch 1 retry, batch 2.
    expect(translate).toHaveBeenCalledTimes(3);
    expect(out.translations.get("a")).toBe("TR:a");
    expect(out.translations.get("b")).toBe("TR:b");
    expect(out.batchCount).toBe(2);
  });
});

describe("translateSegments — cancellation", () => {
  it("pre-aborted signal short-circuits before any translator call", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled before call"));
    const translator = makeEchoTranslator();
    await expect(
      translateSegments({
        translator,
        segments: [seg("a", "hello")],
        glossary: EMPTY_GLOSSARY,
        sourceLocale: "en-US",
        targetLocale: "pt-BR",
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(translator.calls).toBe(0);
  });

  it("aborts between batches: first batch completes, second not called", async () => {
    const controller = new AbortController();
    const good = (ids: string[]): string => ids.map((id) => `@@${id}@@\nTR:${id}`).join("\n\n");
    const translate = vi.fn().mockImplementationOnce(async () => {
      // After batch 1 returns, fire the abort. The signal check
      // before batch 2 will then trip.
      controller.abort(new Error("user cancelled"));
      return good(["a"]);
    });
    const translator: Translator = { modelId: "stub/abort-mid", translate };
    const g1 = [seg("a", "first")];
    const g2 = [seg("b", "second")];
    await expect(
      translateSegments({
        translator,
        segments: [...g1, ...g2],
        groups: [g1, g2],
        inputTokenBudget: 4,
        glossary: EMPTY_GLOSSARY,
        sourceLocale: "en-US",
        targetLocale: "pt-BR",
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    // Exactly one batch attempted before the abort.
    expect(translate).toHaveBeenCalledTimes(1);
  });
});
