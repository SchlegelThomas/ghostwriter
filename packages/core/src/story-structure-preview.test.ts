import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it, vi } from "vitest";
import { instructionContentHash } from "./agent-domain.js";
import {
  agentProposalId,
  bookId,
  chapterId,
  createBook,
  createManuscriptChapter,
  createManuscriptPart,
  createManuscriptStructure,
  createProject,
  createScene,
  createStoryKnowledge,
  defineProjectRecords,
  DomainValidationError,
  narrativeBeatId,
  partId,
  projectId,
  revisionId,
  sceneId,
  storyKnowledgeId,
  type ProjectRecords,
  type SceneId
} from "./domain.js";
import { accountId } from "./identity.js";
import type { DomainIdKind, IdGenerator } from "./project-repository.js";
import { createSceneDocumentHead, sceneContentHash } from "./scene-documents.js";
import { createStoryAssessmentRevisionVector, storyManuscriptSliceRevisionToken } from "./story-assessment-freshness.js";
import { STORY_CHECK_SCHEMA_ID, validateStoryCheckFindingsV1 } from "./story-check-findings-v1.js";
import { buildStoryCheckRevisionVector } from "./story-check-revision-vector.js";
import { storyContextFromProjectRecords } from "./story-context.js";
import {
  STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
  buildStoryStructureProposalV1FromCandidate,
  storyStructureLoweringContextFromBook,
  storyStructureOperationId,
  type StoryStructureProposalV1
} from "./story-structure-proposal-v1.js";
import {
  createStructurePreviewOperationIdGenerator,
  prepareStoryStructureProposal,
  previewStoryStructureProposal
} from "./story-structure-preview.js";
import { storyWorkAssignmentId } from "./story-work-assignment.js";

const PROJECT = projectId("project-structure-preview");
const BOOK = bookId("book-structure-preview");
const RECEIPT = instructionContentHash("c".repeat(64));
const NOW = "2026-09-13T12:00:00.000Z";

const hashPort = {
  async digestSha256Hex(canonicalUtf8: string): Promise<string> {
    let hash = 0n;
    for (let index = 0; index < canonicalUtf8.length; index += 1) {
      hash =
        (hash * 131n + BigInt(canonicalUtf8.charCodeAt(index))) &
        ((1n << 256n) - 1n);
    }
    return hash.toString(16).padStart(64, "0");
  }
};

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

