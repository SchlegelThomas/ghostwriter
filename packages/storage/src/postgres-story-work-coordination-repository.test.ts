import { afterEach, describe, expect, it } from "vitest";
import type { AgentModelId } from "@ghostwriter/core";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  agentProposalId,
  agentRunId,
  attachGeneratedStoryWorkArtifact,
  bindProposalContinuityCheckStep,
  cancelStoryWorkCoordination,
  contextReceiptId,
  createMemoryStoryWorkCoordinationRepository,
  createProjectMembership,
  createQueuedAgentRun,
  createStoryWorkAssignment,
  createStoryWorkCoordination,
  instructionContentHash,
  mcpGrantId,
  createMcpGrantRecord,
  mcpGrantTokenHash,
  projectId,
  startStoryWorkAttempt,
  storyWorkAssignmentId,
  storyWorkCoordinationId,
  storyWorkCoordinationRequestFingerprint,
  storyWorkCoordinationStepId,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment,
  type StoryWorkCoordination
} from "@ghostwriter/core";
import { eq, sql } from "drizzle-orm";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import {
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresStoryWorkCoordinationRepository } from "./postgres-story-work-coordination-repository.js";
import { createPostgresMcpGrantRepository } from "./postgres-mcp-grant-repository.js";
import {
  createPostgresStoryWorkAssignmentRepository
} from "./postgres-story-work-repository.js";
import { seedProject } from "./seed.js";
import {
  storyWorkAssignments,
  storyWorkCoordinationStepBindings,
  storyWorkCoordinations,
  mcpGrants,
  user
} from "./schema.js";

const OWNER = accountId("account-coordination-postgres-owner");
const FOREIGN = accountId("account-coordination-postgres-foreign");
const PROJECT = BELLWETHER_FIXTURE_PROJECT_ID;
const OTHER_PROJECT = projectId("project-coordination-postgres-other");
const SCENE_TARGET = BELLWETHER_FIXTURE.scenes[0]!.id;
const CONTEXT_SCENE = BELLWETHER_FIXTURE.scenes[1]!.id;
const SCENE_STEP = storyWorkCoordinationStepId("coord-step-scene-postgres");
const CHECK_STEP = storyWorkCoordinationStepId("coord-step-check-postgres");
const SCENE_ASSIGNMENT = storyWorkAssignmentId("assignment-coordination-scene-postgres");
const CHECK_ASSIGNMENT = storyWorkAssignmentId("assignment-coordination-check-postgres");
const RUN_ID = agentRunId("run-coordination-scene-postgres");
const RECEIPT_ID = contextReceiptId("receipt-coordination-scene-postgres");
const NOW = "2026-09-13T12:00:00.000Z";
const REQUEST = instructionContentHash("a".repeat(64));

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

function fingerprint(hexSeed: "a" | "b" | "c" | "d" | "e" | "f") {
  return instructionContentHash(hexSeed.repeat(64));
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

async function expectForeignKeyViolation(promise: Promise<unknown>) {
  await expect(promise).rejects.toSatisfy((error) => isForeignKeyViolation(error));
}

function artifact(hashCharacter: string): StoryWorkArtifactPointer {
  return {
    proposalId: agentProposalId("proposal-coordination-postgres"),
    artifactVersion: 1,
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
    brief: "Draft the scene.",
    constraints: "Stay grounded.",
    doneWhen: "Draft ready.",
    sources: [
      {
        kind: "project",
        projectId: PROJECT,
        projectVersion: BELLWETHER_FIXTURE.project.version
      },
      {
        kind: "scene",
        sceneId: SCENE_TARGET,
        projectVersion: BELLWETHER_FIXTURE.project.version
      }
    ],
    destination: { kind: "scene", sceneId: SCENE_TARGET, operation: "create" },
    provider: "openai",
    model: "gpt-4.1" as AgentModelId,
    status: "brief-ready",
    steps: [{ id: "draft", title: "Draft", dependencies: [] }],
    results: [],
    idempotencyKey: "assignment-coordination-scene-postgres",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  });
}

