import type { Segment } from "../parsing/extract.js";
import type { Glossary } from "../glossary/glossary.js";

/**
 * The prompt-construction contract: PolyStella asks the model for a
 * single JSON object whose keys are the segment IDs from the user
 * message and whose values are the translations. Models occasionally
 * wrap that JSON in code fences or a "Here's the JSON:" preamble; the
 * companion `parseResponse` strips those defensively.
 *
 * Both functions are pure — no I/O, no provider dependencies — so the
 * "what to ask" / "what to accept" decisions live in one place and can
 * be unit-tested without ever hitting a network.
 */

export interface BuildPromptInput {
  segments: Segment[];
  glossary: Glossary;
  sourceLocale: string;
  targetLocale: string;
  /**
   * Optional site- or domain-specific guidance, inserted as a separate
   * system-prompt line right after the generic role declaration. Use
   * this for things like "Specialise in technical research content
   * from the Cloudflare Research portal." or "Use formal, legal-style
   * register." The string is trimmed; if blank or undefined, no extra
   * line is emitted, keeping the default prompt fully generic.
   */
  context?: string;
}

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Assemble the system and user prompts for a single translation batch.
 *
 * The system prompt encodes the translator's role, an optional caller-
 * supplied context line, the source/target languages, the glossary's
 * three rule lists (verbatim terms, preferred translations, free-text
 * notes), and the strict output-format spec.
 *
 * The user prompt is a JSON object mapping segment ID → source text.
 * The model is instructed to return a JSON object with the same keys.
 */
export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const { segments, glossary, sourceLocale, targetLocale, context } = input;
  const sourceName = localeName(sourceLocale);
  const targetName = localeName(targetLocale);

  const systemLines: string[] = [`You are a professional translator.`];
  const trimmedContext = context?.trim();
  if (trimmedContext) {
    systemLines.push(trimmedContext);
  }
  systemLines.push(
    `Translate from ${sourceName} (${sourceLocale}) to ${targetName} (${targetLocale}).`,
    ``,
    `Preserve markdown formatting markers exactly: **bold**, *italic*, _italic_, \`code\`, [link text](url). Translate the visible text but never the URL or any code identifier.`,
  );

  if (glossary.doNotTranslate.length > 0) {
    systemLines.push("");
    systemLines.push(
      "TERMS THAT MUST NOT BE TRANSLATED (preserve verbatim, including capitalisation):",
    );
    for (const term of glossary.doNotTranslate) {
      systemLines.push(`- ${term}`);
    }
  }

  const preferred = Object.entries(glossary.preferredTranslations);
  if (preferred.length > 0) {
    systemLines.push("");
    systemLines.push(
      "PREFERRED TRANSLATIONS (use these renderings, case-insensitive, when the source term appears):",
    );
    for (const [src, tgt] of preferred) {
      systemLines.push(`- ${src} -> ${tgt}`);
    }
  }

  const trimmedNotes = glossary.notes.trim();
  if (trimmedNotes.length > 0) {
    systemLines.push("");
    systemLines.push("ADDITIONAL NOTES:");
    systemLines.push(trimmedNotes);
  }

  systemLines.push("");
  systemLines.push("OUTPUT FORMAT:");
  systemLines.push(
    `Return a single JSON object whose keys are the segment IDs from the user message, and whose values are the translated strings. Output the JSON object ONLY: no preamble, no code fences, no explanation, no surrounding prose. The set of keys in your response MUST equal the set of keys in the user message — do not add, omit, or rename any segment ID.`,
  );
  // Smaller / older instruct models (notably llama-3.1-8b-instruct)
  // routinely produce JSON strings with unescaped inner double
  // quotes when the source text uses them as scare-quotes — e.g.
  // emitting `"chaves "constrangidas""` instead of
  // `"chaves \"constrangidas\""`. This breaks `JSON.parse` mid-string
  // (column ~91) and the per-pair retry usually reproduces the same
  // bug. Calling the rule out explicitly steers the decoder into
  // emitting the backslash even in long string values.
  systemLines.push(
    `JSON ESCAPING: Every double-quote character (") that appears inside a string VALUE must be escaped as \\". Every backslash (\\) must be escaped as \\\\. Newlines must be escaped as \\n. Do NOT escape characters outside string values (the JSON keys, structural punctuation, the opening/closing braces). When the source text contains scare-quotes, technical terms, or quoted phrases, those quotes must be \\" inside the JSON string, never bare ".`,
  );

  const segmentMap: Record<string, string> = {};
  for (const seg of segments) segmentMap[seg.id] = seg.text;

  const userPrompt = [
    `Translate the following segments to ${targetName}. The keys are segment IDs and must appear unchanged in your response. The values are the source texts to translate.`,
    "",
    JSON.stringify(segmentMap, null, 2),
  ].join("\n");

  return {
    systemPrompt: systemLines.join("\n"),
    userPrompt,
  };
}

/**
 * Parse a model's raw response into a `Map<segmentId, translatedText>`.
 *
 * Defensive against three common model outputs:
 *   - clean JSON,
 *   - JSON wrapped in ```json … ``` (or plain ```) code fences,
 *   - JSON preceded or followed by prose ("Here's the JSON: { … }").
 *
 * Throws (with the raw response, truncated, in the error message) when:
 *   - no JSON object can be located,
 *   - the JSON parses but isn't a plain object,
 *   - any value is non-string,
 *   - the model returned an unexpected segment id, or
 *   - the model omitted any expected segment id.
 *
 * Strict-by-default: the caller can wrap this in a try/catch and fall
 * back to source-as-translation if it wants leniency, but the parser
 * itself never silently drops or invents data.
 */
export function parseResponse(
  rawText: string,
  expectedIds: string[],
): Map<string, string> {
  const cleaned = stripCodeFences(rawText.trim());

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fall back to extracting the first JSON object embedded in prose.
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last <= first) {
      throw new Error(
        `[polystella] could not find a JSON object in the model response. Raw response was:\n${truncateRaw(
          rawText,
        )}`,
      );
    }
    try {
      parsed = JSON.parse(cleaned.slice(first, last + 1));
    } catch (err) {
      throw new Error(
        `[polystella] failed to parse JSON from the model response: ${
          (err as Error).message
        }\nRaw response was:\n${truncateRaw(rawText)}`,
      );
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    const kind = Array.isArray(parsed) ? "array" : typeof parsed;
    throw new Error(
      `[polystella] expected a JSON object from the model, got ${kind}. Raw response was:\n${truncateRaw(
        rawText,
      )}`,
    );
  }

  const expected = new Set(expectedIds);
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(parsed)) {
    if (!expected.has(key)) {
      throw new Error(
        `[polystella] model returned unexpected segment id "${key}" (not in input)`,
      );
    }
    if (typeof value !== "string") {
      throw new Error(
        `[polystella] model returned non-string value for segment "${key}" (got ${typeof value})`,
      );
    }
    result.set(key, value);
  }

  for (const id of expectedIds) {
    if (!result.has(id)) {
      throw new Error(
        `[polystella] model omitted segment "${id}" from response`,
      );
    }
  }

  return result;
}

function stripCodeFences(text: string): string {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  return fenced?.[1]?.trim() ?? text;
}

function truncateRaw(text: string, max = 500): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... [truncated, total length ${text.length}]`;
}

function localeName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
