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
  put(
    key: string,
    body: Uint8Array | string,
    opts?: R2PutOptions,
  ): Promise<void>;
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
 * Format: `i18n/{locale}/{relative-source-path}#{hash}.md`. The
 * source path is preserved verbatim so the key is reversible.
 */
export function buildR2Key({
  locale,
  sourcePath,
  hash,
}: {
  locale: string;
  sourcePath: string;
  hash: string;
}): string {
  const normalisedPath = sourcePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `i18n/${locale}/${normalisedPath}#${hash}.md`;
}

/** Stateless R2 client; safe to share across concurrent operations. */
export function createR2Client(opts: R2ConnectionOptions): R2Client {
  const baseEndpoint =
    opts.endpoint ?? `https://${opts.accountId}.r2.cloudflarestorage.com`;
  const endpoint = `${baseEndpoint.replace(/\/+$/, "")}/${opts.bucket}`;

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
        Object.keys(additionalHeaders).length > 0
          ? additionalHeaders
          : undefined,
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
