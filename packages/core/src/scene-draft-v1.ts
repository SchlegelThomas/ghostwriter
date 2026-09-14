import { DomainValidationError, sceneId, type SceneId } from "./domain.js";

export const SCENE_DRAFT_V1_MAX_PROSE_CHARS = 24_000;
export const SCENE_DRAFT_V1_MAX_SOURCE_SCENES = 32;

export type SceneDraftV1 = Readonly<{
  schemaId: "scene-draft-v1";
  /** Exact provisional prose. Canonical scene block IDs are created by the server on apply. */
  prose: string;
  /** References to the selected scene sources only; never a destination. */
  sourceSceneIds: readonly SceneId[];
}>;

export const SCENE_DRAFT_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["schemaId", "prose", "sourceSceneIds"]),
  properties: Object.freeze({
    schemaId: Object.freeze({ type: "string", const: "scene-draft-v1" }),
    prose: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: SCENE_DRAFT_V1_MAX_PROSE_CHARS
    }),
    sourceSceneIds: Object.freeze({
      type: "array",
      maxItems: SCENE_DRAFT_V1_MAX_SOURCE_SCENES,
      uniqueItems: true,
      items: Object.freeze({ type: "string", minLength: 1, maxLength: 128 })
    })
  })
});

function invalid(message: string): never {
  throw new DomainValidationError("INVALID_AGENT_OUTPUT", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSceneDraftV1(value: unknown): SceneDraftV1 {
  if (!isPlainObject(value)) invalid("Scene draft payload must be an object.");
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.includes("schemaId") ||
    !keys.includes("prose") ||
    !keys.includes("sourceSceneIds")
  ) {
    invalid("Scene draft payload includes unexpected or missing fields.");
  }
  if (value.schemaId !== "scene-draft-v1") {
    invalid("Scene draft schema identifier is invalid.");
  }
  if (
    typeof value.prose !== "string" ||
    value.prose.trim().length === 0 ||
    value.prose.length > SCENE_DRAFT_V1_MAX_PROSE_CHARS
  ) {
    invalid("Scene draft prose length is out of bounds.");
  }
  if (
    !Array.isArray(value.sourceSceneIds) ||
    value.sourceSceneIds.length > SCENE_DRAFT_V1_MAX_SOURCE_SCENES
  ) {
    invalid(
      `Scene draft source scene IDs must be an array of at most ${SCENE_DRAFT_V1_MAX_SOURCE_SCENES} items.`
    );
  }
  const sourceSceneIds = value.sourceSceneIds.map((candidate) => {
    if (typeof candidate !== "string") {
      invalid("Scene draft source scene IDs must be strings.");
    }
    const normalized = candidate.trim();
    if (normalized.length === 0 || normalized.length > 128) {
      invalid("Scene draft source scene ID length is out of bounds.");
    }
    return sceneId(normalized);
  });
  if (new Set(sourceSceneIds).size !== sourceSceneIds.length) {
    invalid("Scene draft source scene IDs must not contain duplicates.");
  }
  return Object.freeze({
    schemaId: "scene-draft-v1",
    prose: value.prose,
    sourceSceneIds: Object.freeze(sourceSceneIds)
  });
}

export function isSceneDraftV1(value: unknown): value is SceneDraftV1 {
  try {
    validateSceneDraftV1(value);
    return true;
  } catch {
    return false;
  }
}
