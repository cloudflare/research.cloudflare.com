/**
 * Type-only test for the helper's return-type inference.
 *
 * Verifies that when a caller passes typed source collections and a
 * literal locales array, the output object preserves the per-source
 * schema and adds typed siblings — critical for Astro's
 * `InferEntrySchema<C>` lookup, which produces `any` when the
 * collection's schema can't be statically reached.
 *
 * No assertions are required at runtime; if the file type-checks,
 * the contract holds.
 */
import { buildCollections } from "../../src/content/build.js";

interface FakeZodObject<T> {
  __zod_object: T;
}
interface PublicationData {
  title: string;
  authors: Array<{ collection: "people"; id: string }>;
}
interface PersonData {
  title: string;
  bio: string;
}

const publications = {
  loader: { name: "glob-loader" },
  schema: undefined as unknown as FakeZodObject<PublicationData>,
};
const people = {
  loader: { name: "glob-loader" },
  schema: undefined as unknown as FakeZodObject<PersonData>,
};

const out = buildCollections(
  {
    source: { publications, people },
    locales: ["en-US", "pt-BR", "ja-JP"] as const,
    defaultLocale: "en-US",
  },
  {
    defineCollection: (config) => config,
    glob: () => ({}),
    file: () => ({}),
  },
);

// Source key preserved verbatim.
type _PubsSchema = (typeof out)["publications"]["schema"];
//      ^? FakeZodObject<PublicationData>

// Sibling key carries the same shape as the source.
type _PubsPtBRSchema = (typeof out)["publications__pt-BR"]["schema"];
//      ^? FakeZodObject<PublicationData>

type _PeoplePtBRSchema = (typeof out)["people__pt-BR"]["schema"];
//      ^? FakeZodObject<PersonData>

// People sibling has the people schema, NOT the publications one.
const _peoplePtBR = out["people__pt-BR"];
const _checkPeopleSchema: FakeZodObject<PersonData> = _peoplePtBR.schema;

// Static-error tests: assigning a sibling's schema to the WRONG
// source's schema type should fail. If TS lets this through, the
// mapped type is collapsing and the consumer would lose per-collection
// inference. Active code uses @ts-expect-error to assert that the
// negative case still errors; if the constraint loosens, the
// directive itself becomes the failure.

// @ts-expect-error people sibling's schema is NOT the publications shape
const _wrongTyping: FakeZodObject<PublicationData> = _peoplePtBR.schema;
void _wrongTyping;

// `it` is a placeholder so vitest doesn't complain about an empty
// suite; the file's purpose is the static checks above.
import { describe, it } from "vitest";
describe("buildCollections type inference", () => {
  it("preserves source and sibling per-collection schema types", () => {
    void _checkPeopleSchema;
  });
});
