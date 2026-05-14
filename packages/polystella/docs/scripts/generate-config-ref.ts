#!/usr/bin/env tsx
/**
 * Auto-generate the configuration reference markdown page from the
 * canonical zod schema in `src/config/options.ts`. Runs in
 * `pnpm --filter polystella-docs prebuild` so any `astro dev` /
 * `astro build` cycle picks up schema drift automatically.
 *
 * Targets zod v4 (the version bundled by Astro 6). Specifically
 * handles the wrapper shapes the polystella schema uses: optional,
 * default, pipe-with-transform, object, discriminated union,
 * union, array, record, enum, literal, and the primitive types.
 *
 * Anything else falls back to `unknown` so a future schema addition
 * is visible in the rendered output rather than crashing the build.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "astro/zod";

import { polystellaOptionsSchema } from "../../src/config/options.js";

const DOCS_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT_PATH = path.join(DOCS_ROOT, "src", "content", "docs", "configuration", "reference.md");

interface FieldRow {
  /** Dotted path from the root, e.g. `r2.prefix`. */
  path: string;
  /** Human-readable type label, e.g. `string`, `boolean`, `enum(build, dev)`. */
  type: string;
  /** Default value as it would appear in JS source, or `—` when none. */
  defaultValue: string;
  /** True when the field is optional at this level. */
  optional: boolean;
  /** Description from `.describe()`, or `undefined`. */
  description: string | undefined;
}

interface UnwrapResult {
  inner: z.ZodTypeAny;
  optional: boolean;
  defaultValue: unknown | undefined;
}

/**
 * Walk zod wrappers (`optional`, `default`, `pipe`) until we reach
 * a "real" type. Collects optional-ness and default-value along the
 * way so the renderer doesn't have to look at the original wrapper.
 */
function unwrap(schema: z.ZodTypeAny): UnwrapResult {
  let inner = schema;
  let optional = false;
  let defaultValue: unknown | undefined;

  // Bound the loop defensively; the polystella schema nests at most
  // 3 wrappers deep but third-party additions could be deeper.
  for (let i = 0; i < 8; i++) {
    if (inner instanceof z.ZodOptional) {
      optional = true;
      inner = inner.unwrap();
      continue;
    }
    if (inner instanceof z.ZodDefault) {
      defaultValue = (inner._def as { defaultValue: unknown }).defaultValue;
      inner = (inner._def as { innerType: z.ZodTypeAny }).innerType;
      continue;
    }
    if (inner instanceof z.ZodPipe) {
      // `.default(...).transform(...)` becomes a pipe whose `in` is
      // the default-wrapped schema. Documented type is the `in`'s
      // unwrapped form; the transform is opaque to docs consumers.
      inner = (inner._def as { in: z.ZodTypeAny }).in;
      continue;
    }
    break;
  }
  return { inner, optional, defaultValue };
}

function formatDefault(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "`null`";
  if (typeof value === "string") return `\`${JSON.stringify(value)}\``;
  if (typeof value === "boolean" || typeof value === "number") return `\`${String(value)}\``;
  if (Array.isArray(value)) return `\`${JSON.stringify(value)}\``;
  if (typeof value === "object") return `\`${JSON.stringify(value)}\``;
  return `\`${String(value)}\``;
}

/**
 * Render a one-line type label for a fully-unwrapped schema. Doesn't
 * recurse into objects — that's the walker's job — but DOES recurse
 * into containers (array, record, union) to surface their value type.
 */
function describeType(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodString) return "string";
  if (schema instanceof z.ZodNumber) return "number";
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodLiteral) {
    // zod v4 stores literals in `_def.values` (an array), not `value`.
    const values = (schema._def as { values?: readonly unknown[] }).values;
    if (values && values.length > 0) {
      return values.map((v) => `\`${JSON.stringify(v)}\``).join(" \\| ");
    }
    return "literal";
  }
  if (schema instanceof z.ZodEnum) {
    // zod v4 stores enum members in `_def.entries` (record), not `values`.
    const entries = (schema._def as { entries?: Record<string, string> }).entries;
    const values = entries ? Object.values(entries) : [];
    if (values.length === 0) return "enum";
    return `enum: ${values.map((v) => `\`${v}\``).join(" \\| ")}`;
  }
  if (schema instanceof z.ZodArray) {
    const element = (schema._def as { element: z.ZodTypeAny }).element;
    const { inner: unwrappedElement } = unwrap(element);
    return `array of ${describeType(unwrappedElement)}`;
  }
  if (schema instanceof z.ZodRecord) {
    const valueDef = (schema._def as { valueType: z.ZodTypeAny }).valueType;
    const { inner: unwrappedValue } = unwrap(valueDef);
    return `record (string → ${describeType(unwrappedValue)})`;
  }
  // ZodDiscriminatedUnion extends ZodUnion in zod v4 — check it first
  // so the more-specific branch wins.
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const discriminator = (schema._def as { discriminator: string }).discriminator;
    return `discriminated union (by \`${discriminator}\`)`;
  }
  if (schema instanceof z.ZodUnion) {
    const options = (schema._def as { options: readonly z.ZodTypeAny[] }).options;
    const labels = options.map((o) => describeType(unwrap(o).inner));
    // Dedupe identical labels (e.g. `object | object` when both
    // branches are different object shapes — not useful to repeat).
    const unique = [...new Set(labels)];
    return unique.join(" \\| ");
  }
  if (schema instanceof z.ZodObject) {
    return "object";
  }
  return "unknown";
}

