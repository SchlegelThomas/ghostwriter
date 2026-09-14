import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AgentModelId } from "./agent-context-receipt.js";
import {
  instructionContentHash,
  type AsyncHashPort,
  type InstructionContentHash
} from "./agent-domain.js";
import { sceneContentHash } from "./scene-documents.js";
import { agentProposalId, agentRunId, projectId, sceneId } from "./domain.js";
import { accountId } from "./identity.js";
import { mcpGrantId } from "./mcp-grants.js";
import {
  attachGeneratedStoryWorkArtifact,
  createStoryWorkAssignment,
  openStoryWorkArtifactReview,
  startStoryWorkAttempt,
  storyWorkAssignmentId,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment
} from "./story-work-assignment.js";
import {
  bindProposalContinuityCheckStep,
  cancelStoryWorkCoordination,
  createStoryWorkCoordination,
  projectStoryWorkCoordination,
  storyWorkCoordinationId,
  storyWorkCoordinationSemanticFingerprint,
  storyWorkCoordinationStepId,
  validateStoryWorkCoordinationChildAssignments,
  validateStoryWorkCoordinationStepGraph,
  type StoryWorkCoordination,
  type StoryWorkCoordinationChildAssignmentMap
} from "./story-work-coordination.js";

const OWNER = accountId("account-coordination-owner");
const PROJECT = projectId("project-coordination");
const SCENE_TARGET = sceneId("scene-coordination-target");
const CONTEXT_SCENE = sceneId("scene-coordination-context");
const SCENE_STEP = storyWorkCoordinationStepId("coord-step-scene-draft");
const CHECK_STEP = storyWorkCoordinationStepId("coord-step-continuity-check");
const SCENE_ASSIGNMENT = storyWorkAssignmentId("assignment-coordination-scene");
const CHECK_ASSIGNMENT = storyWorkAssignmentId("assignment-coordination-check");
const RUN = agentRunId("run-coordination-scene");

const hashPort: AsyncHashPort = {
  async digestSha256Hex(value) {
    return createHash("sha256").update(value).digest("hex");
  }
};

const SCENE_DRAFT_REQUEST_FINGERPRINT = instructionContentHash("a".repeat(64));
const ALT_SCENE_DRAFT_REQUEST_FINGERPRINT = instructionContentHash("b".repeat(64));

function semanticSteps(
  sceneDraftRequestFingerprint: InstructionContentHash = SCENE_DRAFT_REQUEST_FINGERPRINT
) {
  return [
    {
      kind: "scene-draft" as const,
      title: "Draft scene",
      sceneDraftRequestFingerprint
    },
    {
      kind: "proposal-continuity-check" as const,
      title: "Continuity check",
      dependencySceneDraftTitle: "Draft scene",
      deferred: {
        brief: "Check continuity for the draft scene.",
        constraints: "Use only supplied context.",
        doneWhen: "Findings are ready for writer review.",
        model: "gpt-4.1" as AgentModelId,
        surroundingSceneIds: [CONTEXT_SCENE]
      }
    }
  ];
}

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

function sceneAssignment(
  overrides: Partial<StoryWorkAssignment> = {}
): StoryWorkAssignment {
  return createStoryWorkAssignment({
    id: SCENE_ASSIGNMENT,
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "scene",
    brief: "Draft the harbor scene.",
    constraints: "Keep the tone grounded.",
    doneWhen: "A scene draft is ready for review.",
    sources: [{ kind: "project", projectId: PROJECT, projectVersion: 3 }],
    destination: {
      kind: "scene",
      sceneId: SCENE_TARGET,
      operation: "create"
    },
    provider: "openai",
    model: "gpt-4.1" as AgentModelId,
    status: "brief-ready",
    steps: [{ id: "draft", title: "Draft scene", dependencies: [] }],
    results: [],
    idempotencyKey: "submit-scene-coordination",
    createdAt: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T12:00:00.000Z",
    ...overrides
  });
}

