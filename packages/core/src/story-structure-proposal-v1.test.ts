import { describe, expect, it, vi } from "vitest";
import { validateAgentProposalPayload } from "./agent-runs-proposals.js";
import { instructionContentHash } from "./agent-domain.js";
import {
  STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
  STORY_STRUCTURE_SCHEMA_ID,
  buildStoryStructureProposalV1FromCandidate,
  estimateStoryStructureOperationCount,
  storyStructureLoweringContextFromBook,
  validateStoryStructureProposalCandidatesV1,
  validateStoryStructureProposalV1
} from "./story-structure-proposal-v1.js";
import {
  bookId,
  chapterId,
  createBook,
  createManuscriptChapter,
  createManuscriptPart,
  createManuscriptStructure,
  createScene,
  DomainValidationError,
  partId,
  projectId,
  sceneId
} from "./domain.js";
import type { DomainIdKind, IdGenerator } from "./project-repository.js";
import { validateCaptureReflectionV1 } from "./capture-reflection-v1.js";

const PROJECT = projectId("project-structure");
const BOOK = bookId("book-structure");
const RECEIPT = instructionContentHash("c".repeat(64));

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

function emptyBook() {
  return createBook({
    id: BOOK,
    projectId: PROJECT,
    title: "Novel",
    status: "drafting",
    manuscript: createManuscriptStructure({ parts: [], unassignedSceneIds: [] }),
    createdAt: "2026-09-13T00:00:00.000Z"
  });
}

function threeChapterCandidate() {
  return {
    schemaId: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
    newParts: [{ localKey: "part-a", title: "Act One" }],
    newChapters: [
      {
        localKey: "ch-1",
        part: { kind: "new", localKey: "part-a" },
        title: "Chapter One",
        objective: "Introduce the world"
      },
      {
        localKey: "ch-2",
        part: { kind: "new", localKey: "part-a" },
        title: "Chapter Two"
      },
      {
        localKey: "ch-3",
        part: { kind: "new", localKey: "part-a" },
        title: "Chapter Three"
      }
    ],
    newPlannedScenes: [
      {
        localKey: "sc-1",
        host: { kind: "newChapter", localKey: "ch-1" },
        title: "Opening"
      },
      {
        localKey: "sc-2",
        host: { kind: "newChapter", localKey: "ch-2" },
        title: "Middle"
      },
      {
        localKey: "sc-3",
        host: { kind: "newChapter", localKey: "ch-3" },
        title: "Turn",
        intent: { purpose: "Raise the stakes" }
      }
    ],
    existingChapterUpdates: [],
    chapterReorders: [
      {
        part: { kind: "new", localKey: "part-a" },
        order: [
          { kind: "new", localKey: "ch-1" },
          { kind: "new", localKey: "ch-2" },
          { kind: "new", localKey: "ch-3" }
        ]
      }
    ],
    existingSceneMoves: [],
    existingSceneArchiveChanges: [],
    existingSceneIntentUpdates: []
  };
}

