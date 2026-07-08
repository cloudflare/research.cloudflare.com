# Cloudflare Research

The website for Cloudflare Research, showcasing our work in building a better Internet through research and implementation.

## 🚀 Project Structure

```text
/
├── content/
│   ├── people/          # Team member profiles
│   ├── presentations/   # Research presentations
│   ├── publications/    # Research papers and publications
│   └── tags/           # Topic tags
├── public/
│   ├── fonts/
│   ├── images/
│   └── ...
├── src/
│   ├── components/
│   │   ├── home/       # Homepage-specific components
│   │   ├── ui/         # Reusable UI components
│   │   └── ...
│   ├── layouts/
│   │   ├── base.astro
│   │   └── interior.astro
│   ├── pages/
│   │   ├── focus/      # Focus area pages (Private, Safe, Fast, etc.)
│   │   ├── people/     # People directory and profiles
│   │   ├── index.astro # Homepage
│   │   └── ...
│   ├── styles/
│   │   └── global.css
│   └── lib/            # Utility functions and constants
└── package.json
```

## 🛠️ Tech Stack

- **Framework**: [Astro](https://astro.build) - Static site generator with partial hydration
- **UI Components**: React components with [Radix UI](https://www.radix-ui.com/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Content**: Astro Content Collections for type-safe content management
- **Icons**: Custom SVG sprite system via lemon-lime-svgs
- **Deployment**: Cloudflare Workers

## 🧞 Commands

All commands are run from the root of the project:

| Command               | Action                                                                                                 |
| :-------------------- | :----------------------------------------------------------------------------------------------------- |
| `pnpm install`        | Installs dependencies                                                                                  |
| `pnpm dev`            | Starts local dev server at `localhost:4321`                                                            |
| `pnpm build`          | Build your production site to `./dist/`                                                                |
| `pnpm preview`        | Preview your build locally, before deploying                                                           |
| `pnpm icons`          | Generate SVG sprite from icons in `/other/svg-icons`                                                   |
| `pnpm ui`             | Add shadcn/ui components                                                                               |
| `pnpm translate`      | Run the [PolyStella](./POLYSTELLA.md) content translation pipeline standalone (no Astro build).        |
| `pnpm translate:dry`  | Same as `translate` but skips the provider + R2 writes; only prints planned R2 keys.                   |
| `pnpm i18n:check`     | Detect drift in UI-string JSONs (`src/content/i18n/`). Runs offline; pre-commit hook target.           |
| `pnpm i18n:sync`      | Reconcile non-default UI-string locales against `en-US.json` (add missing keys as empty, drop extras). |
| `pnpm i18n:translate` | `i18n:sync`, then AI-fill empty placeholders via the configured provider.                              |

## 📝 Content Management

Content is managed through Astro's Content Collections located in the `/content` directory:

- **People**: Team member profiles with avatars, positions, and bios
- **Publications**: Research papers with authors, years, and related interests
- **Presentations**: Conference talks and keynotes
- **Tags**: Topic categorization for filtering content

### Featured Research

Within the [`/content/site.toml`](./content/site.toml) file, you can configure the featured research section on the homepage. It must follow this structure:

```toml
[main.featuredResearch]
publication = "publication-slug"
title = "Publication Title"
description = "Publication description"
link = "/publication-slug"
buttonLabel = "Read the Full Article"
```

### People

All people are located within the [`/content/people`](./content/people) directory.

They must follow this structure:

```markdown
---
title: "Person's Name"
position: "Position"
author_name: "Person's Name"
status: "current" | "inactive"
twitter: "twitter-handle"
bluesky: "bluesky-handle"
blog_author: "blog-author"
avatar: "/images/people/person-name.jpg"
slug: "person-name"
type: "active" | "alumni" | "external" | "intern" | "inactive"
---
```

Only `active` and `alumni` types are displayed on the team page.

Avatars are stored in the [`/public/images/people`](./public/images/people) directory and should be named after the person's slug.

### Publications

All publications are located within the [`/content/publications`](./content/publications) directory.

They must follow this structure:

```markdown
---
title: "Publication Name"
year: year
location: "Location"
authors:
  - author-slug
url: https://example.com
doi: doi
related_interests:
  - related-interest-slug
pillar: "fast" | "private" | "safe" | "reliable" | "measurable"
tags:
  - tag-slug
---

Publication content
```

### Presentations

All presentations are located within the [`/content/presentations`](./content/presentations) directory.

They must follow this structure:

```markdown
---
title: "Presentation Name"
youtube: "youtube-url"
thumbnail: "thumbnail-url"
year: year
---

Presentation content
```

### Tags

Tags are maintained in the [`/content/tags`](./content/tags) directory. They are used to categorize publications and presentations.

Tags must follow this structure:

```toml
---
name: "Tag Name"
slug: "tag-slug"
description: "Tag description"
color: "pink"
---
```

When you want to link a tag to a publication or presentation, you can do so by adding the tag slug to the `tags` array in the frontmatter of the content file (see [Publications](#publications) for an example).

## 🎨 Design System

The site uses a custom design system with:

- Responsive breakpoints: mobile (< 640px), tablet (640px-1024px), desktop (1024px+)
- Dark mode support via CSS custom properties
- Custom utility classes for headings, subheadings, and layout components
- Focus areas with distinct visual identities

## � Key Features

- **Focus Areas**: Five research pillars (Private, Safe, Fast, Reliable, Measurable)
- **Publications Grid**: Filterable grid of research papers and blog posts
- **People Directory**: Team member profiles with publications
- **Presentations**: Video presentations and keynotes
- **Responsive Navigation**: Mobile hamburger menu with full-screen overlay
- **Featured Research**: Highlighted research on homepage

## 📱 Responsive Design

The site is fully responsive with:

- Mobile-first approach
- Hamburger menu for mobile navigation
- Adaptive grids (1, 2, or 3 columns based on screen size)
- Responsive typography and spacing
- Touch-friendly interactive elements

## 🌐 Translation (PolyStella)

Locale-aware content and UI strings are translated by [PolyStella](https://github.com/cloudflare/polystella), the `@cloudflare/polystella` Astro integration. English content remains the source of truth; translated output is generated with Workers AI, cached in R2, and staged during builds.

See [`POLYSTELLA.md`](./POLYSTELLA.md) for repo-specific workflows, credentials, glossaries, manual overrides, and build/deploy behavior.

## 🚢 Deployment

The site is deployed on Cloudflare Workers with automatic deployments (via Workers Builds) from the main branch. PR previews are built and deployed automatically; their translation pass uses the branch-isolated cache described in [`POLYSTELLA.md`](./POLYSTELLA.md).
