/**
 * Custom-loader wrapper. Opts a non-glob / non-file Astro loader
 * into the translation pipeline:
 *
 *   const blog = defineCollection({
 *     loader: polystellaLoader(blogLoader(), {
 *       name: "blog",
 *       translatableKeys: ["title", "excerpt"],
 *     }),
 *   });
 *
 * Adds:
 *   1. A non-enumerable marker `polystellaCollections` reads at
 *      content-config time to auto-derive sibling collections.
 *   2. A `captureEntries()` method the sibling loader calls at
 *      sync time. Runs the raw loader against a synthetic context
 *      and returns the captured entries in insertion order.
 *   3. Single-run guarantee: the raw loader runs exactly once per
 *      build. Source + siblings share the same captured-entry IDs —
 *      critical because the synthetic `generateDigest` uses SHA-256
 *      whereas Astro's runtime uses xxhash; running raw under
 *      Astro's context would produce different IDs.
 *
 * Loader contract: raw `load()` must be safe with a synthetic store
 * that allows writes (`set`, `clear`, `entries`, `keys`, `values`)
 * but throws on reads. Loaders needing mid-load reads opt out via
 * `loaderOverrides[name] = { kind: "skip" }`.
 */

import { createHash } from "node:crypto";

import type { Loader } from "astro/loaders";

/** Pairs the `__polystellaSourcePath` convention from `./file-loader.ts`. */
export const POLYSTELLA_CUSTOM_LOADER_KEY = "__polystellaCustomLoader" as const;

/**
 * Entry captured from a `store.set({ id, data })` call. Mirrors
 * Astro's `DataEntry` shape minus body/digest/rendered (those only
 * matter when stored to the real `DataStore`, not during capture).
 */
export interface CapturedEntry {
  id: string;
  data: Record<string, unknown>;
}

export interface PolystellaCustomLoaderOptions {
  /**
   * Logical name. Used as the sibling-collection key
   * (`<name>__<locale>`) and snapshot directory. MUST match the
   * consumer-declared `defineCollection` key.
   */
  name: string;
  /**
   * Top-level `data` fields the AI translator runs over. Empty
   * array ⇒ siblings mirror source without content changes (useful
   * for collections needing locale routing but no translation).
   */
  translatableKeys: string[];
}

/** Marker stamped on the wrapped loader. Read by the integration. */
export interface PolystellaCustomLoaderMarker {
  name: string;
  translatableKeys: string[];
  /**
   * Run the raw loader against a synthetic context, return entries
   * in insertion order. Throws if raw `load()` throws — the
   * integration catches and skips this loader.
   */
  captureEntries: () => Promise<CapturedEntry[]>;
}

export type PolystellaWrappedLoader = Loader & {
  readonly [POLYSTELLA_CUSTOM_LOADER_KEY]?: PolystellaCustomLoaderMarker;
};

/**
 * Wrap a custom Astro loader for translation. The wrapped loader is
 * an instance of `Loader` AND carries the polystella marker that
 * `polystellaCollections` reads to auto-derive locale siblings.
 *
 * Idempotency: wrapping an already-wrapped loader will produce a new
 * outer wrapper with the new options, but the inner raw loader runs
 * exactly as it would unwrapped. Useful for adding/changing
 * translatable keys without restructuring the loader file.
 */
