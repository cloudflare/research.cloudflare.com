// Generates OG images for all focus area pages using Cloudflare Browser Run.
// Run after deploying the site so the /social-card route is live.
//
// Usage:
//   CF_ACCOUNT_ID=xxx CF_API_TOKEN=xxx npx tsx scripts/generate-og-images.ts
//   Add --force to regenerate images that already exist.

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE_URL = "https://research.cloudflare.com";
const OUTPUT_DIR = "public/social-cards";
const CF_API = "https://api.cloudflare.com/client/v4/accounts";

// Focus area pages — titles and descriptions match the nav
const pages = [
  {
    slug: "focus",
    title: "All Focus Areas",
    description: "Driving innovation across five key areas to create a faster, safer, more private, reliable, and measurable Internet.",
  },
  {
    slug: "focus/private",
    title: "More Private",
    description: "Developing privacy-preserving systems and protocols that protect users while enabling a more secure and trustworthy Internet.",
  },
  {
    slug: "focus/safe",
    title: "Safer",
    description: "Creating production-quality security defenses that address network interference and ensure safe, reliable global connectivity.",
  },
  {
    slug: "focus/fast",
    title: "Faster",
    description: "Advancing distributed systems and caching technologies that minimize latency and accelerate the global Internet.",
  },
  {
    slug: "focus/reliable",
    title: "More Reliable",
    description: "Building robust distributed systems and time synchronization protocols that ensure the Internet remains stable and available at scale.",
  },
  {
    slug: "focus/measurable",
    title: "More Measurable",
    description: "Promoting accountability in Internet infrastructure through open standards like Certificate Transparency and tools that make critical systems verifiable.",
  },
];

async function captureScreenshot(
  accountId: string,
  apiToken: string,
  pageUrl: string
): Promise<ArrayBuffer> {
  const endpoint = `${CF_API}/${accountId}/browser-rendering/screenshot`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: pageUrl,
      viewport: { width: 1200, height: 630 },
      gotoOptions: { waitUntil: "networkidle0" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Browser Run returned ${res.status}: ${text}`);
  }

  return res.arrayBuffer();
}

async function main() {
  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;

  if (!accountId || !apiToken) {
    console.error("Error: CF_ACCOUNT_ID and CF_API_TOKEN env vars required");
    process.exit(1);
  }

  const force = process.argv.includes("--force");

  mkdirSync(OUTPUT_DIR, { recursive: true });

  let generated = 0;
  let skipped = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    // Use the slug as the filename, replacing / with -
    const filename = page.slug.replace("/", "-") + ".png";
    const outPath = join(OUTPUT_DIR, filename);
    const label = `[${i + 1}/${pages.length}]`;

    if (!force && existsSync(outPath)) {
      console.log(`${label} ${filename} — skipped (exists)`);
      skipped++;
      continue;
    }

    const params = new URLSearchParams({
      title: page.title,
      description: page.description,
    });
    const url = `${BASE_URL}/social-card?${params}`;

    try {
      const png = await captureScreenshot(accountId, apiToken, url);
      writeFileSync(outPath, Buffer.from(png));
      console.log(`${label} ${filename} — done`);
      generated++;
    } catch (err) {
      console.error(`${label} ${filename} — failed:`, err);
    }

    // Small delay between requests to respect rate limits
    if (i < pages.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  console.log(`\nDone. Generated: ${generated}, Skipped: ${skipped}`);
}

main();
