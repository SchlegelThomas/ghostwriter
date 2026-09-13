import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  agentRunId,
  completeStoryWorkAttempt,
  contextReceiptId,
  createProjectMembership,
  createQueuedAgentRun,
  createStoryWorkAssignment,
  createStoryWorkAttempt,
  finishStoryWorkAttemptWithoutArtifact,
  instructionContentHash,
  startStoryWorkAttempt,
  storyKnowledgeId,
  storyWorkAssignmentId,
  type ContextReceipt,
  type StoryWorkAssignment,
  type StoryWorkAttempt
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import {
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import {
  createPostgresStoryWorkAssignmentRepository,
  createPostgresStoryWorkAttemptRepository
} from "./postgres-story-work-repository.js";
import { seedProject } from "./seed.js";
import { user } from "./schema.js";

const OWNER = accountId("account-story-work-postgres-owner");
const FOREIGN = accountId("account-story-work-postgres-foreign");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-story-work-postgres");
const RUN_ID = agentRunId("run-story-work-postgres");
const RECEIPT_ID = contextReceiptId("receipt-story-work-postgres");
const NOW = "2026-09-12T18:00:00.000Z";
const REQUEST_FINGERPRINT = instructionContentHash("a".repeat(64));
const ATTEMPT_FINGERPRINT = instructionContentHash("b".repeat(64));

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

function assignment(
  overrides: Partial<StoryWorkAssignment> = {}
): StoryWorkAssignment {
  return createStoryWorkAssignment({
    id: ASSIGNMENT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "character",
    brief: "Build Inez from the selected scene.",
    constraints: "Keep every claim grounded.",
    doneWhen: "A reviewable Cast record is ready.",
    sources: [
      {
        kind: "scene",
        sceneId: BELLWETHER_FIXTURE.scenes[0]!.id,
        projectVersion: BELLWETHER_FIXTURE.project.version
      }
    ],
    destination: {
      kind: "story-knowledge",
      storyKnowledgeId: storyKnowledgeId("knowledge-story-work-reserved"),
      operation: "create"
    },
    provider: "openai",
    model: "gpt-4.1",
    status: "brief-ready",
    steps: [{ id: "draft", title: "Draft dossier", dependencies: [] }],
    results: [],
    idempotencyKey: "assignment-story-work-postgres-key",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  });
}

function attempt(overrides: Partial<StoryWorkAttempt> = {}): StoryWorkAttempt {
  return createStoryWorkAttempt({
    assignmentId: ASSIGNMENT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    initiatorAccountId: OWNER,
    runId: RUN_ID,
    version: 1,
    kind: "initial",
    sourceMode: "submitted-snapshot",
    instruction: "Build Inez from the selected scene.",
    idempotencyKey: "attempt-story-work-postgres-key",
    requestFingerprint: ATTEMPT_FINGERPRINT,
    createdAt: NOW,
    ...overrides
  });
}

function receipt(): ContextReceipt {
  return Object.freeze({
    id: RECEIPT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    workflowId: "scene-partner.capture-reflection",
    workflowVersion: "1.0.0",
    layers: [],
    resources: [],
    excludedContextClasses: [],
    provider: "openai",
    model: "gpt-4.1",
    maxOutputTokens: 1000,
    wallClockSeconds: 60,
    toolCount: 0,
    egressClass: "openai-responses",
    outputSchemaId: "capture-reflection-v1",
    receiptHash: instructionContentHash("c".repeat(64)),
    createdAt: NOW
  });
}

async function setup() {
  const { db, client, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values([
    {
      id: OWNER,
      name: "Story Work Owner",
      email: "story-work-owner@example.test",
      emailVerified: true
    },
    {
      id: FOREIGN,
      name: "Story Work Foreign",
      email: "story-work-foreign@example.test",
      emailVerified: true
    }
  ]);
  const exec = toRepositoryDatabase(db);
  const projects = createPostgresProjectRepository(exec);
  await seedProject(projects, BELLWETHER_FIXTURE);
  await projects.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: OWNER,
        role: "owner",
        createdAt: NOW
      })
    );
  });
  const receipts = createPostgresContextReceiptRepository(exec);
  expect(await receipts.insertImmutable(receipt())).toMatchObject({ ok: true });
  const runs = createPostgresAgentRunRepository(exec);
  expect(
    await runs.create(
      createQueuedAgentRun({
        id: RUN_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        initiatorAccountId: OWNER,
        workflowId: "scene-partner.capture-reflection",
        workflowVersion: "1.0.0",
        provider: "openai",
        model: "gpt-4.1",
        receiptId: RECEIPT_ID,
        receiptHash: receipt().receiptHash,
        status: "queued",
        createdAt: NOW,
        updatedAt: NOW
      })
    )
  ).toMatchObject({ ok: true });
  return {
    db,
    client,
    assignments: createPostgresStoryWorkAssignmentRepository(exec),
    attempts: createPostgresStoryWorkAttemptRepository(exec)
  };
}

