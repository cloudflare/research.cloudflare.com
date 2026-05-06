import { file as astroFile } from "astro/loaders";

/**
 * Polystella-flavoured `file()` loader. Identical signature and
 * runtime behaviour to Astro's `file()` — under the hood, this just
 * forwards to it. The only thing this wrapper adds is a non-
 * enumerable `__polystellaSourcePath` property on the returned
 * loader, recording the path the user passed in.
 *
 * `polystellaCollections` reads that property at content-config
 * time to auto-derive locale-sibling collections for single-file
 * sources WITHOUT requiring `loaderOverrides[name] = { kind: "file",
 * filename: "..." }`. Astro's own `file()` closes the path inside
 * the loader's `load` function, opaque to introspection — wrapping
 * is the cleanest way to surface it back.
 *
 * **Drop-in replacement.** Swap `import { file } from "astro/loaders"`
 * for `import { file } from "polystella/content"`. No other code
 * changes.
 *
 * **Non-enumerable on purpose.** `JSON.stringify(loader)` and
 * `Object.keys(loader)` skip the property, so test fixtures and
 * any code that serialises loaders see exactly what Astro's `file()`
 * produces.
 */
export type AstroFileOptions = Parameters<typeof astroFile>[1];

/**
 * Marker key on `file-loader` instances created via this wrapper.
 * Symbol-like uniqueness via the `__polystella` prefix avoids
 * colliding with anything Astro might add to its loader shape later.
 */
export const POLYSTELLA_SOURCE_PATH_KEY = "__polystellaSourcePath" as const;

export interface PolystellaFileLoader {
  name: "file-loader";
  load: ReturnType<typeof astroFile>["load"];
  /** Path the user passed to `file()`. Non-enumerable own property. */
  readonly [POLYSTELLA_SOURCE_PATH_KEY]?: string;
}

export function file(fileName: string, options?: AstroFileOptions): PolystellaFileLoader {
  const loader = astroFile(fileName, options) as PolystellaFileLoader;
  // Non-enumerable so JSON.stringify, Object.keys, and other callers
  // that introspect the loader see exactly what Astro's `file()`
  // produces. `polystellaCollections` reads it via direct property
  // access.
  Object.defineProperty(loader, POLYSTELLA_SOURCE_PATH_KEY, {
    value: fileName,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return loader;
}

/**
 * Read the path recorded by the polystella `file()` wrapper, if any.
 * Returns `undefined` for loaders constructed via Astro's bare
 * `file()` — callers can fall back to `loaderOverrides` in that
 * case.
 */
export function readRecordedSourcePath(loader: unknown): string | undefined {
  if (loader === null || typeof loader !== "object") return undefined;
  const value = (loader as Record<string, unknown>)[POLYSTELLA_SOURCE_PATH_KEY];
  return typeof value === "string" ? value : undefined;
}
