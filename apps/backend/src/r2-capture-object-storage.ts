import {
  detectCaptureAttachmentContentType,
  sha256Digest,
  type CaptureObjectInspection,
  type CaptureObjectStoragePort,
  type PresignedObjectUrl
} from "@ghostwriter/core";
import { AwsClient } from "aws4fetch";
import { createHash } from "node:crypto";
import { CaptureObjectStorageError } from "./capture-object-storage-error.js";
import { assertValidatedR2BucketName, parseValidatedR2AccountId, R2_OBJECT_STORAGE_CONFIG_ERROR } from "./r2-config-validation.js";

export type R2CaptureObjectStorageConfig = Readonly<{
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
}>;

export type CaptureObjectStorageDependencies = Readonly<{
  fetch: typeof fetch;
  now: () => Date;
}>;

export const CAPTURE_OBJECT_STORAGE_MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const CAPTURE_OBJECT_STORAGE_MAX_INSPECT_READ_BYTES =
  CAPTURE_OBJECT_STORAGE_MAX_ATTACHMENT_BYTES + 1;

const AWS_PRESIGN_MAX_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

function defaultDependencies(): CaptureObjectStorageDependencies {
  return Object.freeze({
    fetch,
    now: () => new Date()
  });
}

export function encodeCaptureObjectKeyPath(objectKey: string): string {
  return objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function assertSafeCaptureObjectKey(objectKey: string): void {
  if (
    objectKey.length === 0 ||
    objectKey.includes("\0") ||
    objectKey.includes("..") ||
    objectKey.startsWith("/") ||
    objectKey.includes("//")
  ) {
    throw new CaptureObjectStorageError();
  }
}

export function buildR2ObjectUrl(
  config: R2CaptureObjectStorageConfig,
  objectKey: string
): URL {
  assertSafeCaptureObjectKey(objectKey);
  const accountId = parseValidatedR2AccountId(config.accountId);
  const expectedEndpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  if (config.endpoint !== expectedEndpoint) {
    throw new Error(R2_OBJECT_STORAGE_CONFIG_ERROR);
  }
  assertValidatedR2BucketName(config.bucketName);
  const encodedBucket = encodeURIComponent(config.bucketName);
  const encodedKey = encodeCaptureObjectKeyPath(objectKey);
  return new URL(`${expectedEndpoint}/${encodedBucket}/${encodedKey}`);
}

export function computePresignExpirySeconds(expiresAt: string, now: Date): number {
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) {
    throw new CaptureObjectStorageError();
  }
  const deltaMs = expiresMs - now.getTime();
  if (deltaMs <= 0) {
    throw new CaptureObjectStorageError();
  }
  const seconds = Math.ceil(deltaMs / 1000);
  if (seconds < 1 || seconds > AWS_PRESIGN_MAX_EXPIRY_SECONDS) {
    throw new CaptureObjectStorageError();
  }
  return seconds;
}

function createAwsClient(config: R2CaptureObjectStorageConfig): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto"
  });
}

