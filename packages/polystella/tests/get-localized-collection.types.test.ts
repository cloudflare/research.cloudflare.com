/**
 * Type-only test for `resolveLocalizedCollection`'s generic
 * propagation. The wrapper in `runtime/index.ts` substitutes
 * `CollectionEntry<C>` for `TEntry`; this test pins that the pure
 * resolver preserves the per-entry shape the wrapper passes in (so
 * after-`astro sync`, consumers get full schema-aware inference on
 * `entry.data.*`).
 *
 * No runtime assertions — if this file type-checks, the contract
 * holds. Same shape as `content.types.test.ts`.
 */
import {
  resolveLocalizedCollection,
  type ResolveLocalizedCollectionDeps,
} from "../src/runtime/get-localized-collection.js";
import type { LocalizedEntry, SourceEntryShape } from "../src/runtime/get-localized-entry.js";

interface PublicationEntry extends SourceEntryShape {
  collection: "publications";
  data: {
    title: string;
    year: number;
    authors: Array<{ collection: "people"; id: string }>;
  };
}

const deps: ResolveLocalizedCollectionDeps<PublicationEntry> = {
  defaultLocale: "en-US",
  // Returning a typed list is enough for inference; we don't run
  // the function in the type-test, only assert its return shape.
  getCollection: async (_collection: string) => [],
};

async function check(): Promise<void> {
  const result = await resolveLocalizedCollection<PublicationEntry>({
    collection: "publications",
    locale: "pt-BR",
    deps,
  });

  // Each entry is a `PublicationEntry` PLUS the extension fields.
  const first = result[0];
  if (first === undefined) return;

  // Schema fields preserved verbatim (the whole point of generics).
  const _title: string = first.data.title;
  const _year: number = first.data.year;
  const _authors: Array<{ collection: "people"; id: string }> = first.data.authors;

  // Extension fields present and correctly typed.
  const _isLocalized: boolean = first.isLocalized;
  const _locale: string = first.locale;

  // The full result is `LocalizedEntry<PublicationEntry>[]`.
  const _typed: LocalizedEntry<PublicationEntry>[] = result;

  // Filter callback receives the same extended shape.
  await resolveLocalizedCollection<PublicationEntry>({
    collection: "publications",
    locale: "pt-BR",
    filter: (entry) => {
      // Schema fields readable through `data`.
      const _t: string = entry.data.title;
      // Extension fields readable directly.
      const _l: boolean = entry.isLocalized;
      return entry.isLocalized;
    },
    deps,
  });

  // Static-error guard: assigning the wrong shape to the result
  // should fail. If TS lets this through, generic propagation has
  // collapsed.
  // @ts-expect-error wrong entry shape
  const _wrong: LocalizedEntry<{ collection: "other" }>[] = result;
  void _wrong;

  void _title;
  void _year;
  void _authors;
  void _isLocalized;
  void _locale;
  void _typed;
}

void check;

import { describe, it } from "vitest";
describe("resolveLocalizedCollection type inference", () => {
  it("preserves the per-entry generic and exposes extension fields", () => {
    // The static checks above are the test; this `it` is a placeholder
    // so vitest doesn't complain about an empty suite.
    void check;
  });
});
