import {
  DomainValidationError,
  createCharacterSheet,
  sceneId,
  type CharacterSheet,
  type SceneId
} from "./domain.js";

export const CHARACTER_CREATE_V2_MAX_ALIASES = 32;
export const CHARACTER_CREATE_V2_MAX_SOURCE_SCENES = 32;

export type CharacterCreateV2 = Readonly<{
  schemaId: "character-create-v2";
  name: string;
  summary: string;
  aliases: readonly string[];
  characterSheet: CharacterSheet;
  /** Proposed links only. A service must verify membership in the current project. */
  sourceSceneIds?: readonly SceneId[];
}>;

const boundedText = (maxLength: number) =>
  Object.freeze({ type: "string", minLength: 1, maxLength });

export const CHARACTER_CREATE_V2_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaId", "name", "summary", "aliases", "characterSheet"],
  properties: Object.freeze({
    schemaId: Object.freeze({ type: "string", const: "character-create-v2" }),
    name: boundedText(120),
    summary: boundedText(4_000),
    aliases: Object.freeze({
      type: "array",
      maxItems: CHARACTER_CREATE_V2_MAX_ALIASES,
      uniqueItems: true,
      items: boundedText(120)
    }),
    characterSheet: Object.freeze({
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: Object.freeze({
        desire: boundedText(2_000),
        pressure: boundedText(2_000),
        voiceNotes: boundedText(2_000)
      }),
      anyOf: Object.freeze([
        Object.freeze({ required: ["desire"] }),
        Object.freeze({ required: ["pressure"] }),
        Object.freeze({ required: ["voiceNotes"] })
      ])
    }),
    sourceSceneIds: Object.freeze({
      type: "array",
      maxItems: CHARACTER_CREATE_V2_MAX_SOURCE_SCENES,
      uniqueItems: true,
      items: boundedText(128)
    })
  })
});

function invalid(message: string): never {
  throw new DomainValidationError("INVALID_AGENT_OUTPUT", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    invalid("Character create payload includes unexpected or missing fields.");
  }
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") invalid(`${field} must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    invalid(`${field} length is out of bounds.`);
  }
  return normalized;
}

function stringList(
  value: unknown,
  field: string,
  maximumItems: number,
  itemMaximum: number
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    invalid(`${field} must be an array of at most ${maximumItems} items.`);
  }
  const normalized = value.map((item) => text(item, `${field} item`, itemMaximum));
  if (new Set(normalized).size !== normalized.length) {
    invalid(`${field} must not contain duplicates.`);
  }
  return Object.freeze(normalized);
}

function characterSheet(value: unknown): CharacterSheet {
  if (!isPlainObject(value)) invalid("Character sheet must be an object.");
  requireExactKeys(value, [], ["desire", "pressure", "voiceNotes"]);
  const normalized = {
    ...(value.desire === undefined
      ? {}
      : { desire: text(value.desire, "Character desire", 2_000) }),
    ...(value.pressure === undefined
      ? {}
      : { pressure: text(value.pressure, "Character pressure", 2_000) }),
    ...(value.voiceNotes === undefined
      ? {}
      : { voiceNotes: text(value.voiceNotes, "Character voice notes", 2_000) })
  };
  try {
    return createCharacterSheet(normalized);
  } catch {
    invalid("Character sheet must include at least one bounded field.");
  }
}

export function validateCharacterCreateV2(value: unknown): CharacterCreateV2 {
  if (!isPlainObject(value)) invalid("Character create payload must be an object.");
  requireExactKeys(
    value,
    ["schemaId", "name", "summary", "aliases", "characterSheet"],
    ["sourceSceneIds"]
  );
  if (value.schemaId !== "character-create-v2") {
    invalid("Character create schema identifier is invalid.");
  }
  const aliases = stringList(
    value.aliases,
    "Character aliases",
    CHARACTER_CREATE_V2_MAX_ALIASES,
    120
  );
  const sourceSceneIds =
    value.sourceSceneIds === undefined
      ? undefined
      : stringList(
          value.sourceSceneIds,
          "Character source scene IDs",
          CHARACTER_CREATE_V2_MAX_SOURCE_SCENES,
          128
        ).map(sceneId);
  return Object.freeze({
    schemaId: "character-create-v2",
    name: text(value.name, "Character name", 120),
    summary: text(value.summary, "Character summary", 4_000),
    aliases,
    characterSheet: characterSheet(value.characterSheet),
    ...(sourceSceneIds === undefined
      ? {}
      : { sourceSceneIds: Object.freeze(sourceSceneIds) })
  });
}

export function isCharacterCreateV2(value: unknown): value is CharacterCreateV2 {
  try {
    validateCharacterCreateV2(value);
    return true;
  } catch {
    return false;
  }
}
