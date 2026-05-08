import type { Segment } from "../parsing/extract.js";
import type { Glossary } from "../glossary/glossary.js";

/**
 * Prompt construction. We ask the model to emit each translated
 * segment as a delimited block:
 *
 *   @@<segment-id>@@
 *   <translated text>
 *
 * This format replaces an earlier JSON-object protocol. The model
 * doesn't have to track nested syntax (braces, quotes, escaping),
 * which both saves output tokens and removes a class of failures
 * smaller models hit on long Portuguese / CJK content (truncation
 * before the closing `}`, unescaped scare-quotes inside strings,
 * etc.). Translated values are taken verbatim between markers, so
 * literal newlines, quotes, and backslashes pass through without
 * any escaping rules to follow.
 *
 * Pure — no I/O, no provider deps — so prompt and acceptance rules
 * live in one place and unit-test without a network.
 */

/**
 * Marker delimiter used in both the user prompt and the parsed
 * response. `@@` is rare enough in technical/research prose that
 * collisions inside translated content are practically nil; the
 * parser still validates that every emitted id is one we asked for.
 */
const MARKER = "@@";

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
    systemLines.push("TERMS THAT MUST NOT BE TRANSLATED (preserve verbatim, including capitalisation):");
    for (const term of glossary.doNotTranslate) {
      systemLines.push(`- ${term}`);
    }
  }

  const preferred = Object.entries(glossary.preferredTranslations);
  if (preferred.length > 0) {
    systemLines.push("");
    systemLines.push("PREFERRED TRANSLATIONS (use these renderings, case-insensitive, when the source term appears):");
    for (const [src, tgt] of preferred) {
      systemLines.push(`- ${src} -> ${tgt}`);
    }
  }

  if (glossary.styleRules.length > 0) {
    systemLines.push("");
    systemLines.push("STYLE RULES (apply these throughout):");
    for (const rule of glossary.styleRules) {
      systemLines.push(`- [${rule.category}] ${rule.instruction}`);
      if (rule.example !== undefined) {
        // Two-space indent so the example visually nests under its
        // rule. Keeping it on a separate line (rather than inlining
        // with " — example: …") makes the structure scannable for
        // the model and keeps each rule on bounded line widths.
        systemLines.push(`  Example: ${rule.example}`);
      }
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
    `For each segment in the user message, output a marker line of the form ${MARKER}<segment-id>${MARKER} on its own line, followed by the translated text on subsequent lines. Repeat for every segment id; do not skip any. The set of segment ids in your response MUST equal the set in the user message — do not add, omit, or rename any. Do NOT wrap your output in JSON, code fences, or any other surrounding syntax. Output the markers and translations only.`,
  );

  const userPromptParts: string[] = [
    `Translate the following segments to ${targetName}. Each segment is preceded by a marker line ${MARKER}<segment-id>${MARKER}. Output translations in the SAME format with the SAME segment ids — one marker line per segment, then the translation, then a blank line before the next marker.`,
    "",
  ];
  for (const seg of segments) {
    userPromptParts.push(`${MARKER}${seg.id}${MARKER}`);
    userPromptParts.push(seg.text);
    userPromptParts.push("");
  }

  return {
    systemPrompt: systemLines.join("\n"),
    userPrompt: userPromptParts.join("\n").trimEnd(),
  };
}

/**
 * Parse a marker-delimited response into `Map<segmentId, translatedText>`.
 *
 * Tolerant: strips code-fence wrapping if the model adds one,
 * accepts surrounding prose before the first marker (treated as
 * preamble and discarded). Strict on the id set — unknown or
 * omitted ids throw with a truncated dump for diagnostics.
 */
