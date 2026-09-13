import {
  validateCharacterCreateV2,
  type CharacterCreateV2,
  type StoryWorkArtifactPointer
} from "@ghostwriter/core";

export type CharacterReviewArtifact = Readonly<{
  pointer: StoryWorkArtifactPointer;
  payload: CharacterCreateV2;
}>;

export type CharacterReviewFields = Readonly<{
  name: string;
  summary: string;
  aliases: string;
  desire: string;
  pressure: string;
  voiceNotes: string;
}>;

export function characterReviewFields(payload: CharacterCreateV2): CharacterReviewFields {
  return {
    name: payload.name,
    summary: payload.summary,
    aliases: payload.aliases.join("\n"),
    desire: payload.characterSheet.desire ?? "",
    pressure: payload.characterSheet.pressure ?? "",
    voiceNotes: payload.characterSheet.voiceNotes ?? ""
  };
}

export function characterReviewPayload(
  fields: CharacterReviewFields,
  original: CharacterCreateV2
): CharacterCreateV2 {
  return validateCharacterCreateV2({
    schemaId: "character-create-v2",
    name: fields.name,
    summary: fields.summary,
    aliases: fields.aliases.split("\n").map((alias) => alias.trim()).filter(Boolean),
    characterSheet: {
      ...(fields.desire.trim() ? { desire: fields.desire } : {}),
      ...(fields.pressure.trim() ? { pressure: fields.pressure } : {}),
      ...(fields.voiceNotes.trim() ? { voiceNotes: fields.voiceNotes } : {})
    },
    ...(original.sourceSceneIds === undefined ? {} : { sourceSceneIds: original.sourceSceneIds })
  });
}

export function sameCharacterReviewArtifact(
  left: StoryWorkArtifactPointer,
  right: StoryWorkArtifactPointer
): boolean {
  return left.proposalId === right.proposalId &&
    left.artifactVersion === right.artifactVersion && left.contentHash === right.contentHash;
}

export function characterReviewHasEdits(fields: CharacterReviewFields, payload: CharacterCreateV2): boolean {
  const original = characterReviewFields(payload);
  return (Object.keys(original) as (keyof CharacterReviewFields)[]).some((key) => original[key] !== fields[key]);
}
