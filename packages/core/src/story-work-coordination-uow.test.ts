import { describe, expect, it } from "vitest";
import type { AgentModelId } from "./agent-context-receipt.js";
import { instructionContentHash } from "./agent-domain.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import { agentProposalId, agentRunId, sceneId } from "./domain.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemoryStoryWorkAssignmentRepository } from "./memory-story-work-assignment-repository.js";
import { createMemoryStoryWorkCoordinationRepository } from "./memory-story-work-coordination-repository.js";
import { createMemoryStoryWorkCoordinationUnitOfWork } from "./memory-story-work-coordination-uow.js";
import { BELLWETHER_FIXTURE, BELLWETHER_FIXTURE_PROJECT_ID } from "./fixtures.js";
import { sceneContentHash } from "./scene-documents.js";
import {
  attachGeneratedStoryWorkArtifact,
  createStoryWorkAssignment,
  startStoryWorkAttempt,
  storyWorkAssignmentId,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment
} from "./story-work-assignment.js";
import {
  cancelStoryWorkCoordination,
  createStoryWorkCoordination,
  storyWorkCoordinationId,
  storyWorkCoordinationRequestFingerprint,
  storyWorkCoordinationStepId,
  StoryWorkCoordinationTransitionError,
  type StoryWorkCoordination
} from "./story-work-coordination.js";
import {
  StoryWorkCoordinationBindIdempotencyConflictError,
  StoryWorkCoordinationCreateIdempotencyConflictError,
  StoryWorkCoordinationDependencyConflictError
} from "./story-work-coordination-uow.js";

const OWNER = accountId("account-coordination-uow-owner");
const FOREIGN = accountId("account-coordination-uow-foreign");
const PROJECT = BELLWETHER_FIXTURE_PROJECT_ID;
const SCENE_TARGET = sceneId("scene-coordination-uow-target");
const CONTEXT_SCENE = sceneId("scene-coordination-uow-context");
const SCENE_STEP = storyWorkCoordinationStepId("coord-uow-scene");
const CHECK_STEP = storyWorkCoordinationStepId("coord-uow-check");
const COORDINATION_ID = storyWorkCoordinationId("coordination-uow");
const SCENE_ASSIGNMENT = storyWorkAssignmentId("assignment-coordination-uow-scene");
const CHECK_ASSIGNMENT = storyWorkAssignmentId("assignment-coordination-uow-check");
const ALT_CHECK_ASSIGNMENT = storyWorkAssignmentId("assignment-coordination-uow-check-alt");
const RUN = agentRunId("run-coordination-uow-scene");
const CREATED_AT = "2026-09-13T12:00:00.000Z";

const COORD_FINGERPRINT = instructionContentHash("a".repeat(64));
const ROOT_FINGERPRINT = instructionContentHash("b".repeat(64));
const CHECK_FINGERPRINT = instructionContentHash("c".repeat(64));
const ALT_COORD_FINGERPRINT = instructionContentHash("d".repeat(64));

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

function projectFixture(archived = false) {
  return archived
    ? {
        ...BELLWETHER_FIXTURE,
        project: {
          ...BELLWETHER_FIXTURE.project,
          archivedAt: "2026-09-13T11:00:00.000Z"
        }
      }
    : BELLWETHER_FIXTURE;
}

async function harness(input?: Readonly<{
  archived?: boolean;
  failAfter?: "after-root-assignment" | "after-check-assignment";
}>) {
  const projects = createMemoryProjectRepository(
    [projectFixture(input?.archived ?? false)],
    [
      createProjectMembership({
        projectId: PROJECT,
        accountId: OWNER,
        role: "owner",
        createdAt: CREATED_AT
      })
    ]
  );
  const assignments = createMemoryStoryWorkAssignmentRepository();
  const coordinations = createMemoryStoryWorkCoordinationRepository();
  const uow = createMemoryStoryWorkCoordinationUnitOfWork({
    projects,
    assignments,
    coordinations,
    ...(input?.failAfter === undefined ? {} : { failAfter: input.failAfter })
  });
  return { projects, assignments, coordinations, uow };
}

function rootAssignment(overrides: Partial<StoryWorkAssignment> = {}): StoryWorkAssignment {
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
    destination: { kind: "scene", sceneId: SCENE_TARGET, operation: "create" },
    provider: "openai",
    model: "gpt-4.1" as AgentModelId,
    status: "brief-ready",
    steps: [{ id: "draft", title: "Draft scene", dependencies: [] }],
    results: [],
    idempotencyKey: "submit-scene-coordination-uow",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides
  });
}

