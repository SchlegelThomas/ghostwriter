import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
  STORY_STRUCTURE_SCHEMA_ID,
  STORY_WORK_STRUCTURE_WORKFLOW_ID,
  StoryWorkAssignmentNotFoundError,
  accountId,
  agentProposalId,
  agentRunId,
  buildStoryStructureProposalV1FromCandidate,
  contextReceiptId,
  createAgentRun,
  createBook,
  createManuscriptStructure,
  createProjectMembership,
  createQueuedAgentRun,
  createReadyAgentProposal,
  createStoryWorkAssignment,
  instructionContentHash,
  storyStructureLoweringContextFromBook,
  storyWorkAssignmentId,
  validateStoryStructureProposalV1,
  type ContextReceipt,
  type DomainIdKind,
  type IdGenerator,
  type StoryStructureProposalV1,
  type StoryStructureStoryWorkReviewInput
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import {
  createPostgresAgentProposalRepository,
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresStoryStructureStoryWorkReviewUnitOfWork } from "./postgres-story-structure-review-uow.js";
import { createPostgresStoryWorkAssignmentRepository } from "./postgres-story-work-repository.js";
import { sceneDocuments, sceneRevisions, user } from "./schema.js";
import { seedProject } from "./seed.js";

const OWNER = accountId("account-structure-review-postgres-owner");
const FOREIGN = accountId("account-structure-review-postgres-foreign");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-structure-review-postgres");
const RUN_ID = agentRunId("run-structure-review-postgres");
const PROPOSAL_ID = agentProposalId("proposal-structure-review-postgres");
const RECEIPT_ID = contextReceiptId("receipt-structure-review-postgres");
const TARGET_BOOK_ID = BELLWETHER_FIXTURE.books[0]!.id;
const CONTENT_HASH = instructionContentHash("a".repeat(64));
const RECEIPT_HASH = instructionContentHash("b".repeat(64));
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

function sequenceIds(values: Partial<Record<DomainIdKind, readonly string[]>>): IdGenerator {
  const positions = new Map<DomainIdKind, number>();
  return {
    create(kind): string {
      const index = positions.get(kind) ?? 0;
      const list = values[kind] ?? [`generated-${kind}-${index + 1}`];
      const value = list[index];
      positions.set(kind, index + 1);
      if (value === undefined) throw new Error(`No ${kind} ID remains in the fixture.`);
      return value;
    }
  };
}

function sampleProposal(): StoryStructureProposalV1 {
  return buildStoryStructureProposalV1FromCandidate({
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    bookId: TARGET_BOOK_ID,
    expectedProjectVersion: BELLWETHER_FIXTURE.project.version,
    contextReceiptHash: RECEIPT_HASH,
    candidate: {
      schemaId: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
      newParts: [{ localKey: "part-a", title: "Act One" }],
      newChapters: [
        {
          localKey: "ch-1",
          part: { kind: "new", localKey: "part-a" },
          title: "Chapter One",
          objective: "Introduce the harbor"
        }
      ],
      newPlannedScenes: [
        {
          localKey: "sc-1",
          host: { kind: "newChapter", localKey: "ch-1" },
          title: "Opening"
        }
      ],
      existingChapterUpdates: [],
      chapterReorders: [
        {
          part: { kind: "new", localKey: "part-a" },
          order: [{ kind: "new", localKey: "ch-1" }]
        }
      ],
      existingSceneMoves: [],
      existingSceneArchiveChanges: [],
      existingSceneIntentUpdates: []
    },
    context: storyStructureLoweringContextFromBook(
      BELLWETHER_FIXTURE_PROJECT_ID,
      createBook({
        id: TARGET_BOOK_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        title: "Signal",
        status: "drafting",
        manuscript: createManuscriptStructure({ parts: [], unassignedSceneIds: [] }),
        createdAt: CREATED_AT
      }),
      []
    ),
    ids: sequenceIds({
      storyStructureOperation: ["op-part", "op-ch-1", "op-reorder", "op-sc-1"],
      part: ["part-canonical"],
      chapter: ["chapter-canonical"],
      scene: ["scene-canonical"]
    })
  });
}

