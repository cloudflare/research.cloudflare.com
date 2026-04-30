import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  parseFrontmatter,
  type MarkdownProcessor,
  type MarkdownProcessorRenderResult,
} from "@astrojs/markdown-remark";

import type { AstroMarkdownLike } from "../config/options.js";

/**
 * Build-time markdown rendering for translated content.
 *
 * The build hook produces translated `.md` bytes (frontmatter + body)
 * and stages them under `<stagingDir>/<locale>/<relativePath>`. For
 * pages that use `<Content />` or read `entry.rendered.html` directly,
 * those bytes alone aren't enough — we also need the rendered HTML and
 * the metadata block (headings, image paths, frontmatter).
 *
 * This module owns that step. Given a translated file's bytes, it
 * runs them through Astro's own markdown processor (the one created
 * from the user's `config.markdown`) and writes four sibling files
 * into staging:
 *
 *   <stagingDir>/<locale>/<relPath>                   (translated .md)
 *   <stagingDir>/<locale>/<relPath stem>.html         (rendered HTML)
 *   <stagingDir>/<locale>/<relPath stem>.meta.json    (Astro metadata)
 *   <stagingDir>/<locale>/<relPath stem>.render-cache.json
 *
 * The runtime helper reads the `.html` and `.meta.json` sidecars
 * (when present) and overlays `entry.rendered.{html,metadata}` onto
 * the source-validated entry, so consumer pages see translated HTML
 * for free.
 *
 * Render cache (the `.render-cache.json` sidecar):
 *   Each rendered pair is fingerprinted by `(mdHash, epoch)` where
 *   `mdHash` is SHA-256 of the staged `.md` bytes and `epoch` is a
 *   stable hash of the markdown-config knobs that influence Shiki +
 *   remark/rehype output. On a build where neither has changed and
 *   the `.html`/`.meta.json` sidecars survived (no `rm -rf .astro`),
 *   the `processor.render` call is skipped entirely. See
 *   `computeBuildEpoch` for the exact knob set; functions (plugin
 *   arrays, transformers) are deliberately excluded because they
 *   don't serialize stably — operators must clear staging by hand to
 *   pick up plugin-logic changes.
 *
 * What lives in R2: only the translated `.md` (the cache that gates
 * provider API costs). HTML + metadata + render cache live solely
 * under `.astro/i18n-staging` — local, regenerable, scoped per
 * machine/CI worker.
 */

/**
 * Output of one `renderToStaging` invocation, used by the build
 * hook to keep summary counters. The four states are mutually
 * exclusive and cover every path through the function:
 *
 *   - `rendered`:    fresh render, sidecars written.
 *   - `cache-hit`:   render skipped, existing sidecars validated.
 *   - `mdx-skip`:    `.mdx` source; only `.md` was staged.
 *   - `no-renderer`: caller passed `renderer: undefined`; only
 *                    `.md` was staged. Covers consumers who never
 *                    use `<Content />`.
 */
export type RenderOutcome =
  | "rendered"
  | "cache-hit"
  | "mdx-skip"
  | "no-renderer";

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

/**
 * Subset of `AstroMarkdownLike` knobs that are JSON-serialisable AND
 * known to influence rendered output. Listed explicitly (rather
 * than blindly serialising the whole config object) for two
 * reasons:
 *
 *   1. Functions inside the config — `remarkPlugins`,
 *      `rehypePlugins`, `shikiConfig.transformers` — never
 *      round-trip through `JSON.stringify` reliably. Including
 *      them would either crash on circular refs or produce
 *      unstable epochs.
 *   2. Astro itself adds private internals to its `markdown`
 *      config that aren't part of the public surface; keying off
 *      them would cause spurious cache misses on Astro upgrades
 *      that don't actually change rendering output.
 *
 * The trade-off: changing **plugin logic** without changing any of
 * the listed knobs doesn't bust the cache. Operators reach for
 * `rm -rf .astro/i18n-staging` to force a full re-render, which is
 * cheap and explicit. Documented at the call site.
 */
const EPOCH_KNOBS = [
  "gfm",
  "smartypants",
  "syntaxHighlight",
  "remarkRehype",
  "image",
] as const;

const SHIKI_EPOCH_KNOBS = [
  "theme",
  "themes",
  "langs",
  "langAlias",
  "defaultColor",
  "wrap",
] as const;

