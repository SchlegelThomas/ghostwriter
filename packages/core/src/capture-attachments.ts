import {
  DomainValidationError,
  type AttachmentId,
  type CaptureId,
  type ProjectId
} from "./domain.js";

export const CAPTURE_ATTACHMENT_UPLOAD_URL_TTL_MS = 15 * 60 * 1000;
export const CAPTURE_ATTACHMENT_DOWNLOAD_URL_TTL_MS = 5 * 60 * 1000;
export const CAPTURE_ATTACHMENT_PENDING_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const CAPTURE_ATTACHMENT_MAX_PER_CAPTURE = 10;
export const CAPTURE_ATTACHMENT_MAX_PROJECT_BYTES = 200 * 1024 * 1024;
export const CAPTURE_ATTACHMENT_MAX_DISPLAY_FILENAME_LENGTH = 200;

export const CAPTURE_ATTACHMENT_ALLOWED_MIME_BYTE_LIMITS = Object.freeze({
  "image/jpeg": 8 * 1024 * 1024,
  "image/png": 8 * 1024 * 1024,
  "image/webp": 8 * 1024 * 1024,
  "audio/webm": 15 * 1024 * 1024,
  "audio/mp4": 15 * 1024 * 1024,
  "audio/mpeg": 15 * 1024 * 1024,
  "application/pdf": 5 * 1024 * 1024,
  "text/plain": 5 * 1024 * 1024
}) satisfies Readonly<Record<string, number>>;

export type CaptureAttachmentAllowedMime = keyof typeof CAPTURE_ATTACHMENT_ALLOWED_MIME_BYTE_LIMITS;

export type CaptureAttachmentState = "pending" | "ready" | "refused" | "deleted";

export type CaptureAttachmentRefusalCode =
  | "unsupported-type"
  | "declared-size-exceeded"
  | "type-mismatch"
  | "size-mismatch"
  | "checksum-mismatch"
  | "object-missing"
  | "inspection-failed";

export type CaptureAttachmentPolicyCode =
  | "unsupported-content-type"
  | "declared-size-exceeded"
  | "attachment-count-exceeded"
  | "project-quota-exceeded"
  | "checksum-invalid"
  | "capture-not-editable"
  | "attachment-expired"
  | "attachment-not-ready"
  | "object-missing"
  | "inspection-failed"
  | "type-mismatch"
  | "size-mismatch"
  | "checksum-mismatch";

type BrandedString<Name extends string> = string & { readonly __brand: Name };

export type Sha256Digest = BrandedString<"Sha256Digest">;

export type CaptureAttachmentRecord = Readonly<{
  attachmentId: AttachmentId;
  captureId: CaptureId;
  projectId: ProjectId;
  state: CaptureAttachmentState;
  displayFilename: string;
  declaredContentType: CaptureAttachmentAllowedMime;
  readyContentType?: CaptureAttachmentAllowedMime;
  declaredByteSize: number;
  actualByteSize?: number;
  clientSha256: Sha256Digest;
  serverSha256?: Sha256Digest;
  objectKey: string;
  pendingExpiresAt?: string;
  refusalCode?: CaptureAttachmentRefusalCode;
  createdAt: string;
  updatedAt: string;
  readyAt?: string;
  deletedAt?: string;
}>;

export type CaptureAttachmentSummary = Readonly<{
  attachmentId: AttachmentId;
  captureId: CaptureId;
  projectId: ProjectId;
  state: CaptureAttachmentState;
  displayFilename: string;
  declaredContentType: CaptureAttachmentAllowedMime;
  readyContentType?: CaptureAttachmentAllowedMime;
  declaredByteSize: number;
  actualByteSize?: number;
  pendingExpiresAt?: string;
  refusalCode?: CaptureAttachmentRefusalCode;
  createdAt: string;
  updatedAt: string;
  readyAt?: string;
  deletedAt?: string;
}>;

export class CaptureAttachmentNotFoundError extends Error {
  readonly code = "ATTACHMENT_NOT_FOUND" as const;

  constructor() {
    super("Capture attachment was not found.");
    this.name = "CaptureAttachmentNotFoundError";
  }
}

export class CaptureAttachmentNotEditableError extends Error {
  readonly code = "ATTACHMENT_NOT_EDITABLE" as const;

  constructor() {
    super("Capture attachment cannot be changed in the current state.");
    this.name = "CaptureAttachmentNotEditableError";
  }
}

export class CaptureAttachmentPolicyError extends Error {
  readonly code: CaptureAttachmentPolicyCode;

  constructor(code: CaptureAttachmentPolicyCode) {
    super("Capture attachment policy refused the request.");
    this.name = "CaptureAttachmentPolicyError";
    this.code = code;
  }
}

