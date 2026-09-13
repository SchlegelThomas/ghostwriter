import { describe, expect, it } from "vitest";
import type { AgentModelId } from "@ghostwriter/core";
import {
  agentProposalId,
  agentRunId,
  attachGeneratedStoryWorkArtifact,
  createStoryWorkAssignment,
  instructionContentHash,
  openStoryWorkArtifactReview,
  projectId,
  projectStoryWorkCoordination,
  sceneContentHash,
  sceneId,
  startStoryWorkAttempt,
  storyWorkAssignmentId,
  storyWorkCoordinationId,
  storyWorkCoordinationStepId,
  type ProjectNavigator,
  type StoryWorkAssignment,
  type StoryWorkCoordination,
  type StoryWorkCoordinationStepDefinition,
  type StoryWorkCoordinationStepProjection
} from "@ghostwriter/core";
import { GhostwriterApiError } from "./api.js";
import type { StoryWorkCoordinationDetailResponse } from "./api.js";
import {
  buildStoryWorkCoordinationCheckAttemptInput,
  buildStoryWorkCoordinationContinueCheckRequest,
  buildStoryWorkCoordinationCreateInput,
  buildStoryWorkCoordinationRootAttemptInput,
  deriveStoryWorkCoordinationCardStatus,
  deriveStoryWorkCoordinationReloadAutoAction,
  deriveStoryWorkCoordinationStepAction,
  presentStoryWorkCoordinationCard,
  releaseStoryWorkCoordinationContinue,
  reloadStoryWorkCoordinationWorkspaceDetail,
  storyWorkCoordinationContinueSemanticFingerprint,
  storyWorkCoordinationTransitionConflictRequiresDetailRefresh,
  tryAcquireStoryWorkCoordinationContinue
} from "./story-work-coordination-workspace.js";

const PROJECT = projectId("project-coordination-client");
const CONTEXT_SCENE = sceneId("scene-context");
const OTHER_SCENE = sceneId("scene-other");
const TARGET_SCENE = sceneId("scene-reserved");
const SCENE_STEP = storyWorkCoordinationStepId("coord-step-scene");
const CHECK_STEP = storyWorkCoordinationStepId("coord-step-check");
const SCENE_ASSIGNMENT = storyWorkAssignmentId("assignment-scene");
const CHECK_ASSIGNMENT = storyWorkAssignmentId("assignment-check");
const COORDINATION_ID = storyWorkCoordinationId("coordination-1");
const MODEL = "gpt-4.1" as AgentModelId;

const form = Object.freeze({
  coordinationTitle: "Harbor draft with continuity check",
  sceneTitle: "Draft harbor scene",
  sceneBrief: " Draft a coordinated harbor scene. ",
  sceneConstraints: "Keep canon intact.",
  sceneDoneWhen: "A scene draft is ready for review.",
  checkTitle: "Continuity check",
  checkBrief: " Check the draft against surrounding canon. ",
  checkConstraints: "Ground findings in supplied scenes.",
  checkDoneWhen: "Findings are ready for writer review."
});

const project = Object.freeze({
  id: PROJECT,
  version: 3
}) as ProjectNavigator;

const availableScenes = new Set([CONTEXT_SCENE, OTHER_SCENE]);

function artifact(version: number): StoryWorkAssignment["currentArtifact"] {
  return {
    proposalId: agentProposalId("proposal-coordination"),
    artifactVersion: version,
    contentHash: instructionContentHash("a".repeat(64))
  };
}

function rootAssignment(
  overrides: Partial<StoryWorkAssignment> = {}
): StoryWorkAssignment {
  return createStoryWorkAssignment({
    id: SCENE_ASSIGNMENT,
    projectId: PROJECT,
    initiatorAccountId: "account-owner" as StoryWorkAssignment["initiatorAccountId"],
    version: 1,
    taskKind: "scene",
    brief: form.sceneBrief.trim(),
    constraints: form.sceneConstraints,
    doneWhen: form.sceneDoneWhen,
    sources: [{ kind: "project", projectId: PROJECT, projectVersion: 3 }],
    destination: {
      kind: "scene",
      sceneId: TARGET_SCENE,
      operation: "create"
    },
    provider: "openai",
    model: MODEL,
    status: "brief-ready",
    steps: [{ id: "draft", title: "Draft scene", dependencies: [] }],
    results: [],
    idempotencyKey: "sw-coord:create-1:root-scene",
    createdAt: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T12:00:00.000Z",
    ...overrides
  });
}