async function readResponseBytes(
  response: Response
): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined || value.byteLength === 0) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > CAPTURE_OBJECT_STORAGE_MAX_INSPECT_READ_BYTES) {
        throw new CaptureObjectStorageError();
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  if (totalBytes > CAPTURE_OBJECT_STORAGE_MAX_ATTACHMENT_BYTES) {
    throw new CaptureObjectStorageError();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function digestBytes(bytes: Uint8Array) {
  return sha256Digest(createHash("sha256").update(bytes).digest("hex"));
}

function inspectionFromBytes(bytes: Uint8Array): CaptureObjectInspection {
  const detection = detectCaptureAttachmentContentType(bytes);
  return Object.freeze({
    actualByteSize: bytes.byteLength,
    serverSha256: digestBytes(bytes),
    detectedContentType: detection.ok ? detection.contentType : "unsupported",
    supported: detection.ok
  });
}

export function createR2CaptureObjectStorage(
  config: R2CaptureObjectStorageConfig,
  dependencies: Partial<CaptureObjectStorageDependencies> = {}
): CaptureObjectStoragePort {
  const deps = Object.freeze({
    ...defaultDependencies(),
    ...dependencies
  });
  const aws = createAwsClient(config);

  async function presign(
    objectKey: string,
    method: "GET" | "PUT",
    expiresAt: string,
    headers?: Readonly<Record<string, string>>
  ): Promise<PresignedObjectUrl> {
    const objectUrl = buildR2ObjectUrl(config, objectKey);
    const expiresInSeconds = computePresignExpirySeconds(expiresAt, deps.now());
    objectUrl.searchParams.set("X-Amz-Expires", String(expiresInSeconds));

    const signed = await aws.sign(objectUrl.toString(), {
      method,
      headers,
      aws: {
        signQuery: true,
        allHeaders: method === "PUT",
        service: "s3",
        region: "auto"
      }
    });

    return Object.freeze({
      url: signed.url.toString(),
      expiresAt
    });
  }

  const storage: CaptureObjectStoragePort = {
    async presignPut(input) {
      return presign(input.objectKey, "PUT", input.expiresAt, {
        "Content-Type": input.contentType
      });
    },

    async presignGet(input) {
      return presign(input.objectKey, "GET", input.expiresAt);
    },

    async putObject(input) {
      const expiresAt = new Date(deps.now().getTime() + 5 * 60 * 1000).toISOString();
      const signed = await presign(input.objectKey, "PUT", expiresAt, {
        "Content-Type": input.contentType
      });

      let response: Response;
      try {
        response = await deps.fetch(signed.url, {
          method: "PUT",
          headers: {
            "Content-Type": input.contentType
          },
          body: Buffer.from(input.bytes)
        });
      } catch {
        throw new CaptureObjectStorageError();
      }

      if (!response.ok) {
        throw new CaptureObjectStorageError();
      }
    },

    async inspectObject(objectKey) {
      const objectUrl = buildR2ObjectUrl(config, objectKey);
      const signed = await aws.sign(objectUrl.toString(), {
        method: "GET",
        aws: {
          service: "s3",
          region: "auto"
        }
      });

      let response: Response;
      try {
        response = await deps.fetch(signed.url, {
          method: "GET",
          headers: signed.headers
        });
      } catch {
        throw new CaptureObjectStorageError();
      }

      if (response.status === 404) {
        return undefined;
      }
      if (!response.ok) {
        throw new CaptureObjectStorageError();
      }

      const contentLengthHeader = response.headers.get("content-length");
      if (contentLengthHeader !== null) {
        const declaredLength = Number.parseInt(contentLengthHeader, 10);
        if (
          Number.isNaN(declaredLength) ||
          declaredLength > CAPTURE_OBJECT_STORAGE_MAX_ATTACHMENT_BYTES
        ) {
          throw new CaptureObjectStorageError();
        }
      }

      let bytes: Uint8Array;
      try {
        bytes = await readResponseBytes(response);
      } catch (error) {
        if (error instanceof CaptureObjectStorageError) {
          throw error;
        }
        throw new CaptureObjectStorageError();
      }

      return inspectionFromBytes(bytes);
    },

    async deleteObject(objectKey) {
      const objectUrl = buildR2ObjectUrl(config, objectKey);
      const signed = await aws.sign(objectUrl.toString(), {
        method: "DELETE",
        aws: {
          service: "s3",
          region: "auto"
        }
      });

      let response: Response;
      try {
        response = await deps.fetch(signed.url, {
          method: "DELETE",
          headers: signed.headers
        });
      } catch {
        throw new CaptureObjectStorageError();
      }

      if (response.status === 404) {
        return;
      }
      if (!response.ok) {
        throw new CaptureObjectStorageError();
      }
    }
  };

  return Object.freeze(storage);
}

export function createUnavailableCaptureObjectStorage(): CaptureObjectStoragePort {
  const fail = async (): Promise<never> => {
    throw new CaptureObjectStorageError();
  };

  return Object.freeze({
    presignPut: fail,
    presignGet: fail,
    putObject: fail,
    inspectObject: fail,
    deleteObject: fail
  });
}

export function createCaptureObjectStorageFromConfig(
  r2: R2CaptureObjectStorageConfig | undefined,
  dependencies?: Partial<CaptureObjectStorageDependencies>
): CaptureObjectStoragePort {
  if (r2 === undefined) {
    return createUnavailableCaptureObjectStorage();
  }
  return createR2CaptureObjectStorage(r2, dependencies);
}
