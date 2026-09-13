import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  STORY_WORK_STRUCTURE_WORKFLOW_ID,
  CanvasVersionConflictError,
  DomainValidationError,
  ProjectVersionConflictError,
  StoryWorkApplyIdempotencyConflictError,
  StoryWorkAssignmentNotFoundError,
  StoryWorkAssignmentTransitionError,
  StoryStructureStoryWorkContextConflictError,
  StoryStructureStoryWorkContextStaleError,
  StoryStructureStoryWorkSelectionConflictError,
  accountId,
  agentProposalId,
  agentRunId,
  applyCanvasCommand,
  assembleStorySceneResource,
  assembleStoryStructureResource,
  bookId,
  chapterId,
  contextReceiptId,
  createAgentRun,
  createBook,
  createCanvasServices,
  createInitialSceneDocumentState,
  createManuscriptPart,
  createManuscriptStructure,
  createProject,
  createProjectMembership,
  createQueuedAgentRun,
  createReadyAgentProposal,
  createScene,
  createStoryWorkAssignment,
  createStoryWorkAttempt,
  defineProjectRecords,
  deriveCanvasReadingOrderSpine,
  instructionContentHash,
  partId,
  projectId,
  sceneContentHash,
  sceneId,
  storyContextFromProjectRecords,
  storyWorkAssignmentId,
  type ContextReceipt,
  type ContextReceiptResource,
  type DomainIdKind,
  type IdGenerator,
  type ProjectRecords,
  STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
  STORY_STRUCTURE_SCHEMA_ID,
  buildStoryStructureProposalV1FromCandidate,
  storyStructureLoweringContextFromBook,
  storyStructureOperationId,
  type StoryStructureProposalV1
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
import { createPostgresSceneDocumentRepository } from "./postgres-scene-document-repository.js";
import { createPostgresStructureStoryWorkApplyUnitOfWork } from "./postgres-story-structure-uow.js";
import {
  createPostgresStoryWorkAssignmentRepository,
  createPostgresStoryWorkAttemptRepository
} from "./postgres-story-work-repository.js";
import { bookUnassignedScenes, sceneDocuments, scenes, user } from "./schema.js";
import { eq } from "drizzle-orm";
import { seedProject } from "./seed.js";

const OWNER = accountId("account-structure-apply-postgres-owner");
const FOREIGN = accountId("account-structure-apply-postgres-foreign");
const PROJECT = projectId("project-structure-apply-postgres");
const BOOK = bookId("book-structure-apply-postgres");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-structure-apply-postgres");
const RUN_ID = agentRunId("run-structure-apply-postgres");
const PROPOSAL_ID = agentProposalId("proposal-structure-apply-postgres");
const RECEIPT_ID = contextReceiptId("receipt-structure-apply-postgres");
const CONTENT_HASH = instructionContentHash("a".repeat(64));
const RECEIPT_HASH = instructionContentHash("b".repeat(64));
const CREATED_AT = "2026-09-13T19:00:00.000Z";
const APPLIED_AT = "2026-09-13T20:05:00.000Z";
const IDEMPOTENCY_KEY = "apply-structure-story-work-postgres-once";

const hashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
});

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

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

function emptyBookRecords(
  version = 4,
  options: { includeProseScene?: boolean } = {}
): ProjectRecords {
  const proseScene = sceneId("scene-prose-only-postgres");
  return defineProjectRecords({
    project: createProject({
      id: PROJECT,
      title: "Structure Novel",
      bookIds: [BOOK],
      createdAt: CREATED_AT,
      version
    }),
    books: [
      createBook({
        id: BOOK,
        projectId: PROJECT,
        title: "Novel",
        status: "drafting",
        manuscript: createManuscriptStructure({
          parts: [],
          unassignedSceneIds: options.includeProseScene ? [proseScene] : []
        }),
        createdAt: CREATED_AT
      })
    ],
    scenes: options.includeProseScene
      ? [
          createScene({
            id: proseScene,
            projectId: PROJECT,
            bookId: BOOK,
            title: "Existing prose",
            status: "drafting"
          })
        ]
      : [],
    storyKnowledge: [],
    editions: []
  });
}

