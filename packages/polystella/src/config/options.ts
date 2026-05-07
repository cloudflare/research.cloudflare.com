import { z } from "astro/zod";

/**
 * PolyStella options schema.
 *
 * `defaultLocale` and `locales` are NOT here — they're derived from
 * Astro's native `config.i18n` at `astro:config:setup` to keep one
 * source of truth (see `resolveOptions`).
 *
 * `r2` and `provider` are zod-optional so dry-run / parse / glossary
 * work can proceed without credentials provisioned. They're enforced
 * as required at the point of consumption.
 */

const r2OptionsSchema = z.object({
  accountId: z.string().min(1, "r2.accountId is required"),
  bucket: z.string().min(1, "r2.bucket is required"),
  prefix: z.string().default("i18n/"),
  accessKeyId: z.string().min(1, "r2.accessKeyId is required"),
  secretAccessKey: z.string().min(1, "r2.secretAccessKey is required"),
  endpoint: z
    .string()
    .url()
    .optional()
    .describe("Override the default R2 endpoint (`https://<accountId>.r2.cloudflarestorage.com`). Useful for testing."),
  /**
   * When `true`, the cache layer skips PUTs and the post-translation
   * prune step. GETs (against `prefix` and any `readFallbackPrefixes`)
   * still happen.
   *
   * Designed for builds that should consume the cache without
   * polluting it — the canonical use case is preview-branch builds
   * that read main's translations but don't get to write back. Pairs
   * naturally with `readFallbackPrefixes` for branch isolation
   * without translation cost.
   */
  readOnly: z.boolean().default(false),
  /**
   * Ordered list of additional prefixes to consult on a cache miss
   * against the primary `prefix`. First hit wins; bytes are returned
   * verbatim and NOT promoted to the primary prefix (no implicit
   * cross-prefix copies — keeps writes deterministic and isolated).
   *
   * Each entry MUST end with `/` (same constraint as `prefix`).
   *
   * Branch-isolation use case: a preview build configured with
   * `prefix: "previews/<branch>/i18n/"` and
   * `readFallbackPrefixes: ["i18n/"]` reads main's translations
   * for unchanged content, only translating PR-edited files into
   * its own private prefix.
   */
  readFallbackPrefixes: z.array(z.string()).default([]),
  /**
   * Count-based pruning: per (locale, sourcePath), keep only the N
   * most-recent hash variants. `false` disables pruning.
   */
  keepLastN: z.union([z.number().int().positive(), z.literal(false)]).default(5),
});

const workersAiProviderSchema = z.object({
  kind: z.literal("workers-ai"),
  accountId: z.string().min(1, "provider.accountId is required"),
  apiToken: z.string().min(1, "provider.apiToken is required"),
  endpoint: z.string().url().optional(),
  /**
   * Either a single model id, or a per-locale map with a `default`
   * key. The resolved model id is part of the cache key, so changing
   * it invalidates that locale's cached translations.
   */
  model: z.union([z.string().min(1), z.object({ default: z.string().min(1) }).catchall(z.string().min(1))]),
  /**
   * Max output tokens per call. Workers AI's default ceiling (~256)
   * truncates multi-segment translations mid-string and breaks JSON
   * parsing. 8192 fits under llama-3.1-8b's 8k output cap.
   */
  maxTokens: z.number().int().positive().default(8192),
});

const anthropicProviderSchema = z.object({
  kind: z.literal("anthropic"),
  apiKey: z.string().min(1, "provider.apiKey is required"),
  model: z.union([z.string().min(1), z.object({ default: z.string().min(1) }).catchall(z.string().min(1))]),
  /** Max output tokens per call. */
  maxTokens: z.number().int().positive().default(8192),
});

const providerSchema = z.discriminatedUnion("kind", [workersAiProviderSchema, anthropicProviderSchema]);

const glossaryFileSchema = z.object({
  file: z
    .string()
    .min(1)
    .describe("Path template for per-locale glossary files. Use `{locale}` as the placeholder. Example: './i18n/glossary/{locale}.yaml'."),
});

const glossaryInlineSchema = z.object({
  inline: z.record(
    z.string(),
    z.object({
      version: z.string().optional(),
      doNotTranslate: z.array(z.string()).optional(),
      preferredTranslations: z.record(z.string(), z.string()).optional(),
      notes: z.string().optional(),
    }),
  ),
});

const glossarySchema = z.union([glossaryFileSchema, glossaryInlineSchema]);