function sceneArtifactReady(): StoryWorkAssignment {
  const running = startStoryWorkAttempt({
    assignment: sceneAssignment(),
    expectedVersion: 1,
    runId: RUN,
    updatedAt: "2026-09-13T12:01:00.000Z"
  });
  return attachGeneratedStoryWorkArtifact({
    assignment: running,
    expectedVersion: 2,
    runId: RUN,
    artifact: artifact("proposal-scene-coordination", 1, "a"),
    updatedAt: "2026-09-13T12:02:00.000Z"
  });
}

function checkAssignment(
  pointer: StoryWorkArtifactPointer,
  overrides: Partial<StoryWorkAssignment> = {}
): StoryWorkAssignment {
  return createStoryWorkAssignment({
    id: CHECK_ASSIGNMENT,
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "check",
    brief: "Check continuity for the draft scene.",
    constraints: "Use only supplied context.",
    doneWhen: "Findings are ready for writer review.",
    sources: [
      {
        kind: "proposal-artifact",
        assignmentId: SCENE_ASSIGNMENT,
        proposalId: pointer.proposalId,
        sceneId: SCENE_TARGET,
        artifactVersion: pointer.artifactVersion,
        contentHash: pointer.contentHash
      },
      {
        kind: "scene",
        sceneId: CONTEXT_SCENE,
        projectVersion: 3,
        workingVersion: 2,
        contentHash: sceneContentHash("c".repeat(64))
      }
    ],
    destination: {
      kind: "scene",
      sceneId: SCENE_TARGET,
      operation: "assess"
    },
    provider: "openai",
    model: "gpt-4.1" as AgentModelId,
    status: "brief-ready",
    steps: [{ id: "check", title: "Run continuity check", dependencies: [] }],
    results: [],
    idempotencyKey: "submit-check-coordination",
    createdAt: "2026-09-13T12:10:00.000Z",
    updatedAt: "2026-09-13T12:10:00.000Z",
    ...overrides
  });
}

function coordination(
  overrides: Partial<StoryWorkCoordination> = {}
): StoryWorkCoordination {
  return createStoryWorkCoordination({
    id: storyWorkCoordinationId("coordination-scene-check"),
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 1,
    title: "Scene draft then continuity check",
    status: "active",
    steps: [
      {
        kind: "scene-draft",
        stepId: SCENE_STEP,
        title: "Draft scene",
        assignmentId: SCENE_ASSIGNMENT
      },
      {
        kind: "proposal-continuity-check",
        stepId: CHECK_STEP,
        title: "Continuity check",
        dependencies: [{ stepId: SCENE_STEP, requiredState: "artifact-ready" }],
        deferred: {
          brief: "Check continuity for the draft scene.",
          constraints: "Use only supplied context.",
          doneWhen: "Findings are ready for writer review.",
          model: "gpt-4.1" as AgentModelId,
          surroundingSceneIds: [CONTEXT_SCENE]
        }
      }
    ],
    idempotencyKey: "coordination-create-1",
    createdAt: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T12:00:00.000Z",
    ...overrides
  });
}

function childMap(
  ...assignments: readonly StoryWorkAssignment[]
): StoryWorkCoordinationChildAssignmentMap {
  return new Map(assignments.map((assignment) => [assignment.id, assignment]));
}

