import {
  detectCaptureAttachmentContentType,
  sha256Digest,
  type Sha256Digest
} from "./capture-attachments.js";

export type PresignedObjectUrl = Readonly<{
  url: string;
  expiresAt: string;
}>;

export type CaptureObjectInspection = Readonly<{
  actualByteSize: number;
  serverSha256: Sha256Digest;
  detectedContentType: string;
  supported: boolean;
}>;

export interface CaptureObjectStoragePort {
  presignPut(input: Readonly<{
    objectKey: string;
    contentType: string;
    expiresAt: string;
  }>): Promise<PresignedObjectUrl>;
  presignGet(input: Readonly<{
    objectKey: string;
    expiresAt: string;
  }>): Promise<PresignedObjectUrl>;
  inspectObject(objectKey: string): Promise<CaptureObjectInspection | undefined>;
  deleteObject(objectKey: string): Promise<void>;
}

export type MemoryCaptureObjectStorageState = Readonly<{
  objects: ReadonlyMap<string, Uint8Array>;
}>;

async function digestBytes(bytes: Uint8Array): Promise<Sha256Digest> {
  const cryptoProvider = globalThis.crypto;
  if (cryptoProvider?.subtle === undefined) {
    throw new Error("A Web Crypto implementation is required to hash attachment bytes.");
  }
  const normalized = Uint8Array.from(bytes);
  const digest = await cryptoProvider.subtle.digest("SHA-256", normalized);
  return sha256Digest(
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}

export function createMemoryCaptureObjectStorage(): CaptureObjectStoragePort & Readonly<{
  putObjectForTest(objectKey: string, bytes: Uint8Array): void;
  hasObject(objectKey: string): boolean;
  snapshot(): MemoryCaptureObjectStorageState;
  restore(snapshot: MemoryCaptureObjectStorageState): void;
}> {
  let objects = new Map<string, Uint8Array>();

  const storage: CaptureObjectStoragePort &
    Readonly<{
      putObjectForTest(objectKey: string, bytes: Uint8Array): void;
      hasObject(objectKey: string): boolean;
      snapshot(): MemoryCaptureObjectStorageState;
      restore(snapshot: MemoryCaptureObjectStorageState): void;
    }> = {
    async presignPut(input) {
      return Object.freeze({
        url: `memory://put/${encodeURIComponent(input.objectKey)}?expires=${encodeURIComponent(input.expiresAt)}&type=${encodeURIComponent(input.contentType)}`,
        expiresAt: input.expiresAt
      });
    },
    async presignGet(input) {
      return Object.freeze({
        url: `memory://get/${encodeURIComponent(input.objectKey)}?expires=${encodeURIComponent(input.expiresAt)}`,
        expiresAt: input.expiresAt
      });
    },
    async inspectObject(objectKey) {
      const bytes = objects.get(objectKey);
      if (bytes === undefined) return undefined;
      const detection = detectCaptureAttachmentContentType(bytes);
      return Object.freeze({
        actualByteSize: bytes.byteLength,
        serverSha256: await digestBytes(bytes),
        detectedContentType: detection.ok ? detection.contentType : "unsupported",
        supported: detection.ok
      });
    },
    async deleteObject(objectKey) {
      objects.delete(objectKey);
    },
    putObjectForTest(objectKey: string, bytes: Uint8Array) {
      objects.set(objectKey, Uint8Array.from(bytes));
    },
    hasObject(objectKey: string) {
      return objects.has(objectKey);
    },
    snapshot() {
      return Object.freeze({
        objects: new Map(
          [...objects.entries()].map(([key, value]) => [key, Uint8Array.from(value)])
        )
      });
    },
    restore(snapshot: MemoryCaptureObjectStorageState) {
      objects = new Map(
        [...snapshot.objects.entries()].map(([key, value]) => [key, Uint8Array.from(value)])
      );
    }
  };

  return Object.freeze(storage);
}