function threeChapterCandidate() {
  return {
    schemaId: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
    newParts: [{ localKey: "part-a", title: "Act One" }],
    newChapters: [
      {
        localKey: "ch-1",
        part: { kind: "new" as const, localKey: "part-a" },
        title: "Chapter One",
        objective: "Introduce the world"
      },
      {
        localKey: "ch-2",
        part: { kind: "new" as const, localKey: "part-a" },
        title: "Chapter Two"
      },
      {
        localKey: "ch-3",
        part: { kind: "new" as const, localKey: "part-a" },
        title: "Chapter Three"
      }
    ],
    newPlannedScenes: [
      {
        localKey: "sc-1",
        host: { kind: "newChapter" as const, localKey: "ch-1" },
        title: "Opening"
      },
      {
        localKey: "sc-2",
        host: { kind: "newChapter" as const, localKey: "ch-2" },
        title: "Middle"
      },
      {
        localKey: "sc-3",
        host: { kind: "newChapter" as const, localKey: "ch-3" },
        title: "Turn",
        intent: { purpose: "Raise the stakes" }
      }
    ],
    existingChapterUpdates: [],
    chapterReorders: [
      {
        part: { kind: "new" as const, localKey: "part-a" },
        order: [
          { kind: "new" as const, localKey: "ch-1" },
          { kind: "new" as const, localKey: "ch-2" },
          { kind: "new" as const, localKey: "ch-3" }
        ]
      }
    ],
    existingSceneMoves: [],
    existingSceneArchiveChanges: [],
    existingSceneIntentUpdates: []
  };
}

function buildThreeChapterProposal(version = 4): StoryStructureProposalV1 {
  const records = emptyBookRecords(version);
  const book = records.books[0]!;
  const context = storyStructureLoweringContextFromBook(PROJECT, book, records.scenes);
  return buildStoryStructureProposalV1FromCandidate({
    projectId: PROJECT,
    bookId: BOOK,
    expectedProjectVersion: version,
    contextReceiptHash: RECEIPT_HASH,
    candidate: threeChapterCandidate(),
    context,
    ids: sequenceIds({
      storyStructureOperation: [
        "op-part",
        "op-ch-1",
        "op-ch-2",
        "op-ch-3",
        "op-reorder",
        "op-sc-1",
        "op-sc-2",
        "op-sc-3",
        "op-sc-3-intent"
      ],
      part: ["part-canonical-postgres"],
      chapter: ["chapter-1-postgres", "chapter-2-postgres", "chapter-3-postgres"],
      scene: ["scene-1-postgres", "scene-2-postgres", "scene-3-postgres"]
    })
  });
}

function singleChapterProposal(version = 4): StoryStructureProposalV1 {
  const records = emptyBookRecords(version);
  const book = records.books[0]!;
  const context = storyStructureLoweringContextFromBook(PROJECT, book, records.scenes);
  return buildStoryStructureProposalV1FromCandidate({
    projectId: PROJECT,
    bookId: BOOK,
    expectedProjectVersion: version,
    contextReceiptHash: RECEIPT_HASH,
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
    context,
    ids: sequenceIds({
      storyStructureOperation: ["op-part", "op-ch-1", "op-reorder", "op-sc-1"],
      part: ["part-canonical-postgres"],
      chapter: ["chapter-1-postgres"],
      scene: ["scene-1-postgres"]
    })
  });
}

type HarnessOptions = Readonly<{
  records?: ProjectRecords;
  proposal?: StoryStructureProposalV1;
  selectedOperationIds?: readonly ReturnType<typeof storyStructureOperationId>[];
  staleStructureReceipt?: boolean;
  staleSceneDocumentHead?: boolean;
  wrongProjectVersion?: boolean;
  wrongCanvasVersion?: boolean;
  invalidCanvasScope?: boolean;
  withCanvasPlacement?: boolean;
  canvasSceneId?: ReturnType<typeof sceneId>;
  duplicateSceneHead?: ReturnType<typeof sceneId>;
  includeProseScene?: boolean;
}>;

function changedStructureRecords(records: ProjectRecords): ProjectRecords {
  return defineProjectRecords({
    ...records,
    books: records.books.map((book) =>
      book.id === BOOK
        ? {
            ...book,
            manuscript: createManuscriptStructure({
              parts: [
                createManuscriptPart({
                  id: partId("part-stale-context-postgres"),
                  title: "Inserted after receipt",
                  chapters: []
                }),
                ...book.manuscript.parts
              ],
              unassignedSceneIds: book.manuscript.unassignedSceneIds
            })
          }
        : book
    )
  });
}

