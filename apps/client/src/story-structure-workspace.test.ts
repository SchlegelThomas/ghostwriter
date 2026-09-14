import { describe, expect, it } from "vitest";
import {
  accountId,
  agentProposalId,
  bookId,
  canvasObjectId,
  createBook,
  createManuscriptStructure,
  createStoryWorkAssignment,
  instructionContentHash,
  partId,
  sceneId,
  storyStructureOperationId,
  storyWorkAssignmentId,
  STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
  STORY_STRUCTURE_SCHEMA_ID,
  buildStoryStructureProposalV1FromCandidate,
  storyStructureLoweringContextFromBook,
  type StoryStructureDependency,
  type StoryStructureOperation,
  type StoryWorkAssignment
} from "@ghostwriter/core";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_NAVIGATOR
} from "../../../packages/core/src/fixtures.js";
import {
  addRequiredStoryStructureOperations,
  buildOutlineStoryWorkCreateInput,
  buildStoryStructureOperationViewRows,
  defaultStoryStructureSelectedOperationIds,
  deriveOutlineStoryWorkDefaultTargetBookId,
  deriveStructureCanvasPlacementCandidate,
  groupStoryStructureOperationViewRows,
  patchStoryStructureReviewPayload,
  selectedStoryStructureCreatedSceneIds,
  storyStructurePreviewCacheFingerprint,
  storyStructurePreviewCacheMatches,
  storyStructureSelectionMissingRequired,
  structureApplySuccessNavigationTarget,
  structureApplySuccessNavigationTargetFromResult,
  structureCanvasPlacementAcknowledgment,
  structureStoryWorkAppliedPresentationFromApply,
  structureStoryWorkAppliedPresentationFromAssignment,
  toggleStoryStructureOperationSelection,
  type OutlineStoryWorkSubmitBrief
} from "./story-structure-workspace.js";

const navigator = BELLWETHER_FIXTURE_NAVIGATOR;
const arrivalScene = BELLWETHER_FIXTURE.scenes[0]!.id;
const signalBook = bookId("book-signal-at-bellwether");
const receiptHash = instructionContentHash("c".repeat(64));

function sequenceIds(): { create(kind: string): string } {
  let index = 0;
  const values = [
    "op-part",
    "op-ch-1",
    "op-reorder",
    "op-sc-1",
    "part-canonical",
    "chapter-canonical",
    "scene-canonical"
  ];
  return {
    create(): string {
      const value = values[index];
      index += 1;
      if (value === undefined) throw new Error("No id left");
      return value;
    }
  };
}

function sampleProposal() {
  return buildStoryStructureProposalV1FromCandidate({
    projectId: BELLWETHER_FIXTURE.project.id,
    bookId: signalBook,
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
      BELLWETHER_FIXTURE.project.id,
      createBook({
        id: signalBook,
        projectId: BELLWETHER_FIXTURE.project.id,
        title: "Signal",
        status: "drafting",
        manuscript: createManuscriptStructure({ parts: [], unassignedSceneIds: [] }),
        createdAt: "2026-09-12T12:00:00.000Z"
      }),
      []
    ),
    ids: sequenceIds() as never
  });
}

function proposalWithDependencies(
  operations: readonly StoryStructureOperation[],
  edges: readonly StoryStructureDependency[]
) {
  return Object.freeze({
    schemaId: STORY_STRUCTURE_SCHEMA_ID,
    projectId: BELLWETHER_FIXTURE.project.id,
    bookId: signalBook,
    expectedProjectVersion: BELLWETHER_FIXTURE.project.version,
    contextReceiptHash: receiptHash,
    operations: Object.freeze(operations),
    dependencies: Object.freeze(edges)
  });
}

