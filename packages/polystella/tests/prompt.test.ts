import { describe, expect, it } from "vitest";
import type { Segment } from "../src/parsing/extract.js";
import { EMPTY_GLOSSARY, type Glossary } from "../src/glossary/glossary.js";
import { buildPrompt, parseResponse } from "../src/translation/prompt.js";

const sampleSegments: Segment[] = [
  { id: "fm:title", text: "An apology for outdated cryptography" },
  { id: "body:0", text: "We **regret** any inconvenience caused." },
];

const sampleGlossary: Glossary = {
  version: "2026-04",
  doNotTranslate: ["Cloudflare", "TLS"],
  preferredTranslations: { edge: "borda" },
  notes: "Use Brazilian Portuguese spelling.",
};

describe("buildPrompt", () => {
  it("includes both source and target language names and codes", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: sampleGlossary,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).toMatch(/English \(en\)/);
    expect(systemPrompt).toMatch(/Brazilian Portuguese \(pt-BR\)/);
  });

  it("lists every doNotTranslate term in the system prompt", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: sampleGlossary,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).toMatch(/MUST NOT BE TRANSLATED/);
    expect(systemPrompt).toMatch(/- Cloudflare/);
    expect(systemPrompt).toMatch(/- TLS/);
  });

  it("lists every preferredTranslation as 'src -> tgt'", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: sampleGlossary,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).toMatch(/PREFERRED TRANSLATIONS/);
    expect(systemPrompt).toMatch(/- edge -> borda/);
  });

  it("includes the glossary notes verbatim when non-empty", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: sampleGlossary,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).toMatch(/ADDITIONAL NOTES:/);
    expect(systemPrompt).toMatch(/Use Brazilian Portuguese spelling\./);
  });

  it("omits the doNotTranslate section when the list is empty", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: { ...sampleGlossary, doNotTranslate: [] },
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).not.toMatch(/MUST NOT BE TRANSLATED/);
  });

  it("omits the preferredTranslations section when the map is empty", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: { ...sampleGlossary, preferredTranslations: {} },
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).not.toMatch(/PREFERRED TRANSLATIONS/);
  });

  it("omits the notes section when notes are blank", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: { ...sampleGlossary, notes: "   " },
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).not.toMatch(/ADDITIONAL NOTES/);
  });

  it("works with the EMPTY_GLOSSARY (no rule sections)", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).not.toMatch(/MUST NOT BE TRANSLATED/);
    expect(systemPrompt).not.toMatch(/PREFERRED TRANSLATIONS/);
    expect(systemPrompt).not.toMatch(/ADDITIONAL NOTES/);
    // The output-format clause is unconditional and must always appear.
    expect(systemPrompt).toMatch(/OUTPUT FORMAT/);
  });

  it("places every segment ID and its source text into the user prompt as a JSON object", () => {
    const { userPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: sampleGlossary,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    // The user prompt must contain a JSON object literal we can parse.
    const start = userPrompt.indexOf("{");
    const end = userPrompt.lastIndexOf("}");
    expect(start).toBeGreaterThan(-1);
    const json = JSON.parse(userPrompt.slice(start, end + 1));
    expect(json).toEqual({
      "fm:title": "An apology for outdated cryptography",
      "body:0": "We **regret** any inconvenience caused.",
    });
  });

  it("instructs the model to return ONLY JSON with the same key set", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: sampleGlossary,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).toMatch(/Output the JSON object ONLY/);
    expect(systemPrompt).toMatch(
      /MUST equal the set of keys in the user message/,
    );
  });

  it("uses a generic role declaration by default (no domain framing)", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).toMatch(/^You are a professional translator\.$/m);
    // The default opener must NOT carry any site-specific framing.
    expect(systemPrompt).not.toMatch(/research/i);
    expect(systemPrompt).not.toMatch(/specialis/i);
  });

  it("inserts a caller-supplied context line right after the opener", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en",
      targetLocale: "pt-BR",
      context: "Specialise in technical research content.",
    });
    const lines = systemPrompt.split("\n");
    expect(lines[0]).toBe("You are a professional translator.");
    expect(lines[1]).toBe("Specialise in technical research content.");
    // The source/target line must come after the context, not before.
    const tgtIdx = lines.findIndex((l) => /Translate from/.test(l));
    expect(tgtIdx).toBeGreaterThan(1);
  });

  it("trims whitespace and ignores blank-only context strings", () => {
    const blank = buildPrompt({
      segments: sampleSegments,
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en",
      targetLocale: "pt-BR",
      context: "   \n\t  ",
    });
    // A whitespace-only context must produce the same prompt as an
    // omitted one — no stray blank line, no trailing whitespace artifact.
    const omitted = buildPrompt({
      segments: sampleSegments,
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(blank.systemPrompt).toBe(omitted.systemPrompt);

    const padded = buildPrompt({
      segments: sampleSegments,
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en",
      targetLocale: "pt-BR",
      context: "   Use formal register.   ",
    });
    expect(padded.systemPrompt.split("\n")[1]).toBe("Use formal register.");
  });
});

