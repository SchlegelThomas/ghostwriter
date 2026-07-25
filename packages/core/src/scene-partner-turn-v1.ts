import { DomainValidationError } from "./domain.js";

export const SCENE_PARTNER_TURN_V1_SCHEMA_ID = "scene-partner-turn-v1" as const;

export type ScenePartnerTurnPhase =
  | "interview"
  | "match"
  | "new-scene"
  | "iterate";

export type ScenePartnerTurnAction = "apply-new-scene" | "propose-image";

export type ScenePartnerTurnV1 = Readonly<{
  schemaId: typeof SCENE_PARTNER_TURN_V1_SCHEMA_ID;
  thinkingSteps: readonly string[];
  assistantMessage: string;
  phase: ScenePartnerTurnPhase;
  matchedSceneId?: string | null;
  proseDraft?: string | null;
  actions: readonly ScenePartnerTurnAction[];
  imagePrompt?: string | null;
}>;

const PHASES = Object.freeze([
  "interview",
  "match",
  "new-scene",
  "iterate"
] as const satisfies readonly ScenePartnerTurnPhase[]);

const ACTIONS = Object.freeze([
  "apply-new-scene",
  "propose-image"
] as const satisfies readonly ScenePartnerTurnAction[]);

const nullableString = Object.freeze({
  anyOf: Object.freeze([
    Object.freeze({ type: "string", minLength: 1, maxLength: 8_000 }),
    Object.freeze({ type: "null" })
  ])
});

const nullableSceneId = Object.freeze({
  anyOf: Object.freeze([
    Object.freeze({ type: "string", minLength: 1, maxLength: 128 }),
    Object.freeze({ type: "null" })
  ])
});

/** Strict JSON Schema for OpenAI structured completions (`additionalProperties: false`). */
export const SCENE_PARTNER_TURN_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze([
    "schemaId",
    "thinkingSteps",
    "assistantMessage",
    "phase",
    "matchedSceneId",
    "proseDraft",
    "actions",
    "imagePrompt"
  ]),
  properties: Object.freeze({
    schemaId: Object.freeze({
      type: "string",
      const: SCENE_PARTNER_TURN_V1_SCHEMA_ID
    }),
    thinkingSteps: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: Object.freeze({ type: "string", minLength: 1, maxLength: 80 })
    }),
    assistantMessage: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: 4_000
    }),
    phase: Object.freeze({ type: "string", enum: PHASES }),
    matchedSceneId: nullableSceneId,
    proseDraft: nullableString,
    actions: Object.freeze({
      type: "array",
      minItems: 0,
      maxItems: 2,
      items: Object.freeze({ type: "string", enum: ACTIONS })
    }),
    imagePrompt: nullableString
  })
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      `${field} must be a string.`
    );
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      `${field} length is out of bounds.`
    );
  }
  return normalized;
}

function optionalNullableString(
  value: unknown,
  field: string,
  max: number
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireNonEmptyString(value, field, max);
}

function parsePhase(value: unknown): ScenePartnerTurnPhase {
  if (typeof value !== "string" || !(PHASES as readonly string[]).includes(value)) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Scene Partner phase is invalid."
    );
  }
  return value as ScenePartnerTurnPhase;
}

function parseAction(value: unknown, index: number): ScenePartnerTurnAction {
  if (typeof value !== "string" || !(ACTIONS as readonly string[]).includes(value)) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      `Scene Partner action ${index + 1} is invalid.`
    );
  }
  return value as ScenePartnerTurnAction;
}

export function validateScenePartnerTurnV1(value: unknown): ScenePartnerTurnV1 {
  if (!isPlainObject(value)) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Scene Partner turn payload must be an object."
    );
  }

  const allowed = new Set([
    "schemaId",
    "thinkingSteps",
    "assistantMessage",
    "phase",
    "matchedSceneId",
    "proseDraft",
    "actions",
    "imagePrompt"
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new DomainValidationError(
        "INVALID_AGENT_OUTPUT",
        "Scene Partner turn payload includes unexpected fields."
      );
    }
  }

  if (value.schemaId !== SCENE_PARTNER_TURN_V1_SCHEMA_ID) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Scene Partner turn schema identifier is invalid."
    );
  }

  if (!Array.isArray(value.thinkingSteps)) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Thinking steps must be an array."
    );
  }
  if (value.thinkingSteps.length < 1 || value.thinkingSteps.length > 6) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Thinking step count is out of bounds."
    );
  }
  const thinkingSteps = Object.freeze(
    value.thinkingSteps.map((step, index) =>
      requireNonEmptyString(step, `Thinking step ${index + 1}`, 80)
    )
  );

  const assistantMessage = requireNonEmptyString(
    value.assistantMessage,
    "Assistant message",
    4_000
  );
  const phase = parsePhase(value.phase);

  if (!Array.isArray(value.actions)) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Actions must be an array."
    );
  }
  if (value.actions.length > 2) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Action count is out of bounds."
    );
  }
  const seen = new Set<string>();
  const actions = Object.freeze(
    value.actions.map((action, index) => {
      const parsed = parseAction(action, index);
      if (seen.has(parsed)) {
        throw new DomainValidationError(
          "INVALID_AGENT_OUTPUT",
          "Actions must be unique."
        );
      }
      seen.add(parsed);
      return parsed;
    })
  );

  const matchedSceneId = optionalNullableString(value.matchedSceneId, "Matched scene id", 128);
  const proseDraft = optionalNullableString(value.proseDraft, "Prose draft", 8_000);
  const imagePrompt = optionalNullableString(value.imagePrompt, "Image prompt", 8_000);

  return Object.freeze({
    schemaId: SCENE_PARTNER_TURN_V1_SCHEMA_ID,
    thinkingSteps,
    assistantMessage,
    phase,
    ...(matchedSceneId === undefined ? {} : { matchedSceneId }),
    ...(proseDraft === undefined ? {} : { proseDraft }),
    actions,
    ...(imagePrompt === undefined ? {} : { imagePrompt })
  });
}

export function isScenePartnerTurnV1(value: unknown): value is ScenePartnerTurnV1 {
  try {
    validateScenePartnerTurnV1(value);
    return true;
  } catch {
    return false;
  }
}
