import { describe, expect, it } from "vitest";
import { agentProposalId, instructionContentHash, sceneId, validateCharacterCreateV2 } from "@ghostwriter/core";
import { characterReviewFields, characterReviewHasEdits, characterReviewPayload, sameCharacterReviewArtifact } from "./character-story-work-review.js";

const payload = validateCharacterCreateV2({
  schemaId: "character-create-v2", name: "Mara", summary: "A keeper of undelivered letters.",
  aliases: ["The keeper"], characterSheet: { desire: "Find the intended reader", pressure: "The last ship leaves tonight", voiceNotes: "Precise, guarded" },
  sourceSceneIds: [sceneId("scene-letter")]
});

describe("character review", () => {
  it("preserves the full dossier and server-authorized scene links when editing one field", () => {
    const fields = { ...characterReviewFields(payload), desire: "Deliver the letter before dawn" };
    const result = characterReviewPayload(fields, payload);
    expect(result.characterSheet).toEqual({ ...payload.characterSheet, desire: fields.desire });
    expect(result.sourceSceneIds).toEqual(payload.sourceSceneIds);
    expect(result.aliases).toEqual(payload.aliases);
    expect(characterReviewHasEdits(fields, payload)).toBe(true);
    expect(characterReviewHasEdits(characterReviewFields(result), result)).toBe(false);
  });
  it("refuses invalid review input instead of silently dropping required content", () => {
    expect(() => characterReviewPayload({ ...characterReviewFields(payload), name: " " }, payload)).toThrow();
    expect(() => characterReviewPayload({ ...characterReviewFields(payload), aliases: "Mara\nMara" }, payload)).toThrow();
  });
  it("fences a review by proposal, version, and hash even when content repeats", () => {
    const pointer = { proposalId: agentProposalId("proposal-one"), artifactVersion: 1, contentHash: instructionContentHash("a".repeat(64)) };
    expect(sameCharacterReviewArtifact(pointer, { ...pointer })).toBe(true);
    expect(sameCharacterReviewArtifact(pointer, { ...pointer, proposalId: agentProposalId("proposal-two") })).toBe(false);
    expect(sameCharacterReviewArtifact(pointer, { ...pointer, artifactVersion: 2 })).toBe(false);
    expect(sameCharacterReviewArtifact(pointer, { ...pointer, contentHash: instructionContentHash("b".repeat(64)) })).toBe(false);
  });
});
