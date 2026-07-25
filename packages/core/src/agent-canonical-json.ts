type JsonPrimitive = string | number | boolean | null;
interface JsonObject {
  readonly [key: string]: JsonValue;
}
type JsonArray = readonly JsonValue[];
type JsonValue = JsonPrimitive | JsonObject | JsonArray;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Non-finite numbers cannot be canonicalized.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const next: Record<string, JsonValue> = {};
    for (const key of keys) {
      const entry = value[key];
      if (entry === undefined) continue;
      next[key] = canonicalize(entry);
    }
    return next;
  }
  throw new TypeError("Value is not JSON-serializable.");
}

/** Deterministic JSON for layer and receipt hashing (sorted keys, no undefined). */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
