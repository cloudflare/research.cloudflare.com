import { z } from "astro/zod";

/**
 * PolyStella options schema (M2.1).
 *
 *
 * Validation strategy:
 *   - `defaultLocale` and `locales` are strictly required (the integration
 *     cannot do anything useful without them).
 *   - `r2` and `provider` are zod-optional at this stage. They become
 *     strictly required at the point of consumption (M6 for R2, M5 for
 *     the provider). This keeps M1–M4 (dry-run / parse / glossary work)
 *     unblocked while §0 prerequisites are still being provisioned in
 *     parallel.
 *   - All other fields have sensible defaults.
 */

const localeStringSchema = z
  .string()
  .min(1, "locale strings must be non-empty");

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
   * Either a single model id, or a per-locale map with a `default` key.
   * Engineering plan §1: the resolved model is part of the cache key.
   */
  model: z.union([
    z.string().min(1),
    z.object({ default: z.string().min(1) }).catchall(z.string().min(1)),
  ]),
});

const anthropicProviderSchema = z.object({
  kind: z.literal("anthropic"),
  apiKey: z.string().min(1, "provider.apiKey is required"),
  model: z.union([
    z.string().min(1),
    z.object({ default: z.string().min(1) }).catchall(z.string().min(1)),
  ]),
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
    // --- Locales (required) ---
    defaultLocale: localeStringSchema.describe(
      "Source/canonical language code. Any language is supported; English is the common case.",
    ),
    locales: z
      .array(localeStringSchema)
      .min(1, "polystella.locales must declare at least one target locale")
      .describe("Target locales. Does NOT include defaultLocale."),

    // --- Source ---
    sourceDir: z.string().default("./content"),
    include: z.array(z.string()).default(["**/*.md", "**/*.mdx"]),
    exclude: z.array(z.string()).default([]),

    // --- Per-collection frontmatter rules. Globs against relative source path. ---
    frontmatter: z.record(z.string(), z.array(z.string())).default({}),

    // --- Standalone-mode routing ---
    routes: z.array(z.string()).default([]),
    noTranslateBehavior: z.enum(["fallback", "404"]).default("fallback"),
    rewriteInternalLinks: z.boolean().default(true),

    // --- Storage (zod-optional at M2; required at M6) ---
    r2: r2OptionsSchema.optional(),

    // --- Provider (zod-optional at M2; required at M5) ---
    provider: providerSchema.optional(),

    // --- Glossary ---
    glossary: glossarySchema.optional(),

    // --- Translation overrides (§3.10) ---
    overridesDir: z.string().default("./i18n/overrides"),

    // --- Behavior ---
    fallback: z.enum(["default-locale", "skip"]).default("default-locale"),
    concurrency: z.number().int().positive().default(4),
    dryRun: z.boolean().default(false),
    runOn: z.array(z.enum(["build", "dev"])).default(["build"]),
    failOnMissingCredentials: z.boolean().optional(),
    mode: z.enum(["auto", "standalone", "starlight"]).default("auto"),
  })
  .strict()
  .superRefine((opts, ctx) => {
    if (opts.locales.includes(opts.defaultLocale)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locales"],
        message: `polystella.locales must NOT include the defaultLocale ("${opts.defaultLocale}"); list only target locales.`,
      });
    }
    const dupes = opts.locales.filter(
      (locale, i) => opts.locales.indexOf(locale) !== i,
    );
    if (dupes.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locales"],
        message: `polystella.locales contains duplicates: ${[
          ...new Set(dupes),
        ].join(", ")}`,
      });
    }
  });

export type PolyStellaOptions = z.input<typeof polystellaOptionsSchema>;
export type PolyStellaResolvedOptions = z.output<
  typeof polystellaOptionsSchema
>;

/**
 * Parse + validate user-provided options. Throws a single Error whose
 * message lists every invalid field with its zod path, suitable for
 * surfacing at `astro:config:setup`.
 */
export function resolveOptions(raw: unknown): PolyStellaResolvedOptions {
  const parsed = polystellaOptionsSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  const issues = parsed.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `  • ${path}: ${issue.message}`;
    })
    .join("\n");
  throw new Error(
    `[polystella] invalid options:\n${issues}\n\nSee .windsurf/plans/polystella-rfc-6fe9a6.md §6.1 for the full options reference.`,
  );
}
