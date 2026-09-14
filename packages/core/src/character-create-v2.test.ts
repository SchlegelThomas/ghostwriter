import { describe, expect, it } from "vitest";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import { instructionContentHash } from "./agent-domain.js";
import {
  computeAgentProposalContentHash,
  createReadyAgentProposal,
  validateAgentProposalPayload
} from "./agent-runs-proposals.js";
import {
  CHARACTER_CREATE_V2_MAX_ALIASES,
  CHARACTER_CREATE_V2_MAX_SOURCE_SCENES,
  isCharacterCreateV2,
  validateCharacterCreateV2
} from "./character-create-v2.js";
import {
  agentProposalId,
  agentRunId,
  contextReceiptId,
  createStoryKnowledge,
  projectId,
  storyKnowledgeId
} from "./domain.js";
import { agentProposalListPreviewFromPayload } from "./agent-proposal-list-preview.js";

const payload = {
  schemaId: "character-create-v2",
  name: "Mara Vale",
  summary: "A harbor pilot torn between her found family and the truth.",
  aliases: ["Mara", "The Night Pilot"],
  characterSheet: {
    desire: "Keep the harbor families safe.",
    pressure: "Her brother sold their route to the occupying navy.",
    voiceNotes: "Precise nautical language; jokes only when frightened."
  },
  sourceSceneIds: ["scene-arrival", "scene-betrayal"]
} as const;

describe("character-create-v2", () => {
  it("round-trips every generated field into the existing Cast domain", () => {
    const generated = validateCharacterCreateV2(payload);
    const reservedId = storyKnowledgeId("knowledge-reserved-mara");
    const castRecord = createStoryKnowledge({
      id: reservedId,
      projectId: projectId("project-character"),
      label: generated.name,
      kind: "character",
      authority: "planned",
      notes: generated.summary,
      aliases: generated.aliases,
      characterSheet: generated.characterSheet,
      linkedSceneIds: generated.sourceSceneIds ?? [],
      linkedKnowledge: []
    });

    expect(castRecord).toMatchObject({
      id: reservedId,
      label: payload.name,
      notes: payload.summary,
      aliases: payload.aliases,
      characterSheet: payload.characterSheet,
      linkedSceneIds: payload.sourceSceneIds
    });
    expect(isCharacterCreateV2(generated)).toBe(true);
    expect("storyKnowledgeId" in generated).toBe(false);
  });

  it("strictly rejects schema mismatch, unknown fields, bad bounds, and target overrides", () => {
    expect(() =>
      validateCharacterCreateV2({ ...payload, schemaId: "character-create-v1" })
    ).toThrow(/schema identifier/i);
    expect(() => validateCharacterCreateV2({ ...payload, temperament: "stormy" }))
      .toThrow(/unexpected or missing fields/i);
    expect(() =>
      validateCharacterCreateV2({
        ...payload,
        characterSheet: { ...payload.characterSheet, age: "thirty" }
      })
    ).toThrow(/unexpected or missing fields/i);
    expect(() =>
      validateCharacterCreateV2({
        ...payload,
        storyKnowledgeId: "provider-selected-target"
      })
    ).toThrow(/unexpected or missing fields/i);
    expect(() =>
      validateCharacterCreateV2({
        ...payload,
        aliases: Array.from(
          { length: CHARACTER_CREATE_V2_MAX_ALIASES + 1 },
          (_, index) => `Alias ${index}`
        )
      })
    ).toThrow(/at most 32/i);
    expect(() =>
      validateCharacterCreateV2({
        ...payload,
        sourceSceneIds: Array.from(
          { length: CHARACTER_CREATE_V2_MAX_SOURCE_SCENES + 1 },
          (_, index) => `scene-${index}`
        )
      })
    ).toThrow(/at most 32/i);
    expect(() =>
      validateCharacterCreateV2({ ...payload, characterSheet: {} })
    ).toThrow(/at least one/i);
    expect(() =>
      validateCharacterCreateV2({
        ...payload,
        sourceSceneIds: ["scene-one", " scene-one "]
      })
    ).toThrow(/duplicates/i);
    expect(() =>
      validateAgentProposalPayload("story-knowledge-create-v1", payload)
    ).toThrow(/unexpected or missing fields|schema identifier/i);
  });

  it("binds the exact character payload hash to the server-owned proposal target", async () => {
    const canonicalInputs: string[] = [];
    const hashPort = {
      async digestSha256Hex(value: string) {
        canonicalInputs.push(value);
        return "f".repeat(64);
      }
    };
    const primaryTarget = {
      kind: "story-knowledge" as const,
      id: "knowledge-reserved-mara"
    };
    const validated = validateCharacterCreateV2(payload);
    const contentHash = await computeAgentProposalContentHash(
      {
        outputSchemaId: "character-create-v2",
        payload: validated,
        primaryTarget
      },
      hashPort
    );
    expect(canonicalInputs).toEqual([
      canonicalJsonStringify({
        outputSchemaId: "character-create-v2",
        payload: validated,
        primaryTarget
      })
    ]);

    const proposal = createReadyAgentProposal({
      id: agentProposalId("proposal-character-mara"),
      projectId: projectId("project-character"),
      runId: agentRunId("run-character-mara"),
      receiptId: contextReceiptId("receipt-character-mara"),
      status: "ready",
      outputSchemaId: "character-create-v2",
      payload: validated,
      contentHash,
      primaryTarget,
      createdAt: "2026-09-12T20:00:00.000Z",
      updatedAt: "2026-09-12T20:00:00.000Z"
    });
    expect(proposal.payload).toEqual(validated);
    expect(proposal.contentHash).toBe(instructionContentHash("f".repeat(64)));
    expect(proposal.primaryTarget).toEqual(primaryTarget);
    expect(agentProposalListPreviewFromPayload(proposal.outputSchemaId, proposal.payload))
      .toEqual({ title: payload.name, summary: payload.summary });
  });
});
