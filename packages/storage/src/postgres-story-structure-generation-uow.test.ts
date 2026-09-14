import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  accountId,
  assembleStoryStructureResource,
  bookId,
  characterStoryWorkAttemptRequestFingerprint,
  createAgentGuidanceServices,
  createMemoryAccountAiCollaborationProfileRepository,
  createMemoryProjectAgentInstructionsRepository,
  createMemoryProjectPlaybookRepository,
  createProjectMembership,
  createStoryStructureGenerationServices,
  createStoryWorkAssignment,
  defineProjectRecords,
  instructionContentHash,
  projectId,
  sceneStoryWorkAttemptRequestFingerprint,
  storyContextFromProjectRecords,
  storyStructureAttemptRequestFingerprint,
  storyStructureLoweringContextFromBook,
  storyWorkAssignmentId,
  StoryWorkAssignmentNotFoundError,
  STORY_CHECK_CANDIDATES_SCHEMA_ID,
  STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
  STORY_STRUCTURE_SCHEMA_ID,
  type DomainIdKind
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import {
  createPostgresAgentProposalRepository,
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPostgresStoryStructureGenerationUnitOfWork } from "./postgres-story-structure-generation-uow.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import {
  createPostgresStoryWorkAssignmentRepository,
  createPostgresStoryWorkAttemptRepository
} from "./postgres-story-work-repository.js";
import { seedProject } from "./seed.js";
import { user } from "./schema.js";

const PROJECT = projectId("project-structure-generation-postgres");
const OWNER = accountId("account-structure-generation-postgres");
const STRANGER = accountId("account-structure-generation-postgres-stranger");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-structure-generation-postgres");
const BOOK = bookId("book-structure-generation-postgres");
const CREATED_AT = "2026-09-13T21:00:00.000Z";
const hashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
});
const closers: Array<() => Promise<void>> = [];

function threeChapterCandidate() {
  return Object.freeze({
    schemaId: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
    newParts: [{ localKey: "part-a", title: "Act One" }],
    newChapters: [
      {
        localKey: "ch-1",
        part: { kind: "new" as const, localKey: "part-a" },
        title: "Chapter One",
        objective: "Introduce the world"
      },
      {
        localKey: "ch-2",
        part: { kind: "new" as const, localKey: "part-a" },
        title: "Chapter Two"
      },
      {
        localKey: "ch-3",
        part: { kind: "new" as const, localKey: "part-a" },
        title: "Chapter Three"
      }
    ],
    newPlannedScenes: [
      {
        localKey: "sc-1",
        host: { kind: "newChapter" as const, localKey: "ch-1" },
        title: "Opening"
      },
      {
        localKey: "sc-2",
        host: { kind: "newChapter" as const, localKey: "ch-2" },
        title: "Middle"
      },
      {
        localKey: "sc-3",
        host: { kind: "newChapter" as const, localKey: "ch-3" },
        title: "Turn",
        intent: { purpose: "Raise the stakes" }
      }
    ],
    existingChapterUpdates: [],
    chapterReorders: [
      {
        part: { kind: "new" as const, localKey: "part-a" },
        order: [
          { kind: "new" as const, localKey: "ch-1" },
          { kind: "new" as const, localKey: "ch-2" },
          { kind: "new" as const, localKey: "ch-3" }
        ]
      }
    ],
    existingSceneMoves: [],
    existingSceneArchiveChanges: [],
    existingSceneIntentUpdates: []
  });
}

const STRUCTURE_PROJECT = defineProjectRecords({
  project: {
    id: PROJECT,
    title: "Structure generation postgres",
    bookIds: [BOOK],
    version: 7,
    createdAt: CREATED_AT
  },
  books: [
    {
      id: BOOK,
      projectId: PROJECT,
      title: "Novel",
      status: "drafting",
      manuscript: { parts: [], unassignedSceneIds: [] },
      createdAt: CREATED_AT
    }
  ],
  scenes: [],
  storyKnowledge: [],
  editions: []
});

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

