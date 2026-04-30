import { parse as parseYaml } from "yaml";

/**
 * Reference shape for the cross-collection lookup form. Mirrors the
 * shape Astro's content layer surfaces for `reference()` schema
 * fields and for `getEntry`'s reference overload.
 */
export interface CollectionEntryRef {
  collection: string;
  id: string;
}

/**
 * Disambiguate the two `getLocalizedEntry` overloads into a flat
 * `{ collection, id, locale }` shape:
 *
 *   - First arg is a string → tuple form: `(collection, id, locale)`.
 *   - First arg is an object → ref form: `(ref, locale)`. The second
 *     positional arg is the locale, NOT the id (the id lives on
 *     the ref). A third positional arg is silently ignored in this
 *     branch — there's no meaningful interpretation for it.
 *
 * Lives in the pure module (rather than next to the public wrapper)
 * so tests can pin its behaviour without pulling in `astro:content`
 * or the runtime-config virtual module.
 */
export function normaliseGetLocalizedEntryArgs(
  collectionOrRef: string | CollectionEntryRef,
  idOrLocale: string | undefined,
  maybeLocale: string | undefined,
): { collection: string; id: string; locale: string | undefined } {
  if (typeof collectionOrRef === "string") {
    if (typeof idOrLocale !== "string") {
      throw new TypeError(
        "[polystella] getLocalizedEntry(collection, id, locale?): `id` is required when the first argument is a string.",
      );
    }
    return {
      collection: collectionOrRef,
      id: idOrLocale,
      locale: maybeLocale,
    };
  }
  return {
    collection: collectionOrRef.collection,
    id: collectionOrRef.id,
    locale: idOrLocale,
  };
}

/**
 * Build-time runtime helper for locale-aware content lookup.
 *
 * Pages built into the locale-prefixed routes use this helper instead
 * of `getEntry` to swap in translated bytes when present. The helper
 * is dependency-injected so the consumer-facing wrapper in
 * `src/runtime/index.ts` can fold in the real `getEntry` from
 * `astro:content` and the staged-file location, while tests pass
 * synthetic deps and stay package-internal.
 */

/**
 * Minimum fields the runtime needs to read off whatever Astro's
 * `getEntry` returned. The helper preserves every other field via
 * spread — `filePath`, `digest`, schema-validated nested objects,
 * etc. — so the consumer sees the exact shape `getEntry` would have
 * given them, with translated values surgically swapped in. Keeping
 * this structural means tests can pass tiny inline fixtures without
 * simulating Astro's full entry shape.
 *
 * `rendered` is declared explicitly (rather than left to the spread
 * to round-trip blindly) because the staged-hit path may overlay
 * it from the sidecar `.html` + `.meta.json` files written by the
 * build hook's renderer — and overlaying needs the field to be
 * statically known.
 */
export interface SourceEntryShape {
  collection: string;
  id: string;
  data: Record<string, unknown>;
  body?: string;
  rendered?: {
    html: string;
    metadata: unknown;
  };
}

/**
 * The shape `getLocalizedEntry` returns: the source entry verbatim
 * (preserving `filePath`, `digest`, `rendered`, schema-validated
 * refs, etc.) intersected with two PolyStella extension fields.
 *
 *   - `isLocalized`: `true` when the staged translation was found and
 *     overlaid; `false` when the helper fell back to source content
 *     (default-locale call, missing staged file).
 *   - `locale`: the locale this entry represents — the requested
 *     `locale` on a hit, or the default locale on any fallback path.
 *
 * The generic defaults to `SourceEntryShape` for tests; the public
 * wrapper substitutes Astro's `CollectionEntry<C>` so consumers get
 * full schema-aware inference (`data.authors` typed as the
 * resolved `reference("people")` array, etc.).
 */
export type LocalizedEntry<TEntry extends SourceEntryShape = SourceEntryShape> =
  TEntry & {
    isLocalized: boolean;
    locale: string;
  };

