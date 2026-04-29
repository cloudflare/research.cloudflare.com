import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyTranslations } from "../src/parsing/apply.js";
import { extractSegments } from "../src/parsing/extract.js";
import { parseMarkdown } from "../src/parsing/parse.js";

/**
 * Identity round-trip on the publications corpus.
 *
 * For every `content/publications/*.md` file in the workspace, run:
 *   parseMarkdown → extractSegments (collect, don't replace)
 *                 → applyTranslations (with empty Map)
 *                 → assert output === source
 *
 * Any divergence is a parser/serializer config bug, and we want to catch
 * it here rather than once translation-related changes are layered on
 * top, where it would be much harder to disentangle.
 *
 * The file list is generated dynamically at module-load time so the test
 * automatically covers any future publications added to the corpus.
 */

const PUBLICATIONS_DIR = resolve(
  fileURLToPath(import.meta.url),
  "../../../../content/publications",
);

const publicationFiles = readdirSync(PUBLICATIONS_DIR)
  .filter((name) => name.endsWith(".md"))
  .sort();

describe("publications corpus round-trip", () => {
  it("finds publication files to test", () => {
    // Sanity: if this fails, the path-resolution above is wrong and every
    // other assertion below is meaningless.
    expect(publicationFiles.length).toBeGreaterThan(0);
  });

  for (const fileName of publicationFiles) {
    it(`${fileName} survives parse → extract → apply(empty) → stringify unchanged`, () => {
      const path = join(PUBLICATIONS_DIR, fileName);
      const source = readFileSync(path, "utf8");

      const ast = parseMarkdown(source);
      // Run extraction so a crash inside the extractor would surface here
      // even on the no-replacement path.
      extractSegments(
        ast,
        {
          sourcePath: `publications/${fileName}`,
          frontmatter: { "publications/**": ["title", "metaDescription"] },
        },
        source,
      );
      const output = applyTranslations(ast, new Map(), source);

      expect(output).toBe(source);
    });
  }
});
