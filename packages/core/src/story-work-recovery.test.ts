import { describe, expect, it } from "vitest";
import {
  CHARACTER_STORY_WORK_WORKFLOW_ID,
  instructionContentHash
} from "./agent-domain.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import { createMemoryCharacterStoryWorkGenerationUnitOfWork } from "./memory-character-story-work-generation-uow.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemoryStoryWorkAssignmentRepository } from "./memory-story-work-assignment-repository.js";
import { createMemoryStoryWorkAttemptRepository } from "./memory-story-work-attempt-repository.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import { agentRunId, contextReceiptId } from "./domain.js";
import { BELLWETHER_FIXTURE, BELLWETHER_FIXTURE_PROJECT_ID } from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createAgentRun, createQueuedAgentRun } from "./agent-runs-proposals.js";
import { createMemoryStoryWorkRecoveryUnitOfWork } from "./memory-story-work-recovery-uow.js";
import {
  buildStoryWorkRecoveryTerminalAssignment,
  buildStoryWorkRecoveryTerminalRun,
  matchesStoryWorkRecoveryReplay,
  StoryWorkRecoveryActionConflictError,
  StoryWorkRecoveryTransitionConflictError,
  type RecoverActiveStoryWorkAttemptInput
} from "./story-work-recovery.js";
import {
  createStoryWorkAssignment,
  startStoryWorkAttempt,
  storyWorkAssignmentId
} from "./story-work-assignment.js";
import { createStoryWorkAttempt } from "./story-work-attempt.js";
import { sceneContentHash } from "./scene-documents.js";
import { storyKnowledgeId } from "./domain.js";
import { CharacterStoryWorkGenerationConflictError } from "./character-story-work-generation-uow.js";
import { createRepositoryCharacterStoryWorkGenerationExecutor } from "./character-story-work-generation-repository-uow.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";

const OWNER = accountId("account-story-work-recovery-owner");
const FOREIGN = accountId("account-story-work-recovery-foreign");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-story-work-recovery");
const RUN_ID = agentRunId("run-story-work-recovery");
const OTHER_RUN = agentRunId("run-story-work-recovery-other");
const TARGET = storyKnowledgeId("knowledge-story-work-recovery-target");
const CREATED_AT = "2026-09-13T18:00:00.000Z";
const COMPLETED_AT = "2026-09-13T18:01:00.000Z";
const RECEIPT_HASH = instructionContentHash("a".repeat(64));

function baseAssignment() {
  return createStoryWorkAssignment({
    id: ASSIGNMENT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "character",
    brief: "Recover this assignment.",
    constraints: "Use selected sources only.",
    doneWhen: "A proposal is ready.",
    sources: [
      {
        kind: "scene",
        sceneId: BELLWETHER_FIXTURE.scenes[0]!.id,
        projectVersion: BELLWETHER_FIXTURE.project.version,
        workingVersion: 1,
        contentHash: sceneContentHash("b".repeat(64))
      }
    ],
    destination: {
      kind: "story-knowledge",
      storyKnowledgeId: TARGET,
      operation: "create"
    },
    provider: "openai",
    model: "gpt-4.1",
    status: "brief-ready",
    steps: [{ id: "character", title: "Character", dependencies: [] }],
    results: [],
    idempotencyKey: "assignment-story-work-recovery",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  });
}

function runningRun(status: "running" | "queued") {
  const queued = createQueuedAgentRun({
    id: RUN_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    initiatorAccountId: OWNER,
    workflowId: CHARACTER_STORY_WORK_WORKFLOW_ID,
    workflowVersion: "2026-09-12",
    provider: "openai",
    model: "gpt-4.1",
    receiptId: contextReceiptId("receipt-story-work-recovery"),
    receiptHash: RECEIPT_HASH,
    status: "queued",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  });
  if (status === "queued") return queued;
  return createAgentRun({
    ...queued,
    status: "running",
    updatedAt: "2026-09-13T18:00:30.000Z"
  });
}

