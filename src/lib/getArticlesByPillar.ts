import { getCollection } from "astro:content";
import type { CollectionEntry } from "astro:content";

type Pillar = "private" | "safe" | "fast" | "reliable" | "measurable";

/**
 * Fetches and sorts publications and blog posts for a specific pillar
 * @param pillar - The pillar to filter by
 * @returns Combined and sorted array of publications and blog posts
 */
export async function getArticlesByPillar(pillar: Pillar) {
  // Fetch publications and blog posts for this pillar
  const publications = await getCollection(
    'publications',
    (publication) => publication.data.pillar === pillar
  );
  
  const blogPosts = await getCollection(
    'blog',
    (post) => post.data.pillar === pillar
  );

  // Combine publications and blog posts
  const combinedArticles: (CollectionEntry<'publications'> | CollectionEntry<'blog'>)[] = [
    ...publications,
    ...blogPosts
  ];

  // Sort by date (newest first)
  combinedArticles.sort((a, b) => {
    const dateA = a.collection === 'blog' ? a.data.date : new Date(a.data.year || 0, 0);
    const dateB = b.collection === 'blog' ? b.data.date : new Date(b.data.year || 0, 0);
    return dateB.getTime() - dateA.getTime();
  });

  return combinedArticles;
}
