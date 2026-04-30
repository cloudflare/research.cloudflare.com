import { z } from "astro/zod";

/**
 * PolyStella options schema.
 *
 * Validation strategy:
 *   - `defaultLocale` and `locales` are NOT in this schema — they are
 *     derived from Astro's native `config.i18n` at `astro:config:setup`
 *     to keep a single source of truth for the locale set. See
 *     `resolveOptions` below for the cross-check logic.
 *   - `r2` and `provider` are zod-optional. They become strictly required
 *     at their point of consumption — `provider` once the AI translator
 *     is wired in, `r2` once real cache fetches are wired in — so
 *     dry-run / parse / glossary work can proceed without credentials
 *     provisioned.
 *   - All other fields have sensible defaults.
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
    // --- Locales ---
    // NOT declared here. `defaultLocale` and `locales` are derived from
    // Astro's `config.i18n` at `astro:config:setup` to avoid two
    // sources of truth. See `resolveOptions` for the derivation.

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
 * read. Defined locally rather than importing `AstroConfig` so the
 * schema stays decoupled from Astro's type surface (and so unit tests
 * can pass plain objects).
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
 * Parse + validate user-provided options and derive the locale set
 * from Astro's `config.i18n`. Throws a single Error whose message
 * surfaces all problems at once — user-options issues from zod, plus
 * any cross-check failure against `astroI18n` — suitable for surfacing
 * at `astro:config:setup`.
 *
 * Pass `config.i18n` from the integration's `astro:config:setup` hook
 * as the second argument. If it's `undefined`, the function throws
 * with a copy-pasteable starter block; PolyStella deliberately does
 * not write into Astro's config.
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
        `  • \`i18n.locales\` contains object-form entries (${paths}). PolyStella v0.1 only supports plain string locales; rewrite them as plain strings (e.g. "pt-BR") and we'll add object-form support in a later milestone.`,
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
      '  • `i18n.routing: "manual"` is not supported by PolyStella v0.1 (we rely on Astro\'s built-in locale-prefix routing to inject translated routes). Use `routing: { prefixDefaultLocale: false }` (or omit `routing` entirely) for the canonical "existing site adds i18n" setup.',
    );
  }

  return issues;
}
