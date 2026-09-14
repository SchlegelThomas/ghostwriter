import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  CanvasVersionConflictError,
  ProjectVersionConflictError,
  SCENE_STORY_WORK_WORKFLOW_ID,
  SceneLeaseConflictError,
  SceneLeaseExpiredError,
  SceneVariantNameConflictError,
  SceneWorkingVersionConflictError,
  StoryWorkAssignmentNotFoundError,
  captureContentHash,
  captureId,
  createCaptureServices,
  createInitialCaptureDocumentState,
  createSceneWritingServices,
  StoryWorkAssignmentTransitionError,
  accountId,
  agentProposalId,
  agentRunId,
  assembleStorySceneResource,
  assembleStoryStructureResource,
  contextReceiptId,
  createAgentRun,
  createCanvasServices,
  createInitialSceneDocumentState,
  createProjectMembership,
  createQueuedAgentRun,
  createReadyAgentProposal,
  createStoryWorkAssignment,
  createStoryWorkAttempt,
  applyProjectCommandToRecords,
  defineProjectRecords,
  instructionContentHash,
  sceneId,
  sceneContentHash,
  sceneLeaseHolderId,
  storyContextFromProjectRecords,
  storyWorkAssignmentId,
  type ContextReceipt,
  type ProjectRecords
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import {
  createPostgresAgentProposalRepository,
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import { createPostgresCanvasRepository } from "./postgres-canvas-repository.js";
import { createPostgresCanvasSceneCreationUnitOfWork } from "./postgres-canvas-scene-creation.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresCaptureDocumentRepository } from "./postgres-capture-document-repository.js";
import { createPostgresSceneDocumentRepository } from "./postgres-scene-document-repository.js";
import { createPostgresSceneStoryWorkApplyUnitOfWork } from "./postgres-scene-story-work-uow.js";
import {
  createPostgresStoryWorkAssignmentRepository,
  createPostgresStoryWorkAttemptRepository
} from "./postgres-story-work-repository.js";
import { sceneDocuments, sceneRevisions, sceneVariants, user } from "./schema.js";
import { seedProject } from "./seed.js";

const OWNER = accountId("account-scene-apply-postgres-owner");
const FOREIGN = accountId("account-scene-apply-postgres-foreign");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-scene-apply-postgres");
const RUN_ID = agentRunId("run-scene-apply-postgres");
const PROPOSAL_ID = agentProposalId("proposal-scene-apply-postgres");
const RECEIPT_ID = contextReceiptId("receipt-scene-apply-postgres");
const SOURCE_SCENE = BELLWETHER_FIXTURE.scenes[0]!.id;
const CAPTURE_SOURCE = captureId("capture-scene-apply-postgres");
const CREATE_DEST = sceneId("scene-story-work-postgres-create");
const UPDATE_DEST = SOURCE_SCENE;
const CONTENT_HASH = instructionContentHash("a".repeat(64));
const RECEIPT_HASH = instructionContentHash("b".repeat(64));
const CREATED_AT = "2026-09-13T19:00:00.000Z";
const APPLIED_AT = "2026-09-13T20:05:00.000Z";
const LEASE_HOLDER = sceneLeaseHolderId("session-scene-apply-postgres");
const IDEMPOTENCY_KEY = "apply-scene-story-work-postgres-once";
const hashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
});
const payload = Object.freeze({
  schemaId: "scene-draft-v1" as const,
  prose: "Lantern light moved across the harbor wall.",
  sourceSceneIds: Object.freeze([SOURCE_SCENE])
});

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

type ApplyMode = "create-scene" | "named-variant" | "apply-revision";

