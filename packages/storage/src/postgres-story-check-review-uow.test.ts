import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  CHARACTER_STORY_WORK_WORKFLOW_ID,
  STORY_CHECK_CONTINUITY_WORKFLOW_ID,
  STORY_CHECK_SCHEMA_ID,
  StoryWorkAssignmentNotFoundError,
  accountId,
  agentProposalId,
  agentRunId,
  contextReceiptId,
  createAgentRun,
  createProjectMembership,
  createQueuedAgentRun,
  createReadyAgentProposal,
  createStoryAssessmentRevisionVector,
  createStoryWorkAssignment,
  instructionContentHash,
  sceneContentHash,
  sceneId,
  storyWorkAssignmentId,
  validateStoryCheckFindingsV1,
  type ContextReceipt,
  type StoryCheckFindingsV1,
  type StoryCheckReviewInput,
  type StoryWorkArtifactPointer,
  type StoryWorkResultReference
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import {
  createPostgresAgentProposalRepository,
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresStoryCheckReviewUnitOfWork } from "./postgres-story-check-review-uow.js";
import { createPostgresStoryWorkAssignmentRepository } from "./postgres-story-work-repository.js";
import { sceneDocuments, sceneRevisions, user } from "./schema.js";
import { seedProject } from "./seed.js";

const OWNER = accountId("account-check-review-postgres-owner");
const FOREIGN = accountId("account-check-review-postgres-foreign");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-check-review-postgres");
const RUN_ID = agentRunId("run-check-review-postgres");
const PROPOSAL_ID = agentProposalId("proposal-check-review-postgres");
const RECEIPT_ID = contextReceiptId("receipt-check-review-postgres");
const ASSESS_SCENE = sceneId("scene-check-review-postgres-target");
const CONTEXT_SCENE = BELLWETHER_FIXTURE.scenes[0]!.id;
const CONTENT_HASH = instructionContentHash("a".repeat(64));
const RECEIPT_HASH = instructionContentHash("b".repeat(64));
const SCENE_HEAD_HASH = sceneContentHash("c".repeat(64));
const CREATED_AT = "2026-09-13T16:00:00.000Z";
const UPDATED_AT = "2026-09-13T16:05:00.000Z";

const hashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
});

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

function basePayload(overrides: Record<string, unknown> = {}): StoryCheckFindingsV1 {
  return validateStoryCheckFindingsV1({
    schemaId: STORY_CHECK_SCHEMA_ID,
    specialist: "continuity",
    target: {
      mode: "applied-scene",
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: ASSESS_SCENE,
      workingVersion: 3,
      contentHash: SCENE_HEAD_HASH
    },
    findings: [
      {
        id: "finding-one",
        kind: "contradiction",
        severity: "important",
        claim: "The letter was already destroyed.",
        anchors: [{ sceneId: ASSESS_SCENE, quote: "burned the letter" }],
        resolution: { status: "open" }
      },
      {
        id: "finding-two",
        kind: "question",
        severity: "advisory",
        claim: "Who received the letter?",
        anchors: [{ sceneId: ASSESS_SCENE, quote: "the letter" }],
        resolution: { status: "open" }
      }
    ],
    coverage: {
      requestedScopeSummary: "Target scene",
      examined: [
        {
          sceneId: ASSESS_SCENE,
          workingVersion: 3,
          contentHash: SCENE_HEAD_HASH
        }
      ],
      skipped: [],
      truncations: [],
      completeForRequestedScope: true
    },
    revisionVector: createStoryAssessmentRevisionVector([
      {
        kind: "scene-prose",
        sceneId: ASSESS_SCENE,
        workingVersion: 3,
        contentHash: "c".repeat(64)
      }
    ]),
    linkedRecheckSceneIds: [CONTEXT_SCENE],
    ...overrides
  });
}

function storyCheckResult(pointer: StoryWorkArtifactPointer): StoryWorkResultReference {
  return {
    kind: "story-check",
    proposalId: pointer.proposalId,
    artifactVersion: pointer.artifactVersion,
    contentHash: pointer.contentHash,
    sceneId: ASSESS_SCENE
  };
}

