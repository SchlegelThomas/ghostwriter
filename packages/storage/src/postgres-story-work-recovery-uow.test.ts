import { afterEach, describe, expect, it } from "vitest";
import type { ContextReceipt } from "@ghostwriter/core";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  CHARACTER_STORY_WORK_WORKFLOW_ID,
  CharacterStoryWorkGenerationConflictError,
  StoryWorkAssignmentNotFoundError,
  StoryWorkRecoveryActionConflictError,
  StoryWorkRecoveryTransitionConflictError,
  accountId,
  agentRunId,
  buildStoryWorkRecoveryTerminalAssignment,
  buildStoryWorkRecoveryTerminalRun,
  contextReceiptId,
  createAgentRun,
  createProjectMembership,
  createQueuedAgentRun,
  createStoryWorkAssignment,
  createStoryWorkAttempt,
  instructionContentHash,
  sceneContentHash,
  startStoryWorkAttempt,
  storyKnowledgeId,
  storyWorkAssignmentId,
  type RecoverActiveStoryWorkAttemptInput
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import {
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPostgresCharacterStoryWorkGenerationUnitOfWork } from "./postgres-character-story-work-generation-uow.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresStoryWorkRecoveryUnitOfWork } from "./postgres-story-work-recovery-uow.js";
import {
  createPostgresStoryWorkAssignmentRepository,
  createPostgresStoryWorkAttemptRepository
} from "./postgres-story-work-repository.js";
import { seedProject } from "./seed.js";
import { user } from "./schema.js";

const OWNER = accountId("account-story-work-recovery-postgres");
const FOREIGN = accountId("account-story-work-recovery-postgres-foreign");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-story-work-recovery-postgres");
const RUN_ID = agentRunId("run-story-work-recovery-postgres");
const OTHER_RUN = agentRunId("run-story-work-recovery-postgres-other");
const TARGET = storyKnowledgeId("knowledge-story-work-recovery-postgres");
const RECEIPT_ID = contextReceiptId("receipt-story-work-recovery-postgres");
const CREATED_AT = "2026-09-13T18:00:00.000Z";
const COMPLETED_AT = "2026-09-13T18:01:00.000Z";
const RECEIPT_HASH = instructionContentHash("a".repeat(64));

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

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
    idempotencyKey: "assignment-story-work-recovery-postgres",
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
    receiptId: RECEIPT_ID,
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

function recoveryReceipt(): ContextReceipt {
  return {
    id: RECEIPT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    workflowId: CHARACTER_STORY_WORK_WORKFLOW_ID,
    workflowVersion: "2026-09-12",
    layers: [],
    resources: [],
    excludedContextClasses: [],
    provider: "openai",
    model: "gpt-4.1",
    maxOutputTokens: 2000,
    wallClockSeconds: 60,
    toolCount: 0,
    egressClass: "openai-responses",
    outputSchemaId: "character-create-v2",
    receiptHash: RECEIPT_HASH,
    primaryTarget: { kind: "story-knowledge", id: TARGET },
    createdAt: CREATED_AT
  };
}

async function createFailureTrigger(
  client: Awaited<ReturnType<typeof createPgliteDatabase>>["client"],
  name: string,
  table: "agent_runs" | "story_work_assignments",
  condition: string
) {
  await client.exec(`
    create function ${name}() returns trigger as $$
    begin
      if ${condition} then raise exception 'injected story work recovery persistence failure'; end if;
      return new;
    end;
    $$ language plpgsql;
    create trigger ${name}_trigger before update on ${table}
    for each row execute function ${name}();
  `);
}

async function createHarness(input?: Readonly<{
  archived?: boolean;
  runStatus?: "running" | "queued";
}>) {
  const { db, client, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: OWNER,
    name: "Story Work Recovery Owner",
    email: "story-work-recovery@example.test",
    emailVerified: true
  });
  const exec = toRepositoryDatabase(db);
  const projects = createPostgresProjectRepository(exec);
  const fixture = input?.archived
    ? {
        ...BELLWETHER_FIXTURE,
        project: {
          ...BELLWETHER_FIXTURE.project,
          archivedAt: "2026-09-13T17:00:00.000Z"
        }
      }
    : BELLWETHER_FIXTURE;
  await seedProject(projects, fixture);
  await projects.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: OWNER,
        role: "owner",
        createdAt: CREATED_AT
      })
    );
  });
  const assignments = createPostgresStoryWorkAssignmentRepository(exec);
  const attempts = createPostgresStoryWorkAttemptRepository(exec);
  const runs = createPostgresAgentRunRepository(exec);
  const receipts = createPostgresContextReceiptRepository(exec);
  const assignment = baseAssignment();
  expect(
    await assignments.create({
      assignment,
      requestFingerprint: instructionContentHash("c".repeat(64))
    })
  ).toMatchObject({ ok: true });
  expect(await receipts.insertImmutable(recoveryReceipt())).toMatchObject({ ok: true });
  const run = runningRun(input?.runStatus ?? "running");
  if (run.status === "queued") {
    expect(await runs.create(run)).toMatchObject({ ok: true });
  } else {
    expect(await runs.create(createQueuedAgentRun({ ...run, status: "queued" }))).toMatchObject({
      ok: true
    });
    expect(
      await runs.transition({
        runId: RUN_ID,
        expectedStatus: "queued",
        next: run
      })
    ).toMatchObject({ ok: true });
  }
  const runningAssignment = startStoryWorkAttempt({
    assignment,
    expectedVersion: 1,
    runId: RUN_ID,
    updatedAt: "2026-09-13T18:00:10.000Z"
  });
  expect(
    await assignments.compareAndSet({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedVersion: 1,
      next: runningAssignment
    })
  ).toMatchObject({ ok: true });
  const attempt = createStoryWorkAttempt({
    assignmentId: ASSIGNMENT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    initiatorAccountId: OWNER,
    runId: RUN_ID,
    version: 1,
    kind: "initial",
    sourceMode: "submitted-snapshot",
    instruction: assignment.brief,
    idempotencyKey: "attempt-story-work-recovery-postgres",
    requestFingerprint: instructionContentHash("d".repeat(64)),
    createdAt: CREATED_AT
  });
  expect(await attempts.create({ attempt })).toMatchObject({ ok: true });
  const recovery = createPostgresStoryWorkRecoveryUnitOfWork(exec);
  const generation = createPostgresCharacterStoryWorkGenerationUnitOfWork(exec);
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
    client,
    recovery,
    generation,
    recoveryInput,
    assignments,
    attempts,
    runs,
    runningAssignment,
    attempt,
    run
  };
}

describe("postgres story work recovery unit of work", () => {
  it("cancels an active running attempt without mutating the attempt row", async () => {
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
    const harness = await createHarness();
    await createFailureTrigger(
      harness.client,
      "reject_recovery_assignment",
      "story_work_assignments",
      "new.status = 'canceled'"
    );
    await expect(
      harness.recovery.recoverActiveStoryWorkAttempt(harness.recoveryInput)
    ).rejects.toBeDefined();
    await expect(
      harness.assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID
      })
    ).resolves.toMatchObject({ status: "running", version: 2 });
    await expect(harness.runs.get(RUN_ID)).resolves.toMatchObject({ status: "running" });
  });

  it("fences late character generation completion after recovery", async () => {
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
    await expect(
      harness.generation.finishWithoutArtifact({
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
