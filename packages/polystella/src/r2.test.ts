import { describe, it, expect } from "vitest";
import { buildR2Key, createR2Client } from "./r2.js";

const TEST_HASH = "a1b2c3d4e5f6";

describe("buildR2Key", () => {
  it("formats keys as i18n/<locale>/<sourcePath>#<hash>.md", () => {
    expect(
      buildR2Key({
        locale: "pt-BR",
        sourcePath: "publications/Davidson2018.md",
        hash: TEST_HASH,
      }),
    ).toBe(`i18n/pt-BR/publications/Davidson2018.md#${TEST_HASH}.md`);
  });

  it("strips a leading slash from the source path", () => {
    expect(
      buildR2Key({
        locale: "ja-JP",
        sourcePath: "/people/foo.md",
        hash: TEST_HASH,
      }),
    ).toBe(`i18n/ja-JP/people/foo.md#${TEST_HASH}.md`);
  });

  it("normalises backslash separators (Windows source paths)", () => {
    expect(
      buildR2Key({
        locale: "pt-BR",
        sourcePath: "publications\\nested\\foo.md",
        hash: TEST_HASH,
      }),
    ).toBe(`i18n/pt-BR/publications/nested/foo.md#${TEST_HASH}.md`);
  });
});

describe("createR2Client", () => {
  it("constructs a bucket-scoped endpoint and signs PUT requests via s3mini", async () => {
    // Capture every fetch s3mini issues so we can assert the URL and method.
    const calls: Array<{ url: string; method: string; headers: Headers }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : (input as URL | Request).toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({
        url,
        method,
        headers: new Headers(init?.headers),
      });
      // Minimal happy-path response so s3mini is satisfied.
      return new Response("", {
        status: 200,
        headers: { etag: '"abc123"' },
      });
    };

    const client = createR2Client({
      accountId: "acct1234",
      bucket: "research-i18n-cache",
      accessKeyId: "AKIA-test",
      secretAccessKey: "test-secret",
      fetch: fakeFetch,
    });

    await client.put(`i18n/pt-BR/foo.md#${TEST_HASH}.md`, "translated body", {
      contentType: "text/markdown",
      metadata: { "source-hash": TEST_HASH, model: "@cf/test/m1" },
    });

    expect(calls.length).toBeGreaterThan(0);
    const put = calls.find((c) => c.method === "PUT");
    expect(put, "expected at least one PUT call").toBeDefined();

    // Endpoint shape: https://<accountId>.r2.cloudflarestorage.com/<bucket>/<key>
    expect(put!.url).toMatch(
      /^https:\/\/acct1234\.r2\.cloudflarestorage\.com\/research-i18n-cache\//,
    );
    expect(put!.url).toContain("i18n/pt-BR/foo.md");

    // SigV4 produced an Authorization header.
    expect(put!.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);

    // Our metadata was forwarded as x-amz-meta-* headers.
    expect(put!.headers.get("x-amz-meta-source-hash")).toBe(TEST_HASH);
    expect(put!.headers.get("x-amz-meta-model")).toBe("@cf/test/m1");
  });

  it("returns null from get() when the object is missing", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("Not Found", { status: 404 });

    const client = createR2Client({
      accountId: "acct1234",
      bucket: "missing-bucket",
      accessKeyId: "AKIA-test",
      secretAccessKey: "test-secret",
      fetch: fakeFetch,
    });

    const result = await client.get(`i18n/pt-BR/missing.md#${TEST_HASH}.md`);
    expect(result).toBeNull();
  });

  it("respects an explicit endpoint override (e.g. jurisdictional EU)", async () => {
    const calls: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      calls.push(
        typeof input === "string" ? input : (input as URL | Request).toString(),
      );
      return new Response("", { status: 200, headers: { etag: '"x"' } });
    };

    const client = createR2Client({
      accountId: "acct1234",
      bucket: "eu-cache",
      accessKeyId: "AKIA-test",
      secretAccessKey: "test-secret",
      endpoint: "https://acct1234.eu.r2.cloudflarestorage.com",
      fetch: fakeFetch,
    });

    await client.put("hello.txt", "hi");
    expect(calls[0]).toMatch(
      /^https:\/\/acct1234\.eu\.r2\.cloudflarestorage\.com\/eu-cache\//,
    );
  });
});