async function createHarness() {
  const { db, client, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: OWNER,
    name: "Structure Generation Owner",
    email: "structure-generation-postgres@example.test",
    emailVerified: true
  });
  const exec = toRepositoryDatabase(db);
  const projects = createPostgresProjectRepository(exec);
  await seedProject(projects, STRUCTURE_PROJECT);
  await projects.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: PROJECT,
        accountId: OWNER,
        role: "owner",
        createdAt: CREATED_AT
      })
    );
  });

  const assignments = createPostgresStoryWorkAssignmentRepository(exec);
  const assignment = createStoryWorkAssignment({
    id: ASSIGNMENT_ID,
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "outline",
    brief: "  Develop a three-chapter outline for the active book.  ",
    constraints: "  Respect existing canon.  ",
    doneWhen: "  Structure is ready for writer review.  ",
    sources: [{ kind: "book", bookId: BOOK, projectVersion: 7 }],
    destination: { kind: "book", bookId: BOOK, operation: "update" },
    provider: "openai",
    model: "gpt-4.1",
    status: "brief-ready",
    steps: [{ id: "structure", title: "Propose structure", dependencies: [] }],
    results: [],
    idempotencyKey: "submit-structure-generation-postgres",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  });
  expect(
    await assignments.create({
      assignment,
      requestFingerprint: instructionContentHash("c".repeat(64))
    })
  ).toMatchObject({ ok: true });

  let id = 0;
  const ids = {
    create(kind: DomainIdKind) {
      id += 1;
      return `${kind}-structure-generation-postgres-${id}`;
    }
  };
  let tick = 0;
  const clock = {
    now() {
      tick += 1;
      return `2026-09-13T21:00:${String(tick).padStart(2, "0")}.000Z`;
    }
  };
  const guidance = createAgentGuidanceServices({
    projects,
    collaborationProfiles: createMemoryAccountAiCollaborationProfileRepository(),
    projectInstructions: createMemoryProjectAgentInstructionsRepository(),
    playbooks: createMemoryProjectPlaybookRepository(),
    hashPort,
    ids,
    clock
  });
  const proposals = createPostgresAgentProposalRepository(exec);
  const runs = createPostgresAgentRunRepository(exec);
  const attempts = createPostgresStoryWorkAttemptRepository(exec);
  const receipts = createPostgresContextReceiptRepository(exec);
  const services = createStoryStructureGenerationServices({
    projects,
    assignments,
    proposals,
    guidance,
    generation: createPostgresStoryStructureGenerationUnitOfWork(exec),
    hashPort,
    ids,
    clock
  });
  const storyContext = storyContextFromProjectRecords(STRUCTURE_PROJECT, {
    scope: { kind: "project" }
  });
  const structure = await assembleStoryStructureResource({
    projectId: PROJECT,
    context: storyContext,
    inclusionReason: "selected-structure",
    hashPort
  });
  const trustedLoweringContext = storyStructureLoweringContextFromBook(
    PROJECT,
    STRUCTURE_PROJECT.books[0]!,
    []
  );
  return {
    client,
    assignments,
    attempts,
    receipts,
    runs,
    proposals,
    services,
    assignment,
    request: {
      accountId: OWNER,
      projectId: PROJECT,
      assignmentId: assignment.id,
      expectedAssignmentVersion: assignment.version,
      kind: "initial" as const,
      sourceMode: "submitted-snapshot" as const,
      instruction: assignment.brief,
      idempotencyKey: "attempt-structure-generation-postgres",
      projectRecords: STRUCTURE_PROJECT,
      storyContext,
      resources: Object.freeze([structure]),
      trustedLoweringContext
    }
  };
}

async function createFailureTrigger(
  client: Awaited<ReturnType<typeof createHarness>>["client"],
  name: string,
  table: "agent_runs" | "story_work_assignments",
  condition: string
) {
  await client.exec(`
    create function ${name}() returns trigger as $$
    begin
      if ${condition} then raise exception 'injected generation persistence failure'; end if;
      return new;
    end;
    $$ language plpgsql;
    create trigger ${name}_trigger before update on ${table}
    for each row execute function ${name}();
  `);
}

function successProvider(output: unknown = threeChapterCandidate()) {
  return {
    async completeStructured() {
      return { ok: true as const, output, providerResponseId: "provider-structure-generation-postgres" };
    }
  };
}

