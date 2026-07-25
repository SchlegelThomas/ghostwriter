import {
  createCaptureAttachmentDisplayFilename,
  validateDeclaredCaptureAttachment,
  type CaptureAttachmentAllowedMime
} from "@ghostwriter/core";
import {
  finalizeCaptureAttachmentUpload,
  initCaptureAttachmentUpload,
  type CaptureAttachmentSummaryResponse,
  type CaptureRequestScope
} from "./api.js";

export const CAPTURE_ATTACHMENT_UPLOAD_UNAVAILABLE_MESSAGE =
  "Attachment upload is unavailable in this environment." as const;

export const CAPTURE_ATTACHMENT_DIRECT_UPLOAD_FAILED_MESSAGE =
  "This attachment upload could not be completed." as const;

export const CAPTURE_ATTACHMENT_TYPE_REFUSED_MESSAGE =
  "This attachment type is not supported." as const;

export const CAPTURE_ATTACHMENT_SIZE_EXCEEDED_MESSAGE =
  "This attachment exceeds the allowed size." as const;

export const CAPTURE_ATTACHMENT_INVALID_REQUEST_MESSAGE =
  "The attachment request was invalid." as const;

export class CaptureAttachmentUploadUnavailableError extends Error {
  readonly code = "ATTACHMENT_UPLOAD_UNAVAILABLE" as const;

  constructor(message = CAPTURE_ATTACHMENT_UPLOAD_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = "CaptureAttachmentUploadUnavailableError";
  }
}

export class CaptureAttachmentUploadRefusalError extends Error {
  readonly code:
    | "ATTACHMENT_TYPE_REFUSED"
    | "ATTACHMENT_SIZE_EXCEEDED"
    | "INVALID_REQUEST";

  constructor(
    code: CaptureAttachmentUploadRefusalError["code"],
    message: string
  ) {
    super(message);
    this.name = "CaptureAttachmentUploadRefusalError";
    this.code = code;
  }
}

export class CaptureAttachmentDirectUploadError extends Error {
  readonly code = "ATTACHMENT_DIRECT_UPLOAD_FAILED" as const;

  constructor(message = CAPTURE_ATTACHMENT_DIRECT_UPLOAD_FAILED_MESSAGE) {
    super(message);
    this.name = "CaptureAttachmentDirectUploadError";
  }
}

export type CaptureAttachmentUploadProgress = Readonly<{
  loaded: number;
  total: number;
}>;

export type CaptureAttachmentFileMetadata = Readonly<{
  displayFilename: string;
  declaredContentType: CaptureAttachmentAllowedMime;
  declaredByteSize: number;
}>;

export type PresignedBlobUploadTransport = (
  input: Readonly<{
    url: string;
    body: Blob;
    headers: Readonly<Record<string, string>>;
    onProgress?(progress: CaptureAttachmentUploadProgress): void;
    signal?: AbortSignal;
  }>
) => Promise<void>;

export type XMLHttpRequestUploadFactory = () => XMLHttpRequestUploadLike;

export type XMLHttpRequestUploadLike = Readonly<{
  status: number;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body?: Blob): void;
  abort(): void;
  upload: Readonly<{
    addEventListener(
      type: "progress",
      listener: (event: ProgressEvent<EventTarget>) => void
    ): void;
  }>;
  addEventListener(
    type: "load" | "error" | "abort",
    listener: () => void
  ): void;
}>;

export function captureAttachmentDirectUploadEnvironmentAvailable(
  host: Readonly<{
    crypto?: Crypto;
    Blob?: typeof Blob;
  }> = globalThis
): boolean {
  return host.crypto?.subtle !== undefined && host.Blob !== undefined;
}

export function captureAttachmentDirectUploadTransportAvailable(
  host: Readonly<{ XMLHttpRequest?: typeof XMLHttpRequest }> = globalThis
): boolean {
  return host.XMLHttpRequest !== undefined;
}

