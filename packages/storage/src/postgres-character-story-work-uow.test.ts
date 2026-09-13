import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  CHARACTER_STORY_WORK_WORKFLOW_ID,
  StoryWorkAssignmentNotFoundError,
  accountId,
  agentProposalId,
  agentRunId,
  assembleStorySceneResource,
  assembleStoryStructureResource,
  contextReceiptId,
  createAgentRun,
  createInitialSceneDocumentState,
  createProjectMembership,
  createQueuedAgentRun,
  createReadyAgentProposal,
  createStoryWorkAssignment,
  createStoryWorkAttempt,
  instructionContentHash,
  storyContextFromProjectRecords,
  storyKnowledgeId,
  storyWorkAssignmentId,
  type ContextReceipt
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import {
  createPostgresAgentProposalRepository,
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPostgresCharacterStoryWorkReviewUnitOfWork } from "./postgres-character-story-work-review-uow.js";
import { createPostgresCharacterStoryWorkApplyUnitOfWork } from "./postgres-character-story-work-uow.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresSceneDocumentRepository } from "./postgres-scene-document-repository.js";
import {
  createPostgresStoryWorkAssignmentRepository,
  createPostgresStoryWorkAttemptRepository
} from "./postgres-story-work-repository.js";
import { seedProject } from "./seed.js";
import { user } from "./schema.js";

const OWNER = accountId("account-character-story-work-postgres-owner");
const FOREIGN = accountId("account-character-story-work-postgres-foreign");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-character-story-work-postgres");
const RUN_ID = agentRunId("run-character-story-work-postgres");
const PROPOSAL_ID = agentProposalId("proposal-character-story-work-postgres");
const EDITED_PROPOSAL_ID = agentProposalId("proposal-character-story-work-postgres-edited");
const RECEIPT_ID = contextReceiptId("receipt-character-story-work-postgres");
const DESTINATION_ID = storyKnowledgeId("knowledge-character-story-work-postgres");
const CONTENT_HASH = instructionContentHash("a".repeat(64));
const RECEIPT_HASH = instructionContentHash("b".repeat(64));
const SCENE_ID = BELLWETHER_FIXTURE.scenes[0]!.id;
const CREATED_AT = "2026-09-12T19:00:00.000Z";
const APPLIED_AT = "2026-09-12T19:05:00.000Z";
const hashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
});
const characterPayload = Object.freeze({
  schemaId: "character-create-v2" as const,
  name: "Inez Vale",
  summary: "A patient radio engineer who distrusts convenient signals.",
  aliases: ["Nez", "The night operator"],
  characterSheet: {
    desire: "Prove the signal has a human source.",
    pressure: "Her brother vanished following the same frequency.",
    voiceNotes: "Precise, restrained, and dryly funny."
  },
  sourceSceneIds: [SCENE_ID]
});

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

type HarnessOptions = Readonly<{
  staleSceneReceipt?: boolean;
}>;

