import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  agentProposalId,
  agentRunId,
  completeStoryWorkAttempt,
  contextReceiptId,
  createProjectMembership,
  createQueuedAgentRun,
  createStoryWorkAssignment,
  createStoryWorkAttempt,
  finishStoryWorkAttemptWithoutArtifact,
  instructionContentHash,
  projectId,
  recordAppliedStoryWorkAssignmentFromUnitOfWork,
  recordReviewedStoryWorkAssignment,
  sceneContentHash,
  startStoryWorkAttempt,
  storyKnowledgeId,
  storyWorkAssignmentId,
  mcpGrantId,
  createMcpGrantRecord,
  mcpGrantTokenHash,
  type ContextReceipt,
  type StoryWorkAssignment,
  type StoryWorkAttempt
} from "@ghostwriter/core";
import { eq, sql } from "drizzle-orm";
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
import { createPostgresMcpGrantRepository } from "./postgres-mcp-grant-repository.js";
import { seedProject } from "./seed.js";
import { mcpGrants, user } from "./schema.js";

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

  it("applies migration 0028 over the committed assignment shape with paired nullable fields", async () => {
    const { client, close } = createPgliteDatabase();
    closers.push(close);
    await client.exec(`
      create table story_work_assignments (
        id text primary key,
        sources jsonb not null,
        destination jsonb not null,
        steps jsonb not null,
        results jsonb not null,
        generated_artifact jsonb,
        current_artifact jsonb,
        constraint story_work_assignments_json_shape_check check (
          jsonb_typeof(sources) = 'array'
          and jsonb_typeof(destination) = 'object'
          and jsonb_typeof(steps) = 'array'
          and jsonb_typeof(results) = 'array'
          and (generated_artifact is null or jsonb_typeof(generated_artifact) = 'object')
          and (current_artifact is null or jsonb_typeof(current_artifact) = 'object')
        )
      );
    `);
    const migration = await readFile(
      new URL("../drizzle/0028_condemned_rogue.sql", import.meta.url),
      "utf8"
    );
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
    const columns = await client.query<{ column_name: string }>(`
      select column_name
      from information_schema.columns
      where table_name = 'story_work_assignments'
        and column_name in ('apply_idempotency_key', 'apply_request_fingerprint')
      order by column_name
    `);
    expect(columns.rows).toEqual([
      { column_name: "apply_idempotency_key" },
      { column_name: "apply_request_fingerprint" }
    ]);
    await client.exec(`
      insert into story_work_assignments (
        id, sources, destination, steps, results
      ) values ('legacy', '[]', '{}', '[]', '[]');
    `);
    await expect(client.exec(`
      insert into story_work_assignments (
        id, sources, destination, steps, results, apply_idempotency_key
      ) values ('invalid', '[]', '{}', '[]', '[]', 'apply-only');
    `)).rejects.toThrow();
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

  it("round-trips apply replay identity and prevents later CAS replacement", async () => {
    const { assignments } = await setup();
    const pointer = {
      proposalId: agentProposalId("proposal-postgres-applied"),
      artifactVersion: 1,
      contentHash: instructionContentHash("8".repeat(64))
    };
    const review = assignment({
      version: 4,
      status: "awaiting-review",
      latestAttemptId: RUN_ID,
      generatedArtifact: pointer,
      currentArtifact: pointer,
      updatedAt: "2026-09-12T18:04:00.000Z"
    });
    expect(await assignments.create({
      assignment: review,
      requestFingerprint: REQUEST_FINGERPRINT
    })).toMatchObject({ ok: true });
    const applied = recordAppliedStoryWorkAssignmentFromUnitOfWork({
      assignment: review,
      expectedVersion: 4,
      artifact: pointer,
      results: [{
        kind: "story-knowledge",
        storyKnowledgeId: storyKnowledgeId("knowledge-story-work-reserved"),
        projectVersion: BELLWETHER_FIXTURE.project.version + 1
      }],
      applyRequest: {
        idempotencyKey: "apply-postgres-once",
        requestFingerprint: instructionContentHash("9".repeat(64))
      },
      updatedAt: "2026-09-12T18:05:00.000Z"
    });
    await expect(assignments.compareAndSet({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedVersion: 4,
      next: applied
    })).resolves.toMatchObject({
      ok: true,
      assignment: {
        applyIdempotencyKey: "apply-postgres-once",
        applyRequestFingerprint: instructionContentHash("9".repeat(64))
      }
    });
    const rewritten = createStoryWorkAssignment({
      ...applied,
      version: 6,
      applyIdempotencyKey: "apply-postgres-rewritten",
      updatedAt: "2026-09-12T18:06:00.000Z"
    });
    await expect(assignments.compareAndSet({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedVersion: 5,
      next: rewritten
    })).resolves.toEqual({ ok: false, reason: "version-conflict" });
  });

  it("roundtrips check source, assess destination, reviewed status, and story-check result", async () => {
    const { assignments } = await setup();
    const sceneTarget = BELLWETHER_FIXTURE.scenes[0]!.id;
    const checkId = storyWorkAssignmentId("assignment-check-postgres");
    const pointer = {
      proposalId: agentProposalId("proposal-check-postgres"),
      artifactVersion: 1,
      contentHash: instructionContentHash("c".repeat(64))
    };
    const check = createStoryWorkAssignment({
      id: checkId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      initiatorAccountId: OWNER,
      version: 2,
      taskKind: "check",
      brief: "Check continuity for the scene.",
      constraints: "Stay within supplied context.",
      doneWhen: "Findings are ready for review.",
      sources: [
        {
          kind: "scene",
          sceneId: sceneTarget,
          projectVersion: BELLWETHER_FIXTURE.project.version,
          workingVersion: 2,
          contentHash: sceneContentHash("d".repeat(64))
        }
      ],
      destination: {
        kind: "scene",
        sceneId: sceneTarget,
        operation: "assess"
      },
      provider: "openai",
      model: "gpt-4.1",
      status: "awaiting-review",
      steps: [{ id: "check", title: "Check", dependencies: [] }],
      generatedArtifact: pointer,
      currentArtifact: pointer,
      results: [],
      idempotencyKey: "assignment-check-postgres-key",
      createdAt: NOW,
      updatedAt: "2026-09-12T18:04:00.000Z"
    });
    expect(
      await assignments.create({
        assignment: check,
        requestFingerprint: REQUEST_FINGERPRINT
      })
    ).toMatchObject({ ok: true });
    const reviewed = recordReviewedStoryWorkAssignment({
      assignment: check,
      expectedVersion: 2,
      artifact: pointer,
      result: {
        kind: "story-check",
        proposalId: pointer.proposalId,
        artifactVersion: pointer.artifactVersion,
        contentHash: pointer.contentHash,
        sceneId: sceneTarget
      },
      updatedAt: "2026-09-12T18:05:00.000Z"
    });
    await expect(
      assignments.compareAndSet({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: checkId,
        expectedVersion: 2,
        next: reviewed
      })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: checkId
      })
    ).resolves.toEqual(reviewed);
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

async function expectForeignKeyViolation(promise: Promise<unknown>) {
  await expect(promise).rejects.toSatisfy((error) => isForeignKeyViolation(error));
}

function isForeignKeyViolation(error: unknown): boolean {
  if (postgresErrorCode(error) === "23503") return true;
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
      continue;
    }
    if (typeof current === "string") {
      parts.push(current);
      break;
    }
    break;
  }
  const text = parts.join(" ");
  return text.includes("23503") || /foreign key constraint/i.test(text);
}

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      typeof (current as { code: unknown }).code === "string"
    ) {
      return (current as { code: string }).code;
    }
    if (current instanceof Error) {
      const match = current.message.match(/\b(23\d{3})\b/u);
      if (match !== null) return match[1];
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : undefined;
    if (current === undefined) break;
  }
  return undefined;
}

