import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { instructionContentHash, type AsyncHashPort } from "./agent-domain.js";
import {
  bookId,
  canvasObjectId,
  chapterId,
  projectId
} from "./domain.js";
import { accountId } from "./identity.js";
import {
  sceneStoryWorkApplyRequestFingerprint,
  type ApplySceneStoryWorkInput
} from "./scene-story-work-uow.js";
import {
  sceneContentHash,
  sceneLeaseHolderId
} from "./scene-documents.js";
import { storyWorkAssignmentId } from "./story-work-assignment.js";
import { agentProposalId } from "./domain.js";

const hashPort: AsyncHashPort = {
  async digestSha256Hex(value) {
    return createHash("sha256").update(value).digest("hex");
  }
};
const base = {
  accountId: accountId("account-scene-apply"),
  projectId: projectId("project-scene-apply"),
  assignmentId: storyWorkAssignmentId("assignment-scene-apply"),
  expectedAssignmentVersion: 7,
  proposalId: agentProposalId("proposal-scene-apply"),
  expectedArtifactVersion: 2,
  expectedProposalContentHash: instructionContentHash("a".repeat(64)),
  idempotencyKey: "apply-scene-once"
} as const;

describe("scene story work apply contract", () => {
  it("binds every create semantic while excluding key, server time, and generated IDs", async () => {
    const request: ApplySceneStoryWorkInput = {
      ...base,
      mode: "create-scene",
      expectedProjectVersion: 5,
      title: "  The Harbor Choice  ",
      manuscriptPlacement: {
        kind: "chapter",
        bookId: bookId("book-one"),
        chapterId: chapterId("chapter-one"),
        position: 2
      },
      canvas: {
        expectedCanvasVersion: 4,
        scope: { scopeKind: "chapter", scopeId: chapterId("chapter-one") },
        x: 10,
        y: 20,
        width: 240,
        height: 160,
        z: 3,
        parentRegionId: canvasObjectId("region-one"),
        storyOrderHint: 2
      }
    };
    const fingerprint = await sceneStoryWorkApplyRequestFingerprint(request, hashPort);
    await expect(sceneStoryWorkApplyRequestFingerprint({
      ...request,
      idempotencyKey: "a-retry-key-does-not-change-semantic-hash"
    }, hashPort)).resolves.toBe(fingerprint);
    await expect(sceneStoryWorkApplyRequestFingerprint({
      ...request,
      title: "A changed title"
    }, hashPort)).resolves.not.toBe(fingerprint);
    await expect(sceneStoryWorkApplyRequestFingerprint({
      ...request,
      canvas: { ...request.canvas!, x: 11 }
    }, hashPort)).resolves.not.toBe(fingerprint);
  });

  it("distinguishes named variants from replacing working prose", async () => {
    const existing = {
      ...base,
      expectedSceneWorkingVersion: 4,
      expectedSceneContentHash: sceneContentHash("b".repeat(64)),
      leaseHolderId: sceneLeaseHolderId("session-derived-holder")
    };
    const variant = await sceneStoryWorkApplyRequestFingerprint({
      ...existing,
      mode: "named-variant",
      variantName: "Alternative ending"
    }, hashPort);
    const revision = await sceneStoryWorkApplyRequestFingerprint({
      ...existing,
      mode: "apply-revision"
    }, hashPort);
    expect(variant).not.toBe(revision);
    await expect(sceneStoryWorkApplyRequestFingerprint({
      ...existing,
      mode: "named-variant",
      variantName: "  Alternative ending  "
    }, hashPort)).resolves.toBe(variant);
  });

  it("refuses invalid version, geometry, hash, scope, and variant fields before hashing", async () => {
    await expect(sceneStoryWorkApplyRequestFingerprint({
      ...base,
      mode: "create-scene",
      expectedProjectVersion: 5,
      title: "Scene",
      manuscriptPlacement: { kind: "unassigned", bookId: bookId("book-one") },
      canvas: {
        expectedCanvasVersion: 1,
        scope: { scopeKind: "project", scopeId: "not-allowed" },
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        z: 0
      }
    }, hashPort)).rejects.toThrow(/project Canvas scope/i);
    await expect(sceneStoryWorkApplyRequestFingerprint({
      ...base,
      mode: "apply-revision",
      expectedSceneWorkingVersion: 0,
      expectedSceneContentHash: sceneContentHash("b".repeat(64)),
      leaseHolderId: sceneLeaseHolderId("session-derived-holder")
    }, hashPort)).rejects.toThrow(/positive integer/i);
    await expect(sceneStoryWorkApplyRequestFingerprint({
      ...base,
      mode: "named-variant",
      expectedSceneWorkingVersion: 1,
      expectedSceneContentHash: "not-a-hash",
      leaseHolderId: sceneLeaseHolderId("session-derived-holder"),
      variantName: "Variant"
    }, hashPort)).rejects.toThrow(/SHA-256/i);
  });
});