async function createHarness(options: HarnessOptions = {}) {
  const { db, client, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values([
    {
      id: OWNER,
      name: "Character Story Work Owner",
      email: "character-story-work-owner@example.test",
      emailVerified: true
    },
    {
      id: FOREIGN,
      name: "Character Story Work Foreign",
      email: "character-story-work-foreign@example.test",
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
        createdAt: CREATED_AT
      })
    );
  });
  const sceneDocuments = createPostgresSceneDocumentRepository(exec);
  const initialScene = await createInitialSceneDocumentState({
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    sceneId: SCENE_ID,
    actorAccountId: OWNER,
    ids: { create: (kind) => `${kind}-character-story-work-postgres` },
    now: CREATED_AT
  });
  await sceneDocuments.initialize(initialScene);

  const generatedArtifact = Object.freeze({
    proposalId: PROPOSAL_ID,
    artifactVersion: 1,
    contentHash: CONTENT_HASH
  });
  const assignment = createStoryWorkAssignment({
    id: ASSIGNMENT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    initiatorAccountId: OWNER,
    version: 4,
    taskKind: "character",
    brief: "Create a complete dossier for Inez Vale.",
    constraints: "Keep every claim grounded in the selected scene.",
    doneWhen: "A reviewable Cast record is ready.",
    sources: [
      {
        kind: "scene",
        sceneId: SCENE_ID,
        projectVersion: BELLWETHER_FIXTURE.project.version
      }
    ],
    destination: {
      kind: "story-knowledge",
      storyKnowledgeId: DESTINATION_ID,
      operation: "create"
    },
    provider: "openai",
    model: "gpt-4.1",
    status: "awaiting-review",
    steps: [{ id: "draft-dossier", title: "Draft dossier", dependencies: [] }],
    generatedArtifact,
    currentArtifact: generatedArtifact,
    results: [],
    idempotencyKey: "assignment-character-story-work-postgres-key",
    createdAt: CREATED_AT,
    updatedAt: "2026-09-12T19:04:00.000Z"
  });
  const assignments = createPostgresStoryWorkAssignmentRepository(exec);
  expect(
    await assignments.create({
      assignment,
      requestFingerprint: instructionContentHash("c".repeat(64))
    })
  ).toMatchObject({ ok: true });

  const receiptHead = options.staleSceneReceipt === true
    ? { ...initialScene.head, workingVersion: initialScene.head.workingVersion + 1 }
    : initialScene.head;
  const sceneResource = await assembleStorySceneResource({
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    sceneId: SCENE_ID,
    head: receiptHead,
    inclusionReason: "The writer selected this scene.",
    hashPort
  });
  const structureResource = await assembleStoryStructureResource({
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    context: storyContextFromProjectRecords(BELLWETHER_FIXTURE),
    inclusionReason: "The assignment's exact story context.",
    hashPort
  });
  const receipt: ContextReceipt = Object.freeze({
    id: RECEIPT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    workflowId: CHARACTER_STORY_WORK_WORKFLOW_ID,
    workflowVersion: "1.0.0",
    layers: [],
    resources: [structureResource.resource, sceneResource.resource],
    excludedContextClasses: [
      "publishing-profile",
      "attachments",
      "canvas",
      "manuscript",
      "credentials",
      "unrelated-project-resources"
    ] as const,
    provider: "openai",
    model: "gpt-4.1",
    maxOutputTokens: 2_000,
    wallClockSeconds: 60,
    toolCount: 0,
    egressClass: "openai-responses",
    outputSchemaId: "character-create-v2",
    targetStoryKnowledgeId: DESTINATION_ID,
    primaryTarget: { kind: "story-knowledge" as const, id: DESTINATION_ID },
    receiptHash: RECEIPT_HASH,
    createdAt: CREATED_AT
  });
  const receipts = createPostgresContextReceiptRepository(exec);
  expect(await receipts.insertImmutable(receipt)).toMatchObject({ ok: true });

  const runs = createPostgresAgentRunRepository(exec);
  const queued = createQueuedAgentRun({
    id: RUN_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    initiatorAccountId: OWNER,
    workflowId: CHARACTER_STORY_WORK_WORKFLOW_ID,
    workflowVersion: "1.0.0",
    provider: "openai",
    model: "gpt-4.1",
    receiptId: RECEIPT_ID,
    receiptHash: RECEIPT_HASH,
    status: "queued",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  });
  expect(await runs.create(queued)).toMatchObject({ ok: true });
  const running = createAgentRun({
    ...queued,
    status: "running",
    updatedAt: "2026-09-12T19:01:00.000Z"
  });
  expect(
    await runs.transition({ runId: RUN_ID, expectedStatus: "queued", next: running })
  ).toMatchObject({ ok: true });
  const ready = createAgentRun({
    ...running,
    status: "ready",
    updatedAt: "2026-09-12T19:02:00.000Z",
    completedAt: "2026-09-12T19:02:00.000Z",
    providerResponseId: "response-character-story-work-postgres",
    tokenUsage: { inputTokens: 80, outputTokens: 60, totalTokens: 140 }
  });
  expect(
    await runs.transition({ runId: RUN_ID, expectedStatus: "running", next: ready })
  ).toMatchObject({ ok: true });

  const proposals = createPostgresAgentProposalRepository(exec);
  const proposal = createReadyAgentProposal({
    id: PROPOSAL_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    runId: RUN_ID,
    receiptId: RECEIPT_ID,
    status: "ready",
    outputSchemaId: "character-create-v2",
    primaryTarget: { kind: "story-knowledge", id: DESTINATION_ID },
    payload: characterPayload,
    contentHash: CONTENT_HASH,
    createdAt: "2026-09-12T19:02:00.000Z",
    updatedAt: "2026-09-12T19:02:00.000Z"
  });
  expect(await proposals.create(proposal)).toMatchObject({ ok: true });

  const attempts = createPostgresStoryWorkAttemptRepository(exec);
  expect(
    await attempts.create({
      attempt: createStoryWorkAttempt({
        assignmentId: ASSIGNMENT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        initiatorAccountId: OWNER,
        runId: RUN_ID,
        version: 2,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: assignment.brief,
        idempotencyKey: "attempt-character-story-work-postgres-key",
        requestFingerprint: instructionContentHash("d".repeat(64)),
        resultArtifact: generatedArtifact,
        createdAt: CREATED_AT,
        completedAt: "2026-09-12T19:02:00.000Z"
      })
    })
  ).toMatchObject({ ok: true });

  const apply = createPostgresCharacterStoryWorkApplyUnitOfWork({
    db: exec,
    hashPort
  });
  const review = createPostgresCharacterStoryWorkReviewUnitOfWork({
    db: exec,
    hashPort,
    ids: { create: () => EDITED_PROPOSAL_ID }
  });
  const input = Object.freeze({
    accountId: OWNER,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    assignmentId: ASSIGNMENT_ID,
    expectedAssignmentVersion: assignment.version,
    proposalId: PROPOSAL_ID,
    expectedArtifactVersion: 1,
    expectedProposalContentHash: CONTENT_HASH,
    expectedProjectVersion: BELLWETHER_FIXTURE.project.version,
    appliedAt: APPLIED_AT
  });
  return {
    client,
    projects,
    assignments,
    proposals,
    apply,
    review,
    input,
    assignment,
    proposal
  };
}

