import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { getEntry, type CollectionEntry } from "astro:content";
import {
  defaultLocale,
  frontmatter as frontmatterRules,
  stagingDir,
} from "polystella:runtime-config";

import { resolveFrontmatterKeys } from "../parsing/extract.js";
import {
  normaliseGetLocalizedEntryArgs,
  resolveLocalizedEntry,
  type CollectionEntryRef,
  type LocalizedEntry,
  type SourceEntryShape,
} from "./get-localized-entry.js";

/**
 * Public locale-aware content fetcher.
 *
 * Drop-in companion to Astro's `getEntry` for pages mounted under a
 * locale-prefixed route by PolyStella's shim layer. Two call shapes
 * mirror Astro's own overloads:
 *
 *   - `getLocalizedEntry({ collection, id }, locale?)`
 *   - `getLocalizedEntry(collection, id, locale?)`
 *
 * Returns the **schema-validated source entry** intersected with two
 * extension fields (`isLocalized`, `locale`), with translated values
 * from the staging file surgically merged onto `data` and `body` when
 * the requested locale has a hit. Reference fields, dates, and image
 * assets are inherited from Astro's source-entry pipeline — the
 * runtime never reconstructs them — so `entry.data.authors[i]` stays
 * the validated `{ collection, id }` ref the schema produces.
 *
 * Branches:
 *
 *   - `locale === undefined` / blank / equal to `defaultLocale`:
 *     return the source entry verbatim plus `isLocalized: false`.
 *   - Staged file hit at `<stagingDir>/<locale>/<collection>/<id>.{md,mdx}`:
 *     overlay only the keys configured for translation in
 *     `polystella({ frontmatter })`, replace `body`, set
 *     `isLocalized: true`.
 *   - Staged file miss: same as default-locale path, with the
 *     `isLocalized: false` flag for consumer branching.
 *
 * Returns `undefined` when the source entry itself doesn't exist —
 * matching `getEntry`'s contract exactly so this helper is a true
 * drop-in. Consumer filters typed `(e): e is NonNullable<typeof e>
 * => e !== undefined` work without modification.
 */
// Collection-aware overloads: when the caller pins a collection name
// `C`, the entry shape resolves to `CollectionEntry<C>` (with the
// PolyStella extension fields intersected on top). In a consumer
// project that has run `astro sync`, this carries the real per-
// collection schema, so `entry.data.authors.map(...)` gets full
// inference and `entry.body` / `entry.rendered` are visible.
export function getLocalizedEntry<C extends string>(
  ref: { collection: C; id: string },
  locale?: string,
): Promise<LocalizedEntry<CollectionEntry<C>> | undefined>;
export function getLocalizedEntry<C extends string>(
  collection: C,
  id: string,
  locale?: string,
): Promise<LocalizedEntry<CollectionEntry<C>> | undefined>;
export async function getLocalizedEntry<C extends string>(
  collectionOrRef: C | { collection: C; id: string },
  idOrLocale?: string,
  maybeLocale?: string,
): Promise<LocalizedEntry<CollectionEntry<C>> | undefined> {
  const { collection, id, locale } = normaliseGetLocalizedEntryArgs(
    collectionOrRef as string | CollectionEntryRef,
    idOrLocale,
    maybeLocale,
  );

  const result = await resolveLocalizedEntry({
    collection,
    slug: id,
    locale,
    deps: {
      defaultLocale,
      stagingDir,
      readFile: readFileIfExists,
      joinPath: path.join,
      // Astro's CollectionEntry has more fields than the pure
      // helper's SourceEntryShape declares (`filePath`, `digest`,
      // `rendered`, …) — they survive the {...source} spread inside
      // the helper, so the cast at the dep boundary is structural
      // and lossless.
      getEntry: (c, s) =>
        getEntry(c, s) as Promise<SourceEntryShape | undefined>,
      // Fallback to `{}` rather than trusting the virtual module's
      // shape: a dev server booted against an older virtual-module
      // export (before this field was threaded through) would
      // otherwise crash inside `Object.entries(undefined)` on the
      // first staged-hit lookup. Empty rules ⇒ "no keys
      // translatable", which is the right degraded behaviour.
      frontmatterRules: frontmatterRules ?? {},
      resolveKeys: resolveFrontmatterKeys,
    },
  });
  // The pure helper returns LocalizedEntry against its structural
  // SourceEntryShape; downcast to the consumer-pinned
  // CollectionEntry<C> shape so callers see the real schema.
  return result as LocalizedEntry<CollectionEntry<C>> | undefined;
}

export {
  normaliseGetLocalizedEntryArgs,
  type CollectionEntryRef,
  type LocalizedEntry,
} from "./get-localized-entry.js";

/**
 * Tiny `existsSync + readFileSync` wrapper. Returning `null` on
 * not-found (rather than throwing) is the contract the pure helper
 * expects from its `readFile` dep — keeps the staging-miss path
 * branch-free in the core logic.
 */
function readFileIfExists(absolutePath: string): string | null {
  if (!existsSync(absolutePath)) return null;
  return readFileSync(absolutePath, "utf8");
}