async function createHarness(options?: {
  status?: "artifact-ready" | "awaiting-review";
  payload?: StoryStructureProposalV1;
}) {
  const status = options?.status ?? "artifact-ready";
  const payload = options?.payload ?? sampleProposal();

  const { db, client, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: OWNER,
    name: "Structure Review Owner",
    email: "structure-review-owner@example.test",
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
    taskKind: "outline",
    brief: "Develop the book outline",
    constraints: "Respect canon",
    doneWhen: "Structure is ready for review",
    sources: [
      {
        kind: "book",
        bookId: TARGET_BOOK_ID,
        projectVersion: BELLWETHER_FIXTURE.project.version
      }
    ],
    destination: { kind: "book", bookId: TARGET_BOOK_ID, operation: "update" },
    provider: "openai",
    model: "gpt-4.1",
    status,
    steps: [{ id: "structure", title: "Propose structure", dependencies: [] }],
    currentArtifact: pointer,
    generatedArtifact: pointer,
    results: [],
    idempotencyKey: "assignment-structure-review-postgres-key",
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
    workflowId: STORY_WORK_STRUCTURE_WORKFLOW_ID,
    workflowVersion: "1.0.0",
    layers: [],
    resources: [],
    excludedContextClasses: [],
    provider: "openai",
    model: "gpt-4.1",
    maxOutputTokens: 4_000,
    wallClockSeconds: 90,
    toolCount: 0,
    egressClass: "openai-responses",
    outputSchemaId: STORY_STRUCTURE_SCHEMA_ID,
    primaryTarget: { kind: "book" as const, id: TARGET_BOOK_ID },
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
    workflowId: STORY_WORK_STRUCTURE_WORKFLOW_ID,
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
        outputSchemaId: STORY_STRUCTURE_SCHEMA_ID,
        primaryTarget: { kind: "book" as const, id: TARGET_BOOK_ID },
        payload,
        contentHash: CONTENT_HASH,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT
      })
    )
  ).toMatchObject({ ok: true });

  let nextProposalId = 0;
  const review = createPostgresStoryStructureStoryWorkReviewUnitOfWork({
    db: exec,
    ids: {
      create: (kind) =>
        kind === "agentProposal"
          ? agentProposalId(`agentProposal-structure-review-postgres-${++nextProposalId}`)
          : `${kind}-structure-review-postgres-${++nextProposalId}`
    },
    hashPort
  });
  const input: StoryStructureStoryWorkReviewInput = {
    action: "open",
    accountId: OWNER,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    assignmentId: ASSIGNMENT_ID,
    expectedAssignmentVersion: assignment.version,
    artifact: pointer,
    updatedAt: UPDATED_AT
  };
  return {
    db,
    client,
    exec,
    projects,
    assignments,
    proposals,
    review,
    assignment,
    pointer,
    input,
    payload
  };
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