describe("story work coordination domain", () => {
  it("rejects out-of-bounds titles, step counts, cyclic graphs, and invalid dependencies", () => {
    expect(() => coordination({ title: " \n" })).toThrow(/title/i);
    expect(() =>
      coordination({
        steps: [
          {
            kind: "scene-draft",
            stepId: SCENE_STEP,
            title: "Draft scene",
            assignmentId: SCENE_ASSIGNMENT
          }
        ]
      })
    ).toThrow(/at least two steps/i);

    expect(() =>
      validateStoryWorkCoordinationStepGraph([
        {
          kind: "scene-draft",
          stepId: storyWorkCoordinationStepId("step-a"),
          title: "A",
          assignmentId: SCENE_ASSIGNMENT
        },
        {
          kind: "proposal-continuity-check",
          stepId: storyWorkCoordinationStepId("step-b"),
          title: "B",
          dependencies: [
            { stepId: storyWorkCoordinationStepId("step-b"), requiredState: "artifact-ready" }
          ],
          deferred: {
            brief: "Brief",
            constraints: "Constraints",
            doneWhen: "Done",
            model: "gpt-4.1" as AgentModelId
          }
        }
      ])
    ).toThrow(/themselves/i);

    expect(() =>
      coordination({
        steps: [
          {
            kind: "scene-draft",
            stepId: SCENE_STEP,
            title: "Draft scene",
            assignmentId: SCENE_ASSIGNMENT
          },
          {
            kind: "proposal-continuity-check",
            stepId: CHECK_STEP,
            title: "Continuity check",
            dependencies: [
              { stepId: storyWorkCoordinationStepId("missing-step"), requiredState: "artifact-ready" }
            ],
            deferred: {
              brief: "Brief",
              constraints: "Constraints",
              doneWhen: "Done",
              model: "gpt-4.1" as AgentModelId
            }
          }
        ]
      })
    ).toThrow(/unknown step/i);
  });

  it("enforces v1 shape: one scene-draft root, one to seven checks on that root", () => {
    expect(() =>
      validateStoryWorkCoordinationStepGraph([
        {
          kind: "scene-draft",
          stepId: SCENE_STEP,
          title: "Draft A",
          assignmentId: SCENE_ASSIGNMENT
        },
        {
          kind: "scene-draft",
          stepId: storyWorkCoordinationStepId("coord-step-scene-draft-b"),
          title: "Draft B",
          assignmentId: storyWorkAssignmentId("assignment-coordination-scene-b")
        },
        {
          kind: "proposal-continuity-check",
          stepId: CHECK_STEP,
          title: "Continuity check",
          dependencies: [{ stepId: SCENE_STEP, requiredState: "artifact-ready" }],
          deferred: {
            brief: "Brief",
            constraints: "Constraints",
            doneWhen: "Done",
            model: "gpt-4.1" as AgentModelId
          }
        }
      ])
    ).toThrow(/exactly one scene-draft root/i);

    expect(() =>
      validateStoryWorkCoordinationStepGraph([
        {
          kind: "scene-draft",
          stepId: SCENE_STEP,
          title: "Draft scene",
          assignmentId: SCENE_ASSIGNMENT
        }
      ])
    ).toThrow(/at least two steps/i);

    const otherCheckStep = storyWorkCoordinationStepId("coord-step-continuity-check-b");
    expect(() =>
      validateStoryWorkCoordinationStepGraph([
        {
          kind: "scene-draft",
          stepId: SCENE_STEP,
          title: "Draft scene",
          assignmentId: SCENE_ASSIGNMENT
        },
        {
          kind: "proposal-continuity-check",
          stepId: CHECK_STEP,
          title: "Continuity check A",
          dependencies: [{ stepId: SCENE_STEP, requiredState: "artifact-ready" }],
          deferred: {
            brief: "Brief A",
            constraints: "Constraints",
            doneWhen: "Done",
            model: "gpt-4.1" as AgentModelId
          }
        },
        {
          kind: "proposal-continuity-check",
          stepId: otherCheckStep,
          title: "Continuity check B",
          dependencies: [{ stepId: CHECK_STEP, requiredState: "artifact-ready" }],
          deferred: {
            brief: "Brief B",
            constraints: "Constraints",
            doneWhen: "Done",
            model: "gpt-4.1" as AgentModelId
          }
        }
      ])
    ).toThrow(/scene-draft root step/i);

    expect(() =>
      createStoryWorkCoordination({
        ...coordination(),
        steps: [
          {
            kind: "scene-draft",
            stepId: SCENE_STEP,
            title: "Draft scene",
            assignmentId: SCENE_ASSIGNMENT
          },
          {
            kind: "proposal-continuity-check",
            stepId: CHECK_STEP,
            title: "Continuity check A",
            dependencies: [{ stepId: SCENE_STEP, requiredState: "artifact-ready" }],
            deferred: {
              brief: "Brief A",
              constraints: "Constraints",
              doneWhen: "Done",
              model: "gpt-4.1" as AgentModelId
            }
          },
          {
            kind: "proposal-continuity-check",
            stepId: storyWorkCoordinationStepId("coord-step-continuity-check-b"),
            title: "Continuity check B",
            dependencies: [{ stepId: SCENE_STEP, requiredState: "artifact-ready" }],
            deferred: {
              brief: "Brief B",
              constraints: "Constraints",
              doneWhen: "Done",
              model: "gpt-4.1" as AgentModelId
            }
          }
        ]
      })
    ).not.toThrow();
  });

  it("validates scene-draft and bound check child assignment parity", () => {
    const aggregate = coordination();
    expect(() =>
      validateStoryWorkCoordinationChildAssignments({
        coordination: aggregate,
        childAssignments: childMap(sceneAssignment())
      })
    ).not.toThrow();

    expect(() =>
      validateStoryWorkCoordinationChildAssignments({
        coordination: aggregate,
        childAssignments: childMap(
          sceneAssignment({
            taskKind: "character",
            destination: {
              kind: "story-knowledge",
              storyKnowledgeId: "knowledge-x" as never,
              operation: "create"
            }
          })
        )
      })
    ).toThrow(/scene assignment/i);

    const pointer = artifact("proposal-scene-coordination", 1, "a");
    const bound = coordination({
      steps: [
        {
          kind: "scene-draft",
          stepId: SCENE_STEP,
          title: "Draft scene",
          assignmentId: SCENE_ASSIGNMENT
        },
        {
          kind: "proposal-continuity-check",
          stepId: CHECK_STEP,
          title: "Continuity check",
          dependencies: [{ stepId: SCENE_STEP, requiredState: "artifact-ready" }],
          deferred: {
            brief: "Check continuity for the draft scene.",
            constraints: "Use only supplied context.",
            doneWhen: "Findings are ready for writer review.",
            model: "gpt-4.1" as AgentModelId
          },
          binding: {
            assignmentId: CHECK_ASSIGNMENT,
            resolvedDependency: {
              stepId: SCENE_STEP,
              artifact: pointer
            },
            boundAt: "2026-09-13T12:05:00.000Z"
          }
        }
      ]
    });
    expect(() =>
      validateStoryWorkCoordinationChildAssignments({
        coordination: bound,
        childAssignments: childMap(sceneAssignment(), checkAssignment(pointer))
      })
    ).not.toThrow();

    expect(() =>
      validateStoryWorkCoordinationChildAssignments({
        coordination: bound,
        childAssignments: childMap(
          sceneAssignment(),
          checkAssignment(pointer, {
            sources: [
              {
                kind: "proposal-artifact",
                assignmentId: SCENE_ASSIGNMENT,
                proposalId: pointer.proposalId,
                sceneId: SCENE_TARGET,
                artifactVersion: 9,
                contentHash: pointer.contentHash
              }
            ]
          })
        )
      })
    ).toThrow(/resolved upstream artifact pointer/i);
  });

  it("projects blocked, ready, bound, stale, rejected, and applied upstream refusal", () => {
    const aggregate = coordination();
    const blocked = projectStoryWorkCoordination({
      coordination: aggregate,
      childAssignments: childMap(sceneAssignment())
    });
    expect(blocked.steps[0]?.state).toBe("ready");
    expect(blocked.steps[1]).toMatchObject({
      state: "blocked",
      reasons: ["upstream-not-ready"]
    });
    expect(blocked.overallStatus).toBe("active");

    const readyPointer = artifact("proposal-scene-coordination", 1, "a");
    const ready = projectStoryWorkCoordination({
      coordination: aggregate,
      childAssignments: childMap(sceneArtifactReady())
    });
    expect(ready.steps[0]).toMatchObject({
      state: "draft-ready",
      assignmentId: SCENE_ASSIGNMENT
    });
    expect(ready.steps[1]).toMatchObject({
      state: "ready",
      resolvedDependency: {
        stepId: SCENE_STEP,
        artifact: readyPointer
      }
    });
    expect(ready.overallStatus).toBe("paused-awaiting-human");

    const awaitingReview = openStoryWorkArtifactReview({
      assignment: sceneArtifactReady(),
      expectedVersion: 3,
      artifact: readyPointer,
      updatedAt: "2026-09-13T12:03:00.000Z"
    });
    const stillReady = projectStoryWorkCoordination({
      coordination: aggregate,
      childAssignments: childMap(awaitingReview)
    });
    expect(stillReady.steps[0]?.state).toBe("awaiting-review");
    expect(stillReady.steps[1]?.state).toBe("ready");
    expect(stillReady.overallStatus).toBe("paused-awaiting-human");

    const openedReviewOnly = projectStoryWorkCoordination({
      coordination: aggregate,
      childAssignments: childMap(awaitingReview)
    });
    expect(openedReviewOnly.steps[0]?.state).toBe("awaiting-review");

    const pointer = artifact("proposal-scene-coordination", 1, "a");
    const rejected = projectStoryWorkCoordination({
      coordination: aggregate,
      childAssignments: childMap(
        sceneAssignment({
          status: "rejected",
          currentArtifact: pointer,
          generatedArtifact: pointer
        })
      )
    });
    expect(rejected.steps[1]).toMatchObject({
      state: "blocked",
      reasons: ["upstream-terminal"]
    });

    const applied = projectStoryWorkCoordination({
      coordination: aggregate,
      childAssignments: childMap(
        sceneAssignment({
          status: "applied",
          currentArtifact: pointer,
          generatedArtifact: pointer,
          results: [
            {
              kind: "scene",
              sceneId: SCENE_TARGET,
              workingVersion: 1
            }
          ],
          applyIdempotencyKey: "apply-scene-coordination",
          applyRequestFingerprint: instructionContentHash("d".repeat(64))
        })
      )
    });
    expect(applied.steps[1]).toMatchObject({
      state: "blocked",
      reasons: ["upstream-artifact-expired"]
    });

    const boundAggregate = bindProposalContinuityCheckStep({
      coordination: aggregate,
      expectedVersion: 1,
      stepId: CHECK_STEP,
      binding: {
        assignmentId: CHECK_ASSIGNMENT,
        resolvedDependency: { stepId: SCENE_STEP, artifact: readyPointer },
        boundAt: "2026-09-13T12:05:00.000Z"
      },
      childAssignments: childMap(sceneArtifactReady(), checkAssignment(readyPointer)),
      updatedAt: "2026-09-13T12:05:00.000Z"
    });
    const boundProjection = projectStoryWorkCoordination({
      coordination: boundAggregate,
      childAssignments: childMap(sceneArtifactReady(), checkAssignment(readyPointer))
    });
    expect(boundProjection.steps[0]?.state).toBe("draft-ready");
    expect(boundProjection.steps[1]).toMatchObject({
      state: "ready",
      assignmentId: CHECK_ASSIGNMENT
    });
    expect(boundProjection.overallStatus).toBe("paused-awaiting-human");
  });

  it("prioritizes human review pause over executable check readiness", () => {
    const aggregate = coordination();
    const readyPointer = artifact("proposal-scene-coordination", 1, "a");
    const sceneReady = sceneArtifactReady();
    const bound = bindProposalContinuityCheckStep({
      coordination: aggregate,
      expectedVersion: 1,
      stepId: CHECK_STEP,
      binding: {
        assignmentId: CHECK_ASSIGNMENT,
        resolvedDependency: { stepId: SCENE_STEP, artifact: readyPointer },
        boundAt: "2026-09-13T12:05:00.000Z"
      },
      childAssignments: childMap(sceneReady, checkAssignment(readyPointer)),
      updatedAt: "2026-09-13T12:05:00.000Z"
    });

    const checkReviewed = createStoryWorkAssignment({
      ...checkAssignment(readyPointer),
      status: "reviewed",
      currentArtifact: artifact("proposal-check-reviewed", 1, "e"),
      generatedArtifact: artifact("proposal-check-reviewed", 1, "e"),
      results: [
        {
          kind: "story-check",
          proposalId: agentProposalId("proposal-check-reviewed"),
          artifactVersion: 1,
          contentHash: instructionContentHash("e".repeat(64)),
          sceneId: SCENE_TARGET
        }
      ]
    });
    const rootStillReviewing = projectStoryWorkCoordination({
      coordination: bound,
      childAssignments: childMap(sceneReady, checkReviewed)
    });
    expect(rootStillReviewing.steps[0]?.state).toBe("draft-ready");
    expect(rootStillReviewing.steps[1]?.state).toBe("completed");
    expect(rootStillReviewing.overallStatus).toBe("paused-awaiting-human");

    const checkArtifactReady = attachGeneratedStoryWorkArtifact({
      assignment: startStoryWorkAttempt({
        assignment: checkAssignment(readyPointer),
        expectedVersion: 1,
        runId: agentRunId("run-coordination-check"),
        updatedAt: "2026-09-13T12:11:00.000Z"
      }),
      expectedVersion: 2,
      runId: agentRunId("run-coordination-check"),
      artifact: artifact("proposal-check-artifact-ready", 1, "a"),
      updatedAt: "2026-09-13T12:12:00.000Z"
    });
    const boundCheckAwaitingReview = projectStoryWorkCoordination({
      coordination: bound,
      childAssignments: childMap(sceneReady, checkArtifactReady)
    });
    expect(boundCheckAwaitingReview.steps[1]?.state).toBe("draft-ready");
    expect(boundCheckAwaitingReview.overallStatus).toBe("paused-awaiting-human");

    const checkInReview = openStoryWorkArtifactReview({
      assignment: checkArtifactReady,
      expectedVersion: 3,
      artifact: checkArtifactReady.currentArtifact!,
      updatedAt: "2026-09-13T12:13:00.000Z"
    });
    const boundCheckOpenedReview = projectStoryWorkCoordination({
      coordination: bound,
      childAssignments: childMap(sceneReady, checkInReview)
    });
    expect(boundCheckOpenedReview.steps[1]?.state).toBe("awaiting-review");

    const sceneApplied = createStoryWorkAssignment({
      ...sceneReady,
      status: "applied",
      results: [
        {
          kind: "scene",
          sceneId: SCENE_TARGET,
          workingVersion: 1
        }
      ],
      applyIdempotencyKey: "apply-scene-coordination-reviewed",
      applyRequestFingerprint: instructionContentHash("a".repeat(64))
    });
    const allCompleted = projectStoryWorkCoordination({
      coordination: bound,
      childAssignments: childMap(sceneApplied, checkReviewed)
    });
    expect(allCompleted.steps[0]?.state).toBe("completed");
    expect(allCompleted.steps[1]?.state).toBe("completed");
    expect(allCompleted.overallStatus).toBe("completed");
  });

  it("binds only from an exact ready projection and cancels active coordinations", () => {
    const aggregate = coordination();
    const pointer = artifact("proposal-scene-coordination", 1, "a");
    expect(() =>
      bindProposalContinuityCheckStep({
        coordination: aggregate,
        expectedVersion: 1,
        stepId: CHECK_STEP,
        binding: {
          assignmentId: CHECK_ASSIGNMENT,
          resolvedDependency: { stepId: SCENE_STEP, artifact: pointer },
          boundAt: "2026-09-13T12:05:00.000Z"
        },
        childAssignments: childMap(sceneAssignment(), checkAssignment(pointer)),
        updatedAt: "2026-09-13T12:05:00.000Z"
      })
    ).toThrow(/ready step projection/i);

    const bound = bindProposalContinuityCheckStep({
      coordination: aggregate,
      expectedVersion: 1,
      stepId: CHECK_STEP,
      binding: {
        assignmentId: CHECK_ASSIGNMENT,
        resolvedDependency: { stepId: SCENE_STEP, artifact: pointer },
        boundAt: "2026-09-13T12:05:00.000Z"
      },
      childAssignments: childMap(sceneArtifactReady(), checkAssignment(pointer)),
      updatedAt: "2026-09-13T12:05:00.000Z"
    });
    expect(bound.version).toBe(2);
    expect(() =>
      bindProposalContinuityCheckStep({
        coordination: bound,
        expectedVersion: 2,
        stepId: CHECK_STEP,
        binding: {
          assignmentId: CHECK_ASSIGNMENT,
          resolvedDependency: { stepId: SCENE_STEP, artifact: pointer },
          boundAt: "2026-09-13T12:06:00.000Z"
        },
        childAssignments: childMap(sceneArtifactReady(), checkAssignment(pointer)),
        updatedAt: "2026-09-13T12:06:00.000Z"
      })
    ).toThrow(/cannot be replaced/i);

    const canceled = cancelStoryWorkCoordination({
      coordination: aggregate,
      expectedVersion: 1,
      updatedAt: "2026-09-13T12:07:00.000Z"
    });
    expect(canceled.status).toBe("canceled");
    const canceledProjection = projectStoryWorkCoordination({
      coordination: canceled,
      childAssignments: childMap(sceneAssignment())
    });
    expect(canceledProjection.overallStatus).toBe("canceled");
    expect(canceledProjection.steps.every((step) => step.state === "canceled")).toBe(true);

    const replay = cancelStoryWorkCoordination({
      coordination: canceled,
      expectedVersion: 2,
      updatedAt: "2026-09-13T12:08:00.000Z"
    });
    expect(replay.status).toBe("canceled");
  });

  it("requires MCP-origin child assignments to match coordination origin", () => {
    const grant = mcpGrantId("grant-coordination-child-origin");
    const mcpCoordination = createStoryWorkCoordination({
      ...coordination(),
      origin: { kind: "mcp", grantId: grant }
    });
    expect(() =>
      validateStoryWorkCoordinationChildAssignments({
        coordination: mcpCoordination,
        childAssignments: childMap(
          createStoryWorkAssignment({
            ...sceneAssignment(),
            origin: { kind: "mcp", grantId: mcpGrantId("grant-other") }
          })
        )
      })
    ).toThrow(/matching child assignment origin/i);

    expect(() =>
      validateStoryWorkCoordinationChildAssignments({
        coordination: coordination(),
        childAssignments: childMap(
          createStoryWorkAssignment({
            ...sceneAssignment(),
            origin: { kind: "mcp", grantId: grant }
          })
        )
      })
    ).toThrow(/cannot include MCP-origin child/i);
  });

  it("keeps the coordination module free of Node built-in imports", () => {
    const sourcePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "story-work-coordination.ts"
    );
    const source = readFileSync(sourcePath, "utf8");
    expect(source).not.toMatch(/from\s+["']node:/);
  });

  it("computes semantic fingerprints from child request digests, not server ids", async () => {
    const sharedInput = {
      title: " Scene draft then continuity check ",
      steps: semanticSteps()
    };
    const left = await storyWorkCoordinationSemanticFingerprint(sharedInput, hashPort);
    const right = await storyWorkCoordinationSemanticFingerprint(
      {
        title: "Scene draft then continuity check",
        steps: semanticSteps()
      },
      hashPort
    );
    expect(left).toBe(right);

    const differentChildRequest = await storyWorkCoordinationSemanticFingerprint(
      {
        title: "Scene draft then continuity check",
        steps: semanticSteps(ALT_SCENE_DRAFT_REQUEST_FINGERPRINT)
      },
      hashPort
    );
    expect(differentChildRequest).not.toBe(left);
  });
});
