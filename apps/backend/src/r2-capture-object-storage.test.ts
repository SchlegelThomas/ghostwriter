import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { sha256Digest } from "@ghostwriter/core";
import { CaptureObjectStorageError } from "./capture-object-storage-error.js";
import {
  CAPTURE_OBJECT_STORAGE_MAX_ATTACHMENT_BYTES,
  buildR2ObjectUrl,
  computePresignExpirySeconds,
  createCaptureObjectStorageFromConfig,
  createR2CaptureObjectStorage,
  createUnavailableCaptureObjectStorage,
  encodeCaptureObjectKeyPath
} from "./r2-capture-object-storage.js";

const VALID_R2_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

const TEST_R2_CONFIG = Object.freeze({
  accountId: VALID_R2_ACCOUNT_ID,
  accessKeyId: "AKIA_TEST_ACCESS",
  secretAccessKey: "super-secret-key-value-not-in-output",
  bucketName: "capture-attachments",
  endpoint: `https://${VALID_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
});

const OBJECT_KEY =
  "projects/proj-1/captures/cap-1/attachments/att-1";

const PNG_PREFIX = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00
]);

function digestHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixedNow(iso: string): () => Date {
  return () => new Date(iso);
}

describe("R2 capture object storage helpers", () => {
  it("encodes object key path segments without leaking slashes", () => {
    expect(encodeCaptureObjectKeyPath("projects/a b/captures/c/attachments/d")).toBe(
      "projects/a%20b/captures/c/attachments/d"
    );
  });

  it("builds bucket object URLs from controlled keys", () => {
    const url = buildR2ObjectUrl(TEST_R2_CONFIG, OBJECT_KEY);
    expect(url.origin).toBe(`https://${VALID_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(
      "/capture-attachments/projects/proj-1/captures/cap-1/attachments/att-1"
    );
  });

  it("derives bounded positive presign expiry seconds from absolute expiresAt", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(
      computePresignExpirySeconds("2026-01-01T00:05:00.000Z", now)
    ).toBe(300);
    expect(() =>
      computePresignExpirySeconds("2025-12-31T23:59:00.000Z", now)
    ).toThrow(CaptureObjectStorageError);
  });
});

describe("R2 capture object storage presign", () => {
  it("presigns PUT with exact Content-Type and expiry without checksum headers", async () => {
    const storage = createR2CaptureObjectStorage(TEST_R2_CONFIG, {
      now: fixedNow("2026-01-01T00:00:00.000Z")
    });
    const presigned = await storage.presignPut({
      objectKey: OBJECT_KEY,
      contentType: "image/png",
      expiresAt: "2026-01-01T00:05:00.000Z"
    });

    const url = new URL(presigned.url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.toLowerCase()).toContain(
      "content-type"
    );
    expect(url.searchParams.has("x-amz-checksum-algorithm")).toBe(false);
    expect(presigned.expiresAt).toBe("2026-01-01T00:05:00.000Z");
    expect(presigned.url).not.toContain(TEST_R2_CONFIG.secretAccessKey);
    expect(presigned.url).toContain(TEST_R2_CONFIG.accessKeyId);
  });

  it("presigns GET with query signing and expiry", async () => {
    const storage = createR2CaptureObjectStorage(TEST_R2_CONFIG, {
      now: fixedNow("2026-01-01T00:00:00.000Z")
    });
    const presigned = await storage.presignGet({
      objectKey: OBJECT_KEY,
      expiresAt: "2026-01-01T00:01:00.000Z"
    });

    const url = new URL(presigned.url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(presigned.url).not.toContain(TEST_R2_CONFIG.secretAccessKey);
  });
});

describe("R2 capture object storage inspectObject", () => {
  it("returns PNG inspection with server hash for a valid object", async () => {
    const bytes = PNG_PREFIX;
    let requestedUrl = "";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Length": String(bytes.byteLength) }
      });
    });

    const storage = createR2CaptureObjectStorage(TEST_R2_CONFIG, { fetch: fetchImpl });
    const inspection = await storage.inspectObject(OBJECT_KEY);

    expect(inspection).toEqual({
      actualByteSize: bytes.byteLength,
      serverSha256: sha256Digest(digestHex(bytes)),
      detectedContentType: "image/png",
      supported: true
    });
    expect(requestedUrl).not.toContain(TEST_R2_CONFIG.secretAccessKey);
  });

  it("returns plain-text inspection for UTF-8 bytes", async () => {
    const bytes = new TextEncoder().encode("Plain note.");
    const fetchImpl = vi.fn(async () =>
      new Response(bytes, {
        status: 200,
        headers: { "Content-Length": String(bytes.byteLength) }
      })
    );

    const storage = createR2CaptureObjectStorage(TEST_R2_CONFIG, { fetch: fetchImpl });
    const inspection = await storage.inspectObject(OBJECT_KEY);

    expect(inspection?.detectedContentType).toBe("text/plain");
    expect(inspection?.supported).toBe(true);
  });

  it("returns unsupported detection for unknown bytes", async () => {
    const bytes = Uint8Array.from([0x00, 0x01, 0x02, 0x03]);
    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200 }));

    const storage = createR2CaptureObjectStorage(TEST_R2_CONFIG, { fetch: fetchImpl });
    const inspection = await storage.inspectObject(OBJECT_KEY);

    expect(inspection).toEqual({
      actualByteSize: 4,
      serverSha256: sha256Digest(digestHex(bytes)),
      detectedContentType: "unsupported",
      supported: false
    });
  });

  it("returns undefined for missing objects", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const storage = createR2CaptureObjectStorage(TEST_R2_CONFIG, { fetch: fetchImpl });
    await expect(storage.inspectObject(OBJECT_KEY)).resolves.toBeUndefined();
  });

  it("refuses declared Content-Length above the global attachment cap", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array([0x00]), {
          status: 200,
          headers: {
            "Content-Length": String(CAPTURE_OBJECT_STORAGE_MAX_ATTACHMENT_BYTES + 1)
          }
        })
    );
    const storage = createR2CaptureObjectStorage(TEST_R2_CONFIG, { fetch: fetchImpl });
    await expect(storage.inspectObject(OBJECT_KEY)).rejects.toBeInstanceOf(
      CaptureObjectStorageError
    );
  });

  it("refuses streamed bodies larger than the global attachment cap", async () => {
    const oversized = new Uint8Array(CAPTURE_OBJECT_STORAGE_MAX_ATTACHMENT_BYTES + 2);
    const fetchImpl = vi.fn(async () => new Response(oversized, { status: 200 }));
    const storage = createR2CaptureObjectStorage(TEST_R2_CONFIG, { fetch: fetchImpl });
    await expect(storage.inspectObject(OBJECT_KEY)).rejects.toBeInstanceOf(
      CaptureObjectStorageError
    );
  });

  it("maps other non-2xx inspect responses to content-free storage errors", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    const storage = createR2CaptureObjectStorage(TEST_R2_CONFIG, { fetch: fetchImpl });
    await expect(storage.inspectObject(OBJECT_KEY)).rejects.toThrow(
      "Capture object storage failed."
    );
  });
});