describe("parseResponse", () => {
  const expected = ["fm:title", "body:0"];

  it("parses a clean JSON object", () => {
    const raw = JSON.stringify({
      "fm:title": "Um pedido de desculpas",
      "body:0": "Pedimos **desculpas** por qualquer inconveniência.",
    });
    const out = parseResponse(raw, expected);
    expect(out.get("fm:title")).toBe("Um pedido de desculpas");
    expect(out.get("body:0")).toBe(
      "Pedimos **desculpas** por qualquer inconveniência.",
    );
  });

  it("strips ```json code fences when the model wraps the output", () => {
    const raw = [
      "```json",
      JSON.stringify({ "fm:title": "T", "body:0": "B" }),
      "```",
    ].join("\n");
    const out = parseResponse(raw, expected);
    expect(out.get("fm:title")).toBe("T");
    expect(out.get("body:0")).toBe("B");
  });

  it("strips plain ``` code fences too", () => {
    const raw = [
      "```",
      JSON.stringify({ "fm:title": "T", "body:0": "B" }),
      "```",
    ].join("\n");
    const out = parseResponse(raw, expected);
    expect(out.size).toBe(2);
  });

  it("extracts the JSON object from a leading prose preamble", () => {
    const raw = `Here is the translated JSON object:\n${JSON.stringify({
      "fm:title": "T",
      "body:0": "B",
    })}\n— hope this helps!`;
    const out = parseResponse(raw, expected);
    expect(out.get("fm:title")).toBe("T");
  });

  it("throws when no JSON object can be located", () => {
    expect(() =>
      parseResponse("Sorry, I cannot translate this.", expected),
    ).toThrow(/no JSON object in the model response/);
  });

  it("distinguishes truncation (open `{`, no closing `}`) from other parse failures", () => {
    expect(() =>
      parseResponse('{"fm:title": "incomplete...', expected),
    ).toThrow(/truncated mid-output/);
  });

  it("throws on a syntactically broken JSON object", () => {
    expect(() =>
      parseResponse('{"fm:title": "T", "body:0": "B",,}', expected),
    ).toThrow(/failed to parse JSON|could not find a JSON object/);
  });

  it("throws when the parsed value is not an object", () => {
    expect(() => parseResponse("[1, 2, 3]", expected)).toThrow(
      /expected a JSON object/,
    );
  });

  it("throws when the model returns an unexpected segment id", () => {
    const raw = JSON.stringify({
      "fm:title": "T",
      "body:0": "B",
      "body:99": "Surprise!",
    });
    expect(() => parseResponse(raw, expected)).toThrow(
      /unexpected segment id "body:99"/,
    );
  });

  it("throws when the model omits an expected segment", () => {
    const raw = JSON.stringify({ "fm:title": "T" });
    expect(() => parseResponse(raw, expected)).toThrow(
      /omitted segment "body:0"/,
    );
  });

  it("throws when a value is not a string", () => {
    const raw = JSON.stringify({ "fm:title": 42, "body:0": "B" });
    expect(() => parseResponse(raw, expected)).toThrow(
      /non-string value for segment "fm:title"/,
    );
  });
});
