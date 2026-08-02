import { DomainValidationError } from "./domain.js";

export const NEXT_ACTION_TRIGGERS = Object.freeze([
  "scene-prose-saved",
  "capture-saved",
  "story-knowledge-created",
  "structure-reordered",
  "draft-acknowledged",
  "manual-start"
] as const);

export type NextActionTrigger = (typeof NEXT_ACTION_TRIGGERS)[number];

export const NEXT_ACTION_SUGGESTION_KINDS = Object.freeze([
  "create-story-knowledge",
  "run-catalog-agent",
  "open-surface",
  "escalate-model",
  "continue-writing"
] as const);

export type NextActionSuggestionKind =
  (typeof NEXT_ACTION_SUGGESTION_KINDS)[number];

export const NEXT_ACTION_STORY_KNOWLEDGE_KINDS = Object.freeze([
  "character",
  "location",
  "world-rule",
  "thread",
  "custom"
] as const);

export type NextActionStoryKnowledgeKind =
  (typeof NEXT_ACTION_STORY_KNOWLEDGE_KINDS)[number];

export const NEXT_ACTION_OPEN_SURFACES = Object.freeze([
  "draft",
  "cast",
  "capture",
  "plans",
  "canvas"
] as const);

export type NextActionOpenSurface = (typeof NEXT_ACTION_OPEN_SURFACES)[number];

export type NextActionSuggestionV1 = Readonly<{
  kind: NextActionSuggestionKind;
  title: string;
  rationale: string;
  proposedName?: string;
  storyKnowledgeKind?: NextActionStoryKnowledgeKind;
  catalogAgentId?: string;
  openSurface?: NextActionOpenSurface;
  evidenceQuote?: string;
  sceneId?: string;
}>;

export type NextActionEscalateV1 = Readonly<{
  recommended: boolean;
  reason: string;
  suggestedAgentId?: string;
}>;

export type NextActionV1 = Readonly<{
  schemaId: "next-action-v1";
  trigger: NextActionTrigger;
  summary: string;
  suggestions: readonly NextActionSuggestionV1[];
  escalate?: NextActionEscalateV1;
}>;

const boundedText = (maxLength: number) =>
  Object.freeze({ type: "string", minLength: 1, maxLength });

