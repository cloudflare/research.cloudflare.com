// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

/**
 * Starlight configuration for the PolyStella docs site.
 *
 * Single-language (en-US) for v0.x. Dogfooding polystella's own
 * translation pipeline on the docs is queued for v0.x+1 — see
 * `plans/DOCS-PLAN.md` D.6 for the rationale.
 */
export default defineConfig({
  site: "https://polystella.example.com",
  integrations: [
    starlight({
      title: "PolyStella",
      description: "AI-driven content localization for Astro",
      logo: {
        src: "./src/assets/wordmark.svg",
        replacesTitle: true,
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/cloudflare/polystella",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/cloudflare/polystella/edit/main/docs/",
      },
      sidebar: [
        {
          label: "Getting started",
          items: [
            { label: "Install", slug: "getting-started/install" },
            { label: "Quick start", slug: "getting-started/quick-start" },
            { label: "Mental model", slug: "getting-started/mental-model" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "How it works", slug: "concepts/how-it-works" },
            { label: "R2 cache", slug: "concepts/r2-cache" },
            { label: "Glossaries", slug: "concepts/glossaries" },
            { label: "Overrides", slug: "concepts/overrides" },
            { label: "Mode boundary", slug: "concepts/mode-boundary" },
            { label: "Runtime bridge", slug: "concepts/runtime-bridge" },
            { label: "AI marker", slug: "concepts/ai-marker" },
          ],
        },
        {
          label: "Configuration",
          items: [
            { label: "Overview", slug: "configuration" },
            { label: "Full reference", slug: "configuration/reference" },
          ],
        },
        {
          label: "Adapters",
          items: [
            { label: "Markdown", slug: "adapters/markdown" },
            { label: "MDX", slug: "adapters/mdx" },
            { label: "TOML", slug: "adapters/toml" },
            { label: "Custom loader", slug: "adapters/custom-loader" },
          ],
        },
        {
          label: "Providers",
          items: [
            { label: "Workers AI", slug: "providers/workers-ai" },
            { label: "Anthropic", slug: "providers/anthropic" },
            { label: "Model selection", slug: "providers/model-selection" },
            { label: "Batching", slug: "providers/batching" },
            { label: "Permanent errors", slug: "providers/permanent-errors" },
          ],
        },
        {
          label: "Routing",
          items: [
            { label: "Standalone shims", slug: "routing/shims" },
            { label: "Route configuration", slug: "routing/configuration" },
          ],
        },
        {
          label: "Runtime API",
          items: [
            { label: "Astro.locals", slug: "runtime-api/locals" },
            { label: "Middleware", slug: "runtime-api/middleware" },
            { label: "Explicit imports", slug: "runtime-api/explicit-imports" },
            { label: "React hooks", slug: "runtime-api/react-hooks" },
            { label: "LocalePicker component", slug: "runtime-api/locale-picker" },
          ],
        },
        {
          label: "CLI",
          items: [
            { label: "Overview", slug: "cli" },
            { label: "translate", slug: "cli/translate" },
            { label: "check-ui", slug: "cli/check-ui" },
            { label: "sync-ui", slug: "cli/sync-ui" },
            { label: "translate-ui", slug: "cli/translate-ui" },
          ],
        },
        {
          label: "Operations",
          items: [
            { label: "CI / Workers Builds", slug: "operations/ci" },
            { label: "Branch dispatch", slug: "operations/branch-dispatch" },
            { label: "Preview isolation", slug: "operations/preview-isolation" },
          ],
        },
        {
          label: "Cookbook",
          items: [{ autogenerate: { directory: "cookbook" } }],
        },
        {
          label: "Troubleshooting",
          items: [{ autogenerate: { directory: "troubleshooting" } }],
        },
        {
          label: "Reference",
          items: [
            { label: "Public exports", slug: "reference/exports" },
            { label: "Breaking changes", slug: "reference/breaking-changes" },
          ],
        },
        {
          label: "Roadmap",
          slug: "roadmap",
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
