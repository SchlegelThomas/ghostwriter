import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  assembleStorySceneResource,
  assembleStoryStructureResource,
  createAgentGuidanceServices,
  createCharacterStoryWorkGenerationServices,
  createMemoryAccountAiCollaborationProfileRepository,
  createMemoryProjectAgentInstructionsRepository,
  createMemoryProjectPlaybookRepository,
  createProjectMembership,
  createSceneDocumentStateWithProse,
  createStoryWorkAssignment,
  instructionContentHash,
  storyContextFromProjectRecords,
  storyKnowledgeId,
  storyWorkAssignmentId,
  type DomainIdKind
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import { createPostgresAgentProposalRepository, createPostgresAgentRunRepository, createPostgresContextReceiptRepository } from "./postgres-agent-foundation-repository.js";
import { createPostgresCharacterStoryWorkGenerationUnitOfWork } from "./postgres-character-story-work-generation-uow.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresStoryWorkAssignmentRepository, createPostgresStoryWorkAttemptRepository } from "./postgres-story-work-repository.js";
import { seedProject } from "./seed.js";
import { user } from "./schema.js";

const OWNER = accountId("account-character-generation-postgres");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-character-generation-postgres");
const TARGET = storyKnowledgeId("knowledge-character-generation-postgres");
const SCENE = BELLWETHER_FIXTURE.scenes[0]!.id;
const CREATED_AT = "2026-09-12T20:00:00.000Z";
const hashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
});
const generatedCharacter = Object.freeze({
  schemaId: "character-create-v2" as const,
  name: "Inez Vale",
  summary: "A wary courier who knows why the harbor signals changed.",
  aliases: ["Nez"],
  characterSheet: {
    desire: "Keep her crew alive.",
    pressure: "The harbor master recognizes her route."
  },
  sourceSceneIds: [SCENE]
});
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

