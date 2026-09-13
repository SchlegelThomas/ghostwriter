import { describe, expect, it } from "vitest";
import {
  agentProposalId,
  instructionContentHash,
  SCENE_DRAFT_V1_MAX_PROSE_CHARS,
  sceneId,
  validateSceneDraftV1
} from "@ghostwriter/core";
import {
  applySceneReviewRevisionPrefill,
  sameSceneReviewArtifact,
  sceneReviewHasEdits,
  sceneReviewPayload,
  sceneReviewSourceCoverage,
  shouldApplySceneReviewRevisionPrefill
} from "./scene-story-work-review.js";

const firstScene = sceneId("scene-source-first");
const secondScene = sceneId("scene-source-second");
const payload = validateSceneDraftV1({
  schemaId: "scene-draft-v1",
  prose: "  The opening line keeps its deliberate space.\nSecond line.  ",
  sourceSceneIds: [firstScene, secondScene]
});

describe("scene story work review presentation", () => {
  it("preserves literal prose and the exact immutable source selection", () => {
    const prose = "  Revised opening.\n\nThe ending keeps its space.  ";
    const result = sceneReviewPayload(prose, payload);

    expect(result.prose).toBe(prose);
    expect(result.sourceSceneIds).toEqual([firstScene, secondScene]);
    expect(sceneReviewHasEdits(prose, payload)).toBe(true);
    expect(sceneReviewHasEdits(result.prose, result)).toBe(false);
  });

  it("refuses empty or oversized prose through the canonical validator", () => {
    expect(() => sceneReviewPayload("   ", payload)).toThrow();
    expect(() =>
      sceneReviewPayload("x".repeat(SCENE_DRAFT_V1_MAX_PROSE_CHARS + 1), payload)
    ).toThrow();
  });

  it("fences review state by the complete artifact pointer", () => {
    const pointer = {
      proposalId: agentProposalId("proposal-scene-review"),
      artifactVersion: 2,
      contentHash: instructionContentHash("a".repeat(64))
    };
    expect(sameSceneReviewArtifact(pointer, { ...pointer })).toBe(true);
    expect(
      sameSceneReviewArtifact(pointer, {
        ...pointer,
        proposalId: agentProposalId("proposal-scene-review-other")
      })
    ).toBe(false);
    expect(
      sameSceneReviewArtifact(pointer, { ...pointer, artifactVersion: 3 })
    ).toBe(false);
    expect(
      sameSceneReviewArtifact(pointer, {
        ...pointer,
        contentHash: instructionContentHash("b".repeat(64))
      })
    ).toBe(false);
  });

  it("gates revision prefill by token and refuses clobbering writer text", () => {
    expect(shouldApplySceneReviewRevisionPrefill(undefined, "token-a")).toBe(true);
    expect(shouldApplySceneReviewRevisionPrefill("token-a", "token-a")).toBe(false);
    expect(shouldApplySceneReviewRevisionPrefill("token-a", "   ")).toBe(false);
    expect(
      applySceneReviewRevisionPrefill({
        instruction: "  Tighten the harbor beat.  ",
        currentInstruction: ""
      })
    ).toEqual({ action: "install", instruction: "Tighten the harbor beat." });
    expect(
      applySceneReviewRevisionPrefill({
        instruction: "   ",
        currentInstruction: ""
      }).action
    ).toBe("refuse");
    expect(
      applySceneReviewRevisionPrefill({
        instruction: "x".repeat(20_001),
        currentInstruction: ""
      }).action
    ).toBe("refuse");
    expect(
      applySceneReviewRevisionPrefill({
        instruction: "New suggestion",
        currentInstruction: "Writer draft"
      })
    ).toMatchObject({ action: "refuse" });
  });

  it("shows source coverage in artifact order and marks unavailable labels", () => {
    expect(
      sceneReviewSourceCoverage(payload, [
        { sceneId: secondScene, title: "Second source" },
        { sceneId: firstScene, title: "First source" }
      ])
    ).toEqual([
      { sceneId: firstScene, title: "First source", available: true },
      { sceneId: secondScene, title: "Second source", available: true }
    ]);
    expect(
      sceneReviewSourceCoverage(payload, [
        { sceneId: firstScene, title: "First source" }
      ])[1]
    ).toEqual({
      sceneId: secondScene,
      title: String(secondScene),
      available: false
    });
  });
});
