import { S3mini } from "s3mini";

/**
 * Thin wrapper over `s3mini`. Normalises return shapes into
 * `R2Client`, builds bucket-scoped endpoints from `(accountId,
 * bucket)`, maps our `metadata: { foo: "bar" }` onto R2's
 * `x-amz-meta-*` header convention.
 */

export interface R2GetResult {
  body: Uint8Array;
  contentType: string | null;
  etag: string | null;
  /** `x-amz-meta-*` headers, with the prefix stripped and keys lowercased. */
  metadata: Record<string, string>;
}

export interface R2ListEntry {
  key: string;
  size: number;
  lastModified: Date;
  etag: string;
}

export interface R2PutOptions {
  contentType?: string;
  /** Arbitrary user metadata; emitted as `x-amz-meta-{key}` headers. */
  metadata?: Record<string, string>;
}

export interface R2Client {
  /**
   * Returns `true` if an object is stored at `key`. Issues a HEAD request
   * under the hood, so no body bytes are transferred.
   */
  exists(key: string): Promise<boolean>;
  /** Returns the object body + headers, or `null` if `key` does not exist. */
  get(key: string): Promise<R2GetResult | null>;
  /** Uploads `body` to `key`. */
  put(key: string, body: Uint8Array | string, opts?: R2PutOptions): Promise<void>;
  /** Lists every object whose key begins with `prefix` (auto-paginated by s3mini). */
  list(prefix: string): Promise<R2ListEntry[]>;
  /** Deletes the object at `key`; resolves cleanly if `key` does not exist. */
  del(key: string): Promise<void>;
}

export interface R2ConnectionOptions {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Override the default `https://<accountId>.r2.cloudflarestorage.com`
   * endpoint (e.g. for jurisdictional buckets or a local fixture).
   * The bucket name is appended automatically.
   */
  endpoint?: string;
  /** Inject a `fetch` implementation. Mainly for tests. */
  fetch?: typeof fetch;
}

/**
 * Default key prefix when the operator hasn't customised
 * `r2.prefix`. Co-located with `buildR2Key` because the two values
 * (default config + the format helper) must agree byte-for-byte —
 * pulling them apart has historically caused silent cache misses
 * (e.g. a new prefix in config + a hardcoded `"i18n/"` here).
 */
export const DEFAULT_R2_KEY_PREFIX = "i18n/";

/**
 * Format: `{prefix}{locale}/{relative-source-path}#{hash}.md`.
 *
 * `prefix` defaults to `"i18n/"` so existing callers that haven't
 * been threaded through the resolved config keep producing identical
 * keys — but the prefix is configurable so per-branch caches (e.g.
 * `previews/<branch>/i18n/`) can isolate writes from production
 * without churning the schema.
 *
 * The source path is preserved verbatim so the key is reversible
 * (only `#` introduces ambiguity, and we anchor on `lastIndexOf("#")`
 * downstream).
 *
 * `prefix` MUST end with `/` when non-empty; we don't auto-append
 * because a missing slash usually indicates a config typo, and a
 * silent fixup hides it.
 */
export function buildR2Key({
  locale,
  sourcePath,
  hash,
  prefix = DEFAULT_R2_KEY_PREFIX,
}: {
  locale: string;
  sourcePath: string;
  hash: string;
  prefix?: string;
}): string {
  const normalisedPath = stripLeadingSlashes(sourcePath.replaceAll("\\", "/"));
  if (prefix.length > 0 && !prefix.endsWith("/")) {
    throw new Error(`[polystella] r2.prefix must end with "/" (got: ${JSON.stringify(prefix)})`);
  }
  return `${prefix}${locale}/${normalisedPath}#${hash}.md`;
}

/** Stateless R2 client; safe to share across concurrent operations. */
export function createR2Client(opts: R2ConnectionOptions): R2Client {
  const baseEndpoint = opts.endpoint ?? `https://${opts.accountId}.r2.cloudflarestorage.com`;
  const endpoint = `${stripTrailingSlashes(baseEndpoint)}/${opts.bucket}`;

  const s3 = new S3mini({
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
    endpoint,
    region: "auto",
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  return {
    async exists(key) {
      // `objectExists` returns `null` under conditional headers; our
      // unconditional call treats that as "missing".
      const result = await s3.objectExists(key);
      return result === true;
    },

    async get(key) {
      const response = await s3.getObjectResponse(key);
      if (!response) return null;

      const body = new Uint8Array(await response.arrayBuffer());
      const metadata: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        const lower = name.toLowerCase();
        if (lower.startsWith("x-amz-meta-")) {
          metadata[lower.slice("x-amz-meta-".length)] = value;
        }
      });

      return {
        body,
        contentType: response.headers.get("content-type"),
        etag: response.headers.get("etag"),
        metadata,
      };
    },

    async put(key, body, putOpts) {
      const additionalHeaders: Record<string, string> = {};
      if (putOpts?.metadata) {
        for (const [k, v] of Object.entries(putOpts.metadata)) {
          additionalHeaders[`x-amz-meta-${k.toLowerCase()}`] = v;
        }
      }
      await s3.putObject(
        key,
        body,
        putOpts?.contentType,
        undefined,
        Object.keys(additionalHeaders).length > 0 ? additionalHeaders : undefined,
      );
    },

    async list(prefix) {
      const objects = await s3.listObjects(undefined, prefix);
      if (!objects) return [];
      return objects.map((obj) => ({
        key: obj.Key,
        size: obj.Size,
        lastModified: new Date(obj.LastModified),
        etag: obj.ETag,
      }));
    },

    async del(key) {
      await s3.deleteObject(key);
    },
  };
}

/**
 * Strip leading `/` characters in linear time. Equivalent to
 * `.replace(/^\/+/, "")` but free of regex backtracking concerns
 * (CodeQL js/polynomial-redos flags the unanchored regex variant).
 */
function stripLeadingSlashes(s: string): string {
  let start = 0;
  while (start < s.length && s.charCodeAt(start) === 47 /* "/" */) start++;
  return start === 0 ? s : s.slice(start);
}

/**
 * Strip trailing `/` characters in linear time. Equivalent to
 * `.replace(/\/+$/, "")`; the regex form is end-anchored only and
 * V8 doesn't reliably reverse-scan, so it backtracks quadratically
 * on long runs of slashes followed by a non-slash.
 */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* "/" */) end--;
  return end === s.length ? s : s.slice(0, end);
}