async function createHarness() {
  const { db, client, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: OWNER,
    name: "Character Generation Owner",
    email: "character-generation@example.test",
    emailVerified: true
  });
  const exec = toRepositoryDatabase(db);
  const projects = createPostgresProjectRepository(exec);
  await seedProject(projects, BELLWETHER_FIXTURE);
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
  const sourceDocument = await createSceneDocumentStateWithProse({
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    sceneId: SCENE,
    actorAccountId: OWNER,
    ids: {
      create(kind: DomainIdKind) {
        return `${kind}-character-generation-source`;
      }
    },
    now: CREATED_AT,
    prose: "The harbor signals changed while Inez watched from the quay."
  });
  const assignments = createPostgresStoryWorkAssignmentRepository(exec);
  const assignment = createStoryWorkAssignment({
    id: ASSIGNMENT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "character",
    brief: "  Preserve this exact character brief.  ",
    constraints: "  Use only the selected scene.  ",
    doneWhen: "  A complete Cast proposal is ready.  ",
    sources: [
      {
        kind: "scene",
        sceneId: SCENE,
        projectVersion: BELLWETHER_FIXTURE.project.version,
        workingVersion: sourceDocument.head.workingVersion,
        contentHash: sourceDocument.head.contentHash
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
    steps: [{ id: "character", title: "Develop character", dependencies: [] }],
    results: [],
    idempotencyKey: "assignment-character-generation-postgres",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  });
  expect(
    await assignments.create({
      assignment,
      requestFingerprint: instructionContentHash("a".repeat(64))
    })
  ).toMatchObject({ ok: true });

  let id = 0;
  const ids = {
    create(kind: DomainIdKind) {
      id += 1;
      return `${kind}-character-generation-postgres-${id}`;
    }
  };
  let tick = 0;
  const clock = {
    now() {
      tick += 1;
      return `2026-09-12T20:00:${String(tick).padStart(2, "0")}.000Z`;
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
  const services = createCharacterStoryWorkGenerationServices({
    projects,
    assignments,
    proposals,
    guidance,
    generation: createPostgresCharacterStoryWorkGenerationUnitOfWork(exec),
    hashPort,
    ids,
    clock
  });
  const storyContext = storyContextFromProjectRecords(BELLWETHER_FIXTURE, {
    scope: { kind: "scene", sceneId: SCENE }
  });
  const structure = await assembleStoryStructureResource({
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    context: storyContext,
    inclusionReason: "The writer selected this scene scope.",
    hashPort
  });
  const sceneResource = await assembleStorySceneResource({
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    sceneId: SCENE,
    head: sourceDocument.head,
    inclusionReason: "The writer selected this scene prose.",
    hashPort
  });
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
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedAssignmentVersion: 1,
      kind: "initial" as const,
      sourceMode: "submitted-snapshot" as const,
      instruction: assignment.brief,
      idempotencyKey: "attempt-character-generation-postgres",
      storyContext,
      resources: [structure, sceneResource]
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

describe("postgres character story work generation unit of work", () => {
  it("persists begin and completion atomically, then replays without provider spend", async () => {
    const harness = await createHarness();
    let calls = 0;
    const provider = {
      async completeStructured() {
        calls += 1;
        return {
          ok: true as const,
          output: generatedCharacter,
          providerResponseId: "response-character-generation-postgres"
        };
      }
    };
    const first = await harness.services.generate({ ...harness.request, provider });
    expect(first).toMatchObject({
      kind: "ready",
      state: {
        assignment: { status: "artifact-ready", version: 3 },
        attempt: { version: 2, resultArtifact: { artifactVersion: 1 } },
        run: { status: "ready" },
        proposal: { primaryTarget: { kind: "story-knowledge", id: TARGET } }
      }
    });
    const replay = await harness.services.generate({ ...harness.request, provider });
    expect(replay).toMatchObject({ kind: "replayed", state: { replayed: true } });
    expect(calls).toBe(1);
  });

  it("rolls back receipt and run when atomic begin fails", async () => {
    const harness = await createHarness();
    await createFailureTrigger(
      harness.client,
      "reject_generation_begin",
      "agent_runs",
      "new.status = 'running'"
    );
    let calls = 0;
    await expect(
      harness.services.generate({
        ...harness.request,
        provider: {
          async completeStructured() {
            calls += 1;
            return { ok: true as const, output: generatedCharacter };
          }
        }
      })
    ).rejects.toBeDefined();
    expect(calls).toBe(0);
    await expect(harness.receipts.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)).resolves.toEqual([]);
    await expect(harness.runs.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)).resolves.toEqual([]);
    await expect(
      harness.assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID
      })
    ).resolves.toMatchObject({ status: "brief-ready", version: 1 });
  });

  it("rolls back proposal, attempt, and run completion when assignment completion fails", async () => {
    const harness = await createHarness();
    await createFailureTrigger(
      harness.client,
      "reject_generation_completion",
      "story_work_assignments",
      "new.status = 'artifact-ready'"
    );
    await expect(
      harness.services.generate({
        ...harness.request,
        provider: {
          async completeStructured() {
            return { ok: true as const, output: generatedCharacter };
          }
        }
      })
    ).rejects.toBeDefined();
    await expect(harness.proposals.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)).resolves.toEqual([]);
    await expect(harness.runs.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)).resolves.toMatchObject([
      { status: "running" }
    ]);
    await expect(
      harness.attempts.listByAssignment({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID
      })
    ).resolves.toMatchObject([{ version: 1 }]);
  });

  it("rolls a terminal run back when failure assignment persistence fails", async () => {
    const harness = await createHarness();
    await createFailureTrigger(
      harness.client,
      "reject_generation_failure",
      "story_work_assignments",
      "new.status = 'failed'"
    );
    await expect(
      harness.services.generate({
        ...harness.request,
        provider: {
          async completeStructured() {
            return {
              ok: false as const,
              diagnostic: { code: "timeout" as const, retryable: true }
            };
          }
        }
      })
    ).rejects.toBeDefined();
    await expect(harness.runs.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)).resolves.toMatchObject([
      { status: "running" }
    ]);
    await expect(
      harness.assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID
      })
    ).resolves.toMatchObject({ status: "running", version: 2 });
  });
});
