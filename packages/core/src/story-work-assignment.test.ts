import { describe, expect, it } from "vitest";
import type { AgentModelId } from "./agent-context-receipt.js";
import { instructionContentHash } from "./agent-domain.js";
import { captureContentHash } from "./capture-documents.js";
import {
  agentProposalId,
  agentRunId,
  captureId,
  projectId,
  storyKnowledgeId
} from "./domain.js";
import { accountId } from "./identity.js";
import {
  STORY_WORK_MAX_SOURCES,
  STORY_WORK_MAX_STEPS,
  StoryWorkAssignmentTransitionError,
  attachGeneratedStoryWorkArtifact,
  createStoryWorkAssignment,
  finishStoryWorkAttemptWithoutArtifact,
  openStoryWorkArtifactReview,
  recordAppliedStoryWorkAssignmentFromUnitOfWork,
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
