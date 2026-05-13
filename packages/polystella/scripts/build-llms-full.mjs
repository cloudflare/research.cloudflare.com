#!/usr/bin/env node
/**
 * Regenerate `llms-full.txt` from the canonical agent docs.
 *
 * `llms-full.txt` is a single-file concatenation of AGENTS.md,
 * ARCHITECTURE.md, and the two SKILL.md files. External retrieval-
 * based agents (per https://llmstxt.org/) can fetch this one file
 * to load the full agent context without crawling the repo.
 *
 * Run from the package root:
 *   pnpm build:llms
 *
 * The test in `tests/docs.test.ts` checks that the file's section
 * ordering matches expectations. It does NOT enforce byte-for-byte
 * equality with the regenerated content — re-run this script after
 * meaningful edits to the source docs.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");

const SOURCES = ["AGENTS.md", "ARCHITECTURE.md", "skills/polystella-consumer/SKILL.md", "skills/polystella-contributor/SKILL.md"];

const HEADER = `# PolyStella — full agent context

This file is the auto-generated concatenation of all agent-facing
docs for the PolyStella package. Regenerate with \`pnpm build:llms\`.

Constituent files (in order):
${SOURCES.map((s) => `  - ${s}`).join("\n")}

---

`;

const parts = SOURCES.map((relPath) => {
  const abs = path.join(PACKAGE_ROOT, relPath);
  const body = readFileSync(abs, "utf8");
  return `<!-- BEGIN ${relPath} -->\n\n${body.trimEnd()}\n\n<!-- END ${relPath} -->\n`;
});

const output = HEADER + parts.join("\n---\n\n");
writeFileSync(path.join(PACKAGE_ROOT, "llms-full.txt"), output);

console.log(`Wrote llms-full.txt (${SOURCES.length} sources, ${output.length} bytes)`);
