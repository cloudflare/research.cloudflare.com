import type { Loader } from "astro/loaders";
import fs from "node:fs";
import path from "node:path";
import { polystellaLoader } from "@cloudflare/polystella/content";
import { blogMappings } from "../data/blog-mappings";

const PEOPLE_DIR = "./content/people";

const WORKER_BASE_URL = "https://website-worker.research.cloudflare.com";
// Set this to 1 to fetch from the old Contentful blog
const BLOG_ENDPOINT_VERSION = "2";
const CACHE_DIR = ".astro/cache/blog";

interface BlogPost {
  date: string;
  link: string;
  image?: string;
  heading: string;
  text: string;
}

interface CachedData {
  timestamp: number;
  data: BlogPost[];
}

function blogEndpoint(path: string, params: Record<string, string> = {}): string {
  const searchParams = new URLSearchParams({ ...params, v: BLOG_ENDPOINT_VERSION });
  return `${path}?${searchParams}`;
}

/**
 * Fetches blog posts from the Cloudflare Worker with caching
 */
async function fetchWithCache(endpoint: string, cacheFile: string): Promise<BlogPost[]> {
  const cachePath = path.join(CACHE_DIR, cacheFile);

  // Create cache directory if it doesn't exist
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  // Check if cache exists and is fresh (less than 1 day old)
  if (fs.existsSync(cachePath)) {
    const cached: CachedData = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    const age = Date.now() - cached.timestamp;
    const oneDay = 24 * 60 * 60 * 1000;

    if (age < oneDay) {
      console.log(`Using cached blog data from ${cacheFile}`);
      return cached.data;
    }
  }

  // Fetch fresh data
  console.log(`Fetching blog posts from ${endpoint}`);
  const response = await fetch(`${WORKER_BASE_URL}${endpoint}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch blog posts: ${response.status} ${response.statusText}`);
  }

  const data: BlogPost[] = await response.json();

  // Cache the response
  const cacheData: CachedData = {
    timestamp: Date.now(),
    data,
  };
  fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));

  return data;
}

/**
 * Reads all people files and returns a map of blog_author -> people slug
 */
function getBlogAuthorMap(): Record<string, string> {
  const map: Record<string, string> = {};
  if (!fs.existsSync(PEOPLE_DIR)) return map;

  const files = fs.readdirSync(PEOPLE_DIR).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const content = fs.readFileSync(path.join(PEOPLE_DIR, file), "utf-8");
    const blogAuthorMatch = content.match(/^blog_author:\s*(.+)$/m);
    const slugMatch = content.match(/^slug:\s*(.+)$/m);
    if (blogAuthorMatch && slugMatch) {
      map[blogAuthorMatch[1].trim()] = slugMatch[1].trim();
    }
  }
  return map;
}

/**
 * Adds the remote blog feed as a translatable collection. Only summary text
 * is translated; links still point to cloudflare.com.
 */
export function blogLoader(): Loader {
  return polystellaLoader(rawBlogLoader(), {
    name: "blog",
    translatableKeys: ["title", "excerpt"],
  });
}

function rawBlogLoader(): Loader {
  return {
    name: "blog-loader",
    load: async ({ store, logger, parseData, generateDigest }) => {
      logger.info("Loading blog posts from Cloudflare Worker");

      try {
        // Fetch all research blog posts
        const posts = await fetchWithCache(blogEndpoint("/blog/all"), `blogposts_v${BLOG_ENDPOINT_VERSION}_all.json`);

        // Clear existing entries
        store.clear();

        // Track which URLs we've already added
        const seenLinks = new Set<string>();

        // Process each blog post from /blog/all
        for (const post of posts) {
          const id = generateDigest(post.link);
          const mapping = blogMappings[post.link];

          const data = await parseData({
            id,
            data: {
              title: post.heading,
              date: new Date(post.date),
              url: post.link,
              excerpt: post.text,
              image: post.image,
              author: mapping?.author,
              pillar: mapping?.pillar,
              tags: mapping?.tags,
            },
          });

          store.set({ id, data });
          seenLinks.add(post.link);
        }

        logger.info(`Loaded ${posts.length} blog posts from /blog/all`);

        // Fetch per-author posts to catch any not in /blog/all
        const blogAuthorMap = getBlogAuthorMap();
        let extraCount = 0;

        for (const [blogAuthor, peopleSlug] of Object.entries(blogAuthorMap)) {
          let authorPosts: BlogPost[];
          try {
            authorPosts = await fetchWithCache(
              blogEndpoint("/blog/author", { name: blogAuthor }),
              `blogposts_v${BLOG_ENDPOINT_VERSION}_${blogAuthor}.json`,
            );
          } catch (err) {
            logger.warn(`Failed to fetch posts for author "${blogAuthor}": ${err}`);
            continue;
          }

          for (const post of authorPosts) {
            if (seenLinks.has(post.link)) continue;

            const id = generateDigest(post.link);
            const mapping = blogMappings[post.link];

            const data = await parseData({
              id,
              data: {
                title: post.heading,
                date: new Date(post.date),
                url: post.link,
                excerpt: post.text,
                image: post.image,
                // Use mapping author if set, otherwise fall back to this person
                author: mapping?.author ?? peopleSlug,
                pillar: mapping?.pillar,
                tags: mapping?.tags,
              },
            });

            store.set({ id, data });
            seenLinks.add(post.link);
            extraCount++;
          }
        }

        if (extraCount > 0) {
          logger.info(`Loaded ${extraCount} additional blog posts from per-author endpoints`);
        }
      } catch (error) {
        logger.error(`Failed to load blog posts: ${error}`);
        throw error;
      }
    },
  };
}

/**
 * Custom loader for fetching blog posts by author
 * This can be used to augment people profiles with their blog posts
 */
export async function fetchBlogPostsByAuthor(blogAuthor: string): Promise<BlogPost[]> {
  return fetchWithCache(blogEndpoint("/blog/author", { name: blogAuthor }), `blogposts_v${BLOG_ENDPOINT_VERSION}_${blogAuthor}.json`);
}