function checkAssignment(pointer: StoryWorkArtifactPointer): StoryWorkAssignment {
  return createStoryWorkAssignment({
    id: CHECK_ASSIGNMENT,
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "check",
    brief: "Check continuity.",
    constraints: "Use supplied context.",
    doneWhen: "Findings ready.",
    sources: [
      {
        kind: "proposal-artifact",
        assignmentId: SCENE_ASSIGNMENT,
        proposalId: pointer.proposalId,
        sceneId: SCENE_TARGET,
        artifactVersion: pointer.artifactVersion,
        contentHash: pointer.contentHash
      }
    ],
    destination: { kind: "scene", sceneId: SCENE_TARGET, operation: "assess" },
    provider: "openai",
    model: "gpt-4.1" as AgentModelId,
    status: "brief-ready",
    steps: [{ id: "check", title: "Check", dependencies: [] }],
    results: [],
    idempotencyKey: "assignment-coordination-check-postgres",
    createdAt: "2026-09-13T12:10:00.000Z",
    updatedAt: "2026-09-13T12:10:00.000Z"
  });
}

function coordination(index = 1): StoryWorkCoordination {
  return createStoryWorkCoordination({
    id: storyWorkCoordinationId(`coordination-postgres-${index}`),
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 1,
    title: `Coordination ${index}`,
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
          brief: "Check continuity.",
          constraints: "Use supplied context.",
          doneWhen: "Findings ready.",
          model: "gpt-4.1" as AgentModelId,
          surroundingSceneIds: [CONTEXT_SCENE]
        }
      }
    ],
    idempotencyKey: `coordination-create-postgres-${index}`,
    createdAt: new Date(Date.UTC(2026, 8, 13, 12, 0, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 8, 13, 12, 0, index)).toISOString()
  });
}

async function setup(options: Readonly<{ seedSceneAssignment?: boolean }> = {}) {
  const { db, client, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values([
    {
      id: OWNER,
      name: "Coordination Owner",
      email: "coordination-owner@example.test",
      emailVerified: true
    },
    {
      id: FOREIGN,
      name: "Coordination Foreign",
      email: "coordination-foreign@example.test",
      emailVerified: true
    }
  ]);
  const exec = toRepositoryDatabase(db);
  const projectsRepo = createPostgresProjectRepository(exec);
  await seedProject(projectsRepo, BELLWETHER_FIXTURE);
  await projectsRepo.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: PROJECT,
        accountId: OWNER,
        role: "owner",
        createdAt: NOW
      })
    );
  });
  const receipts = createPostgresContextReceiptRepository(exec);
  expect(
    await receipts.insertImmutable({
      id: RECEIPT_ID,
      projectId: PROJECT,
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
      receiptHash: fingerprint("c"),
      createdAt: NOW
    })
  ).toMatchObject({ ok: true });
  const runs = createPostgresAgentRunRepository(exec);
  expect(
    await runs.create(
      createQueuedAgentRun({
        id: RUN_ID,
        projectId: PROJECT,
        initiatorAccountId: OWNER,
        workflowId: "scene-partner.capture-reflection",
        workflowVersion: "1.0.0",
        provider: "openai",
        model: "gpt-4.1",
        receiptId: RECEIPT_ID,
        receiptHash: fingerprint("c"),
        status: "queued",
        createdAt: NOW,
        updatedAt: NOW
      })
    )
  ).toMatchObject({ ok: true });
  const assignments = createPostgresStoryWorkAssignmentRepository(exec);
  if (options.seedSceneAssignment !== false) {
    expect(
      await assignments.create({
        assignment: sceneAssignment(),
        requestFingerprint: fingerprint("d")
      })
    ).toMatchObject({ ok: true });
  }
  return {
    db,
    client,
    exec,
    coordinations: createPostgresStoryWorkCoordinationRepository(exec),
    assignments
  };
}

