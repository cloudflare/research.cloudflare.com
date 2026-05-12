import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readOverride, resolveOverridePath } from "../../src/source/overrides.js";

let rootDir: string;

beforeAll(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "polystella-overrides-"));
  // Layout under <rootDir>:
  //   i18n/overrides/pt-BR/publications/sample.md      (the override)
  //   i18n/overrides/pt-BR/blog/article.mdx            (mdx variant)
  //   i18n/overrides/pt-BR/nested/dir/deep.md          (nested dirs)
  // ja-JP has no overrides at all — used for the miss case.
  const ovDir = path.join(rootDir, "i18n", "overrides");
  await mkdir(path.join(ovDir, "pt-BR", "publications"), { recursive: true });
  await mkdir(path.join(ovDir, "pt-BR", "blog"), { recursive: true });
  await mkdir(path.join(ovDir, "pt-BR", "nested", "dir"), { recursive: true });
  await writeFile(path.join(ovDir, "pt-BR", "publications", "sample.md"), "# Override pt-BR\n\nHand-edited.\n");
  await writeFile(path.join(ovDir, "pt-BR", "blog", "article.mdx"), "# Override mdx\n\nWith JSX bits.\n");
  await writeFile(path.join(ovDir, "pt-BR", "nested", "dir", "deep.md"), "# Deep override\n");
});

afterAll(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

describe("readOverride", () => {
  it("returns the file contents when an override exists at the conventional path", async () => {
    const result = await readOverride({
      rootDir,
      overridesDir: "./i18n/overrides",
      locale: "pt-BR",
      relativeSourcePath: "publications/sample.md",
    });
    expect(result).toBe("# Override pt-BR\n\nHand-edited.\n");
  });

  it("returns null when no override exists for the (locale, source) pair", async () => {
    // ja-JP has no overrides directory at all in this fixture.
    const result = await readOverride({
      rootDir,
      overridesDir: "./i18n/overrides",
      locale: "ja-JP",
      relativeSourcePath: "publications/sample.md",
    });
    expect(result).toBeNull();
  });

  it("returns null when the locale directory exists but the specific file does not", async () => {
    // pt-BR exists; "missing.md" does not.
    const result = await readOverride({
      rootDir,
      overridesDir: "./i18n/overrides",
      locale: "pt-BR",
      relativeSourcePath: "publications/missing.md",
    });
    expect(result).toBeNull();
  });

  it("preserves the source extension verbatim (no .md coercion for .mdx)", async () => {
    const result = await readOverride({
      rootDir,
      overridesDir: "./i18n/overrides",
      locale: "pt-BR",
      relativeSourcePath: "blog/article.mdx",
    });
    expect(result).toBe("# Override mdx\n\nWith JSX bits.\n");
  });

  it("supports nested directory paths in the source-relative key", async () => {
    const result = await readOverride({
      rootDir,
      overridesDir: "./i18n/overrides",
      locale: "pt-BR",
      relativeSourcePath: "nested/dir/deep.md",
    });
    expect(result).toBe("# Deep override\n");
  });

  it("propagates non-ENOENT errors (e.g. EACCES) instead of swallowing them", async () => {
    // Create a file we can't read. Skip on platforms where chmod is a
    // no-op (e.g. Windows in CI) — the assertion would be flaky there.
    const restrictedDir = path.join(rootDir, "i18n", "overrides", "pt-BR", "restricted");
    await mkdir(restrictedDir, { recursive: true });
    const restrictedFile = path.join(restrictedDir, "secret.md");
    await writeFile(restrictedFile, "shh");

    try {
      await chmod(restrictedFile, 0o000);
    } catch {
      // chmod not supported here; skip the assertion path.
      return;
    }
    // Running as root would defeat the chmod; skip in that case so
    // the suite stays green in containerised CI that runs as root.
    if (process.getuid?.() === 0) {
      await chmod(restrictedFile, 0o644);
      return;
    }

    await expect(
      readOverride({
        rootDir,
        overridesDir: "./i18n/overrides",
        locale: "pt-BR",
        relativeSourcePath: "restricted/secret.md",
      }),
    ).rejects.toThrow();

    // Restore so afterAll can clean up.
    await chmod(restrictedFile, 0o644);
  });
});

describe("resolveOverridePath", () => {
  it("joins rootDir + overridesDir + locale + relativeSourcePath into an absolute path", () => {
    const p = resolveOverridePath({
      rootDir: "/abs/project",
      overridesDir: "./i18n/overrides",
      locale: "pt-BR",
      relativeSourcePath: "publications/sample.md",
    });
    expect(p).toBe("/abs/project/i18n/overrides/pt-BR/publications/sample.md");
  });

  it("normalises away leading './' and redundant slashes", () => {
    const p = resolveOverridePath({
      rootDir: "/abs/project",
      overridesDir: "./i18n/overrides/",
      locale: "pt-BR",
      relativeSourcePath: "publications/sample.md",
    });
    expect(p).toBe("/abs/project/i18n/overrides/pt-BR/publications/sample.md");
  });
});
