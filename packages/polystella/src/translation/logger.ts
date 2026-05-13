/**
 * Minimal logger surface shared across the translation pipeline.
 *
 * Trivially stub-able from `console` (production CLI), Astro's
 * `AstroIntegrationLogger` (build hook), or `{ info: vi.fn(), ... }`
 * (tests). Pulled into its own module so leaf primitives like
 * `packGroupsIntoBatches` don't have to import from the orchestrator
 * (`run.ts`) to type a `logger?` option.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}
