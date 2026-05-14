#!/usr/bin/env tsx
/**
 * Walk `docs/examples/<slug>/` and run `astro check` against each
 * example project. Catches the "we changed PolyStella's API in a
 * way the documented examples no longer compile against" class of
 * regression.
 *
 * For v0.x the examples directory is empty (the cookbook recipes
 * exist but don't have companion projects yet). The script reports
 * "no examples" and exits cleanly so CI doesn't fail prematurely.
 *
 * Exit codes:
 *   0  no examples present, OR every example checks clean
 *   1  one or more examples failed `astro check`
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const DOCS_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EXAMPLES_DIR = path.join(DOCS_ROOT, "examples");

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function listExamples(): Promise<string[]> {
  const entries = await readdir(EXAMPLES_DIR);
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "README.md") continue;
    const full = path.join(EXAMPLES_DIR, entry);
    if (!(await isDirectory(full))) continue;
    // An example must have a package.json — anything else is
    // probably not a runnable project.
    if (!(await isDirectory(full))) continue;
    try {
      await stat(path.join(full, "package.json"));
      out.push(entry);
    } catch {
      console.warn(`[check-examples] skipping ${entry} (no package.json)`);
    }
  }
  return out;
}

async function checkExample(slug: string): Promise<{ slug: string; ok: boolean; output: string }> {
  const dir = path.join(EXAMPLES_DIR, slug);
  const result = spawnSync("pnpm", ["exec", "astro", "check"], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { slug, ok: result.status === 0, output };
}

async function main(): Promise<void> {
  if (!(await isDirectory(EXAMPLES_DIR))) {
    console.log("[check-examples] no examples directory; nothing to check.");
    return;
  }

  const examples = await listExamples();
  if (examples.length === 0) {
    console.log("[check-examples] examples directory is empty; nothing to check.");
    return;
  }

  console.log(`[check-examples] checking ${examples.length} example${examples.length === 1 ? "" : "s"}…`);

  let failures = 0;
  for (const slug of examples) {
    const result = await checkExample(slug);
    if (result.ok) {
      console.log(`  ✓ ${slug}`);
    } else {
      failures++;
      console.error(`  ✗ ${slug}`);
      console.error(result.output);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[check-examples] failed:", err);
  process.exitCode = 1;
});