describe("story-structure-proposal-v1", () => {
  it("lowers a three-chapter three-scene candidate with stable ids and dependencies", () => {
    const ids = sequenceIds({
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
    });
    const context = storyStructureLoweringContextFromBook(PROJECT, emptyBook(), []);
    const proposal = buildStoryStructureProposalV1FromCandidate({
      projectId: PROJECT,
      bookId: BOOK,
      expectedProjectVersion: 4,
      contextReceiptHash: RECEIPT,
      candidate: threeChapterCandidate(),
      context,
      ids
    });

    expect(proposal.operations.map((operation) => operation.operationId)).toEqual([
      "op-part",
      "op-ch-1",
      "op-ch-2",
      "op-ch-3",
      "op-reorder",
      "op-sc-1",
      "op-sc-2",
      "op-sc-3",
      "op-sc-3-intent"
    ]);
    expect(proposal.dependencies.find((edge) => edge.operationId === "op-ch-1")?.requires).toEqual([
      "op-part"
    ]);
    expect(proposal.dependencies.find((edge) => edge.operationId === "op-sc-3-intent")?.requires).toEqual([
      "op-sc-3"
    ]);
    expect(
      [...(proposal.dependencies.find((edge) => edge.operationId === "op-reorder")?.requires ?? [])].sort()
    ).toEqual(["op-ch-1", "op-ch-2", "op-ch-3"].sort());

    const partCreate = proposal.operations.find((operation) => operation.type === "part.create");
    expect(partCreate).toMatchObject({ bookId: BOOK });
    const plannedWithIntent = proposal.operations.find(
      (operation) => operation.operationId === "op-sc-3"
    );
    expect(plannedWithIntent?.type).toBe("scene.createPlanned");
    if (plannedWithIntent?.type === "scene.createPlanned") {
      expect(Object.prototype.hasOwnProperty.call(plannedWithIntent, "intent")).toBe(false);
    }
    expect(proposal.dependencies).toHaveLength(proposal.operations.length);

    validateAgentProposalPayload("story-structure-proposal-v1", proposal);
  });

  it("refuses provider authority injection duplicate locals and out-of-scope refs", () => {
    expect(() =>
      validateStoryStructureProposalCandidatesV1({
        ...threeChapterCandidate(),
        bookId: BOOK
      })
    ).toThrow(DomainValidationError);

    expect(() =>
      validateStoryStructureProposalCandidatesV1({
        ...threeChapterCandidate(),
        newChapters: [
          {
            localKey: "dup",
            part: { kind: "new", localKey: "part-a" },
            title: "One"
          },
          {
            localKey: "dup",
            part: { kind: "new", localKey: "part-a" },
            title: "Two"
          }
        ]
      })
    ).toThrow(DomainValidationError);

    const existingPart = partId("part-existing");
    const existingChapter = chapterId("chapter-existing");
    const book = createBook({
      id: BOOK,
      projectId: PROJECT,
      title: "Novel",
      status: "drafting",
      manuscript: createManuscriptStructure({
        parts: [
          createManuscriptPart({
            id: existingPart,
            title: "Part",
            chapters: [
              createManuscriptChapter({
                id: existingChapter,
                title: "Existing",
                sceneIds: []
              })
            ]
          })
        ],
        unassignedSceneIds: []
      }),
      createdAt: "2026-09-13T00:00:00.000Z"
    });
    const context = storyStructureLoweringContextFromBook(PROJECT, book, []);
    expect(() =>
      buildStoryStructureProposalV1FromCandidate({
        projectId: PROJECT,
        bookId: BOOK,
        expectedProjectVersion: 1,
        contextReceiptHash: RECEIPT,
        candidate: {
          ...threeChapterCandidate(),
          existingChapterUpdates: [
            { chapterId: chapterId("chapter-outside"), objective: "Nope" }
          ]
        },
        context,
        ids: sequenceIds({})
      })
    ).toThrow(DomainValidationError);
  });

  it("allocates ids only after candidate validation succeeds", () => {
    const create = vi.fn(() => "should-not-run");
    const ids: IdGenerator = { create };
    expect(() =>
      buildStoryStructureProposalV1FromCandidate({
        projectId: PROJECT,
        bookId: BOOK,
        expectedProjectVersion: 1,
        contextReceiptHash: RECEIPT,
        candidate: { schemaId: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID, newParts: [] },
        context: storyStructureLoweringContextFromBook(PROJECT, emptyBook(), []),
        ids
      })
    ).toThrow(DomainValidationError);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses operation budget including derived intent ops before id allocation", () => {
    const create = vi.fn(() => "should-not-run");
    const ids: IdGenerator = { create };
    const candidate = {
      schemaId: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
      newParts: [],
      newChapters: [],
      newPlannedScenes: Array.from({ length: 101 }, (_, index) => ({
        localKey: `scene-${index}`,
        host: { kind: "unassigned" as const },
        title: `Scene ${index}`,
        intent: { purpose: "Stretch budget" }
      })),
      existingChapterUpdates: [],
      chapterReorders: [],
      existingSceneMoves: [],
      existingSceneArchiveChanges: [],
      existingSceneIntentUpdates: []
    };
    expect(
      estimateStoryStructureOperationCount(validateStoryStructureProposalCandidatesV1(candidate))
    ).toBe(202);
    expect(() =>
      buildStoryStructureProposalV1FromCandidate({
        projectId: PROJECT,
        bookId: BOOK,
        expectedProjectVersion: 1,
        contextReceiptHash: RECEIPT,
        candidate,
        context: storyStructureLoweringContextFromBook(PROJECT, emptyBook(), []),
        ids
      })
    ).toThrow(DomainValidationError);
    expect(create).not.toHaveBeenCalled();
  });

  it("requires a nonblank objective for existing chapter updates", () => {
    const existingChapter = chapterId("chapter-existing");
    expect(() =>
      validateStoryStructureProposalCandidatesV1({
        schemaId: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
        newParts: [],
        newChapters: [],
        newPlannedScenes: [],
        existingChapterUpdates: [{ chapterId: existingChapter, objective: "   " }],
        chapterReorders: [],
        existingSceneMoves: [],
        existingSceneArchiveChanges: [],
        existingSceneIntentUpdates: []
      })
    ).toThrow(DomainValidationError);
  });

  it("validates stored proposals and leaves other agent schemas unchanged", () => {
    const candidate = threeChapterCandidate();
    const proposal = buildStoryStructureProposalV1FromCandidate({
      projectId: PROJECT,
      bookId: BOOK,
      expectedProjectVersion: 2,
      contextReceiptHash: RECEIPT,
      candidate,
      context: storyStructureLoweringContextFromBook(PROJECT, emptyBook(), []),
      ids: sequenceIds({
        storyStructureOperation: Array.from({ length: 12 }, (_, index) => `op-${index + 1}`),
        part: ["part-x"],
        chapter: ["ch-x-1", "ch-x-2", "ch-x-3"],
        scene: ["sc-x-1", "sc-x-2", "sc-x-3"]
      })
    });
    expect(validateStoryStructureProposalV1(proposal).schemaId).toBe(STORY_STRUCTURE_SCHEMA_ID);
    expect(
      validateCaptureReflectionV1({
        schemaId: "capture-reflection-v1",
        summary: "Still valid.",
        questions: ["Why?"],
        possibleStoryJobs: [{ label: "Beat", rationale: "Because." }]
      }).schemaId
    ).toBe("capture-reflection-v1");
  });

  it("rejects moving archived scenes without an explicit restore", () => {
    const existingScene = sceneId("scene-existing");
    const book = emptyBook();
    const context = storyStructureLoweringContextFromBook(PROJECT, book, [
      createScene({
        id: existingScene,
        projectId: PROJECT,
        bookId: BOOK,
        title: "Archived",
        status: "planned",
        archivedAt: "2026-09-13T00:00:00.000Z"
      })
    ]);
    expect(() =>
      buildStoryStructureProposalV1FromCandidate({
        projectId: PROJECT,
        bookId: BOOK,
        expectedProjectVersion: 1,
        contextReceiptHash: RECEIPT,
        candidate: {
          schemaId: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
          newParts: [],
          newChapters: [],
          newPlannedScenes: [],
          existingChapterUpdates: [],
          chapterReorders: [],
          existingSceneMoves: [
            {
              sceneId: existingScene,
              destination: { kind: "unassigned" },
              position: 0
            }
          ],
          existingSceneArchiveChanges: [],
          existingSceneIntentUpdates: []
        },
        context,
        ids: sequenceIds({ storyStructureOperation: ["op-move"] })
      })
    ).toThrow(DomainValidationError);
  });
});