function checkAssignment(
  overrides: Partial<StoryWorkAssignment> = {}
): StoryWorkAssignment {
  const pointer = artifact(1)!;
  return createStoryWorkAssignment({
    id: CHECK_ASSIGNMENT,
    projectId: PROJECT,
    initiatorAccountId: "account-owner" as StoryWorkAssignment["initiatorAccountId"],
    version: 1,
    taskKind: "check",
    brief: form.checkBrief.trim(),
    constraints: form.checkConstraints,
    doneWhen: form.checkDoneWhen,
    sources: [
      {
        kind: "proposal-artifact",
        assignmentId: SCENE_ASSIGNMENT,
        proposalId: pointer.proposalId,
        sceneId: TARGET_SCENE,
        artifactVersion: pointer.artifactVersion,
        contentHash: pointer.contentHash
      },
      {
        kind: "scene",
        sceneId: OTHER_SCENE,
        projectVersion: 3,
        workingVersion: 2,
        contentHash: sceneContentHash("c".repeat(64))
      }
    ],
    destination: {
      kind: "scene",
      sceneId: TARGET_SCENE,
      operation: "assess"
    },
    provider: "openai",
    model: MODEL,
    status: "brief-ready",
    steps: [{ id: "check", title: "Continuity check", dependencies: [] }],
    results: [],
    idempotencyKey: "sw-coord:coordination-1:step:coord-step-check:continuity-check",
    createdAt: "2026-09-13T12:05:00.000Z",
    updatedAt: "2026-09-13T12:05:00.000Z",
    ...overrides
  });
}

function coordinationSteps(
  checkBinding?: StoryWorkCoordinationStepDefinition
): readonly StoryWorkCoordinationStepDefinition[] {
  return Object.freeze([
    Object.freeze({
      kind: "scene-draft" as const,
      stepId: SCENE_STEP,
      title: form.sceneTitle,
      assignmentId: SCENE_ASSIGNMENT
    }),
    checkBinding ??
      Object.freeze({
        kind: "proposal-continuity-check" as const,
        stepId: CHECK_STEP,
        title: form.checkTitle,
        dependencies: Object.freeze([
          Object.freeze({ stepId: SCENE_STEP, requiredState: "artifact-ready" as const })
        ] as const),
        deferred: Object.freeze({
          brief: form.checkBrief.trim(),
          constraints: form.checkConstraints,
          doneWhen: form.checkDoneWhen,
          model: MODEL,
          surroundingSceneIds: Object.freeze([OTHER_SCENE])
        })
      })
  ]);
}

function boundCheckStep(): StoryWorkCoordinationStepDefinition {
  return Object.freeze({
    kind: "proposal-continuity-check" as const,
    stepId: CHECK_STEP,
    title: form.checkTitle,
    dependencies: Object.freeze([
      Object.freeze({ stepId: SCENE_STEP, requiredState: "artifact-ready" as const })
    ] as const),
    deferred: Object.freeze({
      brief: form.checkBrief.trim(),
      constraints: form.checkConstraints,
      doneWhen: form.checkDoneWhen,
      model: MODEL,
      surroundingSceneIds: Object.freeze([OTHER_SCENE])
    }),
    binding: Object.freeze({
      assignmentId: CHECK_ASSIGNMENT,
      resolvedDependency: Object.freeze({
        stepId: SCENE_STEP,
        artifact: artifact(1)!
      }),
      boundAt: "2026-09-13T12:04:00.000Z"
    })
  });
}

function coordination(
  overrides: Partial<StoryWorkCoordination> = {}
): StoryWorkCoordination {
  return Object.freeze({
    id: COORDINATION_ID,
    projectId: PROJECT,
    initiatorAccountId: "account-owner" as StoryWorkCoordination["initiatorAccountId"],
    version: 1,
    title: form.coordinationTitle,
    status: "active",
    steps: coordinationSteps(),
    idempotencyKey: "coordination-create-1",
    createdAt: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T12:00:00.000Z",
    ...overrides
  });
}

