import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ContextReceipt } from "./agent-context-receipt.js";
import {
  SCENE_STORY_WORK_WORKFLOW_ID,
  instructionContentHash,
  type AsyncHashPort
} from "./agent-domain.js";
import {
  createAgentRun,
  createQueuedAgentRun,
  createReadyAgentProposal
} from "./agent-runs-proposals.js";
import { CanvasVersionConflictError } from "./canvas.js";
import { createCanvasServices } from "./canvas-services.js";
import {
  agentProposalId,
  agentRunId,
  contextReceiptId,
  defineProjectRecords,
  sceneId,
  type ProjectRecords
} from "./domain.js";
import { BELLWETHER_FIXTURE, BELLWETHER_FIXTURE_PROJECT_ID } from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import {
  createMemoryCanvasRepository,
  createMemoryCanvasSceneCreationUnitOfWork
} from "./memory-canvas-repository.js";
import { createMemoryCaptureDocumentRepository } from "./memory-capture-document-repository.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { ProjectVersionConflictError } from "./project-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemorySceneDocumentRepository } from "./memory-scene-document-repository.js";
import {
  createMemorySceneStoryWorkApplyUnitOfWork,
  type MemorySceneStoryWorkFailurePoint
} from "./memory-scene-story-work-uow.js";
import { createMemoryStoryWorkAssignmentRepository } from "./memory-story-work-assignment-repository.js";
import { createMemoryStoryWorkAttemptRepository } from "./memory-story-work-attempt-repository.js";
import { validateSceneDraftV1 } from "./scene-draft-v1.js";
import { SceneStoryWorkContextStaleError } from "./scene-story-work-apply-policy.js";
import {
  StoryWorkApplyIdempotencyConflictError,
  type ApplySceneStoryWorkInput
} from "./scene-story-work-uow.js";
import {
  SceneLeaseConflictError,
  SceneLeaseExpiredError,
  SceneWorkingVersionConflictError,
  sceneContentHash,
  sceneLeaseHolderId
} from "./scene-documents.js";
import { createInitialSceneDocumentState } from "./scene-writing-services.js";
import {
  assembleStorySceneResource,
  assembleStoryStructureResource
} from "./story-context-receipt.js";
import { storyContextFromProjectRecords } from "./story-context.js";
import {
  createStoryWorkAssignment,
  storyWorkAssignmentId
} from "./story-work-assignment.js";
import { createStoryWorkAttempt } from "./story-work-attempt.js";
import { StoryWorkAssignmentTransitionError } from "./story-work-assignment.js";

const OWNER = accountId("account-scene-apply-owner");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-scene-apply");
const RUN_ID = agentRunId("run-scene-apply");
const PROPOSAL_ID = agentProposalId("proposal-scene-apply");
const RECEIPT_ID = contextReceiptId("receipt-scene-apply");
const SOURCE_SCENE = BELLWETHER_FIXTURE.scenes[0]!.id;
const CREATE_DEST = sceneId("scene-story-work-create-reserved");
const UPDATE_DEST = SOURCE_SCENE;
const CONTENT_HASH = instructionContentHash("a".repeat(64));
const RECEIPT_HASH = instructionContentHash("b".repeat(64));
const CREATED_AT = "2026-09-13T19:00:00.000Z";
const APPLIED_AT = "2026-09-13T20:05:00.000Z";
const LEASE_HOLDER = sceneLeaseHolderId("session-scene-apply");
const IDEMPOTENCY_KEY = "apply-scene-story-work-once";
const hashPort: AsyncHashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
});
const payload = validateSceneDraftV1({
  schemaId: "scene-draft-v1",
  prose: "Lantern light moved across the harbor wall.",
  sourceSceneIds: [SOURCE_SCENE]
});

type ApplyMode = ApplySceneStoryWorkInput["mode"];

type HarnessOptions = Readonly<{
  mode?: ApplyMode;
  failAfter?: MemorySceneStoryWorkFailurePoint;
  withCanvas?: boolean;
  staleSceneReceipt?: "version" | "hash";
  staleStructureReceipt?: "intent" | "order";
  wrongProjectVersion?: boolean;
  wrongCanvasVersion?: boolean;
  wrongHeadVersion?: boolean;
  wrongLeaseHolder?: boolean;
  expiredLease?: boolean;
}>;

