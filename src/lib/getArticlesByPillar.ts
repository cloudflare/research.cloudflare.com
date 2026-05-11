import type { CollectionEntry } from "astro:content";
import { getLocalizedCollection } from "polystella/runtime";

type Pillar = "private" | "safe" | "fast" | "reliable" | "measurable";

/**
 * Fetches and sorts publications and blog posts for a specific pillar
 * @param pillar - The pillar to filter by
 * @returns Combined and sorted array of publications and blog posts
 */
export async function getArticlesByPillar(pillar: Pillar, locale?: string) {
  if (!locale) {
    locale = "en-US";
  }
  // Fetch publications and blog posts for this pillar
  const publications = await getLocalizedCollection("publications", (publication) => publication.data.pillar === pillar, locale);

  const blogPosts = await getLocalizedCollection("blog", (post) => post.data.pillar === pillar, locale);

  // Combine publications and blog posts
  const combinedArticles: (CollectionEntry<"publications"> | CollectionEntry<"blog">)[] = [...publications, ...blogPosts];

  // Sort by date (newest first)
  combinedArticles.sort((a, b) => {
    const dateA = a.collection === "blog" ? a.data.date : a.data.date || new Date(a.data.year || 0, 11, 31);
    const dateB = b.collection === "blog" ? b.data.date : b.data.date || new Date(b.data.year || 0, 11, 31);
    return dateB.getTime() - dateA.getTime();
  });

  return combinedArticles;
}