export class CaptureAttachmentStorageError extends Error {
  readonly code = "ATTACHMENT_STORAGE_FAILURE" as const;

  constructor() {
    super("Capture attachment storage failed.");
    this.name = "CaptureAttachmentStorageError";
  }
}

const REJECTED_MIME_PREFIXES = Object.freeze([
  "application/octet-stream",
  "application/zip",
  "application/x-zip",
  "application/x-rar",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "application/x-msdownload",
  "application/x-executable",
  "application/x-sh",
  "application/javascript",
  "application/x-javascript"
]);

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", `${field} must not be empty.`);
  }
  return normalized;
}

function requirePositiveByteSize(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      `${field} must be a positive integer.`
    );
  }
  return value;
}

export function sha256Digest(value: string): Sha256Digest {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "SHA-256 digest must be 64 lowercase hex characters."
    );
  }
  return normalized as Sha256Digest;
}

export function isRejectedCaptureAttachmentMime(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return true;
  if (REJECTED_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  return !isAllowedCaptureAttachmentDeclaredMime(normalized);
}

export function isAllowedCaptureAttachmentDeclaredMime(
  value: string
): value is CaptureAttachmentAllowedMime {
  return Object.prototype.hasOwnProperty.call(
    CAPTURE_ATTACHMENT_ALLOWED_MIME_BYTE_LIMITS,
    value
  );
}

export function maxByteSizeForCaptureAttachmentMime(
  mime: CaptureAttachmentAllowedMime
): number {
  return CAPTURE_ATTACHMENT_ALLOWED_MIME_BYTE_LIMITS[mime];
}

export function createCaptureAttachmentDisplayFilename(value: string): string {
  const trimmed = value.trim();
  const containsControlCharacter = Array.from(trimmed).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (trimmed.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", "Attachment filename must not be empty.");
  }
  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    containsControlCharacter
  ) {
    throw new DomainValidationError(
      "INVALID_CRAFT",
      "Attachment filename must be display-only text without path separators or control characters."
    );
  }
  if (trimmed.length > CAPTURE_ATTACHMENT_MAX_DISPLAY_FILENAME_LENGTH) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      "Attachment filename exceeds the allowed display length."
    );
  }
  return trimmed;
}

export function buildCaptureAttachmentObjectKey(input: Readonly<{
  projectId: ProjectId;
  captureId: CaptureId;
  attachmentId: AttachmentId;
}>): string {
  return `projects/${input.projectId}/captures/${input.captureId}/attachments/${input.attachmentId}`;
}

function assertStateCoherence(record: CaptureAttachmentRecord): void {
  const {
    state,
    readyContentType,
    actualByteSize,
    serverSha256,
    pendingExpiresAt,
    refusalCode,
    readyAt,
    deletedAt,
    declaredByteSize
  } = record;

  requirePositiveByteSize(declaredByteSize, "Declared attachment byte size");

  if (state === "pending") {
    if (
      readyContentType !== undefined ||
      actualByteSize !== undefined ||
      serverSha256 !== undefined ||
      refusalCode !== undefined ||
      readyAt !== undefined ||
      deletedAt !== undefined
    ) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Pending attachments may only record reservation metadata."
      );
    }
    if (pendingExpiresAt === undefined) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Pending attachments must record an expiry time."
      );
    }
    return;
  }

  if (state === "ready") {
    if (
      readyContentType === undefined ||
      actualByteSize === undefined ||
      serverSha256 === undefined ||
      readyAt === undefined ||
      refusalCode !== undefined ||
      deletedAt !== undefined
    ) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Ready attachments must record finalized inspection metadata."
      );
    }
    if (pendingExpiresAt !== undefined) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Ready attachments must not retain pending expiry."
      );
    }
    return;
  }

  if (state === "refused") {
    if (
      refusalCode === undefined ||
      readyContentType !== undefined ||
      actualByteSize !== undefined ||
      serverSha256 !== undefined ||
      readyAt !== undefined ||
      deletedAt !== undefined
    ) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Refused attachments must record a refusal code without ready metadata."
      );
    }
    return;
  }

  if (state === "deleted") {
    if (deletedAt === undefined) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Deleted attachments must record a deletion time."
      );
    }
    return;
  }
}