function detailFromAssignments(
  assignments: readonly StoryWorkAssignment[],
  coordinationOverrides?: Partial<StoryWorkCoordination>
): StoryWorkCoordinationDetailResponse {
  const coord = coordination(coordinationOverrides);
  const childMap = new Map(assignments.map((entry) => [entry.id, entry]));
  const projection = projectStoryWorkCoordination({
    coordination: coord,
    childAssignments: childMap
  });
  const root = assignments.find((entry) => entry.id === SCENE_ASSIGNMENT) ?? rootAssignment();
  return Object.freeze({
    coordination: coord,
    projection,
    rootAssignment: root,
    childAssignmentSummaries: Object.freeze(
      coord.steps.flatMap((step) => {
        const assignmentId =
          step.kind === "scene-draft" ? step.assignmentId : step.binding?.assignmentId;
        if (assignmentId === undefined) return [];
        const assignment = childMap.get(assignmentId);
        if (assignment === undefined) return [];
        return [
          Object.freeze({
            stepId: step.stepId,
            assignmentId,
            taskKind: assignment.taskKind,
            status: assignment.status
          })
        ];
      })
    )
  });
}

function stepProjection(
  detail: StoryWorkCoordinationDetailResponse,
  stepId: StoryWorkCoordinationStepProjection["stepId"]
): StoryWorkCoordinationStepProjection {
  const step = detail.projection.steps.find((entry) => entry.stepId === stepId);
  if (step === undefined) throw new Error("missing step projection");
  return step;
}