describe("postgres story structure review", () => {
  it("opens artifact-ready structure assignments into awaiting review", async () => {
    const harness = await createHarness();
    const opened = await harness.review.review(harness.input);
    expect(opened.assignment.status).toBe("awaiting-review");
    const replay = await harness.review.review(harness.input);
    expect(replay.assignment.version).toBe(opened.assignment.version);
    await expectNoCanonicalMutation(harness);
  });

  it("edits human-reviewable fields while preserving generated lineage", async () => {
    const harness = await createHarness({ status: "awaiting-review" });
    const editedPayload = validateStoryStructureProposalV1({
      ...harness.payload,
      operations: harness.payload.operations.map((operation) =>
        operation.type === "part.create"
          ? { ...operation, title: "Act One (revised)" }
          : operation.type === "chapter.create"
            ? { ...operation, title: "Chapter One (revised)", objective: "Raise the stakes" }
            : operation
      )
    });
    const edited = await harness.review.review({
      ...harness.input,
      action: "edit",
      payload: editedPayload
    });
    expect(edited.assignment.generatedArtifact).toEqual(harness.pointer);
    expect(edited.assignment.currentArtifact?.artifactVersion).toBe(2);
    expect((await harness.proposals.get(harness.pointer.proposalId))?.status).toBe("stale");
    expect(edited.proposal.payload).toEqual(editedPayload);
    await expectNoCanonicalMutation(harness);
  });

  it("rejects the exact artifact without writing canonical structure", async () => {
    const harness = await createHarness({ status: "awaiting-review" });
    const rejectInput: StoryStructureStoryWorkReviewInput = {
      ...harness.input,
      action: "reject"
    };
    const rejected = await harness.review.review(rejectInput);
    expect(rejected.assignment.status).toBe("rejected");
    const replay = await harness.review.review(rejectInput);
    expect(replay.assignment.version).toBe(rejected.assignment.version);
    expect(await harness.proposals.get(harness.pointer.proposalId)).toMatchObject({
      status: "rejected"
    });
    await expectNoCanonicalMutation(harness);
  });

  it("refuses authority-changing edits to ids, dependencies, and preconditions", async () => {
    const harness = await createHarness({ status: "awaiting-review" });

    await expect(
      harness.review.review({
        ...harness.input,
        action: "edit",
        payload: validateStoryStructureProposalV1({
          ...harness.payload,
          operations: harness.payload.operations.map((operation) =>
            operation.type === "part.create"
              ? { ...operation, partId: "part-tampered" }
              : operation
          )
        })
      })
    ).rejects.toMatchObject({ code: "STORY_STRUCTURE_STORY_WORK_ARTIFACT_MISMATCH" });

    await expect(
      harness.review.review({
        ...harness.input,
        action: "edit",
        payload: validateStoryStructureProposalV1({
          ...harness.payload,
          dependencies: harness.payload.dependencies.map((edge) =>
            edge.operationId === "op-reorder"
              ? { ...edge, requires: [...edge.requires, "op-part"] }
              : edge
          )
        })
      })
    ).rejects.toMatchObject({ code: "STORY_STRUCTURE_STORY_WORK_ARTIFACT_MISMATCH" });

    await expect(
      harness.review.review({
        ...harness.input,
        action: "edit",
        payload: {
          ...harness.payload,
          expectedProjectVersion: harness.payload.expectedProjectVersion + 1
        }
      })
    ).rejects.toMatchObject({ code: "STORY_STRUCTURE_STORY_WORK_ARTIFACT_MISMATCH" });

    expect((await harness.proposals.get(harness.pointer.proposalId))?.status).toBe("ready");
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
    ).rejects.toMatchObject({ code: "STORY_STRUCTURE_STORY_WORK_ARTIFACT_MISMATCH" });
    expect((await harness.proposals.get(harness.pointer.proposalId))?.status).toBe("ready");
    await expectNoCanonicalMutation(harness);
  });

  it("rolls new and superseded proposals back after a late assignment write failure", async () => {
    const harness = await createHarness({ status: "awaiting-review" });
    const injectedEditedId = agentProposalId("agentProposal-structure-review-postgres-1");
    await harness.client.exec(`
      create function reject_structure_review_assignment() returns trigger as $$
      begin
        if new.current_artifact->>'proposalId' = '${injectedEditedId}' then
          raise exception 'injected structure review assignment persistence failure';
        end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger reject_structure_review_assignment
      before update on story_work_assignments
      for each row execute function reject_structure_review_assignment();
    `);

    await expect(
      harness.review.review({
        ...harness.input,
        action: "edit",
        payload: validateStoryStructureProposalV1({
          ...harness.payload,
          operations: harness.payload.operations.map((operation) =>
            operation.type === "part.create"
              ? { ...operation, title: "This transaction must roll back." }
              : operation
          )
        })
      })
    ).rejects.toBeDefined();
    expect(await harness.proposals.get(injectedEditedId)).toBeUndefined();
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

  it("persists rejected assignments across repository reload", async () => {
    const harness = await createHarness({ status: "awaiting-review" });
    const rejected = await harness.review.review({
      ...harness.input,
      action: "reject"
    });
    const reloadedAssignments = createPostgresStoryWorkAssignmentRepository(harness.exec);
    const persisted = await reloadedAssignments.get({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      assignmentId: ASSIGNMENT_ID
    });
    expect(persisted).toMatchObject({
      status: "rejected",
      version: rejected.assignment.version
    });
    expect(await harness.proposals.get(PROPOSAL_ID)).toMatchObject({ status: "rejected" });
    await expectNoCanonicalMutation(harness);
  });
});
