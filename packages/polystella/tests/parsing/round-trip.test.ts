import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyTranslations } from "../../src/parsing/apply.js";
import { extractSegments } from "../../src/parsing/extract.js";
import { parseMarkdown } from "../../src/parsing/parse.js";

/**
 * Identity round-trip on the host monorepo's publications corpus.
 *
 *   parseMarkdown → extractSegments → applyTranslations(empty Map)
 *   assert output === source
 *
 * Acts as a real-world stress test for the parser/serializer config:
 * any byte-level drift on real markdown surfaces here before it
 * affects translations.
 *
 * Skipped when `content/publications` is missing — that's the
 * common case once polystella is extracted into its own repo.
 * The new repo can replace this with its own fixture-based variant.
 */

const PUBLICATIONS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../../content/publications");
const hasCorpus = existsSync(PUBLICATIONS_DIR);

const publicationFiles = hasCorpus
  ? readdirSync(PUBLICATIONS_DIR)
      .filter((name) => name.endsWith(".md"))
      .sort()
  : [];

describe.skipIf(!hasCorpus)("publications corpus round-trip", () => {
  it("finds publication files to test", () => {
    expect(publicationFiles.length).toBeGreaterThan(0);
  });

  for (const fileName of publicationFiles) {
    it(`${fileName} survives parse → extract → apply(empty) → stringify unchanged`, () => {
      const path = join(PUBLICATIONS_DIR, fileName);
      const source = readFileSync(path, "utf8");

      const ast = parseMarkdown(source);
      // Run extraction so a crash inside the extractor would surface
      // here even on the no-replacement path.
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