export function parseResponse(rawText: string, expectedIds: string[]): Map<string, string> {
  const cleaned = stripCodeFences(rawText.trim());

  // Split on `@@<id>@@` marker lines. The split keeps the captured id
  // and the content between markers as alternating array elements:
  //   parts[0]      = preamble (anything before the first marker)
  //   parts[1]      = first id
  //   parts[2]      = first content
  //   parts[3]      = second id
  //   parts[4]      = second content
  //   …
  // Multi-line flag so `^`/`$` match line starts/ends rather than
  // string ends — the marker has to be on its own line so we don't
  // mis-detect `@@something@@` if it appears mid-sentence.
  const markerRe = new RegExp(`^${escapeRegExp(MARKER)}([^@\\n]+?)${escapeRegExp(MARKER)}\\s*$`, "gm");
  const parts = cleaned.split(markerRe);

  if (parts.length < 3) {
    throw new Error(
      `[polystella] no segment markers in the model response. Expected ${expectedIds.length} markers of the form "${MARKER}<id>${MARKER}". Total length: ${rawText.length} chars.\nRaw response was:\n${truncateRaw(rawText)}`,
    );
  }

  // Every emitted segment shows up as a (id, content) pair. Odd
  // indices in `parts` are ids; even indices ≥ 2 are the content
  // immediately following the preceding id.
  //
  // Unexpected ids (small models hallucinate `fm:abstract` /
  // `fm:content` / `fn:author` etc. on academic-shaped content
  // even when the prompt explicitly forbids it) are SILENTLY
  // SKIPPED — the prompt told the model not to add them; we
  // ignore the ones it added anyway. The "model omitted segment"
  // check below still catches genuinely-malformed responses where
  // a real expected id never made it out, so this tolerance
  // doesn't mask real failures, only model misbehaviour the
  // retry-loop above can't otherwise recover from.
  const expected = new Set(expectedIds);
  const result = new Map<string, string>();
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const id = (parts[i] ?? "").trim();
    const value = (parts[i + 1] ?? "").trim();
    if (id.length === 0) continue;
    if (!expected.has(id)) {
      // Hallucinated id — drop it and keep parsing. We don't have
      // a logger at this layer; the retry-loop / per-pair report
      // surface enough signal at the build-orchestrator level if
      // hallucinations become persistent.
      continue;
    }
    if (value.length === 0) {
      throw new Error(`[polystella] model returned an empty translation for segment "${id}"`);
    }
    result.set(id, value);
  }

  for (const id of expectedIds) {
    if (!result.has(id)) {
      // Distinguish truncation (model started but didn't finish all
      // segments) from a flat-out missing id (model produced markers
      // for some other ids and skipped this one).
      const lastEmitted = [...result.keys()].at(-1);
      const totalCharsInResult = [...result.values()].reduce((n, v) => n + v.length, 0);
      const looksTruncated =
        lastEmitted !== undefined &&
        rawText.length > totalCharsInResult &&
        // Model stopped mid-content for the last emitted id (no
        // marker for the missing id at all).
        !rawText.includes(`${MARKER}${id}${MARKER}`);
      const hint = looksTruncated
        ? ` Response appears truncated after segment "${lastEmitted}" — the model likely hit its output-token limit. Raise \`provider.maxTokens\` or split the source into smaller files.`
        : "";
      throw new Error(`[polystella] model omitted segment "${id}" from response.${hint}\nRaw response was:\n${truncateRaw(rawText)}`);
    }
  }

  return result;
}

function stripCodeFences(text: string): string {
  const fenced = /^```(?:\w+)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  return fenced?.[1]?.trim() ?? text;
}

function truncateRaw(text: string, max = 2000): string {
  if (text.length <= max) return text;
  // Show head + tail so the cutoff point at the END is visible
  // alongside the opening structure at the START.
  const headChars = Math.floor(max / 2);
  const tailChars = max - headChars;
  return `${text.slice(0, headChars)}\n... [truncated middle, total length ${text.length}] ...\n${text.slice(-tailChars)}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localeName(code: string): string {
  try {
    return new Intl.DisplayNames(["en-US"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