async function createHarness(options?: {
  status?: "artifact-ready" | "awaiting-review";
  payload?: StoryCheckFindingsV1;
  workflowId?: typeof STORY_CHECK_CONTINUITY_WORKFLOW_ID | typeof CHARACTER_STORY_WORK_WORKFLOW_ID;
}) {
  const status = options?.status ?? "artifact-ready";
  const payload = options?.payload ?? basePayload();
  const workflowId = options?.workflowId ?? STORY_CHECK_CONTINUITY_WORKFLOW_ID;

  const { db, client, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: OWNER,
    name: "Check Review Owner",
    email: "check-review-owner@example.test",
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
    version: 3,
    taskKind: "check",
    brief: "Check continuity",
    constraints: "Use supplied context only",
    doneWhen: "Findings are ready for review",
    sources: [
      {
        kind: "scene",
        sceneId: ASSESS_SCENE,
        projectVersion: BELLWETHER_FIXTURE.project.version,
        workingVersion: 3,
        contentHash: SCENE_HEAD_HASH
      }
    ],
    destination: { kind: "scene", sceneId: ASSESS_SCENE, operation: "assess" },
    provider: "openai",
    model: "gpt-4.1",
    status,
    steps: [{ id: "check", title: "Run continuity check", dependencies: [] }],
    currentArtifact: pointer,
    generatedArtifact: pointer,
    results: [],
    idempotencyKey: "assignment-check-review-postgres-key",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  });
  const assignments = createPostgresStoryWorkAssignmentRepository(exec);
  expect(
    await assignments.create({
      assignment,
      requestFingerprint: instructionContentHash("d".repeat(64))
    })
  ).toMatchObject({ ok: true });

  const receipt: ContextReceipt = Object.freeze({
    id: RECEIPT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    workflowId,
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
    outputSchemaId: "story-check-findings-v1",
    primaryTarget: { kind: "scene" as const, id: ASSESS_SCENE },
    targetSceneId: ASSESS_SCENE,
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
    workflowId,
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
        outputSchemaId: "story-check-findings-v1",
        primaryTarget: { kind: "scene", id: ASSESS_SCENE },
        payload,
        contentHash: CONTENT_HASH,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT
      })
    )
  ).toMatchObject({ ok: true });

  let nextProposalId = 0;
  const review = createPostgresStoryCheckReviewUnitOfWork({
    db: exec,
    ids: {
      create: (kind) => agentProposalId(`${kind}-check-review-postgres-${++nextProposalId}`)
    },
    hashPort
  });
  const input: StoryCheckReviewInput = {
    action: "open",
    accountId: OWNER,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    assignmentId: ASSIGNMENT_ID,
    expectedAssignmentVersion: assignment.version,
    artifact: pointer,
    updatedAt: UPDATED_AT
  };
  return { db, client, exec, projects, assignments, proposals, review, assignment, pointer, input, payload };
}

async function expectNoCanonicalMutation(
  harness: Awaited<ReturnType<typeof createHarness>>
) {
  expect((await harness.projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID))?.version).toBe(
    BELLWETHER_FIXTURE.project.version
  );
  expect(await harness.db.select().from(sceneDocuments)).toHaveLength(0);
  expect(await harness.db.select().from(sceneRevisions)).toHaveLength(0);
}

