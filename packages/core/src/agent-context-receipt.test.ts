import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import {
  assembleProposalArtifactContextResource
} from "./agent-context-receipt.js";
import { instructionContentHash } from "./agent-domain.js";
import {
  computeAgentProposalContentHash,
  validateAgentProposalPayload
} from "./agent-runs-proposals.js";
import {
  agentProposalId,
  projectId,
  sceneId
} from "./domain.js";
import { storyWorkAssignmentId } from "./story-work-assignment.js";

const hashPort = {
  async digestSha256Hex(text: string): Promise<string> {
    return createHash("sha256").update(text).digest("hex");
  }
};

const PROJECT = projectId("project-proposal-receipt");
const ASSIGNMENT = storyWorkAssignmentId("assignment-scene-draft");
const PROPOSAL = agentProposalId("proposal-scene-draft");
const TARGET = sceneId("scene-assess-target");

const draft = Object.freeze({
  schemaId: "scene-draft-v1" as const,
  prose: "Harbor draft prose for continuity review.",
  sourceSceneIds: Object.freeze([sceneId("scene-context-source")])
});

async function draftPayloadContentHash() {
  return instructionContentHash(
    await hashPort.digestSha256Hex(canonicalJsonStringify(draft))
  );
}

async function fullProposalArtifactContentHash() {
  const payload = validateAgentProposalPayload("scene-draft-v1", draft);
  return computeAgentProposalContentHash(
    {
      outputSchemaId: "scene-draft-v1",
      payload,
      primaryTarget: Object.freeze({ kind: "scene", id: TARGET })
    },
    hashPort
  );
}

describe("assembleProposalArtifactContextResource", () => {
  it("stores the supplied full proposal artifact hash unchanged", async () => {
    const artifactContentHash = await fullProposalArtifactContentHash();
    const payloadOnlyHash = await draftPayloadContentHash();
    expect(artifactContentHash).not.toBe(payloadOnlyHash);

    const assembled = await assembleProposalArtifactContextResource({
      projectId: PROJECT,
      assignmentId: ASSIGNMENT,
      proposalId: PROPOSAL,
      sceneId: TARGET,
      artifactVersion: 2,
      contentHash: artifactContentHash,
      draft,
      providerText: draft.prose,
      fullTextCharCount: draft.prose.length,
      truncated: false,
      inclusionReason: "assess-proposal-target",
      hashPort
    });

    expect(assembled.resource.contentHash).toBe(artifactContentHash);
    expect(assembled.resource.contentHash).not.toBe(payloadOnlyHash);
    expect(assembled.resource.providerTextHash).toBe(
      instructionContentHash(await hashPort.digestSha256Hex(draft.prose))
    );
  });

  it("accepts truncated provider text as an exact draft prefix", async () => {
    const prefix = draft.prose.slice(0, 12);
    const assembled = await assembleProposalArtifactContextResource({
      projectId: PROJECT,
      assignmentId: ASSIGNMENT,
      proposalId: PROPOSAL,
      sceneId: TARGET,
      artifactVersion: 2,
      contentHash: await fullProposalArtifactContentHash(),
      draft,
      providerText: prefix,
      fullTextCharCount: draft.prose.length,
      truncated: true,
      inclusionReason: "assess-proposal-target",
      hashPort
    });
    expect(assembled.providerText).toBe(prefix);
    expect(assembled.resource.truncated).toBe(true);
  });

  it("refuses invalid artifact hash, truncation flags, and non-prefix provider text", async () => {
    await expect(
      assembleProposalArtifactContextResource({
        projectId: PROJECT,
        assignmentId: ASSIGNMENT,
        proposalId: PROPOSAL,
        sceneId: TARGET,
        artifactVersion: 2,
        contentHash: "not-a-digest",
        draft,
        providerText: draft.prose,
        fullTextCharCount: draft.prose.length,
        truncated: false,
        inclusionReason: "assess-proposal-target",
        hashPort
      })
    ).rejects.toThrow(/SHA-256 digest/i);

    await expect(
      assembleProposalArtifactContextResource({
        projectId: PROJECT,
        assignmentId: ASSIGNMENT,
        proposalId: PROPOSAL,
        sceneId: TARGET,
        artifactVersion: 0,
        contentHash: await fullProposalArtifactContentHash(),
        draft,
        providerText: draft.prose,
        fullTextCharCount: draft.prose.length,
        truncated: false,
        inclusionReason: "assess-proposal-target",
        hashPort
      })
    ).rejects.toThrow(/artifact version/i);

    await expect(
      assembleProposalArtifactContextResource({
        projectId: PROJECT,
        assignmentId: ASSIGNMENT,
        proposalId: PROPOSAL,
        sceneId: TARGET,
        artifactVersion: 2,
        contentHash: await fullProposalArtifactContentHash(),
        draft,
        providerText: "partial",
        fullTextCharCount: draft.prose.length,
        truncated: false,
        inclusionReason: "assess-proposal-target",
        hashPort
      })
    ).rejects.toThrow(/truncation flag/i);

    await expect(
      assembleProposalArtifactContextResource({
        projectId: PROJECT,
        assignmentId: ASSIGNMENT,
        proposalId: PROPOSAL,
        sceneId: TARGET,
        artifactVersion: 2,
        contentHash: await fullProposalArtifactContentHash(),
        draft,
        providerText: "not-a-prefix",
        fullTextCharCount: draft.prose.length,
        truncated: true,
        inclusionReason: "assess-proposal-target",
        hashPort
      })
    ).rejects.toThrow(/exact prefix/i);
  });
});