async function createHarness(input?: Readonly<{
  archived?: boolean;
  runStatus?: "running" | "queued";
  failAfter?: "after-run";
}>) {
  const fixture = input?.archived
    ? {
        ...BELLWETHER_FIXTURE,
        project: {
          ...BELLWETHER_FIXTURE.project,
          archivedAt: "2026-09-13T17:00:00.000Z"
        }
      }
    : BELLWETHER_FIXTURE;
  const projects = createMemoryProjectRepository(
    [fixture],
    [
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: OWNER,
        role: "owner",
        createdAt: CREATED_AT
      })
    ]
  );
  const assignments = createMemoryStoryWorkAssignmentRepository();
  const attempts = createMemoryStoryWorkAttemptRepository();
  const runs = createMemoryAgentRunRepository();
  const receipts = createMemoryContextReceiptRepository();
  const proposals = createMemoryAgentProposalRepository();
  const assignment = baseAssignment();
  await assignments.create({
    assignment,
    requestFingerprint: instructionContentHash("c".repeat(64))
  });
  const runningAssignment = startStoryWorkAttempt({
    assignment,
    expectedVersion: 1,
    runId: RUN_ID,
    updatedAt: "2026-09-13T18:00:10.000Z"
  });
  await assignments.compareAndSet({
    accountId: OWNER,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    assignmentId: ASSIGNMENT_ID,
    expectedVersion: 1,
    next: runningAssignment
  });
  const run = runningRun(input?.runStatus ?? "running");
  if (run.status === "queued") {
    await runs.create(run);
  } else {
    await runs.create(createQueuedAgentRun({ ...run, status: "queued" }));
    await runs.transition({
      runId: RUN_ID,
      expectedStatus: "queued",
      next: run
    });
  }
  const attempt = createStoryWorkAttempt({
    assignmentId: ASSIGNMENT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    initiatorAccountId: OWNER,
    runId: RUN_ID,
    version: 1,
    kind: "initial",
    sourceMode: "submitted-snapshot",
    instruction: assignment.brief,
    idempotencyKey: "attempt-story-work-recovery",
    requestFingerprint: instructionContentHash("d".repeat(64)),
    createdAt: CREATED_AT
  });
  await attempts.create({ attempt });
  const recovery = createMemoryStoryWorkRecoveryUnitOfWork({
    projects,
    assignments,
    attempts,
    runs,
    ...(input?.failAfter === undefined ? {} : { failAfter: input.failAfter })
  });
  const generation = createMemoryCharacterStoryWorkGenerationUnitOfWork({
    projects,
    assignments,
    attempts,
    receipts,
    runs,
    proposals
  });
  const recoveryInput: RecoverActiveStoryWorkAttemptInput = Object.freeze({
    accountId: OWNER,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    assignmentId: ASSIGNMENT_ID,
    expectedAssignmentVersion: 2,
    runId: RUN_ID,
    action: "cancel",
    completedAt: COMPLETED_AT
  });
  return {
    recovery,
    recoveryInput,
    generation,
    assignments,
    attempts,
    runs,
    runningAssignment,
    attempt,
    run
  };
}

describe("story work recovery domain", () => {
  it("matches exact replay shape before active validation", () => {
    const assignment = startStoryWorkAttempt({
      assignment: baseAssignment(),
      expectedVersion: 1,
      runId: RUN_ID,
      updatedAt: "2026-09-13T18:00:10.000Z"
    });
    const terminalAssignment = buildStoryWorkRecoveryTerminalAssignment(assignment, {
      expectedAssignmentVersion: 2,
      runId: RUN_ID,
      action: "mark-interrupted",
      completedAt: COMPLETED_AT
    });
    const run = buildStoryWorkRecoveryTerminalRun(
      runningRun("running"),
      "mark-interrupted",
      COMPLETED_AT
    );
    const attempt = createStoryWorkAttempt({
      assignmentId: ASSIGNMENT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      initiatorAccountId: OWNER,
      runId: RUN_ID,
      version: 1,
      kind: "initial",
      sourceMode: "submitted-snapshot",
      instruction: "Recover this assignment.",
      idempotencyKey: "attempt-story-work-recovery",
      requestFingerprint: instructionContentHash("d".repeat(64)),
      createdAt: CREATED_AT
    });
    const input: RecoverActiveStoryWorkAttemptInput = Object.freeze({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedAssignmentVersion: 2,
      runId: RUN_ID,
      action: "mark-interrupted",
      completedAt: "2026-09-13T19:00:00.000Z"
    });
    expect(
      matchesStoryWorkRecoveryReplay(input, terminalAssignment, attempt, run)
    ).toBe(true);
  });
});

