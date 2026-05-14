#!/usr/bin/env tsx
/**
 * Sanity-check that every public export path in `package.json` is
 * mentioned at least once on the `reference/exports` docs page.
 *
 * Catches the "new export, forgot to document it" regression that
 * would otherwise surface only when someone tries to import from
 * the path and finds nothing in the docs.
 *
 * Exit codes:
 *   0  every exports entry is mentioned in reference/exports.md
 *   1  one or more entries are missing — print the list and exit
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOCS_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PACKAGE_JSON = path.join(DOCS_ROOT, "..", "package.json");
const EXPORTS_PAGE = path.join(DOCS_ROOT, "src", "content", "docs", "reference", "exports.md");

interface PackageJson {
  name: string;
  exports?: Record<string, unknown>;
}

async function main(): Promise<void> {
  const pkg = JSON.parse(await readFile(PACKAGE_JSON, "utf8")) as PackageJson;
  const exportsField = pkg.exports;
  if (!exportsField || typeof exportsField !== "object") {
    console.error("[check-exports] package.json has no `exports` map.");
    process.exitCode = 1;
    return;
  }

  // Build the list of import paths a consumer can write. The map's
  // keys are subpaths starting with `.` (e.g. `.`, `./content`).
  // Translate to the consumer-facing form: `polystella`,
  // `polystella/content`, etc.
  const importPaths = Object.keys(exportsField).map((key) => {
    if (key === ".") return pkg.name;
    return `${pkg.name}${key.slice(1)}`;
  });

  const exportsPageContent = await readFile(EXPORTS_PAGE, "utf8");

  const missing: string[] = [];
  for (const importPath of importPaths) {
    if (!exportsPageContent.includes(`\`${importPath}\``)) {
      missing.push(importPath);
    }
  }

  if (missing.length === 0) {
    console.log(`[check-exports] ${importPaths.length} export paths, all documented.`);
    return;
  }

  console.error("[check-exports] the following export paths are NOT mentioned in reference/exports.md:");
  for (const m of missing) console.error(`  - ${m}`);
  console.error(
    `\nAdd a row for each missing path to ${path.relative(process.cwd(), EXPORTS_PAGE)} ` +
      "(typically as a row in the path/purpose table, with the path wrapped in backticks).",
  );
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("[check-exports] failed:", err);
  process.exitCode = 1;
});
