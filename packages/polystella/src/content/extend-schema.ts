import { z } from "astro/zod";

/**
 * Schema extension that injects optional AI-translation marker fields
 * into consumer collection schemas, so `entry.data.aiTranslated` is
 * reachable on translated entries WITHOUT requiring consumers to alter
 * their schemas.
 *
 * Background: today's markdown adapter writes `aiTranslated: true`
 * (and `aiTranslationModel`, `aiTranslatedAt`) into translated
 * frontmatter. But consumer schemas are typically plain
 * `z.object({...})` — Zod's default `strip` mode silently drops the
 * extra keys before they reach `entry.data`. Without this extender,
 * the marker is unreachable on the consumer side.
 *
 * **Always-on, no opt-out.** Source-schema extension is harmless
 * (the marker fields are optional and never populated on source
 * content), and sibling-schema extension is required for the feature
 * to work at all. Polystella never silently overrides a consumer's
 * declaration: if the schema already declares any of the three marker
 * fields, the extender warns, preserves the consumer's type, and only
 * adds the *missing* fields.
 *
 * **Supported schema shapes.** Plain `z.object({...})`, `z.object().refine(...)`,
 * `.passthrough()`, and `.strict()` all extend cleanly because Astro's
 * Zod surfaces a real `ZodObject` with `.extend()` available. Function-
 * form schemas (`({image}) => z.object({...})`) are wrapped: the
 * function is called with the deps Astro injects, and the resulting
 * schema is extended.
 *
 * **Unsupported shapes.** `.transform()` (returns `ZodPipe`),
 * `z.intersection(...)`, `z.union(...)`, and non-Zod schemas can't
 * be extended without losing the user's intent. The extender warns,
 * leaves the schema unchanged, and consumers who hit this path can
 * declare the three marker fields manually.
 */

/** Marker keys reserved for AI-translation provenance. */
export const AI_MARKER_KEYS = ["aiTranslated", "aiTranslationModel", "aiTranslatedAt"] as const;

export type AiMarkerKey = (typeof AI_MARKER_KEYS)[number];

/**
 * Build the per-key Zod additions. All three are optional so source
 * entries (which never have them populated) validate fine; sibling
 * translated entries (which do) validate fine; sibling override
 * entries (which don't) also validate fine.
 *
 * `aiTranslatedAt` accepts both `string` and `Date` because YAML
 * frontmatter auto-parses ISO 8601 strings into Date objects on read
 * (markdown frontmatter values flow through `yaml.parse`). TOML's
 * `Date` type produces the same shape. Consumers reading the field
 * should call `new Date(value)` defensively or use `z.coerce.date()`
 * in their own helpers — we accept either form so neither shape
 * breaks validation.
 */
function buildMarkerShape(): Record<AiMarkerKey, z.ZodOptional<z.ZodTypeAny>> {
  return {
    aiTranslated: z.boolean().optional(),
    aiTranslationModel: z.string().optional(),
    aiTranslatedAt: z.union([z.string(), z.date()]).optional(),
  };
}

export interface ExtendSchemaOpts {
  /** Collection name, threaded through warnings for actionable diagnostics. */
  collectionName: string;
  /** Defaults to `console`; tests pass a stub. */
  logger?: { warn: (message: string) => void };
}

/**
 * Extend a single collection's schema with the AI-translation marker.
 * Handles the supported Zod shapes and the function-form schema; warns
 * and returns the input unchanged for shapes that can't be extended.
 *
 * Returns `undefined` when the input is `undefined` (loader-only
 * collections have no schema; the helper preserves that).
 */