export function createCaptureAttachmentRecord(
  input: CaptureAttachmentRecord
): CaptureAttachmentRecord {
  if (!isAllowedCaptureAttachmentDeclaredMime(input.declaredContentType)) {
    throw new DomainValidationError(
      "INVALID_CRAFT",
      "Attachment declared content type is not allowlisted."
    );
  }
  const displayFilename = createCaptureAttachmentDisplayFilename(input.displayFilename);
  const objectKey = requireText(input.objectKey, "Attachment object key");
  if (objectKey.includes("\0") || objectKey.includes("..")) {
    throw new DomainValidationError(
      "INVALID_CRAFT",
      "Attachment object key must be an opaque server-scoped identifier."
    );
  }

  const record = Object.freeze({
    attachmentId: input.attachmentId,
    captureId: input.captureId,
    projectId: input.projectId,
    state: input.state,
    displayFilename,
    declaredContentType: input.declaredContentType,
    declaredByteSize: requirePositiveByteSize(
      input.declaredByteSize,
      "Declared attachment byte size"
    ),
    clientSha256: sha256Digest(input.clientSha256),
    objectKey,
    createdAt: requireText(input.createdAt, "Attachment creation time"),
    updatedAt: requireText(input.updatedAt, "Attachment update time"),
    ...(input.readyContentType === undefined
      ? {}
      : { readyContentType: input.readyContentType }),
    ...(input.actualByteSize === undefined
      ? {}
      : {
          actualByteSize: requirePositiveByteSize(
            input.actualByteSize,
            "Actual attachment byte size"
          )
        }),
    ...(input.serverSha256 === undefined
      ? {}
      : { serverSha256: sha256Digest(input.serverSha256) }),
    ...(input.pendingExpiresAt === undefined
      ? {}
      : { pendingExpiresAt: requireText(input.pendingExpiresAt, "Pending expiry time") }),
    ...(input.refusalCode === undefined ? {} : { refusalCode: input.refusalCode }),
    ...(input.readyAt === undefined
      ? {}
      : { readyAt: requireText(input.readyAt, "Attachment ready time") }),
    ...(input.deletedAt === undefined
      ? {}
      : { deletedAt: requireText(input.deletedAt, "Attachment deletion time") })
  });

  assertStateCoherence(record);
  return record;
}

export function captureAttachmentSummaryFromRecord(
  record: CaptureAttachmentRecord
): CaptureAttachmentSummary {
  return Object.freeze({
    attachmentId: record.attachmentId,
    captureId: record.captureId,
    projectId: record.projectId,
    state: record.state,
    displayFilename: record.displayFilename,
    declaredContentType: record.declaredContentType,
    declaredByteSize: record.declaredByteSize,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.readyContentType === undefined
      ? {}
      : { readyContentType: record.readyContentType }),
    ...(record.actualByteSize === undefined
      ? {}
      : { actualByteSize: record.actualByteSize }),
    ...(record.pendingExpiresAt === undefined
      ? {}
      : { pendingExpiresAt: record.pendingExpiresAt }),
    ...(record.refusalCode === undefined ? {} : { refusalCode: record.refusalCode }),
    ...(record.readyAt === undefined ? {} : { readyAt: record.readyAt }),
    ...(record.deletedAt === undefined ? {} : { deletedAt: record.deletedAt })
  });
}

export type CaptureAttachmentDetectionResult =
  | Readonly<{ ok: true; contentType: CaptureAttachmentAllowedMime }>
  | Readonly<{ ok: false; reason: "unsupported-type" | "inspection-failed" }>;

function bytesMatch(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function isAllowedPlainTextAscii(byte: number): boolean {
  if (byte === 0x09 || byte === 0x0a || byte === 0x0d) {
    return true;
  }
  if (byte >= 0x20 && byte <= 0x7e) {
    return true;
  }
  return false;
}

function isValidPlainTextUtf8(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index]!;
    if (byte <= 0x7f) {
      if (!isAllowedPlainTextAscii(byte)) {
        return false;
      }
      index += 1;
      continue;
    }
    if (byte >= 0xc2 && byte <= 0xdf) {
      if (index + 1 >= bytes.length || (bytes[index + 1]! & 0xc0) !== 0x80) {
        return false;
      }
      index += 2;
      continue;
    }
    if (byte >= 0xe0 && byte <= 0xef) {
      if (
        index + 2 >= bytes.length ||
        (bytes[index + 1]! & 0xc0) !== 0x80 ||
        (bytes[index + 2]! & 0xc0) !== 0x80
      ) {
        return false;
      }
      index += 3;
      continue;
    }
    if (byte >= 0xf0 && byte <= 0xf4) {
      if (
        index + 3 >= bytes.length ||
        (bytes[index + 1]! & 0xc0) !== 0x80 ||
        (bytes[index + 2]! & 0xc0) !== 0x80 ||
        (bytes[index + 3]! & 0xc0) !== 0x80
      ) {
        return false;
      }
      index += 4;
      continue;
    }
    return false;
  }
  return true;
}