async function promoteRootToArtifactReady(
  assignments: Awaited<ReturnType<typeof harness>>["assignments"]
): Promise<StoryWorkAssignment> {
  const running = startStoryWorkAttempt({
    assignment: rootAssignment(),
    expectedVersion: 1,
    runId: RUN,
    updatedAt: "2026-09-13T12:01:00.000Z"
  });
  await assignments.compareAndSet({
    accountId: OWNER,
    projectId: PROJECT,
    assignmentId: SCENE_ASSIGNMENT,
    expectedVersion: 1,
    next: running
  });
  const ready = attachGeneratedStoryWorkArtifact({
    assignment: running,
    expectedVersion: 2,
    runId: RUN,
    artifact: artifact("proposal-coordination-uow", 1, "a"),
    updatedAt: "2026-09-13T12:02:00.000Z"
  });
  await assignments.compareAndSet({
    accountId: OWNER,
    projectId: PROJECT,
    assignmentId: SCENE_ASSIGNMENT,
    expectedVersion: 2,
    next: ready
  });
  return ready;
}

function coordinationAggregate(
  overrides: Partial<StoryWorkCoordination> = {}
): StoryWorkCoordination {
  return createStoryWorkCoordination({
    id: COORDINATION_ID,
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
    idempotencyKey: "coordination-create-uow",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides
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
    destination: { kind: "scene", sceneId: SCENE_TARGET, operation: "assess" },
    provider: "openai",
    model: "gpt-4.1" as AgentModelId,
    status: "brief-ready",
    steps: [{ id: "check", title: "Run continuity check", dependencies: [] }],
    results: [],
    idempotencyKey: "submit-check-coordination-uow",
    createdAt: "2026-09-13T12:10:00.000Z",
    updatedAt: "2026-09-13T12:10:00.000Z",
    ...overrides
  });
}

async function seedCreate(uow: ReturnType<typeof createMemoryStoryWorkCoordinationUnitOfWork>) {
  return uow.create({
    accountId: OWNER,
    projectId: PROJECT,
    coordination: coordinationAggregate(),
    coordinationRequestFingerprint: COORD_FINGERPRINT,
    rootAssignment: rootAssignment(),
    rootAssignmentRequestFingerprint: ROOT_FINGERPRINT
  });
}