async function promoteSceneAssignment(
  assignments: ReturnType<typeof createPostgresStoryWorkAssignmentRepository>,
  hashSeed: "a" | "b" = "a"
) {
  const current = await assignments.get({
    accountId: OWNER,
    projectId: PROJECT,
    assignmentId: SCENE_ASSIGNMENT
  });
  expect(current).toBeDefined();
  const running = startStoryWorkAttempt({
    assignment: current!,
    expectedVersion: 1,
    runId: RUN_ID,
    updatedAt: "2026-09-13T12:01:00.000Z"
  });
  expect(
    await assignments.compareAndSet({
      accountId: OWNER,
      projectId: PROJECT,
      assignmentId: SCENE_ASSIGNMENT,
      expectedVersion: 1,
      next: running
    })
  ).toMatchObject({ ok: true });
  const ready = attachGeneratedStoryWorkArtifact({
    assignment: running,
    expectedVersion: 2,
    runId: RUN_ID,
    artifact: artifact(hashSeed),
    updatedAt: "2026-09-13T12:02:00.000Z"
  });
  expect(
    await assignments.compareAndSet({
      accountId: OWNER,
      projectId: PROJECT,
      assignmentId: SCENE_ASSIGNMENT,
      expectedVersion: 2,
      next: ready
    })
  ).toMatchObject({ ok: true });
  return ready;
}

