import { DomainValidationError } from "./domain.js";

export const CATALOG_MEMO_LENSES = Object.freeze([
  "save-the-cat",
  "three-act",
  "heros-journey",
  "scene-sequel",
  "character-want-need",
  "genre-conventions"
] as const);

export type CatalogMemoLens = (typeof CATALOG_MEMO_LENSES)[number];

export type CatalogMemoV1 = Readonly<{
  schemaId: "catalog-memo-v1";
  agentId: string;
  title: string;
  summary: string;
  lens?: CatalogMemoLens;
  sections: readonly Readonly<{ heading: string; body: string }>[];
  evidence: readonly Readonly<{
    label: string;
    sceneId?: string;
    quote?: string;
  }>[];
}>;

export const CATALOG_MEMO_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaId", "agentId", "title", "summary", "sections", "evidence"],
  properties: Object.freeze({
    schemaId: Object.freeze({ type: "string", const: "catalog-memo-v1" }),
    agentId: Object.freeze({ type: "string", minLength: 1, maxLength: 100 }),
    title: Object.freeze({ type: "string", minLength: 1, maxLength: 120 }),
    summary: Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 }),
    lens: Object.freeze({ type: "string", enum: CATALOG_MEMO_LENSES }),
    sections: Object.freeze({
      type: "array",
      maxItems: 12,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["heading", "body"],
        properties: Object.freeze({
          heading: Object.freeze({ type: "string", minLength: 1, maxLength: 120 }),
          body: Object.freeze({ type: "string", minLength: 1, maxLength: 4_000 })
        })
      })
    }),
    evidence: Object.freeze({
      type: "array",
      maxItems: 20,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["label"],
        properties: Object.freeze({
          label: Object.freeze({ type: "string", minLength: 1, maxLength: 300 }),
          sceneId: Object.freeze({ type: "string", minLength: 1, maxLength: 200 }),
          quote: Object.freeze({ type: "string", minLength: 1, maxLength: 1_000 })
        })
      })
    })
  })
});

function invalid(message: string): never {
  throw new DomainValidationError("INVALID_AGENT_OUTPUT", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    invalid("Catalog memo payload includes unexpected or missing fields.");
  }
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") invalid(`${field} must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    invalid(`${field} length is out of bounds.`);
  }
  return normalized;
}

export function validateCatalogMemoV1(value: unknown): CatalogMemoV1 {
  if (!isPlainObject(value)) invalid("Catalog memo payload must be an object.");
  exactKeys(
    value,
    ["schemaId", "agentId", "title", "summary", "sections", "evidence"],
    ["lens"]
  );
  if (value.schemaId !== "catalog-memo-v1") {
    invalid("Catalog memo schema identifier is invalid.");
  }
  const lens =
    value.lens === undefined
      ? undefined
      : CATALOG_MEMO_LENSES.includes(value.lens as CatalogMemoLens)
        ? (value.lens as CatalogMemoLens)
        : invalid("Catalog memo lens is invalid.");
  if (!Array.isArray(value.sections) || value.sections.length > 12) {
    invalid("Catalog memo sections are invalid.");
  }
  if (!Array.isArray(value.evidence) || value.evidence.length > 20) {
    invalid("Catalog memo evidence is invalid.");
  }
  const sections = value.sections.map((section) => {
    if (!isPlainObject(section)) invalid("Catalog memo section must be an object.");
    exactKeys(section, ["heading", "body"]);
    return Object.freeze({
      heading: text(section.heading, "Section heading", 120),
      body: text(section.body, "Section body", 4_000)
    });
  });
  const evidence = value.evidence.map((item) => {
    if (!isPlainObject(item)) invalid("Catalog memo evidence must be an object.");
    exactKeys(item, ["label"], ["sceneId", "quote"]);
    return Object.freeze({
      label: text(item.label, "Evidence label", 300),
      ...(item.sceneId === undefined
        ? {}
        : { sceneId: text(item.sceneId, "Evidence scene id", 200) }),
      ...(item.quote === undefined
        ? {}
        : { quote: text(item.quote, "Evidence quote", 1_000) })
    });
  });
  const agentId = text(value.agentId, "Agent id", 100);
  if (
    agentId === "continuity-reader" &&
    evidence.some((item) => item.sceneId === undefined && item.quote === undefined)
  ) {
    invalid("Continuity Reader evidence must identify a scene or quote.");
  }
  return Object.freeze({
    schemaId: "catalog-memo-v1",
    agentId,
    title: text(value.title, "Title", 120),
    summary: text(value.summary, "Summary", 2_000),
    ...(lens === undefined ? {} : { lens }),
    sections: Object.freeze(sections),
    evidence: Object.freeze(evidence)
  });
}

export function isCatalogMemoV1(value: unknown): value is CatalogMemoV1 {
  try {
    validateCatalogMemoV1(value);
    return true;
  } catch {
    return false;
  }
}