export function extendSchemaWithAiMarker(schema: unknown, opts: ExtendSchemaOpts): unknown {
  if (schema === undefined) return undefined;

  // Function-form schema: `({ image }) => z.object({...})`. Wrap so
  // the call site (Astro) still invokes it with deps; we extend the
  // result before handing it back. Each invocation re-extends — but
  // that's cheap (Zod's `.extend` is just `new ZodObject({...})`).
  if (typeof schema === "function") {
    return (deps: Record<string, unknown>) => {
      const inner = (schema as (deps: Record<string, unknown>) => unknown)(deps);
      return extendSchemaWithAiMarker(inner, opts);
    };
  }

  // Direct ZodObject (covers plain objects, `.refine()`, `.passthrough()`,
  // `.strict()` — all of which return a ZodObject in Astro's Zod and
  // expose `.extend()`).
  if (schema instanceof z.ZodObject) {
    return extendZodObject(schema, opts);
  }

  // Zod-derived but not a `ZodObject` (e.g. `.transform()` →
  // `ZodPipe`, `z.intersection(...)`, `z.union(...)`). These can't
  // be extended without losing the user's intent. Warn so the
  // consumer knows `entry.data.aiTranslated` won't reach them, and
  // pass the schema through unchanged.
  if (schema instanceof z.ZodType) {
    warnUnsupportedSchema(schema, opts);
    return schema;
  }

  // Non-Zod schema (custom validators, test stubs). We can't extend
  // these and the consumer almost certainly doesn't want us to — pass
  // through silently so test fixtures and exotic setups don't trigger
  // false warnings. Production consumers using non-Zod schemas can
  // declare the three marker fields by hand if they need disclaimers.
  return schema;
}

/**
 * Add only the marker keys NOT already declared on the consumer's
 * schema. If the consumer pre-declares one (e.g. they migrated from
 * a previous polystella version where they added the fields by hand),
 * polystella warns and preserves the consumer's declaration.
 */
function extendZodObject(schema: z.ZodObject<z.ZodRawShape>, opts: ExtendSchemaOpts): z.ZodObject<z.ZodRawShape> {
  const existingShape = schema.shape;
  const fullMarker = buildMarkerShape();

  const conflicts: string[] = [];
  const additions: Partial<Record<AiMarkerKey, z.ZodOptional<z.ZodTypeAny>>> = {};
  for (const key of AI_MARKER_KEYS) {
    if (key in existingShape) {
      conflicts.push(key);
    } else {
      additions[key] = fullMarker[key];
    }
  }

  if (conflicts.length > 0) {
    const logger = opts.logger ?? console;
    logger.warn(
      `[polystella] collection "${opts.collectionName}" already declares: ${conflicts.join(
        ", ",
      )}. Polystella's auto-extension preserves your declarations and only adds the missing AI-translation marker fields. If your fields have incompatible types (e.g. \`aiTranslated: z.string()\`), translated entries will fail Zod validation — consider renaming or relaxing the type.`,
    );
  }

  // Nothing to add (consumer pre-declared all three) — return verbatim.
  if (Object.keys(additions).length === 0) {
    return schema;
  }
  return schema.extend(additions);
}

function warnUnsupportedSchema(schema: unknown, opts: ExtendSchemaOpts): void {
  const logger = opts.logger ?? console;
  const kind = describeSchemaKind(schema);
  logger.warn(
    `[polystella] collection "${opts.collectionName}" uses an ${kind} schema that polystella's auto-extender doesn't support. \`entry.data.aiTranslated\` won't be reachable on translated entries unless you add the three marker fields manually:\n  aiTranslated: z.boolean().optional(),\n  aiTranslationModel: z.string().optional(),\n  aiTranslatedAt: z.string().optional(),`,
  );
}

/**
 * Best-effort label for the unsupported schema, threaded into the
 * warning so operators can match it against their config.
 */
function describeSchemaKind(schema: unknown): string {
  if (schema === null) return "null";
  if (typeof schema !== "object") return typeof schema;
  const ctor = (schema as { constructor?: { name?: string } }).constructor?.name;
  if (typeof ctor === "string" && ctor.startsWith("Zod")) {
    return ctor; // e.g. "ZodPipe", "ZodUnion", "ZodIntersection"
  }
  return "non-Zod object";
}