export const polystellaOptionsSchema = z
  .object({
    // Locales: NOT here, derived from Astro's `config.i18n`.

    sourceDir: z.string().default("./content"),
    include: z.array(z.string()).default(["**/*.md", "**/*.mdx"]),
    exclude: z.array(z.string()).default([]),

    /**
     * Per-format configuration. Each format has the same internal
     * shape:
     *   - `keys` — translatable scalars (per-glob → key-path list).
     *   - `urls` — URL fields that should be locale-prefixed at
     *     staging time (per-glob → key-path list).
     *
     * Both are optional. A path listed in `keys` is sent to the
     * translator; a path listed in `urls` runs through the URL
     * rewriter (see `noPrefixUrls` for exemptions). The same path
     * MUST NOT appear in both `keys` and `urls` for a given glob —
     * a translatable URL would be both AI-rewritten and locale-
     * prefixed, and we error at config-resolve time to surface this
     * loudly.
     *
     * Markdown specifics:
     *   - `markdown.keys` covers frontmatter keys; body translation
     *     happens automatically over inline text spans.
     *   - `markdown.urls` covers frontmatter URL keys only; body
     *     inline links are rewritten automatically by the markdown
     *     adapter and need no config.
     *
     * Example:
     *
     *     markdown: {
     *       keys: { "publications/**": ["title", "metaDescription"] },
     *       urls: { "publications/**": ["heroImage"] },
     *     },
     *     toml: {
     *       keys: { "site.toml": ["main.featuredResearch.title"] },
     *       urls: { "site.toml": ["main.featuredResearch.link"] },
     *     },
     */
    markdown: z
      .object({
        keys: z.record(z.string(), z.array(z.string())).default({}),
        urls: z.record(z.string(), z.array(z.string())).default({}),
      })
      .strict()
      .default({ keys: {}, urls: {} }),

    toml: z
      .object({
        keys: z.record(z.string(), z.array(z.string())).default({}),
        urls: z.record(z.string(), z.array(z.string())).default({}),
      })
      .strict()
      .default({ keys: {}, urls: {} }),

    /**
     * Internal URL paths to leave unprefixed by the link rewriter.
     * Picomatch globs match against the URL path (after splitting
     * query/fragment). Applied uniformly wherever rewriting happens
     * — markdown body links, markdown frontmatter URLs, structured-
     * data URL fields. External URLs (`http://`, `https://`,
     * `mailto:`, etc.) and anchor-only URLs already bail out before
     * this list is consulted.
     *
     * Use case: declaring that a specific internal path is single-
     * locale and shouldn't get locale-prefixed even when it's
     * referenced from a translatable file.
     *
     * Example:
     *
     *     noPrefixUrls: ["/api-docs", "/api-docs/**", "/legal/*"]
     */
    noPrefixUrls: z.array(z.string()).default([]),

    /**
     * Source pages to inject locale-prefixed shims for. Each entry
     * is either a bare path string or an object `{ source, imports }`
     * where `imports` are extra modules (typically CSS) the shim
     * should pull in.
     *
     * Why per-shim imports matter: Astro's per-route `<link
     * rel="stylesheet">` injection only follows CSS dependencies that
     * are direct first-degree imports of the route's own module.
     * When a shim imports a source page (`import SourcePage from
     * "..."`) and renders it via `<SourcePage />`, the source's
     * transitive CSS imports (global.css → through layout → through
     * BaseLayout) compile into Vite chunks correctly, but Astro's
     * link injection doesn't follow that chain. Result: the shim's
     * routes render with no styles linked.
     *
     * The `imports` field — combined with the top-level
     * `routesImports` default applied to every shim — fixes this by
     * making CSS a first-degree import of the shim itself. Vite then
     * groups CSS chunks per import graph, and Astro emits a `<link>`
     * to whichever chunk(s) that import resolves into. For Tailwind-
     * style projects where all CSS lives in one chunk, importing the
     * single global stylesheet is enough; for projects with split
     * CSS bundles, list every relevant file.
     */
    routes: z
      .array(
        z.union([
          z.string(),
          z
            .object({
              source: z.string(),
              imports: z.array(z.string()).optional(),
            })
            .strict(),
        ]),
      )
      .default([])
      .transform((arr) =>
        arr.map((entry) =>
          typeof entry === "string" ? { source: entry, imports: [] as string[] } : { source: entry.source, imports: entry.imports ?? [] },
        ),
      ),
    /**
     * Imports threaded into EVERY shim's frontmatter, in addition to
     * any per-route `imports`. Use this for CSS (or any other module)
     * that's needed across the entire shim-routed surface — typically
     * a single global stylesheet.
     */
    routesImports: z.array(z.string()).default([]),
    noTranslateBehavior: z.enum(["fallback", "404"]).default("fallback"),
    rewriteInternalLinks: z.boolean().default(true),

    r2: r2OptionsSchema.optional(),
    provider: providerSchema.optional(),
    glossary: glossarySchema.optional(),
    overridesDir: z.string().default("./i18n/overrides"),

    /**
     * Optional site-/domain-specific guidance appended to the generic
     * "You are a professional translator." opener of every system
     * prompt.
     */
    prompt: z
      .object({
        context: z
          .string()
          .optional()
          .describe("Site-/domain-specific guidance appended to the default 'You are a professional translator.' opener."),
      })
      .default({}),

    /**
     * `debug.previewDir`, when set, writes a copy of each translated
     * file under `<previewDir>/<locale>/<sourceRelativePath>` for
     * inspection. Ephemeral.
     */
    debug: z
      .object({
        previewDir: z.string().optional(),
      })
      .default({}),

    fallback: z.enum(["default-locale", "skip"]).default("default-locale"),
    concurrency: z.number().int().positive().default(4),
    dryRun: z.boolean().default(false),
    runOn: z.array(z.enum(["build", "dev"])).default(["build"]),
    // `auto` and `"standalone"` are equivalent today; both register
    // sibling collections via `polystellaCollections`. `"starlight"`
    // is rejected at parse time — it'll auto-detect `@astrojs/starlight`
    // and route `docs`/`i18n` through Starlight's native loaders when
    // that work lands.
    mode: z
      .enum(["auto", "standalone", "starlight"])
      .default("auto")
      .superRefine((value, ctx) => {
        if (value === "starlight") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'mode: "starlight" is not yet supported. Use "standalone" or omit `mode` for the default "auto".',
          });
        }
      }),
    /**
     * When true, log one line per (file, locale) pair processed.
     * Off by default; only the closing summary and failures log.
     */
    verbose: z.boolean().default(false),
  })
  .strict();

