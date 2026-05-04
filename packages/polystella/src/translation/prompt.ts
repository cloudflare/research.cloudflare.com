import type { Segment } from "../parsing/extract.js";
import type { Glossary } from "../glossary/glossary.js";

/**
 * Prompt construction. We ask the model for a single JSON object
 * keyed by segment id; `parseResponse` strips any code-fence /
 * preamble wrapping defensively.
 *
 * Pure — no I/O, no provider deps — so prompt and acceptance rules
 * live in one place and unit-test without a network.
 */

export interface BuildPromptInput {
  segments: Segment[];
  glossary: Glossary;
  sourceLocale: string;
  targetLocale: string;
  /** Optional system-prompt line appended after the generic opener. */
  context?: string;
}

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * System prompt: role, optional context line, source/target locales,
 * glossary's three rule lists, output-format spec.
 * User prompt: JSON object mapping segment id → source text.
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
  // Smaller models (notably llama-3.1-8b-instruct) routinely emit
  // unescaped inner double quotes when the source uses them as
  // scare-quotes (`"chaves "constrangidas""`), breaking JSON.parse.
  // Calling the rule out explicitly steers the decoder.
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
 * Parse a model response into `Map<segmentId, translatedText>`.
 * Tolerant of code-fence wrapping and surrounding prose; strict on
 * shape and id-set parity. Throws (with the raw response truncated)
 * on any deviation.
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
    // Fall back to extracting the first `{...}` block from prose.
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
