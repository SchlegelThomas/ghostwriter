import { DomainValidationError } from "./domain.js";

export const BOOK_COVER_LOCATOR_ORIGIN = "https://ghostwriter.cover";

const PNG_DATA_URI_PREFIX = "data:image/png;base64,";
const MAX_DECODED_PNG_BYTES = 8 * 1024 * 1024;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;

export function buildBookCoverObjectKey(projectId: string, bookId: string): string {
  return `projects/${projectId}/books/${bookId}/cover.png`;
}

export function buildBookCoverLocatorUrl(projectId: string, bookId: string): string {
  return `${BOOK_COVER_LOCATOR_ORIGIN}/projects/${encodeURIComponent(projectId)}/books/${encodeURIComponent(bookId)}`;
}

export function parseBookCoverLocatorUrl(
  url: string
): Readonly<{ projectId: string; bookId: string }> | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.origin !== BOOK_COVER_LOCATOR_ORIGIN) {
    return undefined;
  }
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 4) {
    return undefined;
  }
  const [projectsLabel, projectId, booksLabel, bookId] = segments;
  if (
    projectsLabel !== "projects" ||
    booksLabel !== "books" ||
    projectId === undefined ||
    bookId === undefined ||
    projectId.length === 0 ||
    bookId.length === 0
  ) {
    return undefined;
  }
  return Object.freeze({
    projectId: decodeURIComponent(projectId),
    bookId: decodeURIComponent(bookId)
  });
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const bufferCtor = (
    globalThis as typeof globalThis & {
      Buffer?: {
        from(data: string, encoding: string): Uint8Array;
      };
    }
  ).Buffer;
  if (bufferCtor !== undefined) {
    return Uint8Array.from(bufferCtor.from(base64, "base64"));
  }
  if (typeof globalThis.atob !== "function") {
    throw new DomainValidationError(
      "INVALID_URL",
      "Book cover PNG data URI could not be decoded."
    );
  }
  let binary: string;
  try {
    binary = globalThis.atob(base64);
  } catch {
    throw new DomainValidationError(
      "INVALID_URL",
      "Book cover PNG data URI must contain valid base64."
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function decodePngDataUri(dataUri: string): Uint8Array {
  const normalized = dataUri.trim();
  if (!normalized.startsWith(PNG_DATA_URI_PREFIX)) {
    throw new DomainValidationError(
      "INVALID_URL",
      "Book cover preview must be a PNG data URI."
    );
  }
  const base64 = normalized.slice(PNG_DATA_URI_PREFIX.length).replace(/\s+/gu, "");
  if (base64.length === 0 || !BASE64_PATTERN.test(base64)) {
    throw new DomainValidationError(
      "INVALID_URL",
      "Book cover PNG data URI must contain valid base64."
    );
  }
  // Reject oversized payloads before allocating decoded bytes when possible.
  const approxDecodedBytes = Math.floor((base64.length * 3) / 4);
  if (approxDecodedBytes > MAX_DECODED_PNG_BYTES) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      "Book cover PNG must be at most 8 MiB."
    );
  }
  const bytes = decodeBase64ToBytes(base64);
  if (bytes.byteLength > MAX_DECODED_PNG_BYTES) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      "Book cover PNG must be at most 8 MiB."
    );
  }
  if (bytes.byteLength === 0) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "Book cover PNG data URI must not be empty."
    );
  }
  return bytes;
}
