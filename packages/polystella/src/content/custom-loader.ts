/**
 * Polystella-flavoured custom-loader wrapper. Lets users opt a
 * non-glob / non-file Astro loader into the translation pipeline by
 * wrapping it once at the call site:
 *
 *   import { polystellaLoader } from "polystella/content";
 *
 *   const blog = defineCollection({
 *     loader: polystellaLoader(blogLoader(), {
 *       name: "blog",
 *       translatableKeys: ["title", "excerpt"],
 *     }),
 *     schema: ...,
 *   });
 *
 * What the wrapper adds:
 *
 * 1. **A non-enumerable marker** (`__polystellaCustomLoader`) that
 *    `polystellaCollections` reads at content-config time to
 *    auto-derive locale-sibling collections — no `loaderOverrides`
 *    entry needed. Same surface trick `file()`'s wrapper uses.
 *
 * 2. **A `captureEntries()` method** the sibling loader calls at
 *    content-sync time. Runs the raw loader against a synthetic
 *    `LoaderContext` (writable store, deterministic `generateDigest`,
 *    no-op `parseData`); returns every entry the loader called
 *    `store.set()` on, in insertion order.
 *
 * 3. **Single-run guarantee**: the raw loader runs exactly once per
 *    build regardless of how many sibling collections call
 *    `captureEntries()`. The first call (whichever it is — source
 *    `load`, sibling `captureEntries`, etc.) captures into closure
 *    state; subsequent calls read from cache. The wrapper's own
 *    `load()` also delegates to the cached entries so source +
 *    siblings share the same entry IDs (critical because the
 *    synthetic `generateDigest` uses SHA-256 whereas Astro's
 *    runtime `generateDigest` uses xxhash — running raw under
 *    Astro's context would produce DIFFERENT IDs from our capture).
 *
 * Loader contract assumption: the raw loader's `load()` must be safe
 * to run with a synthetic store that supports writes (`set`, `clear`,
 * `entries`, `keys`, `values`) but throws on reads (`get`, `has`).
 * Loaders that need mid-load store reads must opt out via
 * `loaderOverrides[name] = { kind: "skip" }` as today.
 */

import { createHash } from "node:crypto";

import type { Loader } from "astro/loaders";

/**
 * Marker key on loaders created via `polystellaLoader`. Symbol-like
 * uniqueness via the `__polystella` prefix avoids colliding with
 * anything Astro might add to its loader shape later. Pairs the
 * `__polystellaSourcePath` convention from `./file-loader.ts`.
 */
export const POLYSTELLA_CUSTOM_LOADER_KEY = "__polystellaCustomLoader" as const;

/**
 * Entry captured from a `store.set({ id, data })` call during
 * `captureEntries()`. Identical shape to Astro's `DataEntry` but
 * with `data` narrowed to a plain record (no `body`/`digest`/`rendered`
 * — those only matter when Astro stores entries to the real
 * `DataStore`, not during capture).
 */
export interface CapturedEntry {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Public options for `polystellaLoader`.
 */
export interface PolystellaCustomLoaderOptions {
  /**
   * Logical name for this loader — used as the snapshot directory
   * (`.astro/polystella-snapshots/<name>/`), the sibling-collection
   * key (`<name>__<locale>`), and the per-glob key-paths injection
   * (`<name>/*.json`). MUST match the consumer-declared
   * `defineCollection` key (e.g. `"blog"` for `{ blog }`).
   */
  name: string;
  /**
   * Top-level `data` fields the translation pass should run through
   * the AI translator. Other fields pass through verbatim. Empty
   * array → captured entries are snapshotted but nothing is
   * translated (the sibling collection ends up identical to the
   * source — useful for collections that need locale routing but
   * not content changes).
   */
  translatableKeys: string[];
}

/**
 * The marker shape stamped onto the returned wrapped loader. The
 * integration imports this type to consume the marker; the
 * snapshot-writer side imports `CapturedEntry` to type its input.
 */
export interface PolystellaCustomLoaderMarker {
  name: string;
  translatableKeys: string[];
  /**
   * Run the raw loader against a synthetic context; return every
   * entry it `store.set()`s in insertion order. Throws if the raw
   * loader's `load()` throws — caller decides whether to fail the
   * build (the integration logs + skips this loader rather than
   * aborting the whole pipeline).
   */
  captureEntries: () => Promise<CapturedEntry[]>;
}

/**
 * The wrapped-loader shape. Extends Astro's `Loader` with the
 * non-enumerable polystella marker. Tests + the integration read
 * the marker via `readPolystellaCustomLoaderMarker`; Astro's runtime
 * only sees the Loader surface.
 */
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
    // Cast through `unknown` — the synthetic context implements the
    // surface our minimal loaders use, but doesn't satisfy Astro's
    // full `LoaderContext` (e.g. no `renderMarkdown`). Loaders that
    // need methods we don't stub get a clear error from the synthetic
    // store's `get`/`has` throwers.
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
      // Source-collection populate: pull from the cached capture
      // (which may have been done by a sibling loader earlier in the
      // sync) or trigger a fresh capture. Either way, the IDs match
      // what siblings will see, because the same captured entries
      // are the source of truth for both surfaces.
      const entries = await captureEntries();
      ctx.store.clear();
      for (const entry of entries) {
        const parsed = await ctx.parseData({ id: entry.id, data: entry.data });
        ctx.store.set({ id: entry.id, data: parsed });
      }
    },
  };

  // Preserve a `schema` field if the raw loader declared one. Astro
  // allows loaders to ship schemas; consumer's schema overrides if
  // present, but absence here would silently drop a loader-provided
  // default.
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

