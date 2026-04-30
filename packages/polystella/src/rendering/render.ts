import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseFrontmatter,
  type MarkdownProcessor,
  type MarkdownProcessorRenderResult,
} from "@astrojs/markdown-remark";

/**
 * Build-time markdown rendering for translated content.
 *
 * The build hook produces translated `.md` bytes (frontmatter + body)
 * and stages them under `<stagingDir>/<locale>/<relativePath>`. For
 * pages that use `<Content />` or read `entry.rendered.html` directly,
 * those bytes alone aren't enough — we also need the rendered HTML and
 * the metadata block (headings, image paths, frontmatter).
 *
 * This module owns that step: given a translated file's bytes, run
 * them through Astro's own markdown processor (the one created from
 * the user's `config.markdown`), and write three sibling files into
 * staging:
 *
 *   <stagingDir>/<locale>/<relPath>          (the translated .md)
 *   <stagingDir>/<locale>/<relPath stem>.html        (rendered HTML)
 *   <stagingDir>/<locale>/<relPath stem>.meta.json   (metadata JSON)
 *
 * The runtime helper reads the sidecars (when present) and overlays
 * `entry.rendered.{html,metadata}` onto the source-validated entry,
 * so consumer pages see translated HTML for free.
 *
 * Why a dedicated module:
 *   - Keeps `cache.ts` focused on R2 translation caching.
 *   - Makes the rendering pipeline independently testable.
 *   - Concentrates the MDX-skip policy in one place.
 *
 * What lives in R2: only the translated `.md` (the cache stores the
 * thing that costs API calls). Rendering is local CPU + Shiki on
 * every build; if it ever becomes a bottleneck a render cache can
 * be added without touching this module's signature.
 */

/**
 * A configured markdown renderer. Wraps an Astro markdown processor
 * (from `@astrojs/markdown-remark`'s `createMarkdownProcessor`) and
 * narrows its API to the call shape the build hook needs.
 */
export interface Renderer {
  /**
   * Render translated `.md` bytes (frontmatter + body) to HTML +
   * metadata, going through the user's full Astro markdown pipeline
   * (Shiki theme, remark/rehype plugins, etc.).
   *
   * `sourceFileURL` should point at the **source** file location,
   * not the staging path — relative image paths and similar
   * file-relative resolutions are anchored there.
   */
  render(
    bytes: string,
    sourceFileURL: URL,
  ): Promise<MarkdownProcessorRenderResult>;
}

/**
 * Wrap an Astro markdown processor as a `Renderer`. Created once per
 * build and reused across all (file, locale) pairs so Shiki's
 * highlighter cache survives across renders.
 *
 * Astro's processor expects already-stripped content + a separate
 * `frontmatter` opts arg (which plugins can read via
 * `data.astro.frontmatter`). The wrapper handles the split using
 * `parseFrontmatter` — the same helper Astro itself uses when
 * rendering source pages — so the render path matches source-page
 * behaviour byte-for-byte.
 */
export function createRenderer(processor: MarkdownProcessor): Renderer {
  return {
    render: async (bytes, sourceFileURL) => {
      const parsed = parseFrontmatter(bytes);
      return processor.render(parsed.content, {
        fileURL: sourceFileURL,
        frontmatter: parsed.frontmatter,
      });
    },
  };
}

export interface RenderToStagingArgs {
  /**
   * The configured renderer, or `undefined` if rendering is opted
   * out (e.g. a consumer that doesn't use `<Content />` or
   * `entry.rendered.html` anywhere). When undefined, only the `.md`
   * sidecar is written.
   */
  renderer: Renderer | undefined;
  /** Absolute path to the staging root directory. */
  stagingDir: string;
  /** Target locale (the locale-prefixed subdir under staging). */
  locale: string;
  /**
   * Relative path of the source file under `sourceDir`. Forward
   * slashes regardless of platform — same convention `walk.ts` and
   * `extract.ts` use.
   */
  relativeSourcePath: string;
  /**
   * The full translated bytes (frontmatter + body) to stage. Astro's
   * processor strips the frontmatter into `metadata.frontmatter` and
   * renders the body, so passing the whole thing is correct and
   * matches the shape `getLocalizedEntry`'s splitFrontmatter sees.
   */
  translatedBytes: string;
  /**
   * URL pointing at the source file's location on disk. Used as the
   * `fileURL` arg to the markdown processor so relative-path
   * resolutions (image paths, link rewriters) anchor to the source
   * collection layout, not the staging layout.
   */
  sourceFileURL: URL;
  /**
   * Called once per `.mdx` source file the helper skips. The build
   * hook should log a one-line warning so consumers notice that MDX
   * pages won't see translated `entry.rendered.html` until MDX
   * rendering lands in a future phase.
   */
  onMdxSkip?: (relativeSourcePath: string) => void;
  /**
   * Filesystem dependency injection. Tests pass in-memory stubs to
   * exercise the writer without touching disk. Production callers
   * leave it undefined and get `node:fs/promises`.
   */
  fs?: {
    mkdir: typeof mkdir;
    writeFile: typeof writeFile;
  };
}

/**
 * Stage a translated entry: writes the `.md` always, plus `.html`
 * and `.meta.json` sidecars when the source extension is `.md` and a
 * renderer is configured. `.mdx` source files get only the `.md`
 * staged; the runtime helper falls back to the source-language
 * `rendered` for those.
 */
export async function renderToStaging({
  renderer,
  stagingDir,
  locale,
  relativeSourcePath,
  translatedBytes,
  sourceFileURL,
  onMdxSkip,
  fs: fsDeps = { mkdir, writeFile },
}: RenderToStagingArgs): Promise<void> {
  const stagingMdPath = path.join(stagingDir, locale, relativeSourcePath);
  await fsDeps.mkdir(path.dirname(stagingMdPath), { recursive: true });

  // Always write the translated `.md` sidecar — the runtime helper
  // overlays `data` and `body` from this file regardless of whether
  // HTML rendering happens, so the .md path is non-negotiable.
  await fsDeps.writeFile(stagingMdPath, translatedBytes, "utf8");

  // Two short-circuits that produce no HTML/metadata sidecars:
  //   1. Renderer disabled at the call site (no `<Content />` use
  //      case in this consumer; opt-out path).
  //   2. Source is `.mdx` — Astro's MDX pipeline isn't usable from
  //      `@astrojs/markdown-remark`. Skipping is the documented
  //      behaviour; consumers using `<Content />` on translated MDX
  //      get source-language HTML with `isLocalized: true` so a
  //      banner / note can flag the partial translation.
  if (renderer === undefined) return;
  const ext = path.extname(relativeSourcePath).toLowerCase();
  if (ext === ".mdx") {
    onMdxSkip?.(relativeSourcePath);
    return;
  }

  const { code: html, metadata } = await renderer.render(
    translatedBytes,
    sourceFileURL,
  );

  // Strip the source extension and replace with `.html` / `.meta.json`.
  // Using a regex over the whole staging path (vs. operating on the
  // relative path and re-joining) keeps the call atomic and avoids
  // any subtle path-normalisation drift across platforms.
  const baseStagingPath = stagingMdPath.replace(/\.[^.]+$/, "");
  await fsDeps.writeFile(`${baseStagingPath}.html`, html, "utf8");
  await fsDeps.writeFile(
    `${baseStagingPath}.meta.json`,
    JSON.stringify(metadata),
    "utf8",
  );
}