describe("story work recovery UOW", () => {
  it("cancels an active running attempt without proposals", async () => {
    const harness = await createHarness();
    const result = await harness.recovery.recoverActiveStoryWorkAttempt(
      harness.recoveryInput
    );
    expect(result.replayed).toBe(false);
    expect(result.run).toMatchObject({
      status: "failed",
      terminalDiagnosticCode: "run-canceled",
      completedAt: COMPLETED_AT
    });
    expect(result.assignment).toMatchObject({
      status: "canceled",
      version: 3,
      latestAttemptId: RUN_ID
    });
    expect(result.assignment.activeAttemptId).toBeUndefined();
    expect(result.attempt.completedAt).toBeUndefined();
    expect(result.attempt.resultArtifact).toBeUndefined();
  });

  it("marks an active attempt interrupted as failed assignment state", async () => {
    const harness = await createHarness();
    const result = await harness.recovery.recoverActiveStoryWorkAttempt({
      ...harness.recoveryInput,
      action: "mark-interrupted"
    });
    expect(result.assignment.status).toBe("failed");
    expect(result.run.terminalDiagnosticCode).toBe("client-interrupted");
  });

  it("allows cancel on archived projects for cleanup", async () => {
    const harness = await createHarness({ archived: true });
    const result = await harness.recovery.recoverActiveStoryWorkAttempt(
      harness.recoveryInput
    );
    expect(result.assignment.status).toBe("canceled");
  });

  it("accepts queued runs for race-safe recovery", async () => {
    const harness = await createHarness({ runStatus: "queued" });
    const result = await harness.recovery.recoverActiveStoryWorkAttempt(
      harness.recoveryInput
    );
    expect(result.run.status).toBe("failed");
    expect(result.assignment.status).toBe("canceled");
  });

  it("replays an exact prior cancel without mutating state", async () => {
    const harness = await createHarness();
    const first = await harness.recovery.recoverActiveStoryWorkAttempt(
      harness.recoveryInput
    );
    const replay = await harness.recovery.recoverActiveStoryWorkAttempt(
      harness.recoveryInput
    );
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.assignment).toEqual(first.assignment);
    expect(replay.run).toEqual(first.run);
  });

  it("replays a lost-response retry when the server clock advances", async () => {
    const harness = await createHarness();
    const first = await harness.recovery.recoverActiveStoryWorkAttempt(
      harness.recoveryInput
    );
    const replay = await harness.recovery.recoverActiveStoryWorkAttempt({
      ...harness.recoveryInput,
      completedAt: "2026-09-13T19:00:00.000Z"
    });
    expect(replay.replayed).toBe(true);
    expect(replay.run.completedAt).toBe(COMPLETED_AT);
    expect(replay.run).toEqual(first.run);
    expect(replay.assignment).toEqual(first.assignment);
  });

  it("conflicts when a competing action retries after cancel with a later clock", async () => {
    const harness = await createHarness();
    await harness.recovery.recoverActiveStoryWorkAttempt(harness.recoveryInput);
    await expect(
      harness.recovery.recoverActiveStoryWorkAttempt({
        ...harness.recoveryInput,
        action: "mark-interrupted",
        completedAt: "2026-09-13T19:00:00.000Z"
      })
    ).rejects.toBeInstanceOf(StoryWorkRecoveryActionConflictError);
  });

  it("refuses a different action on the same recovered run", async () => {
    const harness = await createHarness();
    await harness.recovery.recoverActiveStoryWorkAttempt(harness.recoveryInput);
    await expect(
      harness.recovery.recoverActiveStoryWorkAttempt({
        ...harness.recoveryInput,
        action: "mark-interrupted"
      })
    ).rejects.toBeInstanceOf(StoryWorkRecoveryActionConflictError);
  });

  it("refuses stale expected assignment versions", async () => {
    const harness = await createHarness();
    await expect(
      harness.recovery.recoverActiveStoryWorkAttempt({
        ...harness.recoveryInput,
        expectedAssignmentVersion: 1
      })
    ).rejects.toBeInstanceOf(StoryWorkRecoveryTransitionConflictError);
  });

  it("refuses a non-active run id", async () => {
    const harness = await createHarness();
    await expect(
      harness.recovery.recoverActiveStoryWorkAttempt({
        ...harness.recoveryInput,
        runId: OTHER_RUN
      })
    ).rejects.toBeInstanceOf(StoryWorkRecoveryTransitionConflictError);
  });

  it("hides foreign scope as not found", async () => {
    const harness = await createHarness();
    await expect(
      harness.recovery.recoverActiveStoryWorkAttempt({
        ...harness.recoveryInput,
        accountId: FOREIGN
      })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentNotFoundError);
  });

  it("lets one recovery action win when cancel and interrupted race", async () => {
    const harness = await createHarness();
    const results = await Promise.allSettled([
      harness.recovery.recoverActiveStoryWorkAttempt(harness.recoveryInput),
      harness.recovery.recoverActiveStoryWorkAttempt({
        ...harness.recoveryInput,
        action: "mark-interrupted"
      })
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(StoryWorkRecoveryActionConflictError);
  });

  it("serializes concurrent identical recoveries into one commit and one replay", async () => {
    const harness = await createHarness();
    const [first, second] = await Promise.all([
      harness.recovery.recoverActiveStoryWorkAttempt(harness.recoveryInput),
      harness.recovery.recoverActiveStoryWorkAttempt(harness.recoveryInput)
    ]);
    const replayedCount = [first, second].filter((result) => result.replayed).length;
    expect(replayedCount).toBe(1);
    expect(first.assignment).toEqual(second.assignment);
  });

  it("rolls back assignment when persistence fails after the run transition", async () => {
    const harness = await createHarness({ failAfter: "after-run" });
    await expect(
      harness.recovery.recoverActiveStoryWorkAttempt(harness.recoveryInput)
    ).rejects.toThrow(/injected story work recovery failure/i);
    await expect(
      harness.assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID
      })
    ).resolves.toMatchObject({ status: "running", version: 2 });
    await expect(harness.runs.get(RUN_ID)).resolves.toMatchObject({ status: "running" });
  });

  it("fences late generation completion after recovery", async () => {
    const harness = await createHarness();
    await harness.recovery.recoverActiveStoryWorkAttempt(harness.recoveryInput);
    const terminalRun = buildStoryWorkRecoveryTerminalRun(
      harness.run,
      "cancel",
      COMPLETED_AT
    );
    const terminalAssignment = buildStoryWorkRecoveryTerminalAssignment(
      harness.runningAssignment,
      {
        expectedAssignmentVersion: 2,
        runId: RUN_ID,
        action: "cancel",
        completedAt: COMPLETED_AT
      }
    );
    const executor = createRepositoryCharacterStoryWorkGenerationExecutor({
      projects: createMemoryProjectRepository(
        [BELLWETHER_FIXTURE],
        [
          createProjectMembership({
            projectId: BELLWETHER_FIXTURE_PROJECT_ID,
            accountId: OWNER,
            role: "owner",
            createdAt: CREATED_AT
          })
        ]
      ),
      assignments: harness.assignments,
      attempts: harness.attempts,
      receipts: createMemoryContextReceiptRepository(),
      runs: harness.runs,
      proposals: createMemoryAgentProposalRepository()
    });
    await expect(
      executor.finishWithoutArtifact({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        expectedAssignmentVersion: 2,
        expectedAttemptVersion: 1,
        expectedRunStatus: "running",
        terminalRun,
        terminalAssignment
      })
    ).rejects.toBeInstanceOf(CharacterStoryWorkGenerationConflictError);
  });
});