export type PolyStellaOptions = z.input<typeof polystellaOptionsSchema>;

export type PolyStellaResolvedOptions = z.output<typeof polystellaOptionsSchema> & {
  /** Source/canonical locale, derived from Astro's `config.i18n.defaultLocale`. */
  defaultLocale: string;
  /** Target locales, derived from `config.i18n.locales` minus the default. */
  locales: string[];
};

/**
 * Minimal structural type for the slice of Astro's `i18n` config we
 * read. Defined locally so the schema stays decoupled from Astro's
 * type surface and tests can pass plain objects.
 */
export interface AstroI18nLike {
  defaultLocale: string;
  locales: ReadonlyArray<string | { path: string; codes?: ReadonlyArray<string> }>;
  routing?:
    | "manual"
    | {
        prefixDefaultLocale?: boolean;
        redirectToDefaultLocale?: boolean;
        fallbackType?: string;
      };
}

/**
 * Parse user options + derive the locale set from Astro's `config.i18n`.
 * Aggregates all errors (user options + i18n cross-check) into a single
 * thrown Error so the operator fixes everything in one pass. PolyStella
 * never writes to Astro's config.
 */
export function resolveOptions(raw: unknown, astroI18n: AstroI18nLike | undefined): PolyStellaResolvedOptions {
  const parsed = polystellaOptionsSchema.safeParse(raw);
  const optionIssues = parsed.success
    ? []
    : parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
        return `  • ${path}: ${issue.message}`;
      });

  // Cross-check: a single key path in both `keys` and `urls` for the
  // same glob would have the AI translate the URL string AND the
  // rewriter prefix the result — never the operator's intent.
  // Surface as a loud error so the typo is fixed before any (file,
  // locale) pair is processed.
  const overlapIssues = parsed.success ? findKeysUrlsOverlaps(parsed.data) : [];

  const i18nIssues = validateAstroI18n(astroI18n);

  if (optionIssues.length > 0 || overlapIssues.length > 0 || i18nIssues.length > 0) {
    const sections: string[] = [];
    if (optionIssues.length > 0) {
      sections.push(`Invalid PolyStella options:\n${optionIssues.join("\n")}`);
    }
    if (overlapIssues.length > 0) {
      sections.push(
        `Invalid PolyStella options (a path can't be in both \`keys\` and \`urls\` for the same glob):\n${overlapIssues.join("\n")}`,
      );
    }
    if (i18nIssues.length > 0) {
      sections.push(`Invalid Astro \`i18n\` config (PolyStella derives locales from it):\n${i18nIssues.join("\n")}`);
    }
    throw new Error(
      `[polystella] configuration error:\n${sections.join(
        "\n\n",
      )}\n\nSee polystella.config.mjs and astro.config.mjs for the full reference.`,
    );
  }

  // Both checks passed: derive the locale fields and merge.
  const i18n = astroI18n!;
  const defaultLocale = i18n.defaultLocale;
  const locales = (i18n.locales as string[]).filter((locale) => locale !== defaultLocale);
  return {
    ...parsed.data!,
    defaultLocale,
    locales,
  };
}

