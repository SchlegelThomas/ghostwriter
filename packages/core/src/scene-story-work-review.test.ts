import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ContextReceipt } from "./agent-context-receipt.js";
import { CHARACTER_STORY_WORK_WORKFLOW_ID, SCENE_STORY_WORK_WORKFLOW_ID, instructionContentHash } from "./agent-domain.js";
import { createAgentRun, createQueuedAgentRun, createReadyAgentProposal } from "./agent-runs-proposals.js";
import { validateSceneDraftV1 } from "./scene-draft-v1.js";
import type { SceneStoryWorkReviewInput } from "./scene-story-work-review.js";
import { agentProposalId, agentRunId, contextReceiptId, sceneId } from "./domain.js";
import { BELLWETHER_FIXTURE } from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import { createMemorySceneStoryWorkReviewUnitOfWork } from "./memory-scene-story-work-review-uow.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemoryStoryWorkAssignmentRepository } from "./memory-story-work-assignment-repository.js";
import { createStoryWorkAssignment, storyWorkAssignmentId } from "./story-work-assignment.js";

const now = "2026-09-12T12:00:00.000Z";
const owner = accountId("review-owner");
const projectId = BELLWETHER_FIXTURE.project.id;
const sourceSceneId = BELLWETHER_FIXTURE.scenes[0]!.id;
const hash = instructionContentHash("a".repeat(64));
const payload = validateSceneDraftV1({
  schemaId: "scene-draft-v1",
  prose: "Lantern light moved across the harbor wall.",
  sourceSceneIds: [sourceSceneId]
});

async function harness(
  failAssignmentSave = false,
  status: "artifact-ready" | "awaiting-review" = "artifact-ready",
  taskKind: "scene" | "revise" = "scene",
  workflowId: typeof SCENE_STORY_WORK_WORKFLOW_ID | typeof CHARACTER_STORY_WORK_WORKFLOW_ID = SCENE_STORY_WORK_WORKFLOW_ID
) {
  const projects = createMemoryProjectRepository([BELLWETHER_FIXTURE], [createProjectMembership({ projectId, accountId: owner, role: "owner", createdAt: now })]);
  const assignments = createMemoryStoryWorkAssignmentRepository();
  const proposals = createMemoryAgentProposalRepository();
  const runs = createMemoryAgentRunRepository();
  const receipts = createMemoryContextReceiptRepository();
  const destination = sceneId("scene-review-destination");
  const pointer = { proposalId: agentProposalId("review-proposal"), artifactVersion: 1, contentHash: hash };
  const assignment = createStoryWorkAssignment({ id: storyWorkAssignmentId("review-assignment"), projectId, initiatorAccountId: owner, version: 3,
    taskKind, brief: "Develop the arrival scene", constraints: "Respect the existing story", doneWhen: "A complete scene draft is ready to review", sources: [{ kind: "scene", sceneId: sourceSceneId, projectVersion: BELLWETHER_FIXTURE.project.version }],
    destination: { kind: "scene", operation: taskKind === "scene" ? "create" : "update", sceneId: destination }, provider: "openai", model: "gpt-4.1", status, steps: [{ id: "draft", title: "Develop scene", dependencies: [] }],
    currentArtifact: pointer, generatedArtifact: pointer, results: [], idempotencyKey: "review-request", createdAt: now, updatedAt: now });
  await assignments.create({ assignment, requestFingerprint: hash });
  const receipt: ContextReceipt = { id: contextReceiptId("review-receipt"), projectId, workflowId, workflowVersion: "1.0.0", layers: [], resources: [], excludedContextClasses: [],
    provider: "openai", model: "gpt-4.1", maxOutputTokens: 2000, wallClockSeconds: 60, toolCount: 0, egressClass: "openai-responses", outputSchemaId: "scene-draft-v1", receiptHash: hash,
    primaryTarget: { kind: "scene", id: destination }, createdAt: now };
  await receipts.insertImmutable(receipt);
  const queued = createQueuedAgentRun({ id: agentRunId("review-run"), projectId, initiatorAccountId: owner, workflowId, workflowVersion: "1.0.0", provider: "openai", model: "gpt-4.1", receiptId: receipt.id, receiptHash: receipt.receiptHash, status: "queued", createdAt: now, updatedAt: now });
  await runs.create(queued);
  const running = createAgentRun({ ...queued, status: "running" });
  await runs.transition({ runId: queued.id, expectedStatus: "queued", next: running });
  await runs.transition({ runId: queued.id, expectedStatus: "running", next: createAgentRun({ ...running, status: "ready", completedAt: now }) });
  await proposals.create(createReadyAgentProposal({ id: pointer.proposalId, projectId, runId: queued.id, receiptId: receipt.id, status: "ready", outputSchemaId: "scene-draft-v1", payload, contentHash: pointer.contentHash,
    primaryTarget: { kind: "scene", id: destination }, createdAt: now, updatedAt: now }));
  let nextId = 0;
  const review = createMemorySceneStoryWorkReviewUnitOfWork({ projects, assignments: failAssignmentSave ? { ...assignments, compareAndSet: async () => ({ ok: false as const, reason: "version-conflict" as const }) } : assignments,
    proposals, runs, receipts, ids: { create: (kind) => `${kind}-review-${++nextId}` }, hashPort: { digestSha256Hex: async (value) => createHash("sha256").update(value).digest("hex") } });
  const input: SceneStoryWorkReviewInput = { action: "open", accountId: owner, projectId, assignmentId: assignment.id, expectedAssignmentVersion: assignment.version, artifact: pointer, updatedAt: now };
  return { review, input, assignment, assignments, proposals, projects, pointer };
}

