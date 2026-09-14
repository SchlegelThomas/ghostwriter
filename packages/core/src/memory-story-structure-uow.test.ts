import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ContextReceipt, ContextReceiptResource } from "./agent-context-receipt.js";
import {
  STORY_WORK_STRUCTURE_WORKFLOW_ID,
  instructionContentHash
} from "./agent-domain.js";
import {
  createAgentRun,
  createQueuedAgentRun,
  createReadyAgentProposal
} from "./agent-runs-proposals.js";
import {
  agentProposalId,
  agentRunId,
  bookId,
  chapterId,
  contextReceiptId,
  createBook,
  createManuscriptPart,
  createManuscriptStructure,
  createProject,
  createScene,
  defineProjectRecords,
  partId,
  projectId,
  sceneId,
  type ProjectRecords
} from "./domain.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import {
  applyCanvasCommand,
  CanvasVersionConflictError,
  deriveCanvasReadingOrderSpine
} from "./canvas.js";
import { createCanvasServices } from "./canvas-services.js";
import { createMemoryCanvasRepository, createMemoryCanvasSceneCreationUnitOfWork } from "./memory-canvas-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemorySceneDocumentRepository } from "./memory-scene-document-repository.js";
import {
  createMemoryStructureStoryWorkApplyUnitOfWork,
  type MemoryStructureStoryWorkFailInject
} from "./memory-story-structure-uow.js";
import { createMemoryStoryWorkAssignmentRepository } from "./memory-story-work-assignment-repository.js";
import { createMemoryStoryWorkAttemptRepository } from "./memory-story-work-attempt-repository.js";
import { ProjectVersionConflictError } from "./project-repository.js";
import { createInitialSceneDocumentState } from "./scene-writing-services.js";
import { StoryWorkApplyIdempotencyConflictError } from "./story-structure-uow.js";
import {
  StoryStructureStoryWorkContextStaleError,
  StoryStructureStoryWorkSelectionConflictError
} from "./story-structure-apply-policy.js";
import { assembleStorySceneResource, assembleStoryStructureResource } from "./story-context-receipt.js";
import { storyContextFromProjectRecords } from "./story-context.js";
import {
  STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
  STORY_STRUCTURE_SCHEMA_ID,
  buildStoryStructureProposalV1FromCandidate,
  storyStructureLoweringContextFromBook,
  storyStructureOperationId,
  type StoryStructureProposalV1
} from "./story-structure-proposal-v1.js";
import {
  createStoryWorkAssignment,
  storyWorkAssignmentId,
  StoryWorkAssignmentTransitionError
} from "./story-work-assignment.js";
import { createStoryWorkAttempt } from "./story-work-attempt.js";
import type { DomainIdKind, IdGenerator } from "./project-repository.js";
import { DomainValidationError } from "./domain.js";
import { sceneContentHash } from "./scene-documents.js";

const OWNER = accountId("account-structure-apply-owner");
const PROJECT = projectId("project-structure-apply");
const BOOK = bookId("book-structure-apply");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-structure-apply");
const RUN_ID = agentRunId("run-structure-apply");
const PROPOSAL_ID = agentProposalId("proposal-structure-apply");
const RECEIPT_ID = contextReceiptId("receipt-structure-apply");
const CONTENT_HASH = instructionContentHash("a".repeat(64));
const RECEIPT_HASH = instructionContentHash("b".repeat(64));
const CREATED_AT = "2026-09-13T19:00:00.000Z";
const APPLIED_AT = "2026-09-13T20:05:00.000Z";
const IDEMPOTENCY_KEY = "apply-structure-story-work-once";

const hashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
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
  const proseScene = sceneId("scene-prose-only");
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
      part: ["part-canonical"],
      chapter: ["chapter-1", "chapter-2", "chapter-3"],
      scene: ["scene-1", "scene-2", "scene-3"]
    })
  });
}