/**
 * Cross-check Astro's `i18n` block. Returns a flat list of
 * human-readable error lines (already prefixed with bullets) suitable
 * for inclusion in the aggregated `resolveOptions` error message.
 * Empty array means "this slice of config is acceptable".
 */
function validateAstroI18n(i18n: AstroI18nLike | undefined): string[] {
  if (i18n === undefined) {
    return [
      `  • Astro's \`i18n\` config is missing. Add a block like the
    following to your astro.config.mjs (adjust locales as needed):

        i18n: {
          defaultLocale: "en",
          locales: ["en", "pt-BR", "ja-JP"],
          routing: { prefixDefaultLocale: false },
        }`,
    ];
  }

  const issues: string[] = [];

  if (typeof i18n.defaultLocale !== "string" || i18n.defaultLocale.length === 0) {
    issues.push("  • `i18n.defaultLocale` is required and must be a non-empty string.");
  }

  if (!Array.isArray(i18n.locales) || i18n.locales.length === 0) {
    issues.push("  • `i18n.locales` is required and must declare at least one locale.");
  } else {
    const objectForms = i18n.locales.filter((entry): entry is { path: string } => typeof entry === "object" && entry !== null);
    if (objectForms.length > 0) {
      const paths = objectForms.map((e) => e.path).join(", ");
      issues.push(
        `  • \`i18n.locales\` contains object-form entries (${paths}). PolyStella only supports plain string locales today; rewrite them as plain strings (e.g. "pt-BR").`,
      );
    }
    const stringLocales = i18n.locales.filter((entry): entry is string => typeof entry === "string");
    if (typeof i18n.defaultLocale === "string" && i18n.defaultLocale.length > 0 && !stringLocales.includes(i18n.defaultLocale)) {
      issues.push(
        `  • \`i18n.locales\` must include \`defaultLocale\` ("${i18n.defaultLocale}"). Astro's contract is that the default is one of the listed locales; add it.`,
      );
    }
    const dupes = stringLocales.filter((locale, i) => stringLocales.indexOf(locale) !== i);
    if (dupes.length > 0) {
      issues.push(`  • \`i18n.locales\` contains duplicates: ${[...new Set(dupes)].join(", ")}.`);
    }
  }

  if (i18n.routing === "manual") {
    issues.push(
      '  • `i18n.routing: "manual"` is not supported (PolyStella relies on Astro\'s built-in locale-prefix routing). Use `routing: { prefixDefaultLocale: false }` or omit `routing` entirely.',
    );
  }

  return issues;
}

/**
 * Walk the per-format `keys` / `urls` maps for any glob whose
 * `keys[glob]` and `urls[glob]` lists intersect. Each format is
 * checked independently — a markdown overlap and a TOML overlap
 * surface as separate bullets.
 *
 * Returns a flat list of pre-bulleted issue strings ready for the
 * aggregated error message.
 */
function findKeysUrlsOverlaps(opts: z.output<typeof polystellaOptionsSchema>): string[] {
  const issues: string[] = [];
  const formats: Array<{ name: string; keys: Record<string, string[]>; urls: Record<string, string[]> }> = [
    { name: "markdown", keys: opts.markdown.keys, urls: opts.markdown.urls },
    { name: "toml", keys: opts.toml.keys, urls: opts.toml.urls },
  ];
  for (const format of formats) {
    for (const glob of Object.keys(format.keys)) {
      const keysList = format.keys[glob] ?? [];
      const urlsList = format.urls[glob] ?? [];
      if (keysList.length === 0 || urlsList.length === 0) continue;
      const overlap = keysList.filter((k) => urlsList.includes(k));
      if (overlap.length > 0) {
        issues.push(
          `  • ${format.name}: glob "${glob}" lists ${overlap.map((k) => `"${k}"`).join(", ")} in both \`keys\` and \`urls\`. Pick one — translatable scalars and URL fields are mutually exclusive.`,
        );
      }
    }
  }
  return issues;
}
