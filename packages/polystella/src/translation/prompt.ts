import type { Segment } from "../parsing/extract.js";
import type { Glossary } from "../glossary/glossary.js";

/**
 * Prompt construction. Each translated segment is wrapped in a
 * delimited block:
 *
 *   @@<segment-id>@@
 *   <translated text>
 *
 * Beats a JSON-object protocol on small models: no nested syntax,
 * fewer truncation/escaping failures on long Portuguese/CJK content,
 * fewer output tokens. Translated bytes pass through verbatim
 * between markers (no escaping rules).
 *
 * Pure — no I/O, no provider deps — unit-testable without a network.
 */

/** Marker delimiter — `@@` is rare in technical/research prose. */
const MARKER = "@@";

/**
 * Marker-line regex for `parseResponse`. Hardcoded literal (not
 * `new RegExp(MARKER + ...)`) so static analysers (e.g. Semgrep
 * detect-non-literal-regexp) can prove the pattern isn't tainted.
 * MUST stay in sync with `MARKER`; the import-time guard below trips
 * if they drift. Lazy id capture (`[^@\n]+?`) is bounded by line
 * length → linear, no ReDoS surface.
 */
const MARKER_LINE_RE = /^@@([^@\n]+?)@@\s*$/gm;
if (MARKER !== "@@") {
  throw new Error(
    `[polystella] internal invariant violated: MARKER_LINE_RE assumes MARKER === "@@", got ${JSON.stringify(MARKER)}. ` +
      `Update both together.`,
  );
}

export interface BuildPromptInput {
  segments: Segment[];
  glossary: Glossary;
  sourceLocale: string;
  targetLocale: string;
  /** Optional system-prompt line appended after the generic opener. */
  context?: string | undefined;
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
 * Parse marker-delimited response → `Map<segmentId, translation>`.
 * Tolerant: strips code fences, discards preamble. Strict on id
 * set: unknown ids dropped silently (small models hallucinate),
 * omitted expected ids throw with a truncated dump.
 */
export function parseResponse(rawText: string, expectedIds: string[]): Map<string, string> {
  const cleaned = stripCodeFences(rawText.trim());

  // Split on `@@<id>@@` lines. Alternating array shape:
  //   parts[0] = preamble; [1] = id1; [2] = content1; [3] = id2; ...
  const parts = cleaned.split(MARKER_LINE_RE);

  if (parts.length < 3) {
    throw new Error(
      `[polystella] no segment markers in the model response. Expected ${expectedIds.length} markers of the form "${MARKER}<id>${MARKER}". Total length: ${rawText.length} chars.\nRaw response was:\n${truncateRaw(rawText)}`,
    );
  }

  // Odd indices = ids; even indices ≥ 2 = the following content.
  // Hallucinated ids dropped silently; missing expected ids throw
  // below (so this tolerance doesn't mask real failures).
  const expected = new Set(expectedIds);
  const result = new Map<string, string>();
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const id = (parts[i] ?? "").trim();
    const value = (parts[i + 1] ?? "").trim();
    if (id.length === 0) continue;
    if (!expected.has(id)) continue; // hallucinated id; drop
    if (value.length === 0) {
      throw new Error(`[polystella] model returned an empty translation for segment "${id}"`);
    }
    result.set(id, value);
  }

  for (const id of expectedIds) {
    if (!result.has(id)) {
      // Distinguish truncation (no marker for id) from skip
      // (model emitted markers for other ids but not this one).
      const lastEmitted = [...result.keys()].at(-1);
      const totalCharsInResult = [...result.values()].reduce((n, v) => n + v.length, 0);
      const looksTruncated =
        lastEmitted !== undefined && rawText.length > totalCharsInResult && !rawText.includes(`${MARKER}${id}${MARKER}`);
      const hint = looksTruncated
        ? ` Response appears truncated after segment "${lastEmitted}" — the model likely hit its output-token limit. Raise \`provider.maxTokens\` or split the source into smaller files.`
        : "";
      throw new Error(`[polystella] model omitted segment "${id}" from response.${hint}\nRaw response was:\n${truncateRaw(rawText)}`);
    }
  }

  return result;
}

/**
 * Unwrap a triple-backtick code fence if present. Linear scans
 * instead of a regex — `/^```(?:\w+)?\s*\n([\s\S]*?)\n```$/i`
 * backtracks quadratically on adversarial model output (CodeQL
 * js/polynomial-redos). Model output is uncontrolled enough that
 * the linear variant is worth the extra lines.
 */
function stripCodeFences(text: string): string {
  if (!text.startsWith("```") || !text.endsWith("```") || text.length < 6) {
    return text;
  }
  // Opening-fence line ends at first \n. Anything between matches
  // the old regex's `(?:\w+)?\s*` (optional lang tag + whitespace).
  const firstNewline = text.indexOf("\n");
  if (firstNewline === -1) return text;
  // Closing ``` must be preceded by \n (own-line fence).
  const closeIdx = text.length - 3;
  if (text.charCodeAt(closeIdx - 1) !== 10 /* \n */) return text;
  if (closeIdx - 1 <= firstNewline) return text;
  return text.slice(firstNewline + 1, closeIdx - 1).trim();
}

function truncateRaw(text: string, max = 2000): string {
  if (text.length <= max) return text;
  // Head + tail so both opening structure and cutoff are visible.
  const headChars = Math.floor(max / 2);
  const tailChars = max - headChars;
  return `${text.slice(0, headChars)}\n... [truncated middle, total length ${text.length}] ...\n${text.slice(-tailChars)}`;
}

function localeName(code: string): string {
  try {
    return new Intl.DisplayNames(["en-US"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
