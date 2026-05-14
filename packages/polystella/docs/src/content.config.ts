import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

/**
 * Single docs collection, loaded from `src/content/docs/**` via
 * Starlight's filesystem loader. Schema follows Starlight's
 * canonical shape so every page gets `title`, `description`, and
 * the standard sidebar / hero fields.
 */
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