export interface ResolveLocalizedEntryDeps {
  /** Source/canonical locale, derived from Astro's `i18n.defaultLocale`. */
  defaultLocale: string;
  /** Absolute path to the build-time staging directory. */
  stagingDir: string;
  /** Read a UTF-8 file. Returns `null` when the file does not exist. */
  readFile: (absolutePath: string) => string | null;
  /** Path-join function. Pulled out for test determinism on Windows. */
  joinPath: (...segments: string[]) => string;
  /**
   * Astro's `getEntry` (or a test stub). Called for **every** lookup —
   * not just the fallback path — because the merge-over-source model
   * needs the schema-validated source entry as its skeleton even on a
   * staging hit. Reference fields, dates, and image assets all live
   * on the source entry's `data`; the runtime never reconstructs them.
   */
  getEntry: (
    collection: string,
    slug: string,
  ) => Promise<SourceEntryShape | undefined>;
  /**
   * Per-glob translatable-keys map (e.g. `{ "publications/**":
   * ["title", "metaDescription"] }`). Drives which keys from a staged
   * frontmatter overlay onto the source entry's `data`. Keys not
   * listed for any matching glob are silently ignored — only the
   * configured translation contract is honoured.
   */
  frontmatterRules: Record<string, string[]>;
  /**
   * Glob-matcher hook. Receives the entry's source-relative path
   * (e.g. `publications/Antunes2025`) and the rules map; returns the
   * unioned list of keys to overlay. Pulled out as a dep so the pure
   * helper has no `picomatch` import — tests can pass a trivial
   * by-collection-prefix matcher and the integration passes the same
   * `resolveFrontmatterKeys` the build hook uses.
   */
  resolveKeys: (
    sourcePath: string,
    rules: Record<string, string[]>,
  ) => string[];
}

export interface ResolveLocalizedEntryInput {
  collection: string;
  slug: string;
  /** Visitor's locale; `undefined` means "the default locale". */
  locale: string | undefined;
  deps: ResolveLocalizedEntryDeps;
}

/**
 * Core lookup logic for `getLocalizedEntry`. Runs at page-render time
 * (build time for static output) using a merge-over-source model:
 *
 *   1. Always fetch the source entry via `deps.getEntry`. If it
 *      doesn't exist, return `undefined` — matches `getEntry`'s
 *      missing-entry sentinel exactly so the helper is a true
 *      drop-in.
 *   2. If `locale` is missing/blank/equal to `defaultLocale`, return
 *      the source entry verbatim with `isLocalized: false` and
 *      `locale: defaultLocale`. No filesystem probe.
 *   3. Otherwise probe `<stagingDir>/<locale>/<collection>/<slug>.{md,mdx}`
 *      in order. On miss, fall back to the source entry as in (2)
 *      but with `isLocalized: false` flagging the consumer.
 *   4. On hit, parse the staged frontmatter+body, look up the
 *      translatable-keys list for this `<collection>/<slug>` path
 *      via `deps.resolveKeys`, and overlay only those keys onto the
 *      source's `data`. Replace `body` with the staged body.
 *      Everything else — `filePath`, `digest`, `rendered`,
 *      schema-validated refs/dates/assets — is preserved from
 *      source.
 *
 * Why merge instead of replace? The staged YAML doesn't go through
 * Astro's schema, so reference fields come out as bare strings
 * (`["mario-antunes", ...]`) instead of validated refs
 * (`[{ collection: "people", id: "mario-antunes" }, ...]`). Anchoring
 * on the source entry lets us inherit Astro's schema work for free
 * and only swap the values we deliberately translated.
 */
export async function resolveLocalizedEntry(
  input: ResolveLocalizedEntryInput,
): Promise<LocalizedEntry | undefined> {
  const { collection, slug, locale, deps } = input;

  // Always anchor on the source entry; we either return it as-is
  // (fallback) or use it as the merge skeleton (staging hit).
  const source = await deps.getEntry(collection, slug);
  if (source === undefined) return undefined;

  // Branch 1: default locale → source verbatim. Add the extension
  // fields so the consumer can still branch on `isLocalized` even on
  // the no-translation-needed path.
  if (
    locale === undefined ||
    locale === "" ||
    locale === deps.defaultLocale
  ) {
    return withExtensions(source, false, deps.defaultLocale);
  }

  // Branch 2: probe the staging directory in extension order. The
  // build hook preserves the source's extension, so on a real site
  // exactly one of these will hit per pair. `null` from `readFile`
  // means ENOENT (the dep contract); any other error class should
  // propagate from the dep itself.
  for (const ext of [".md", ".mdx"] as const) {
    const candidate = deps.joinPath(
      deps.stagingDir,
      locale,
      collection,
      `${slug}${ext}`,
    );
    const raw = deps.readFile(candidate);
    if (raw === null) continue;
    return mergeStagedOnSource({
      source,
      rawPath: candidate,
      raw,
      collection,
      slug,
      locale,
      deps,
    });
  }

  // Branch 3: no staged file. Fall back to source with
  // `isLocalized: false` so a consumer can surface a "translation
  // pending" treatment when desired.
  return withExtensions(source, false, deps.defaultLocale);
}