describe("postgres story work repositories", () => {
  it("applies migration 0027 over the current schema and from an empty compatible base", async () => {
    const current = await setup();
    await expect(current.assignments.listByProject({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    })).resolves.toEqual([]);

    const { client, close } = createPgliteDatabase();
    closers.push(close);
    await client.exec(`
      create table projects (id text primary key);
      create table auth_users (id text primary key);
      create table context_receipts (id text primary key);
      create table agent_runs (id text primary key);
    `);
    const migration = await readFile(
      new URL("../drizzle/0027_premium_randall.sql", import.meta.url),
      "utf8"
    );
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
    const columns = await client.query<{ table_name: string; column_name: string }>(`
      select table_name, column_name
      from information_schema.columns
      where table_name in ('story_work_assignments', 'story_work_attempts')
        and column_name in ('request_fingerprint', 'idempotency_key', 'source_mode', 'latest_attempt_id')
      order by table_name, column_name
    `);
    expect(columns.rows).toEqual([
      { table_name: "story_work_assignments", column_name: "idempotency_key" },
      { table_name: "story_work_assignments", column_name: "latest_attempt_id" },
      { table_name: "story_work_assignments", column_name: "request_fingerprint" },
      { table_name: "story_work_attempts", column_name: "idempotency_key" },
      { table_name: "story_work_attempts", column_name: "request_fingerprint" },
      { table_name: "story_work_attempts", column_name: "source_mode" }
    ]);
  });

  it("persists scoped assignments with exact idempotency replay and CAS fencing", async () => {
    const { assignments } = await setup();
    const original = assignment();
    await expect(
      assignments.create({ assignment: original, requestFingerprint: REQUEST_FINGERPRINT })
    ).resolves.toMatchObject({ ok: true, created: true, assignment: original });
    await expect(
      assignments.getByIdempotencyKey({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        idempotencyKey: original.idempotencyKey
      })
    ).resolves.toEqual({
      assignment: original,
      requestFingerprint: REQUEST_FINGERPRINT
    });
    await expect(
      assignments.create({
        assignment: assignment({ id: storyWorkAssignmentId("ignored-replay-id") }),
        requestFingerprint: REQUEST_FINGERPRINT
      })
    ).resolves.toMatchObject({ ok: true, created: false, assignment: { id: ASSIGNMENT_ID } });
    await expect(
      assignments.create({
        assignment: assignment({ id: storyWorkAssignmentId("conflicting-replay-id") }),
        requestFingerprint: instructionContentHash("d".repeat(64))
      })
    ).resolves.toEqual({ ok: false, reason: "idempotency-conflict" });
    await expect(
      assignments.get({
        accountId: FOREIGN,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID
      })
    ).resolves.toBeUndefined();
    await expect(
      assignments.getByIdempotencyKey({
        accountId: FOREIGN,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        idempotencyKey: original.idempotencyKey
      })
    ).resolves.toBeUndefined();
    await expect(
      assignments.getByIdempotencyKey({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        idempotencyKey: "missing-assignment-key"
      })
    ).resolves.toBeUndefined();

    const running = startStoryWorkAttempt({
      assignment: original,
      expectedVersion: 1,
      runId: RUN_ID,
      updatedAt: "2026-09-12T18:01:00.000Z"
    });
    await expect(
      assignments.compareAndSet({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID,
        expectedVersion: 1,
        next: running
      })
    ).resolves.toMatchObject({ ok: true, assignment: { version: 2, status: "running" } });
    await expect(
      assignments.compareAndSet({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID,
        expectedVersion: 1,
        next: running
      })
    ).resolves.toEqual({ ok: false, reason: "version-conflict" });
    await expect(
      assignments.listByProject({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        options: { status: "running", limit: 1 }
      })
    ).resolves.toMatchObject([{
      id: ASSIGNMENT_ID,
      activeAttemptId: RUN_ID,
      latestAttemptId: RUN_ID
    }]);
    const failed = finishStoryWorkAttemptWithoutArtifact({
      assignment: running,
      expectedVersion: 2,
      runId: RUN_ID,
      outcome: "failed",
      updatedAt: "2026-09-12T18:02:00.000Z"
    });
    await expect(
      assignments.compareAndSet({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID,
        expectedVersion: 2,
        next: failed
      })
    ).resolves.toMatchObject({
      ok: true,
      assignment: {
        status: "failed",
        latestAttemptId: RUN_ID
      }
    });
    await expect(
      assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID
      })
    ).resolves.toMatchObject({
      status: "failed",
      latestAttemptId: RUN_ID
    });
  });

  it("persists attempt identity, scoped lookup, exact replay, and completion CAS", async () => {
    const { assignments, attempts } = await setup();
    expect(
      await assignments.create({
        assignment: assignment(),
        requestFingerprint: REQUEST_FINGERPRINT
      })
    ).toMatchObject({ ok: true });
    const original = attempt();
    await expect(attempts.create({ attempt: original })).resolves.toMatchObject({
      ok: true,
      created: true,
      attempt: original
    });
    await expect(
      attempts.create({
        attempt: attempt({ runId: agentRunId("ignored-attempt-run") })
      })
    ).resolves.toMatchObject({ ok: true, created: false, attempt: { runId: RUN_ID } });
    await expect(
      attempts.create({
        attempt: attempt({
          runId: agentRunId("conflicting-attempt-run"),
          requestFingerprint: instructionContentHash("e".repeat(64))
        })
      })
    ).resolves.toEqual({ ok: false, reason: "idempotency-conflict" });
    await expect(
      attempts.getByIdempotencyKey({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID,
        idempotencyKey: original.idempotencyKey
      })
    ).resolves.toEqual(original);
    await expect(
      attempts.get({
        accountId: FOREIGN,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID,
        runId: RUN_ID
      })
    ).resolves.toBeUndefined();

    const completed = completeStoryWorkAttempt({
      attempt: original,
      expectedVersion: 1,
      resultArtifact: {
        proposalId: "proposal-story-work-postgres" as never,
        artifactVersion: 1,
        contentHash: instructionContentHash("f".repeat(64))
      },
      completedAt: "2026-09-12T18:02:00.000Z"
    });
    await expect(
      attempts.compareAndSet({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID,
        runId: RUN_ID,
        expectedVersion: 1,
        next: completed
      })
    ).resolves.toMatchObject({ ok: true, attempt: { version: 2 } });
    await expect(
      attempts.compareAndSet({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID,
        runId: RUN_ID,
        expectedVersion: 1,
        next: completed
      })
    ).resolves.toEqual({ ok: false, reason: "version-conflict" });
    await expect(
      attempts.listByAssignment({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID,
        limit: 1
      })
    ).resolves.toMatchObject([{ runId: RUN_ID, version: 2 }]);
  });
});