describe("story structure workspace helpers", () => {
  it("defaults outline target book from selected scene then first active book", () => {
    expect(
      deriveOutlineStoryWorkDefaultTargetBookId({
        navigator,
        selectedSceneId: arrivalScene
      })
    ).toBe(signalBook);
    expect(
      deriveOutlineStoryWorkDefaultTargetBookId({
        navigator,
        selectedSceneId: sceneId("missing-scene")
      })
    ).toBe(signalBook);
  });

  it("builds outline create transport input from navigator and submit brief", () => {
    const brief: OutlineStoryWorkSubmitBrief = {
      taskKind: "outline",
      targetBookId: signalBook,
      brief: "  Outline the harbor book.  ",
      constraints: "Keep canon.",
      doneWhen: "Ready to review.",
      sceneIds: [arrivalScene],
      model: "gpt-4.1"
    };
    expect(buildOutlineStoryWorkCreateInput(navigator, brief, "outline-key")).toEqual({
      projectId: navigator.id,
      expectedProjectVersion: navigator.version,
      idempotencyKey: "outline-key",
      brief: "  Outline the harbor book.  ",
      constraints: "Keep canon.",
      doneWhen: "Ready to review.",
      sceneIds: [arrivalScene],
      model: "gpt-4.1",
      targetBookId: signalBook
    });
  });

  it("groups operation rows with stable labels and ids", () => {
    const proposal = sampleProposal();
    const rows = buildStoryStructureOperationViewRows(proposal);
    expect(rows.length).toBe(proposal.operations.length);
    expect(rows.every((row) => row.operationId.length > 0)).toBe(true);
    const groups = groupStoryStructureOperationViewRows(rows);
    expect(groups.some((group) => group.rows.length > 0)).toBe(true);
    expect(defaultStoryStructureSelectedOperationIds(proposal)).toEqual(
      proposal.operations.map((operation) => operation.operationId).sort()
    );
  });

  it("toggles selection without silently widening dependencies", () => {
    const opPart = storyStructureOperationId("op-part");
    const opScene = storyStructureOperationId("op-sc-1");
    const proposal = proposalWithDependencies(
      [
        {
          type: "part.create",
          operationId: opPart,
          bookId: signalBook,
          partId: partId("part-1"),
          title: "Act"
        },
        {
          type: "scene.createPlanned",
          operationId: opScene,
          bookId: signalBook,
          sceneId: sceneId("scene-new"),
          title: "Opening"
        }
      ],
      [
        Object.freeze({ operationId: opPart, requires: Object.freeze([]) }),
        Object.freeze({ operationId: opScene, requires: Object.freeze([opPart]) })
      ]
    );
    expect(toggleStoryStructureOperationSelection([opPart], opScene)).toEqual([opPart, opScene]);
    expect(
      storyStructureSelectionMissingRequired({ proposal, selectedOperationIds: [opScene] })
    ).toEqual([opPart]);
    expect(
      addRequiredStoryStructureOperations({ proposal, selectedOperationIds: [opScene] })
    ).toEqual([opPart, opScene]);
  });

  it("patches editable fields while preserving authority ids and dependencies", () => {
    const stored = sampleProposal();
    const operationId = stored.operations.find((operation) => operation.type === "chapter.create")
      ?.operationId;
    expect(operationId).toBeDefined();
    const patched = patchStoryStructureReviewPayload({
      stored,
      edits: {
        [operationId!]: { title: "  Revised chapter title  ", objective: "  Sharper objective  " }
      }
    });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.payload.dependencies).toEqual(stored.dependencies);
    expect(patched.payload.operations.length).toBe(stored.operations.length);
    const storedChapter = stored.operations.find(
      (operation): operation is Extract<StoryStructureOperation, { type: "chapter.create" }> =>
        operation.operationId === operationId && operation.type === "chapter.create"
    );
    const editedChapter = patched.payload.operations.find(
      (operation): operation is Extract<StoryStructureOperation, { type: "chapter.create" }> =>
        operation.operationId === operationId && operation.type === "chapter.create"
    );
    expect(editedChapter?.title).toBe("Revised chapter title");
    expect(editedChapter?.objective).toBe("Sharper objective");
    expect(editedChapter?.chapterId).toBe(storedChapter?.chapterId);
    const invalid = patchStoryStructureReviewPayload({
      stored,
      edits: { [operationId!]: { title: "   " } }
    });
    expect(invalid.ok).toBe(false);
  });

  it("derives created scene ids and a single canvas placement candidate", () => {
    const proposal = sampleProposal();
    const selected = defaultStoryStructureSelectedOperationIds(proposal);
    const created = selectedStoryStructureCreatedSceneIds({ proposal, selectedOperationIds: selected });
    expect(created).toHaveLength(1);
    expect(
      deriveStructureCanvasPlacementCandidate({
        createdSceneIds: created,
        preferredSceneId: created[0]
      })
    ).toBe(created[0]);
  });

  it("invalidates preview cache fingerprints when payload or selection changes", () => {
    const proposal = sampleProposal();
    const artifact = {
      proposalId: agentProposalId("proposal-1"),
      artifactVersion: 1,
      contentHash: instructionContentHash("a".repeat(64))
    };
    const selected = defaultStoryStructureSelectedOperationIds(proposal);
    const fingerprint = storyStructurePreviewCacheFingerprint({
      artifact,
      payload: proposal,
      selectedOperationIds: selected
    });
    expect(
      storyStructurePreviewCacheMatches(fingerprint, {
        artifact,
        payload: proposal,
        selectedOperationIds: selected
      })
    ).toBe(true);
    const toggled = toggleStoryStructureOperationSelection(selected, selected[0]!);
    expect(
      storyStructurePreviewCacheMatches(fingerprint, {
        artifact,
        payload: proposal,
        selectedOperationIds: toggled
      })
    ).toBe(false);
  });

  function structureApplyResult(
    result: Extract<StoryWorkAssignment["results"][number], { kind: "story-structure" }>
  ) {
    return {
      replayed: false,
      assignment: {} as never,
      proposal: {} as never,
      result
    };
  }

  function reloadedOutlineAssignment(
    result: Extract<StoryWorkAssignment["results"][number], { kind: "story-structure" }>
  ): StoryWorkAssignment {
    return createStoryWorkAssignment({
      id: storyWorkAssignmentId("assignment-outline-applied"),
      projectId: navigator.id,
      initiatorAccountId: accountId("outline-owner"),
      version: 3,
      taskKind: "outline",
      brief: "Outline the active book structure.",
      constraints: "Respect existing canon.",
      doneWhen: "Structure is applied.",
      sources: [{ kind: "book", bookId: signalBook, projectVersion: navigator.version }],
      destination: { kind: "book", operation: "update", bookId: signalBook },
      provider: "openai",
      model: "gpt-4.1",
      status: "applied",
      steps: [{ id: "structure", title: "Propose structure", dependencies: [] }],
      currentArtifact: {
        proposalId: agentProposalId("proposal-outline-applied"),
        artifactVersion: 1,
        contentHash: instructionContentHash("b".repeat(64))
      },
      generatedArtifact: {
        proposalId: agentProposalId("proposal-outline-applied"),
        artifactVersion: 1,
        contentHash: instructionContentHash("b".repeat(64))
      },
      results: [result],
      idempotencyKey: "outline-applied",
      createdAt: "2026-09-12T12:00:00.000Z",
      updatedAt: "2026-09-12T12:01:00.000Z"
    });
  }

  it("derives navigation and presentation from durable story-structure apply results", () => {
    const created = sceneId("scene-canonical");
    const cardId = canvasObjectId("canvas-card-1");
    const durable = {
      kind: "story-structure" as const,
      bookId: signalBook,
      projectVersion: 9,
      resolvedOperationIds: [storyStructureOperationId("op-sc-1")],
      createdSceneIds: [created],
      canvasPlacedSceneId: created,
      canvasObjectId: cardId
    };
    expect(structureApplySuccessNavigationTarget(structureApplyResult(durable))).toEqual({
      kind: "scene",
      sceneId: created
    });
    expect(
      structureStoryWorkAppliedPresentationFromApply({
        applyResult: structureApplyResult(durable),
        sceneTitle: () => "Opening harbor"
      })
    ).toEqual({
      appliedProjectVersion: 9,
      bookId: signalBook,
      firstCreatedSceneId: created,
      canvasPlacedSceneId: created,
      canvasObjectId: cardId,
      canvasPlacedSceneLabel: "Opening harbor"
    });
    expect(
      structureCanvasPlacementAcknowledgment({
        result: durable,
        sceneTitle: () => "Opening harbor"
      })
    ).toEqual({
      sceneId: created,
      canvasObjectId: cardId,
      label: "Opening harbor"
    });
  });

  it("reconstructs applied presentation from a reloaded outline assignment only", () => {
    const created = sceneId("scene-reloaded");
    const assignment = reloadedOutlineAssignment({
      kind: "story-structure",
      bookId: signalBook,
      projectVersion: 10,
      resolvedOperationIds: [storyStructureOperationId("op-part")],
      createdSceneIds: [created]
    });
    expect(
      structureStoryWorkAppliedPresentationFromAssignment({
        assignment,
        sceneTitle: (id) => (id === created ? "Reloaded scene" : undefined)
      })
    ).toEqual({
      appliedProjectVersion: 10,
      bookId: signalBook,
      firstCreatedSceneId: created
    });
    expect(
      structureApplySuccessNavigationTargetFromResult(
        assignment.results[0] as Extract<
          StoryWorkAssignment["results"][number],
          { kind: "story-structure" }
        >
      )
    ).toEqual({ kind: "scene", sceneId: created });
  });

  it("handles metadata-only structure results with no created scenes", () => {
    const durable = {
      kind: "story-structure" as const,
      bookId: signalBook,
      projectVersion: 11,
      resolvedOperationIds: [storyStructureOperationId("op-part")],
      createdSceneIds: [] as readonly ReturnType<typeof sceneId>[]
    };
    expect(structureApplySuccessNavigationTarget(structureApplyResult(durable))).toEqual({
      kind: "book",
      bookId: signalBook
    });
    expect(
      structureStoryWorkAppliedPresentationFromAssignment({
        assignment: reloadedOutlineAssignment(durable)
      })
    ).toEqual({
      appliedProjectVersion: 11,
      bookId: signalBook
    });
    expect(structureCanvasPlacementAcknowledgment({ result: durable })).toBeUndefined();
  });
});
