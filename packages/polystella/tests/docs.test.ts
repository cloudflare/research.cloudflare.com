/**
 * Doc-claim invariants.
 *
 * Pins file paths, command names, exported subpaths, and slug
 * anchors referenced in `AGENTS.md`, `ARCHITECTURE.md`, and the
 * skill files. Catches refactors that move files or rename
 * subcommands without updating docs.
 *
 * The test is intentionally narrow: it asserts the FACTS that docs
 * lean on, not their PROSE. Editing prose is free; restructuring
 * the code is what should ping this test.
 *
 * If you fail this test:
 *   - Update the docs to reference the new path/name, OR
 *   - Update this test's pinned list to reflect the new fact.
 *
 * Don't add assertions for prose claims here. That belongs in code
 * review, not CI.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseSubcommand } from "../src/cli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");

function readDoc(relPath: string): string {
  return readFileSync(path.join(PACKAGE_ROOT, relPath), "utf8");
}

function fileExists(relPath: string): boolean {
  return existsSync(path.join(PACKAGE_ROOT, relPath));
}

describe("doc-claim invariants", () => {
  describe("AGENTS.md", () => {
    it("exists", () => {
      expect(fileExists("AGENTS.md")).toBe(true);
    });

    it("references files that actually exist", () => {
      // Pinned list of source paths the doc names. If you remove
      // one from the doc, remove it here. If you rename one, rename
      // both. New refs from the doc don't need a pin here unless they
      // matter for navigation.
      const referenced = [
        "src/parsing/adapter.ts",
        "src/parsing/registry.ts",
        "src/cli.ts",
        "src/storage/hash.ts",
        "src/storage/cache.ts",
        "src/translation/provider.ts",
        "src/translation/batch.ts",
        "src/translation/translate-segments.ts",
        "src/translation/run.ts",
        "src/runtime/custom-loader-runtime.ts",
        "src/version.ts",
        "src/cli/check-ui.ts",
        "src/cli/sync-ui.ts",
        "src/cli/translate-ui.ts",
      ];
      for (const p of referenced) {
        expect(fileExists(p), `AGENTS.md references ${p} which does not exist`).toBe(true);
      }
    });

    it("companion docs exist", () => {
      expect(fileExists("ARCHITECTURE.md")).toBe(true);
      expect(fileExists("README.md")).toBe(true);
      expect(fileExists("skills/polystella-contributor/SKILL.md")).toBe(true);
      expect(fileExists("skills/polystella-consumer/SKILL.md")).toBe(true);
    });

    it("does not reference monorepo-specific paths", () => {
      // The package will be filter-repo'd into its own repo. Anything
      // mentioning the monorepo, the research site, or its fixtures
      // won't survive the split as a meaningful reference.
      const text = readDoc("AGENTS.md");
      expect(text).not.toMatch(/monorepo root/i);
      expect(text).not.toMatch(/research[-\s]?site/i);
      expect(text).not.toMatch(/research\.cloudflare\.com/i);
    });
  });

  describe("ARCHITECTURE.md", () => {
    it("exists", () => {
      expect(fileExists("ARCHITECTURE.md")).toBe(true);
    });

    it("uses slug anchors (not section numbers) for internal links", () => {
      const text = readDoc("ARCHITECTURE.md");
      // No "§N" or "§N.M" style references anywhere in the body.
      // The previous doc used these and they rotted on insertion.
      expect(text).not.toMatch(/§\d+/);
    });

    it("declares all anchors that AGENTS.md links to", () => {
      const agents = readDoc("AGENTS.md");
      const architecture = readDoc("ARCHITECTURE.md");

      const anchorRefs: string[] = [];
      for (const match of agents.matchAll(/ARCHITECTURE\.md#([\w-]+)/g)) {
        const slug = match[1];
        if (slug !== undefined) anchorRefs.push(slug);
      }

      const uniqueRefs = [...new Set(anchorRefs)];
      expect(uniqueRefs.length).toBeGreaterThan(0);

      for (const slug of uniqueRefs) {
        // Slug anchors are written as `<a id="slug"></a>` immediately
        // after the section heading. Accept either form (matches
        // GitHub's auto-generated heading anchors too).
        const hasExplicit = architecture.includes(`<a id="${slug}"></a>`);
        const hasHeading = new RegExp(`^#+ .*\\b${slug.replace(/-/g, "[\\s-]")}\\b`, "im").test(architecture);
        expect(hasExplicit || hasHeading, `AGENTS.md links to ARCHITECTURE.md#${slug} but no anchor or matching heading exists`).toBe(true);
      }
    });

    it("declares the same invariant count as AGENTS.md", () => {
      const agentsInvariants = (readDoc("AGENTS.md").match(/^\d+\. \*\*/gm) ?? []).length;
      const archInvariants = (
        readDoc("ARCHITECTURE.md")
          .split(/## Invariants/)[1]
          ?.split(/\n## /)[0]
          ?.match(/^\d+\. \*\*/gm) ?? []
      ).length;
      // Both docs enumerate invariants. They should agree.
      expect(agentsInvariants).toBeGreaterThan(0);
      expect(archInvariants).toBeGreaterThan(0);
      expect(archInvariants).toBe(agentsInvariants);
    });
  });

  describe("CLI / package.json alignment", () => {
    it("package.json `bin` points to a built path", () => {
      const pkg = JSON.parse(readDoc("package.json")) as { bin?: Record<string, string> };
      expect(pkg.bin).toBeDefined();
      expect(pkg.bin?.["polystella"]).toBe("./dist/cli.js");
    });

    it("`parseSubcommand` accepts every documented subcommand", () => {
      // The doc claims these four subcommands exist. The CLI's
      // dispatcher must recognise each one as a known subcommand
      // (not "unknown"). This catches rename-doc-without-rename-code
      // and vice versa.
      const documented = ["translate", "check-ui", "sync-ui", "translate-ui"];
      for (const verb of documented) {
        const result = parseSubcommand([verb]);
        expect(result.name, `subcommand "${verb}" not recognised by parseSubcommand`).toBe(verb);
      }
    });

    it("every CLI subcommand has a handler file", () => {
      // translate is handled inline in src/cli.ts; the rest have
      // dedicated files under src/cli/.
      expect(fileExists("src/cli/check-ui.ts")).toBe(true);
      expect(fileExists("src/cli/sync-ui.ts")).toBe(true);
      expect(fileExists("src/cli/translate-ui.ts")).toBe(true);
    });
  });

  describe("package.json `exports`", () => {
    it("every documented subpath is declared in `exports`", () => {
      const pkg = JSON.parse(readDoc("package.json")) as {
        exports?: Record<string, unknown>;
      };
      const documented = [".", "./runtime", "./content", "./i18n", "./react", "./client"];
      for (const subpath of documented) {
        expect(pkg.exports?.[subpath], `package.json exports does not declare ${subpath}`).toBeDefined();
      }
    });

    it("every entry-point file in `exports` exists", () => {
      const pkg = JSON.parse(readDoc("package.json")) as {
        exports?: Record<string, unknown>;
      };
      const exports = pkg.exports ?? {};
      for (const [subpath, value] of Object.entries(exports)) {
        if (typeof value === "string") {
          expect(fileExists(value), `exports["${subpath}"] = ${value}, but file does not exist`).toBe(true);
        } else if (value && typeof value === "object") {
          // Conditional exports — pick the default target.
          const entry = (value as { default?: unknown }).default;
          if (typeof entry === "string") {
            expect(fileExists(entry), `exports["${subpath}"].default = ${entry}, but file does not exist`).toBe(true);
          }
        }
      }
    });
  });

  describe("skills", () => {
    it("each skill has a SKILL.md with frontmatter `name` matching its directory", () => {
      for (const slug of ["polystella-contributor", "polystella-consumer"]) {
        const text = readDoc(`skills/${slug}/SKILL.md`);
        const fmMatch = text.match(/^---\n([\s\S]+?)\n---/);
        expect(fmMatch, `skills/${slug}/SKILL.md is missing frontmatter`).not.toBeNull();
        const fm = fmMatch![1];
        expect(fm).toMatch(new RegExp(`^name:\\s*${slug}\\s*$`, "m"));
        expect(fm).toMatch(/^description:\s*\S/m);
      }
    });
  });

  describe("llms.txt", () => {
    it("exists and references the canonical agent docs", () => {
      expect(fileExists("llms.txt")).toBe(true);
      const text = readDoc("llms.txt");
      // The slim index should at least mention the package name and
      // point at the deeper docs.
      expect(text).toMatch(/polystella/i);
      expect(text.toLowerCase()).toContain("agents.md");
      expect(text.toLowerCase()).toContain("architecture.md");
    });

    it("llms-full.txt bundles the canonical agent docs in order", () => {
      expect(fileExists("llms-full.txt")).toBe(true);
      const text = readDoc("llms-full.txt");
      // The build script emits `<!-- BEGIN <path> -->` markers around
      // each source doc. Use those (rather than freeform body text)
      // so the ordering check is robust to the header's file-listing
      // table mentioning the same names earlier in the file.
      const agentsIdx = text.indexOf("<!-- BEGIN AGENTS.md -->");
      const archIdx = text.indexOf("<!-- BEGIN ARCHITECTURE.md -->");
      const consumerIdx = text.indexOf("<!-- BEGIN skills/polystella-consumer/SKILL.md -->");
      const contributorIdx = text.indexOf("<!-- BEGIN skills/polystella-contributor/SKILL.md -->");
      expect(agentsIdx).toBeGreaterThanOrEqual(0);
      expect(archIdx).toBeGreaterThan(agentsIdx);
      expect(consumerIdx).toBeGreaterThan(archIdx);
      expect(contributorIdx).toBeGreaterThan(archIdx);
    });
  });
});
