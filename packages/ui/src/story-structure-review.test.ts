import { describe, expect, it } from "vitest";
import {
  agentProposalId,
  bookId,
  createBook,
  createManuscriptStructure,
  instructionContentHash,
  partId,
  sceneId,
  storyStructureOperationId,
  STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
  STORY_STRUCTURE_SCHEMA_ID,
  buildStoryStructureProposalV1FromCandidate,
  storyStructureLoweringContextFromBook,
  type StoryStructureDependency,
  type StoryStructureNarrativeAnchorImpact,
  type StoryStructureOperation,
  type StoryStructurePreview
} from "@ghostwriter/core";
import { BELLWETHER_FIXTURE } from "../../core/src/fixtures.js";
import {
  addRequiredStoryStructureOperations,
  buildStoryStructureOperationViewRows,
  defaultStoryStructureSelectedOperationIds,
  groupStoryStructureOperationViewRows,
  patchStoryStructureReviewPayload,
  selectedStoryStructureCreatedSceneIds,
  storyStructureCanvasPlacementCopy,
  storyStructureCanvasInvariantCopy,
  storyStructureNarrativeImpactLine,
  storyStructureOperationGroupTitle,
  storyStructurePreviewCacheFingerprint,
  storyStructurePreviewCacheMatches,
  storyStructurePreviewImpactPresentation,
  storyStructureReviewCanApply,
  storyStructureReviewCanPreview,
  storyStructureSelectionMissingRequired,
  storyStructureCheckStalenessLine,
  toggleStoryStructureOperationSelection
} from "./story-structure-review.js";

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

describe("story structure review presentation", () => {
  it("groups operations into Part, Chapters, Planned scenes, and Existing structure", () => {
    const proposal = sampleProposal();
    const rows = buildStoryStructureOperationViewRows(proposal);
    const groups = groupStoryStructureOperationViewRows(rows);
    expect(groups.map((group) => group.title)).toEqual([
      "Part",
      "Chapters",
      "Planned scenes"
    ]);
    expect(storyStructureOperationGroupTitle("existingStructure")).toBe("Existing structure");
    expect(rows.every((row) => row.label.length > 0)).toBe(true);
    expect(rows.map((row) => row.operationId)).toEqual(
      proposal.operations.map((operation) => operation.operationId)
    );
    expect(groups.flatMap((group) => group.rows).map((row) => row.operationId)).toEqual(
      proposal.operations.map((operation) => operation.operationId)
    );
    expect(defaultStoryStructureSelectedOperationIds(proposal).length).toBe(
      proposal.operations.length
    );
  });

  it("toggles selection without widening and surfaces missing requirements", () => {
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

  it("patches editable fields while preserving authority", () => {
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
    const invalid = patchStoryStructureReviewPayload({
      stored,
      edits: { [operationId!]: { title: "   " } }
    });
    expect(invalid.ok).toBe(false);
  });

  it("matches preview cache fingerprints to artifact, payload, and selection", () => {
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
    expect(
      storyStructureReviewCanApply({
        dirty: false,
        artifactStale: false,
        proposal,
        artifact,
        payload: proposal,
        selectedOperationIds: selected,
        preview: Object.freeze({ fingerprint, preview: minimalPreview() })
      })
    ).toBe(true);
    expect(
      storyStructureReviewCanPreview({
        dirty: true,
        artifactStale: false,
        proposal,
        selectedOperationIds: selected
      })
    ).toBe(false);
  });

  it("derives created scene options and impact copy without continuity-defect language", () => {
    const proposal = sampleProposal();
    const selected = defaultStoryStructureSelectedOperationIds(proposal);
    const created = selectedStoryStructureCreatedSceneIds({
      proposal,
      selectedOperationIds: selected
    });
    expect(created).toHaveLength(1);
    expect(storyStructureCanvasPlacementCopy()).toContain("reading order");
    expect(storyStructureCanvasInvariantCopy()).toContain("never reorders");

    const impact: StoryStructureNarrativeAnchorImpact = Object.freeze({
      beatId: "beat-1" as never,
      threadId: "thread-1" as never,
      sceneId: created[0]!,
      before: Object.freeze({
        anchorState: "active",
        canonicalIndex: 1,
        sceneArchived: false
      }),
      after: Object.freeze({
        anchorState: "scene-archived",
        canonicalIndex: 0,
        sceneArchived: true
      })
    });
    const line = storyStructureNarrativeImpactLine(impact);
    expect(line).toContain("Reading order index");
    expect(line).toContain("anchor");
    expect(line.toLowerCase()).not.toContain("continuity");

    const presentation = storyStructurePreviewImpactPresentation(minimalPreview());
    expect(presentation.emptyGenesisCount).toBe(0);
    expect(
      storyStructureCheckStalenessLine({
        assignmentId: "assignment-check" as never,
        artifactId: agentProposalId("check-artifact"),
        reasons: Object.freeze([
          Object.freeze({
            dependencyKey: "manuscript-slice:project",
            reason: "manuscript-slice-changed"
          })
        ])
      })
    ).toContain("will need recheck");
  });
});

function minimalPreview(): StoryStructurePreview {
  return Object.freeze({
    resolvedOperationIds: Object.freeze([]),
    manuscriptSceneOrderBefore: Object.freeze([]),
    manuscriptSceneOrderAfter: Object.freeze([]),
    chapterOrderBefore: Object.freeze([]),
    chapterOrderAfter: Object.freeze([]),
    createdPartIds: Object.freeze([]),
    createdChapterIds: Object.freeze([]),
    createdSceneIds: Object.freeze([]),
    updatedSceneIds: Object.freeze([]),
    movedSceneIds: Object.freeze([]),
    archivedSceneIds: Object.freeze([]),
    restoredSceneIds: Object.freeze([]),
    emptyGenesisDescriptors: Object.freeze([]),
    projectVersionBefore: 1,
    projectVersionAfter: 2,
    narrativeAnchorImpacts: Object.freeze([]),
    newlyStaleChecks: Object.freeze([]),
    canvasEffect: "unchanged-unless-explicitly-placed"
  });
}