function emptyBookRecords(version = 4, options: { includeProseScene?: boolean } = {}): ProjectRecords {
  const proseScene = sceneId("scene-prose-only");
  return defineProjectRecords({
    project: createProject({
      id: PROJECT,
      title: "Preview Novel",
      bookIds: [BOOK],
      createdAt: NOW,
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
        createdAt: NOW
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
    contextReceiptHash: RECEIPT,
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

function snapshotRecords(records: ProjectRecords): string {
  return JSON.stringify(records);
}

describe("story-structure-preview", () => {
  it("previews three new chapters and scenes as one atomic version bump", async () => {
    const records = emptyBookRecords(4);
    const proposal = buildThreeChapterProposal(4);
    const selected = proposal.operations.map((operation) => operation.operationId);
    const beforeSnapshot = snapshotRecords(records);

    const result = await previewStoryStructureProposal({
      records,
      proposal,
      selectedOperationIds: selected,
      now: NOW
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.projectVersionBefore).toBe(4);
    expect(result.preview.projectVersionAfter).toBe(5);
    expect(result.preview.manuscriptSceneOrderBefore).toEqual([]);
    expect(result.preview.manuscriptSceneOrderAfter).toEqual([
      sceneId("scene-1"),
      sceneId("scene-2"),
      sceneId("scene-3")
    ]);
    expect(result.preview.chapterOrderAfter[0]?.chapterIds).toEqual([
      chapterId("chapter-1"),
      chapterId("chapter-2"),
      chapterId("chapter-3")
    ]);
    expect(result.preview.createdSceneIds).toEqual([
      sceneId("scene-1"),
      sceneId("scene-2"),
      sceneId("scene-3")
    ]);
    expect(result.preview.emptyGenesisDescriptors).toEqual([
      { projectId: PROJECT, sceneId: sceneId("scene-1") },
      { projectId: PROJECT, sceneId: sceneId("scene-2") },
      { projectId: PROJECT, sceneId: sceneId("scene-3") }
    ]);
    expect(result.preview.updatedSceneIds).toEqual([sceneId("scene-3")]);
    expect(result.preview.canvasEffect).toBe("unchanged-unless-explicitly-placed");
    expect(snapshotRecords(records)).toBe(beforeSnapshot);
  });

  it("refuses partial dependency selections with missing required operations", async () => {
    const records = emptyBookRecords(4);
    const proposal = buildThreeChapterProposal(4);
    const result = await previewStoryStructureProposal({
      records,
      proposal,
      selectedOperationIds: [storyStructureOperationId("op-sc-1")],
      now: NOW
    });
    expect(result).toEqual({
      ok: false,
      code: "MISSING_REQUIREMENTS",
      message: "Structure preview selection is invalid.",
      missingRequired: [
        storyStructureOperationId("op-ch-1"),
        storyStructureOperationId("op-part")
      ]
    });
  });

  it("refuses stale project versions before lowering", async () => {
    const records = emptyBookRecords(3);
    const proposal = buildThreeChapterProposal(4);
    const result = await previewStoryStructureProposal({
      records,
      proposal,
      selectedOperationIds: proposal.operations.map((operation) => operation.operationId),
      now: NOW
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("STALE_PROJECT_VERSION");
  });

  it("propagates kernel refusal for invalid reorder operations", async () => {
    const existingPart = partId("part-existing");
    const existingChapter = chapterId("chapter-existing");
    const records = defineProjectRecords({
      project: createProject({
        id: PROJECT,
        title: "Preview Novel",
        bookIds: [BOOK],
        createdAt: NOW,
        version: 2
      }),
      books: [
        createBook({
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
                    title: "Only",
                    sceneIds: []
                  })
                ]
              })
            ],
            unassignedSceneIds: []
          }),
          createdAt: NOW
        })
      ],
      scenes: [],
      storyKnowledge: [],
      editions: []
    });
    const proposal: StoryStructureProposalV1 = {
      schemaId: "story-structure-proposal-v1",
      projectId: PROJECT,
      bookId: BOOK,
      expectedProjectVersion: 2,
      contextReceiptHash: RECEIPT,
      operations: [
        {
          type: "chapter.reorder",
          operationId: storyStructureOperationId("op-reorder-bad"),
          bookId: BOOK,
          partId: existingPart,
          chapterIds: [chapterId("chapter-missing")]
        }
      ],
      dependencies: [
        {
          operationId: storyStructureOperationId("op-reorder-bad"),
          requires: []
        }
      ]
    };
    const result = await previewStoryStructureProposal({
      records,
      proposal,
      selectedOperationIds: [storyStructureOperationId("op-reorder-bad")],
      now: NOW
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("COMMAND_REFUSED");
  });

  it("does not mutate input records or allocate ids during preview", async () => {
    const records = emptyBookRecords(4);
    const proposal = buildThreeChapterProposal(4);
    const create = vi.fn(() => "must-not-run");
    const ids: IdGenerator = { create };
    const wrappedProposal = {
      ...proposal,
      operations: proposal.operations.map((operation) => {
        if (operation.type !== "part.create") return operation;
        return { ...operation, title: `${operation.title}-probe` };
      })
    };
    void ids;
    const beforeSnapshot = snapshotRecords(records);
    await previewStoryStructureProposal({
      records,
      proposal: wrappedProposal,
      selectedOperationIds: proposal.operations.map((operation) => operation.operationId),
      now: NOW
    });
    expect(create).not.toHaveBeenCalled();
    expect(snapshotRecords(records)).toBe(beforeSnapshot);
  });

  it("reports narrative anchor impacts for scene move and archive", async () => {
    const existingPart = partId("part-narrative");
    const chapterA = chapterId("chapter-a");
    const chapterB = chapterId("chapter-b");
    const sceneA = sceneId("scene-a");
    const sceneB = sceneId("scene-b");
    const thread = storyKnowledgeId("thread-narrative");
    const beat = narrativeBeatId("beat-narrative");
    const records = defineProjectRecords({
      project: createProject({
        id: PROJECT,
        title: "Preview Novel",
        bookIds: [BOOK],
        createdAt: NOW,
        version: 6
      }),
      books: [
        createBook({
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
                    id: chapterA,
                    title: "A",
                    sceneIds: [sceneA, sceneB]
                  }),
                  createManuscriptChapter({
                    id: chapterB,
                    title: "B",
                    sceneIds: []
                  })
                ]
              })
            ],
            unassignedSceneIds: []
          }),
          createdAt: NOW
        })
      ],
      scenes: [
        createScene({
          id: sceneA,
          projectId: PROJECT,
          bookId: BOOK,
          title: "First",
          status: "drafting"
        }),
        createScene({
          id: sceneB,
          projectId: PROJECT,
          bookId: BOOK,
          title: "Second",
          status: "drafting"
        })
      ],
      storyKnowledge: [
        createStoryKnowledge({
          id: thread,
          projectId: PROJECT,
          label: "Thread",
          kind: "thread",
          authority: "planned",
          linkedSceneIds: [sceneA, sceneB],
          linkedKnowledge: [],
          narrative: {
            resolution: "intentionally-open",
            beats: [
              {
                id: beat,
                sceneId: sceneB,
                role: "setup",
                summary: "Second scene beat",
                dependsOnBeatIds: []
              }
            ]
          }
        })
      ],
      editions: []
    });

    const proposal: StoryStructureProposalV1 = {
      schemaId: "story-structure-proposal-v1",
      projectId: PROJECT,
      bookId: BOOK,
      expectedProjectVersion: 6,
      contextReceiptHash: RECEIPT,
      operations: [
        {
          type: "scene.move",
          operationId: storyStructureOperationId("op-move-b"),
          sceneId: sceneB,
          bookId: BOOK,
          chapterId: chapterA,
          position: 0
        },
        {
          type: "scene.setArchived",
          operationId: storyStructureOperationId("op-archive-a"),
          sceneId: sceneA,
          archived: true
        }
      ],
      dependencies: [
        { operationId: storyStructureOperationId("op-move-b"), requires: [] },
        { operationId: storyStructureOperationId("op-archive-a"), requires: [] }
      ]
    };

    const result = await previewStoryStructureProposal({
      records,
      proposal,
      selectedOperationIds: [
        storyStructureOperationId("op-move-b"),
        storyStructureOperationId("op-archive-a")
      ],
      now: NOW
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.narrativeAnchorImpacts).toEqual([
      expect.objectContaining({
        beatId: beat,
        before: expect.objectContaining({ canonicalIndex: 1, anchorState: "active" }),
        after: expect.objectContaining({ canonicalIndex: 0, anchorState: "active" })
      })
    ]);
    expect(result.preview.archivedSceneIds).toEqual([sceneA]);
    expect(result.preview.movedSceneIds).toEqual([sceneB]);
  });

  it("flags manuscript-slice checks newly stale while prose-only checks stay fresh", async () => {
    const records = emptyBookRecords(4, { includeProseScene: true });
    const proposal = buildThreeChapterProposal(4);
    const sliceToken = await storyManuscriptSliceRevisionToken(
      storyContextFromProjectRecords(records, { scope: { kind: "project" } }),
      hashPort
    );
    const proseScene = sceneId("scene-prose-only");
    const proseHash = sceneContentHash("b".repeat(64));
    const manuscriptCheck = validateStoryCheckFindingsV1({
      schemaId: STORY_CHECK_SCHEMA_ID,
      specialist: "continuity",
      target: {
        mode: "applied-scene",
        projectId: PROJECT,
        sceneId: sceneId("scene-1"),
        workingVersion: 1,
        contentHash: sceneContentHash("a".repeat(64))
      },
      findings: [],
      coverage: {
        requestedScopeSummary: "Project structure",
        examined: [
          {
            sceneId: sceneId("scene-1"),
            workingVersion: 1,
            contentHash: sceneContentHash("a".repeat(64))
          }
        ],
        skipped: [],
        truncations: [],
        completeForRequestedScope: true
      },
      revisionVector: createStoryAssessmentRevisionVector([
        {
          kind: "manuscript-slice",
          scope: { kind: "project" },
          revisionToken: sliceToken
        }
      ]),
      linkedRecheckSceneIds: []
    });
    const proseCheck = validateStoryCheckFindingsV1({
      schemaId: STORY_CHECK_SCHEMA_ID,
      specialist: "continuity",
      target: {
        mode: "applied-scene",
        projectId: PROJECT,
        sceneId: proseScene,
        workingVersion: 2,
        contentHash: proseHash
      },
      findings: [],
      coverage: {
        requestedScopeSummary: "Unrelated prose",
        examined: [
          {
            sceneId: proseScene,
            workingVersion: 2,
            contentHash: proseHash
          }
        ],
        skipped: [],
        truncations: [],
        completeForRequestedScope: true
      },
      revisionVector: createStoryAssessmentRevisionVector([
        {
          kind: "scene-prose",
          sceneId: proseScene,
          workingVersion: 2,
          contentHash: proseHash
        }
      ]),
      linkedRecheckSceneIds: []
    });

    const result = await previewStoryStructureProposal({
      records,
      proposal,
      selectedOperationIds: proposal.operations.map((operation) => operation.operationId),
      now: NOW,
      hashPort,
      sceneDocumentHeads: new Map([
        [
          proseScene,
          createSceneDocumentHead({
            projectId: PROJECT,
            sceneId: proseScene,
            workingVersion: 2,
            document: validateSceneDocumentV1({
              schemaVersion: 1,
              document: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    attrs: { id: "block-prose" },
                    content: [{ type: "text", text: "Unchanged prose." }]
                  }
                ]
              }
            }),
            contentHash: proseHash,
            checkpointRevisionId: revisionId("revision-prose-only"),
            updatedByAccountId: accountId("preview-owner"),
            createdAt: NOW,
            updatedAt: NOW
          })
        ]
      ]),
      knownChecks: [
        {
          assignmentId: storyWorkAssignmentId("assignment-manuscript"),
          artifactId: agentProposalId("artifact-manuscript"),
          findings: manuscriptCheck
        },
        {
          assignmentId: storyWorkAssignmentId("assignment-prose"),
          artifactId: agentProposalId("artifact-prose"),
          findings: proseCheck
        }
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.newlyStaleChecks.map((entry) => entry.assignmentId)).toEqual([
      storyWorkAssignmentId("assignment-manuscript")
    ]);
    expect(result.preview.newlyStaleChecks[0]?.reasons[0]?.reason).toBe(
      "manuscript-slice-changed"
    );
  });

  it("describes nonlinear reading-order changes structurally via canonical index", async () => {
    const existingPart = partId("part-reorder");
    const chapter = chapterId("chapter-reorder");
    const sceneFirst = sceneId("scene-first");
    const sceneSecond = sceneId("scene-second");
    const thread = storyKnowledgeId("thread-reorder");
    const beat = narrativeBeatId("beat-reorder");
    const records = defineProjectRecords({
      project: createProject({
        id: PROJECT,
        title: "Preview Novel",
        bookIds: [BOOK],
        createdAt: NOW,
        version: 3
      }),
      books: [
        createBook({
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
                    id: chapter,
                    title: "Chapter",
                    sceneIds: [sceneFirst, sceneSecond]
                  })
                ]
              })
            ],
            unassignedSceneIds: []
          }),
          createdAt: NOW
        })
      ],
      scenes: [
        createScene({
          id: sceneFirst,
          projectId: PROJECT,
          bookId: BOOK,
          title: "Chronology first",
          status: "drafting"
        }),
        createScene({
          id: sceneSecond,
          projectId: PROJECT,
          bookId: BOOK,
          title: "Flashback",
          status: "drafting"
        })
      ],
      storyKnowledge: [
        createStoryKnowledge({
          id: thread,
          projectId: PROJECT,
          label: "Thread",
          kind: "thread",
          authority: "planned",
          linkedSceneIds: [sceneFirst, sceneSecond],
          linkedKnowledge: [],
          narrative: {
            resolution: "intentionally-open",
            beats: [
              {
                id: beat,
                sceneId: sceneSecond,
                role: "setup",
                summary: "Flashback beat",
                dependsOnBeatIds: []
              }
            ]
          }
        })
      ],
      editions: []
    });

    const proposal: StoryStructureProposalV1 = {
      schemaId: "story-structure-proposal-v1",
      projectId: PROJECT,
      bookId: BOOK,
      expectedProjectVersion: 3,
      contextReceiptHash: RECEIPT,
      operations: [
        {
          type: "scene.move",
          operationId: storyStructureOperationId("op-flashback-first"),
          sceneId: sceneSecond,
          bookId: BOOK,
          chapterId: chapter,
          position: 0
        }
      ],
      dependencies: [
        {
          operationId: storyStructureOperationId("op-flashback-first"),
          requires: []
        }
      ]
    };

    const result = await previewStoryStructureProposal({
      records,
      proposal,
      selectedOperationIds: [storyStructureOperationId("op-flashback-first")],
      now: NOW
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.manuscriptSceneOrderAfter).toEqual([sceneSecond, sceneFirst]);
    expect(result.preview.narrativeAnchorImpacts).toEqual([
      {
        beatId: beat,
        threadId: thread,
        sceneId: sceneSecond,
        before: { anchorState: "active", canonicalIndex: 1, sceneArchived: false },
        after: { anchorState: "active", canonicalIndex: 0, sceneArchived: false }
      }
    ]);
  });

  it("orders independent operations deterministically by proposal order", async () => {
    const existingPart = partId("part-independent");
    const chapterOne = chapterId("chapter-one");
    const chapterTwo = chapterId("chapter-two");
    const records = defineProjectRecords({
      project: createProject({
        id: PROJECT,
        title: "Preview Novel",
        bookIds: [BOOK],
        createdAt: NOW,
        version: 5
      }),
      books: [
        createBook({
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
                    id: chapterOne,
                    title: "One",
                    sceneIds: []
                  }),
                  createManuscriptChapter({
                    id: chapterTwo,
                    title: "Two",
                    sceneIds: []
                  })
                ]
              })
            ],
            unassignedSceneIds: []
          }),
          createdAt: NOW
        })
      ],
      scenes: [],
      storyKnowledge: [],
      editions: []
    });

    const proposal: StoryStructureProposalV1 = {
      schemaId: "story-structure-proposal-v1",
      projectId: PROJECT,
      bookId: BOOK,
      expectedProjectVersion: 5,
      contextReceiptHash: RECEIPT,
      operations: [
        {
          type: "chapter.update",
          operationId: storyStructureOperationId("op-update-two"),
          bookId: BOOK,
          partId: existingPart,
          chapterId: chapterTwo,
          objective: "Second objective"
        },
        {
          type: "chapter.update",
          operationId: storyStructureOperationId("op-update-one"),
          bookId: BOOK,
          partId: existingPart,
          chapterId: chapterOne,
          objective: "First objective"
        }
      ],
      dependencies: [
        { operationId: storyStructureOperationId("op-update-two"), requires: [] },
        { operationId: storyStructureOperationId("op-update-one"), requires: [] }
      ]
    };

    const result = await previewStoryStructureProposal({
      records,
      proposal,
      selectedOperationIds: [
        storyStructureOperationId("op-update-two"),
        storyStructureOperationId("op-update-one")
      ],
      now: NOW
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.resolvedOperationIds).toEqual([
      storyStructureOperationId("op-update-two"),
      storyStructureOperationId("op-update-one")
    ]);
  });

  it("refuses when a reserved structure id was not consumed exactly once", () => {
    const generator = createStructurePreviewOperationIdGenerator({
      type: "part.create",
      operationId: storyStructureOperationId("op-part-unconsumed"),
      bookId: BOOK,
      partId: partId("reserved-part"),
      title: "Act"
    });
    expect(() => generator.assertReservedIdsFullyConsumed()).toThrow(DomainValidationError);
    expect(generator.ids.create("part")).toBe("reserved-part");
    expect(() => generator.assertReservedIdsFullyConsumed()).not.toThrow();
    expect(() => generator.ids.create("part")).toThrow(DomainValidationError);
  });

  it("reports a fresh proposal-draft check newly stale after manuscript structure changes", async () => {
    const records = emptyBookRecords(4, { includeProseScene: true });
    const proposal = buildThreeChapterProposal(4);
    const draftScene = sceneId("scene-prose-only");
    const draftHash = instructionContentHash("d".repeat(64));
    const draftTarget = Object.freeze({
      mode: "proposal-draft" as const,
      projectId: PROJECT,
      sceneId: draftScene,
      assignmentId: storyWorkAssignmentId("draft-assignment"),
      proposalId: agentProposalId("draft-proposal"),
      artifactVersion: 1,
      contentHash: draftHash
    });
    const { revisionVector } = await buildStoryCheckRevisionVector({
      target: draftTarget,
      consumedSceneProse: [],
      manuscriptSlice: storyContextFromProjectRecords(records, { scope: { kind: "project" } }),
      hashPort
    });
    const draftCheck = validateStoryCheckFindingsV1({
      schemaId: STORY_CHECK_SCHEMA_ID,
      specialist: "continuity",
      target: draftTarget,
      findings: [],
      coverage: {
        requestedScopeSummary: "Draft plus structure",
        examined: [
          {
            sceneId: draftScene,
            workingVersion: 1,
            contentHash: sceneContentHash("e".repeat(64))
          }
        ],
        skipped: [],
        truncations: [],
        completeForRequestedScope: true
      },
      revisionVector,
      linkedRecheckSceneIds: []
    });

    const result = await previewStoryStructureProposal({
      records,
      proposal,
      selectedOperationIds: proposal.operations.map((operation) => operation.operationId),
      now: NOW,
      hashPort,
      knownChecks: [
        {
          assignmentId: storyWorkAssignmentId("assignment-draft"),
          artifactId: agentProposalId("artifact-draft"),
          findings: draftCheck,
          currentProposalDraftContentHash: draftHash
        }
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.newlyStaleChecks).toEqual([
      expect.objectContaining({
        assignmentId: storyWorkAssignmentId("assignment-draft"),
        reasons: expect.arrayContaining([
          expect.objectContaining({ reason: "manuscript-slice-changed" })
        ])
      })
    ]);
  });

  it("does not treat an already-stale proposal-draft check as newly stale when current hash is missing", async () => {
    const records = emptyBookRecords(4, { includeProseScene: true });
    const proposal = buildThreeChapterProposal(4);
    const draftScene = sceneId("scene-prose-only");
    const draftHash = instructionContentHash("f".repeat(64));
    const draftTarget = Object.freeze({
      mode: "proposal-draft" as const,
      projectId: PROJECT,
      sceneId: draftScene,
      assignmentId: storyWorkAssignmentId("draft-assignment-missing"),
      proposalId: agentProposalId("draft-proposal-missing"),
      artifactVersion: 1,
      contentHash: draftHash
    });
    const { revisionVector } = await buildStoryCheckRevisionVector({
      target: draftTarget,
      consumedSceneProse: [],
      manuscriptSlice: storyContextFromProjectRecords(records, { scope: { kind: "project" } }),
      hashPort
    });
    const draftCheck = validateStoryCheckFindingsV1({
      schemaId: STORY_CHECK_SCHEMA_ID,
      specialist: "continuity",
      target: draftTarget,
      findings: [],
      coverage: {
        requestedScopeSummary: "Draft plus structure",
        examined: [
          {
            sceneId: draftScene,
            workingVersion: 1,
            contentHash: sceneContentHash("e".repeat(64))
          }
        ],
        skipped: [],
        truncations: [],
        completeForRequestedScope: true
      },
      revisionVector,
      linkedRecheckSceneIds: []
    });

    const result = await previewStoryStructureProposal({
      records,
      proposal,
      selectedOperationIds: proposal.operations.map((operation) => operation.operationId),
      now: NOW,
      hashPort,
      knownChecks: [
        {
          assignmentId: storyWorkAssignmentId("assignment-draft-missing"),
          artifactId: agentProposalId("artifact-draft-missing"),
          findings: draftCheck
        }
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.newlyStaleChecks).toEqual([]);
  });

  it("refuses foreign known-check projects before impact evaluation", async () => {
    const records = emptyBookRecords(4);
    const proposal = buildThreeChapterProposal(4);
    const sliceToken = await storyManuscriptSliceRevisionToken(
      storyContextFromProjectRecords(records, { scope: { kind: "project" } }),
      hashPort
    );
    const foreignProject = projectId("project-foreign-check");
    const result = await previewStoryStructureProposal({
      records,
      proposal,
      selectedOperationIds: proposal.operations.map((operation) => operation.operationId),
      now: NOW,
      hashPort,
      knownChecks: [
        {
          assignmentId: storyWorkAssignmentId("assignment-foreign"),
          artifactId: agentProposalId("artifact-foreign"),
          findings: validateStoryCheckFindingsV1({
            schemaId: STORY_CHECK_SCHEMA_ID,
            specialist: "continuity",
            target: {
              mode: "applied-scene",
              projectId: foreignProject,
              sceneId: sceneId("scene-foreign"),
              workingVersion: 1,
              contentHash: sceneContentHash("a".repeat(64))
            },
            findings: [],
            coverage: {
              requestedScopeSummary: "Foreign",
              examined: [
                {
                  sceneId: sceneId("scene-foreign"),
                  workingVersion: 1,
                  contentHash: sceneContentHash("a".repeat(64))
                }
              ],
              skipped: [],
              truncations: [],
              completeForRequestedScope: true
            },
            revisionVector: createStoryAssessmentRevisionVector([
              {
                kind: "manuscript-slice",
                scope: { kind: "project" },
                revisionToken: sliceToken
              }
            ]),
            linkedRecheckSceneIds: []
          })
        }
      ]
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PROPOSAL_SCOPE_MISMATCH");
  });

  it("exposes preparation records while public preview omits nextRecords", async () => {
    const records = emptyBookRecords(4);
    const proposal = buildThreeChapterProposal(4);
    const input = {
      records,
      proposal,
      selectedOperationIds: proposal.operations.map((operation) => operation.operationId),
      now: NOW
    };

    const prepared = await prepareStoryStructureProposal(input);
    const previewOnly = await previewStoryStructureProposal(input);

    expect(prepared.ok).toBe(true);
    expect(previewOnly.ok).toBe(true);
    if (!prepared.ok || !previewOnly.ok) return;

    expect(previewOnly.preview).toEqual(prepared.preview);
    expect(Object.prototype.hasOwnProperty.call(previewOnly, "nextRecords")).toBe(false);
    expect(prepared.nextRecords.project.version).toBe(5);
    expect(prepared.preview.projectVersionAfter).toBe(5);
    expect(prepared.preview.createdSceneIds).toEqual([
      sceneId("scene-1"),
      sceneId("scene-2"),
      sceneId("scene-3")
    ]);

    const book = prepared.nextRecords.books.find((candidate) => candidate.id === BOOK);
    expect(book).toBeDefined();
    const nextSceneOrder: ReturnType<typeof sceneId>[] = [];
    for (const part of book!.manuscript.parts) {
      for (const chapter of part.chapters) {
        nextSceneOrder.push(...chapter.sceneIds);
      }
    }
    nextSceneOrder.push(...book!.manuscript.unassignedSceneIds);
    expect(nextSceneOrder).toEqual([...prepared.preview.manuscriptSceneOrderAfter]);
    expect(prepared.nextRecords.scenes.map((scene) => scene.id)).toEqual(
      expect.arrayContaining([...prepared.preview.createdSceneIds])
    );
  });

  it("keeps caller input and sealed preview immutable under mutation attempts", async () => {
    const records = emptyBookRecords(4);
    const inputSnapshot = snapshotRecords(records);
    const proposal = buildThreeChapterProposal(4);
    const input = Object.freeze({
      records,
      proposal,
      selectedOperationIds: Object.freeze(
        proposal.operations.map((operation) => operation.operationId)
      ),
      now: NOW
    });

    const prepared = await prepareStoryStructureProposal(input);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(() => {
      (prepared.preview as { projectVersionAfter: number }).projectVersionAfter = 99;
    }).toThrow();
    expect(() => {
      (prepared.preview.createdSceneIds as SceneId[]).push(sceneId("scene-tamper"));
    }).toThrow();

    expect(snapshotRecords(records)).toBe(inputSnapshot);
    expect(records.project.version).toBe(4);
  });

  it("returns the same refusal from preview and preparation", async () => {
    const records = emptyBookRecords(3);
    const proposal = buildThreeChapterProposal(4);
    const input = {
      records,
      proposal,
      selectedOperationIds: proposal.operations.map((operation) => operation.operationId),
      now: NOW
    };

    const prepared = await prepareStoryStructureProposal(input);
    const previewOnly = await previewStoryStructureProposal(input);
    expect(prepared).toEqual(previewOnly);
    expect(prepared.ok).toBe(false);
  });
});
