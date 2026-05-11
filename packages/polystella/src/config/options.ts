import { z } from "astro/zod";

/**
 * PolyStella options schema. `defaultLocale` / `locales` are derived
 * from Astro's `config.i18n` (single source of truth, see
 * `resolveOptions`). `r2` and `provider` are zod-optional so dry-run
 * / parse / glossary work can proceed without credentials; enforced
 * required at point of consumption.
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
   * Skip PUTs and the post-translation prune. GETs against `prefix`
   * and `readFallbackPrefixes` still happen. Canonical use: preview-
   * branch builds that read main's translations but don't write back.
   */
  readOnly: z.boolean().default(false),
  /**
   * Additional prefixes consulted on cache miss. First hit wins.
   * Bytes are returned verbatim — NOT promoted into the primary
   * prefix. Each entry MUST end with `/`. Used for branch isolation
   * (e.g. `previews/<branch>/i18n/` + `readFallbackPrefixes: ["i18n/"]`).
   */
  readFallbackPrefixes: z.array(z.string()).default([]),
  /**
   * Per (locale, sourcePath), keep only N most-recent hash variants.
   * `false` disables pruning.
   */
  keepLastN: z.union([z.number().int().positive(), z.literal(false)]).default(5),
});

const workersAiProviderSchema = z.object({
  kind: z.literal("workers-ai"),
  accountId: z.string().min(1, "provider.accountId is required"),
  apiToken: z.string().min(1, "provider.apiToken is required"),
  endpoint: z.string().url().optional(),
  /**
   * Single model id or per-locale map with a `default` key. Model id
   * is part of the cache key — changing it invalidates that locale's
   * cached translations.
   */
  model: z.union([z.string().min(1), z.object({ default: z.string().min(1) }).catchall(z.string().min(1))]),
  /**
   * Max output tokens. Workers AI's default ceiling (~256) truncates
   * multi-segment translations. 8192 fits under llama-3.1-8b's cap.
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
     * Per-format config. Each format has the same shape:
     *   - `keys` (per-glob → key-paths) — translatable scalars,
     *     fed to the translator.
     *   - `urls` (per-glob → key-paths) — URL fields locale-prefixed
     *     at staging.
     *
     * The same path MUST NOT appear in both `keys` and `urls` for a
     * given glob — would double-process. Errors at config-resolve.
     *
     * Markdown: `keys` is frontmatter only (body inline text is
     * automatic); `urls` is frontmatter only (body links are
     * automatic).
     *
     * Example:
     *     markdown: {
     *       keys: { "publications/**": ["title", "metaDescription"] },
     *       urls: { "publications/**": ["heroImage"] },
     *     }
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

    json: z
      .object({
        keys: z.record(z.string(), z.array(z.string())).default({}),
        urls: z.record(z.string(), z.array(z.string())).default({}),
      })
      .strict()
      .default({ keys: {}, urls: {} }),

    yaml: z
      .object({
        keys: z.record(z.string(), z.array(z.string())).default({}),
        urls: z.record(z.string(), z.array(z.string())).default({}),
      })
      .strict()
      .default({ keys: {}, urls: {} }),

    /**
     * Internal URL paths the link rewriter leaves unprefixed. Globs
     * match against the path (after splitting query/fragment).
     * External URLs and anchor-only URLs bail out before this list.
     *
     * Example: `noPrefixUrls: ["/api-docs", "/api-docs/**", "/legal/*"]`
     */
    noPrefixUrls: z.array(z.string()).default([]),

    /**
     * Source pages to inject locale-prefixed shims for. Each entry
     * is `string` or `{ source, imports }` where `imports` are extra
     * modules (typically CSS) the shim should pull in.
     *
     * `imports` exists because Astro's per-route `<link
     * rel="stylesheet">` injection only follows direct first-degree
     * imports of the route's own module. A shim that renders a
     * source page via `<SourcePage />` won't pull in the source's
     * transitive CSS unless the shim itself imports it. Combined
     * with the top-level `routesImports` default, this makes CSS
     * first-degree and triggers Astro's link emission.
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
    /**
     * Retry attempts on transient translator failures (malformed
     * model responses, provider throws). Each retry re-issues the
     * same prompt; sampling variance is what makes attempt N+1
     * succeed. `0` disables retries; default 2 = up to 3 attempts.
     * Network-layer retries (5xx, ECONNRESET) live below the HTTP
     * client and are out of scope here.
     */
    maxRetries: z.number().int().min(0).default(2),
    dryRun: z.boolean().default(false),
    runOn: z.array(z.enum(["build", "dev"])).default(["build"]),
    // `auto` and `"standalone"` are equivalent today. `"starlight"`
    // is rejected at parse time — planned for a later milestone.
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
    /** Log one line per (file, locale) pair. Off by default. */
    verbose: z.boolean().default(false),

    /**
     * Auto-register the polystella request middleware. `false`
     * disables auto-registration so you can compose manually via
     * `sequence(...)`. Factory exported as `polystellaMiddleware`.
     */
    middleware: z.boolean().default(true),
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
 * Structural type for the slice of Astro's `i18n` config we read.
 * Decouples the schema from Astro's type surface; tests pass plain
 * objects.
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
 * Parse user options + derive locales from `config.i18n`. Aggregates
 * all errors into a single throw so the operator fixes everything in
 * one pass. Never writes to Astro's config.
 */
export function resolveOptions(raw: unknown, astroI18n: AstroI18nLike | undefined): PolyStellaResolvedOptions {
  const parsed = polystellaOptionsSchema.safeParse(raw);
  const optionIssues = parsed.success
    ? []
    : parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
        return `  • ${path}: ${issue.message}`;
      });

  // A path in both `keys` and `urls` would be double-processed (AI
  // translates the URL string AND the rewriter prefixes the result).
  // Always a typo — fail loudly.
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
 * Cross-check Astro's `i18n` block. Returns bullet-prefixed error
 * lines for `resolveOptions` to aggregate. Empty = acceptable.
 */
function validateAstroI18n(i18n: AstroI18nLike | undefined): string[] {
  if (i18n === undefined) {
    return [
      `  • Astro's \`i18n\` config is missing. Add a block like the
    following to your astro.config.mjs (adjust locales as needed):

        i18n: {
          defaultLocale: "en-US",
          locales: ["en-US", "pt-BR", "ja-JP"],
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
 * Per-format check: any glob whose `keys[glob]` and `urls[glob]`
 * lists intersect. Each format reports independently.
 */
function findKeysUrlsOverlaps(opts: z.output<typeof polystellaOptionsSchema>): string[] {
  const issues: string[] = [];
  const formats: Array<{ name: string; keys: Record<string, string[]>; urls: Record<string, string[]> }> = [
    { name: "markdown", keys: opts.markdown.keys, urls: opts.markdown.urls },
    { name: "toml", keys: opts.toml.keys, urls: opts.toml.urls },
    { name: "json", keys: opts.json.keys, urls: opts.json.urls },
    { name: "yaml", keys: opts.yaml.keys, urls: opts.yaml.urls },
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
