import {
  DomainValidationError,
  sceneId,
  storyKnowledgeId,
  type SceneId,
  type StoryKnowledgeId
} from "./domain.js";

export type SketchFieldsV1 = Readonly<{
  schemaId: "sketch-fields-v1";
  purpose?: string;
  conflict?: string;
  turn?: string;
  sensoryNotes?: string;
  openQuestions?: string;
  detail?: string;
}>;

export type CharacterSheetFieldsV1 = Readonly<{
  schemaId: "character-sheet-v1";
  storyKnowledgeId: StoryKnowledgeId;
  desire?: string;
  pressure?: string;
  voiceNotes?: string;
}>;

export type BackdropFieldsV1 = Readonly<{
  schemaId: "backdrop-fields-v1";
  sceneId?: SceneId;
  caption?: string;
  sensoryNotesFallback?: string;
}>;

export type CraftPartnerPayload =
  | SketchFieldsV1
  | CharacterSheetFieldsV1
  | BackdropFieldsV1;

export const SKETCH_FIELDS_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaId"],
  properties: Object.freeze({
    schemaId: Object.freeze({ type: "string", const: "sketch-fields-v1" }),
    purpose: Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 }),
    conflict: Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 }),
    turn: Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 }),
    sensoryNotes: Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 }),
    openQuestions: Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 }),
    detail: Object.freeze({ type: "string", minLength: 1, maxLength: 8_000 })
  })
});

export const CHARACTER_SHEET_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaId", "storyKnowledgeId"],
  properties: Object.freeze({
    schemaId: Object.freeze({ type: "string", const: "character-sheet-v1" }),
    storyKnowledgeId: Object.freeze({ type: "string", minLength: 1, maxLength: 128 }),
    desire: Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 }),
    pressure: Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 }),
    voiceNotes: Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 })
  })
});

export const BACKDROP_FIELDS_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaId"],
  properties: Object.freeze({
    schemaId: Object.freeze({ type: "string", const: "backdrop-fields-v1" }),
    sceneId: Object.freeze({ type: "string", minLength: 1, maxLength: 128 }),
    caption: Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 }),
    sensoryNotesFallback: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: 2_000
    })
  })
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalBoundedField(
  value: unknown,
  field: string,
  max: number
): string | undefined {
  if (value === undefined) return undefined;
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

function requireIdString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      `${field} must be a string.`
    );
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      `${field} length is out of bounds.`
    );
  }
  return normalized;
}

export function validateSketchFieldsV1(value: unknown): SketchFieldsV1 {
  if (!isPlainObject(value)) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Sketch fields payload must be an object."
    );
  }
  if (value.schemaId !== "sketch-fields-v1") {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Sketch fields schema identifier is invalid."
    );
  }
  const allowed = new Set([
    "schemaId",
    "purpose",
    "conflict",
    "turn",
    "sensoryNotes",
    "openQuestions",
    "detail"
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new DomainValidationError(
        "INVALID_AGENT_OUTPUT",
        "Sketch fields payload includes unexpected fields."
      );
    }
  }
  const purpose = optionalBoundedField(value.purpose, "Purpose", 2_000);
  const conflict = optionalBoundedField(value.conflict, "Conflict", 2_000);
  const turn = optionalBoundedField(value.turn, "Turn", 2_000);
  const sensoryNotes = optionalBoundedField(value.sensoryNotes, "Sensory notes", 2_000);
  const openQuestions = optionalBoundedField(
    value.openQuestions,
    "Open questions",
    2_000
  );
  const detail = optionalBoundedField(value.detail, "Detail", 8_000);
  const payload = Object.freeze({
    schemaId: "sketch-fields-v1" as const,
    ...(purpose === undefined ? {} : { purpose }),
    ...(conflict === undefined ? {} : { conflict }),
    ...(turn === undefined ? {} : { turn }),
    ...(sensoryNotes === undefined ? {} : { sensoryNotes }),
    ...(openQuestions === undefined ? {} : { openQuestions }),
    ...(detail === undefined ? {} : { detail })
  });
  if (Object.keys(payload).length === 1) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Sketch fields payload must include at least one craft field."
    );
  }
  return payload;
}