export const NEXT_ACTION_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaId", "trigger", "summary", "suggestions"],
  properties: Object.freeze({
    schemaId: Object.freeze({ type: "string", const: "next-action-v1" }),
    trigger: Object.freeze({ type: "string", enum: NEXT_ACTION_TRIGGERS }),
    summary: boundedText(2_000),
    suggestions: Object.freeze({
      type: "array",
      maxItems: 8,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["kind", "title", "rationale"],
        properties: Object.freeze({
          kind: Object.freeze({
            type: "string",
            enum: NEXT_ACTION_SUGGESTION_KINDS
          }),
          title: boundedText(120),
          rationale: boundedText(1_000),
          proposedName: boundedText(120),
          storyKnowledgeKind: Object.freeze({
            type: "string",
            enum: NEXT_ACTION_STORY_KNOWLEDGE_KINDS
          }),
          catalogAgentId: boundedText(100),
          openSurface: Object.freeze({
            type: "string",
            enum: NEXT_ACTION_OPEN_SURFACES
          }),
          evidenceQuote: boundedText(1_000),
          sceneId: boundedText(200)
        })
      })
    }),
    escalate: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: ["recommended", "reason"],
      properties: Object.freeze({
        recommended: Object.freeze({ type: "boolean" }),
        reason: boundedText(1_000),
        suggestedAgentId: boundedText(100)
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
    invalid("Next action payload includes unexpected or missing fields.");
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

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(`${field} must be a boolean.`);
  return value;
}

function validateSuggestion(raw: unknown): NextActionSuggestionV1 {
  if (!isPlainObject(raw)) invalid("Next action suggestion must be an object.");
  exactKeys(
    raw,
    ["kind", "title", "rationale"],
    [
      "proposedName",
      "storyKnowledgeKind",
      "catalogAgentId",
      "openSurface",
      "evidenceQuote",
      "sceneId"
    ]
  );
  if (
    !NEXT_ACTION_SUGGESTION_KINDS.includes(
      raw.kind as NextActionSuggestionKind
    )
  ) {
    invalid("Next action suggestion kind is invalid.");
  }
  const storyKnowledgeKind =
    raw.storyKnowledgeKind === undefined
      ? undefined
      : NEXT_ACTION_STORY_KNOWLEDGE_KINDS.includes(
            raw.storyKnowledgeKind as NextActionStoryKnowledgeKind
          )
        ? (raw.storyKnowledgeKind as NextActionStoryKnowledgeKind)
        : invalid("Next action story knowledge kind is invalid.");
  const openSurface =
    raw.openSurface === undefined
      ? undefined
      : NEXT_ACTION_OPEN_SURFACES.includes(
            raw.openSurface as NextActionOpenSurface
          )
        ? (raw.openSurface as NextActionOpenSurface)
        : invalid("Next action open surface is invalid.");
  return Object.freeze({
    kind: raw.kind as NextActionSuggestionKind,
    title: text(raw.title, "Suggestion title", 120),
    rationale: text(raw.rationale, "Suggestion rationale", 1_000),
    ...(raw.proposedName === undefined
      ? {}
      : { proposedName: text(raw.proposedName, "Proposed name", 120) }),
    ...(storyKnowledgeKind === undefined ? {} : { storyKnowledgeKind }),
    ...(raw.catalogAgentId === undefined
      ? {}
      : { catalogAgentId: text(raw.catalogAgentId, "Catalog agent id", 100) }),
    ...(openSurface === undefined ? {} : { openSurface }),
    ...(raw.evidenceQuote === undefined
      ? {}
      : { evidenceQuote: text(raw.evidenceQuote, "Evidence quote", 1_000) }),
    ...(raw.sceneId === undefined
      ? {}
      : { sceneId: text(raw.sceneId, "Scene id", 200) })
  });
}

function validateEscalate(raw: unknown): NextActionEscalateV1 {
  if (!isPlainObject(raw)) invalid("Next action escalate must be an object.");
  exactKeys(raw, ["recommended", "reason"], ["suggestedAgentId"]);
  return Object.freeze({
    recommended: booleanValue(raw.recommended, "Escalate recommended"),
    reason: text(raw.reason, "Escalate reason", 1_000),
    ...(raw.suggestedAgentId === undefined
      ? {}
      : {
          suggestedAgentId: text(
            raw.suggestedAgentId,
            "Suggested agent id",
            100
          )
        })
  });
}

export function validateNextActionV1(value: unknown): NextActionV1 {
  if (!isPlainObject(value)) invalid("Next action payload must be an object.");
  exactKeys(value, ["schemaId", "trigger", "summary", "suggestions"], [
    "escalate"
  ]);
  if (value.schemaId !== "next-action-v1") {
    invalid("Next action schema identifier is invalid.");
  }
  if (
    !NEXT_ACTION_TRIGGERS.includes(value.trigger as NextActionTrigger)
  ) {
    invalid("Next action trigger is invalid.");
  }
  if (!Array.isArray(value.suggestions) || value.suggestions.length > 8) {
    invalid("Next action suggestions are invalid.");
  }
  const suggestions = Object.freeze(
    value.suggestions.map((item) => validateSuggestion(item))
  );
  const escalate =
    value.escalate === undefined
      ? undefined
      : validateEscalate(value.escalate);
  return Object.freeze({
    schemaId: "next-action-v1",
    trigger: value.trigger as NextActionTrigger,
    summary: text(value.summary, "Summary", 2_000),
    suggestions,
    ...(escalate === undefined ? {} : { escalate })
  });
}

export function isNextActionV1(value: unknown): value is NextActionV1 {
  try {
    validateNextActionV1(value);
    return true;
  } catch {
    return false;
  }
}
