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

| Command           | Action                                               |
| :---------------- | :--------------------------------------------------- |
| `npm install`     | Installs dependencies                                |
| `npm run dev`     | Starts local dev server at `localhost:4321`          |
| `npm run build`   | Build your production site to `./dist/`              |
| `npm run preview` | Preview your build locally, before deploying         |
| `npm run icons`   | Generate SVG sprite from icons in `/other/svg-icons` |
| `npm run ui`      | Add shadcn/ui components                             |

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

### Publications

### Presentations
All presentations are located within the [`/content/presentations`](./content/presentations) directory.

They must follow this structure:

```markdown
---
title: "Presentation Name"
year: 2021
location: IACR International Conference on Public-Key Cryptography, pp. 261-289. Springer, Cham, 2021.
authors:
  - martin-albrecht
  - alex-davidson
  - amit-deo
  - nigel-p-smart
url: https://example.com
doi: 10.1007/978-3-030-75248-4_10
related_interests:
  - cryptography
pillar: private
metaDescription: "Research on constructing the first round-optimal VOPRF protocol secure from lattice hardness assumptions, enabling post-quantum secure verifiable oblivious pseudorandom functions with applications to password authentication and private set intersection."
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

## 🚢 Deployment

The site is deployed on Cloudflare Workers with automatic deployments (via Workers Builds) from the main branch.