/**
 * Hash the stable subset of `markdown` config + the polystella
 * version into a SHA-256 hex string. Used as the second half of
 * the render-cache key alongside the per-file `mdHash`.
 *
 * Stability properties:
 *   - Idempotent: two calls with the same args produce the same
 *     hash.
 *   - Order-insensitive within objects: pulled keys are sorted
 *     before hashing so a config rewrite that reorders fields
 *     doesn't bust the cache.
 *   - Immune to private Astro additions: only the explicit
 *     `EPOCH_KNOBS` + `SHIKI_EPOCH_KNOBS` participate.
 *
 * Bumps automatically when `polystellaVersion` changes — that's the
 * "we changed something rendering-relevant in the package" lever.
 */
export function computeBuildEpoch(
  markdown: AstroMarkdownLike | undefined,
  polystellaVersion: string,
): string {
  const md = (markdown ?? {}) as Record<string, unknown>;
  const shiki = (md.shikiConfig ?? {}) as Record<string, unknown>;
  const stable: Record<string, unknown> = { polystellaVersion };
  for (const key of EPOCH_KNOBS) {
    if (key in md) stable[key] = md[key];
  }
  const shikiStable: Record<string, unknown> = {};
  for (const key of SHIKI_EPOCH_KNOBS) {
    if (key in shiki) shikiStable[key] = shiki[key];
  }
  if (Object.keys(shikiStable).length > 0) {
    stable.shikiConfig = shikiStable;
  }
  return createHash("sha256").update(stableStringify(stable)).digest("hex");
}

/**
 * Recursive deterministic stringifier: like `JSON.stringify` but
 * sorts object keys at every level so `{a:1,b:2}` and `{b:2,a:1}`
 * hash identically. Functions and `undefined` values are dropped
 * to mirror `JSON.stringify`'s behaviour without crashing on the
 * non-serialisable bits we deliberately leave out of the epoch
 * inputs.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "function" || typeof v === "undefined") continue;
    parts.push(`${JSON.stringify(key)}:${stableStringify(v)}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * SHA-256 hex of UTF-8 bytes. Pulled out of `renderToStaging` so
 * tests can construct expected fingerprints without re-implementing
 * the algorithm.
 */
export function computeMdHash(translatedBytes: string): string {
  return createHash("sha256").update(translatedBytes, "utf8").digest("hex");
}

/**
 * Schema of the `.render-cache.json` sidecar. Versioned so we can
 * evolve the cache shape without silent corruption — older sidecars
 * with no `version` (or a version we don't recognise) are treated
 * as a miss.
 */
interface RenderCacheRecord {
  version: 1;
  mdHash: string;
  epoch: string;
  polystellaVersion: string;
  /** ISO-8601 timestamp of the most recent render. Informational. */
  renderedAt: string;
}

const RENDER_CACHE_VERSION = 1 as const;

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
   * Build-config fingerprint from `computeBuildEpoch`. The same
   * value flows through every (file, locale) call in a single
   * build. Stored alongside `mdHash` in the cache sidecar; mismatch
   * → miss.
   */
  buildEpoch: string;
  /**
   * Polystella package version, baked into both the epoch hash
   * input and the cache sidecar metadata. Used for forensic logs
   * (which package version produced this artefact) more than for
   * cache invalidation — the version is already in the epoch.
   */
  polystellaVersion: string;
  /**
   * Called once per `.mdx` source file the helper skips. The build
   * hook should log a one-line warning so consumers notice that MDX
   * pages won't see translated `entry.rendered.html` until MDX
   * rendering lands in a future phase.
   */
  onMdxSkip?: (relativeSourcePath: string) => void;
  /**
   * Filesystem dependency injection. Tests pass in-memory stubs to
   * exercise the writer + cache logic without touching disk.
   * Production callers leave it undefined and get
   * `node:fs/promises`.
   *
   * `readFile` returns the file contents on success, `null` on
   * ENOENT (or any other "the file isn't there"-style error).
   * Other errors should propagate so the operator sees them.
   */
  fs?: {
    mkdir: typeof mkdir;
    writeFile: typeof writeFile;
    readFile: (path: string) => Promise<string | null>;
  };
}

/**
 * Default `readFile` wrapper for production: returns `null` on
 * ENOENT so call sites can branch on existence without a try/catch
 * around every probe.
 */
async function defaultReadFile(
  absolutePath: string,
): Promise<string | null> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

const DEFAULT_FS = {
  mkdir,
  writeFile,
  readFile: defaultReadFile,
};

