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
    .describe(
      "Override the default R2 endpoint (`https://<accountId>.r2.cloudflarestorage.com`). Useful for testing.",
    ),
  readOnly: z.boolean().optional(),
  /**
   * Count-based pruning: per (locale, sourcePath), keep only the N
   * most-recent hash variants. `false` disables pruning.
   */
  keepLastN: z
    .union([z.number().int().positive(), z.literal(false)])
    .default(5),
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
  model: z.union([
    z.string().min(1),
    z.object({ default: z.string().min(1) }).catchall(z.string().min(1)),
  ]),
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
  model: z.union([
    z.string().min(1),
    z.object({ default: z.string().min(1) }).catchall(z.string().min(1)),
  ]),
  /** Max output tokens per call. */
  maxTokens: z.number().int().positive().default(8192),
});

const providerSchema = z.discriminatedUnion("kind", [
  workersAiProviderSchema,
  anthropicProviderSchema,
]);

const glossaryFileSchema = z.object({
  file: z
    .string()
    .min(1)
    .describe(
      "Path template for per-locale glossary files. Use `{locale}` as the placeholder. Example: './i18n/glossary/{locale}.yaml'.",
    ),
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

    // Per-collection frontmatter rules; globs against relative source path.
    frontmatter: z.record(z.string(), z.array(z.string())).default({}),

    routes: z.array(z.string()).default([]),
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
          .describe(
            "Site-/domain-specific guidance appended to the default 'You are a professional translator.' opener.",
          ),
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
            message:
              'mode: "starlight" is not yet supported. Use "standalone" or omit `mode` for the default "auto".',
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

export type PolyStellaResolvedOptions = z.output<
  typeof polystellaOptionsSchema
> & {
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
export function resolveOptions(
  raw: unknown,
  astroI18n: AstroI18nLike | undefined,
): PolyStellaResolvedOptions {
  const parsed = polystellaOptionsSchema.safeParse(raw);
  const optionIssues = parsed.success
    ? []
    : parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
        return `  • ${path}: ${issue.message}`;
      });

  const i18nIssues = validateAstroI18n(astroI18n);

  if (optionIssues.length > 0 || i18nIssues.length > 0) {
    const sections: string[] = [];
    if (optionIssues.length > 0) {
      sections.push(`Invalid PolyStella options:\n${optionIssues.join("\n")}`);
    }
    if (i18nIssues.length > 0) {
      sections.push(
        `Invalid Astro \`i18n\` config (PolyStella derives locales from it):\n${i18nIssues.join("\n")}`,
      );
    }
    throw new Error(
      `[polystella] configuration error:\n${sections.join("\n\n")}\n\nSee polystella.config.mjs and astro.config.mjs for the full reference.`,
    );
  }

  // Both checks passed: derive the locale fields and merge.
  const i18n = astroI18n!;
  const defaultLocale = i18n.defaultLocale;
  const locales = (i18n.locales as string[]).filter(
    (locale) => locale !== defaultLocale,
  );
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
    issues.push(
      "  • `i18n.defaultLocale` is required and must be a non-empty string.",
    );
  }

  if (!Array.isArray(i18n.locales) || i18n.locales.length === 0) {
    issues.push(
      "  • `i18n.locales` is required and must declare at least one locale.",
    );
  } else {
    const objectForms = i18n.locales.filter(
      (entry): entry is { path: string } =>
        typeof entry === "object" && entry !== null,
    );
    if (objectForms.length > 0) {
      const paths = objectForms.map((e) => e.path).join(", ");
      issues.push(
        `  • \`i18n.locales\` contains object-form entries (${paths}). PolyStella only supports plain string locales today; rewrite them as plain strings (e.g. "pt-BR").`,
      );
    }
    const stringLocales = i18n.locales.filter(
      (entry): entry is string => typeof entry === "string",
    );
    if (
      typeof i18n.defaultLocale === "string" &&
      i18n.defaultLocale.length > 0 &&
      !stringLocales.includes(i18n.defaultLocale)
    ) {
      issues.push(
        `  • \`i18n.locales\` must include \`defaultLocale\` ("${i18n.defaultLocale}"). Astro's contract is that the default is one of the listed locales; add it.`,
      );
    }
    const dupes = stringLocales.filter(
      (locale, i) => stringLocales.indexOf(locale) !== i,
    );
    if (dupes.length > 0) {
      issues.push(
        `  • \`i18n.locales\` contains duplicates: ${[...new Set(dupes)].join(", ")}.`,
      );
    }
  }

  if (i18n.routing === "manual") {
    issues.push(
      '  • `i18n.routing: "manual"` is not supported (PolyStella relies on Astro\'s built-in locale-prefix routing). Use `routing: { prefixDefaultLocale: false }` or omit `routing` entirely.',
    );
  }

  return issues;
}
