import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyTranslations } from "./apply.js";
import { extractSegments } from "./extract.js";
import { parseMarkdown } from "./parse.js";

/**
 * M3.4 — Identity round-trip on the publications corpus.
 *
 * For every `content/publications/*.md` file in the workspace, run:
 *   parseMarkdown → extractSegments (collect, don't replace)
 *                 → applyTranslations(empty map)
 *                 → assert output === source
 *
 * Any divergence is a parser/serializer config bug to fix here, not in a
 * later milestone where it would be much harder to disentangle from
 * translation-related changes.
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

describe("M3.4 — publications corpus round-trip", () => {
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
