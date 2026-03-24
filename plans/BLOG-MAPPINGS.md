# Blog Mappings — Automation Plan

## Background

Blog posts are fetched at build time from an external Cloudflare Worker API
(`https://website-worker.research.cloudflare.com/blog/all`). This happens
automatically on every `astro build` or `astro dev` run — no manual fetch
step is needed. However, new posts won't appear on any `/focus/*` pillar page
until their URL is added to `src/data/blog-mappings.ts` with at least a
`pillar` value assigned.

## What Needs to Happen

1. **Daily GitHub Action** — rebuild and deploy the site so fresh posts are
   picked up automatically.
2. **Blog mappings update** — new posts fetched from the API won't appear on
   pillar pages without an entry in `src/data/blog-mappings.ts`. The question
   is how automated this step should be.

## The Tricky Part: blog-mappings

Each new post needs at minimum a `pillar` value to show up on a `/focus/*`
page. The options are:

**Option A — Open a PR automatically (Recommended)**
A script fetches the Worker API, finds posts missing from `blog-mappings.ts`,
appends stub entries (with `pillar` left blank or AI-assigned), and opens a
PR. You review/edit and merge. Safe, auditable, no surprise deployments.

**Option B — Auto-commit + deploy without review**
The script appends new entries and commits directly, triggering the deploy.
Faster, but you could end up with posts on the wrong pillar page or build
errors from bad tag references.

**Option C — Skip automation, deploy daily anyway**
The daily rebuild/deploy runs without touching `blog-mappings.ts`. New posts
are fetched but won't appear on pillar pages until you manually update the
mappings. Simple CI, manual data curation.

## Questions Before Starting

1. **How do you want new blog post mappings handled?** PR for review
   (Option A), auto-commit (Option B), or skip for now (Option C)?

2. **AI-assisted assignment** — you mentioned using AI for the initial
   mapping assignment. If going with Option A or B, should the script use an
   AI API (e.g. Workers AI or OpenAI) to auto-assign `pillar` and `tags`
   based on the post title/excerpt, or just insert stubs to fill in manually?

3. **Cloudflare API token** — for the GitHub Action deploy, is a
   `CLOUDFLARE_API_TOKEN` already set up as a GitHub secret, or does that
   need to be accounted for in the setup steps?

4. **Conditional vs. unconditional runs** — should the daily build run even
   if there are no new posts, or only when the mappings script detects new
   entries?

## Technical Notes

- **Package manager:** `pnpm` — CI will need a `pnpm/action-setup` step.
- **Deploy command:** `astro build && wrangler deploy` (needs
  `CLOUDFLARE_API_TOKEN` and possibly `CLOUDFLARE_ACCOUNT_ID` as secrets).
- **Cache is ephemeral in CI** — the `.astro/cache/blog/` directory is
  git-ignored, so every CI run fetches fresh data from the Worker API.
- **Tag references** — the `tags` field in `blog-mappings.ts` must match
  slugs from the `content/tags/` collection. Mismatches cause build-time
  validation errors.
- **No `.github/` directory exists yet** — workflows will be created from
  scratch.
