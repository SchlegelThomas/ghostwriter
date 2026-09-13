import { describe, expect, it } from "vitest";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import {
  computeAgentProposalContentHash,
  createReadyAgentProposal,
  validateAgentProposalPayload
} from "./agent-runs-proposals.js";
import { agentProposalListPreviewFromPayload } from "./agent-proposal-list-preview.js";
import {
  SCENE_DRAFT_V1_MAX_PROSE_CHARS,
  SCENE_DRAFT_V1_MAX_SOURCE_SCENES,
  isSceneDraftV1,
  validateSceneDraftV1
} from "./scene-draft-v1.js";
import {
  agentProposalId,
  agentRunId,
  contextReceiptId,
  projectId,
  sceneId
} from "./domain.js";

const payload = Object.freeze({
  schemaId: "scene-draft-v1" as const,
  prose: "  The lamp guttered.\nMara kept the letter closed.  ",
  sourceSceneIds: Object.freeze(["scene-arrival", "scene-warning"])
});

describe("scene-draft-v1", () => {
  it("preserves exact provisional prose and normalizes bounded source IDs", () => {
    const draft = validateSceneDraftV1(payload);
    expect(draft.prose).toBe(payload.prose);
    expect(draft.sourceSceneIds).toEqual([
      sceneId("scene-arrival"),
      sceneId("scene-warning")
    ]);
    expect(isSceneDraftV1(draft)).toBe(true);
    expect("sceneId" in draft).toBe(false);
  });

  it("strictly rejects missing, extra, duplicate, target, and over-bound fields", () => {
    expect(() => validateSceneDraftV1({ ...payload, schemaId: "scene-draft-v0" }))
      .toThrow(/schema identifier/i);
    expect(() => validateSceneDraftV1({ ...payload, destinationSceneId: "scene-model" }))
      .toThrow(/unexpected or missing/i);
    expect(() => validateSceneDraftV1({ schemaId: "scene-draft-v1", prose: "Draft" }))
      .toThrow(/unexpected or missing/i);
    expect(() => validateSceneDraftV1({ ...payload, prose: " \n " }))
      .toThrow(/prose length/i);
    expect(() => validateSceneDraftV1({
      ...payload,
      prose: "x".repeat(SCENE_DRAFT_V1_MAX_PROSE_CHARS + 1)
    })).toThrow(/prose length/i);
    expect(() => validateSceneDraftV1({
      ...payload,
      sourceSceneIds: ["scene-one", " scene-one "]
    })).toThrow(/duplicates/i);
    expect(() => validateSceneDraftV1({
      ...payload,
      sourceSceneIds: Array.from(
        { length: SCENE_DRAFT_V1_MAX_SOURCE_SCENES + 1 },
        (_, index) => `scene-${index}`
      )
    })).toThrow(/at most 32/i);
  });

  it("binds the payload hash to the server-owned scene proposal target", async () => {
    const canonicalInputs: string[] = [];
    const hashPort = {
      async digestSha256Hex(value: string) {
        canonicalInputs.push(value);
        return "a".repeat(64);
      }
    };
    const primaryTarget = { kind: "scene" as const, id: "scene-reserved" };
    const validated = validateAgentProposalPayload("scene-draft-v1", payload);
    const contentHash = await computeAgentProposalContentHash(
      { outputSchemaId: "scene-draft-v1", payload: validated, primaryTarget },
      hashPort
    );
    expect(canonicalInputs).toEqual([
      canonicalJsonStringify({
        outputSchemaId: "scene-draft-v1",
        payload: validated,
        primaryTarget
      })
    ]);
    const proposal = createReadyAgentProposal({
      id: agentProposalId("proposal-scene-draft"),
      projectId: projectId("project-scene-draft"),
      runId: agentRunId("run-scene-draft"),
      receiptId: contextReceiptId("receipt-scene-draft"),
      status: "ready",
      outputSchemaId: "scene-draft-v1",
      payload: validated,
      contentHash,
      primaryTarget,
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z"
    });
    expect(proposal.primaryTarget).toEqual(primaryTarget);
    expect(agentProposalListPreviewFromPayload(
      proposal.outputSchemaId,
      proposal.payload
    )).toEqual({ summary: "The lamp guttered.\nMara kept the letter closed." });
  });
});