export function validateCharacterSheetFieldsV1(
  value: unknown
): CharacterSheetFieldsV1 {
  if (!isPlainObject(value)) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Character sheet payload must be an object."
    );
  }
  if (value.schemaId !== "character-sheet-v1") {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Character sheet schema identifier is invalid."
    );
  }
  const allowed = new Set([
    "schemaId",
    "storyKnowledgeId",
    "desire",
    "pressure",
    "voiceNotes"
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new DomainValidationError(
        "INVALID_AGENT_OUTPUT",
        "Character sheet payload includes unexpected fields."
      );
    }
  }
  const desire = optionalBoundedField(value.desire, "Desire", 2_000);
  const pressure = optionalBoundedField(value.pressure, "Pressure", 2_000);
  const voiceNotes = optionalBoundedField(value.voiceNotes, "Voice notes", 2_000);
  const payload = Object.freeze({
    schemaId: "character-sheet-v1" as const,
    storyKnowledgeId: storyKnowledgeId(
      requireIdString(value.storyKnowledgeId, "Story knowledge id")
    ),
    ...(desire === undefined ? {} : { desire }),
    ...(pressure === undefined ? {} : { pressure }),
    ...(voiceNotes === undefined ? {} : { voiceNotes })
  });
  if (
    payload.desire === undefined &&
    payload.pressure === undefined &&
    payload.voiceNotes === undefined
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Character sheet payload must include at least one sheet field."
    );
  }
  return payload;
}

export function validateBackdropFieldsV1(value: unknown): BackdropFieldsV1 {
  if (!isPlainObject(value)) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Backdrop fields payload must be an object."
    );
  }
  if (value.schemaId !== "backdrop-fields-v1") {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Backdrop fields schema identifier is invalid."
    );
  }
  const allowed = new Set([
    "schemaId",
    "sceneId",
    "caption",
    "sensoryNotesFallback"
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new DomainValidationError(
        "INVALID_AGENT_OUTPUT",
        "Backdrop fields payload includes unexpected fields."
      );
    }
  }
  const caption = optionalBoundedField(value.caption, "Caption", 2_000);
  const sensoryNotesFallback = optionalBoundedField(
    value.sensoryNotesFallback,
    "Sensory notes fallback",
    2_000
  );
  const resolvedSceneId =
    value.sceneId === undefined
      ? undefined
      : sceneId(requireIdString(value.sceneId, "Scene id"));
  const payload = Object.freeze({
    schemaId: "backdrop-fields-v1" as const,
    ...(resolvedSceneId === undefined ? {} : { sceneId: resolvedSceneId }),
    ...(caption === undefined ? {} : { caption }),
    ...(sensoryNotesFallback === undefined ? {} : { sensoryNotesFallback })
  });
  if (
    payload.caption === undefined &&
    payload.sensoryNotesFallback === undefined
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Backdrop fields payload must include caption or sensory notes."
    );
  }
  return payload;
}

export function isSketchFieldsV1(value: unknown): value is SketchFieldsV1 {
  try {
    validateSketchFieldsV1(value);
    return true;
  } catch {
    return false;
  }
}

export function isCharacterSheetFieldsV1(
  value: unknown
): value is CharacterSheetFieldsV1 {
  try {
    validateCharacterSheetFieldsV1(value);
    return true;
  } catch {
    return false;
  }
}

export function isBackdropFieldsV1(value: unknown): value is BackdropFieldsV1 {
  try {
    validateBackdropFieldsV1(value);
    return true;
  } catch {
    return false;
  }
}

export function validateCraftPartnerPayload(
  outputSchemaId: CraftPartnerPayload["schemaId"],
  value: unknown
): CraftPartnerPayload {
  switch (outputSchemaId) {
    case "sketch-fields-v1":
      return validateSketchFieldsV1(value);
    case "character-sheet-v1":
      return validateCharacterSheetFieldsV1(value);
    case "backdrop-fields-v1":
      return validateBackdropFieldsV1(value);
    default: {
      const _exhaustive: never = outputSchemaId;
      return _exhaustive;
    }
  }
}