function changedStructureRecords(
  records: ProjectRecords,
  change: NonNullable<HarnessOptions["staleStructureReceipt"]>
): ProjectRecords {
  if (change === "intent") {
    return defineProjectRecords({
      ...records,
      scenes: records.scenes.map((scene) =>
        scene.id === SOURCE_SCENE
          ? {
              ...scene,
              sketch: { ...scene.sketch, purpose: "A changed scene purpose." }
            }
          : scene
      )
    });
  }
  return defineProjectRecords({
    ...records,
    books: records.books.map((book, bookIndex) =>
      bookIndex === 0
        ? {
            ...book,
            manuscript: {
              ...book.manuscript,
              parts: book.manuscript.parts.map((part, partIndex) =>
                partIndex === 0
                  ? {
                      ...part,
                      chapters: part.chapters.map((chapter, chapterIndex) =>
                        chapterIndex === 0
                          ? { ...chapter, sceneIds: [...chapter.sceneIds].reverse() }
                          : chapter
                      )
                    }
                  : part
              )
            }
          }
        : book
    )
  });
}

async function createHarness(options: HarnessOptions = {}) {
  const mode = options.mode ?? "create-scene";
  const projectRecords = BELLWETHER_FIXTURE;
  const projects = createMemoryProjectRepository(
    [projectRecords],
    [
      createProjectMembership({
        projectId: projectRecords.project.id,
        accountId: OWNER,
        role: "owner",
        createdAt: CREATED_AT
      })
    ]
  );
  const sceneDocuments = createMemorySceneDocumentRepository();
  const canvases = createMemoryCanvasRepository();
  const assignments = createMemoryStoryWorkAssignmentRepository();
  const attempts = createMemoryStoryWorkAttemptRepository();
  const proposals = createMemoryAgentProposalRepository();
  const runs = createMemoryAgentRunRepository();
  const receipts = createMemoryContextReceiptRepository();

  const sourceScene = await createInitialSceneDocumentState({
    projectId: projectRecords.project.id,
    sceneId: SOURCE_SCENE,
    actorAccountId: OWNER,
    ids: { create: (kind) => `${kind}-scene-apply-source` },
    now: CREATED_AT
  });
  await sceneDocuments.initialize(sourceScene);
  const sourceContentHash = sourceScene.head.contentHash;

  const destinationId = mode === "create-scene" ? CREATE_DEST : UPDATE_DEST;
  if (mode !== "create-scene") {
    await sceneDocuments.acquireOrRenewLease({
      projectId: projectRecords.project.id,
      sceneId: UPDATE_DEST,
      holderId: options.wrongLeaseHolder === true
        ? sceneLeaseHolderId("foreign-lease-holder")
        : LEASE_HOLDER,
      now: CREATED_AT,
      expiresAt: options.expiredLease === true
        ? "2026-09-13T19:00:00.000Z"
        : "2026-09-13T22:00:00.000Z"
    });
  }

  let canvasVersion: number | undefined;
  if (options.withCanvas === true && mode === "create-scene") {
    const canvasServices = createCanvasServices({
      projects,
      canvases,
      sceneDocuments,
      sceneCreation: createMemoryCanvasSceneCreationUnitOfWork({
        projects,
        canvases,
        sceneDocuments
      }),
      ids: { create: (kind) => `${kind}-canvas-init` },
      clock: { now: () => CREATED_AT }
    });
    const workspace = await canvasServices.getCanvasWorkspace({
      accountId: OWNER,
      projectId: projectRecords.project.id
    });
    canvasVersion = workspace.board.version;
  }

  const assignment = createStoryWorkAssignment({
    id: ASSIGNMENT_ID,
    projectId: projectRecords.project.id,
    initiatorAccountId: OWNER,
    version: 5,
    taskKind: mode === "create-scene" ? "scene" : "revise",
    brief: "Develop the harbor scene.",
    constraints: "Respect the selected sources.",
    doneWhen: "A reviewable scene draft is ready.",
    sources: [
      {
        kind: "scene",
        sceneId: SOURCE_SCENE,
        projectVersion: projectRecords.project.version,
        workingVersion: sourceScene.head.workingVersion,
        contentHash: sourceContentHash
      }
    ],
    destination: {
      kind: "scene",
      sceneId: destinationId,
      operation: mode === "create-scene" ? "create" : "update"
    },
    provider: "openai",
    model: "gpt-4.1",
    status: "awaiting-review",
    steps: [{ id: "draft", title: "Draft scene", dependencies: [] }],
    currentArtifact: {
      proposalId: PROPOSAL_ID,
      artifactVersion: 1,
      contentHash: CONTENT_HASH
    },
    generatedArtifact: {
      proposalId: PROPOSAL_ID,
      artifactVersion: 1,
      contentHash: CONTENT_HASH
    },
    results: [],
    idempotencyKey: "assignment-scene-apply",
    createdAt: CREATED_AT,
    updatedAt: "2026-09-13T19:30:00.000Z"
  });
  await assignments.create({
    assignment,
    requestFingerprint: instructionContentHash("d".repeat(64))
  });

  const receiptHead = options.staleSceneReceipt === "version"
    ? { ...sourceScene.head, workingVersion: sourceScene.head.workingVersion + 1 }
    : options.staleSceneReceipt === "hash"
      ? { ...sourceScene.head, contentHash: sceneContentHash("9".repeat(64)) }
      : { ...sourceScene.head, contentHash: sourceContentHash };
  const sceneResource = await assembleStorySceneResource({
    projectId: projectRecords.project.id,
    sceneId: SOURCE_SCENE,
    head: receiptHead,
    inclusionReason: "Selected source scene.",
    hashPort
  });
  const structureRecords = options.staleStructureReceipt === undefined
    ? projectRecords
    : changedStructureRecords(projectRecords, options.staleStructureReceipt);
  const structureResource = await assembleStoryStructureResource({
    projectId: projectRecords.project.id,
    context: storyContextFromProjectRecords(structureRecords),
    inclusionReason: "Exact story context.",
    hashPort
  });
  const receipt: ContextReceipt = Object.freeze({
    id: RECEIPT_ID,
    projectId: projectRecords.project.id,
    workflowId: SCENE_STORY_WORK_WORKFLOW_ID,
    workflowVersion: "1",
    layers: [],
    resources: [structureResource.resource, sceneResource.resource],
    excludedContextClasses: [],
    provider: "openai",
    model: "gpt-4.1",
    maxOutputTokens: 6_000,
    wallClockSeconds: 60,
    toolCount: 0,
    egressClass: "openai-responses",
    outputSchemaId: "scene-draft-v1",
    targetSceneId: destinationId,
    primaryTarget: { kind: "scene" as const, id: destinationId },
    receiptHash: RECEIPT_HASH,
    createdAt: CREATED_AT
  });
  await receipts.insertImmutable(receipt);

  const queued = createQueuedAgentRun({
    id: RUN_ID,
    projectId: projectRecords.project.id,
    initiatorAccountId: OWNER,
    workflowId: SCENE_STORY_WORK_WORKFLOW_ID,
    workflowVersion: "1",
    provider: "openai",
    model: "gpt-4.1",
    receiptId: RECEIPT_ID,
    receiptHash: RECEIPT_HASH,
    status: "queued",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  });
  await runs.create(queued);
  await runs.transition({
    runId: RUN_ID,
    expectedStatus: "queued",
    next: createAgentRun({ ...queued, status: "running", updatedAt: CREATED_AT })
  });
  await runs.transition({
    runId: RUN_ID,
    expectedStatus: "running",
    next: createAgentRun({
      ...queued,
      status: "ready",
      updatedAt: CREATED_AT,
      completedAt: CREATED_AT,
      providerResponseId: "response-scene-apply",
      tokenUsage: { inputTokens: 80, outputTokens: 60, totalTokens: 140 }
    })
  });

  await proposals.create(
    createReadyAgentProposal({
      id: PROPOSAL_ID,
      projectId: projectRecords.project.id,
      runId: RUN_ID,
      receiptId: RECEIPT_ID,
      status: "ready",
      outputSchemaId: "scene-draft-v1",
      primaryTarget: { kind: "scene" as const, id: destinationId },
      payload,
      contentHash: CONTENT_HASH,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT
    })
  );

  await attempts.create({
    attempt: createStoryWorkAttempt({
      assignmentId: ASSIGNMENT_ID,
      projectId: projectRecords.project.id,
      initiatorAccountId: OWNER,
      runId: RUN_ID,
      version: 1,
      kind: "initial",
      sourceMode: "submitted-snapshot",
      instruction: assignment.brief,
      idempotencyKey: "attempt-scene-apply",
      requestFingerprint: instructionContentHash("e".repeat(64)),
      resultArtifact: assignment.generatedArtifact,
      createdAt: CREATED_AT,
      completedAt: CREATED_AT
    })
  });

  let idSequence = 0;
  const ids = {
    create(kind: string) {
      idSequence += 1;
      return `${kind}-scene-apply-${idSequence}`;
    }
  };

  const unitOfWork = createMemorySceneStoryWorkApplyUnitOfWork({
    projects,
    sceneDocuments,
    captures: createMemoryCaptureDocumentRepository(),
    canvases,
    assignments,
    attempts,
    proposals,
    runs,
    receipts,
    ids,
    hashPort,
    ...(options.failAfter === undefined ? {} : { failAfter: options.failAfter })
  });

  const book = projectRecords.books[0]!;
  const chapter = book.manuscript.parts[0]!.chapters[0]!;
  const baseInput = {
    accountId: OWNER,
    projectId: projectRecords.project.id,
    assignmentId: ASSIGNMENT_ID,
    expectedAssignmentVersion: assignment.version,
    proposalId: PROPOSAL_ID,
    expectedArtifactVersion: 1,
    expectedProposalContentHash: CONTENT_HASH,
    idempotencyKey: IDEMPOTENCY_KEY,
    appliedAt: APPLIED_AT
  };
  const destinationHead = mode === "create-scene"
    ? undefined
    : await sceneDocuments.getHead(UPDATE_DEST);
  const input: ApplySceneStoryWorkInput & Readonly<{ appliedAt: string }> =
    mode === "create-scene"
      ? {
          ...baseInput,
          mode: "create-scene",
          expectedProjectVersion: options.wrongProjectVersion === true
            ? projectRecords.project.version + 1
            : projectRecords.project.version,
          title: "Harbor Choice",
          manuscriptPlacement: {
            kind: "chapter",
            bookId: book.id,
            chapterId: chapter.id,
            position: 1
          },
          ...(options.withCanvas !== true || canvasVersion === undefined
            ? {}
            : {
                canvas: {
                  expectedCanvasVersion: options.wrongCanvasVersion === true
                    ? canvasVersion + 1
                    : canvasVersion,
                  scope: { scopeKind: "chapter", scopeId: chapter.id },
                  x: 12,
                  y: 24,
                  width: 240,
                  height: 160,
                  z: 2
                }
              })
        }
      : mode === "named-variant"
        ? {
            ...baseInput,
            mode: "named-variant",
            expectedSceneWorkingVersion: options.wrongHeadVersion === true
              ? (destinationHead?.workingVersion ?? 1) + 1
              : destinationHead?.workingVersion ?? 1,
            expectedSceneContentHash: destinationHead?.contentHash ?? sourceContentHash,
            leaseHolderId: LEASE_HOLDER,
            variantName: "Alternate ending"
          }
        : {
            ...baseInput,
            mode: "apply-revision",
            expectedSceneWorkingVersion: options.wrongHeadVersion === true
              ? (destinationHead?.workingVersion ?? 1) + 1
              : destinationHead?.workingVersion ?? 1,
            expectedSceneContentHash: destinationHead?.contentHash ?? sourceContentHash,
            leaseHolderId: LEASE_HOLDER
          };

  return {
    unitOfWork,
    input,
    projects,
    sceneDocuments,
    canvases,
    assignments,
    proposals,
    destinationId,
    mode,
    ids: () => idSequence,
    projectVersionBefore: projectRecords.project.version,
    destinationHeadBefore: destinationHead
  };
}