describe("R2 capture object storage putObject", () => {
  it("signs PUT and uploads bytes with Content-Type", async () => {
    const bytes = PNG_PREFIX;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("PUT");
      expect(init?.headers).toMatchObject({ "Content-Type": "image/png" });
      expect(Buffer.isBuffer(init?.body)).toBe(true);
      expect(Buffer.from(init?.body as Buffer).equals(Buffer.from(bytes))).toBe(true);
      expect(String(input)).toContain("X-Amz-Signature=");
      return new Response(null, { status: 200 });
    });

    const storage = createR2CaptureObjectStorage(TEST_R2_CONFIG, {
      fetch: fetchImpl,
      now: fixedNow("2026-01-01T00:00:00.000Z")
    });
    await storage.putObject({
      objectKey: OBJECT_KEY,
      contentType: "image/png",
      bytes
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("maps failed PUT responses to CaptureObjectStorageError", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    const storage = createR2CaptureObjectStorage(TEST_R2_CONFIG, {
      fetch: fetchImpl,
      now: fixedNow("2026-01-01T00:00:00.000Z")
    });
    await expect(
      storage.putObject({
        objectKey: OBJECT_KEY,
        contentType: "image/png",
        bytes: PNG_PREFIX
      })
    ).rejects.toBeInstanceOf(CaptureObjectStorageError);
  });
});

describe("R2 capture object storage deleteObject", () => {
  it("treats 404 as idempotent success", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const storage = createR2CaptureObjectStorage(TEST_R2_CONFIG, { fetch: fetchImpl });
    await expect(storage.deleteObject(OBJECT_KEY)).resolves.toBeUndefined();
  });

  it("fails content-free on other non-2xx delete responses", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    const storage = createR2CaptureObjectStorage(TEST_R2_CONFIG, { fetch: fetchImpl });
    await expect(storage.deleteObject(OBJECT_KEY)).rejects.toBeInstanceOf(
      CaptureObjectStorageError
    );
  });
});

describe("capture object storage availability", () => {
  it("uses the unavailable adapter when R2 config is absent", async () => {
    const storage = createCaptureObjectStorageFromConfig(undefined);
    await expect(
      storage.presignPut({
        objectKey: OBJECT_KEY,
        contentType: "text/plain",
        expiresAt: "2026-01-01T00:05:00.000Z"
      })
    ).rejects.toBeInstanceOf(CaptureObjectStorageError);
    await expect(storage.inspectObject(OBJECT_KEY)).rejects.toBeInstanceOf(
      CaptureObjectStorageError
    );
  });

  it("exposes unavailable operations through a dedicated factory", async () => {
    const storage = createUnavailableCaptureObjectStorage();
    await expect(
      storage.presignGet({
        objectKey: OBJECT_KEY,
        expiresAt: "2026-01-01T00:05:00.000Z"
      })
    ).rejects.toThrow("Capture object storage failed.");
    await expect(
      storage.putObject({
        objectKey: OBJECT_KEY,
        contentType: "image/png",
        bytes: PNG_PREFIX
      })
    ).rejects.toBeInstanceOf(CaptureObjectStorageError);
  });
});
