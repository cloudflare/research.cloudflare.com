import type { FileTypeAdapter } from "./adapter.js";
import { markdownAdapter } from "./adapters/markdown.js";
import { tomlAdapter } from "./adapters/toml.js";

/**
 * Registry of file-format adapters keyed by extension.
 *
 * **First-registered wins.** If two adapters claim the same
 * extension, the one registered first owns it; later registrations
 * for that extension are silently ignored. Production callers
 * register exactly one adapter per extension, so collisions only
 * matter for tests and bespoke setups.
 *
 * **Built-in adapters.** Markdown is registered automatically at
 * module load. v0.1.x M3–M5 register TOML / JSON / YAML adapters
 * the same way.
 *
 * **Resetting (tests).** Tests that need a clean slate call
 * `resetRegistry()` and re-register the adapters they want.
 * `runTranslationPass` consumes the live module-scoped registry.
 */

const ADAPTERS_BY_EXT = new Map<string, FileTypeAdapter>();

/**
 * Register `adapter` for every extension it claims. Subsequent
 * registrations for the same extension are no-ops, leaving the
 * first registrant in place.
 */
export function registerAdapter(adapter: FileTypeAdapter): void {
  for (const ext of adapter.extensions) {
    if (ADAPTERS_BY_EXT.has(ext)) continue;
    ADAPTERS_BY_EXT.set(ext, adapter);
  }
}

/**
 * Look up the adapter for an extension (must include the leading
 * dot, e.g. `".md"`). Returns `undefined` on miss; callers warn-
 * and-skip the source file in that case.
 */
export function getAdapter(extension: string): FileTypeAdapter | undefined {
  return ADAPTERS_BY_EXT.get(extension.toLowerCase());
}

/**
 * Snapshot of the currently-registered extensions, sorted. Used by
 * the warn-on-miss helper to suggest known extensions in error
 * messages.
 */
export function listRegisteredExtensions(): string[] {
  return [...ADAPTERS_BY_EXT.keys()].sort();
}

/**
 * Clear all registrations. Test-only — production code never calls
 * this (the module-scoped state is a singleton by design).
 */
export function resetRegistry(): void {
  ADAPTERS_BY_EXT.clear();
}

// Built-in registrations. Order here decides "first-registered wins"
// for ties; markdown owns `.md`/`.mdx`, TOML owns `.toml`.
registerAdapter(markdownAdapter);
registerAdapter(tomlAdapter);