function metadataOnlyProposal(version = 4): StoryStructureProposalV1 {
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
          objective: "Set the frame"
        }
      ],
      newPlannedScenes: [],
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
      storyStructureOperation: ["op-part", "op-ch-1", "op-reorder"],
      part: ["part-canonical"],
      chapter: ["chapter-1"]
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
      part: ["part-canonical"],
      chapter: ["chapter-1"],
      scene: ["scene-1"]
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
  failInject?: MemoryStructureStoryWorkFailInject;
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
                  id: partId("part-stale-context"),
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
  const projectRecords =
    options.records ??
    emptyBookRecords(4, { includeProseScene: options.includeProseScene === true });
  const proposal = options.proposal ?? buildThreeChapterProposal(projectRecords.project.version);
  const selectedOperationIds =
    options.selectedOperationIds ?? proposal.operations.map((operation) => operation.operationId);

  const projects = createMemoryProjectRepository(
    [projectRecords],
    [
      createProjectMembership({
        projectId: PROJECT,
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

  let proseHead:
    | Awaited<ReturnType<typeof createInitialSceneDocumentState>>["head"]
    | undefined;
  if (options.includeProseScene === true) {
    const proseScene = sceneId("scene-prose-only");
    const initial = await createInitialSceneDocumentState({
      projectId: PROJECT,
      sceneId: proseScene,
      actorAccountId: OWNER,
      ids: { create: (kind) => `${kind}-prose-seed` },
      now: CREATED_AT
    });
    proseHead = initial.head;
    await sceneDocuments.initialize(initial);
  }

  if (options.duplicateSceneHead !== undefined) {
    const duplicate = await createInitialSceneDocumentState({
      projectId: PROJECT,
      sceneId: options.duplicateSceneHead,
      actorAccountId: OWNER,
      ids: { create: (kind) => `${kind}-duplicate-reserved` },
      now: CREATED_AT
    });
    await sceneDocuments.initialize(duplicate);
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
    idempotencyKey: "assignment-structure-apply",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  });
  await assignments.create({
    assignment,
    requestFingerprint: instructionContentHash("d".repeat(64))
  });

  const receiptStructureRecords =
    options.staleStructureReceipt === true
      ? changedStructureRecords(projectRecords)
      : projectRecords;
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
      idempotencyKey: "attempt-structure-apply",
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
      projectId: PROJECT
    });
    canvasVersion = workspace.board.version;
  }

  let idSequence = 0;
  const ids = {
    create(kind: string) {
      idSequence += 1;
      return `${kind}-structure-apply-${idSequence}`;
    }
  };

  const unitOfWork = createMemoryStructureStoryWorkApplyUnitOfWork({
    projects,
    sceneDocuments,
    assignments,
    attempts,
    proposals,
    runs,
    receipts,
    ids,
    hashPort,
    ...(options.withCanvasPlacement === true || options.wrongCanvasVersion === true
      ? { canvases }
      : {}),
    ...(options.failInject === undefined ? {} : { failInject: options.failInject })
  });

  const placementSceneId = options.canvasSceneId ?? sceneId("scene-1");
  const canvasPlacement =
    options.withCanvasPlacement === true && canvasVersion !== undefined
      ? {
          expectedCanvasVersion: options.wrongCanvasVersion === true
            ? canvasVersion + 1
            : canvasVersion,
          sceneId: placementSceneId,
          scope: options.invalidCanvasScope === true
            ? { scopeKind: "chapter" as const, scopeId: chapterId("chapter-missing") }
            : { scopeKind: "chapter" as const, scopeId: chapterId("chapter-1") },
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
    unitOfWork,
    input,
    projects,
    sceneDocuments,
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

describe("memory structure story work apply unit of work", () => {
  it("applies three chapters and scenes in one project version with empty heads", async () => {
    const harness = await createHarness();
    const applied = await harness.unitOfWork.applyStructure(harness.input);
    expect(applied.replayed).toBe(false);
    expect(applied.result).toMatchObject({
      kind: "story-structure",
      bookId: BOOK,
      projectVersion: harness.projectVersionBefore + 1,
      createdSceneIds: [
        sceneId("scene-1"),
        sceneId("scene-2"),
        sceneId("scene-3")
      ]
    });
    expect(new Set(applied.result.resolvedOperationIds)).toEqual(
      new Set(harness.selectedOperationIds)
    );
    expect(applied.preview?.createdSceneIds).toEqual([
      sceneId("scene-1"),
      sceneId("scene-2"),
      sceneId("scene-3")
    ]);
    expect((await harness.projects.getProject(PROJECT))?.version).toBe(
      harness.projectVersionBefore + 1
    );
    for (const scene of [sceneId("scene-1"), sceneId("scene-2"), sceneId("scene-3")]) {
      expect(await harness.sceneDocuments.getHead(scene)).toMatchObject({ workingVersion: 1 });
    }
    expect(applied.assignment.status).toBe("applied");
    expect(applied.proposal.status).toBe("applied");
  });

  it("applies a dependency-complete subset without widening the selection", async () => {
    const proposal = singleChapterProposal(4);
    const harness = await createHarness({ proposal });
    const applied = await harness.unitOfWork.applyStructure(harness.input);
    expect(applied.preview?.createdSceneIds).toEqual([sceneId("scene-1")]);
    expect(applied.preview?.createdChapterIds).toEqual([chapterId("chapter-1")]);
    expect((await harness.projects.listScenes(PROJECT)).map((scene) => scene.id)).toEqual([
      sceneId("scene-1")
    ]);
  });

  it("refuses partial, empty, and stale selections without mutation", async () => {
    const partial = await createHarness({
      selectedOperationIds: [storyStructureOperationId("op-sc-1")]
    });
    await expect(partial.unitOfWork.applyStructure(partial.input)).rejects.toBeInstanceOf(
      StoryStructureStoryWorkSelectionConflictError
    );
    await expectAwaitingReview(partial);

    const empty = await createHarness({ selectedOperationIds: [] });
    await expect(empty.unitOfWork.applyStructure(empty.input)).rejects.toBeInstanceOf(
      DomainValidationError
    );
    await expectAwaitingReview(empty);

    const stale = await createHarness({
      records: emptyBookRecords(3),
      proposal: buildThreeChapterProposal(3)
    });
    await expect(
      stale.unitOfWork.applyStructure({
        ...stale.input,
        expectedProjectVersion: 4
      })
    ).rejects.toBeInstanceOf(ProjectVersionConflictError);
    await expectAwaitingReview(stale);
  });

  it("refuses stale scene head and project preconditions without mutation", async () => {
    const staleHead = await createHarness({
      includeProseScene: true,
      staleSceneDocumentHead: true
    });
    await expect(staleHead.unitOfWork.applyStructure(staleHead.input)).rejects.toBeInstanceOf(
      StoryStructureStoryWorkContextStaleError
    );
    await expectAwaitingReview(staleHead);

    const staleProject = await createHarness({ wrongProjectVersion: true });
    await expect(staleProject.unitOfWork.applyStructure(staleProject.input)).rejects.toBeInstanceOf(
      ProjectVersionConflictError
    );
    await expectAwaitingReview(staleProject);
  });

  it("refuses duplicate reserved scene document state", async () => {
    const harness = await createHarness({ duplicateSceneHead: sceneId("scene-1") });
    await expect(harness.unitOfWork.applyStructure(harness.input)).rejects.toBeInstanceOf(
      DomainValidationError
    );
    await expectAwaitingReview(harness);
  });

  it("replays an exact apply after unrelated later project change without allocating IDs", async () => {
    const harness = await createHarness();
    const first = await harness.unitOfWork.applyStructure(harness.input);
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
    const replay = await harness.unitOfWork.applyStructure(harness.input);
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(first.result);
    expect(replay.preview).toBeUndefined();
    expect(harness.ids()).toBe(idsAfterFirst);
  });

  it("refuses replay when the idempotency key or body does not match", async () => {
    const harness = await createHarness();
    await harness.unitOfWork.applyStructure(harness.input);
    await expect(
      harness.unitOfWork.applyStructure({
        ...harness.input,
        idempotencyKey: "different-structure-apply-key"
      })
    ).rejects.toBeInstanceOf(StoryWorkApplyIdempotencyConflictError);
    await expect(
      harness.unitOfWork.applyStructure({
        ...harness.input,
        selectedOperationIds: [storyStructureOperationId("op-part")]
      })
    ).rejects.toBeInstanceOf(StoryWorkApplyIdempotencyConflictError);
  });

  it("leaves existing prose scene documents unchanged", async () => {
    const harness = await createHarness({ includeProseScene: true });
    const proseScene = sceneId("scene-prose-only");
    const beforeHead = await harness.sceneDocuments.getHead(proseScene);
    await harness.unitOfWork.applyStructure(harness.input);
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
      sceneCreation: createMemoryCanvasSceneCreationUnitOfWork({
        projects: harness.projects,
        canvases: harness.canvases,
        sceneDocuments: harness.sceneDocuments
      }),
      ids: { create: (kind) => `${kind}-canvas-observe` },
      clock: { now: () => CREATED_AT }
    });
    await canvasServices.getCanvasWorkspace({ accountId: OWNER, projectId: PROJECT });
    const beforeBoard = await harness.canvases.getBoard(PROJECT);
    await harness.unitOfWork.applyStructure(harness.input);
    expect(await harness.canvases.getBoard(PROJECT)).toEqual(beforeBoard);
  });

  it("places one scene card at the requested scope, geometry, and Canvas version", async () => {
    const harness = await createHarness({ withCanvasPlacement: true });
    const beforeBoard = await harness.canvases.getBoard(PROJECT);
    const applied = await harness.unitOfWork.applyStructure(harness.input);
    expect(applied.result.canvasPlacedSceneId).toBe(sceneId("scene-1"));
    expect(applied.result.canvasObjectId).toBeDefined();
    const afterBoard = await harness.canvases.getBoard(PROJECT)!;
    expect(afterBoard!.version).toBe((beforeBoard?.version ?? 0) + 1);
    const card = afterBoard!.objects.find(
      (object) => object.kind === "scene-card" && object.sceneId === sceneId("scene-1")
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
      sceneId("scene-1"),
      sceneId("scene-2"),
      sceneId("scene-3")
    ]);
  });

  it("refuses stale Canvas version and invalid scope without mutation", async () => {
    const staleVersion = await createHarness({
      withCanvasPlacement: true,
      wrongCanvasVersion: true
    });
    await expect(staleVersion.unitOfWork.applyStructure(staleVersion.input)).rejects.toBeInstanceOf(
      CanvasVersionConflictError
    );
    await expectAwaitingReview(staleVersion);

    const invalidScope = await createHarness({
      withCanvasPlacement: true,
      invalidCanvasScope: true
    });
    await expect(invalidScope.unitOfWork.applyStructure(invalidScope.input)).rejects.toThrow();
    await expectAwaitingReview(invalidScope);
  });

  it("refuses Canvas placement for an unselected or non-created scene", async () => {
    const proposal = singleChapterProposal(4);
    const unselected = await createHarness({
      proposal,
      withCanvasPlacement: true,
      canvasSceneId: sceneId("scene-2")
    });
    await expect(unselected.unitOfWork.applyStructure(unselected.input)).rejects.toBeInstanceOf(
      StoryStructureStoryWorkSelectionConflictError
    );
    await expectAwaitingReview(unselected);
  });

  it("replays Canvas placement without allocating IDs after the board advances", async () => {
    const harness = await createHarness({ withCanvasPlacement: true });
    const first = await harness.unitOfWork.applyStructure(harness.input);
    expect(first.result.canvasPlacedSceneId).toBe(sceneId("scene-1"));
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
      ids: { create: (kind) => `replay-board-bump-${kind}` },
      now: APPLIED_AT
    });
    await harness.canvases.replace({
      mutation: bump,
      expectedCanvasVersion: board!.version
    });
    const replay = await harness.unitOfWork.applyStructure(harness.input);
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(first.result);
    expect(harness.ids()).toBe(idsAfterFirst);
  });

  it("stores durable story-structure results for metadata-only subsets", async () => {
    const proposal = metadataOnlyProposal(4);
    const harness = await createHarness({ proposal });
    const applied = await harness.unitOfWork.applyStructure(harness.input);
    expect(applied.result.kind).toBe("story-structure");
    expect(applied.result.createdSceneIds).toEqual([]);
    expect(new Set(applied.result.resolvedOperationIds)).toEqual(
      new Set(proposal.operations.map((operation) => operation.operationId))
    );
  });

  it("refuses replay when selected operations or placement no longer match", async () => {
    const harness = await createHarness({ withCanvasPlacement: true });
    await harness.unitOfWork.applyStructure(harness.input);
    await expect(
      harness.unitOfWork.applyStructure({
        ...harness.input,
        selectedOperationIds: [storyStructureOperationId("op-part")]
      })
    ).rejects.toBeInstanceOf(StoryWorkApplyIdempotencyConflictError);
    await expect(
      harness.unitOfWork.applyStructure({
        ...harness.input,
        canvasPlacement: {
          ...harness.input.canvasPlacement!,
          sceneId: sceneId("scene-2")
        }
      })
    ).rejects.toBeInstanceOf(StoryWorkApplyIdempotencyConflictError);
  });

  const rollbackCases: MemoryStructureStoryWorkFailInject[] = [
    { after: "after-project" },
    { afterSceneInitIndex: 1 },
    { after: "after-canvas" },
    { after: "after-proposal" },
    { after: "before-assignment" }
  ];
  for (const failInject of rollbackCases) {
    it(`rolls every participant back after injected failure ${JSON.stringify(failInject)}`, async () => {
      const harness = await createHarness({
        failInject,
        ...(failInject.after === "after-canvas" ? { withCanvasPlacement: true } : {})
      });
      await expect(harness.unitOfWork.applyStructure(harness.input)).rejects.toThrow(
        /Injected structure apply failure/
      );
      await expectAwaitingReview(harness);
      expect(
        (await harness.projects.listScenes(PROJECT)).some(
          (scene) => scene.id === sceneId("scene-1")
        )
      ).toBe(false);
      expect(await harness.sceneDocuments.getHead(sceneId("scene-1"))).toBeUndefined();
      if (failInject.after === "after-canvas") {
        expect((await harness.canvases.getBoard(PROJECT))?.version).toBe(harness.canvasVersion);
      }
    });
  }

  it("refuses stale assignment version without mutation", async () => {
    const harness = await createHarness();
    await expect(
      harness.unitOfWork.applyStructure({
        ...harness.input,
        expectedAssignmentVersion: harness.input.expectedAssignmentVersion - 1
      })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentTransitionError);
    await expectAwaitingReview(harness);
  });
});