async function createHarness(options: HarnessOptions = {}) {
  const { db, client, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values([
    {
      id: OWNER,
      name: "Structure Apply Owner",
      email: "structure-apply-owner@example.test",
      emailVerified: true
    },
    {
      id: FOREIGN,
      name: "Structure Apply Foreign",
      email: "structure-apply-foreign@example.test",
      emailVerified: true
    }
  ]);

  const exec = toRepositoryDatabase(db);
  const projects = createPostgresProjectRepository(exec);
  const projectRecords =
    options.records ??
    emptyBookRecords(4, { includeProseScene: options.includeProseScene === true });
  await seedProject(projects, projectRecords);
  await projects.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: PROJECT,
        accountId: OWNER,
        role: "owner",
        createdAt: CREATED_AT
      })
    );
  });

  const sceneDocumentsRepo = createPostgresSceneDocumentRepository(exec);
  const canvases = createPostgresCanvasRepository(exec);
  const assignments = createPostgresStoryWorkAssignmentRepository(exec);
  const attempts = createPostgresStoryWorkAttemptRepository(exec);
  const proposals = createPostgresAgentProposalRepository(exec);
  const runs = createPostgresAgentRunRepository(exec);
  const receipts = createPostgresContextReceiptRepository(exec);

  const proposal = options.proposal ?? buildThreeChapterProposal(projectRecords.project.version);
  const selectedOperationIds =
    options.selectedOperationIds ?? proposal.operations.map((operation) => operation.operationId);

  let proseHead:
    | Awaited<ReturnType<typeof createInitialSceneDocumentState>>["head"]
    | undefined;
  if (options.includeProseScene === true) {
    const proseScene = sceneId("scene-prose-only-postgres");
    const initial = await createInitialSceneDocumentState({
      projectId: PROJECT,
      sceneId: proseScene,
      actorAccountId: OWNER,
      ids: { create: (kind) => `${kind}-prose-seed-postgres` },
      now: CREATED_AT
    });
    proseHead = initial.head;
    await sceneDocumentsRepo.initialize(initial);
  }

  if (options.duplicateSceneHead !== undefined) {
    const duplicateScene = createScene({
      id: options.duplicateSceneHead,
      projectId: PROJECT,
      bookId: BOOK,
      title: "Duplicate reserved scene",
      status: "drafting"
    });
    await exec.insert(scenes).values({
      id: duplicateScene.id,
      projectId: duplicateScene.projectId,
      bookId: duplicateScene.bookId,
      title: duplicateScene.title,
      status: duplicateScene.status
    });
    await exec.insert(bookUnassignedScenes).values({
      bookId: BOOK,
      sceneId: options.duplicateSceneHead,
      position: 99
    });
    const duplicate = await createInitialSceneDocumentState({
      projectId: PROJECT,
      sceneId: options.duplicateSceneHead,
      actorAccountId: OWNER,
      ids: { create: (kind) => `${kind}-duplicate-reserved-postgres` },
      now: CREATED_AT
    });
    await sceneDocumentsRepo.initialize(duplicate);
  }

  const pointer = {
    proposalId: PROPOSAL_ID,
    artifactVersion: 1,
    contentHash: CONTENT_HASH
  };
  const assignment = createStoryWorkAssignment({
    id: ASSIGNMENT_ID,
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 5,
    taskKind: "outline",
    brief: "Develop the book structure.",
    constraints: "Respect the active book.",
    doneWhen: "Structure is ready to apply.",
    sources: [
      {
        kind: "book",
        bookId: BOOK,
        projectVersion: projectRecords.project.version
      }
    ],
    destination: { kind: "book", bookId: BOOK, operation: "update" },
    provider: "openai",
    model: "gpt-4.1",
    status: "awaiting-review",
    steps: [{ id: "structure", title: "Propose structure", dependencies: [] }],
    currentArtifact: pointer,
    generatedArtifact: pointer,
    results: [],
    idempotencyKey: "assignment-structure-apply-postgres",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  });
  await assignments.create({
    assignment,
    requestFingerprint: instructionContentHash("d".repeat(64))
  });

  const [receiptProject, receiptBooks, receiptScenes, receiptStoryKnowledge, receiptEditions] =
    await Promise.all([
      projects.getProject(PROJECT),
      projects.listBooks(PROJECT),
      projects.listScenes(PROJECT),
      projects.listStoryKnowledge(PROJECT),
      projects.listEditions(PROJECT)
    ]);
  const receiptStructureRecords =
    options.staleStructureReceipt === true
      ? changedStructureRecords(
          defineProjectRecords({
            project: receiptProject!,
            books: receiptBooks,
            scenes: receiptScenes,
            storyKnowledge: receiptStoryKnowledge,
            editions: receiptEditions
          })
        )
      : defineProjectRecords({
          project: receiptProject!,
          books: receiptBooks,
          scenes: receiptScenes,
          storyKnowledge: receiptStoryKnowledge,
          editions: receiptEditions
        });
  const structureResource = await assembleStoryStructureResource({
    projectId: PROJECT,
    context: storyContextFromProjectRecords(receiptStructureRecords, {
      scope: { kind: "project" }
    }),
    inclusionReason: "Exact story context.",
    hashPort
  });
  const receiptResources: ContextReceiptResource[] = [structureResource.resource];
  if (options.staleSceneDocumentHead === true && proseHead !== undefined) {
    const staleHead = {
      ...proseHead,
      contentHash: sceneContentHash("9".repeat(64))
    };
    const sceneResource = await assembleStorySceneResource({
      projectId: PROJECT,
      sceneId: staleHead.sceneId,
      head: staleHead,
      inclusionReason: "Existing prose baseline.",
      hashPort
    });
    receiptResources.push(sceneResource.resource);
  }
  const receipt: ContextReceipt = Object.freeze({
    id: RECEIPT_ID,
    projectId: PROJECT,
    workflowId: STORY_WORK_STRUCTURE_WORKFLOW_ID,
    workflowVersion: "1.0.0",
    layers: [],
    resources: receiptResources,
    excludedContextClasses: [],
    provider: "openai",
    model: "gpt-4.1",
    maxOutputTokens: 6_000,
    wallClockSeconds: 60,
    toolCount: 0,
    egressClass: "openai-responses",
    outputSchemaId: STORY_STRUCTURE_SCHEMA_ID,
    primaryTarget: { kind: "book" as const, id: BOOK },
    receiptHash: RECEIPT_HASH,
    createdAt: CREATED_AT
  });
  await receipts.insertImmutable(receipt);

  const queued = createQueuedAgentRun({
    id: RUN_ID,
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    workflowId: STORY_WORK_STRUCTURE_WORKFLOW_ID,
    workflowVersion: "1.0.0",
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
      completedAt: CREATED_AT
    })
  });

  await proposals.create(
    createReadyAgentProposal({
      id: PROPOSAL_ID,
      projectId: PROJECT,
      runId: RUN_ID,
      receiptId: RECEIPT_ID,
      status: "ready",
      outputSchemaId: STORY_STRUCTURE_SCHEMA_ID,
      primaryTarget: { kind: "book", id: BOOK },
      payload: proposal,
      contentHash: CONTENT_HASH,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT
    })
  );

  await attempts.create({
    attempt: createStoryWorkAttempt({
      assignmentId: ASSIGNMENT_ID,
      projectId: PROJECT,
      initiatorAccountId: OWNER,
      runId: RUN_ID,
      version: 1,
      kind: "initial",
      sourceMode: "submitted-snapshot",
      instruction: assignment.brief,
      idempotencyKey: "attempt-structure-apply-postgres",
      requestFingerprint: instructionContentHash("e".repeat(64)),
      resultArtifact: assignment.generatedArtifact,
      createdAt: CREATED_AT,
      completedAt: CREATED_AT
    })
  });

  let canvasVersion: number | undefined;
  if (options.withCanvasPlacement === true || options.wrongCanvasVersion === true) {
    const canvasServices = createCanvasServices({
      projects,
      canvases,
      sceneDocuments: sceneDocumentsRepo,
      sceneCreation: createPostgresCanvasSceneCreationUnitOfWork(exec),
      ids: { create: (kind) => `${kind}-canvas-init-postgres` },
      clock: { now: () => CREATED_AT }
    });
    const workspace = await canvasServices.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT
    });
    canvasVersion = workspace.board.version;
  }

  let idSequence = 0;
  const ids = {
    create(kind: string) {
      idSequence += 1;
      return `${kind}-structure-apply-postgres-${idSequence}`;
    }
  };

  const apply = createPostgresStructureStoryWorkApplyUnitOfWork({
    db: exec,
    ids,
    hashPort
  });

  const placementSceneId = options.canvasSceneId ?? sceneId("scene-1-postgres");
  const canvasPlacement =
    options.withCanvasPlacement === true && canvasVersion !== undefined
      ? {
          expectedCanvasVersion: options.wrongCanvasVersion === true
            ? canvasVersion + 1
            : canvasVersion,
          sceneId: placementSceneId,
          scope: options.invalidCanvasScope === true
            ? { scopeKind: "chapter" as const, scopeId: chapterId("chapter-missing-postgres") }
            : { scopeKind: "chapter" as const, scopeId: chapterId("chapter-1-postgres") },
          x: 24,
          y: 36,
          width: 220,
          height: 140,
          z: 3
        }
      : undefined;

  const input = {
    accountId: OWNER,
    projectId: PROJECT,
    assignmentId: ASSIGNMENT_ID,
    expectedAssignmentVersion: assignment.version,
    proposalId: PROPOSAL_ID,
    expectedArtifactVersion: 1,
    expectedProposalContentHash: CONTENT_HASH,
    expectedProjectVersion: options.wrongProjectVersion === true
      ? projectRecords.project.version + 1
      : projectRecords.project.version,
    selectedOperationIds,
    idempotencyKey: IDEMPOTENCY_KEY,
    appliedAt: APPLIED_AT,
    ...(canvasPlacement === undefined ? {} : { canvasPlacement })
  };

  return {
    apply,
    input,
    db,
    client,
    projects,
    sceneDocuments: sceneDocumentsRepo,
    canvases,
    assignments,
    proposals,
    ids: () => idSequence,
    projectVersionBefore: projectRecords.project.version,
    proposal,
    selectedOperationIds,
    canvasVersion
  };
}

