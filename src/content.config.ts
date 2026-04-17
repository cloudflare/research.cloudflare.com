// 1. Import utilities from `astro:content`
import { defineCollection, reference } from "astro:content";

// 2. Import loader(s)
import { glob, file } from "astro/loaders";
import { blogLoader } from "./loaders/blog";

// 3. Import Zod
import { z } from "astro/zod";

// 4. Define your collection(s)
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

// 5. Export a single `collections` object to register your collection(s)
export const collections = {
  site,
  people,
  publications,
  tags,
  presentations,
  blog,
};