describe("story work coordination unit of work", () => {
  it("creates coordination with blocked check projection until artifact-ready", async () => {
    const { uow } = await harness();
    const created = await seedCreate(uow);
    expect(created.replayed).toBe(false);
    expect(created.projection.steps[0]?.state).toBe("ready");
    expect(created.projection.steps[1]).toMatchObject({
      state: "blocked",
      reasons: ["upstream-not-ready"]
    });
  });

  it("replays exact create by idempotency key and fingerprints", async () => {
    const { uow } = await harness();
    const first = await seedCreate(uow);
    const replay = await uow.findCreateReplay({
      accountId: OWNER,
      projectId: PROJECT,
      idempotencyKey: "coordination-create-uow",
      coordinationRequestFingerprint: COORD_FINGERPRINT
    });
    expect(replay?.replayed).toBe(true);
    expect(replay?.coordination.id).toBe(first.coordination.id);
    const second = await uow.create({
      accountId: OWNER,
      projectId: PROJECT,
      coordination: coordinationAggregate(),
      coordinationRequestFingerprint: COORD_FINGERPRINT,
      rootAssignment: rootAssignment(),
      rootAssignmentRequestFingerprint: ROOT_FINGERPRINT
    });
    expect(second.replayed).toBe(true);
  });

  it("refuses create replay body or fingerprint mismatch", async () => {
    const { uow } = await harness();
    await seedCreate(uow);
    await expect(
      uow.create({
        accountId: OWNER,
        projectId: PROJECT,
        coordination: coordinationAggregate({ title: "Different title" }),
        coordinationRequestFingerprint: COORD_FINGERPRINT,
        rootAssignment: rootAssignment(),
        rootAssignmentRequestFingerprint: ROOT_FINGERPRINT
      })
    ).rejects.toBeInstanceOf(StoryWorkCoordinationCreateIdempotencyConflictError);
    await expect(
      uow.create({
        accountId: OWNER,
        projectId: PROJECT,
        coordination: coordinationAggregate(),
        coordinationRequestFingerprint: ALT_COORD_FINGERPRINT,
        rootAssignment: rootAssignment(),
        rootAssignmentRequestFingerprint: ROOT_FINGERPRINT
      })
    ).rejects.toBeInstanceOf(StoryWorkCoordinationCreateIdempotencyConflictError);
  });

  it("refuses duplicate root assignment idempotency keys and assignment ids", async () => {
    const { uow, assignments } = await harness();
    await assignments.create({
      assignment: rootAssignment({
        id: storyWorkAssignmentId("assignment-coordination-uow-foreign-id"),
        idempotencyKey: "submit-scene-coordination-uow"
      }),
      requestFingerprint: instructionContentHash("e".repeat(64))
    });
    await expect(seedCreate(uow)).rejects.toBeInstanceOf(
      StoryWorkCoordinationCreateIdempotencyConflictError
    );
    await assignments.create({
      assignment: rootAssignment(),
      requestFingerprint: ROOT_FINGERPRINT
    });
    await expect(seedCreate(uow)).rejects.toBeInstanceOf(
      StoryWorkCoordinationCreateIdempotencyConflictError
    );
  });

  it("hides foreign scope and refuses archived project mutations", async () => {
    const { uow } = await harness();
    await expect(
      uow.findCreateReplay({
        accountId: FOREIGN,
        projectId: PROJECT,
        idempotencyKey: "coordination-create-uow",
        coordinationRequestFingerprint: COORD_FINGERPRINT
      })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentNotFoundError);
    const archived = await harness({ archived: true });
    await expect(seedCreate(archived.uow)).rejects.toBeInstanceOf(
      ProjectArchivedMutationError
    );
  });

  it("rolls back partial create when coordination write fails", async () => {
    const { uow, assignments, coordinations } = await harness({
      failAfter: "after-root-assignment"
    });
    await expect(seedCreate(uow)).rejects.toThrow(/after-root-assignment/);
    await expect(
      assignments.get({
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: SCENE_ASSIGNMENT
      })
    ).resolves.toBeUndefined();
    await expect(
      coordinations.getByIdempotencyKey({
        accountId: OWNER,
        projectId: PROJECT,
        idempotencyKey: "coordination-create-uow"
      })
    ).resolves.toBeUndefined();
  });

  it("binds continuity check when upstream artifact is ready", async () => {
    const { uow, assignments } = await harness();
    const created = await seedCreate(uow);
    await promoteRootToArtifactReady(assignments);
    const pointer = artifact("proposal-coordination-uow", 1, "a");
    const bound = await uow.bindProposalContinuityCheck({
      accountId: OWNER,
      projectId: PROJECT,
      coordinationId: created.coordination.id,
      expectedCoordinationVersion: 1,
      stepId: CHECK_STEP,
      resolvedDependency: { stepId: SCENE_STEP, artifact: pointer },
      checkAssignment: checkAssignment(pointer),
      checkAssignmentRequestFingerprint: CHECK_FINGERPRINT,
      boundAt: "2026-09-13T12:05:00.000Z"
    });
    expect(bound.replayed).toBe(false);
    expect(bound.projection.steps[1]).toMatchObject({
      state: "ready",
      assignmentId: CHECK_ASSIGNMENT
    });
  });

  it("blocks bind before upstream artifact exists and on terminal upstream states", async () => {
    const { uow } = await harness();
    const created = await seedCreate(uow);
    const pointer = artifact("proposal-coordination-uow", 1, "a");
    const bindInput = {
      accountId: OWNER,
      projectId: PROJECT,
      coordinationId: created.coordination.id,
      expectedCoordinationVersion: 1,
      stepId: CHECK_STEP,
      resolvedDependency: { stepId: SCENE_STEP, artifact: pointer },
      checkAssignment: checkAssignment(pointer),
      checkAssignmentRequestFingerprint: CHECK_FINGERPRINT,
      boundAt: "2026-09-13T12:05:00.000Z"
    };
    await expect(uow.bindProposalContinuityCheck(bindInput)).rejects.toBeInstanceOf(
      StoryWorkCoordinationDependencyConflictError
    );

    for (const status of ["rejected", "applied", "stale"] as const) {
      const local = await harness();
      const seeded = await seedCreate(local.uow);
      await promoteRootToArtifactReady(local.assignments);
      await local.assignments.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: SCENE_ASSIGNMENT,
        expectedVersion: 3,
        next: rootAssignment({
          status,
          version: 4,
          currentArtifact: pointer,
          generatedArtifact: pointer,
          ...(status === "applied"
            ? {
                results: [
                  {
                    kind: "scene" as const,
                    sceneId: SCENE_TARGET,
                    workingVersion: 1
                  }
                ],
                applyIdempotencyKey: "apply-scene-coordination-uow",
                applyRequestFingerprint: instructionContentHash("9".repeat(64))
              }
            : {})
        })
      });
      await expect(
        local.uow.bindProposalContinuityCheck({
          ...bindInput,
          coordinationId: seeded.coordination.id
        })
      ).rejects.toBeInstanceOf(StoryWorkCoordinationDependencyConflictError);
    }
  });

  it("replays exact bind and refuses dependency or version conflicts", async () => {
    const { uow, assignments } = await harness();
    const created = await seedCreate(uow);
    await promoteRootToArtifactReady(assignments);
    const pointer = artifact("proposal-coordination-uow", 1, "a");
    const bindInput = {
      accountId: OWNER,
      projectId: PROJECT,
      coordinationId: created.coordination.id,
      expectedCoordinationVersion: 1,
      stepId: CHECK_STEP,
      resolvedDependency: { stepId: SCENE_STEP, artifact: pointer },
      checkAssignment: checkAssignment(pointer),
      checkAssignmentRequestFingerprint: CHECK_FINGERPRINT,
      boundAt: "2026-09-13T12:05:00.000Z"
    };
    const first = await uow.bindProposalContinuityCheck(bindInput);
    const replay = await uow.findBindReplay({
      accountId: OWNER,
      projectId: PROJECT,
      coordinationId: created.coordination.id,
      expectedCoordinationVersion: 1,
      stepId: CHECK_STEP,
      resolvedDependency: { stepId: SCENE_STEP, artifact: pointer }
    });
    expect(replay?.replayed).toBe(true);
    expect(replay?.checkAssignment.id).toBe(first.checkAssignment.id);

    await expect(
      uow.bindProposalContinuityCheck({
        ...bindInput,
        resolvedDependency: {
          stepId: SCENE_STEP,
          artifact: artifact("proposal-coordination-uow", 2, "b")
        }
      })
    ).rejects.toBeInstanceOf(StoryWorkCoordinationDependencyConflictError);

    await expect(
      uow.bindProposalContinuityCheck({
        ...bindInput,
        expectedCoordinationVersion: 99
      })
    ).rejects.toBeInstanceOf(StoryWorkCoordinationTransitionError);
  });

  it("serializes concurrent binds into one commit and one replay without orphan checks", async () => {
    const { uow, assignments } = await harness();
    const created = await seedCreate(uow);
    await promoteRootToArtifactReady(assignments);
    const pointer = artifact("proposal-coordination-uow", 1, "a");
    const bindInput = {
      accountId: OWNER,
      projectId: PROJECT,
      coordinationId: created.coordination.id,
      expectedCoordinationVersion: 1,
      stepId: CHECK_STEP,
      resolvedDependency: { stepId: SCENE_STEP, artifact: pointer },
      checkAssignment: checkAssignment(pointer),
      checkAssignmentRequestFingerprint: CHECK_FINGERPRINT,
      boundAt: "2026-09-13T12:05:00.000Z"
    };
    const [left, right] = await Promise.all([
      uow.bindProposalContinuityCheck(bindInput),
      uow.bindProposalContinuityCheck(bindInput)
    ]);
    expect(new Set([left.replayed, right.replayed])).toEqual(new Set([true, false]));
    await expect(
      assignments.listByProject({ accountId: OWNER, projectId: PROJECT })
    ).resolves.toHaveLength(2);

    const competing = await harness();
    const seeded = await seedCreate(competing.uow);
    await promoteRootToArtifactReady(competing.assignments);
    const winner = await competing.uow.bindProposalContinuityCheck(bindInput);
    await expect(
      competing.uow.bindProposalContinuityCheck({
        ...bindInput,
        coordinationId: seeded.coordination.id,
        checkAssignment: checkAssignment(pointer, { id: ALT_CHECK_ASSIGNMENT }),
        checkAssignmentRequestFingerprint: instructionContentHash("f".repeat(64))
      })
    ).rejects.toBeInstanceOf(StoryWorkCoordinationBindIdempotencyConflictError);
    expect(winner.checkAssignment.id).toBe(CHECK_ASSIGNMENT);
    await expect(
      competing.assignments.get({
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ALT_CHECK_ASSIGNMENT
      })
    ).resolves.toBeUndefined();
  });

  it("refuses deferred or source mismatches and rolls back failed bind writes", async () => {
    const { uow, assignments } = await harness();
    const created = await seedCreate(uow);
    await promoteRootToArtifactReady(assignments);
    const pointer = artifact("proposal-coordination-uow", 1, "a");
    await expect(
      uow.bindProposalContinuityCheck({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: created.coordination.id,
        expectedCoordinationVersion: 1,
        stepId: CHECK_STEP,
        resolvedDependency: { stepId: SCENE_STEP, artifact: pointer },
        checkAssignment: checkAssignment(pointer, {
          brief: "Different brief than deferred config."
        }),
        checkAssignmentRequestFingerprint: CHECK_FINGERPRINT,
        boundAt: "2026-09-13T12:05:00.000Z"
      })
    ).rejects.toBeInstanceOf(StoryWorkCoordinationDependencyConflictError);

    const failing = await harness({ failAfter: "after-check-assignment" });
    const seeded = await seedCreate(failing.uow);
    await promoteRootToArtifactReady(failing.assignments);
    await expect(
      failing.uow.bindProposalContinuityCheck({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: seeded.coordination.id,
        expectedCoordinationVersion: 1,
        stepId: CHECK_STEP,
        resolvedDependency: { stepId: SCENE_STEP, artifact: pointer },
        checkAssignment: checkAssignment(pointer),
        checkAssignmentRequestFingerprint: CHECK_FINGERPRINT,
        boundAt: "2026-09-13T12:05:00.000Z"
      })
    ).rejects.toThrow(/after-check-assignment/);
    await expect(
      failing.assignments.get({
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: CHECK_ASSIGNMENT
      })
    ).resolves.toBeUndefined();
  });

  it("refuses bind on canceled coordinations and bind idempotency mismatch", async () => {
    const { uow, assignments, coordinations } = await harness();
    const created = await seedCreate(uow);
    await promoteRootToArtifactReady(assignments);
    const canceled = cancelStoryWorkCoordination({
      coordination: created.coordination,
      expectedVersion: 1,
      updatedAt: "2026-09-13T12:04:00.000Z"
    });
    await coordinations.compareAndSet({
      accountId: OWNER,
      projectId: PROJECT,
      coordinationId: created.coordination.id,
      expectedVersion: 1,
      next: canceled
    });
    const pointer = artifact("proposal-coordination-uow", 1, "a");
    await expect(
      uow.bindProposalContinuityCheck({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: created.coordination.id,
        expectedCoordinationVersion: 1,
        stepId: CHECK_STEP,
        resolvedDependency: { stepId: SCENE_STEP, artifact: pointer },
        checkAssignment: checkAssignment(pointer),
        checkAssignmentRequestFingerprint: CHECK_FINGERPRINT,
        boundAt: "2026-09-13T12:05:00.000Z"
      })
    ).rejects.toBeInstanceOf(StoryWorkCoordinationDependencyConflictError);

    const replayHarness = await harness();
    const seeded = await seedCreate(replayHarness.uow);
    await promoteRootToArtifactReady(replayHarness.assignments);
    await replayHarness.assignments.create({
      assignment: checkAssignment(pointer),
      requestFingerprint: instructionContentHash("0".repeat(64))
    });
    await expect(
      replayHarness.uow.bindProposalContinuityCheck({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: seeded.coordination.id,
        expectedCoordinationVersion: 1,
        stepId: CHECK_STEP,
        resolvedDependency: { stepId: SCENE_STEP, artifact: pointer },
        checkAssignment: checkAssignment(pointer),
        checkAssignmentRequestFingerprint: CHECK_FINGERPRINT,
        boundAt: "2026-09-13T12:05:00.000Z"
      })
    ).rejects.toBeInstanceOf(StoryWorkCoordinationBindIdempotencyConflictError);
  });

  it("uses storyWorkCoordinationRequestFingerprint at the repository boundary", () => {
    expect(storyWorkCoordinationRequestFingerprint(COORD_FINGERPRINT)).toBe(
      instructionContentHash(String(COORD_FINGERPRINT))
    );
  });
});