describe("postgres story work coordination repository", () => {
  it("applies migration 0029 from an empty compatible base", async () => {
    const fresh = createPgliteDatabase();
    closers.push(fresh.close);
    await migratePgliteRepositoryDatabase(fresh.db);
    const tables = await fresh.client.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'story_work_coordinations',
          'story_work_coordination_step_bindings'
        )
      order by table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "story_work_coordination_step_bindings",
      "story_work_coordinations"
    ]);
    const cascade = await fresh.client.query<{ delete_rule: string }>(`
      select rc.delete_rule
      from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = rc.constraint_name
      where kcu.table_name = 'story_work_coordinations'
        and kcu.column_name = 'project_id'
      limit 1
    `);
    expect(cascade.rows[0]?.delete_rule).toBe("CASCADE");
  });

  it("creates, gets, lists, and idempotently replays coordinations", async () => {
    const { coordinations } = await setup();
    const original = coordination(1);
    await expect(
      coordinations.create({
        coordination: original,
        requestFingerprint: REQUEST
      })
    ).resolves.toMatchObject({ ok: true, created: true });
    await expect(
      coordinations.get({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: original.id
      })
    ).resolves.toEqual(original);
    await expect(
      coordinations.create({
        coordination: createStoryWorkCoordination({
          ...original,
          id: storyWorkCoordinationId("coordination-postgres-replay")
        }),
        requestFingerprint: REQUEST
      })
    ).resolves.toMatchObject({ ok: true, created: false, coordination: { id: original.id } });
    await expect(
      coordinations.create({
        coordination: original,
        requestFingerprint: fingerprint("b")
      })
    ).resolves.toEqual({ ok: false, reason: "idempotency-conflict" });
    await expect(
      coordinations.create({
        coordination: createStoryWorkCoordination({
          ...original,
          idempotencyKey: "coordination-create-postgres-duplicate-id"
        }),
        requestFingerprint: fingerprint("e")
      })
    ).resolves.toEqual({ ok: false, reason: "duplicate-id" });
    await coordinations.create({
      coordination: coordination(2),
      requestFingerprint: fingerprint("f")
    });
    const listed = await coordinations.listByProject({
      accountId: OWNER,
      projectId: PROJECT,
      options: { limit: 1 }
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(storyWorkCoordinationId("coordination-postgres-2"));
  });

  it("requires root assignment foreign keys", async () => {
    const { coordinations } = await setup({ seedSceneAssignment: false });
    await expectForeignKeyViolation(
      coordinations.create({
        coordination: coordination(3),
        requestFingerprint: fingerprint("a")
      })
    );
  });

  it("rolls back coordination create when root binding insert fails", async () => {
    const { client, coordinations, exec } = await setup();
    await client.exec(`
      create function fail_root_binding() returns trigger as $$
      begin
        raise exception 'injected root binding failure';
      end;
      $$ language plpgsql;
      create trigger fail_root_binding_trigger
      before insert on story_work_coordination_step_bindings
      for each row execute function fail_root_binding();
    `);
    const rollbackId = storyWorkCoordinationId("coordination-postgres-rollback");
    await expect(
      coordinations.create({
        coordination: createStoryWorkCoordination({
          ...coordination(4),
          id: rollbackId,
          idempotencyKey: "coordination-create-postgres-rollback"
        }),
        requestFingerprint: fingerprint("b")
      })
    ).rejects.toSatisfy((error) => {
      const parts: string[] = [];
      let current: unknown = error;
      for (let depth = 0; depth < 6; depth += 1) {
        if (current instanceof Error) {
          parts.push(current.message);
        }
        current =
          typeof current === "object" && current !== null && "cause" in current
            ? (current as { cause: unknown }).cause
            : undefined;
        if (current === undefined) break;
      }
      return parts.some((message) => /injected root binding failure/i.test(message));
    });
    expect(
      await exec
        .select({ id: storyWorkCoordinations.id })
        .from(storyWorkCoordinations)
        .where(sql`${storyWorkCoordinations.id} = ${rollbackId}`)
    ).toEqual([]);
  });

  it("compare-and-set binds deferred steps, cancels, and refuses stale or foreign scopes", async () => {
    const { coordinations, assignments } = await setup();
    const original = coordination(5);
    await coordinations.create({
      coordination: original,
      requestFingerprint: fingerprint("c")
    });
    const pointer = artifact("a");
    const readyAssignment = await promoteSceneAssignment(assignments);
    await assignments.create({
      assignment: checkAssignment(pointer),
      requestFingerprint: fingerprint("d")
    });
    const bound = bindProposalContinuityCheckStep({
      coordination: original,
      expectedVersion: 1,
      stepId: CHECK_STEP,
      binding: {
        assignmentId: CHECK_ASSIGNMENT,
        resolvedDependency: { stepId: SCENE_STEP, artifact: pointer },
        boundAt: "2026-09-13T12:05:00.000Z"
      },
      childAssignments: new Map([
        [readyAssignment.id, readyAssignment],
        [checkAssignment(pointer).id, checkAssignment(pointer)]
      ]),
      updatedAt: "2026-09-13T12:05:00.000Z"
    });
    await expect(
      coordinations.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: original.id,
        expectedVersion: 1,
        next: bound
      })
    ).resolves.toMatchObject({ ok: true, coordination: { version: 2 } });
    await expect(
      coordinations.get({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: original.id
      })
    ).resolves.toEqual(bound);
    await expect(
      coordinations.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: original.id,
        expectedVersion: 1,
        next: bound
      })
    ).resolves.toEqual({ ok: false, reason: "version-conflict" });
    await expect(
      coordinations.compareAndSet({
        accountId: FOREIGN,
        projectId: PROJECT,
        coordinationId: original.id,
        expectedVersion: 2,
        next: bound
      })
    ).resolves.toEqual({ ok: false, reason: "not-found" });
    const canceled = cancelStoryWorkCoordination({
      coordination: bound,
      expectedVersion: 2,
      updatedAt: "2026-09-13T12:10:00.000Z"
    });
    await expect(
      coordinations.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: original.id,
        expectedVersion: 2,
        next: canceled
      })
    ).resolves.toMatchObject({ ok: true, coordination: { status: "canceled", version: 3 } });
    await expect(
      coordinations.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: original.id,
        expectedVersion: 2,
        next: bound
      })
    ).resolves.toEqual({ ok: false, reason: "version-conflict" });
  });

  it("serializes concurrent create and compare-and-set commits", async () => {
    const { coordinations, assignments } = await setup();
    const original = coordination(6);
    const [first, second] = await Promise.all([
      coordinations.create({
        coordination: original,
        requestFingerprint: fingerprint("e")
      }),
      coordinations.create({
        coordination: original,
        requestFingerprint: fingerprint("e")
      })
    ]);
    expect([first, second].filter((outcome) => outcome.ok && outcome.created)).toHaveLength(1);
    expect([first, second].filter((outcome) => outcome.ok && !outcome.created)).toHaveLength(1);

    const pointer = artifact("b");
    const readyAssignment = await promoteSceneAssignment(assignments, "b");
    await assignments.create({
      assignment: checkAssignment(pointer),
      requestFingerprint: fingerprint("f")
    });
    const created = coordination(7);
    await coordinations.create({
      coordination: created,
      requestFingerprint: fingerprint("a")
    });
    const bound = bindProposalContinuityCheckStep({
      coordination: created,
      expectedVersion: 1,
      stepId: CHECK_STEP,
      binding: {
        assignmentId: CHECK_ASSIGNMENT,
        resolvedDependency: { stepId: SCENE_STEP, artifact: pointer },
        boundAt: "2026-09-13T12:06:00.000Z"
      },
      childAssignments: new Map([
        [readyAssignment.id, readyAssignment],
        [checkAssignment(pointer).id, checkAssignment(pointer)]
      ]),
      updatedAt: "2026-09-13T12:06:00.000Z"
    });
    const [casFirst, casSecond] = await Promise.all([
      coordinations.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: created.id,
        expectedVersion: 1,
        next: bound
      }),
      coordinations.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: created.id,
        expectedVersion: 1,
        next: bound
      })
    ]);
    expect([casFirst, casSecond].filter((outcome) => outcome.ok)).toHaveLength(1);
    expect([casFirst, casSecond].filter((outcome) => !outcome.ok)).toHaveLength(1);
  });

  it("cascades coordination bindings when the coordination row is deleted", async () => {
    const { db, coordinations } = await setup();
    const original = coordination(8);
    await coordinations.create({
      coordination: original,
      requestFingerprint: fingerprint("b")
    });
    await expect(
      db.delete(storyWorkAssignments).where(sql`${storyWorkAssignments.id} = ${SCENE_ASSIGNMENT}`)
    ).rejects.toThrow();
    expect(
      await db
        .select()
        .from(storyWorkCoordinationStepBindings)
        .where(
          sql`${storyWorkCoordinationStepBindings.coordinationId} = ${original.id}`
        )
    ).toHaveLength(1);
    await db.delete(storyWorkCoordinations).where(sql`${storyWorkCoordinations.id} = ${original.id}`);
    expect(
      await db
        .select()
        .from(storyWorkCoordinationStepBindings)
        .where(
          sql`${storyWorkCoordinationStepBindings.coordinationId} = ${original.id}`
        )
    ).toEqual([]);
  });

  it("hides foreign account and project scopes on reads", async () => {
    const { coordinations } = await setup();
    const original = coordination(9);
    await coordinations.create({
      coordination: original,
      requestFingerprint: fingerprint("c")
    });
    await expect(
      coordinations.get({
        accountId: FOREIGN,
        projectId: PROJECT,
        coordinationId: original.id
      })
    ).resolves.toBeUndefined();
    await expect(
      coordinations.getByIdempotencyKey({
        accountId: OWNER,
        projectId: OTHER_PROJECT,
        idempotencyKey: original.idempotencyKey
      })
    ).resolves.toBeUndefined();
  });
});