describe("postgres story check review", () => {
  it("opens artifact-ready checks into awaiting review", async () => {
    const harness = await createHarness();
    const opened = await harness.review.review(harness.input);
    expect(opened.assignment.status).toBe("awaiting-review");
    const replay = await harness.review.review(harness.input);
    expect(replay.assignment.version).toBe(opened.assignment.version);
    await expectNoCanonicalMutation(harness);
  });

  it("dismisses, defers, and reopens findings with immutable lineage", async () => {
    const harness = await createHarness({ status: "awaiting-review" });
    const dismissed = await harness.review.review({
      ...harness.input,
      action: "resolve",
      findingId: "finding-one",
      resolution: { status: "dismissed" }
    });
    const dismissedPayload = validateStoryCheckFindingsV1(dismissed.proposal.payload);
    expect(dismissedPayload.findings[0]?.resolution).toEqual({ status: "dismissed" });
    expect(dismissed.assignment.generatedArtifact).toEqual(harness.pointer);
    expect(dismissed.assignment.currentArtifact?.artifactVersion).toBe(2);
    expect((await harness.proposals.get(harness.pointer.proposalId))?.status).toBe("stale");

    const deferred = await harness.review.review({
      ...harness.input,
      action: "resolve",
      expectedAssignmentVersion: dismissed.assignment.version,
      artifact: dismissed.assignment.currentArtifact!,
      findingId: "finding-two",
      resolution: { status: "deferred", reason: "Revisit after the next scene draft." }
    });
    expect(validateStoryCheckFindingsV1(deferred.proposal.payload).findings[1]?.resolution).toEqual({
      status: "deferred",
      reason: "Revisit after the next scene draft."
    });

    const reopened = await harness.review.review({
      ...harness.input,
      action: "resolve",
      expectedAssignmentVersion: deferred.assignment.version,
      artifact: deferred.assignment.currentArtifact!,
      findingId: "finding-one",
      resolution: { status: "open" }
    });
    const reopenedPayload = validateStoryCheckFindingsV1(reopened.proposal.payload);
    expect(reopenedPayload.findings[0]?.resolution).toEqual({ status: "open" });
    expect(reopenedPayload.linkedRecheckSceneIds).toEqual([CONTEXT_SCENE]);
    await expectNoCanonicalMutation(harness);
  });

  it("completes zero-finding checks and replays the exact complete request", async () => {
    const harness = await createHarness({
      status: "awaiting-review",
      payload: basePayload({ findings: [] })
    });
    const completed = await harness.review.review({
      ...harness.input,
      action: "complete",
      result: storyCheckResult(harness.pointer)
    });
    expect(completed.assignment).toMatchObject({
      status: "reviewed",
      results: [storyCheckResult(harness.pointer)]
    });
    expect(completed.assignment.applyIdempotencyKey).toBeUndefined();

    const replayed = await harness.review.review({
      ...harness.input,
      action: "complete",
      expectedAssignmentVersion: completed.assignment.version,
      result: storyCheckResult(harness.pointer)
    });
    expect(replayed.assignment).toEqual(completed.assignment);
    await expectNoCanonicalMutation(harness);
  });

  it("refuses completion while any finding remains open", async () => {
    const harness = await createHarness({ status: "awaiting-review" });
    await expect(
      harness.review.review({
        ...harness.input,
        action: "complete",
        result: storyCheckResult(harness.pointer)
      })
    ).rejects.toThrow(/dismissed, deferred, or absent/i);
    expect(
      (
        await harness.assignments.get({
          accountId: OWNER,
          projectId: BELLWETHER_FIXTURE_PROJECT_ID,
          assignmentId: ASSIGNMENT_ID
        })
      )?.status
    ).toBe("awaiting-review");
    await expectNoCanonicalMutation(harness);
  });

  it("hides foreign ownership and rejects stale artifact pointers without mutation", async () => {
    const harness = await createHarness();
    await expect(
      harness.review.review({ ...harness.input, accountId: FOREIGN })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentNotFoundError);
    expect((await harness.proposals.get(harness.pointer.proposalId))?.status).toBe("ready");

    await expect(
      harness.review.review({
        ...harness.input,
        artifact: {
          ...harness.pointer,
          contentHash: instructionContentHash("e".repeat(64))
        }
      })
    ).rejects.toMatchObject({ code: "STORY_CHECK_ARTIFACT_MISMATCH" });
    expect((await harness.proposals.get(harness.pointer.proposalId))?.status).toBe("ready");
    await expectNoCanonicalMutation(harness);
  });

  it("rolls new and superseded proposals back after a late assignment write failure", async () => {
    const harness = await createHarness({ status: "awaiting-review" });
    const injectedResolvedId = agentProposalId("agentProposal-check-review-postgres-1");
    await harness.client.exec(`
      create function reject_check_review_assignment() returns trigger as $$
      begin
        if new.current_artifact->>'proposalId' = '${injectedResolvedId}' then
          raise exception 'injected check review assignment persistence failure';
        end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger reject_check_review_assignment
      before update on story_work_assignments
      for each row execute function reject_check_review_assignment();
    `);

    await expect(
      harness.review.review({
        ...harness.input,
        action: "resolve",
        findingId: "finding-one",
        resolution: { status: "dismissed" }
      })
    ).rejects.toBeDefined();
    expect(await harness.proposals.get(injectedResolvedId)).toBeUndefined();
    expect(await harness.proposals.get(PROPOSAL_ID)).toMatchObject({ status: "ready" });
    expect(
      await harness.assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID
      })
    ).toMatchObject({
      version: 3,
      generatedArtifact: { proposalId: PROPOSAL_ID },
      currentArtifact: { proposalId: PROPOSAL_ID }
    });
    await expectNoCanonicalMutation(harness);
  });

  it("persists reviewed status and story-check result across repository reload", async () => {
    const harness = await createHarness({
      status: "awaiting-review",
      payload: basePayload({ findings: [] })
    });
    const completed = await harness.review.review({
      ...harness.input,
      action: "complete",
      result: storyCheckResult(harness.pointer)
    });
    const reloadedAssignments = createPostgresStoryWorkAssignmentRepository(harness.exec);
    const persisted = await reloadedAssignments.get({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      assignmentId: ASSIGNMENT_ID
    });
    expect(persisted).toMatchObject({
      status: "reviewed",
      version: completed.assignment.version,
      results: [storyCheckResult(harness.pointer)]
    });
    expect(persisted?.applyIdempotencyKey).toBeUndefined();
    await expectNoCanonicalMutation(harness);
  });
});