describe("postgres story work assignment MCP origin", () => {
  const GRANT_ID = mcpGrantId("mcp-grant-story-work-origin-postgres");
  const ORIGIN = Object.freeze({ kind: "mcp" as const, grantId: GRANT_ID });
  const OTHER_GRANT = mcpGrantId("mcp-grant-story-work-origin-other");

  function originAssignment(
    overrides: Partial<StoryWorkAssignment> = {}
  ): StoryWorkAssignment {
    return assignment({
      id: storyWorkAssignmentId("assignment-story-work-origin-postgres"),
      idempotencyKey: "assignment-story-work-origin-key",
      origin: ORIGIN,
      ...overrides
    });
  }

  async function setupWithGrant() {
    const context = await setup();
    const grants = createPostgresMcpGrantRepository(toRepositoryDatabase(context.db));
    expect(
      await grants.insert(
        createMcpGrantRecord({
          id: GRANT_ID,
          accountId: OWNER,
          projectId: BELLWETHER_FIXTURE_PROJECT_ID,
          captureIds: [],
          sceneIds: [BELLWETHER_FIXTURE.scenes[0]!.id],
          bookIds: [],
          assignmentIds: [],
          coordinationIds: [],
          tools: ["ghostwriter_get_grant", "ghostwriter_list_story_work"],
          allowProjectStructureRead: true,
          tokenHash: mcpGrantTokenHash("9".repeat(64)),
          tokenHint: "…rigin",
          expiresAt: "2026-08-01T00:00:00.000Z",
          createdAt: NOW,
          updatedAt: NOW
        })
      )
    ).toMatchObject({ ok: true });
    expect(
      await grants.insert(
        createMcpGrantRecord({
          id: OTHER_GRANT,
          accountId: OWNER,
          projectId: BELLWETHER_FIXTURE_PROJECT_ID,
          captureIds: [],
          sceneIds: [BELLWETHER_FIXTURE.scenes[0]!.id],
          bookIds: [],
          assignmentIds: [],
          coordinationIds: [],
          tools: ["ghostwriter_get_grant"],
          allowProjectStructureRead: true,
          tokenHash: mcpGrantTokenHash("8".repeat(64)),
          tokenHint: "…ther",
          expiresAt: "2026-08-01T00:00:00.000Z",
          createdAt: NOW,
          updatedAt: NOW
        })
      )
    ).toMatchObject({ ok: true });
    return { ...context, grants };
  }

  it("roundtrips MCP origin on create, get, list, and idempotent replay", async () => {
    const { assignments } = await setupWithGrant();
    const created = originAssignment();
    await expect(
      assignments.create({
        assignment: created,
        requestFingerprint: REQUEST_FINGERPRINT
      })
    ).resolves.toMatchObject({ ok: true, created: true, assignment: { origin: ORIGIN } });

    await expect(
      assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: created.id
      })
    ).resolves.toMatchObject({ origin: ORIGIN });

    const rows = await assignments.listByProject({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    });
    expect(rows[0]?.origin).toEqual(ORIGIN);

    await expect(
      assignments.create({
        assignment: created,
        requestFingerprint: REQUEST_FINGERPRINT
      })
    ).resolves.toMatchObject({ ok: true, created: false, assignment: { origin: ORIGIN } });
  });

  it("indexes origin grant for scoped listing queries", async () => {
    const { assignments } = await setupWithGrant();
    const created = originAssignment();
    await assignments.create({
      assignment: created,
      requestFingerprint: REQUEST_FINGERPRINT
    });
    const listed = await assignments.listByMcpGrantOrigin({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      originMcpGrantId: GRANT_ID
    });
    expect(listed.map((row) => row.id)).toEqual([created.id]);
  });

  it("lists MCP grant origin rows without project-page truncation and empty cross-scope", async () => {
    const { assignments } = await setupWithGrant();
    const oldOriginId = storyWorkAssignmentId("assignment-origin-postgres-old");
    await assignments.create({
      assignment: originAssignment({
        id: oldOriginId,
        idempotencyKey: "assignment-origin-postgres-old",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z"
      }),
      requestFingerprint: instructionContentHash("b".repeat(64))
    });
    for (let index = 1; index <= 150; index += 1) {
      await assignments.create({
        assignment: assignment({
          id: storyWorkAssignmentId(`assignment-origin-noise-${index}`),
          idempotencyKey: `assignment-origin-noise-${index}`,
          updatedAt: new Date(Date.UTC(2026, 9, 12, 12, 0, index)).toISOString()
        }),
        requestFingerprint: instructionContentHash(
          String.fromCharCode(97 + (index % 6)).repeat(64)
        )
      });
    }
    await assignments.create({
      assignment: originAssignment({
        id: storyWorkAssignmentId("assignment-origin-postgres-foreign-account"),
        initiatorAccountId: FOREIGN,
        idempotencyKey: "assignment-origin-postgres-foreign-account"
      }),
      requestFingerprint: instructionContentHash("d".repeat(64))
    });
    await assignments.create({
      assignment: originAssignment({
        id: storyWorkAssignmentId("assignment-origin-postgres-other-grant"),
        idempotencyKey: "assignment-origin-postgres-other-grant",
        origin: { kind: "mcp", grantId: OTHER_GRANT }
      }),
      requestFingerprint: instructionContentHash("e".repeat(64))
    });

    const listed = await assignments.listByMcpGrantOrigin({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      originMcpGrantId: GRANT_ID
    });
    expect(listed.map((row) => row.id)).toEqual([oldOriginId]);
    expect(listed.every((row) => row.initiatorAccountId === OWNER)).toBe(true);
    expect(
      listed.some(
        (row) =>
          row.id === storyWorkAssignmentId("assignment-origin-postgres-foreign-account")
      )
    ).toBe(false);
    expect(
      listed.some(
        (row) => row.id === storyWorkAssignmentId("assignment-origin-postgres-other-grant")
      )
    ).toBe(false);
  });

  it("rejects compare-and-set origin changes and blocks grant delete while referenced", async () => {
    const { db, assignments, grants } = await setupWithGrant();
    const created = originAssignment();
    await assignments.create({
      assignment: created,
      requestFingerprint: REQUEST_FINGERPRINT
    });
    const running = startStoryWorkAttempt({
      assignment: created,
      expectedVersion: 1,
      runId: RUN_ID,
      updatedAt: "2026-09-12T18:01:00.000Z"
    });
    await expect(
      assignments.compareAndSet({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: created.id,
        expectedVersion: 1,
        next: running
      })
    ).resolves.toMatchObject({ ok: true, assignment: { origin: ORIGIN } });

    const tampered = createStoryWorkAssignment({
      ...running,
      version: 3,
      origin: { kind: "mcp", grantId: OTHER_GRANT },
      updatedAt: "2026-09-12T18:02:00.000Z"
    });
    await expect(
      assignments.compareAndSet({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: created.id,
        expectedVersion: 2,
        next: tampered
      })
    ).resolves.toEqual({ ok: false, reason: "version-conflict" });

    await expectForeignKeyViolation(
      db.delete(mcpGrants).where(eq(mcpGrants.id, GRANT_ID))
    );

    expect(
      await grants.revoke({
        id: GRANT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        revokedAt: "2026-09-12T18:03:00.000Z",
        updatedAt: "2026-09-12T18:03:00.000Z"
      })
    ).toMatchObject({ ok: true });

    await expect(
      assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: created.id
      })
    ).resolves.toMatchObject({ origin: ORIGIN });
  });

  it("does not enforce cross-project origin parity at the database layer", async () => {
    const { db, assignments } = await setupWithGrant();

    const foreignProject = projectId("project-story-work-origin-foreign");
    await db.execute(sql`
      INSERT INTO projects (id, title, created_at, version)
      VALUES (${foreignProject}, 'Foreign', ${NOW}, 1)
    `);

    const crossProjectAssignment = createStoryWorkAssignment({
      ...originAssignment(),
      id: storyWorkAssignmentId("assignment-story-work-origin-cross-project"),
      projectId: foreignProject,
      idempotencyKey: "assignment-story-work-origin-cross-project",
      origin: { kind: "mcp", grantId: OTHER_GRANT }
    });

    await expect(
      assignments.create({
        assignment: crossProjectAssignment,
        requestFingerprint: REQUEST_FINGERPRINT
      })
    ).resolves.toMatchObject({
      ok: true,
      assignment: {
        projectId: foreignProject,
        origin: { kind: "mcp", grantId: OTHER_GRANT }
      }
    });
  });
});
