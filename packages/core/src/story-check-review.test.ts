import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ContextReceipt } from "./agent-context-receipt.js";
import {
  CHARACTER_STORY_WORK_WORKFLOW_ID,
  STORY_CHECK_CONTINUITY_WORKFLOW_ID,
  instructionContentHash
} from "./agent-domain.js";
import { createAgentRun, createQueuedAgentRun, createReadyAgentProposal } from "./agent-runs-proposals.js";
import { agentProposalId, agentRunId, contextReceiptId, sceneId } from "./domain.js";
import { BELLWETHER_FIXTURE } from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemoryStoryCheckReviewUnitOfWork } from "./memory-story-check-review-uow.js";
import { createMemoryStoryWorkAssignmentRepository } from "./memory-story-work-assignment-repository.js";
import { sceneContentHash } from "./scene-documents.js";
import {
  STORY_CHECK_SCHEMA_ID,
  validateStoryCheckFindingsV1,
  type StoryCheckFindingsV1
} from "./story-check-findings-v1.js";
import { buildStoryCheckRevisionVector } from "./story-check-revision-vector.js";
import {
  evaluateStoredStoryCheckPayloadFreshness,
  type StoryCheckReviewInput
} from "./story-check-review.js";
import {
  createStoryAssessmentRevisionVector,
  evaluateStoryAssessmentFreshness
} from "./story-assessment-freshness.js";
import {
  createStoryWorkAssignment,
  storyWorkAssignmentId,
  type StoryWorkArtifactPointer,
  type StoryWorkResultReference
} from "./story-work-assignment.js";
import { DomainValidationError } from "./domain.js";

const now = "2026-09-13T12:00:00.000Z";
const owner = accountId("check-review-owner");
const project = BELLWETHER_FIXTURE.project.id;
const assessScene = sceneId("scene-check-review-target");
const contextScene = BELLWETHER_FIXTURE.scenes[0]!.id;
const hash = instructionContentHash("a".repeat(64));
const sceneHeadHash = sceneContentHash("b".repeat(64));

function basePayload(overrides: Record<string, unknown> = {}): StoryCheckFindingsV1 {
  return validateStoryCheckFindingsV1({
    schemaId: STORY_CHECK_SCHEMA_ID,
    specialist: "continuity",
    target: {
      mode: "applied-scene",
      projectId: project,
      sceneId: assessScene,
      workingVersion: 3,
      contentHash: sceneHeadHash
    },
    findings: [
      {
        id: "finding-one",
        kind: "contradiction",
        severity: "important",
        claim: "The letter was already destroyed.",
        anchors: [{ sceneId: assessScene, quote: "burned the letter" }],
        resolution: { status: "open" }
      },
      {
        id: "finding-two",
        kind: "question",
        severity: "advisory",
        claim: "Who received the letter?",
        anchors: [{ sceneId: assessScene, quote: "the letter" }],
        resolution: { status: "open" }
      }
    ],
    coverage: {
      requestedScopeSummary: "Target scene",
      examined: [
        {
          sceneId: assessScene,
          workingVersion: 3,
          contentHash: sceneHeadHash
        }
      ],
      skipped: [],
      truncations: [],
      completeForRequestedScope: true
    },
    revisionVector: createStoryAssessmentRevisionVector([
      {
        kind: "scene-prose",
        sceneId: assessScene,
        workingVersion: 3,
        contentHash: "b".repeat(64)
      }
    ]),
    linkedRecheckSceneIds: [contextScene],
    ...overrides
  });
}

function storyCheckResult(pointer: StoryWorkArtifactPointer): StoryWorkResultReference {
  return {
    kind: "story-check",
    proposalId: pointer.proposalId,
    artifactVersion: pointer.artifactVersion,
    contentHash: pointer.contentHash,
    sceneId: assessScene
  };
}