describe("postgres story work coordination MCP origin", () => {
  const GRANT_ID = mcpGrantId("mcp-grant-coordination-origin-postgres");
  const ORIGIN = Object.freeze({ kind: "mcp" as const, grantId: GRANT_ID });
  const OTHER_GRANT = mcpGrantId("mcp-grant-coordination-origin-other");

  async function setupWithGrant() {
    const context = await setup({ seedSceneAssignment: true });
    const grants = createPostgresMcpGrantRepository(toRepositoryDatabase(context.db));
    expect(
      await grants.insert(
        createMcpGrantRecord({
          id: GRANT_ID,
          accountId: OWNER,
          projectId: PROJECT,
          captureIds: [],
          sceneIds: [SCENE_TARGET],
          bookIds: [],
          assignmentIds: [],
          coordinationIds: [],
          tools: [
            "ghostwriter_get_grant",
            "ghostwriter_create_story_work_coordination"
          ],
          allowProjectStructureRead: true,
          tokenHash: mcpGrantTokenHash("7".repeat(64)),
          tokenHint: "…cord",
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
          projectId: PROJECT,
          captureIds: [],
          sceneIds: [SCENE_TARGET],
          bookIds: [],
          assignmentIds: [],
          coordinationIds: [],
          tools: ["ghostwriter_get_grant"],
          allowProjectStructureRead: true,
          tokenHash: mcpGrantTokenHash("6".repeat(64)),
          tokenHint: "…ther",
          expiresAt: "2026-08-01T00:00:00.000Z",
          createdAt: NOW,
          updatedAt: NOW
        })
      )
    ).toMatchObject({ ok: true });
    return { ...context, grants };
  }

  function originCoordination(index = 50): StoryWorkCoordination {
    return createStoryWorkCoordination({
      ...coordination(index),
      origin: ORIGIN,
      steps: [
        {
          kind: "scene-draft",
          stepId: SCENE_STEP,
          title: "Draft scene",
          assignmentId: SCENE_ASSIGNMENT
        },
        coordination(index).steps[1]!
      ]
    });
  }

  it("roundtrips MCP origin and preserves it on idempotent replay", async () => {
    const { coordinations } = await setupWithGrant();
    const created = originCoordination();
    const requestFingerprint = storyWorkCoordinationRequestFingerprint(fingerprint("a"));
    await expect(
      coordinations.create({ coordination: created, requestFingerprint })
    ).resolves.toMatchObject({
      ok: true,
      created: true,
      coordination: { origin: ORIGIN }
    });
    await expect(
      coordinations.get({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: created.id
      })
    ).resolves.toMatchObject({ origin: ORIGIN });
    await expect(
      coordinations.create({ coordination: created, requestFingerprint })
    ).resolves.toMatchObject({
      ok: true,
      created: false,
      coordination: { origin: ORIGIN }
    });
  });

  it("rejects compare-and-set origin changes and blocks deleting referenced grants", async () => {
    const { db, coordinations, grants } = await setupWithGrant();
    const created = originCoordination(51);
    const requestFingerprint = storyWorkCoordinationRequestFingerprint(fingerprint("b"));
    await coordinations.create({ coordination: created, requestFingerprint });
    const canceled = cancelStoryWorkCoordination({
      coordination: created,
      expectedVersion: 1,
      updatedAt: "2026-09-13T12:30:00.000Z"
    });
    await expect(
      coordinations.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: created.id,
        expectedVersion: 1,
        next: canceled
      })
    ).resolves.toMatchObject({ ok: true, coordination: { origin: ORIGIN } });

    const tampered = createStoryWorkCoordination({
      ...canceled,
      version: 3,
      origin: { kind: "mcp", grantId: OTHER_GRANT },
      updatedAt: "2026-09-13T12:31:00.000Z"
    });
    await expect(
      coordinations.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: created.id,
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
        projectId: PROJECT,
        revokedAt: "2026-09-13T12:32:00.000Z",
        updatedAt: "2026-09-13T12:32:00.000Z"
      })
    ).toMatchObject({ ok: true });
    await expect(
      coordinations.get({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: created.id
      })
    ).resolves.toMatchObject({ origin: ORIGIN });
  });

  it("lists coordinations by origin grant using the origin index", async () => {
    const { coordinations } = await setupWithGrant();
    const created = originCoordination(52);
    await coordinations.create({
      coordination: created,
      requestFingerprint: storyWorkCoordinationRequestFingerprint(fingerprint("c"))
    });
    const listed = await coordinations.listByMcpGrantOrigin({
      accountId: OWNER,
      projectId: PROJECT,
      originMcpGrantId: GRANT_ID
    });
    expect(listed.map((row) => row.id)).toContain(created.id);
  });

  it("lists MCP grant origin rows without project-page truncation and empty cross-scope", async () => {
    const { coordinations } = await setupWithGrant();
    const oldOriginId = storyWorkCoordinationId("coordination-origin-postgres-old");
    await coordinations.create({
      coordination: originCoordination(53),
      requestFingerprint: storyWorkCoordinationRequestFingerprint(fingerprint("d"))
    });
    await coordinations.create({
      coordination: createStoryWorkCoordination({
        ...originCoordination(54),
        id: oldOriginId,
        idempotencyKey: "coordination-origin-postgres-old",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z"
      }),
      requestFingerprint: storyWorkCoordinationRequestFingerprint(fingerprint("e"))
    });
    for (let index = 1; index <= 150; index += 1) {
      await coordinations.create({
        coordination: coordination(index + 100),
        requestFingerprint: storyWorkCoordinationRequestFingerprint(
          fingerprint(index % 2 === 0 ? "a" : "b")
        )
      });
    }
    await coordinations.create({
      coordination: createStoryWorkCoordination({
        ...originCoordination(201),
        id: storyWorkCoordinationId("coordination-origin-postgres-foreign-account"),
        initiatorAccountId: FOREIGN,
        idempotencyKey: "coordination-origin-postgres-foreign-account"
      }),
      requestFingerprint: storyWorkCoordinationRequestFingerprint(fingerprint("d"))
    });
    await coordinations.create({
      coordination: createStoryWorkCoordination({
        ...originCoordination(202),
        id: storyWorkCoordinationId("coordination-origin-postgres-other-grant"),
        idempotencyKey: "coordination-origin-postgres-other-grant",
        origin: { kind: "mcp", grantId: OTHER_GRANT }
      }),
      requestFingerprint: storyWorkCoordinationRequestFingerprint(fingerprint("e"))
    });

    const listed = await coordinations.listByMcpGrantOrigin({
      accountId: OWNER,
      projectId: PROJECT,
      originMcpGrantId: GRANT_ID
    });
    expect(listed.map((row) => row.id)).toEqual(
      expect.arrayContaining([oldOriginId, originCoordination(53).id])
    );
    expect(listed.some((row) => row.id === oldOriginId)).toBe(true);
    expect(listed.every((row) => row.initiatorAccountId === OWNER)).toBe(true);
    expect(
      listed.some(
        (row) =>
          row.id ===
          storyWorkCoordinationId("coordination-origin-postgres-foreign-account")
      )
    ).toBe(false);
    expect(
      listed.some(
        (row) =>
          row.id === storyWorkCoordinationId("coordination-origin-postgres-other-grant")
      )
    ).toBe(false);
  });
});

describe("memory story work coordination repository regression", () => {
  it("still replays scoped idempotent creates", async () => {
    const repository = createMemoryStoryWorkCoordinationRepository();
    const original = coordination(10);
    await expect(
      repository.create({
        coordination: original,
        requestFingerprint: storyWorkCoordinationRequestFingerprint(fingerprint("d"))
      })
    ).resolves.toMatchObject({ ok: true, created: true });
    await expect(
      repository.create({
        coordination: original,
        requestFingerprint: storyWorkCoordinationRequestFingerprint(fingerprint("d"))
      })
    ).resolves.toMatchObject({ ok: true, created: false });
  });
});