async function expectAwaitingReview(harness: Awaited<ReturnType<typeof createHarness>>) {
  expect((await harness.proposals.get(PROPOSAL_ID))?.status).toBe("ready");
  expect(
    (
      await harness.assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID
      })
    )?.status
  ).toBe("awaiting-review");
  expect((await harness.projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID))?.version).toBe(
    harness.projectVersionBefore
  );
}

describe("memory scene story work apply unit of work", () => {
  it("creates a scene with genesis and optional Canvas placement", async () => {
    const harness = await createHarness({ withCanvas: true });
    const applied = await harness.unitOfWork.applyScene(harness.input);
    expect(applied.replayed).toBe(false);
    expect(applied.result).toMatchObject({
      kind: "scene",
      sceneId: CREATE_DEST,
      workingVersion: 1
    });
    expect(applied.result).not.toHaveProperty("variantId");
    expect(
      (await harness.projects.listScenes(BELLWETHER_FIXTURE_PROJECT_ID)).some(
        (scene) => scene.id === CREATE_DEST
      )
    ).toBe(true);
    expect(await harness.sceneDocuments.getHead(CREATE_DEST)).toMatchObject({
      workingVersion: 1
    });
    expect((await harness.canvases.getBoard(BELLWETHER_FIXTURE_PROJECT_ID))?.version).toBe(2);
    expect(applied.assignment.status).toBe("applied");
    expect(applied.proposal.status).toBe("applied");
  });

  it("records a named variant without changing project, Canvas, or working head", async () => {
    const harness = await createHarness({ mode: "named-variant" });
    const beforeProject = await harness.projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID);
    const beforeCanvas = await harness.canvases.getBoard(BELLWETHER_FIXTURE_PROJECT_ID);
    const beforeHead = await harness.sceneDocuments.getHead(UPDATE_DEST);
    const applied = await harness.unitOfWork.applyScene(harness.input);
    expect(applied.result).toMatchObject({
      kind: "scene",
      sceneId: UPDATE_DEST,
      workingVersion: beforeHead?.workingVersion,
      variantId: expect.any(String)
    });
    expect((await harness.projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID))?.version).toBe(
      beforeProject?.version
    );
    expect(await harness.canvases.getBoard(BELLWETHER_FIXTURE_PROJECT_ID)).toEqual(beforeCanvas);
    expect(await harness.sceneDocuments.getHead(UPDATE_DEST)).toEqual(beforeHead);
  });

  it("applies a leased revision and advances the working head once", async () => {
    const harness = await createHarness({ mode: "apply-revision" });
    const beforeVersion = harness.destinationHeadBefore?.workingVersion ?? 1;
    const applied = await harness.unitOfWork.applyScene(harness.input);
    expect(applied.result).toMatchObject({
      kind: "scene",
      sceneId: UPDATE_DEST,
      workingVersion: beforeVersion + 1
    });
    expect((await harness.sceneDocuments.getHead(UPDATE_DEST))?.workingVersion).toBe(
      beforeVersion + 1
    );
  });

  it("replays an exact apply without allocating IDs or mutating participants", async () => {
    const harness = await createHarness();
    const first = await harness.unitOfWork.applyScene(harness.input);
    const idsAfterFirst = harness.ids();
    const projectAfterApply = await harness.projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID);
    const [books, scenes, storyKnowledge, editions] = await Promise.all([
      harness.projects.listBooks(BELLWETHER_FIXTURE_PROJECT_ID),
      harness.projects.listScenes(BELLWETHER_FIXTURE_PROJECT_ID),
      harness.projects.listStoryKnowledge(BELLWETHER_FIXTURE_PROJECT_ID),
      harness.projects.listEditions(BELLWETHER_FIXTURE_PROJECT_ID)
    ]);
    await harness.projects.transaction((writer) => {
      writer.replaceProjectRecords(
        defineProjectRecords({
          project: {
            ...projectAfterApply!,
            version: projectAfterApply!.version + 1,
            title: "Unrelated project edit after apply"
          },
          books,
          scenes,
          storyKnowledge,
          editions
        }),
        projectAfterApply!.version
      );
    });
    const replay = await harness.unitOfWork.applyScene(harness.input);
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(first.result);
    expect(harness.ids()).toBe(idsAfterFirst);
  });

  it("refuses replay when the idempotency key or body does not match", async () => {
    const harness = await createHarness();
    await harness.unitOfWork.applyScene(harness.input);
    await expect(
      harness.unitOfWork.applyScene({
        ...harness.input,
        idempotencyKey: "different-apply-key"
      })
    ).rejects.toBeInstanceOf(StoryWorkApplyIdempotencyConflictError);
    const createInput = harness.input;
    if (createInput.mode !== "create-scene") throw new Error("expected create input");
    await expect(
      harness.unitOfWork.applyScene({
        ...createInput,
        title: "A different title"
      })
    ).rejects.toBeInstanceOf(StoryWorkApplyIdempotencyConflictError);
  });

  it("refuses stale context, head, and lease preconditions without mutation", async () => {
    for (const staleSceneReceipt of ["version", "hash"] as const) {
      const harness = await createHarness({ staleSceneReceipt });
      await expect(harness.unitOfWork.applyScene(harness.input)).rejects.toBeInstanceOf(
        SceneStoryWorkContextStaleError
      );
      await expectAwaitingReview(harness);
    }
    for (const staleStructureReceipt of ["intent", "order"] as const) {
      const harness = await createHarness({ staleStructureReceipt });
      await expect(harness.unitOfWork.applyScene(harness.input)).rejects.toBeInstanceOf(
        SceneStoryWorkContextStaleError
      );
      await expectAwaitingReview(harness);
    }
    const staleAssignment = await createHarness();
    await expect(
      staleAssignment.unitOfWork.applyScene({
        ...staleAssignment.input,
        expectedAssignmentVersion: staleAssignment.input.expectedAssignmentVersion - 1
      })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentTransitionError);
    await expectAwaitingReview(staleAssignment);

    const headConflict = await createHarness({ mode: "apply-revision", wrongHeadVersion: true });
    await expect(headConflict.unitOfWork.applyScene(headConflict.input)).rejects.toBeInstanceOf(
      SceneWorkingVersionConflictError
    );
    await expectAwaitingReview(headConflict);

    const leaseConflict = await createHarness({ mode: "apply-revision", wrongLeaseHolder: true });
    await expect(leaseConflict.unitOfWork.applyScene(leaseConflict.input)).rejects.toBeInstanceOf(
      SceneLeaseConflictError
    );
    await expectAwaitingReview(leaseConflict);

    const expiredLease = await createHarness({ mode: "apply-revision", expiredLease: true });
    await expect(expiredLease.unitOfWork.applyScene(expiredLease.input)).rejects.toBeInstanceOf(
      SceneLeaseExpiredError
    );
    await expectAwaitingReview(expiredLease);
  });

  it("refuses project and Canvas CAS conflicts on create without mutation", async () => {
    const projectConflict = await createHarness({ wrongProjectVersion: true });
    await expect(projectConflict.unitOfWork.applyScene(projectConflict.input)).rejects.toBeInstanceOf(
      ProjectVersionConflictError
    );
    await expectAwaitingReview(projectConflict);

    const canvasConflict = await createHarness({
      withCanvas: true,
      wrongCanvasVersion: true
    });
    await expect(canvasConflict.unitOfWork.applyScene(canvasConflict.input)).rejects.toBeInstanceOf(
      CanvasVersionConflictError
    );
    await expectAwaitingReview(canvasConflict);
  });

  for (const failAfter of [
    "after-project",
    "after-scene-document",
    "after-canvas",
    "after-proposal",
    "before-assignment"
  ] as const) {
    it(`rolls every participant back after an injected ${failAfter} failure`, async () => {
      const harness = await createHarness({
        withCanvas: failAfter === "after-canvas",
        failAfter
      });
      await expect(harness.unitOfWork.applyScene(harness.input)).rejects.toThrow(
        /Injected scene apply failure/
      );
      await expectAwaitingReview(harness);
      if (harness.mode === "create-scene") {
        expect(
          (await harness.projects.listScenes(BELLWETHER_FIXTURE_PROJECT_ID)).some(
            (scene) => scene.id === CREATE_DEST
          )
        ).toBe(false);
        expect(await harness.sceneDocuments.getHead(CREATE_DEST)).toBeUndefined();
      }
    });
  }
});