async function harness(
  failAssignmentSave = false,
  status: "artifact-ready" | "awaiting-review" = "artifact-ready",
  payload: StoryCheckFindingsV1 = basePayload(),
  workflowId:
    | typeof STORY_CHECK_CONTINUITY_WORKFLOW_ID
    | typeof CHARACTER_STORY_WORK_WORKFLOW_ID = STORY_CHECK_CONTINUITY_WORKFLOW_ID
) {
  const projects = createMemoryProjectRepository(
    [BELLWETHER_FIXTURE],
    [createProjectMembership({ projectId: project, accountId: owner, role: "owner", createdAt: now })]
  );
  const assignments = createMemoryStoryWorkAssignmentRepository();
  const proposals = createMemoryAgentProposalRepository();
  const runs = createMemoryAgentRunRepository();
  const receipts = createMemoryContextReceiptRepository();
  const pointer = {
    proposalId: agentProposalId("check-review-proposal"),
    artifactVersion: 1,
    contentHash: hash
  };
  const assignment = createStoryWorkAssignment({
    id: storyWorkAssignmentId("check-review-assignment"),
    projectId: project,
    initiatorAccountId: owner,
    version: 3,
    taskKind: "check",
    brief: "Check continuity",
    constraints: "Use supplied context only",
    doneWhen: "Findings are ready for review",
    sources: [
      {
        kind: "scene",
        sceneId: assessScene,
        projectVersion: BELLWETHER_FIXTURE.project.version,
        workingVersion: 3,
        contentHash: sceneHeadHash
      }
    ],
    destination: { kind: "scene", sceneId: assessScene, operation: "assess" },
    provider: "openai",
    model: "gpt-4.1",
    status,
    steps: [{ id: "check", title: "Run continuity check", dependencies: [] }],
    currentArtifact: pointer,
    generatedArtifact: pointer,
    results: [],
    idempotencyKey: "check-review-request",
    createdAt: now,
    updatedAt: now
  });
  await assignments.create({ assignment, requestFingerprint: hash });
  const receipt: ContextReceipt = {
    id: contextReceiptId("check-review-receipt"),
    projectId: project,
    workflowId,
    workflowVersion: "1.0.0",
    layers: [],
    resources: [],
    excludedContextClasses: [],
    provider: "openai",
    model: "gpt-4.1",
    maxOutputTokens: 2000,
    wallClockSeconds: 60,
    toolCount: 0,
    egressClass: "openai-responses",
    outputSchemaId: "story-check-findings-v1",
    receiptHash: hash,
    primaryTarget: { kind: "scene", id: assessScene },
    targetSceneId: assessScene,
    createdAt: now
  };
  await receipts.insertImmutable(receipt);
  const queued = createQueuedAgentRun({
    id: agentRunId("check-review-run"),
    projectId: project,
    initiatorAccountId: owner,
    workflowId,
    workflowVersion: "1.0.0",
    provider: "openai",
    model: "gpt-4.1",
    receiptId: receipt.id,
    receiptHash: receipt.receiptHash,
    status: "queued",
    createdAt: now,
    updatedAt: now
  });
  await runs.create(queued);
  await runs.transition({
    runId: queued.id,
    expectedStatus: "queued",
    next: createAgentRun({ ...queued, status: "running" })
  });
  await runs.transition({
    runId: queued.id,
    expectedStatus: "running",
    next: createAgentRun({ ...queued, status: "ready", completedAt: now })
  });
  await proposals.create(
    createReadyAgentProposal({
      id: pointer.proposalId,
      projectId: project,
      runId: queued.id,
      receiptId: receipt.id,
      status: "ready",
      outputSchemaId: "story-check-findings-v1",
      payload,
      contentHash: pointer.contentHash,
      primaryTarget: { kind: "scene", id: assessScene },
      createdAt: now,
      updatedAt: now
    })
  );
  let nextId = 0;
  const review = createMemoryStoryCheckReviewUnitOfWork({
    projects,
    assignments: failAssignmentSave
      ? {
          ...assignments,
          compareAndSet: async () => ({ ok: false as const, reason: "version-conflict" as const })
        }
      : assignments,
    proposals,
    runs,
    receipts,
    ids: { create: (kind) => `${kind}-check-review-${++nextId}` },
    hashPort: {
      digestSha256Hex: async (value) => createHash("sha256").update(value).digest("hex")
    }
  });
  const input: StoryCheckReviewInput = {
    action: "open",
    accountId: owner,
    projectId: project,
    assignmentId: assignment.id,
    expectedAssignmentVersion: assignment.version,
    artifact: pointer,
    updatedAt: now
  };
  return { review, input, assignment, assignments, proposals, projects, pointer, payload };
}