describe("atomic scene review", () => {
  it("opens once, saves full edited prose and source references with generated lineage, and rejects the exact edited artifact", async () => {
    const h = await harness();
    const opened = await h.review.review(h.input);
    expect(opened.assignment.status).toBe("awaiting-review");
    expect((await h.review.review(h.input)).assignment.version).toBe(opened.assignment.version);
    const editedPayload = { ...payload, prose: "The revised light swept across the harbor." };
    const edited = await h.review.review({ ...h.input, action: "edit", expectedAssignmentVersion: opened.assignment.version, payload: editedPayload });
    expect(edited.proposal.payload).toEqual(editedPayload);
    expect(edited.proposal.payload).toMatchObject({
      prose: "The revised light swept across the harbor.",
      sourceSceneIds: [sourceSceneId]
    });
    expect(edited.assignment.generatedArtifact).toEqual(h.pointer);
    expect(edited.assignment.currentArtifact?.artifactVersion).toBe(2);
    expect((await h.proposals.get(h.pointer.proposalId))?.status).toBe("stale");
    expect((await h.projects.getProject(projectId))?.version).toBe(BELLWETHER_FIXTURE.project.version);
    const rejectInput: SceneStoryWorkReviewInput = { ...h.input, action: "reject", expectedAssignmentVersion: edited.assignment.version, artifact: edited.assignment.currentArtifact! };
    const rejected = await h.review.review(rejectInput);
    expect(rejected.assignment.status).toBe("rejected");
    expect((await h.review.review(rejectInput)).assignment.version).toBe(rejected.assignment.version);
  });
  it("refuses stale and foreign reviews without changing the original proposal", async () => {
    const h = await harness();
    await expect(h.review.review({ ...h.input, accountId: accountId("foreign") })).rejects.toThrow();
    await expect(h.review.review({ ...h.input, artifact: { ...h.pointer, contentHash: instructionContentHash("b".repeat(64)) } })).rejects.toThrow();
    expect((await h.proposals.get(h.pointer.proposalId))?.status).toBe("ready");
  });
  it("refuses edited payloads that add or drop generated scene sources", async () => {
    const h = await harness(false, "awaiting-review");
    await expect(
      h.review.review({
        ...h.input,
        action: "edit",
        payload: {
          ...payload,
          sourceSceneIds: [sceneId("scene-not-authorized")]
        }
      })
    ).rejects.toMatchObject({ code: "SCENE_STORY_WORK_ARTIFACT_MISMATCH" });
    await expect(
      h.review.review({
        ...h.input,
        action: "edit",
        payload: { ...payload, sourceSceneIds: [] }
      })
    ).rejects.toMatchObject({ code: "SCENE_STORY_WORK_ARTIFACT_MISMATCH" });
    expect(await h.proposals.listByProject(projectId)).toHaveLength(1);
    expect((await h.assignments.get(h.input))?.currentArtifact).toEqual(h.pointer);
  });
  it("reviews the exact revise/update destination pair", async () => {
    const h = await harness(false, "artifact-ready", "revise");
    const opened = await h.review.review(h.input);
    expect(opened.assignment).toMatchObject({
      taskKind: "revise",
      status: "awaiting-review",
      destination: { kind: "scene", operation: "update" }
    });
    expect(opened.proposal.payload).toEqual(payload);
  });
  it("refuses a scene artifact bound to a different workflow", async () => {
    const h = await harness(
      false,
      "artifact-ready",
      "scene",
      CHARACTER_STORY_WORK_WORKFLOW_ID
    );
    await expect(h.review.review(h.input)).rejects.toMatchObject({
      code: "SCENE_STORY_WORK_ARTIFACT_MISMATCH"
    });
    expect((await h.assignments.get(h.input))?.status).toBe("artifact-ready");
    expect((await h.proposals.get(h.pointer.proposalId))?.status).toBe("ready");
  });
  it("rolls back proposal rejection if assignment CAS fails", async () => {
    const h = await harness(true);
    await expect(h.review.review({ ...h.input, action: "reject" })).rejects.toThrow();
    expect((await h.proposals.get(h.pointer.proposalId))?.status).toBe("ready");
    expect((await h.assignments.get(h.input))?.status).toBe("artifact-ready");
  });
  it("rolls back a new edited proposal and superseding status after a late CAS refusal", async () => {
    const h = await harness(true, "awaiting-review");
    await expect(h.review.review({ ...h.input, action: "edit", payload: { ...payload, prose: "A later reviewed scene." } })).rejects.toThrow();
    const proposals = await h.proposals.listByProject(projectId);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.status).toBe("ready");
    expect((await h.assignments.get(h.input))?.currentArtifact).toEqual(h.pointer);
  });
  it("serializes duplicate edits so only one new artifact is saved", async () => {
    const h = await harness(false, "awaiting-review");
    const edit: SceneStoryWorkReviewInput = { ...h.input, action: "edit", payload: { ...payload, prose: "A later reviewed scene." } };
    const outcomes = await Promise.allSettled([h.review.review(edit), h.review.review(edit)]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await h.proposals.listByProject(projectId)).toHaveLength(2);
  });

});
