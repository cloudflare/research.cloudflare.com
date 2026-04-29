import { z } from "astro/zod";

/**
 * PolyStella options schema.
 *
 * Validation strategy:
 *   - `defaultLocale` and `locales` are strictly required (the integration
 *     cannot do anything useful without them).
 *   - `r2` and `provider` are zod-optional. They become strictly required
 *     at their point of consumption — `provider` once the AI translator
 *     is wired in, `r2` once real cache fetches are wired in — so
 *     dry-run / parse / glossary work can proceed without credentials
 *     provisioned.
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
   * The resolved model id is part of the cache key, so changing it
   * invalidates that locale's cached translations.
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

    // --- Storage (required once real R2 access is wired in) ---
    r2: r2OptionsSchema.optional(),

    // --- Provider (required once the AI translator is wired in) ---
    provider: providerSchema.optional(),

    // --- Glossary ---
    glossary: glossarySchema.optional(),

    // --- Translation overrides (§3.10) ---
    overridesDir: z.string().default("./i18n/overrides"),

    // --- Prompt customisation ---
    // The package ships a deliberately generic system prompt
    // ("You are a professional translator."). Sites that want to bias
    // the model toward a domain (research, marketing, legal, …) can
    // supply a `context` string here; it's appended as a separate
    // system-prompt line right after the role declaration. Future
    // knobs (e.g. extra format rules) will land in this same namespace.
    prompt: z
      .object({
        context: z
          .string()
          .optional()
          .describe(
            "Site-/domain-specific guidance appended to the default 'You are a professional translator.' opener. Example: 'Specialise in technical research content from the Cloudflare Research portal.'",
          ),
      })
      .default({}),

    // --- Debugging / inspection ---
    // Until the cache + route-injection layers land, translated MDX is
    // discarded after the build hook logs its preview line. Setting
    // `debug.previewDir` writes each successful translation to
    // `<previewDir>/<locale>/<sourceRelativePath>` for human inspection.
    // Treat the directory as ephemeral — it'll be superseded by the
    // real cache/output path once that work lands.
    debug: z
      .object({
        previewDir: z
          .string()
          .optional()
          .describe(
            "If set, write translated MDX to this directory (one file per locale × source) for inspection. Ephemeral; replaced by the cache layer.",
          ),
      })
      .default({}),

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
    `[polystella] invalid options:\n${issues}\n\nSee polystella.config.mjs (or your project's PolyStella config) for the full options reference.`,
  );
}