/**
 * Attach the PolyStella extension fields to a source entry without
 * mutating it. Used on the default-locale and missing-staging-file
 * paths where the entire entry round-trips unchanged.
 */
function withExtensions(
  source: SourceEntryShape,
  isLocalized: boolean,
  locale: string,
): LocalizedEntry {
  return { ...source, isLocalized, locale };
}

/**
 * Apply the staged file's translations onto the source entry. The
 * skeleton is the source entry verbatim — preserving every Astro-
 * computed field (refs, dates, assets, filePath, digest) — and we
 * surgically overlay:
 *
 *   - `data[k]` for every `k` listed in the configured translatable
 *     keys for this `<collection>/<slug>` path that is also present
 *     in the staged frontmatter. Keys outside that intersection are
 *     left untouched.
 *   - `body` from the staged file's body (post-translation markdown).
 *   - `rendered.{html,metadata}` from the sibling `.html` and
 *     `.meta.json` files (when both exist). The build hook's
 *     renderer writes them alongside the `.md` for `.md` sources;
 *     `.mdx` sources skip rendering, so for those the source's
 *     `rendered` survives the merge intact.
 */
function mergeStagedOnSource(args: {
  source: SourceEntryShape;
  rawPath: string;
  raw: string;
  collection: string;
  slug: string;
  locale: string;
  deps: ResolveLocalizedEntryDeps;
}): LocalizedEntry {
  const { source, rawPath, raw, collection, slug, locale, deps } = args;
  const { data: stagedData, body: stagedBody } = splitFrontmatter(raw);

  const sourcePath = `${collection}/${slug}`;
  const translatableKeys = deps.resolveKeys(sourcePath, deps.frontmatterRules);

  const overlay: Record<string, unknown> = {};
  for (const key of translatableKeys) {
    if (key in stagedData) {
      overlay[key] = stagedData[key];
    }
  }

  // Probe for the sibling `.html` and `.meta.json` files the build
  // hook's renderer writes alongside the staged `.md`. Strip the
  // staged file's extension off `rawPath` to get the shared stem.
  // Both must exist to overlay `rendered`; if either is missing
  // (e.g. `.mdx` source where the renderer skipped, or older staged
  // content from before this overlay landed), source's `rendered`
  // survives the spread untouched.
  const stagedStem = rawPath.replace(/\.[^./\\]+$/, "");
  const stagedHtml = deps.readFile(`${stagedStem}.html`);
  const stagedMetaJson = deps.readFile(`${stagedStem}.meta.json`);
  const renderedOverlay =
    stagedHtml !== null && stagedMetaJson !== null
      ? {
          rendered: {
            html: stagedHtml,
            metadata: JSON.parse(stagedMetaJson) as unknown,
          },
        }
      : {};

  return {
    ...source,
    ...renderedOverlay,
    data: { ...source.data, ...overlay },
    body: stagedBody,
    isLocalized: true,
    locale,
  };
}

/**
 * Split a YAML-frontmatter markdown buffer into `{ data, body }`.
 * Tolerant: a buffer with no frontmatter fences round-trips cleanly
 * with empty data and the entire buffer as the body. Exposed for
 * unit tests; not part of the public package surface.
 */
export function splitFrontmatter(raw: string): {
  data: Record<string, unknown>;
  body: string;
} {
  // Match the leading `---` fence, capture the YAML, then capture the
  // body. Tolerates `\r\n` line endings (windows-authored overrides)
  // and the absence of a trailing newline on the closing fence.
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  const parsed = parseYaml(match[1]) as Record<string, unknown> | null;
  return { data: parsed ?? {}, body: match[2] };
}
