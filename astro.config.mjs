// @ts-check
import { defineConfig, fontProviders } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

import react from "@astrojs/react";

import mdx from "@astrojs/mdx";

import sitemap from "@astrojs/sitemap";

import polystella, { astroSitemapI18n } from "polystella";
import polystellaConfig from "./polystella.config.mjs";

const i18n = {
  defaultLocale: "en-US",
  locales: ["en-US", "es-ES", "pt-BR", "ja-JP"],
  routing: { prefixDefaultLocale: false },
};

// https://astro.build/config
export default defineConfig({
  site: "https://research.cloudflare.com",
  output: "static",
  i18n,
  fonts: [
    {
      provider: fontProviders.local(),
      name: "Inter",
      cssVariable: "--font-inter",
      options: {
        variants: [
          {
            src: ["./src/assets/fonts/Inter/Inter-VariableFont_opsz,wght.woff2"],
            weight: "100 900",
            style: "normal",
          },
          {
            src: ["./src/assets/fonts/Inter/Inter-Italic-VariableFont_opsz,wght.woff2"],
            weight: "100 900",
            style: "italic",
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: "Roboto Mono",
      cssVariable: "--font-roboto-mono",
      options: {
        variants: [
          {
            src: ["./src/assets/fonts/Roboto_Mono/RobotoMono-VariableFont_wght.woff2"],
            weight: "100 700",
            style: "normal",
          },
          {
            src: ["./src/assets/fonts/Roboto_Mono/RobotoMono-Italic-VariableFont_wght.woff2"],
            weight: "100 700",
            style: "italic",
          },
        ],
      },
    },
  ],
  build: {
    inlineStylesheets: "auto",
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      cssMinify: true,
      minify: "terser",
      cssCodeSplit: true,
      assetsInlineLimit: 4096,
      rollupOptions: {
        output: {
          assetFileNames: (assetInfo) => {
            if (assetInfo.name && assetInfo.name.endsWith(".css")) {
              return "assets/[name].[hash][extname]";
            }
            return "assets/[name].[hash][extname]";
          },
        },
      },
    },
  },
  integrations: [
    react(),
    mdx(),
    // `astroSitemapI18n` derives the i18n-related sitemap options
    // (the `i18n` config plus a `serialize` callback that injects
    // `hreflang="x-default"` annotations) from the same Astro `i18n`
    // block above. Without this, the locale-prefixed URLs PolyStella
    // injects appear in the sitemap as duplicate content rather than
    // as alternate-language pages, hurting SEO.
    sitemap(astroSitemapI18n(i18n)),
    polystella(polystellaConfig),
  ],
  redirects: {
    "/about/approach/": "/people",
    "/about/story/": "/people",
    "/about/people/": "/people",
    "/about/people/armando-faz/": "/people/armando-faz-hernandez",
    "/about/people/avani-wildani/": "/people/avani-wildani",
    "/about/people/bas-westerbaan/": "/people/bas-westerbaan",
    "/about/people/bob-halley/": "/people/bob-halley",
    "/about/people/cefan-rubin/": "/people/cefan-rubin",
    "/about/people/christopher-patton/": "/people/christopher-patton",
    "/about/people/ethan-heilman/": "/people/ethan-heilman",
    "/about/people/james-larisch/": "/people/james-larisch",
    "/about/people/jonathan-hoyland/": "/people/jonathan-hoyland",
    "/about/people/luke-valenta/": "/people/luke-valenta",
    "/about/people/marwan-fayed/": "/people/marwan-fayed",
    "/about/people/michael-rosenberg/": "/people/michael-rosenberg",
    "/about/people/peter-wu/": "/people/peter-wu",
    "/about/people/simon-newton/": "/people/simon-newton",
    "/about/people/suleman-ahmad/": "/people/suleman-ahmad",
    "/about/people/teresa-brooks-mejia/": "/people/teresa-brooks-mejia",
    "/about/people/thibault-meunier/": "/people/thibault-meunier",
    "/about/people/vania-goncalves/": "/people/vania-goncalves",
    "/about/people/vasilis-giotsas/": "/people/vasilis-giotsas",
    "/about/people/wesley-evans/": "/people/wesley-evans",
    "/projects/": "/focus",
    "/publications/": "/focus",
    "/outreach/academic-programs/": "/people",
    "/outreach/academic-programs/interns/": "/people",
    "/outreach/academic-programs/interns/albert-gran/": "/people",
    "/outreach/academic-programs/interns/alishah-chator/": "/people",
    "/outreach/academic-programs/interns/arian-niaki/": "/people",
    "/outreach/academic-programs/interns/ben-weintraub/": "/people",
    "/outreach/academic-programs/interns/daniel-kuijsters/": "/people",
    "/outreach/academic-programs/interns/deepak-maram/": "/people",
    "/outreach/academic-programs/interns/diwen-xue/": "/people",
    "/outreach/academic-programs/interns/goutam-tamvada/": "/people",
    "/outreach/academic-programs/interns/hannah-davis/": "/people",
    "/outreach/academic-programs/interns/ian-mcquoid/": "/people",
    "/outreach/academic-programs/interns/innocent-obi/": "/people",
    "/outreach/academic-programs/interns/isaac-khor/": "/people",
    "/outreach/academic-programs/interns/jack-wampler/": "/people",
    "/outreach/academic-programs/interns/jenny-blessing/": "/people",
    "/outreach/academic-programs/interns/joao-leite/": "/people",
    "/outreach/academic-programs/interns/josh-brown/": "/people",
    "/outreach/academic-programs/interns/joshua-reynolds/": "/people",
    "/outreach/academic-programs/interns/kyle-hogan/": "/people",
    "/outreach/academic-programs/interns/lena-heimberger/": "/people",
    "/outreach/academic-programs/interns/lenka-marekova/": "/people",
    "/outreach/academic-programs/interns/marina-sanusi/": "/people",
    "/outreach/academic-programs/interns/matthieu-gouel/": "/people",
    "/outreach/academic-programs/interns/petros-gigis/": "/people",
    "/outreach/academic-programs/interns/pierre-tholoniat/": "/people",
    "/outreach/academic-programs/interns/prajjwal-gupta/": "/people",
    "/outreach/academic-programs/interns/ram-sundararaman/": "/people",
    "/outreach/academic-programs/interns/sudheesh-singanamalla/": "/people",
    "/outreach/academic-programs/interns/talha-paracha/": "/people",
    "/outreach/academic-programs/interns/thom-wiggers/": "/people",
    "/outreach/academic-programs/interns/tim-alberdingkthijm/": "/people",
    "/outreach/academic-programs/interns/vamsi-policharla/": "/people",
    "/outreach/academic-programs/interns/varun-gandhi/": "/people",
    "/outreach/academic-programs/interns/weitong-li/": "/people",
    "/outreach/academic-programs/interns/yingchen-wang/": "/people",
    "/outreach/academic-programs/interns/yoshimichi-nakatsuka/": "/people",
    "/outreach/academic-programs/interns/yunfan-zhang/": "/people",
    "/outreach/academic-programs/researchers/": "/people",
  },
});
