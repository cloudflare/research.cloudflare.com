import type { Root, Yaml } from "mdast";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { inlineSpan, visitTranslatableBlocks } from "./traverse.js";

/**
 * Take an AST that was produced by `parseMarkdown`, a map of
 * `segmentId → translatedText`, and the original source text. Produce a
 * new markdown string with each matching segment replaced by its
 * translation. Untranslated regions are copied verbatim from the source.
 *
 * Implementation note — why we splice the source text instead of using
 * `remark-stringify`:
 *
 *   `remark-stringify` (and its underlying `mdast-util-to-markdown`)
 *   defensively escapes characters in text nodes whose original context
 *   was unambiguous — for example, a `[citation]` typed by the author
 *   becomes `\[citation]` on stringify, and `S&P` becomes `S\&P`. There
 *   is no user-facing knob to disable these escapes, and accepting them
 *   would mean the no-replacement round-trip can never be byte-identical
 *   (which we explicitly require: parsing a doc and applying no
 *   translations must return the source unchanged).
 *
 *   By using mdast `position.offset`s — which `remark-parse` populates
 *   for every node — we can replace just the source spans we care about
 *   (translated body blocks and the frontmatter block) and copy every
 *   untouched character byte-for-byte from the source. The empty-map
 *   case becomes trivially `return source`.
 *
 *   Because both the extractor and the applier target the children's
 *   inline range (not the whole block), a translation may contain its
 *   own inline markdown — `**bold**`, `_italic_`, `` `code` ``, or
 *   `[link](url)` — and those markers re-parse as real Strong /
 *   Emphasis / InlineCode / Link nodes. The block-level prefix
 *   (`# ` for headings, `- ` for list items, `> ` for blockquotes)
 *   sits outside the splice range and is preserved untouched.
 */
export interface ApplyTranslationsOptions {
  /**
   * Frontmatter keys merged into the translated output unconditionally.
   *
   * Used by the integration to inject the AI-translation marker
   * (`aiTranslated`, `aiTranslationModel`, `aiTranslatedAt`) into
   * translated entries — see RFC §3.11. Keys here override any
   * same-named keys already present in the source frontmatter, which
   * is the right precedence: the operator-facing marker reflects the
   * artefact this build produced, not whatever stale value the
   * source happened to carry.
   *
   * Behaviour by source shape:
   *   - Source has frontmatter: additions are merged into the parsed
   *     YAML alongside any in-place translations, then the whole
   *     block is re-stringified and spliced back. Pre-existing keys
   *     not in the additions or translations survive untouched.
   *   - Source has NO frontmatter: a brand-new `---\n<yaml>\n---`
   *     block is prepended at the top of the source, with one blank
   *     line separating it from the body. This keeps the marker
   *     additions out of the body even on plain-markdown sources.
   *
   * Empty object (the default) is a no-op — preserves the prior
   * "no translations + no frontmatter changes = byte-identical
   * source" round-trip property the M3 corpus tests rely on.
   */
  frontmatterAdditions?: Record<string, unknown>;
}

export function applyTranslations(
  ast: Root,
  translations: Map<string, string>,
  source: string,
  options: ApplyTranslationsOptions = {},
): string {
  const additions = options.frontmatterAdditions ?? {};
  const additionKeys = Object.keys(additions);
  const hasAdditions = additionKeys.length > 0;

  // Round-trip preservation: when nothing has changed (no body
  // translations, no frontmatter translations, no additions), return
  // the source verbatim. The corpus identity-round-trip test relies
  // on this short-circuit.
  if (translations.size === 0 && !hasAdditions) {
    return source;
  }

  // Collect every byte-span replacement we want to make. We sort and
  // apply right-to-left so earlier offsets stay valid while we splice.
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  visitTranslatableBlocks(ast, ({ block, id }) => {
    const translation = translations.get(id);
    if (translation === undefined) return;
    // Inline span (children's range), NOT the whole block. This lets us
    // splice INTO the block while the heading `#`, list `-`, blockquote
    // `>` markers stay in place. Same span the extractor used to read
    // source bytes — symmetry is what makes the round-trip work.
    const span = inlineSpan(block);
    if (!span) return;
    edits.push({ ...span, replacement: translation });
  });

  const frontmatterNode = ast.children.find(
    (child): child is Yaml => child.type === "yaml",
  );
  if (frontmatterNode) {
    const fmTranslations = collectFrontmatterTranslations(translations);
    // Re-stringify the frontmatter when we have ANY frontmatter work
    // — translations OR additions OR both. Previously we'd skip the
    // re-write when only additions were present and there were no
    // fm translations; that left the marker out. Adding `hasAdditions`
    // to the gate brings the marker through on every translated file.
    if (fmTranslations.size > 0 || hasAdditions) {
      const fmSpan = nodeSpan(frontmatterNode);
      if (fmSpan) {
        const data = parseYaml(frontmatterNode.value) as Record<
          string,
          unknown
        >;
        for (const [path, translation] of fmTranslations) {
          applyFrontmatterTranslation(data, path, translation);
        }
        // Additions overwrite existing same-name keys (RFC §3.11
        // contract: the marker reflects the current build's output).
        for (const [key, value] of Object.entries(additions)) {
          data[key] = value;
        }
        // `yaml` appends a trailing newline; the parsed `value` never
        // includes one, and we want the same shape between `---` markers.
        const newInner = stringifyYaml(data).replace(/\n+$/, "");
        edits.push({
          ...fmSpan,
          replacement: `---\n${newInner}\n---`,
        });
      }
    }
  } else if (hasAdditions) {
    // No frontmatter in the source, but we have additions to inject.
    // Prepend a fresh YAML block at offset 0. The trailing `\n\n`
    // separates the new block from the body so a downstream parser
    // doesn't see the body's first heading or paragraph fused to the
    // closing `---`.
    const newInner = stringifyYaml(additions).replace(/\n+$/, "");
    const block = `---\n${newInner}\n---\n\n`;
    edits.push({ start: 0, end: 0, replacement: block });
  }

  if (edits.length === 0) {
    return source;
  }

  edits.sort((a, b) => b.start - a.start);
  let output = source;
  for (const edit of edits) {
    output =
      output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  return output;
}

/**
 * Pull `start.offset` and `end.offset` out of an mdast node's position,
 * if both are present. Returns `undefined` if the node has no position
 * info — which shouldn't happen for nodes produced by `remark-parse`
 * but the type definition allows it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nodeSpan(node: any): { start: number; end: number } | undefined {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return undefined;
  return { start, end };
}

/**
 * Pull `fm:*` entries out of the translations map, returning a new map
 * keyed by the path-after-`fm:` (e.g. `title`, `tags[0]`).
 */
function collectFrontmatterTranslations(
  translations: Map<string, string>,
): Map<string, string> {
  const fm = new Map<string, string>();
  for (const [id, value] of translations) {
    if (id.startsWith("fm:")) {
      fm.set(id.slice(3), value);
    }
  }
  return fm;
}

/**
 * Apply a single frontmatter translation. `path` is either `key` (top-
 * level scalar) or `key[i]` (i-th element of a top-level array).
 */
function applyFrontmatterTranslation(
  data: Record<string, unknown>,
  path: string,
  translation: string,
): void {
  const arrayMatch = /^([^[]+)\[(\d+)\]$/.exec(path);
  if (arrayMatch) {
    const key = arrayMatch[1]!;
    const index = Number(arrayMatch[2]!);
    const arr = data[key];
    if (Array.isArray(arr) && index < arr.length) {
      arr[index] = translation;
    }
    return;
  }
  data[path] = translation;
}