function refusesExecutableOrArchiveSignature(bytes: Uint8Array): boolean {
  if (bytesMatch(bytes.slice(0, 4), [0x7f, 0x45, 0x4c, 0x46])) {
    return true;
  }
  if (bytesMatch(bytes.slice(0, 2), [0x4d, 0x5a])) {
    return true;
  }
  if (bytesMatch(bytes.slice(0, 2), [0x50, 0x4b])) {
    return true;
  }
  if (bytesMatch(bytes.slice(0, 4), [0xfe, 0xed, 0xfa, 0xce])) {
    return true;
  }
  if (bytesMatch(bytes.slice(0, 4), [0xce, 0xfa, 0xed, 0xfe])) {
    return true;
  }
  if (bytesMatch(bytes.slice(0, 4), [0xfe, 0xed, 0xfa, 0xcf])) {
    return true;
  }
  if (bytesMatch(bytes.slice(0, 4), [0xcf, 0xfa, 0xed, 0xfe])) {
    return true;
  }
  return false;
}

export function detectCaptureAttachmentContentType(
  bytes: Uint8Array
): CaptureAttachmentDetectionResult {
  if (bytes.length === 0) {
    return { ok: false, reason: "inspection-failed" };
  }

  if (bytesMatch(bytes, [0xff, 0xd8, 0xff])) {
    return { ok: true, contentType: "image/jpeg" };
  }
  if (bytesMatch(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ok: true, contentType: "image/png" };
  }
  if (
    bytes.length >= 12 &&
    bytesMatch(bytes.slice(0, 4), [0x52, 0x49, 0x46, 0x46]) &&
    bytesMatch(bytes.slice(8, 12), [0x57, 0x45, 0x42, 0x50])
  ) {
    return { ok: true, contentType: "image/webp" };
  }
  if (bytesMatch(bytes.slice(0, 4), [0x25, 0x50, 0x44, 0x46])) {
    return { ok: true, contentType: "application/pdf" };
  }
  if (bytesMatch(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { ok: true, contentType: "audio/webm" };
  }
  if (bytes.length >= 12) {
    const ftyp = String.fromCharCode(
      bytes[4] ?? 0,
      bytes[5] ?? 0,
      bytes[6] ?? 0,
      bytes[7] ?? 0
    );
    if (ftyp === "ftyp") {
      return { ok: true, contentType: "audio/mp4" };
    }
  }
  if (
    bytesMatch(bytes.slice(0, 3), [0x49, 0x44, 0x33]) ||
    bytesMatch(bytes.slice(0, 2), [0xff, 0xfb]) ||
    bytesMatch(bytes.slice(0, 2), [0xff, 0xf3]) ||
    bytesMatch(bytes.slice(0, 2), [0xff, 0xf2])
  ) {
    return { ok: true, contentType: "audio/mpeg" };
  }
  if (refusesExecutableOrArchiveSignature(bytes)) {
    return { ok: false, reason: "unsupported-type" };
  }
  if (isValidPlainTextUtf8(bytes)) {
    return { ok: true, contentType: "text/plain" };
  }
  return { ok: false, reason: "unsupported-type" };
}

export function validateDeclaredCaptureAttachment(input: Readonly<{
  declaredContentType: string;
  declaredByteSize: number;
}>):
  | Readonly<{ ok: true; contentType: CaptureAttachmentAllowedMime }>
  | Readonly<{ ok: false; code: CaptureAttachmentPolicyCode }> {
  const normalizedType = input.declaredContentType.trim().toLowerCase();
  if (isRejectedCaptureAttachmentMime(normalizedType)) {
    return { ok: false, code: "unsupported-content-type" };
  }
  if (!isAllowedCaptureAttachmentDeclaredMime(normalizedType)) {
    return { ok: false, code: "unsupported-content-type" };
  }
  const limit = maxByteSizeForCaptureAttachmentMime(normalizedType);
  if (
    !Number.isSafeInteger(input.declaredByteSize) ||
    input.declaredByteSize < 1 ||
    input.declaredByteSize > limit
  ) {
    return { ok: false, code: "declared-size-exceeded" };
  }
  return { ok: true, contentType: normalizedType };
}

export function attachmentCountsTowardQuota(state: CaptureAttachmentState): boolean {
  return state === "pending" || state === "ready";
}

export function attachmentBytesCountTowardQuota(
  record: CaptureAttachmentRecord
): number {
  if (!attachmentCountsTowardQuota(record.state)) {
    return 0;
  }
  if (record.state === "ready" && record.actualByteSize !== undefined) {
    return record.actualByteSize;
  }
  return record.declaredByteSize;
}

export function addIsoDurationMs(iso: string, durationMs: number): string {
  return new Date(Date.parse(iso) + durationMs).toISOString();
}

export function isIsoBefore(left: string, right: string): boolean {
  return Date.parse(left) < Date.parse(right);
}
