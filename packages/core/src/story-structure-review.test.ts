import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ContextReceipt } from "./agent-context-receipt.js";
import {
  STORY_WORK_STRUCTURE_WORKFLOW_ID,
  instructionContentHash
} from "./agent-domain.js";
import { createAgentRun, createQueuedAgentRun, createReadyAgentProposal } from "./agent-runs-proposals.js";
import {
  STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
  STORY_STRUCTURE_SCHEMA_ID,
  buildStoryStructureProposalV1FromCandidate,
  storyStructureLoweringContextFromBook,
  validateStoryStructureProposalV1,
  type StoryStructureProposalV1
} from "./story-structure-proposal-v1.js";
import {
  assertStoryStructureReviewEditPreservesAuthority,
  type StoryStructureStoryWorkReviewInput
} from "./story-structure-review.js";
import {
  agentProposalId,
  agentRunId,
  contextReceiptId,
  createBook,
  createManuscriptStructure,
  sceneId
} from "./domain.js";
import { BELLWETHER_FIXTURE } from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemoryStoryStructureStoryWorkReviewUnitOfWork } from "./memory-story-structure-review-uow.js";
import { createMemoryStoryWorkAssignmentRepository } from "./memory-story-work-assignment-repository.js";
import { createStoryWorkAssignment, storyWorkAssignmentId } from "./story-work-assignment.js";
import type { DomainIdKind, IdGenerator } from "./project-repository.js";

const now = "2026-09-12T12:00:00.000Z";
const owner = accountId("structure-review-owner");
const fixtureProjectId = BELLWETHER_FIXTURE.project.id;
const targetBookId = BELLWETHER_FIXTURE.books[0]!.id;
const receiptHash = instructionContentHash("c".repeat(64));

function sequenceIds(values: Partial<Record<DomainIdKind, readonly string[]>>): IdGenerator {
  const positions = new Map<DomainIdKind, number>();
  return {
    create(kind): string {
      const index = positions.get(kind) ?? 0;
      const list = values[kind] ?? [`generated-${kind}-${index + 1}`];
      const value = list[index];
      positions.set(kind, index + 1);
      if (value === undefined) throw new Error(`No ${kind} ID remains in the fixture.`);
      return value;
    }
  };
}

function sampleProposal(): StoryStructureProposalV1 {
  return buildStoryStructureProposalV1FromCandidate({
    projectId: fixtureProjectId,
    bookId: targetBookId,
    expectedProjectVersion: BELLWETHER_FIXTURE.project.version,
    contextReceiptHash: receiptHash,
    candidate: {
      schemaId: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
      newParts: [{ localKey: "part-a", title: "Act One" }],
      newChapters: [
        {
          localKey: "ch-1",
          part: { kind: "new", localKey: "part-a" },
          title: "Chapter One",
          objective: "Introduce the harbor"
        }
      ],
      newPlannedScenes: [
        {
          localKey: "sc-1",
          host: { kind: "newChapter", localKey: "ch-1" },
          title: "Opening"
        }
      ],
      existingChapterUpdates: [],
      chapterReorders: [
        {
          part: { kind: "new", localKey: "part-a" },
          order: [{ kind: "new", localKey: "ch-1" }]
        }
      ],
      existingSceneMoves: [],
      existingSceneArchiveChanges: [],
      existingSceneIntentUpdates: []
    },
    context: storyStructureLoweringContextFromBook(
      fixtureProjectId,
      createBook({
        id: targetBookId,
        projectId: fixtureProjectId,
        title: "Signal",
        status: "drafting",
        manuscript: createManuscriptStructure({ parts: [], unassignedSceneIds: [] }),
        createdAt: now
      }),
      []
    ),
    ids: sequenceIds({
      storyStructureOperation: [
        "op-part",
        "op-ch-1",
        "op-reorder",
        "op-sc-1"
      ],
      part: ["part-canonical"],
      chapter: ["chapter-canonical"],
      scene: ["scene-canonical"]
    })
  });
}