export function polystellaLoader(raw: Loader, options: PolystellaCustomLoaderOptions): PolystellaWrappedLoader {
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError("[polystella] polystellaLoader: first argument must be an Astro Loader.");
  }
  if (typeof options?.name !== "string" || options.name.length === 0) {
    throw new TypeError("[polystella] polystellaLoader: options.name must be a non-empty string.");
  }
  if (!Array.isArray(options.translatableKeys)) {
    throw new TypeError("[polystella] polystellaLoader: options.translatableKeys must be an array.");
  }

  // Closure state shared between `captureEntries` and `load`. The
  // first caller (whichever it is — Astro calling `load` for the
  // source collection, or a sibling loader calling `captureEntries`)
  // populates the cache by running the raw loader against a synthetic
  // store. Every subsequent caller reads from the cache. The raw
  // loader runs exactly once per build.
  const state: { capturedEntries: CapturedEntry[] | undefined } = {
    capturedEntries: undefined,
  };

  async function captureEntries(): Promise<CapturedEntry[]> {
    if (state.capturedEntries !== undefined) {
      return state.capturedEntries;
    }
    const captured: CapturedEntry[] = [];
    const syntheticContext = buildSyntheticContext({
      collectionName: options.name,
      sink: captured,
    });
    // The synthetic context implements the surface our loaders use
    // but doesn't satisfy Astro's full `LoaderContext`. Unsupported
    // methods throw with a clear `loaderOverrides: { kind: "skip" }`
    // migration message.
    await raw.load(syntheticContext as unknown as Parameters<Loader["load"]>[0]);
    state.capturedEntries = captured;
    return captured;
  }

  const marker: PolystellaCustomLoaderMarker = {
    name: options.name,
    translatableKeys: [...options.translatableKeys],
    captureEntries,
  };

  const wrapped: PolystellaWrappedLoader = {
    name: raw.name,
    load: async (ctx) => {
      // Source-collection populate uses the cached capture (which
      // may already exist from a sibling loader). IDs match what
      // siblings see — same captured entries drive both surfaces.
      const entries = await captureEntries();
      ctx.store.clear();
      for (const entry of entries) {
        const parsed = await ctx.parseData({ id: entry.id, data: entry.data });
        ctx.store.set({ id: entry.id, data: parsed });
      }
    },
  };

  // Preserve loader-provided schema (Astro allows it; consumer's
  // schema overrides). Absence here would silently drop it.
  if ("schema" in raw && raw.schema !== undefined) {
    (wrapped as { schema?: unknown }).schema = raw.schema;
  }

  Object.defineProperty(wrapped, POLYSTELLA_CUSTOM_LOADER_KEY, {
    value: marker,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return wrapped;
}

/** Read the marker; `undefined` for unwrapped loaders. */
export function readPolystellaCustomLoaderMarker(loader: unknown): PolystellaCustomLoaderMarker | undefined {
  if (loader === null || typeof loader !== "object") return undefined;
  const value = (loader as Record<string, unknown>)[POLYSTELLA_CUSTOM_LOADER_KEY];
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<PolystellaCustomLoaderMarker>;
  if (typeof candidate.name !== "string") return undefined;
  if (!Array.isArray(candidate.translatableKeys)) return undefined;
  if (typeof candidate.captureEntries !== "function") return undefined;
  return candidate as PolystellaCustomLoaderMarker;
}

// Synthetic loader context — the bare-minimum surface our
// supported loaders need. Unsupported methods throw with a clear
// `loaderOverrides: { kind: "skip" }` migration message.

interface SyntheticContextInput {
  collectionName: string;
  sink: CapturedEntry[];
}

/**
 * Implements: `store.{set,clear,entries,keys,values,delete}`,
 * pass-through `parseData`, deterministic `generateDigest`
 * (SHA-256 truncated to 16 hex chars), no-op logger.
 */
function buildSyntheticContext(input: SyntheticContextInput): Record<string, unknown> {
  const { collectionName, sink } = input;
  const captured = new Map<string, CapturedEntry>();

  const store = {
    set: (entry: { id: string; data: Record<string, unknown> }) => {
      // Astro's contract: true on insert, false on no-op.
      const existed = captured.has(entry.id);
      captured.set(entry.id, { id: entry.id, data: entry.data });
      // Rebuild sink so insertion order tracks most-recent writes.
      // O(n) per set; trivial for typical custom-loader corpora.
      sink.length = 0;
      for (const e of captured.values()) sink.push(e);
      return !existed;
    },
    clear: () => {
      captured.clear();
      sink.length = 0;
    },
    entries: () => [...captured.entries()],
    keys: () => [...captured.keys()],
    values: () => [...captured.values()],
    get: () => {
      throw new Error(unsupportedStoreMethodError(collectionName, "get"));
    },
    has: () => {
      throw new Error(unsupportedStoreMethodError(collectionName, "has"));
    },
    delete: (id: string) => {
      captured.delete(id);
      sink.length = 0;
      for (const e of captured.values()) sink.push(e);
    },
    // Assets only matter at Astro's real sync, not during capture.
    addAssetImport: () => {},
    addAssetImports: () => {},
    addModuleImport: () => {},
  };

  const meta = {
    get: () => undefined,
    set: () => {},
    delete: () => {},
    has: () => false,
  };

  const logger = {
    label: collectionName,
    fork: () => logger,
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  return {
    collection: collectionName,
    store,
    meta,
    logger,
    // Full AstroConfig is out of scope for capture; loaders reading
    // it are candidates for `loaderOverrides: { kind: "skip" }`.
    config: undefined,
    // Pass-through: schema validation happens at real sync time.
    parseData: async <TData extends Record<string, unknown>>(props: { id: string; data: TData; filePath?: string }) => {
      return props.data;
    },
    renderMarkdown: () => {
      // We don't translate body content, so no capture-time rendering.
      throw new Error(unsupportedContextMethodError("renderMarkdown"));
    },
    generateDigest: (data: Record<string, unknown> | string) => {
      const input = typeof data === "string" ? data : JSON.stringify(data);
      // 16 hex = 64 bits entropy. Stable across builds; matches
      // Astro's 64-bit xxhash entropy (different algorithm).
      return createHash("sha256").update(input).digest("hex").slice(0, 16);
    },
  };
}

function unsupportedStoreMethodError(collectionName: string, method: string): string {
  return `[polystella] custom loader for "${collectionName}" called \`store.${method}()\` mid-load. Polystella's capture step uses a write-only synthetic store; loaders that need read access can't be auto-translated. Either restructure the loader to avoid mid-load reads, or opt out via \`loaderOverrides.${collectionName} = { kind: "skip" }\` in your content.config.ts.`;
}

function unsupportedContextMethodError(method: string): string {
  return `[polystella] custom loader called \`ctx.${method}()\` during capture. This method is not provided by polystella's synthetic LoaderContext (it's only meaningful at Astro's real content-sync time). If you need it, opt out of polystella translation for this loader via \`loaderOverrides.<name> = { kind: "skip" }\`.`;
}
