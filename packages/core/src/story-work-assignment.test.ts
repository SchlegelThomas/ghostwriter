import { describe, expect, it } from "vitest";
import type { AgentModelId } from "./agent-context-receipt.js";
import { instructionContentHash } from "./agent-domain.js";
import { captureContentHash } from "./capture-documents.js";
import {
  agentProposalId,
  agentRunId,
  bookId,
  canvasObjectId,
  captureId,
  projectId,
  revisionId,
  sceneId,
  sceneVariantId,
  storyKnowledgeId
} from "./domain.js";
import { accountId } from "./identity.js";
import { sceneContentHash } from "./scene-documents.js";
import { storyStructureOperationId } from "./story-structure-proposal-v1.js";
import {
  STORY_WORK_MAX_SOURCES,
  STORY_WORK_MAX_STEPS,
  StoryWorkAssignmentTransitionError,
  attachGeneratedStoryWorkArtifact,
  createStoryWorkAssignment,
  finishStoryWorkAttemptWithoutArtifact,
  openStoryWorkArtifactReview,
  recordAppliedStoryWorkAssignmentFromUnitOfWork,
  recordReviewedStoryWorkAssignment,
  replaceStoryWorkReviewArtifact,
  startStoryWorkAttempt,
  storyWorkAssignmentId,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment
} from "./story-work-assignment.js";

const PROJECT = projectId("project-assignment");
const OWNER = accountId("account-owner");
const DESTINATION = storyKnowledgeId("knowledge-reserved-character");
const RUN_ONE = agentRunId("run-character-1");
const RUN_TWO = agentRunId("run-character-2");
const CHECK_SCENE = sceneId("scene-check-target");
const CONTEXT_SCENE = sceneId("scene-check-context");
const SCENE_HEAD_HASH = sceneContentHash("a".repeat(64));
const CONTEXT_SCENE_HEAD_HASH = sceneContentHash("c".repeat(64));
const DRAFT_SOURCE_ASSIGNMENT = storyWorkAssignmentId("assignment-scene-draft-source");

function artifact(
  proposal: string,
  artifactVersion: number,
  hashCharacter: string
): StoryWorkArtifactPointer {
  return {
    proposalId: agentProposalId(proposal),
    artifactVersion,
    contentHash: instructionContentHash(hashCharacter.repeat(64))
  };
}

function assignment(
  overrides: Partial<StoryWorkAssignment> = {}
): StoryWorkAssignment {
  return createStoryWorkAssignment({
    id: storyWorkAssignmentId("assignment-character"),
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "character",
    brief: "  Build Mara from her conflicting loyalties.\nKeep the doubt.  ",
    constraints: "  No prophecy.  ",
    doneWhen: "  Ready for a writer review.  ",
    sources: [{ kind: "project", projectId: PROJECT, projectVersion: 7 }],
    destination: {
      kind: "story-knowledge",
      storyKnowledgeId: DESTINATION,
      operation: "create"
    },
    provider: "openai",
    model: "gpt-4.1" as AgentModelId,
    status: "brief-ready",
    steps: [
      { id: "draft", title: "Draft the character", dependencies: [] },
      {
        id: "check",
        title: "Check the draft",
        dependencies: [{ stepId: "draft", requiredState: "artifact-ready" }]
      }
    ],
    results: [],
    idempotencyKey: "submit-character-1",
    createdAt: "2026-09-12T12:00:00.000Z",
    updatedAt: "2026-09-12T12:00:00.000Z",
    ...overrides
  });
}

function readyForReview(): StoryWorkAssignment {
  const running = startStoryWorkAttempt({
    assignment: assignment(),
    expectedVersion: 1,
    runId: RUN_ONE,
    updatedAt: "2026-09-12T12:01:00.000Z"
  });
  const ready = attachGeneratedStoryWorkArtifact({
    assignment: running,
    expectedVersion: 2,
    runId: RUN_ONE,
    artifact: artifact("proposal-character-1", 1, "a"),
    updatedAt: "2026-09-12T12:02:00.000Z"
  });
  return openStoryWorkArtifactReview({
    assignment: ready,
    expectedVersion: 3,
    artifact: ready.currentArtifact!,
    updatedAt: "2026-09-12T12:03:00.000Z"
  });
}