async function harness(
  failAssignmentSave = false,
  status: "artifact-ready" | "awaiting-review" = "artifact-ready"
) {
  const projects = createMemoryProjectRepository(
    [BELLWETHER_FIXTURE],
    [createProjectMembership({ projectId: fixtureProjectId, accountId: owner, role: "owner", createdAt: now })]
  );
  const assignments = createMemoryStoryWorkAssignmentRepository();
  const proposals = createMemoryAgentProposalRepository();
  const runs = createMemoryAgentRunRepository();
  const receipts = createMemoryContextReceiptRepository();
  const payload = sampleProposal();
  const pointer = {
    proposalId: agentProposalId("structure-review-proposal"),
    artifactVersion: 1,
    contentHash: instructionContentHash("a".repeat(64))
  };
  const assignment = createStoryWorkAssignment({
    id: storyWorkAssignmentId("structure-review-assignment"),
    projectId: fixtureProjectId,
    initiatorAccountId: owner,
    version: 3,
    taskKind: "outline",
    brief: "Develop the book outline",
    constraints: "Respect canon",
    doneWhen: "Structure is ready for review",
    sources: [
      {
        kind: "book",
        bookId: targetBookId,
        projectVersion: BELLWETHER_FIXTURE.project.version
      }
    ],
    destination: { kind: "book", bookId: targetBookId, operation: "update" },
    provider: "openai",
    model: "gpt-4.1",
    status,
    steps: [{ id: "structure", title: "Propose structure", dependencies: [] }],
    currentArtifact: pointer,
    generatedArtifact: pointer,
    results: [],
    idempotencyKey: "structure-review-request",
    createdAt: now,
    updatedAt: now
  });
  await assignments.create({ assignment, requestFingerprint: pointer.contentHash });
  const receipt: ContextReceipt = {
    id: contextReceiptId("structure-review-receipt"),
    projectId: fixtureProjectId,
    workflowId: STORY_WORK_STRUCTURE_WORKFLOW_ID,
    workflowVersion: "1.0.0",
    layers: [],
    resources: [],
    excludedContextClasses: [],
    provider: "openai",
    model: "gpt-4.1",
    maxOutputTokens: 4000,
    wallClockSeconds: 90,
    toolCount: 0,
    egressClass: "openai-responses",
    outputSchemaId: STORY_STRUCTURE_SCHEMA_ID,
    receiptHash,
    primaryTarget: { kind: "book", id: targetBookId },
    createdAt: now
  };
  await receipts.insertImmutable(receipt);
  const queued = createQueuedAgentRun({
    id: agentRunId("structure-review-run"),
    projectId: fixtureProjectId,
    initiatorAccountId: owner,
    workflowId: STORY_WORK_STRUCTURE_WORKFLOW_ID,
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
  const running = createAgentRun({ ...queued, status: "running" });
  await runs.transition({ runId: queued.id, expectedStatus: "queued", next: running });
  await runs.transition({
    runId: queued.id,
    expectedStatus: "running",
    next: createAgentRun({ ...running, status: "ready", completedAt: now })
  });
  await proposals.create(
    createReadyAgentProposal({
      id: pointer.proposalId,
      projectId: fixtureProjectId,
      runId: queued.id,
      receiptId: receipt.id,
      status: "ready",
      outputSchemaId: STORY_STRUCTURE_SCHEMA_ID,
      payload,
      contentHash: pointer.contentHash,
      primaryTarget: { kind: "book", id: targetBookId },
      createdAt: now,
      updatedAt: now
    })
  );
  let nextId = 0;
  const review = createMemoryStoryStructureStoryWorkReviewUnitOfWork({
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
    ids: { create: (kind) => `${kind}-structure-${++nextId}` },
    hashPort: {
      digestSha256Hex: async (value) => createHash("sha256").update(value).digest("hex")
    }
  });
  const input: StoryStructureStoryWorkReviewInput = {
    action: "open",
    accountId: owner,
    projectId: fixtureProjectId,
    assignmentId: assignment.id,
    expectedAssignmentVersion: assignment.version,
    artifact: pointer,
    updatedAt: now
  };
  return { review, input, assignment, assignments, proposals, projects, pointer, payload };
}

describe("story structure review", () => {
  it("opens, edits human-reviewable fields, rejects, and preserves generated lineage", async () => {
    const h = await harness();
    const opened = await h.review.review(h.input);
    expect(opened.assignment.status).toBe("awaiting-review");
    const editedPayload = validateStoryStructureProposalV1({
      ...h.payload,
      operations: h.payload.operations.map((operation) =>
        operation.type === "part.create"
          ? { ...operation, title: "Act One (revised)" }
          : operation.type === "chapter.create"
            ? { ...operation, title: "Chapter One (revised)", objective: "Raise the stakes" }
            : operation
      )
    });
    const edited = await h.review.review({
      ...h.input,
      action: "edit",
      expectedAssignmentVersion: opened.assignment.version,
      payload: editedPayload
    });
    expect(edited.assignment.generatedArtifact).toEqual(h.pointer);
    expect(edited.assignment.currentArtifact?.artifactVersion).toBe(2);
    expect((await h.proposals.get(h.pointer.proposalId))?.status).toBe("stale");
    const rejectInput: StoryStructureStoryWorkReviewInput = {
      ...h.input,
      action: "reject",
      expectedAssignmentVersion: edited.assignment.version,
      artifact: edited.assignment.currentArtifact!
    };
    const rejected = await h.review.review(rejectInput);
    expect(rejected.assignment.status).toBe("rejected");
    expect((await h.review.review(rejectInput)).assignment.version).toBe(rejected.assignment.version);
  });

  it("refuses stale pointers, foreign owners, and authority-changing edits", async () => {
    const h = await harness(false, "awaiting-review");
    await expect(
      h.review.review({ ...h.input, accountId: accountId("foreign-owner") })
    ).rejects.toThrow();
    await expect(
      h.review.review({
        ...h.input,
        artifact: { ...h.pointer, contentHash: instructionContentHash("b".repeat(64)) }
      })
    ).rejects.toThrow();
    expect((await h.proposals.get(h.pointer.proposalId))?.status).toBe("ready");

    const reorderOperation = h.payload.operations.find((operation) => operation.type === "chapter.reorder");
    expect(reorderOperation?.type).toBe("chapter.reorder");
    if (reorderOperation?.type !== "chapter.reorder") return;

    const reordered = validateStoryStructureProposalV1({
      ...h.payload,
      operations: h.payload.operations.map((operation) =>
        operation.type === "chapter.reorder"
          ? {
              ...operation,
              chapterIds: [...operation.chapterIds].reverse()
            }
          : operation
      )
    });
    assertStoryStructureReviewEditPreservesAuthority(h.payload, reordered);

    const plannedScene = h.payload.operations.find(
      (operation) => operation.type === "scene.createPlanned"
    );
    expect(plannedScene?.type).toBe("scene.createPlanned");
    const addedOperation = validateStoryStructureProposalV1({
      ...h.payload,
      operations: [
        ...h.payload.operations,
        {
          type: "scene.setArchived",
          operationId: "op-new-archive",
          sceneId:
            plannedScene?.type === "scene.createPlanned"
              ? plannedScene.sceneId
              : sceneId("scene-canonical"),
          archived: true
        }
      ],
      dependencies: [
        ...h.payload.dependencies,
        { operationId: "op-new-archive", requires: [] }
      ]
    });
    expect(() =>
      assertStoryStructureReviewEditPreservesAuthority(h.payload, addedOperation)
    ).toThrow(/operation count/i);

    const changedDependency: StoryStructureProposalV1 = {
      ...h.payload,
      dependencies: Object.freeze(
        h.payload.dependencies.map((edge, index) =>
          index === 0
            ? Object.freeze({
                ...edge,
                requires: Object.freeze([...edge.requires, h.payload.operations[0]!.operationId])
              })
            : edge
        )
      )
    };
    expect(() =>
      assertStoryStructureReviewEditPreservesAuthority(h.payload, changedDependency)
    ).toThrow(/dependency records/i);

    await expect(
      h.review.review({
        ...h.input,
        action: "edit",
        payload: {
          ...h.payload,
          expectedProjectVersion: h.payload.expectedProjectVersion + 1
        }
      })
    ).rejects.toMatchObject({ code: "STORY_STRUCTURE_STORY_WORK_ARTIFACT_MISMATCH" });
  });

  it("rolls back proposal changes when assignment CAS fails", async () => {
    const h = await harness(true);
    await expect(h.review.review({ ...h.input, action: "reject" })).rejects.toThrow();
    expect((await h.proposals.get(h.pointer.proposalId))?.status).toBe("ready");
    expect((await h.assignments.get(h.input))?.status).toBe("artifact-ready");
  });

  it("rolls back edited proposals after a late CAS refusal", async () => {
    const h = await harness(true, "awaiting-review");
    await expect(
      h.review.review({
        ...h.input,
        action: "edit",
        payload: validateStoryStructureProposalV1({
          ...h.payload,
          operations: h.payload.operations.map((operation) =>
            operation.type === "part.create" ? { ...operation, title: "Revised act" } : operation
          )
        })
      })
    ).rejects.toThrow();
    expect(await h.proposals.listByProject(fixtureProjectId)).toHaveLength(1);
    expect((await h.proposals.get(h.pointer.proposalId))?.status).toBe("ready");
    expect((await h.assignments.get(h.input))?.currentArtifact).toEqual(h.pointer);
  });

  it("serializes duplicate edits so only one new artifact is saved", async () => {
    const h = await harness(false, "awaiting-review");
    const edit: StoryStructureStoryWorkReviewInput = {
      ...h.input,
      action: "edit",
      payload: validateStoryStructureProposalV1({
        ...h.payload,
        operations: h.payload.operations.map((operation) =>
          operation.type === "part.create" ? { ...operation, title: "Serialized edit" } : operation
        )
      })
    };
    const outcomes = await Promise.allSettled([h.review.review(edit), h.review.review(edit)]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await h.proposals.listByProject(fixtureProjectId)).toHaveLength(2);
  });
});