/**
 * Description discovery is awkward in zod v4: `.describe()` writes
 * to the inner type, but our walker carries wrappers up to the
 * caller. Try the field schema first, then the unwrapped inner.
 */
function getDescription(fieldSchema: z.ZodTypeAny, unwrappedInner: z.ZodTypeAny): string | undefined {
  const direct = (fieldSchema as { description?: string }).description;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const inner = (unwrappedInner as { description?: string }).description;
  if (typeof inner === "string" && inner.length > 0) return inner;
  return undefined;
}

/**
 * Walk a ZodObject's shape, emitting one row per field. Nested
 * objects recurse to produce `parent.child` paths; discriminated
 * unions emit a row per variant with a `(when kind = "...")` suffix
 * on the path so the variant fields read clearly.
 */
function walk(schema: z.ZodTypeAny, prefix: string, rows: FieldRow[]): void {
  const top = unwrap(schema);

  if (top.inner instanceof z.ZodObject) {
    const shape = top.inner.shape as Record<string, z.ZodTypeAny>;
    for (const [key, child] of Object.entries(shape)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const { inner: childInner, optional: childOptional, defaultValue: childDefault } = unwrap(child);

      rows.push({
        path,
        type: describeType(childInner),
        defaultValue: formatDefault(childDefault),
        optional: childOptional,
        description: getDescription(child, childInner),
      });

      // Recurse into plain nested objects so their fields surface
      // with dotted paths. Discriminated unions are recursed into
      // below as a separate top-level branch.
      if (childInner instanceof z.ZodObject) {
        walk(child, path, rows);
      } else if (childInner instanceof z.ZodDiscriminatedUnion) {
        walk(child, path, rows);
      }
    }
    return;
  }

  if (top.inner instanceof z.ZodDiscriminatedUnion) {
    const options = (
      top.inner._def as {
        options: readonly z.ZodTypeAny[];
        discriminator: string;
      }
    ).options;
    const discriminator = (top.inner._def as { discriminator: string }).discriminator;
    for (const option of options) {
      const optInner = unwrap(option).inner;
      if (!(optInner instanceof z.ZodObject)) continue;
      const optShape = optInner.shape as Record<string, z.ZodTypeAny>;
      const kindSchema = optShape[discriminator];
      // zod v4 ZodLiteral keeps the value(s) in `_def.values`.
      const kindValues = kindSchema instanceof z.ZodLiteral ? (kindSchema._def as { values?: readonly unknown[] }).values : undefined;
      const kindValue = kindValues && kindValues.length > 0 ? String(kindValues[0]) : "?";
      const variantPrefix = `${prefix} (${discriminator} = "${kindValue}")`;
      walk(option, variantPrefix, rows);
    }
    return;
  }

  // Other top-level shapes shouldn't be reached given polystella's
  // schema, but bail quietly if they are.
}

function renderTable(rows: FieldRow[]): string {
  if (rows.length === 0) return "_No fields._";

  const lines: string[] = [];
  lines.push("| Path | Type | Default | Required | Description |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of rows) {
    // A field is "required" from the consumer's perspective only when
    // it has neither a default nor an optional wrapper. Fields with
    // a default are semantically optional even though the schema
    // requires them after fill-in.
    const hasDefault = row.defaultValue !== "—";
    const required = row.optional || hasDefault ? "Optional" : "Required";
    // Markdown table cells: escape pipe, collapse newlines into spaces.
    const description = (row.description ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
    lines.push(`| \`${row.path}\` | ${row.type} | ${row.defaultValue} | ${required} | ${description} |`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const rows: FieldRow[] = [];
  walk(polystellaOptionsSchema, "", rows);

  const body = [
    "---",
    "title: Configuration reference",
    "description: Full polystella.config.mjs option reference, generated from the zod schema.",
    "---",
    "",
    ":::note[Auto-generated]",
    "This page is regenerated from `src/config/options.ts` on every",
    "`pnpm --filter polystella-docs build`. Don't hand-edit; the",
    "generator overwrites it.",
    ":::",
    "",
    "The table below lists every option accepted by",
    "`polystella(options)` and `polystella.config.mjs`. Defaults shown",
    "are exactly what the schema applies when the field is omitted.",
    "",
    "For prose context on individual options, see the",
    "[overview page](/configuration/) and the adjacent concept pages.",
    "",
    renderTable(rows),
    "",
  ].join("\n");

  await writeFile(OUTPUT_PATH, body, "utf8");
  console.log(`[generate-config-ref] wrote ${rows.length} rows → ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error("[generate-config-ref] failed:", err);
  process.exitCode = 1;
});