async function expectUnchanged(harness: Awaited<ReturnType<typeof createHarness>>) {
  expect(
    (await harness.projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID))?.version
  ).toBe(BELLWETHER_FIXTURE.project.version);
  expect(
    (await harness.projects.listStoryKnowledge(BELLWETHER_FIXTURE_PROJECT_ID)).some(
      (entry) => entry.id === DESTINATION_ID
    )
  ).toBe(false);
  expect((await harness.proposals.get(PROPOSAL_ID))?.status).toBe("ready");
  expect(
    (
      await harness.assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID
      })
    )?.status
  ).toBe("awaiting-review");
}

describe("postgres character story work units of work", () => {
  it("commits the reviewed tuple once and replays the exact request", async () => {
    const harness = await createHarness();
    const first = await harness.apply.applyCharacter(harness.input);
    expect(first).toMatchObject({
      replayed: false,
      assignment: { status: "applied", version: 5 },
      proposal: { status: "applied" },
      result: {
        kind: "story-knowledge",
        storyKnowledgeId: DESTINATION_ID,
        projectVersion: BELLWETHER_FIXTURE.project.version + 1
      }
    });
    await expect(harness.apply.applyCharacter(harness.input)).resolves.toMatchObject({
      replayed: true,
      assignment: { status: "applied", version: 5 }
    });
    expect(
      (await harness.projects.listStoryKnowledge(BELLWETHER_FIXTURE_PROJECT_ID)).filter(
        (entry) => entry.id === DESTINATION_ID
      )
    ).toHaveLength(1);
  });

  it("serializes concurrent exact applies into one commit and one replay", async () => {
    const harness = await createHarness();
    const results = await Promise.all([
      harness.apply.applyCharacter(harness.input),
      harness.apply.applyCharacter(harness.input)
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
  });

  it("rejects foreign ownership and stale consumed prose without mutation", async () => {
    const foreign = await createHarness();
    await expect(
      foreign.apply.applyCharacter({ ...foreign.input, accountId: FOREIGN })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentNotFoundError);
    await expectUnchanged(foreign);

    const stale = await createHarness({ staleSceneReceipt: true });
    await expect(stale.apply.applyCharacter(stale.input)).rejects.toMatchObject({
      code: "CHARACTER_STORY_WORK_CONTEXT_STALE"
    });
    await expectUnchanged(stale);
  });

  it("rolls project and proposal writes back when the assignment CAS fails", async () => {
    const harness = await createHarness();
    await harness.client.exec(`
      create function reject_character_assignment_apply() returns trigger as $$
      begin
        if new.status = 'applied' then
          raise exception 'injected assignment persistence failure';
        end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger reject_character_assignment_apply
      before update on story_work_assignments
      for each row execute function reject_character_assignment_apply();
    `);
    await expect(harness.apply.applyCharacter(harness.input)).rejects.toBeDefined();
    await expectUnchanged(harness);
  });

  it("atomically edits a review while preserving generated lineage", async () => {
    const harness = await createHarness();
    const result = await harness.review.review({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedAssignmentVersion: harness.assignment.version,
      artifact: harness.assignment.currentArtifact!,
      action: "edit",
      payload: {
        ...characterPayload,
        summary: "A careful engineer who refuses the easiest explanation."
      },
      updatedAt: APPLIED_AT
    });
    expect(result.assignment).toMatchObject({
      version: 5,
      status: "awaiting-review",
      generatedArtifact: { proposalId: PROPOSAL_ID, artifactVersion: 1 },
      currentArtifact: { proposalId: EDITED_PROPOSAL_ID, artifactVersion: 2 }
    });
    expect(result.proposal).toMatchObject({
      id: EDITED_PROPOSAL_ID,
      status: "ready"
    });
    expect((await harness.proposals.get(PROPOSAL_ID))?.status).toBe("stale");
  });

  it("rolls edited and superseded proposals back when review assignment CAS fails", async () => {
    const harness = await createHarness();
    await harness.client.exec(`
      create function reject_character_review_assignment() returns trigger as $$
      begin
        if new.current_artifact->>'proposalId' = '${EDITED_PROPOSAL_ID}' then
          raise exception 'injected review assignment persistence failure';
        end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger reject_character_review_assignment
      before update on story_work_assignments
      for each row execute function reject_character_review_assignment();
    `);
    await expect(
      harness.review.review({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID,
        expectedAssignmentVersion: harness.assignment.version,
        artifact: harness.assignment.currentArtifact!,
        action: "edit",
        payload: {
          ...characterPayload,
          summary: "A careful engineer who refuses the easiest explanation."
        },
        updatedAt: APPLIED_AT
      })
    ).rejects.toBeDefined();
    expect(await harness.proposals.get(EDITED_PROPOSAL_ID)).toBeUndefined();
    expect(await harness.proposals.get(PROPOSAL_ID)).toMatchObject({ status: "ready" });
    expect(
      await harness.assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID
      })
    ).toMatchObject({
      version: 4,
      generatedArtifact: { proposalId: PROPOSAL_ID },
      currentArtifact: { proposalId: PROPOSAL_ID }
    });
  });
});