describe("story work assignment", () => {
  it("preserves exact nonempty writer text and a server-reserved character destination", () => {
    const created = assignment();

    expect(created.brief).toBe(
      "  Build Mara from her conflicting loyalties.\nKeep the doubt.  "
    );
    expect(created.constraints).toBe("  No prophecy.  ");
    expect(created.doneWhen).toBe("  Ready for a writer review.  ");
    expect(created.destination).toEqual({
      kind: "story-knowledge",
      storyKnowledgeId: DESTINATION,
      operation: "create"
    });
    expect(() => assignment({ brief: " \n " })).toThrow(/brief/i);
    expect(() => assignment({ constraints: " " })).toThrow(/constraints/i);
    expect(() => assignment({ doneWhen: "\n" })).toThrow(/done condition/i);
    expect(() =>
      assignment({
        destination: {
          kind: "scene",
          sceneId: "scene-wrong" as never,
          operation: "create"
        }
      })
    ).toThrow(/reserved story-knowledge destination/i);
  });

  it("rejects duplicate, self, cyclic, malformed, and over-bound references", () => {
    expect(() =>
      assignment({
        steps: [
          {
            id: "self",
            title: "Self",
            dependencies: [{ stepId: "self", requiredState: "applied" }]
          }
        ]
      })
    ).toThrow(/itself/i);

    expect(() =>
      assignment({
        steps: [
          {
            id: "one",
            title: "One",
            dependencies: [{ stepId: "two", requiredState: "artifact-ready" }]
          },
          {
            id: "two",
            title: "Two",
            dependencies: [{ stepId: "one", requiredState: "applied" }]
          }
        ]
      })
    ).toThrow(/cycle/i);

    expect(() =>
      assignment({
        steps: [
          { id: "same", title: "One", dependencies: [] },
          { id: "same", title: "Two", dependencies: [] }
        ]
      })
    ).toThrow(/duplicate step/i);

    expect(() =>
      assignment({
        steps: Array.from({ length: STORY_WORK_MAX_STEPS + 1 }, (_, index) => ({
          id: `step-${index}`,
          title: `Step ${index}`,
          dependencies: []
        }))
      })
    ).toThrow(/1-20 steps/i);

    expect(() =>
      assignment({
        sources: Array.from({ length: STORY_WORK_MAX_SOURCES + 1 }, (_, index) => ({
          kind: "capture" as const,
          captureId: captureId(`capture-${index}`),
          workingVersion: 1,
          contentHash: captureContentHash("a".repeat(64))
        }))
      })
    ).toThrow(/100 sources/i);

    expect(() =>
      assignment({ taskKind: "invent" as StoryWorkAssignment["taskKind"] })
    ).toThrow(/task kind/i);
    expect(() =>
      assignment({
        destination: {
          kind: "bogus"
        } as unknown as StoryWorkAssignment["destination"]
      })
    ).toThrow(/destination kind/i);
    expect(() =>
      assignment({
        sources: [
          { kind: "project", projectId: PROJECT, projectVersion: 1 },
          { kind: "project", projectId: PROJECT, projectVersion: 2 }
        ]
      })
    ).toThrow(/duplicate source/i);
  });

  it("fences stale completion after cancel and retry by version and active run", () => {
    const first = startStoryWorkAttempt({
      assignment: assignment(),
      expectedVersion: 1,
      runId: RUN_ONE,
      updatedAt: "2026-09-12T12:01:00.000Z"
    });
    expect(first.latestAttemptId).toBe(RUN_ONE);
    const canceled = finishStoryWorkAttemptWithoutArtifact({
      assignment: first,
      expectedVersion: 2,
      runId: RUN_ONE,
      outcome: "canceled",
      updatedAt: "2026-09-12T12:02:00.000Z"
    });
    expect(canceled.currentArtifact).toBeUndefined();
    expect(canceled.latestAttemptId).toBe(RUN_ONE);

    const retry = startStoryWorkAttempt({
      assignment: canceled,
      expectedVersion: 3,
      runId: RUN_TWO,
      updatedAt: "2026-09-12T12:03:00.000Z"
    });
    expect(retry.latestAttemptId).toBe(RUN_TWO);
    expect(() =>
      attachGeneratedStoryWorkArtifact({
        assignment: retry,
        expectedVersion: 4,
        runId: RUN_ONE,
        artifact: artifact("proposal-stale", 1, "b"),
        updatedAt: "2026-09-12T12:04:00.000Z"
      })
    ).toThrow(StoryWorkAssignmentTransitionError);

    const ready = attachGeneratedStoryWorkArtifact({
      assignment: retry,
      expectedVersion: 4,
      runId: RUN_TWO,
      artifact: artifact("proposal-retry", 1, "c"),
      updatedAt: "2026-09-12T12:04:00.000Z"
    });
    expect(ready.status).toBe("artifact-ready");
    expect(ready.activeAttemptId).toBeUndefined();
    expect(ready.latestAttemptId).toBe(RUN_TWO);
    expect(ready.generatedArtifact).toEqual(ready.currentArtifact);
  });

  it("never turns provider failure or cancellation into an artifact-ready state", () => {
    const running = startStoryWorkAttempt({
      assignment: assignment(),
      expectedVersion: 1,
      runId: RUN_ONE,
      updatedAt: "2026-09-12T12:01:00.000Z"
    });
    const failed = finishStoryWorkAttemptWithoutArtifact({
      assignment: running,
      expectedVersion: 2,
      runId: RUN_ONE,
      outcome: "failed",
      updatedAt: "2026-09-12T12:02:00.000Z"
    });

    expect(failed.status).toBe("failed");
    expect(failed.currentArtifact).toBeUndefined();
    expect(failed.latestAttemptId).toBe(RUN_ONE);
    expect(() =>
      attachGeneratedStoryWorkArtifact({
        assignment: failed,
        expectedVersion: 3,
        runId: RUN_ONE,
        artifact: artifact("proposal-after-failure", 1, "d"),
        updatedAt: "2026-09-12T12:03:00.000Z"
      })
    ).toThrow(StoryWorkAssignmentTransitionError);
  });

  it("retains the failed revision attempt while preserving the prior review artifact", () => {
    const review = readyForReview();
    const priorArtifact = review.currentArtifact;
    const running = startStoryWorkAttempt({
      assignment: review,
      expectedVersion: 4,
      runId: RUN_TWO,
      updatedAt: "2026-09-12T12:04:00.000Z"
    });
    const failed = finishStoryWorkAttemptWithoutArtifact({
      assignment: running,
      expectedVersion: 5,
      runId: RUN_TWO,
      outcome: "failed",
      updatedAt: "2026-09-12T12:05:00.000Z"
    });

    expect(failed).toMatchObject({
      status: "failed",
      latestAttemptId: RUN_TWO,
      currentArtifact: priorArtifact,
      generatedArtifact: review.generatedArtifact
    });
    expect(failed.activeAttemptId).toBeUndefined();
  });

  it("rejects assignments whose active and latest attempts disagree", () => {
    expect(() =>
      assignment({
        status: "running",
        activeAttemptId: RUN_ONE,
        latestAttemptId: RUN_TWO
      })
    ).toThrow(/active attempt.*latest attempt/i);
  });

  it("allows identical generated content under a new proposal and next artifact version", () => {
    const review = readyForReview();
    const retry = startStoryWorkAttempt({
      assignment: review,
      expectedVersion: 4,
      runId: RUN_TWO,
      updatedAt: "2026-09-12T12:04:00.000Z"
    });
    const sameContent = attachGeneratedStoryWorkArtifact({
      assignment: retry,
      expectedVersion: 5,
      runId: RUN_TWO,
      expectedCurrentArtifact: review.currentArtifact,
      artifact: artifact("proposal-character-same-content", 2, "a"),
      updatedAt: "2026-09-12T12:05:00.000Z"
    });

    expect(sameContent.currentArtifact).toMatchObject({
      proposalId: agentProposalId("proposal-character-same-content"),
      artifactVersion: 2,
      contentHash: review.currentArtifact?.contentHash
    });
  });

  it("creates immutable review lineage and applies only the exact current artifact", () => {
    const review = readyForReview();
    const original = review.currentArtifact!;
    const editedArtifact = artifact("proposal-character-edit", 2, "e");
    const edited = replaceStoryWorkReviewArtifact({
      assignment: review,
      expectedVersion: 4,
      expectedCurrentArtifact: original,
      nextArtifact: editedArtifact,
      updatedAt: "2026-09-12T12:04:00.000Z"
    });

    expect(review.currentArtifact).toEqual(original);
    expect(review.generatedArtifact).toEqual(original);
    expect(edited.currentArtifact).toEqual(editedArtifact);
    expect(edited.generatedArtifact).toEqual(original);
    expect(() =>
      replaceStoryWorkReviewArtifact({
        assignment: edited,
        expectedVersion: 5,
        expectedCurrentArtifact: editedArtifact,
        nextArtifact: artifact("proposal-character-edit", 3, "f"),
        updatedAt: "2026-09-12T12:05:00.000Z"
      })
    ).toThrow(/new proposal/i);
    expect(() =>
      recordAppliedStoryWorkAssignmentFromUnitOfWork({
        assignment: edited,
        expectedVersion: 5,
        artifact: original,
        results: [
          {
            kind: "story-knowledge",
            storyKnowledgeId: DESTINATION,
            projectVersion: 8
          }
        ],
        updatedAt: "2026-09-12T12:05:00.000Z"
      })
    ).toThrow(StoryWorkAssignmentTransitionError);
    expect(() =>
      recordAppliedStoryWorkAssignmentFromUnitOfWork({
        assignment: edited,
        expectedVersion: 5,
        artifact: editedArtifact,
        results: [
          {
            kind: "story-knowledge",
            storyKnowledgeId: storyKnowledgeId("knowledge-wrong"),
            projectVersion: 8
          }
        ],
        updatedAt: "2026-09-12T12:05:00.000Z"
      })
    ).toThrow(/exact reserved destination/i);

    const applied = recordAppliedStoryWorkAssignmentFromUnitOfWork({
      assignment: edited,
      expectedVersion: 5,
      artifact: editedArtifact,
      results: [
        {
          kind: "story-knowledge",
          storyKnowledgeId: DESTINATION,
          projectVersion: 8
        }
      ],
      updatedAt: "2026-09-12T12:05:00.000Z"
    });
    expect(applied).toMatchObject({ status: "applied", version: 6 });
    expect(applied.generatedArtifact).toEqual(original);
  });

  it("records paired apply replay identity and requires a revision for variant results", () => {
    const review = readyForReview();
    const requestFingerprint = instructionContentHash("9".repeat(64));
    const applied = recordAppliedStoryWorkAssignmentFromUnitOfWork({
      assignment: review,
      expectedVersion: review.version,
      artifact: review.currentArtifact!,
      results: [{
        kind: "story-knowledge",
        storyKnowledgeId: DESTINATION,
        projectVersion: 8
      }],
      applyRequest: {
        idempotencyKey: "apply-character-once",
        requestFingerprint
      },
      updatedAt: "2026-09-12T12:04:00.000Z"
    });
    expect(applied).toMatchObject({
      applyIdempotencyKey: "apply-character-once",
      applyRequestFingerprint: requestFingerprint
    });
    expect(() => createStoryWorkAssignment({
      ...applied,
      applyRequestFingerprint: undefined
    })).toThrow(/recorded together/i);

    expect(() => createStoryWorkAssignment({
      ...applied,
      taskKind: "revise",
      destination: {
        kind: "scene",
        sceneId: sceneId("scene-variant-target"),
        operation: "update"
      },
      results: [{
        kind: "scene",
        sceneId: sceneId("scene-variant-target"),
        workingVersion: 3,
        variantId: sceneVariantId("variant-without-revision")
      }]
    })).toThrow(/requires its immutable revision/i);
    expect(createStoryWorkAssignment({
      ...applied,
      taskKind: "revise",
      destination: {
        kind: "scene",
        sceneId: sceneId("scene-variant-target"),
        operation: "update"
      },
      results: [{
        kind: "scene",
        sceneId: sceneId("scene-variant-target"),
        workingVersion: 3,
        revisionId: revisionId("revision-variant"),
        variantId: sceneVariantId("variant-with-revision")
      }]
    }).results[0]).toMatchObject({
      revisionId: revisionId("revision-variant"),
      variantId: sceneVariantId("variant-with-revision")
    });
  });

  describe("outline story work assignments", () => {
    const OUTLINE_BOOK = bookId("book-outline-target");

    function outlineAssignment(
      overrides: Partial<StoryWorkAssignment> = {}
    ): StoryWorkAssignment {
      return createStoryWorkAssignment({
        id: storyWorkAssignmentId("assignment-outline"),
        projectId: PROJECT,
        initiatorAccountId: OWNER,
        version: 1,
        taskKind: "outline",
        brief: "Develop a three-chapter outline for the active book.",
        constraints: "Respect existing canon.",
        doneWhen: "Structure is ready for writer review.",
        sources: [
          {
            kind: "book",
            bookId: OUTLINE_BOOK,
            projectVersion: 7
          }
        ],
        destination: {
          kind: "book",
          bookId: OUTLINE_BOOK,
          operation: "update"
        },
        provider: "openai",
        model: "gpt-4.1" as AgentModelId,
        status: "brief-ready",
        steps: [{ id: "structure", title: "Propose structure", dependencies: [] }],
        results: [],
        idempotencyKey: "submit-outline-1",
        createdAt: "2026-09-12T12:00:00.000Z",
        updatedAt: "2026-09-12T12:00:00.000Z",
        ...overrides
      });
    }

    it("accepts a book baseline with surrounding scene and knowledge context", () => {
      const created = outlineAssignment({
        sources: [
          { kind: "project", projectId: PROJECT, projectVersion: 7 },
          { kind: "book", bookId: OUTLINE_BOOK, projectVersion: 7 },
          {
            kind: "scene",
            sceneId: CHECK_SCENE,
            projectVersion: 7,
            workingVersion: 3,
            contentHash: SCENE_HEAD_HASH
          },
          {
            kind: "story-knowledge",
            storyKnowledgeId: storyKnowledgeId("knowledge-outline-context"),
            projectVersion: 7
          }
        ]
      });
      expect(created.destination).toEqual({
        kind: "book",
        bookId: OUTLINE_BOOK,
        operation: "update"
      });
      expect(created.sources).toHaveLength(4);
    });

    it("refuses missing baseline, forbidden sources, destination mismatch, and version drift", () => {
      expect(() =>
        outlineAssignment({
          sources: [
            {
              kind: "scene",
              sceneId: CHECK_SCENE,
              projectVersion: 7,
              workingVersion: 3,
              contentHash: SCENE_HEAD_HASH
            }
          ]
        })
      ).toThrow(/target book or project baseline/i);

      expect(() =>
        outlineAssignment({
          sources: [
            { kind: "book", bookId: OUTLINE_BOOK, projectVersion: 7 },
            {
              kind: "capture",
              captureId: captureId("capture-outline"),
              workingVersion: 1,
              contentHash: captureContentHash("f".repeat(64))
            }
          ]
        })
      ).toThrow(/Capture, proposal-artifact, or story-revision-vector/i);

      expect(() =>
        outlineAssignment({
          destination: {
            kind: "book",
            bookId: OUTLINE_BOOK,
            operation: "create"
          }
        })
      ).toThrow(/update one active book destination/i);

      expect(() =>
        outlineAssignment({
          sources: [
            { kind: "book", bookId: OUTLINE_BOOK, projectVersion: 7 },
            { kind: "project", projectId: PROJECT, projectVersion: 8 }
          ]
        })
      ).toThrow(/baseline sources must share one expected project version/i);

      expect(() =>
        outlineAssignment({
          sources: [
            { kind: "book", bookId: OUTLINE_BOOK, projectVersion: 7 },
            {
              kind: "story-knowledge",
              storyKnowledgeId: storyKnowledgeId("knowledge-outline-context"),
              projectVersion: 8
            }
          ]
        })
      ).toThrow(/match the baseline project version/i);
    });
  });

  describe("story-structure result references", () => {
    const OUTLINE_BOOK = bookId("book-structure-result");

    function outlineApplied(
      result: StoryWorkAssignment["results"][number]
    ): StoryWorkAssignment {
      return createStoryWorkAssignment({
        id: storyWorkAssignmentId("assignment-structure-result"),
        projectId: PROJECT,
        initiatorAccountId: OWNER,
        version: 2,
        taskKind: "outline",
        brief: "Apply the reviewed structure.",
        constraints: "Respect the active book.",
        doneWhen: "Structure is applied.",
        sources: [
          { kind: "book", bookId: OUTLINE_BOOK, projectVersion: 7 }
        ],
        destination: {
          kind: "book",
          bookId: OUTLINE_BOOK,
          operation: "update"
        },
        provider: "openai",
        model: "gpt-4.1" as AgentModelId,
        status: "applied",
        steps: [{ id: "structure", title: "Propose structure", dependencies: [] }],
        currentArtifact: {
          proposalId: agentProposalId("proposal-structure-result"),
          artifactVersion: 1,
          contentHash: instructionContentHash("a".repeat(64))
        },
        generatedArtifact: {
          proposalId: agentProposalId("proposal-structure-result"),
          artifactVersion: 1,
          contentHash: instructionContentHash("a".repeat(64))
        },
        results: [result],
        idempotencyKey: "submit-structure-result",
        createdAt: "2026-09-12T12:00:00.000Z",
        updatedAt: "2026-09-12T12:00:00.000Z"
      });
    }

    it("roundtrips a full structure result with Canvas placement fields", () => {
      const applied = outlineApplied({
        kind: "story-structure",
        bookId: OUTLINE_BOOK,
        projectVersion: 8,
        resolvedOperationIds: [
          storyStructureOperationId("op-part"),
          storyStructureOperationId("op-sc-1")
        ],
        createdSceneIds: [sceneId("scene-structure-result")],
        canvasPlacedSceneId: sceneId("scene-structure-result"),
        canvasObjectId: canvasObjectId("canvas-object-structure-result")
      });
      expect(applied.results[0]).toEqual({
        kind: "story-structure",
        bookId: OUTLINE_BOOK,
        projectVersion: 8,
        resolvedOperationIds: [
          storyStructureOperationId("op-part"),
          storyStructureOperationId("op-sc-1")
        ],
        createdSceneIds: [sceneId("scene-structure-result")],
        canvasPlacedSceneId: sceneId("scene-structure-result"),
        canvasObjectId: canvasObjectId("canvas-object-structure-result")
      });
    });

    it("accepts metadata-only structure results with empty created scenes", () => {
      const applied = outlineApplied({
        kind: "story-structure",
        bookId: OUTLINE_BOOK,
        projectVersion: 8,
        resolvedOperationIds: [storyStructureOperationId("op-part")],
        createdSceneIds: []
      });
      expect(
        applied.results[0]?.kind === "story-structure"
          ? applied.results[0].createdSceneIds
          : undefined
      ).toEqual([]);
    });

    it("refuses duplicate operations, partial Canvas fields, and foreign placement scenes", () => {
      expect(() =>
        outlineApplied({
          kind: "story-structure",
          bookId: OUTLINE_BOOK,
          projectVersion: 8,
          resolvedOperationIds: [
            storyStructureOperationId("op-part"),
            storyStructureOperationId("op-part")
          ],
          createdSceneIds: []
        })
      ).toThrow(/duplicate entries/i);

      expect(() =>
        outlineApplied({
          kind: "story-structure",
          bookId: OUTLINE_BOOK,
          projectVersion: 8,
          resolvedOperationIds: [storyStructureOperationId("op-part")],
          createdSceneIds: [],
          canvasPlacedSceneId: sceneId("scene-structure-result")
        })
      ).toThrow(/both scene and object/i);

      expect(() =>
        outlineApplied({
          kind: "story-structure",
          bookId: OUTLINE_BOOK,
          projectVersion: 8,
          resolvedOperationIds: [storyStructureOperationId("op-part")],
          createdSceneIds: [],
          canvasPlacedSceneId: sceneId("scene-structure-result"),
          canvasObjectId: canvasObjectId("canvas-object-structure-result")
        })
      ).toThrow(/one of the created scenes/i);

      expect(() =>
        outlineApplied({
          kind: "book",
          bookId: OUTLINE_BOOK,
          projectVersion: 8
        } as never)
      ).toThrow(/story-structure result reference/i);
    });
  });

  describe("check story work assignments", () => {
    function checkAssignment(
      overrides: Partial<StoryWorkAssignment> = {}
    ): StoryWorkAssignment {
      return createStoryWorkAssignment({
        id: storyWorkAssignmentId("assignment-check-continuity"),
        projectId: PROJECT,
        initiatorAccountId: OWNER,
        version: 1,
        taskKind: "check",
        brief: "Check continuity for the selected scene.",
        constraints: "Use only supplied context.",
        doneWhen: "Findings are ready for writer review.",
        sources: [
          {
            kind: "scene",
            sceneId: CHECK_SCENE,
            projectVersion: 7,
            workingVersion: 3,
            contentHash: SCENE_HEAD_HASH
          }
        ],
        destination: {
          kind: "scene",
          sceneId: CHECK_SCENE,
          operation: "assess"
        },
        provider: "openai",
        model: "gpt-4.1" as AgentModelId,
        status: "brief-ready",
        steps: [{ id: "check", title: "Run continuity check", dependencies: [] }],
        results: [],
        idempotencyKey: "submit-check-1",
        createdAt: "2026-09-12T12:00:00.000Z",
        updatedAt: "2026-09-12T12:00:00.000Z",
        ...overrides
      });
    }

    function checkReadyForReview(): StoryWorkAssignment {
      const running = startStoryWorkAttempt({
        assignment: checkAssignment(),
        expectedVersion: 1,
        runId: RUN_ONE,
        updatedAt: "2026-09-12T12:01:00.000Z"
      });
      const ready = attachGeneratedStoryWorkArtifact({
        assignment: running,
        expectedVersion: 2,
        runId: RUN_ONE,
        artifact: artifact("proposal-check-1", 1, "a"),
        updatedAt: "2026-09-12T12:02:00.000Z"
      });
      return openStoryWorkArtifactReview({
        assignment: ready,
        expectedVersion: 3,
        artifact: ready.currentArtifact!,
        updatedAt: "2026-09-12T12:03:00.000Z"
      });
    }

    function storyCheckResult(pointer: StoryWorkArtifactPointer) {
      return {
        kind: "story-check" as const,
        proposalId: pointer.proposalId,
        artifactVersion: pointer.artifactVersion,
        contentHash: pointer.contentHash,
        sceneId: CHECK_SCENE
      };
    }

    it("accepts applied-scene and proposal-draft targets with surrounding context sources", () => {
      const appliedScene = checkAssignment({
        sources: [
          { kind: "project", projectId: PROJECT, projectVersion: 7 },
          {
            kind: "scene",
            sceneId: CHECK_SCENE,
            projectVersion: 7,
            workingVersion: 3,
            contentHash: SCENE_HEAD_HASH
          },
          {
            kind: "scene",
            sceneId: CONTEXT_SCENE,
            projectVersion: 7,
            workingVersion: 2,
            contentHash: CONTEXT_SCENE_HEAD_HASH
          },
          {
            kind: "story-knowledge",
            storyKnowledgeId: storyKnowledgeId("knowledge-check-context"),
            projectVersion: 7
          }
        ]
      });
      expect(appliedScene.sources).toHaveLength(4);

      const proposalDraft = checkAssignment({
        sources: [
          { kind: "book", bookId: "book-check-context" as never, projectVersion: 7 },
          {
            kind: "proposal-artifact",
            assignmentId: DRAFT_SOURCE_ASSIGNMENT,
            proposalId: agentProposalId("proposal-scene-draft"),
            sceneId: CHECK_SCENE,
            artifactVersion: 2,
            contentHash: instructionContentHash("b".repeat(64))
          },
          {
            kind: "scene",
            sceneId: CONTEXT_SCENE,
            projectVersion: 7,
            workingVersion: 2,
            contentHash: CONTEXT_SCENE_HEAD_HASH
          }
        ]
      });
      expect(proposalDraft.sources.some((source) => source.kind === "proposal-artifact")).toBe(
        true
      );
    });

    it("refuses ambiguous, mixed, missing-target, and forbidden check sources", () => {
      expect(() =>
        checkAssignment({
          sources: [{ kind: "project", projectId: PROJECT, projectVersion: 7 }]
        })
      ).toThrow(/exact scene head matching/i);

      expect(() =>
        checkAssignment({
          sources: [
            {
              kind: "proposal-artifact",
              assignmentId: DRAFT_SOURCE_ASSIGNMENT,
              proposalId: agentProposalId("proposal-scene-draft"),
              sceneId: CHECK_SCENE,
              artifactVersion: 2,
              contentHash: instructionContentHash("b".repeat(64))
            },
            {
              kind: "scene",
              sceneId: CHECK_SCENE,
              projectVersion: 7,
              workingVersion: 3,
              contentHash: SCENE_HEAD_HASH
            }
          ]
        })
      ).toThrow(/separate scene source/i);

      expect(() =>
        checkAssignment({
          sources: [
            {
              kind: "proposal-artifact",
              assignmentId: DRAFT_SOURCE_ASSIGNMENT,
              proposalId: agentProposalId("proposal-scene-draft-a"),
              sceneId: CHECK_SCENE,
              artifactVersion: 2,
              contentHash: instructionContentHash("b".repeat(64))
            },
            {
              kind: "proposal-artifact",
              assignmentId: storyWorkAssignmentId("assignment-scene-draft-b"),
              proposalId: agentProposalId("proposal-scene-draft-b"),
              sceneId: sceneId("scene-other-proposal"),
              artifactVersion: 1,
              contentHash: instructionContentHash("d".repeat(64))
            }
          ]
        })
      ).toThrow(/at most one proposal-draft target/i);

      expect(() =>
        checkAssignment({
          sources: [
            {
              kind: "scene",
              sceneId: CONTEXT_SCENE,
              projectVersion: 7,
              workingVersion: 2,
              contentHash: CONTEXT_SCENE_HEAD_HASH
            },
            {
              kind: "capture",
              captureId: captureId("capture-check"),
              workingVersion: 1,
              contentHash: captureContentHash("e".repeat(64))
            }
          ]
        })
      ).toThrow(/Capture or story-revision-vector/i);

      expect(() =>
        checkAssignment({
          sources: [
            {
              kind: "scene",
              sceneId: CHECK_SCENE,
              projectVersion: 7
            }
          ]
        })
      ).toThrow(/exact acknowledged scene head/i);
    });

    it("refuses check destination mismatch and non-check assess destinations", () => {
      expect(() =>
        checkAssignment({
          destination: {
            kind: "scene",
            sceneId: sceneId("scene-other"),
            operation: "assess"
          }
        })
      ).toThrow(/exact scene head matching/i);

      expect(() =>
        assignment({
          taskKind: "revise",
          destination: {
            kind: "scene",
            sceneId: CHECK_SCENE,
            operation: "assess"
          }
        })
      ).toThrow(/Only check story work may assess/i);

      expect(() =>
        checkAssignment({
          destination: {
            kind: "scene",
            sceneId: CHECK_SCENE,
            operation: "update"
          }
        })
      ).toThrow(/assess an exact scene/i);
    });

    it("completes review through recordReviewed without apply identity", () => {
      const review = checkReadyForReview();
      const pointer = review.currentArtifact!;
      const reviewed = recordReviewedStoryWorkAssignment({
        assignment: review,
        expectedVersion: review.version,
        artifact: pointer,
        result: storyCheckResult(pointer),
        updatedAt: "2026-09-12T12:04:00.000Z"
      });

      expect(reviewed).toMatchObject({
        status: "reviewed",
        version: review.version + 1,
        results: [storyCheckResult(pointer)]
      });
      expect(reviewed.applyIdempotencyKey).toBeUndefined();
      expect(reviewed.applyRequestFingerprint).toBeUndefined();
      expect(() =>
        recordAppliedStoryWorkAssignmentFromUnitOfWork({
          assignment: review,
          expectedVersion: review.version,
          artifact: pointer,
          results: [storyCheckResult(pointer)],
          updatedAt: "2026-09-12T12:04:00.000Z"
        })
      ).toThrow(/not canonical apply/i);
    });

    it("refuses stale artifact, wrong status, and double review", () => {
      const review = checkReadyForReview();
      const pointer = review.currentArtifact!;
      const staleArtifact = artifact("proposal-check-stale", 1, "b");

      expect(() =>
        recordReviewedStoryWorkAssignment({
          assignment: review,
          expectedVersion: review.version,
          artifact: staleArtifact,
          result: storyCheckResult(staleArtifact),
          updatedAt: "2026-09-12T12:04:00.000Z"
        })
      ).toThrow(StoryWorkAssignmentTransitionError);

      const artifactReady = checkAssignment({
        status: "artifact-ready",
        version: 2,
        generatedArtifact: pointer,
        currentArtifact: pointer
      });
      expect(() =>
        recordReviewedStoryWorkAssignment({
          assignment: artifactReady,
          expectedVersion: 2,
          artifact: pointer,
          result: storyCheckResult(pointer),
          updatedAt: "2026-09-12T12:04:00.000Z"
        })
      ).toThrow(StoryWorkAssignmentTransitionError);

      const reviewed = recordReviewedStoryWorkAssignment({
        assignment: review,
        expectedVersion: review.version,
        artifact: pointer,
        result: storyCheckResult(pointer),
        updatedAt: "2026-09-12T12:04:00.000Z"
      });
      expect(() =>
        recordReviewedStoryWorkAssignment({
          assignment: reviewed,
          expectedVersion: reviewed.version,
          artifact: pointer,
          result: storyCheckResult(pointer),
          updatedAt: "2026-09-12T12:05:00.000Z"
        })
      ).toThrow(StoryWorkAssignmentTransitionError);
    });
  });

  it("requires coherent generated lineage for reviewable assignments", () => {
    const generated = artifact("proposal-generated", 1, "a");
    const edited = artifact("proposal-edited", 2, "b");
    expect(() =>
      assignment({
        status: "awaiting-review",
        version: 3,
        currentArtifact: edited
      })
    ).toThrow(/generated artifact lineage/i);
    expect(() =>
      assignment({
        status: "awaiting-review",
        version: 3,
        generatedArtifact: edited,
        currentArtifact: generated
      })
    ).toThrow(/cannot be newer/i);
    expect(() =>
      assignment({
        status: "artifact-ready",
        version: 3,
        generatedArtifact: generated,
        currentArtifact: edited
      })
    ).toThrow(/newly generated artifact/i);
    expect(() =>
      assignment({
        status: "awaiting-review",
        version: 3,
        generatedArtifact: generated,
        currentArtifact: artifact("proposal-same-version-edit", 1, "c")
      })
    ).toThrow(/must advance/i);
  });
});
