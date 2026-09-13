import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  SCENE_STORY_WORK_WORKFLOW_ID,
  accountId,
  agentProposalId,
  agentRunId,
  contextReceiptId,
  createAgentRun,
  createProjectMembership,
  createQueuedAgentRun,
  createReadyAgentProposal,
  createStoryWorkAssignment,
  instructionContentHash,
  storyWorkAssignmentId,
  type ContextReceipt
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import {
  createPostgresAgentProposalRepository,
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresSceneStoryWorkReviewUnitOfWork } from "./postgres-scene-story-work-review-uow.js";
import { createPostgresStoryWorkAssignmentRepository } from "./postgres-story-work-repository.js";
import { sceneDocuments, sceneRevisions, user } from "./schema.js";
import { seedProject } from "./seed.js";

const OWNER = accountId("account-scene-review-postgres-owner");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-scene-review-postgres");
const RUN_ID = agentRunId("run-scene-review-postgres");
const PROPOSAL_ID = agentProposalId("proposal-scene-review-postgres");
const EDITED_ID = agentProposalId("proposal-scene-review-postgres-edited");
const RECEIPT_ID = contextReceiptId("receipt-scene-review-postgres");
const SOURCE_ID = BELLWETHER_FIXTURE.scenes[0]!.id;
const DESTINATION_ID = BELLWETHER_FIXTURE.scenes[1]!.id;
const CONTENT_HASH = instructionContentHash("a".repeat(64));
const RECEIPT_HASH = instructionContentHash("b".repeat(64));
const CREATED_AT = "2026-09-13T16:00:00.000Z";
const UPDATED_AT = "2026-09-13T16:05:00.000Z";
const payload = Object.freeze({
  schemaId: "scene-draft-v1" as const,
  prose: "The lantern beam crossed the wet stones.",
  sourceSceneIds: Object.freeze([SOURCE_ID])
});
const hashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
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
    name: "Scene Review Owner",
    email: "scene-review-owner@example.test",
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

  const pointer = Object.freeze({
    proposalId: PROPOSAL_ID,
    artifactVersion: 1,
    contentHash: CONTENT_HASH
  });
  const assignment = createStoryWorkAssignment({
    id: ASSIGNMENT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    initiatorAccountId: OWNER,
    version: 4,
    taskKind: "revise",
    brief: "Revise the destination scene.",
    constraints: "Retain continuity with the selected scene.",
    doneWhen: "The complete prose is ready for review.",
    sources: [
      {
        kind: "scene",
        sceneId: SOURCE_ID,
        projectVersion: BELLWETHER_FIXTURE.project.version
      }
    ],
    destination: {
      kind: "scene",
      sceneId: DESTINATION_ID,
      operation: "update"
    },
    provider: "openai",
    model: "gpt-4.1",
    status: "awaiting-review",
    steps: [{ id: "draft-scene", title: "Draft scene", dependencies: [] }],
    generatedArtifact: pointer,
    currentArtifact: pointer,
    results: [],
    idempotencyKey: "assignment-scene-review-postgres-key",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  });
  const assignments = createPostgresStoryWorkAssignmentRepository(exec);
  expect(
    await assignments.create({
      assignment,
      requestFingerprint: instructionContentHash("c".repeat(64))
    })
  ).toMatchObject({ ok: true });

  const receipt: ContextReceipt = Object.freeze({
    id: RECEIPT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    workflowId: SCENE_STORY_WORK_WORKFLOW_ID,
    workflowVersion: "1.0.0",
    layers: [],
    resources: [],
    excludedContextClasses: [],
    provider: "openai",
    model: "gpt-4.1",
    maxOutputTokens: 4_000,
    wallClockSeconds: 60,
    toolCount: 0,
    egressClass: "openai-responses",
    outputSchemaId: "scene-draft-v1",
    primaryTarget: { kind: "scene" as const, id: DESTINATION_ID },
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
    workflowId: SCENE_STORY_WORK_WORKFLOW_ID,
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
  const running = createAgentRun({ ...queued, status: "running" });
  expect(
    await runs.transition({ runId: RUN_ID, expectedStatus: "queued", next: running })
  ).toMatchObject({ ok: true });
  expect(
    await runs.transition({
      runId: RUN_ID,
      expectedStatus: "running",
      next: createAgentRun({ ...running, status: "ready", completedAt: CREATED_AT })
    })
  ).toMatchObject({ ok: true });

  const proposals = createPostgresAgentProposalRepository(exec);
  expect(
    await proposals.create(
      createReadyAgentProposal({
        id: PROPOSAL_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        runId: RUN_ID,
        receiptId: RECEIPT_ID,
        status: "ready",
        outputSchemaId: "scene-draft-v1",
        primaryTarget: { kind: "scene", id: DESTINATION_ID },
        payload,
        contentHash: CONTENT_HASH,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT
      })
    )
  ).toMatchObject({ ok: true });

  const review = createPostgresSceneStoryWorkReviewUnitOfWork({
    db: exec,
    ids: { create: () => EDITED_ID },
    hashPort
  });
  return { db, client, projects, assignments, proposals, review, assignment, pointer };
}

describe("postgres scene story work review", () => {
  it("atomically edits complete scene prose while preserving sources and generated lineage", async () => {
    const harness = await createHarness();
    const revisedPayload = Object.freeze({
      ...payload,
      prose: "The revised lantern beam crossed every wet stone."
    });
    const result = await harness.review.review({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedAssignmentVersion: harness.assignment.version,
      artifact: harness.pointer,
      action: "edit",
      payload: revisedPayload,
      updatedAt: UPDATED_AT
    });

    expect(result.assignment).toMatchObject({
      version: 5,
      status: "awaiting-review",
      generatedArtifact: { proposalId: PROPOSAL_ID, artifactVersion: 1 },
      currentArtifact: { proposalId: EDITED_ID, artifactVersion: 2 }
    });
    expect(result.proposal).toMatchObject({
      id: EDITED_ID,
      status: "ready",
      payload: revisedPayload
    });
    expect(await harness.proposals.get(PROPOSAL_ID)).toMatchObject({ status: "stale" });
    expect((await harness.projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID))?.version)
      .toBe(BELLWETHER_FIXTURE.project.version);
    expect(await harness.db.select().from(sceneDocuments)).toHaveLength(0);
    expect(await harness.db.select().from(sceneRevisions)).toHaveLength(0);
  });

  it("rejects the exact artifact idempotently without writing canonical scenes", async () => {
    const harness = await createHarness();
    const input = {
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedAssignmentVersion: harness.assignment.version,
      artifact: harness.pointer,
      action: "reject" as const,
      updatedAt: UPDATED_AT
    };
    const first = await harness.review.review(input);
    const replay = await harness.review.review(input);
    expect(first.assignment).toMatchObject({ status: "rejected", version: 5 });
    expect(replay).toEqual(first);
    expect(await harness.proposals.get(PROPOSAL_ID)).toMatchObject({ status: "rejected" });
    expect(await harness.db.select().from(sceneDocuments)).toHaveLength(0);
    expect(await harness.db.select().from(sceneRevisions)).toHaveLength(0);
  });

  it("rolls new and superseded proposals back after a late assignment write failure", async () => {
    const harness = await createHarness();
    await harness.client.exec(`
      create function reject_scene_review_assignment() returns trigger as $$
      begin
        if new.current_artifact->>'proposalId' = '${EDITED_ID}' then
          raise exception 'injected scene review assignment persistence failure';
        end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger reject_scene_review_assignment
      before update on story_work_assignments
      for each row execute function reject_scene_review_assignment();
    `);

    await expect(
      harness.review.review({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID,
        expectedAssignmentVersion: harness.assignment.version,
        artifact: harness.pointer,
        action: "edit",
        payload: { ...payload, prose: "This transaction must roll back." },
        updatedAt: UPDATED_AT
      })
    ).rejects.toBeDefined();
    expect(await harness.proposals.get(EDITED_ID)).toBeUndefined();
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
    expect(await harness.db.select().from(sceneDocuments)).toHaveLength(0);
    expect(await harness.db.select().from(sceneRevisions)).toHaveLength(0);
  });
});