/**
 * Read the polystella custom-loader marker, if present. Returns
 * `undefined` for unwrapped loaders. Used by `polystellaCollections`
 * to auto-derive sibling collections and by the integration to
 * discover wrapped loaders at `config:setup`.
 */
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

// ---------------------------------------------------------------------
// Synthetic loader context — the bare-minimum surface our supported
// loaders need.
// ---------------------------------------------------------------------

interface SyntheticContextInput {
  collectionName: string;
  sink: CapturedEntry[];
}

/**
 * Build a synthetic `LoaderContext` for capture-time invocation.
 * Implements the subset the blogLoader (and similar simple loaders)
 * actually use:
 *   - `store.set`, `store.clear`, `store.entries`, `store.keys`,
 *     `store.values`
 *   - `parseData` (pass-through, no schema validation — that happens
 *     in Astro at content-sync time)
 *   - `generateDigest` (SHA-256 truncated to 16 hex chars, stable
 *     across builds)
 *   - `logger` (info/warn/error/debug, all no-op)
 *
 * Methods we don't support throw with a clear migration message
 * pointing at `loaderOverrides: { kind: "skip" }`.
 */
function buildSyntheticContext(input: SyntheticContextInput): Record<string, unknown> {
  const { collectionName, sink } = input;
  const captured = new Map<string, CapturedEntry>();

  const store = {
    set: (entry: { id: string; data: Record<string, unknown> }) => {
      // Mirror Astro's behaviour: store.set returns true on insert,
      // false on no-op (same data). For capture purposes we just
      // record the latest write per ID.
      const existed = captured.has(entry.id);
      captured.set(entry.id, { id: entry.id, data: entry.data });
      // Rebuild the sink array each set so insertion order tracks
      // the most-recent write order. Could be O(n) per set; for
      // typical custom loaders (hundreds of entries), trivial.
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
    addAssetImport: () => {
      // No-op: assets only matter at Astro's content-sync time, not
      // during translation snapshot capture.
    },
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
    // `config` is the full AstroConfig in Astro's runtime. Loaders
    // that read it are out of scope for capture-time — they're more
    // likely candidates for `loaderOverrides: { kind: "skip" }`.
    config: undefined,
    parseData: async <TData extends Record<string, unknown>>(props: { id: string; data: TData; filePath?: string }) => {
      // Pass-through: validation against the consumer's schema
      // happens at content-sync time, when the wrapped loader's
      // `load` replays captured entries into Astro's real store
      // and Astro applies the schema there. Returning the data
      // verbatim here is the cheapest correct option.
      return props.data;
    },
    renderMarkdown: () => {
      // Markdown rendering produces `RenderedContent` that lives
      // alongside the data in Astro's store. For custom-loader
      // entries we don't translate body content (only structured
      // fields), so rendering at capture time isn't needed.
      throw new Error(unsupportedContextMethodError("renderMarkdown"));
    },
    generateDigest: (data: Record<string, unknown> | string) => {
      const input = typeof data === "string" ? data : JSON.stringify(data);
      // 16 hex chars = 64 bits of entropy. Collision-resistant for
      // any realistic custom-loader corpus (Astro itself uses 64-bit
      // xxhash — same entropy, different algorithm). The IDs only
      // need to be stable across builds; cryptographic strength
      // isn't required.
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
