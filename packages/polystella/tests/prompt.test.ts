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
  styleRules: [
    { category: "tone", instruction: "Use formal academic register." },
    { category: "numbers", instruction: "Use comma as decimal separator.", example: "21.3 → 21,3" },
  ],
  notes: "Use Brazilian Portuguese spelling.",
};

/** Helper: build a marker-delimited response for `expectedIds`. */
function buildMarkerResponse(pairs: ReadonlyArray<[id: string, value: string]>): string {
  return pairs.map(([id, value]) => `@@${id}@@\n${value}`).join("\n\n");
}

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

  it("renders styleRules as a bracketed-category list", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: sampleGlossary,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).toMatch(/STYLE RULES \(apply these throughout\):/);
    expect(systemPrompt).toMatch(/- \[tone\] Use formal academic register\./);
    expect(systemPrompt).toMatch(/- \[numbers\] Use comma as decimal separator\./);
  });

  it("indents a rule's example with two spaces on the next line", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: sampleGlossary,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).toMatch(/- \[numbers\] Use comma as decimal separator\.\n {2}Example: 21\.3 → 21,3/);
  });

  it("places STYLE RULES between PREFERRED TRANSLATIONS and ADDITIONAL NOTES", () => {
    // Order matters because the model treats later sections as
    // having more precedence in case of conflict — terminology rules
    // come first, then categorical style, then free-form notes.
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: sampleGlossary,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    const idxPref = systemPrompt.indexOf("PREFERRED TRANSLATIONS");
    const idxStyle = systemPrompt.indexOf("STYLE RULES");
    const idxNotes = systemPrompt.indexOf("ADDITIONAL NOTES");
    expect(idxPref).toBeGreaterThan(-1);
    expect(idxStyle).toBeGreaterThan(idxPref);
    expect(idxNotes).toBeGreaterThan(idxStyle);
  });

  it("omits the STYLE RULES section when the rule list is empty", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: { ...sampleGlossary, styleRules: [] },
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).not.toMatch(/STYLE RULES/);
  });

  it("renders rules without an example as a single line (no Example: prefix)", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: {
        ...sampleGlossary,
        styleRules: [{ category: "tone", instruction: "Use formal academic register." }],
      },
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).toMatch(/- \[tone\] Use formal academic register\./);
    expect(systemPrompt).not.toMatch(/Example:/);
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
    expect(systemPrompt).not.toMatch(/STYLE RULES/);
    expect(systemPrompt).not.toMatch(/ADDITIONAL NOTES/);
    // The output-format clause is unconditional.
    expect(systemPrompt).toMatch(/OUTPUT FORMAT/);
  });

  it("places every segment as a marker block in the user prompt", () => {
    const { userPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: sampleGlossary,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(userPrompt).toContain("@@fm:title@@");
    expect(userPrompt).toContain("An apology for outdated cryptography");
    expect(userPrompt).toContain("@@body:0@@");
    expect(userPrompt).toContain("We **regret** any inconvenience caused.");
  });

  it("instructs the model to mirror the marker format and id set", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: sampleGlossary,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).toMatch(/marker line/);
    expect(systemPrompt).toMatch(/MUST equal the set in the user message/);
    expect(systemPrompt).toMatch(/Do NOT wrap your output in JSON/);
  });

  it("emits source segments in the same order they were given", () => {
    // Order matters because the model often mirrors the user-prompt
    // sequence in its response. A stable input order keeps the
    // response stable across builds.
    const segments: Segment[] = [
      { id: "body:0", text: "first" },
      { id: "fm:title", text: "second" },
      { id: "body:1", text: "third" },
    ];
    const { userPrompt } = buildPrompt({
      segments,
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    const idx0 = userPrompt.indexOf("@@body:0@@");
    const idx1 = userPrompt.indexOf("@@fm:title@@");
    const idx2 = userPrompt.indexOf("@@body:1@@");
    expect(idx0).toBeLessThan(idx1);
    expect(idx1).toBeLessThan(idx2);
  });

  it("uses a generic role declaration by default (no domain framing)", () => {
    const { systemPrompt } = buildPrompt({
      segments: sampleSegments,
      glossary: EMPTY_GLOSSARY,
      sourceLocale: "en",
      targetLocale: "pt-BR",
    });
    expect(systemPrompt).toMatch(/^You are a professional translator\.$/m);
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

  it("parses a clean marker-delimited response", () => {
    const raw = buildMarkerResponse([
      ["fm:title", "Um pedido de desculpas"],
      ["body:0", "Pedimos **desculpas** por qualquer inconveniência."],
    ]);
    const out = parseResponse(raw, expected);
    expect(out.get("fm:title")).toBe("Um pedido de desculpas");
    expect(out.get("body:0")).toBe("Pedimos **desculpas** por qualquer inconveniência.");
  });

  it("preserves multi-line translated content verbatim", () => {
    // The marker format shines here vs. JSON: literal newlines pass
    // through without escaping.
    const raw = ["@@fm:title@@", "Title", "", "@@body:0@@", "First line", "Second line", "", "Third line after blank"].join("\n");
    const out = parseResponse(raw, expected);
    expect(out.get("body:0")).toBe("First line\nSecond line\n\nThird line after blank");
  });

  it("preserves literal quotes and backslashes verbatim (no escaping needed)", () => {
    const raw = buildMarkerResponse([
      ["fm:title", 'A "quoted" title'],
      ["body:0", "Path: C:\\path\\to\\thing"],
    ]);
    const out = parseResponse(raw, expected);
    expect(out.get("fm:title")).toBe('A "quoted" title');
    expect(out.get("body:0")).toBe("Path: C:\\path\\to\\thing");
  });

  it("strips ```text code fences when the model wraps the output", () => {
    const raw = [
      "```text",
      buildMarkerResponse([
        ["fm:title", "T"],
        ["body:0", "B"],
      ]),
      "```",
    ].join("\n");
    const out = parseResponse(raw, expected);
    expect(out.get("fm:title")).toBe("T");
    expect(out.get("body:0")).toBe("B");
  });

  it("strips plain ``` code fences too", () => {
    const raw = [
      "```",
      buildMarkerResponse([
        ["fm:title", "T"],
        ["body:0", "B"],
      ]),
      "```",
    ].join("\n");
    const out = parseResponse(raw, expected);
    expect(out.size).toBe(2);
  });

  it("ignores leading prose before the first marker", () => {
    const raw = `Here are the translations:\n\n${buildMarkerResponse([
      ["fm:title", "T"],
      ["body:0", "B"],
    ])}`;
    const out = parseResponse(raw, expected);
    expect(out.get("fm:title")).toBe("T");
  });

  it("throws when no markers are present at all", () => {
    expect(() => parseResponse("Sorry, I cannot translate this.", expected)).toThrow(/no segment markers in the model response/);
  });

  it("distinguishes truncation (last segment never finished) with a clear hint", () => {
    // Model emitted the body:0 marker and content but never produced
    // the second marker — the last id we requested.
    const raw = "@@fm:title@@\nT";
    expect(() => parseResponse(raw, expected)).toThrow(/omitted segment "body:0".*Response appears truncated/s);
  });

  it("throws when the model returns an unexpected segment id", () => {
    const raw = buildMarkerResponse([
      ["fm:title", "T"],
      ["body:0", "B"],
      ["body:99", "Surprise!"],
    ]);
    expect(() => parseResponse(raw, expected)).toThrow(/unexpected segment id "body:99"/);
  });

  it("throws when the model omits an expected segment", () => {
    // Model emitted fm:title with content but body:0 with empty
    // content — a different shape than truncation. Without this
    // explicit miss, a typo in the id space could be silently
    // accepted as "translation = empty".
    const raw = buildMarkerResponse([["fm:title", "T"]]);
    expect(() => parseResponse(raw, expected)).toThrow(/omitted segment "body:0"/);
  });

  it("throws when a translation block is empty", () => {
    // Marker present but no content between it and the next marker.
    // Empty translation is meaningless — better to fail loudly than
    // ship a blank rendered page.
    const raw = "@@fm:title@@\n\n@@body:0@@\nB";
    expect(() => parseResponse(raw, expected)).toThrow(/empty translation for segment "fm:title"/);
  });

  it("trims trailing whitespace from each translation block", () => {
    const raw = ["@@fm:title@@", "T  ", "", "@@body:0@@", "  B", ""].join("\n");
    const out = parseResponse(raw, expected);
    expect(out.get("fm:title")).toBe("T");
    expect(out.get("body:0")).toBe("B");
  });

  it("does not match `@@id@@` appearing mid-line (markers must be standalone)", () => {
    // A translation that mentions `@@something@@` inline shouldn't
    // be misread as a new marker. The regex anchors on line starts
    // so mid-line pseudo-markers stay part of the content.
    const raw = ["@@fm:title@@", "T (see @@inline@@ note)", "", "@@body:0@@", "B"].join("\n");
    const out = parseResponse(raw, expected);
    expect(out.get("fm:title")).toBe("T (see @@inline@@ note)");
    expect(out.get("body:0")).toBe("B");
  });
});
