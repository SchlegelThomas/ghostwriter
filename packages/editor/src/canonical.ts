import { validateSceneDocumentV1 } from "./document.js";
import type { SceneBlockV1, SceneDocumentV1 } from "./types.js";

function serializeCanonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot contain non-finite numbers.");
    }

    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(serializeCanonicalJson).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serializeCanonicalJson(record[key])}`,
      );

    return `{${entries.join(",")}}`;
  }

  throw new TypeError("Canonical JSON received a non-JSON value.");
}

export function serializeCanonicalSceneDocument(value: unknown): string {
  return serializeCanonicalJson(validateSceneDocumentV1(value));
}

export function serializeCanonicalSceneBlock(block: SceneBlockV1): string {
  return serializeCanonicalJson(block);
}

/**
 * Returns the lowercase, 64-character SHA-256 digest of canonical document
 * JSON. Web Crypto is shared by modern browsers and supported Node runtimes.
 */
export async function hashSceneDocument(value: unknown): Promise<string> {
  const cryptoProvider = globalThis.crypto;

  if (cryptoProvider?.subtle === undefined) {
    throw new Error(
      "A Web Crypto implementation is required to hash scene documents.",
    );
  }

  const canonicalDocument = serializeCanonicalSceneDocument(value);
  const digest = await cryptoProvider.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalDocument),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function hashValidatedSceneDocument(
  value: SceneDocumentV1,
): Promise<string> {
  return hashSceneDocument(value);
}
