// 1. Import utilities from `astro:content`
import { defineCollection, reference } from "astro:content";

// 2. Import loader(s)
import { glob, file } from "astro/loaders";
import { blogLoader } from "./loaders/blog";

// 3. Import Zod
import { z } from "astro/zod";

// 4. Import the PolyStella helpers for dynamic collections and i18n
import { polystellaCollections } from "polystella/content";
import { i18nLoader, i18nSchema } from "polystella/i18n";

// 5. Define your collection(s)
const site = defineCollection({
  loader: file("./content/site.toml"),
  schema: z.object({
    featuredResearch: z.object({
      publication: reference("publications"),
      title: z.string(),
      description: z.string(),
      link: z.string(),
      buttonLabel: z.string().default("Read the Full Article"),
    }),
  }),
});

const people = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./content/people" }),
  schema: z.object({
    title: z.string(),
    position: z.string(),
    author_name: z.string().optional(),
    status: z.string().optional(),
    twitter: z.string().optional().optional(),
    bluesky: z.string().optional().optional(),
    blog_author: z.string().optional(),
    avatar: z.string(),
    slug: z.string(),
    type: z.enum(["active", "alumni", "external", "intern", "inactive"]),
  }),
});

const presentations = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./content/presentations" }),
  schema: z.object({
    title: z.string(),
    year: z.number(),
    thumbnail: z.string().optional(),
    youtube: z.string(),
    related_interests: z.array(z.string()).optional(),
  }),
});

const tags = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./content/tags" }),
  schema: z.object({
    name: z.string(),
    slug: z.string(),
    description: z.string().optional(),
    color: z.enum([
      "blue",
      "purple",
      "green",
      "orange",
      "white",
      "red",
      "yellow",
      "pink",
    ]),
  }),
});

const publications = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./content/publications" }),
  schema: z.object({
    title: z.string(),
    year: z.number().optional(),
    date: z.coerce.date().optional(),
    location: z.string().optional(),
    authors: z.array(reference("people")).optional(),
    url: z.string().optional(),
    doi: z.string().optional(),
    related_interests: z.array(z.string()).optional(),
    pillar: z
      .enum(["private", "safe", "fast", "reliable", "measurable"])
      .optional(),
    tags: z.array(reference("tags")).optional(),
  }),
});

const blog = defineCollection({
  loader: blogLoader(),
  schema: z.object({
    title: z.string(),
    date: z.date(),
    url: z.string().url(),
    excerpt: z.string(),
    image: z.string().optional(),
    author: reference("people").optional(),
    pillar: z
      .enum(["private", "safe", "fast", "reliable", "measurable"])
      .optional(),
    tags: z.array(reference("tags")).optional(),
  }),
});

const i18n = defineCollection({
  loader: i18nLoader(),
  schema: i18nSchema(),
});

// 6. Export a single `collections` object to register your collection(s).
//    `polystellaCollections` returns the source collections verbatim
//    plus, for each `(collection, locale)` pair where the collection
//    is not skipped, a sibling collection named
//    `<collection>__<locale>` whose loader points at
//    `.astro/i18n-staging/<locale>/<collection>/<rest>`. The build
//    hook stages translated content there during `astro build`.
export const collections = {
  i18n,
  ...polystellaCollections({
    source: { site, people, publications, tags, presentations, blog },
    // Mirror Astro's `i18n.locales` from astro.config.mjs. The helper
    // strips `defaultLocale` defensively so we don't register a
    // self-translation sibling.
    locales: ["en", "pt-BR", "ja-JP"],
    defaultLocale: "en",
    loaderOverrides: {
      // `site` is TOML-backed. The translation pipeline currently only
      // understands markdown (and soon MDX) ASTs — running TOML through
      // the markdown extractor would mangle section headers and
      // assignments. Skipping until a TOML extractor/applier exists.
      site: { kind: "skip", reason: "TOML translation not supported yet" },
      // `blog` uses a custom loader; opting it out so the warning goes
      // away. Blog posts are English-only by design today.
      blog: { kind: "skip", reason: "blog posts are English-only" },
    },
  }),
};
// export const collections = polystellaCollections({
//   source: { site, people, publications, tags, presentations, blog, i18n },
//   // Mirror Astro's `i18n.locales` from astro.config.mjs. The helper
//   // strips `defaultLocale` defensively so we don't register a
//   // self-translation sibling.
//   locales: ["en", "pt-BR", "ja-JP"],
//   defaultLocale: "en",
//   loaderOverrides: {
//     // `site` is TOML-backed. The translation pipeline currently only
//     // understands markdown (and soon MDX) ASTs — running TOML through
//     // the markdown extractor would mangle section headers and
//     // assignments. Skipping until a TOML extractor/applier exists.
//     site: { kind: "skip", reason: "TOML translation not supported yet" },
//     // `blog` uses a custom loader; opting it out so the warning goes
//     // away. Blog posts are English-only by design today.
//     blog: { kind: "skip", reason: "blog posts are English-only" },
//     // this collection is translated manually via the json files in src/content/i18n
//     i18n: { kind: "skip", reason: "i18n collection is defined separately" },
//   },
// });