describe("story check review", () => {
  it("opens artifact-ready checks into awaiting review", async () => {
    const h = await harness();
    const opened = await h.review.review(h.input);
    expect(opened.assignment.status).toBe("awaiting-review");
    expect((await h.review.review(h.input)).assignment.version).toBe(opened.assignment.version);
  });

  it("dismisses, defers, and reopens findings with immutable lineage", async () => {
    const h = await harness(false, "awaiting-review");
    const dismissed = await h.review.review({
      ...h.input,
      action: "resolve",
      findingId: "finding-one",
      resolution: { status: "dismissed" }
    });
    const dismissedPayload = validateStoryCheckFindingsV1(dismissed.proposal.payload);
    expect(dismissedPayload.findings[0]?.resolution).toEqual({ status: "dismissed" });
    expect(dismissedPayload.findings[1]?.resolution).toEqual({ status: "open" });
    expect(dismissed.assignment.generatedArtifact).toEqual(h.pointer);
    expect(dismissed.assignment.currentArtifact?.artifactVersion).toBe(2);
    expect((await h.proposals.get(h.pointer.proposalId))?.status).toBe("stale");

    const deferred = await h.review.review({
      ...h.input,
      action: "resolve",
      expectedAssignmentVersion: dismissed.assignment.version,
      artifact: dismissed.assignment.currentArtifact!,
      findingId: "finding-two",
      resolution: { status: "deferred", reason: "Revisit after the next scene draft." }
    });
    expect(validateStoryCheckFindingsV1(deferred.proposal.payload).findings[1]?.resolution).toEqual({
      status: "deferred",
      reason: "Revisit after the next scene draft."
    });

    const reopened = await h.review.review({
      ...h.input,
      action: "resolve",
      expectedAssignmentVersion: deferred.assignment.version,
      artifact: deferred.assignment.currentArtifact!,
      findingId: "finding-one",
      resolution: { status: "open" }
    });
    const reopenedPayload = validateStoryCheckFindingsV1(reopened.proposal.payload);
    expect(reopenedPayload.findings[0]?.resolution).toEqual({ status: "open" });
    expect(reopenedPayload.linkedRecheckSceneIds).toEqual([contextScene]);
    expect(reopenedPayload.target).toEqual(h.payload.target);
  });

  it("completes zero-finding and all-resolved checks without apply identity", async () => {
    const zero = await harness(false, "awaiting-review", basePayload({ findings: [] }));
    const zeroCompleted = await zero.review.review({
      ...zero.input,
      action: "complete",
      result: storyCheckResult(zero.pointer)
    });
    expect(zeroCompleted.assignment).toMatchObject({
      status: "reviewed",
      results: [storyCheckResult(zero.pointer)]
    });
    expect(zeroCompleted.assignment.applyIdempotencyKey).toBeUndefined();
    expect((await zero.projects.getProject(project))?.version).toBe(BELLWETHER_FIXTURE.project.version);

    const h = await harness(false, "awaiting-review");
    const dismissedAll = await h.review.review({
      ...h.input,
      action: "resolve",
      findingId: "finding-one",
      resolution: { status: "dismissed" }
    });
    const resolved = await h.review.review({
      ...h.input,
      action: "resolve",
      expectedAssignmentVersion: dismissedAll.assignment.version,
      artifact: dismissedAll.assignment.currentArtifact!,
      findingId: "finding-two",
      resolution: { status: "deferred", reason: "Not blocking." }
    });
    const completed = await h.review.review({
      ...h.input,
      action: "complete",
      expectedAssignmentVersion: resolved.assignment.version,
      artifact: resolved.assignment.currentArtifact!,
      result: storyCheckResult(resolved.assignment.currentArtifact!)
    });
    expect(completed.assignment.status).toBe("reviewed");
    expect(completed.assignment.generatedArtifact).toEqual(h.pointer);
  });

  it("refuses completion while any finding remains open", async () => {
    const h = await harness(false, "awaiting-review");
    await expect(
      h.review.review({
        ...h.input,
        action: "complete",
        result: storyCheckResult(h.pointer)
      })
    ).rejects.toThrow(/dismissed, deferred, or absent/i);
    expect((await h.assignments.get(h.input))?.status).toBe("awaiting-review");
  });

  it("refuses stale pointers, foreign scope, wrong workflow, and invalid deferred reasons", async () => {
    const h = await harness();
    await expect(h.review.review({ ...h.input, accountId: accountId("foreign") })).rejects.toThrow();
    await expect(
      h.review.review({
        ...h.input,
        artifact: { ...h.pointer, contentHash: instructionContentHash("c".repeat(64)) }
      })
    ).rejects.toMatchObject({ code: "STORY_CHECK_ARTIFACT_MISMATCH" });
    expect((await h.proposals.get(h.pointer.proposalId))?.status).toBe("ready");

    const wrongWorkflow = await harness(false, "awaiting-review", basePayload(), CHARACTER_STORY_WORK_WORKFLOW_ID);
    await expect(wrongWorkflow.review.review(wrongWorkflow.input)).rejects.toMatchObject({
      code: "STORY_CHECK_ARTIFACT_MISMATCH"
    });

    const awaiting = await harness(false, "awaiting-review");
    await expect(
      awaiting.review.review({
        ...awaiting.input,
        action: "resolve",
        findingId: "missing-finding",
        resolution: { status: "dismissed" }
      })
    ).rejects.toMatchObject({ code: "STORY_CHECK_FINDING_NOT_FOUND" });
    await expect(
      awaiting.review.review({
        ...awaiting.input,
        action: "resolve",
        findingId: "finding-one",
        resolution: { status: "deferred", reason: "   " }
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("treats identical resolve retries with stale assignment pointers as conflicts", async () => {
    const h = await harness(false, "awaiting-review");
    const dismissed = await h.review.review({
      ...h.input,
      action: "resolve",
      findingId: "finding-one",
      resolution: { status: "dismissed" }
    });
    await expect(
      h.review.review({
        ...h.input,
        action: "resolve",
        findingId: "finding-one",
        resolution: { status: "dismissed" }
      })
    ).rejects.toThrow();
    expect(await h.proposals.listByProject(project)).toHaveLength(2);
    expect(dismissed.assignment.currentArtifact?.artifactVersion).toBe(2);
  });

  it("replays complete only when the reviewed tuple matches exactly", async () => {
    const h = await harness(false, "awaiting-review", basePayload({ findings: [] }));
    const completed = await h.review.review({
      ...h.input,
      action: "complete",
      result: storyCheckResult(h.pointer)
    });
    const replayed = await h.review.review({
      ...h.input,
      action: "complete",
      expectedAssignmentVersion: completed.assignment.version,
      result: storyCheckResult(h.pointer)
    });
    expect(replayed.assignment).toEqual(completed.assignment);
    await expect(
      h.review.review({
        ...h.input,
        action: "complete",
        expectedAssignmentVersion: completed.assignment.version - 1,
        result: storyCheckResult(h.pointer)
      })
    ).rejects.toThrow();
  });

  it("rolls back proposal and assignment changes when assignment CAS fails", async () => {
    const h = await harness(true, "awaiting-review");
    await expect(
      h.review.review({
        ...h.input,
        action: "resolve",
        findingId: "finding-one",
        resolution: { status: "dismissed" }
      })
    ).rejects.toThrow();
    expect(await h.proposals.listByProject(project)).toHaveLength(1);
    expect((await h.proposals.get(h.pointer.proposalId))?.status).toBe("ready");
    expect((await h.assignments.get(h.input))?.currentArtifact).toEqual(h.pointer);
  });
});

describe("stored story check payload freshness", () => {
  const hashPort = {
    digestSha256Hex: async (value: string) => createHash("sha256").update(value).digest("hex")
  };

  it("flags applied-scene prose and intent drift without provider calls", async () => {
    const payload = basePayload();
    const currentVector = (
      await buildStoryCheckRevisionVector({
        target: payload.target,
        consumedSceneProse: [
          {
            sceneId: assessScene,
            workingVersion: 4,
            contentHash: sceneContentHash("d".repeat(64))
          }
        ],
        hashPort
      })
    ).revisionVector;
    expect(
      evaluateStoredStoryCheckPayloadFreshness({
        storedPayload: payload,
        currentRevisionVector: currentVector
      })
    ).toEqual({
      status: "needs-recheck",
      reasons: [
        {
          dependencyKey: `scene-prose:${assessScene}`,
          reason: "scene-prose-changed"
        }
      ]
    });
    expect(evaluateStoryAssessmentFreshness(payload.revisionVector, payload.revisionVector)).toEqual({
      status: "fresh"
    });
  });

  it("leaves applied-scene checks fresh when proposal draft hash is omitted", () => {
    const payload = basePayload();
    expect(
      evaluateStoredStoryCheckPayloadFreshness({
        storedPayload: payload,
        currentRevisionVector: payload.revisionVector
      })
    ).toEqual({ status: "fresh" });
  });

  it("flags missing, current, and changed proposal-draft target artifacts", async () => {
    const draftTarget = Object.freeze({
      mode: "proposal-draft" as const,
      projectId: project,
      sceneId: assessScene,
      assignmentId: storyWorkAssignmentId("draft-source-assignment"),
      proposalId: agentProposalId("draft-source-proposal"),
      artifactVersion: 2,
      contentHash: instructionContentHash("d".repeat(64))
    });
    const currentVector = (
      await buildStoryCheckRevisionVector({
        target: draftTarget,
        consumedSceneProse: [],
        hashPort
      })
    ).revisionVector;
    const payload = basePayload({
      target: draftTarget,
      findings: [],
      revisionVector: currentVector
    });
    const dependencyKey = `proposal-artifact:${draftTarget.proposalId}`;

    expect(
      evaluateStoredStoryCheckPayloadFreshness({
        storedPayload: payload,
        currentRevisionVector: currentVector
      })
    ).toEqual({
      status: "needs-recheck",
      reasons: [{ dependencyKey, reason: "proposal-artifact-missing" }]
    });

    expect(
      evaluateStoredStoryCheckPayloadFreshness({
        storedPayload: payload,
        currentRevisionVector: currentVector,
        currentProposalDraftContentHash: draftTarget.contentHash
      })
    ).toEqual({ status: "fresh" });

    expect(
      evaluateStoredStoryCheckPayloadFreshness({
        storedPayload: payload,
        currentRevisionVector: currentVector,
        currentProposalDraftContentHash: instructionContentHash("e".repeat(64))
      })
    ).toEqual({
      status: "needs-recheck",
      reasons: [{ dependencyKey, reason: "proposal-artifact-changed" }]
    });
  });
});
