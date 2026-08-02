import { DomainValidationError } from "./domain.js";

export const STORY_KNOWLEDGE_CREATE_KINDS = Object.freeze([
  "character",
  "location",
  "world-rule",
  "thread",
  "custom"
] as const);

export type StoryKnowledgeCreateKind =
  (typeof STORY_KNOWLEDGE_CREATE_KINDS)[number];

export type StoryKnowledgeCreateV1 = Readonly<{
  schemaId: "story-knowledge-create-v1";
  name: string;
  kind: StoryKnowledgeCreateKind;
  summary: string;
  properties?: string;
  sceneId?: string;
  firstAppearanceNote?: string;
}>;

const boundedText = (maxLength: number) =>
  Object.freeze({ type: "string", minLength: 1, maxLength });

export const STORY_KNOWLEDGE_CREATE_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaId", "name", "kind", "summary"],
  properties: Object.freeze({
    schemaId: Object.freeze({
      type: "string",
      const: "story-knowledge-create-v1"
    }),
    name: boundedText(120),
    kind: Object.freeze({ type: "string", enum: STORY_KNOWLEDGE_CREATE_KINDS }),
    summary: boundedText(2_000),
    properties: boundedText(4_000),
    sceneId: boundedText(200),
    firstAppearanceNote: boundedText(1_000)
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
    invalid("Story knowledge create payload includes unexpected or missing fields.");
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

export function validateStoryKnowledgeCreateV1(
  value: unknown
): StoryKnowledgeCreateV1 {
  if (!isPlainObject(value)) {
    invalid("Story knowledge create payload must be an object.");
  }
  exactKeys(value, ["schemaId", "name", "kind", "summary"], [
    "properties",
    "sceneId",
    "firstAppearanceNote"
  ]);
  if (value.schemaId !== "story-knowledge-create-v1") {
    invalid("Story knowledge create schema identifier is invalid.");
  }
  if (
    !STORY_KNOWLEDGE_CREATE_KINDS.includes(value.kind as StoryKnowledgeCreateKind)
  ) {
    invalid("Story knowledge create kind is invalid.");
  }
  return Object.freeze({
    schemaId: "story-knowledge-create-v1",
    name: text(value.name, "Name", 120),
    kind: value.kind as StoryKnowledgeCreateKind,
    summary: text(value.summary, "Summary", 2_000),
    ...(value.properties === undefined
      ? {}
      : { properties: text(value.properties, "Properties", 4_000) }),
    ...(value.sceneId === undefined
      ? {}
      : { sceneId: text(value.sceneId, "Scene id", 200) }),
    ...(value.firstAppearanceNote === undefined
      ? {}
      : {
          firstAppearanceNote: text(
            value.firstAppearanceNote,
            "First appearance note",
            1_000
          )
        })
  });
}

export function isStoryKnowledgeCreateV1(
  value: unknown
): value is StoryKnowledgeCreateV1 {
  try {
    validateStoryKnowledgeCreateV1(value);
    return true;
  } catch {
    return false;
  }
}