export async function computeCaptureAttachmentSha256Hex(
  blob: Blob,
  cryptoImpl: Crypto = globalThis.crypto
): Promise<string> {
  if (cryptoImpl.subtle === undefined) {
    throw new CaptureAttachmentUploadUnavailableError();
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function validateCaptureAttachmentFileMetadata(input: Readonly<{
  displayFilename: string;
  declaredContentType: string;
  declaredByteSize: number;
}>): CaptureAttachmentFileMetadata {
  let displayFilename: string;
  try {
    displayFilename = createCaptureAttachmentDisplayFilename(input.displayFilename);
  } catch {
    throw new CaptureAttachmentUploadRefusalError(
      "INVALID_REQUEST",
      CAPTURE_ATTACHMENT_INVALID_REQUEST_MESSAGE
    );
  }

  const policy = validateDeclaredCaptureAttachment({
    declaredContentType: input.declaredContentType,
    declaredByteSize: input.declaredByteSize
  });
  if (!policy.ok) {
    if (policy.code === "declared-size-exceeded") {
      throw new CaptureAttachmentUploadRefusalError(
        "ATTACHMENT_SIZE_EXCEEDED",
        CAPTURE_ATTACHMENT_SIZE_EXCEEDED_MESSAGE
      );
    }
    throw new CaptureAttachmentUploadRefusalError(
      "ATTACHMENT_TYPE_REFUSED",
      CAPTURE_ATTACHMENT_TYPE_REFUSED_MESSAGE
    );
  }

  return {
    displayFilename,
    declaredContentType: policy.contentType,
    declaredByteSize: input.declaredByteSize
  };
}

function readCaptureAttachmentFilenameFromFile(file: File | Blob): string | undefined {
  if (typeof File !== "undefined" && file instanceof File) {
    return file.name;
  }
  return undefined;
}

export function resolveCaptureAttachmentUploadMetadata(
  file: File | Blob,
  displayFilename?: string
): CaptureAttachmentFileMetadata {
  const resolvedFilename =
    displayFilename ?? readCaptureAttachmentFilenameFromFile(file);
  if (resolvedFilename === undefined || resolvedFilename.length === 0) {
    throw new CaptureAttachmentUploadRefusalError(
      "INVALID_REQUEST",
      CAPTURE_ATTACHMENT_INVALID_REQUEST_MESSAGE
    );
  }
  return validateCaptureAttachmentFileMetadata({
    displayFilename: resolvedFilename,
    declaredContentType: file.type.length === 0 ? "application/octet-stream" : file.type,
    declaredByteSize: file.size
  });
}

export function createBrowserPresignedBlobUploadTransport(
  createXhr: XMLHttpRequestUploadFactory = () => new XMLHttpRequest()
): PresignedBlobUploadTransport {
  return (input) =>
    new Promise((resolve, reject) => {
      const xhr = createXhr();
      let lastLoaded = 0;
      let settled = false;

      const fail = () => {
        if (settled) return;
        settled = true;
        reject(new CaptureAttachmentDirectUploadError());
      };

      const succeed = () => {
        if (settled) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          settled = true;
          resolve();
          return;
        }
        fail();
      };

      if (input.signal !== undefined) {
        if (input.signal.aborted) {
          fail();
          return;
        }
        input.signal.addEventListener("abort", () => {
          xhr.abort();
          fail();
        });
      }

      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        const loaded = Math.max(lastLoaded, event.loaded);
        lastLoaded = loaded;
        input.onProgress?.({ loaded, total: event.total });
      });
      xhr.addEventListener("load", succeed);
      xhr.addEventListener("error", fail);
      xhr.addEventListener("abort", fail);

      xhr.open("PUT", input.url);
      for (const [name, value] of Object.entries(input.headers)) {
        xhr.setRequestHeader(name, value);
      }
      xhr.send(input.body);
    });
}

export async function uploadCaptureAttachment(input: Readonly<{
  scope: CaptureRequestScope;
  file: File | Blob;
  displayFilename?: string;
  onProgress?(progress: CaptureAttachmentUploadProgress): void;
  signal?: AbortSignal;
  transport?: PresignedBlobUploadTransport;
  crypto?: Crypto;
}>): Promise<CaptureAttachmentSummaryResponse> {
  const cryptoImpl = input.crypto ?? globalThis.crypto;
  if (
    !captureAttachmentDirectUploadEnvironmentAvailable({
      crypto: cryptoImpl,
      Blob: globalThis.Blob
    })
  ) {
    throw new CaptureAttachmentUploadUnavailableError();
  }
  if (
    input.transport === undefined &&
    !captureAttachmentDirectUploadTransportAvailable()
  ) {
    throw new CaptureAttachmentUploadUnavailableError();
  }

  const metadata = resolveCaptureAttachmentUploadMetadata(
    input.file,
    input.displayFilename
  );
  const clientSha256 = await computeCaptureAttachmentSha256Hex(
    input.file,
    cryptoImpl
  );

  const initialized = await initCaptureAttachmentUpload({
    ...input.scope,
    displayFilename: metadata.displayFilename,
    declaredContentType: metadata.declaredContentType,
    declaredByteSize: metadata.declaredByteSize,
    clientSha256
  });

  const transport =
    input.transport ?? createBrowserPresignedBlobUploadTransport();

  try {
    await transport({
      url: initialized.upload.url,
      body: input.file,
      headers: initialized.uploadHeaders,
      onProgress: input.onProgress,
      signal: input.signal
    });
  } catch (error) {
    if (error instanceof CaptureAttachmentDirectUploadError) {
      throw error;
    }
    throw new CaptureAttachmentDirectUploadError();
  }

  const finalized = await finalizeCaptureAttachmentUpload({
    ...input.scope,
    attachmentId: initialized.attachment.attachmentId
  });
  return finalized.attachment;
}