describe("postgres story structure generation unit of work", () => {
  it("persists begin and completion atomically with receipt roundtrip, then replays without provider spend", async () => {
    const harness = await createHarness();
    let calls = 0;
    const provider = {
      async completeStructured() {
        calls += 1;
        return {
          ok: true as const,
          output: threeChapterCandidate(),
          providerResponseId: "provider-structure-generation-postgres"
        };
      }
    };
    const first = await harness.services.generate({ ...harness.request, provider });
    expect(first).toMatchObject({
      kind: "ready",
      state: {
        assignment: { status: "artifact-ready", version: 3 },
        run: { workflowId: "story-work.structure", status: "ready" },
        proposal: {
          outputSchemaId: STORY_STRUCTURE_SCHEMA_ID,
          primaryTarget: { kind: "book", id: BOOK }
        }
      }
    });
    if (first.kind !== "ready") throw new Error("Expected ready structure result.");
    const stored = await harness.receipts.listByProject(PROJECT);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.receiptHash).toBeDefined();
    expect(stored[0]?.resources).toHaveLength(1);
    const replay = await harness.services.generate({ ...harness.request, provider });
    expect(replay).toMatchObject({ kind: "replayed", state: { replayed: true } });
    expect(calls).toBe(1);
    expect(await harness.receipts.listByProject(PROJECT)).toHaveLength(1);
  });

  it("serializes concurrent begins so only one provider call runs", async () => {
    const harness = await createHarness();
    let calls = 0;
    const provider = {
      async completeStructured() {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          ok: true as const,
          output: threeChapterCandidate(),
          providerResponseId: "provider-structure-generation-postgres-concurrent"
        };
      }
    };
    const attempts = await Promise.allSettled([
      harness.services.generate({ ...harness.request, provider }),
      harness.services.generate({ ...harness.request, provider })
    ]);
    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);
    expect(calls).toBe(1);
    const kinds = fulfilled.map(
      (attempt) => (attempt as PromiseFulfilledResult<{ kind: string }>).value.kind
    );
    expect(kinds).toContain("ready");
    expect(kinds).toContain("replayed");
  });

  it("records malformed provider output as a terminal failure without proposals", async () => {
    const harness = await createHarness();
    const result = await harness.services.generate({
      ...harness.request,
      provider: {
        async completeStructured() {
          return {
            ok: false as const,
            diagnostic: { code: "invalid_structured_output" as const, retryable: false }
          };
        }
      }
    });
    expect(result).toMatchObject({
      kind: "failed",
      state: {
        run: { status: "failed", terminalDiagnosticCode: "provider-malformed-output" },
        assignment: { status: "failed", version: 3 }
      }
    });
    await expect(harness.proposals.listByProject(PROJECT)).resolves.toEqual([]);
  });

  it("rolls back proposal completion when assignment completion fails", async () => {
    const harness = await createHarness();
    await createFailureTrigger(
      harness.client,
      "reject_structure_generation_completion",
      "story_work_assignments",
      "new.status = 'artifact-ready'"
    );
    await expect(
      harness.services.generate({ ...harness.request, provider: successProvider() })
    ).rejects.toBeDefined();
    await expect(harness.proposals.listByProject(PROJECT)).resolves.toEqual([]);
    await expect(harness.runs.listByProject(PROJECT)).resolves.toMatchObject([
      { status: "running" }
    ]);
    await expect(
      harness.attempts.listByAssignment({
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ASSIGNMENT_ID
      })
    ).resolves.toMatchObject([{ version: 1 }]);
  });

  it("refuses foreign assignments before provider work", async () => {
    const harness = await createHarness();
    let calls = 0;
    await expect(
      harness.services.generate({
        ...harness.request,
        accountId: STRANGER,
        provider: {
          async completeStructured() {
            calls += 1;
            return { ok: true as const, output: threeChapterCandidate() };
          }
        }
      })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentNotFoundError);
    expect(calls).toBe(0);
  });
});

describe("story work generation regression", () => {
  it("still fingerprints scene, check, and structure generation requests independently", async () => {
    const storyContext = storyContextFromProjectRecords(STRUCTURE_PROJECT, {
      scope: { kind: "project" }
    });
    const structure = await assembleStoryStructureResource({
      projectId: PROJECT,
      context: storyContext,
      inclusionReason: "selected-structure",
      hashPort
    });
    const structureFingerprint = await storyStructureAttemptRequestFingerprint(
      {
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ASSIGNMENT_ID,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "structure",
        projectRecords: STRUCTURE_PROJECT,
        storyContext,
        resources: Object.freeze([structure]),
        trustedLoweringContext: storyStructureLoweringContextFromBook(
          PROJECT,
          STRUCTURE_PROJECT.books[0]!,
          []
        ),
        targetBookId: BOOK
      },
      hashPort
    );
    const sceneFingerprint = await sceneStoryWorkAttemptRequestFingerprint(
      {
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ASSIGNMENT_ID,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "scene"
      },
      hashPort
    );
    const characterFingerprint = await characterStoryWorkAttemptRequestFingerprint(
      {
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ASSIGNMENT_ID,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "character"
      },
      hashPort
    );
    expect(structureFingerprint).not.toEqual(sceneFingerprint);
    expect(structureFingerprint).not.toEqual(characterFingerprint);
    expect(sceneFingerprint).not.toEqual(characterFingerprint);
    expect(STORY_CHECK_CANDIDATES_SCHEMA_ID).not.toEqual(STORY_STRUCTURE_CANDIDATES_SCHEMA_ID);
  });
});