async function expectAwaitingReview(harness: Awaited<ReturnType<typeof createHarness>>) {
  expect((await harness.proposals.get(PROPOSAL_ID))?.status).toBe("ready");
  expect(
    (
      await harness.assignments.get({
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ASSIGNMENT_ID
      })
    )?.status
  ).toBe("awaiting-review");
  expect((await harness.projects.getProject(PROJECT))?.version).toBe(harness.projectVersionBefore);
}

describe("postgres structure story work apply unit of work", () => {
  it("applies three chapters and scenes in one project version with empty heads", async () => {
    const harness = await createHarness();
    const applied = await harness.apply.applyStructure(harness.input);
    expect(applied.replayed).toBe(false);
    expect(applied.result).toMatchObject({
      kind: "story-structure",
      bookId: BOOK,
      projectVersion: harness.projectVersionBefore + 1,
      createdSceneIds: [
        sceneId("scene-1-postgres"),
        sceneId("scene-2-postgres"),
        sceneId("scene-3-postgres")
      ]
    });
    expect(new Set(applied.result.resolvedOperationIds)).toEqual(
      new Set(harness.selectedOperationIds)
    );
    expect(applied.assignment.results).toEqual([applied.result]);
    const reloadedAssignment = await harness.assignments.get({
      accountId: OWNER,
      projectId: PROJECT,
      assignmentId: ASSIGNMENT_ID
    });
    expect(reloadedAssignment?.results).toEqual([applied.result]);
    expect(applied.preview?.createdSceneIds).toEqual([
      sceneId("scene-1-postgres"),
      sceneId("scene-2-postgres"),
      sceneId("scene-3-postgres")
    ]);
    for (const scene of [
      sceneId("scene-1-postgres"),
      sceneId("scene-2-postgres"),
      sceneId("scene-3-postgres")
    ]) {
      expect(await harness.sceneDocuments.getHead(scene)).toMatchObject({ workingVersion: 1 });
    }
    expect(applied.assignment.status).toBe("applied");
    expect(applied.proposal.status).toBe("applied");
  });

  it("applies a dependency-complete subset without widening the selection", async () => {
    const proposal = singleChapterProposal(4);
    const harness = await createHarness({ proposal });
    const applied = await harness.apply.applyStructure(harness.input);
    expect(applied.preview?.createdSceneIds).toEqual([sceneId("scene-1-postgres")]);
    expect(applied.preview?.createdChapterIds).toEqual([chapterId("chapter-1-postgres")]);
    expect((await harness.projects.listScenes(PROJECT)).map((scene) => scene.id)).toEqual([
      sceneId("scene-1-postgres")
    ]);
  });

  it("refuses partial, empty, and stale selections without mutation", async () => {
    const partial = await createHarness({
      selectedOperationIds: [storyStructureOperationId("op-sc-1")]
    });
    await expect(partial.apply.applyStructure(partial.input)).rejects.toBeInstanceOf(
      StoryStructureStoryWorkSelectionConflictError
    );
    await expectAwaitingReview(partial);

    const empty = await createHarness({ selectedOperationIds: [] });
    await expect(empty.apply.applyStructure(empty.input)).rejects.toBeInstanceOf(
      DomainValidationError
    );
    await expectAwaitingReview(empty);

    const stale = await createHarness({
      records: emptyBookRecords(3),
      proposal: buildThreeChapterProposal(3)
    });
    await expect(
      stale.apply.applyStructure({
        ...stale.input,
        expectedProjectVersion: 4
      })
    ).rejects.toBeInstanceOf(ProjectVersionConflictError);
    await expectAwaitingReview(stale);
  });

  it("refuses stale structure receipt, scene head, and project preconditions without mutation", async () => {
    const staleReceipt = await createHarness({ includeProseScene: true });
    const proseScene = sceneId("scene-prose-only-postgres");
    await staleReceipt.db
      .update(scenes)
      .set({ title: "Structure changed after the receipt was sealed" })
      .where(eq(scenes.id, proseScene));
    await expect(staleReceipt.apply.applyStructure(staleReceipt.input)).rejects.toBeInstanceOf(
      StoryStructureStoryWorkContextStaleError
    );
    await expectAwaitingReview(staleReceipt);

    const staleHead = await createHarness({
      includeProseScene: true,
      staleSceneDocumentHead: true
    });
    await expect(staleHead.apply.applyStructure(staleHead.input)).rejects.toBeInstanceOf(
      StoryStructureStoryWorkContextStaleError
    );
    await expectAwaitingReview(staleHead);

    const staleProject = await createHarness({ wrongProjectVersion: true });
    await expect(staleProject.apply.applyStructure(staleProject.input)).rejects.toBeInstanceOf(
      ProjectVersionConflictError
    );
    await expectAwaitingReview(staleProject);
  });

  it("refuses duplicate reserved scene document state", async () => {
    const harness = await createHarness({ duplicateSceneHead: sceneId("scene-1-postgres") });
    await expect(harness.apply.applyStructure(harness.input)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof DomainValidationError ||
        error instanceof StoryStructureStoryWorkContextConflictError
    );
    await expectAwaitingReview(harness);
  });

  it("replays an exact apply after unrelated later project change without allocating IDs", async () => {
    const harness = await createHarness();
    const first = await harness.apply.applyStructure(harness.input);
    const idsAfterFirst = harness.ids();
    const projectAfterApply = await harness.projects.getProject(PROJECT);
    const [books, scenes, storyKnowledge, editions] = await Promise.all([
      harness.projects.listBooks(PROJECT),
      harness.projects.listScenes(PROJECT),
      harness.projects.listStoryKnowledge(PROJECT),
      harness.projects.listEditions(PROJECT)
    ]);
    await harness.projects.transaction((writer) => {
      writer.replaceProjectRecords(
        defineProjectRecords({
          project: {
            ...projectAfterApply!,
            version: projectAfterApply!.version + 1,
            title: "Unrelated edit after structure apply"
          },
          books,
          scenes,
          storyKnowledge,
          editions
        }),
        projectAfterApply!.version
      );
    });
    const replay = await harness.apply.applyStructure(harness.input);
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(first.result);
    expect(replay.preview).toBeUndefined();
    expect(harness.ids()).toBe(idsAfterFirst);
  });

  it("serializes concurrent exact applies into one commit and one replay", async () => {
    const harness = await createHarness();
    const results = await Promise.all([
      harness.apply.applyStructure(harness.input),
      harness.apply.applyStructure(harness.input)
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
  });

  it("refuses replay when the idempotency key or body does not match", async () => {
    const harness = await createHarness();
    await harness.apply.applyStructure(harness.input);
    await expect(
      harness.apply.applyStructure({
        ...harness.input,
        idempotencyKey: "different-structure-apply-key"
      })
    ).rejects.toBeInstanceOf(StoryWorkApplyIdempotencyConflictError);
    await expect(
      harness.apply.applyStructure({
        ...harness.input,
        selectedOperationIds: [storyStructureOperationId("op-part")]
      })
    ).rejects.toBeInstanceOf(StoryWorkApplyIdempotencyConflictError);
  });

  it("hides foreign ownership as not found", async () => {
    const harness = await createHarness();
    await expect(
      harness.apply.applyStructure({ ...harness.input, accountId: FOREIGN })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentNotFoundError);
    await expectAwaitingReview(harness);
  });

  it("leaves existing prose scene documents unchanged", async () => {
    const harness = await createHarness({ includeProseScene: true });
    const proseScene = sceneId("scene-prose-only-postgres");
    const beforeHead = await harness.sceneDocuments.getHead(proseScene);
    await harness.apply.applyStructure(harness.input);
    expect(await harness.sceneDocuments.getHead(proseScene)).toEqual(beforeHead);
    expect(
      (await harness.projects.listScenes(PROJECT)).some((scene) => scene.id === proseScene)
    ).toBe(true);
  });

  it("leaves the Canvas board unchanged when no placement is requested", async () => {
    const harness = await createHarness();
    const canvasServices = createCanvasServices({
      projects: harness.projects,
      canvases: harness.canvases,
      sceneDocuments: harness.sceneDocuments,
      sceneCreation: createPostgresCanvasSceneCreationUnitOfWork(
        toRepositoryDatabase(harness.db)
      ),
      ids: { create: (kind) => `${kind}-canvas-observe-postgres` },
      clock: { now: () => CREATED_AT }
    });
    await canvasServices.getCanvasWorkspace({ accountId: OWNER, projectId: PROJECT });
    const beforeBoard = await harness.canvases.getBoard(PROJECT);
    await harness.apply.applyStructure(harness.input);
    expect(await harness.canvases.getBoard(PROJECT)).toEqual(beforeBoard);
  });

  it("places one scene card at the requested scope, geometry, and Canvas version", async () => {
    const harness = await createHarness({ withCanvasPlacement: true });
    const beforeBoard = await harness.canvases.getBoard(PROJECT);
    const applied = await harness.apply.applyStructure(harness.input);
    expect(applied.result.canvasPlacedSceneId).toBe(sceneId("scene-1-postgres"));
    expect(applied.result.canvasObjectId).toBeDefined();
    expect(applied.assignment.results[0]).toEqual(applied.result);
    const afterBoard = await harness.canvases.getBoard(PROJECT);
    expect(afterBoard!.version).toBe((beforeBoard?.version ?? 0) + 1);
    const card = afterBoard!.objects.find(
      (object) => object.kind === "scene-card" && object.sceneId === sceneId("scene-1-postgres")
    );
    expect(card).toMatchObject({
      x: 24,
      y: 36,
      width: 220,
      height: 140,
      z: 3,
      provenance: "story-work.structure",
      sourceKey: `story-work:${ASSIGNMENT_ID}`
    });

    const records = defineProjectRecords({
      project: (await harness.projects.getProject(PROJECT))!,
      books: await harness.projects.listBooks(PROJECT),
      scenes: await harness.projects.listScenes(PROJECT),
      storyKnowledge: await harness.projects.listStoryKnowledge(PROJECT),
      editions: await harness.projects.listEditions(PROJECT)
    });
    const spine = deriveCanvasReadingOrderSpine(records, afterBoard!);
    expect(spine.entries.map((entry) => entry.sceneId)).toEqual([
      sceneId("scene-1-postgres"),
      sceneId("scene-2-postgres"),
      sceneId("scene-3-postgres")
    ]);
  });

  it("refuses stale Canvas version and invalid scope without mutation", async () => {
    const staleVersion = await createHarness({
      withCanvasPlacement: true,
      wrongCanvasVersion: true
    });
    await expect(staleVersion.apply.applyStructure(staleVersion.input)).rejects.toBeInstanceOf(
      CanvasVersionConflictError
    );
    await expectAwaitingReview(staleVersion);

    const invalidScope = await createHarness({
      withCanvasPlacement: true,
      invalidCanvasScope: true
    });
    await expect(invalidScope.apply.applyStructure(invalidScope.input)).rejects.toThrow();
    await expectAwaitingReview(invalidScope);
  });

  it("refuses Canvas placement for an unselected or non-created scene", async () => {
    const proposal = singleChapterProposal(4);
    const unselected = await createHarness({
      proposal,
      withCanvasPlacement: true,
      canvasSceneId: sceneId("scene-2-postgres")
    });
    await expect(unselected.apply.applyStructure(unselected.input)).rejects.toBeInstanceOf(
      StoryStructureStoryWorkSelectionConflictError
    );
    await expectAwaitingReview(unselected);
  });

  it("replays Canvas placement without allocating IDs after the board advances", async () => {
    const harness = await createHarness({ withCanvasPlacement: true });
    const first = await harness.apply.applyStructure(harness.input);
    expect(first.result.canvasPlacedSceneId).toBe(sceneId("scene-1-postgres"));
    const idsAfterFirst = harness.ids();
    const board = await harness.canvases.getBoard(PROJECT);
    const records = defineProjectRecords({
      project: (await harness.projects.getProject(PROJECT))!,
      books: await harness.projects.listBooks(PROJECT),
      scenes: await harness.projects.listScenes(PROJECT),
      storyKnowledge: await harness.projects.listStoryKnowledge(PROJECT),
      editions: await harness.projects.listEditions(PROJECT)
    });
    const bump = await applyCanvasCommand({
      board: board!,
      projectRecords: records,
      expectedCanvasVersion: board!.version,
      command: {
        type: "canvas.object.create",
        scope: { scopeKind: "project" },
        object: {
          kind: "note",
          label: "Unrelated board edit",
          authority: "confirmed",
          x: 4,
          y: 4,
          width: 40,
          height: 40,
          z: 0
        }
      },
      actorAccountId: OWNER,
      ids: { create: (kind) => `replay-board-bump-postgres-${kind}` },
      now: APPLIED_AT
    });
    await harness.canvases.replace({
      mutation: bump,
      expectedCanvasVersion: board!.version
    });
    const replay = await harness.apply.applyStructure(harness.input);
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(first.result);
    expect(harness.ids()).toBe(idsAfterFirst);
  });

  it("refuses stale assignment version without mutation", async () => {
    const harness = await createHarness();
    await expect(
      harness.apply.applyStructure({
        ...harness.input,
        expectedAssignmentVersion: harness.input.expectedAssignmentVersion - 1
      })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentTransitionError);
    await expectAwaitingReview(harness);
  });

  it("rolls project and scene genesis back when proposal mark-applied fails", async () => {
    const harness = await createHarness();
    await harness.client.exec(`
      create function reject_structure_proposal_apply() returns trigger as $$
      begin
        if new.status = 'applied' then
          raise exception 'injected structure proposal persistence failure';
        end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger reject_structure_proposal_apply
      before update on agent_proposals
      for each row execute function reject_structure_proposal_apply();
    `);
    await expect(harness.apply.applyStructure(harness.input)).rejects.toBeDefined();
    await expectAwaitingReview(harness);
    expect(
      (await harness.projects.listScenes(PROJECT)).some(
        (scene) => scene.id === sceneId("scene-1-postgres")
      )
    ).toBe(false);
    expect(await harness.sceneDocuments.getHead(sceneId("scene-1-postgres"))).toBeUndefined();
  });

  it("rolls every canonical write back when assignment CAS fails", async () => {
    const harness = await createHarness({ withCanvasPlacement: true });
    await harness.client.exec(`
      create function reject_structure_assignment_apply() returns trigger as $$
      begin
        if new.status = 'applied' then
          raise exception 'injected structure assignment persistence failure';
        end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger reject_structure_assignment_apply
      before update on story_work_assignments
      for each row execute function reject_structure_assignment_apply();
    `);
    await expect(harness.apply.applyStructure(harness.input)).rejects.toBeDefined();
    await expectAwaitingReview(harness);
    expect(
      (await harness.projects.listScenes(PROJECT)).some(
        (scene) => scene.id === sceneId("scene-1-postgres")
      )
    ).toBe(false);
    expect(await harness.sceneDocuments.getHead(sceneId("scene-1-postgres"))).toBeUndefined();
    expect(await harness.db.select().from(sceneDocuments)).toHaveLength(0);
  });

  it("rolls Canvas placement back when proposal mark-applied fails after canvas replace", async () => {
    const harness = await createHarness({ withCanvasPlacement: true });
    const boardBefore = await harness.canvases.getBoard(PROJECT);
    await harness.client.exec(`
      create function reject_structure_canvas_proposal_apply() returns trigger as $$
      begin
        if new.status = 'applied' then
          raise exception 'injected structure canvas proposal failure';
        end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger reject_structure_canvas_proposal_apply
      before update on agent_proposals
      for each row execute function reject_structure_canvas_proposal_apply();
    `);
    await expect(harness.apply.applyStructure(harness.input)).rejects.toBeDefined();
    await expectAwaitingReview(harness);
    expect(await harness.canvases.getBoard(PROJECT)).toEqual(boardBefore);
  });

  it("rolls scene inits back when a later scene init fails", async () => {
    const harness = await createHarness();
    await harness.client.exec(`
      create function reject_structure_scene_init() returns trigger as $$
      declare
        scene_count integer;
      begin
        select count(*) into scene_count from scene_documents where project_id = '${PROJECT}';
        if scene_count >= 2 then
          raise exception 'injected structure scene init failure';
        end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger reject_structure_scene_init
      before insert on scene_documents
      for each row execute function reject_structure_scene_init();
    `);
    await expect(harness.apply.applyStructure(harness.input)).rejects.toBeDefined();
    await expectAwaitingReview(harness);
    expect(await harness.db.select().from(sceneDocuments)).toHaveLength(0);
    expect(
      (await harness.projects.listScenes(PROJECT)).some(
        (scene) => scene.id === sceneId("scene-1-postgres")
      )
    ).toBe(false);
  });
});