describe("story work coordination workspace", () => {
  it("builds strict create input for one scene and one check", () => {
    const built = buildStoryWorkCoordinationCreateInput({
      project,
      model: MODEL,
      sceneIds: [CONTEXT_SCENE],
      surroundingSceneIds: [OTHER_SCENE],
      form,
      idempotencyKey: "coordination-create-1",
      availableSceneIds: availableScenes
    });
    expect(built).toEqual({
      projectId: PROJECT,
      expectedProjectVersion: 3,
      idempotencyKey: "coordination-create-1",
      title: form.coordinationTitle,
      scene: {
        title: form.sceneTitle,
        brief: form.sceneBrief,
        constraints: form.sceneConstraints,
        doneWhen: form.sceneDoneWhen,
        model: MODEL,
        sceneIds: [CONTEXT_SCENE]
      },
      check: {
        title: form.checkTitle,
        brief: form.checkBrief,
        constraints: form.checkConstraints,
        doneWhen: form.checkDoneWhen,
        model: MODEL,
        surroundingSceneIds: [OTHER_SCENE]
      }
    });
    expect(built).not.toHaveProperty("provider");
    expect(built.scene).not.toHaveProperty("taskKind");
  });

  it("allows zero scene sources and mirrors them into check context by default", () => {
    const built = buildStoryWorkCoordinationCreateInput({
      project,
      model: MODEL,
      sceneIds: [],
      form,
      idempotencyKey: "coordination-zero-sources",
      availableSceneIds: availableScenes
    });
    expect(built.scene.sceneIds).toEqual([]);
    expect(built.check.surroundingSceneIds).toEqual([]);
  });

  it("defaults check surrounding context to the same ordered scene sources", () => {
    const built = buildStoryWorkCoordinationCreateInput({
      project,
      model: MODEL,
      sceneIds: [CONTEXT_SCENE, OTHER_SCENE],
      form,
      idempotencyKey: "coordination-shared-sources",
      availableSceneIds: availableScenes
    });
    expect(built.scene.sceneIds).toEqual([CONTEXT_SCENE, OTHER_SCENE]);
    expect(built.check.surroundingSceneIds).toEqual([CONTEXT_SCENE, OTHER_SCENE]);
  });

  it("allows the same scene IDs in root sources and explicit surrounding context", () => {
    const built = buildStoryWorkCoordinationCreateInput({
      project,
      model: MODEL,
      sceneIds: [CONTEXT_SCENE],
      surroundingSceneIds: [CONTEXT_SCENE, OTHER_SCENE],
      form,
      idempotencyKey: "coordination-overlap",
      availableSceneIds: availableScenes
    });
    expect(built.scene.sceneIds).toEqual([CONTEXT_SCENE]);
    expect(built.check.surroundingSceneIds).toEqual([CONTEXT_SCENE, OTHER_SCENE]);
  });

  it("rejects duplicate and unavailable scene IDs within each list", () => {
    expect(() =>
      buildStoryWorkCoordinationCreateInput({
        project,
        model: MODEL,
        sceneIds: [CONTEXT_SCENE, CONTEXT_SCENE],
        form,
        idempotencyKey: "dup-root",
        availableSceneIds: availableScenes
      })
    ).toThrow(/scene source IDs must be unique/i);
    expect(() =>
      buildStoryWorkCoordinationCreateInput({
        project,
        model: MODEL,
        sceneIds: [sceneId("missing")],
        form,
        idempotencyKey: "missing-root",
        availableSceneIds: availableScenes
      })
    ).toThrow(/unavailable scene/i);
    expect(() =>
      buildStoryWorkCoordinationCreateInput({
        project,
        model: MODEL,
        sceneIds: [CONTEXT_SCENE],
        surroundingSceneIds: [OTHER_SCENE, OTHER_SCENE],
        form,
        idempotencyKey: "dup-surrounding",
        availableSceneIds: availableScenes
      })
    ).toThrow(/Surrounding context scene IDs must be unique/i);
    expect(() =>
      buildStoryWorkCoordinationCreateInput({
        project,
        model: MODEL,
        sceneIds: [],
        surroundingSceneIds: [sceneId("missing-surrounding")],
        form,
        idempotencyKey: "missing-surrounding",
        availableSceneIds: availableScenes
      })
    ).toThrow(/Surrounding context includes an unavailable scene/i);
  });

  it("maps coordination card status labels from projection truth", () => {
    const briefReady = detailFromAssignments([rootAssignment()]);
    expect(
      presentStoryWorkCoordinationCard({
        title: form.coordinationTitle,
        projection: briefReady.projection
      })
    ).toEqual({
      title: form.coordinationTitle,
      status: "Ready to continue"
    });

    const running = detailFromAssignments([
      startStoryWorkAttempt({
        assignment: rootAssignment(),
        expectedVersion: 1,
        runId: agentRunId("run-scene"),
        updatedAt: "2026-09-13T12:01:00.000Z"
      })
    ]);
    expect(deriveStoryWorkCoordinationCardStatus(running.projection)).toBe("Working");

    const generatedRoot = attachGeneratedStoryWorkArtifact({
      assignment: startStoryWorkAttempt({
        assignment: rootAssignment(),
        expectedVersion: 1,
        runId: agentRunId("run-scene"),
        updatedAt: "2026-09-13T12:01:00.000Z"
      }),
      expectedVersion: 2,
      runId: agentRunId("run-scene"),
      artifact: artifact(1)!,
      updatedAt: "2026-09-13T12:02:00.000Z"
    });
    const awaitingReview = detailFromAssignments([
      openStoryWorkArtifactReview({
        assignment: generatedRoot,
        expectedVersion: 3,
        artifact: artifact(1)!,
        updatedAt: "2026-09-13T12:03:00.000Z"
      })
    ]);
    expect(deriveStoryWorkCoordinationCardStatus(awaitingReview.projection)).toBe(
      "Awaiting review"
    );

    const failed = detailFromAssignments([
      rootAssignment({ status: "failed", version: 2 })
    ]);
    expect(deriveStoryWorkCoordinationCardStatus(failed.projection)).toBe("Needs attention");

    expect(
      deriveStoryWorkCoordinationCardStatus({
        coordinationId: COORDINATION_ID,
        status: "active",
        overallStatus: "completed",
        version: 2,
        steps: Object.freeze([])
      })
    ).toBe("Complete");

    const canceled = detailFromAssignments([rootAssignment()], { status: "canceled", version: 2 });
    expect(deriveStoryWorkCoordinationCardStatus(canceled.projection)).toBe("Canceled");
  });

  it("derives explicit step actions without automatic continue on reload", () => {
    const initial = detailFromAssignments([rootAssignment()]);
    expect(
      deriveStoryWorkCoordinationStepAction({
        detail: initial,
        stepProjection: stepProjection(initial, SCENE_STEP)
      })
    ).toEqual({ kind: "start-root", assignmentId: SCENE_ASSIGNMENT });
    expect(
      deriveStoryWorkCoordinationStepAction({
        detail: initial,
        stepProjection: stepProjection(initial, CHECK_STEP)
      })
    ).toEqual({ kind: "none" });

    const artifactReady = attachGeneratedStoryWorkArtifact({
      assignment: startStoryWorkAttempt({
        assignment: rootAssignment(),
        expectedVersion: 1,
        runId: agentRunId("run-scene"),
        updatedAt: "2026-09-13T12:01:00.000Z"
      }),
      expectedVersion: 2,
      runId: agentRunId("run-scene"),
      artifact: artifact(1)!,
      updatedAt: "2026-09-13T12:02:00.000Z"
    });
    const readyForCheck = detailFromAssignments([artifactReady]);
    const checkReady = stepProjection(readyForCheck, CHECK_STEP);
    expect(
      deriveStoryWorkCoordinationStepAction({
        detail: readyForCheck,
        stepProjection: checkReady
      })
    ).toEqual({
      kind: "continue-check",
      stepId: CHECK_STEP,
      request: {
        expectedCoordinationVersion: 1,
        expectedUpstreamArtifact: artifact(1)
      }
    });
    expect(
      deriveStoryWorkCoordinationStepAction({
        detail: readyForCheck,
        stepProjection: stepProjection(readyForCheck, SCENE_STEP)
      })
    ).toEqual({ kind: "open-root-review", assignmentId: SCENE_ASSIGNMENT });

    const bound = detailFromAssignments(
      [artifactReady, checkAssignment()],
      { steps: coordinationSteps(boundCheckStep()) }
    );
    expect(
      deriveStoryWorkCoordinationStepAction({
        detail: bound,
        stepProjection: stepProjection(bound, CHECK_STEP)
      })
    ).toEqual({ kind: "start-check", assignmentId: CHECK_ASSIGNMENT });

    const generatedCheck = attachGeneratedStoryWorkArtifact({
      assignment: startStoryWorkAttempt({
        assignment: checkAssignment(),
        expectedVersion: 1,
        runId: agentRunId("run-check"),
        updatedAt: "2026-09-13T12:06:00.000Z"
      }),
      expectedVersion: 2,
      runId: agentRunId("run-check"),
      artifact: artifact(1)!,
      updatedAt: "2026-09-13T12:07:00.000Z"
    });
    const checkReview = detailFromAssignments([
      artifactReady,
      openStoryWorkArtifactReview({
        assignment: generatedCheck,
        expectedVersion: 3,
        artifact: artifact(1)!,
        updatedAt: "2026-09-13T12:08:00.000Z"
      })
    ], { steps: coordinationSteps(boundCheckStep()) });
    expect(
      deriveStoryWorkCoordinationStepAction({
        detail: checkReview,
        stepProjection: stepProjection(checkReview, CHECK_STEP)
      })
    ).toEqual({ kind: "open-check-review", assignmentId: CHECK_ASSIGNMENT });

    expect(
      deriveStoryWorkCoordinationReloadAutoAction(
        { detail: initial },
        readyForCheck
      )
    ).toEqual({ kind: "none" });
  });

  it("builds initial attempt inputs from child assignment briefs without revisions", () => {
    const root = rootAssignment({ version: 2 });
    expect(
      buildStoryWorkCoordinationRootAttemptInput({
        projectId: PROJECT,
        rootAssignment: root,
        callerIdempotencyKey: "root-attempt-1"
      })
    ).toEqual({
      projectId: PROJECT,
      assignmentId: SCENE_ASSIGNMENT,
      expectedAssignmentVersion: 2,
      kind: "initial",
      sourceMode: "submitted-snapshot",
      instruction: root.brief,
      idempotencyKey: "root-attempt-1"
    });
    const check = checkAssignment({ version: 4 });
    expect(
      buildStoryWorkCoordinationCheckAttemptInput({
        projectId: PROJECT,
        checkAssignment: check,
        callerIdempotencyKey: "check-attempt-1"
      })
    ).toEqual({
      projectId: PROJECT,
      assignmentId: CHECK_ASSIGNMENT,
      expectedAssignmentVersion: 4,
      kind: "initial",
      sourceMode: "submitted-snapshot",
      instruction: check.brief,
      idempotencyKey: "check-attempt-1"
    });
    expect(
      buildStoryWorkCoordinationRootAttemptInput({
        projectId: PROJECT,
        rootAssignment: root,
        callerIdempotencyKey: "root-attempt-1"
      })
    ).not.toHaveProperty("priorArtifact");
  });

  it("builds continue requests from the exact resolved artifact pointer", () => {
    const ready = detailFromAssignments([
      attachGeneratedStoryWorkArtifact({
        assignment: startStoryWorkAttempt({
          assignment: rootAssignment(),
          expectedVersion: 1,
          runId: agentRunId("run-scene"),
          updatedAt: "2026-09-13T12:01:00.000Z"
        }),
        expectedVersion: 2,
        runId: agentRunId("run-scene"),
        artifact: artifact(1)!,
        updatedAt: "2026-09-13T12:02:00.000Z"
      })
    ]);
    expect(
      buildStoryWorkCoordinationContinueCheckRequest({
        detail: ready,
        stepProjection: stepProjection(ready, CHECK_STEP)
      })
    ).toEqual({
      expectedCoordinationVersion: 1,
      expectedUpstreamArtifact: artifact(1)
    });
  });

  it("reload reducer replaces server detail only and dedupes continue clicks", () => {
    const initial = detailFromAssignments([rootAssignment()]);
    const reloaded = detailFromAssignments([
      startStoryWorkAttempt({
        assignment: rootAssignment(),
        expectedVersion: 1,
        runId: agentRunId("run-scene-reload"),
        updatedAt: "2026-09-13T12:01:00.000Z"
      })
    ]);
    const next = reloadStoryWorkCoordinationWorkspaceDetail({ detail: initial }, reloaded);
    expect(next.detail).toBe(reloaded);
    expect(next).not.toHaveProperty("scheduledAction");

    const fingerprint = storyWorkCoordinationContinueSemanticFingerprint({
      coordinationId: COORDINATION_ID,
      stepId: CHECK_STEP,
      expectedCoordinationVersion: 1,
      expectedUpstreamArtifact: artifact(1)!
    });
    const acquired = tryAcquireStoryWorkCoordinationContinue({}, fingerprint);
    expect(acquired.accepted).toBe(true);
    const duplicate = tryAcquireStoryWorkCoordinationContinue(acquired.next, fingerprint);
    expect(duplicate.accepted).toBe(false);
    expect(
      releaseStoryWorkCoordinationContinue(acquired.next, fingerprint).inFlightContinueFingerprint
    ).toBeUndefined();
  });

  it("flags stale coordination continue conflicts for detail refresh", () => {
    expect(
      storyWorkCoordinationTransitionConflictRequiresDetailRefresh(
        new GhostwriterApiError(
          409,
          "STORY_WORK_COORDINATION_TRANSITION_CONFLICT",
          "The story work coordination changed before this action completed."
        )
      )
    ).toBe(true);
    expect(
      storyWorkCoordinationTransitionConflictRequiresDetailRefresh(
        new GhostwriterApiError(
          409,
          "STORY_WORK_COORDINATION_DEPENDENCY_CONFLICT",
          "The upstream artifact no longer satisfies this step."
        )
      )
    ).toBe(true);
    expect(
      storyWorkCoordinationTransitionConflictRequiresDetailRefresh(
        new GhostwriterApiError(409, "PROJECT_VERSION_CONFLICT", "Project changed.")
      )
    ).toBe(false);
  });
});