/**
 * Stage a translated entry: writes the `.md` always, plus `.html`,
 * `.meta.json`, and `.render-cache.json` sidecars when the source
 * extension is `.md` and a renderer is configured. `.mdx` source
 * files get only the `.md` staged; the runtime helper falls back to
 * the source-language `rendered` for those.
 *
 * Render-cache flow (only on `.md` sources with a renderer):
 *
 *   1. Read the existing `.render-cache.json` (if any).
 *   2. Confirm `mdHash` matches the staged bytes AND `epoch`
 *      matches the build epoch AND `.html` + `.meta.json` are still
 *      on disk.
 *   3. On all-confirmed: skip the renderer call entirely; return
 *      `cache-hit`. The .md was already (re)written above.
 *   4. On any mismatch: invoke the renderer, write fresh `.html` +
 *      `.meta.json`, and refresh the cache sidecar.
 *
 * Returns the outcome so the build hook can keep `cache-hit` vs
 * `rendered` counters for the close-of-build summary line.
 */
export async function renderToStaging({
  renderer,
  stagingDir,
  locale,
  relativeSourcePath,
  translatedBytes,
  sourceFileURL,
  buildEpoch,
  polystellaVersion,
  onMdxSkip,
  fs: fsDeps = DEFAULT_FS,
}: RenderToStagingArgs): Promise<RenderOutcome> {
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
  if (renderer === undefined) return "no-renderer";
  const ext = path.extname(relativeSourcePath).toLowerCase();
  if (ext === ".mdx") {
    onMdxSkip?.(relativeSourcePath);
    return "mdx-skip";
  }

  // Strip the source extension and replace with `.html` /
  // `.meta.json` / `.render-cache.json`. Using a regex over the
  // whole staging path (vs. operating on the relative path and
  // re-joining) keeps the call atomic and avoids any subtle
  // path-normalisation drift across platforms.
  const baseStagingPath = stagingMdPath.replace(/\.[^.]+$/, "");
  const htmlPath = `${baseStagingPath}.html`;
  const metaPath = `${baseStagingPath}.meta.json`;
  const cachePath = `${baseStagingPath}.render-cache.json`;

  const mdHash = computeMdHash(translatedBytes);

  // Cache-hit gate: load and validate the previous cache record.
  // Every check below has to pass for us to skip rendering; any
  // one failure → re-render. The cost of the gate is three small
  // file reads, all parallelised — trivial relative to a Shiki
  // render.
  if (
    await isCacheHit({
      cachePath,
      htmlPath,
      metaPath,
      mdHash,
      epoch: buildEpoch,
      readFile: fsDeps.readFile,
    })
  ) {
    return "cache-hit";
  }

  // Cache miss → render, write artefacts, refresh the cache
  // sidecar. Order matters: `.html` and `.meta.json` are written
  // BEFORE `.render-cache.json` so a build interrupted between the
  // two leaves the cache sidecar absent (read as miss next time)
  // rather than pointing at stale outputs.
  const { code: html, metadata } = await renderer.render(
    translatedBytes,
    sourceFileURL,
  );
  await fsDeps.writeFile(htmlPath, html, "utf8");
  await fsDeps.writeFile(metaPath, JSON.stringify(metadata), "utf8");
  const cacheRecord: RenderCacheRecord = {
    version: RENDER_CACHE_VERSION,
    mdHash,
    epoch: buildEpoch,
    polystellaVersion,
    renderedAt: new Date().toISOString(),
  };
  await fsDeps.writeFile(cachePath, JSON.stringify(cacheRecord), "utf8");
  return "rendered";
}

/**
 * Validate a render-cache hit. Returns `true` only when **all** of:
 *
 *   - `cachePath` exists and parses as a `RenderCacheRecord` with
 *     `version === 1`.
 *   - Stored `mdHash` matches the current translated bytes.
 *   - Stored `epoch` matches the current build epoch.
 *   - `htmlPath` and `metaPath` are both still on disk.
 *
 * Any failure → `false` → caller re-renders. Malformed JSON is
 * treated as a miss (not an error) so a hand-edited or partially-
 * written sidecar can't poison subsequent builds.
 */
async function isCacheHit(args: {
  cachePath: string;
  htmlPath: string;
  metaPath: string;
  mdHash: string;
  epoch: string;
  readFile: (path: string) => Promise<string | null>;
}): Promise<boolean> {
  const { cachePath, htmlPath, metaPath, mdHash, epoch, readFile } = args;

  // Read all three "must exist" files in parallel. We only need the
  // sidecar bytes themselves; the html/meta reads are existence
  // probes (their content was validated when previously written).
  const [cacheRaw, htmlRaw, metaRaw] = await Promise.all([
    readFile(cachePath),
    readFile(htmlPath),
    readFile(metaPath),
  ]);
  if (cacheRaw === null || htmlRaw === null || metaRaw === null) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(cacheRaw);
  } catch {
    return false;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== RENDER_CACHE_VERSION
  ) {
    return false;
  }
  const record = parsed as RenderCacheRecord;
  return record.mdHash === mdHash && record.epoch === epoch;
}