type HarnessOptions = Readonly<{
  mode?: ApplyMode;
  withCanvas?: boolean;
  staleSceneReceipt?: "version" | "hash";
  staleStructureReceipt?: "intent" | "order";
  wrongProjectVersion?: boolean;
  wrongCanvasVersion?: boolean;
  wrongHeadVersion?: boolean;
  wrongLeaseHolder?: boolean;
  expiredLease?: boolean;
  withCapture?: boolean;
  captureMissing?: boolean;
  duplicateReservedDestination?: boolean;
  requestCanvasWithoutBoard?: boolean;
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
  const { db, client, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values([
    {
      id: OWNER,
      name: "Scene Apply Owner",
      email: "scene-apply-owner@example.test",
      emailVerified: true
    },
    {
      id: FOREIGN,
      name: "Scene Apply Foreign",
      email: "scene-apply-foreign@example.test",
      emailVerified: true
    }
  ]);
  const exec = toRepositoryDatabase(db);
  const projects = createPostgresProjectRepository(exec);
  let projectRecordsForHarness = BELLWETHER_FIXTURE;
  await seedProject(projects, BELLWETHER_FIXTURE);
  await projects.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: OWNER,
        role: "owner",
        createdAt: CREATED_AT
      })
    );
  });

  const sceneDocuments = createPostgresSceneDocumentRepository(exec);
  const sourceScene = await createInitialSceneDocumentState({
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    sceneId: SOURCE_SCENE,
    actorAccountId: OWNER,
    ids: { create: (kind) => `${kind}-scene-apply-postgres-source` },
    now: CREATED_AT
  });
  await sceneDocuments.initialize(sourceScene);
  const sourceContentHash = sourceScene.head.contentHash;

  if (options.duplicateReservedDestination === true && mode === "create-scene") {
    const book = BELLWETHER_FIXTURE.books[0]!;
    const chapter = book.manuscript.parts[0]!.chapters[0]!;
    const occupiedRecords = applyProjectCommandToRecords(
      BELLWETHER_FIXTURE,
      {
        type: "scene.create",
        bookId: book.id,
        chapterId: chapter.id,
        title: "Duplicate reserved scene"
      },
      {
        create(kind: string) {
          if (kind === "scene") return CREATE_DEST;
          throw new Error(`Unexpected id kind ${kind}.`);
        }
      },
      CREATED_AT
    );
    await projects.transaction((writer) => {
      writer.replaceProjectRecords(occupiedRecords, BELLWETHER_FIXTURE.project.version);
    });
    projectRecordsForHarness = occupiedRecords;
  }

  const captureDocuments = createPostgresCaptureDocumentRepository(exec);
  let captureHead:
    | Awaited<ReturnType<typeof captureDocuments.initialize>>
    | undefined;
  if (options.withCapture === true) {
    const initialCapture = await createInitialCaptureDocumentState({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      actorAccountId: OWNER,
      sourceModality: "text",
      ids: {
        create(kind: string) {
          if (kind === "capture") return CAPTURE_SOURCE;
          return `${kind}-scene-apply-postgres-capture`;
        }
      },
      now: CREATED_AT
    });
    captureHead = await captureDocuments.initialize(initialCapture);
  }

  const destinationId = mode === "create-scene" ? CREATE_DEST : UPDATE_DEST;
  if (mode !== "create-scene") {
    await sceneDocuments.acquireOrRenewLease({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: UPDATE_DEST,
      holderId:
        options.wrongLeaseHolder === true
          ? sceneLeaseHolderId("foreign-lease-holder")
          : LEASE_HOLDER,
      now: CREATED_AT,
      expiresAt:
        options.expiredLease === true
          ? "2026-09-13T19:00:00.000Z"
          : "2026-09-13T22:00:00.000Z"
    });
  }

  let canvasVersion: number | undefined;
  const canvases = createPostgresCanvasRepository(exec);
  if (options.withCanvas === true && mode === "create-scene") {
    let canvasId = 0;
    const canvasServices = createCanvasServices({
      projects,
      canvases,
      sceneDocuments,
      sceneCreation: createPostgresCanvasSceneCreationUnitOfWork(exec),
      ids: {
        create(kind: string) {
          canvasId += 1;
          return `${kind}-canvas-init-postgres-${canvasId}`;
        }
      },
      clock: { now: () => CREATED_AT }
    });
    const workspace = await canvasServices.getCanvasWorkspace({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    });
    canvasVersion = workspace.board.version;
  }

  const assignment = createStoryWorkAssignment({
    id: ASSIGNMENT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
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
        projectVersion: projectRecordsForHarness.project.version,
        workingVersion: sourceScene.head.workingVersion,
        contentHash: sourceContentHash
      },
      ...(options.withCapture === true || options.captureMissing === true
        ? [
            {
              kind: "capture" as const,
              captureId: CAPTURE_SOURCE,
              workingVersion: captureHead?.workingVersion ?? 1,
              contentHash: captureHead?.contentHash ?? captureContentHash("f".repeat(64))
            }
          ]
        : [])
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
    idempotencyKey: "assignment-scene-apply-postgres",
    createdAt: CREATED_AT,
    updatedAt: "2026-09-13T19:30:00.000Z"
  });
  const assignments = createPostgresStoryWorkAssignmentRepository(exec);
  expect(
    await assignments.create({
      assignment,
      requestFingerprint: instructionContentHash("d".repeat(64))
    })
  ).toMatchObject({ ok: true });

  const receiptHead =
    options.staleSceneReceipt === "version"
      ? { ...sourceScene.head, workingVersion: sourceScene.head.workingVersion + 1 }
      : options.staleSceneReceipt === "hash"
        ? {
            ...sourceScene.head,
            contentHash: sceneContentHash("9".repeat(64))
          }
        : { ...sourceScene.head, contentHash: sourceContentHash };
  const sceneResource = await assembleStorySceneResource({
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    sceneId: SOURCE_SCENE,
    head: receiptHead,
    inclusionReason: "Selected source scene.",
    hashPort
  });
  const structureRecords =
    options.staleStructureReceipt === undefined
      ? projectRecordsForHarness
      : changedStructureRecords(projectRecordsForHarness, options.staleStructureReceipt);
  const structureResource = await assembleStoryStructureResource({
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    context: storyContextFromProjectRecords(structureRecords),
    inclusionReason: "Exact story context.",
    hashPort
  });
  const captureText = "Keep the foghorn as the scene clock.";
  const captureTextHash = instructionContentHash(
    await hashPort.digestSha256Hex(captureText)
  );
  const captureResource =
    options.withCapture === true || options.captureMissing === true
      ? Object.freeze({
          resourceClass: "capture" as const,
          captureId: CAPTURE_SOURCE,
          workingVersion: captureHead?.workingVersion ?? 1,
          contentHash: captureHead?.contentHash ?? captureContentHash("f".repeat(64)),
          inclusionReason: "Selected Capture.",
          providerTextCharCount: captureText.length,
          providerTextHash: captureTextHash
        })
      : undefined;
  const receipt: ContextReceipt = Object.freeze({
    id: RECEIPT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    workflowId: SCENE_STORY_WORK_WORKFLOW_ID,
    workflowVersion: "1",
    layers: [],
    resources: [
      structureResource.resource,
      sceneResource.resource,
      ...(captureResource === undefined ? [] : [captureResource])
    ],
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
  const receipts = createPostgresContextReceiptRepository(exec);
  expect(await receipts.insertImmutable(receipt)).toMatchObject({ ok: true });

  const runs = createPostgresAgentRunRepository(exec);
  const queued = createQueuedAgentRun({
    id: RUN_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
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
  expect(await runs.create(queued)).toMatchObject({ ok: true });
  expect(
    await runs.transition({
      runId: RUN_ID,
      expectedStatus: "queued",
      next: createAgentRun({ ...queued, status: "running", updatedAt: CREATED_AT })
    })
  ).toMatchObject({ ok: true });
  expect(
    await runs.transition({
      runId: RUN_ID,
      expectedStatus: "running",
      next: createAgentRun({
        ...queued,
        status: "ready",
        updatedAt: CREATED_AT,
        completedAt: CREATED_AT,
        providerResponseId: "response-scene-apply-postgres",
        tokenUsage: { inputTokens: 80, outputTokens: 60, totalTokens: 140 }
      })
    })
  ).toMatchObject({ ok: true });

  const proposals = createPostgresAgentProposalRepository(exec);
  expect(
    await proposals.create(
      createReadyAgentProposal({
        id: PROPOSAL_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        runId: RUN_ID,
        receiptId: RECEIPT_ID,
        status: "ready",
        outputSchemaId: "scene-draft-v1",
        primaryTarget: { kind: "scene", id: destinationId },
        payload,
        contentHash: CONTENT_HASH,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT
      })
    )
  ).toMatchObject({ ok: true });

  const attempts = createPostgresStoryWorkAttemptRepository(exec);
  expect(
    await attempts.create({
      attempt: createStoryWorkAttempt({
        assignmentId: ASSIGNMENT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        initiatorAccountId: OWNER,
        runId: RUN_ID,
        version: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: assignment.brief,
        idempotencyKey: "attempt-scene-apply-postgres",
        requestFingerprint: instructionContentHash("e".repeat(64)),
        resultArtifact: assignment.generatedArtifact,
        createdAt: CREATED_AT,
        completedAt: CREATED_AT
      })
    })
  ).toMatchObject({ ok: true });

  let idSequence = 0;
  const apply = createPostgresSceneStoryWorkApplyUnitOfWork({
    db: exec,
    ids: {
      create(kind: string) {
        idSequence += 1;
        return `${kind}-scene-apply-postgres-${idSequence}`;
      }
    },
    hashPort
  });

  const book = BELLWETHER_FIXTURE.books[0]!;
  const chapter = book.manuscript.parts[0]!.chapters[0]!;
  const destinationHead =
    mode === "create-scene" ? undefined : await sceneDocuments.getHead(UPDATE_DEST);
  const baseInput = {
    accountId: OWNER,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    assignmentId: ASSIGNMENT_ID,
    expectedAssignmentVersion: assignment.version,
    proposalId: PROPOSAL_ID,
    expectedArtifactVersion: 1,
    expectedProposalContentHash: CONTENT_HASH,
    idempotencyKey: IDEMPOTENCY_KEY,
    appliedAt: APPLIED_AT
  };
  const input =
    mode === "create-scene"
      ? {
          ...baseInput,
          mode: "create-scene" as const,
          expectedProjectVersion:
            options.wrongProjectVersion === true
              ? (options.duplicateReservedDestination === true
                  ? BELLWETHER_FIXTURE.project.version + 2
                  : BELLWETHER_FIXTURE.project.version + 1)
              : options.duplicateReservedDestination === true
                ? BELLWETHER_FIXTURE.project.version + 1
                : BELLWETHER_FIXTURE.project.version,
          title: "Harbor Choice",
          manuscriptPlacement: {
            kind: "chapter" as const,
            bookId: book.id,
            chapterId: chapter.id,
            position: 1
          },
          ...(options.requestCanvasWithoutBoard === true
            ? {
                canvas: {
                  expectedCanvasVersion: 1,
                  scope: { scopeKind: "chapter" as const, scopeId: chapter.id },
                  x: 12,
                  y: 24,
                  width: 240,
                  height: 160,
                  z: 2
                }
              }
            : options.withCanvas !== true || canvasVersion === undefined
              ? {}
              : {
                  canvas: {
                    expectedCanvasVersion:
                      options.wrongCanvasVersion === true
                        ? canvasVersion + 1
                        : canvasVersion,
                    scope: { scopeKind: "chapter" as const, scopeId: chapter.id },
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
            mode: "named-variant" as const,
            expectedSceneWorkingVersion:
              options.wrongHeadVersion === true
                ? (destinationHead?.workingVersion ?? 1) + 1
                : (destinationHead?.workingVersion ?? 1),
            expectedSceneContentHash: destinationHead?.contentHash ?? sourceContentHash,
            leaseHolderId: LEASE_HOLDER,
            variantName: "Alternate ending"
          }
        : {
            ...baseInput,
            mode: "apply-revision" as const,
            expectedSceneWorkingVersion:
              options.wrongHeadVersion === true
                ? (destinationHead?.workingVersion ?? 1) + 1
                : (destinationHead?.workingVersion ?? 1),
            expectedSceneContentHash: destinationHead?.contentHash ?? sourceContentHash,
            leaseHolderId: LEASE_HOLDER
          };

  return {
    client,
    db,
    projects,
    sceneDocuments,
    canvases,
    assignments,
    proposals,
    apply,
    input,
    mode,
    destinationId,
    ids: () => idSequence,
    projectVersionBefore:
      options.duplicateReservedDestination === true
        ? BELLWETHER_FIXTURE.project.version + 1
        : BELLWETHER_FIXTURE.project.version,
    destinationHeadBefore: destinationHead,
    captureDocuments,
    captureHead
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

describe("postgres scene story work apply unit of work", () => {
  it("creates a scene with genesis and optional Canvas placement", async () => {
    const harness = await createHarness({ withCanvas: true });
    const applied = await harness.apply.applyScene(harness.input);
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
    const applied = await harness.apply.applyScene(harness.input);
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
    const applied = await harness.apply.applyScene(harness.input);
    expect(applied.result).toMatchObject({
      kind: "scene",
      sceneId: UPDATE_DEST,
      workingVersion: beforeVersion + 1
    });
    expect((await harness.sceneDocuments.getHead(UPDATE_DEST))?.workingVersion).toBe(
      beforeVersion + 1
    );
  });

  it("replays an exact apply after unrelated later canonical changes", async () => {
    const harness = await createHarness();
    const first = await harness.apply.applyScene(harness.input);
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
    const replay = await harness.apply.applyScene(harness.input);
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(first.result);
    expect(harness.ids()).toBe(idsAfterFirst);
  });

  it("serializes concurrent exact applies into one commit and one replay", async () => {
    const harness = await createHarness();
    const results = await Promise.all([
      harness.apply.applyScene(harness.input),
      harness.apply.applyScene(harness.input)
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
  });

  it("refuses replay when the idempotency key or body does not match", async () => {
    const harness = await createHarness();
    await harness.apply.applyScene(harness.input);
    await expect(
      harness.apply.applyScene({
        ...harness.input,
        idempotencyKey: "different-apply-key"
      })
    ).rejects.toMatchObject({ code: "STORY_WORK_APPLY_IDEMPOTENCY_CONFLICT" });
    if (harness.input.mode !== "create-scene") throw new Error("expected create input");
    await expect(
      harness.apply.applyScene({
        ...harness.input,
        title: "A different title"
      })
    ).rejects.toMatchObject({ code: "STORY_WORK_APPLY_IDEMPOTENCY_CONFLICT" });
  });

  it("hides foreign ownership as not found", async () => {
    const harness = await createHarness();
    await expect(
      harness.apply.applyScene({ ...harness.input, accountId: FOREIGN })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentNotFoundError);
    await expectAwaitingReview(harness);
  });

  it("refuses stale context, head, and lease preconditions without mutation", async () => {
    for (const staleSceneReceipt of ["version", "hash"] as const) {
      const harness = await createHarness({ staleSceneReceipt });
      await expect(harness.apply.applyScene(harness.input)).rejects.toMatchObject({
        code: "SCENE_STORY_WORK_CONTEXT_STALE"
      });
      await expectAwaitingReview(harness);
    }
    for (const staleStructureReceipt of ["intent", "order"] as const) {
      const harness = await createHarness({ staleStructureReceipt });
      await expect(harness.apply.applyScene(harness.input)).rejects.toMatchObject({
        code: "SCENE_STORY_WORK_CONTEXT_STALE"
      });
      await expectAwaitingReview(harness);
    }
    const staleAssignment = await createHarness();
    await expect(
      staleAssignment.apply.applyScene({
        ...staleAssignment.input,
        expectedAssignmentVersion: staleAssignment.input.expectedAssignmentVersion - 1
      })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentTransitionError);
    await expectAwaitingReview(staleAssignment);

    const headConflict = await createHarness({ mode: "apply-revision", wrongHeadVersion: true });
    await expect(headConflict.apply.applyScene(headConflict.input)).rejects.toBeInstanceOf(
      SceneWorkingVersionConflictError
    );
    await expectAwaitingReview(headConflict);

    const leaseConflict = await createHarness({ mode: "apply-revision", wrongLeaseHolder: true });
    await expect(leaseConflict.apply.applyScene(leaseConflict.input)).rejects.toBeInstanceOf(
      SceneLeaseConflictError
    );
    await expectAwaitingReview(leaseConflict);

    const expiredLease = await createHarness({ mode: "apply-revision", expiredLease: true });
    await expect(expiredLease.apply.applyScene(expiredLease.input)).rejects.toBeInstanceOf(
      SceneLeaseExpiredError
    );
    await expectAwaitingReview(expiredLease);
  });

  it("refuses project and Canvas CAS conflicts on create without mutation", async () => {
    const projectConflict = await createHarness({ wrongProjectVersion: true });
    await expect(projectConflict.apply.applyScene(projectConflict.input)).rejects.toBeInstanceOf(
      ProjectVersionConflictError
    );
    await expectAwaitingReview(projectConflict);

    const canvasConflict = await createHarness({
      withCanvas: true,
      wrongCanvasVersion: true
    });
    await expect(canvasConflict.apply.applyScene(canvasConflict.input)).rejects.toBeInstanceOf(
      CanvasVersionConflictError
    );
    await expectAwaitingReview(canvasConflict);
  });

  it("rolls every canonical write back when assignment CAS fails", async () => {
    const harness = await createHarness({ withCanvas: true });
    await harness.client.exec(`
      create function reject_scene_assignment_apply() returns trigger as $$
      begin
        if new.status = 'applied' then
          raise exception 'injected scene assignment persistence failure';
        end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger reject_scene_assignment_apply
      before update on story_work_assignments
      for each row execute function reject_scene_assignment_apply();
    `);
    await expect(harness.apply.applyScene(harness.input)).rejects.toBeDefined();
    await expectAwaitingReview(harness);
    expect(
      (await harness.projects.listScenes(BELLWETHER_FIXTURE_PROJECT_ID)).some(
        (scene) => scene.id === CREATE_DEST
      )
    ).toBe(false);
    expect(await harness.sceneDocuments.getHead(CREATE_DEST)).toBeUndefined();
    expect(await harness.db.select().from(sceneDocuments)).toHaveLength(1);
  });

  it("rolls project and scene genesis back when proposal mark-applied fails", async () => {
    const harness = await createHarness();
    await harness.client.exec(`
      create function reject_scene_proposal_apply() returns trigger as $$
      begin
        if new.status = 'applied' then
          raise exception 'injected scene proposal persistence failure';
        end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger reject_scene_proposal_apply
      before update on agent_proposals
      for each row execute function reject_scene_proposal_apply();
    `);
    await expect(harness.apply.applyScene(harness.input)).rejects.toBeDefined();
    await expectAwaitingReview(harness);
    expect(
      (await harness.projects.listScenes(BELLWETHER_FIXTURE_PROJECT_ID)).some(
        (scene) => scene.id === CREATE_DEST
      )
    ).toBe(false);
  });

  it("refuses a duplicate variant name without mutation", async () => {
    const harness = await createHarness({ mode: "named-variant" });
    const writing = createSceneWritingServices({
      projects: harness.projects,
      sceneDocuments: harness.sceneDocuments,
      ids: {
        create(kind: string) {
          return `${kind}-seed-variant-postgres`;
        }
      },
      clock: { now: () => CREATED_AT }
    });
    await writing.createNamedSceneVariant({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: UPDATE_DEST,
      sessionId: LEASE_HOLDER,
      expectedWorkingVersion: harness.destinationHeadBefore?.workingVersion ?? 1,
      name: "Alternate ending"
    });
    const variantsBefore = await harness.db.select().from(sceneVariants);
    const headBefore = await harness.sceneDocuments.getHead(UPDATE_DEST);
    await expect(harness.apply.applyScene(harness.input)).rejects.toBeInstanceOf(
      SceneVariantNameConflictError
    );
    await expectAwaitingReview(harness);
    expect(await harness.sceneDocuments.getHead(UPDATE_DEST)).toEqual(headBefore);
    expect(await harness.db.select().from(sceneVariants)).toEqual(variantsBefore);
  });

  it("refuses create when the reserved destination already exists", async () => {
    const harness = await createHarness({ duplicateReservedDestination: true });
    await expect(harness.apply.applyScene(harness.input)).rejects.toMatchObject({
      code: "DUPLICATE_ID"
    });
    await expectAwaitingReview(harness);
    expect(await harness.sceneDocuments.getHead(CREATE_DEST)).toBeUndefined();
  });

  it("accepts unchanged Capture sources and refuses changed, archived, or missing Capture", async () => {
    const success = await createHarness({ withCapture: true });
    const applied = await success.apply.applyScene(success.input);
    expect(applied.result).toMatchObject({ kind: "scene", sceneId: CREATE_DEST });

    const changed = await createHarness({ withCapture: true });
    let captureIdCounter = 0;
    const captureServices = createCaptureServices({
      projects: changed.projects,
      captureDocuments: changed.captureDocuments,
      ids: {
        create(kind: string) {
          captureIdCounter += 1;
          return `${kind}-capture-stale-${captureIdCounter}`;
        }
      },
      clock: { now: () => APPLIED_AT }
    });
    const head = changed.captureHead!;
    await captureServices.saveCaptureDocument({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: head.captureId,
      expectedWorkingVersion: head.workingVersion,
      document: {
        schemaVersion: 1,
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { id: "capture-block-stale" },
              content: [{ type: "text", text: "Changed capture prose." }]
            }
          ]
        }
      }
    });
    await expect(changed.apply.applyScene(changed.input)).rejects.toMatchObject({
      code: "SCENE_STORY_WORK_CONTEXT_STALE"
    });
    await expectAwaitingReview(changed);

    const archived = await createHarness({ withCapture: true });
    const archivedHead = archived.captureHead!;
    await archived.captureDocuments.setArchived({
      captureId: archivedHead.captureId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      archived: true,
      actorAccountId: OWNER,
      now: APPLIED_AT
    });
    await expect(archived.apply.applyScene(archived.input)).rejects.toMatchObject({
      code: "SCENE_STORY_WORK_CONTEXT_STALE"
    });
    await expectAwaitingReview(archived);

    const missing = await createHarness({ captureMissing: true });
    await expect(missing.apply.applyScene(missing.input)).rejects.toMatchObject({
      code: "SCENE_STORY_WORK_CONTEXT_STALE"
    });
    await expectAwaitingReview(missing);
  });

  it("refuses create-with-canvas when the Canvas board is missing", async () => {
    const harness = await createHarness({ requestCanvasWithoutBoard: true });
    expect(await harness.canvases.getBoard(BELLWETHER_FIXTURE_PROJECT_ID)).toBeUndefined();
    await expect(harness.apply.applyScene(harness.input)).rejects.toBeInstanceOf(
      CanvasVersionConflictError
    );
    await expectAwaitingReview(harness);
  });

  it("rolls leased scene mutations back when proposal mark-applied fails", async () => {
    for (const mode of ["named-variant", "apply-revision"] as const) {
      const harness = await createHarness({ mode });
      const revisionsBefore = await harness.db.select().from(sceneRevisions);
      const headBefore = await harness.sceneDocuments.getHead(UPDATE_DEST);
      await harness.client.exec(`
        create function reject_scene_update_proposal_apply() returns trigger as $$
        begin
          if new.status = 'applied' then
            raise exception 'injected scene update proposal persistence failure';
          end if;
          return new;
        end;
        $$ language plpgsql;
        create trigger reject_scene_update_proposal_apply
        before update on agent_proposals
        for each row execute function reject_scene_update_proposal_apply();
      `);
      await expect(harness.apply.applyScene(harness.input)).rejects.toBeDefined();
      await expectAwaitingReview(harness);
      expect(await harness.sceneDocuments.getHead(UPDATE_DEST)).toEqual(headBefore);
      expect(await harness.db.select().from(sceneRevisions)).toEqual(revisionsBefore);
    }
  });
});
