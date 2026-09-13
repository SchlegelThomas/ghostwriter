import {
  CHARACTER_STORY_WORK_WORKFLOW_ID,
  HARRY_POTTER_FIXTURE,
  HARRY_POTTER_FIXTURE_PROJECT_ID,
  accountId,
  agentRunId,
  contextReceiptId,
  createAgentRun,
  createQueuedAgentRun,
  createStoryWorkAssignment,
  createStoryWorkAttempt,
  instructionContentHash,
  sceneContentHash,
  sceneId,
  startStoryWorkAttempt,
  storyKnowledgeId,
  storyWorkAssignmentId,
  type AccountId,
  type ProjectRecords
} from "@ghostwriter/core";
import type { RepositoryDatabase } from "@ghostwriter/storage";
import {
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository,
  createPostgresStoryWorkAssignmentRepository,
  createPostgresStoryWorkAttemptRepository
} from "@ghostwriter/storage";

/** Hermetic E2E writer account — keep in sync with `e2e-server.ts`. */
export const E2E_HERMETIC_WRITER_ACCOUNT_ID = "account-e2e-writer";

export const E2E_STORY_WORK_RECOVERY_BRIEF = "E2E interrupted generation recovery";

export const E2E_STORY_WORK_RECOVERY_PROJECT_ID = HARRY_POTTER_FIXTURE_PROJECT_ID;

export const E2E_STORY_WORK_RECOVERY_ASSIGNMENT_ID = storyWorkAssignmentId(
  "assignment-e2e-cp5a-story-work-recovery"
);

export const E2E_STORY_WORK_RECOVERY_RUN_ID = agentRunId(
  "run-e2e-cp5a-story-work-recovery"
);

export const E2E_STORY_WORK_RECOVERY_RECEIPT_ID = contextReceiptId(
  "receipt-e2e-cp5a-story-work-recovery"
);

/** Reserved create destination — no canon row or proposal is seeded. */
export const E2E_STORY_WORK_RECOVERY_KNOWLEDGE_ID = storyKnowledgeId(
  "knowledge-e2e-cp5a-story-work-recovery"
);

const SOURCE_SCENE_ID = sceneId("scene-hp-philosophers-stone-privet-drive-morning");

const CREATED_AT = "2026-09-13T19:00:00.000Z";
const RUNNING_AT = "2026-09-13T19:00:10.000Z";
const RUN_TRANSITION_AT = "2026-09-13T19:00:30.000Z";

const RECEIPT_HASH = instructionContentHash("e2e0".repeat(16));
const ASSIGNMENT_FINGERPRINT = instructionContentHash("e2e1".repeat(16));
const ATTEMPT_FINGERPRINT = instructionContentHash("e2e2".repeat(16));
const SOURCE_SCENE_CONTENT_HASH = sceneContentHash("e2e3".repeat(16));

export type E2eStoryWorkRecoveryHermeticSeed = Readonly<{
  assignmentId: typeof E2E_STORY_WORK_RECOVERY_ASSIGNMENT_ID;
  runId: typeof E2E_STORY_WORK_RECOVERY_RUN_ID;
  brief: typeof E2E_STORY_WORK_RECOVERY_BRIEF;
  projectId: typeof E2E_STORY_WORK_RECOVERY_PROJECT_ID;
  destinationStoryKnowledgeId: typeof E2E_STORY_WORK_RECOVERY_KNOWLEDGE_ID;
  detailPath: string;
  recoverPath: string;
  listPath: string;
}>;

export function e2eStoryWorkRecoveryHermeticPaths(): Pick<
  E2eStoryWorkRecoveryHermeticSeed,
  "detailPath" | "recoverPath" | "listPath"
> {
  const base = `/api/projects/${E2E_STORY_WORK_RECOVERY_PROJECT_ID}/story-work/assignments`;
  return Object.freeze({
    listPath: base,
    detailPath: `${base}/${E2E_STORY_WORK_RECOVERY_ASSIGNMENT_ID}`,
    recoverPath: `${base}/${E2E_STORY_WORK_RECOVERY_ASSIGNMENT_ID}/recover`
  });
}

/**
 * Seeds one running character story-work assignment for CP5a browser recovery.
 * Idempotent when the assignment already exists (safe on repeated startup attempts).
 */
export async function seedE2eHermeticStoryWorkRecoveryFixture(input: Readonly<{
  db: RepositoryDatabase;
  ownerAccountId: AccountId;
  projectRecords?: ProjectRecords;
}>): Promise<E2eStoryWorkRecoveryHermeticSeed> {
  const projectRecords = input.projectRecords ?? HARRY_POTTER_FIXTURE;
  const projectVersion = projectRecords.project.version;
  const assignments = createPostgresStoryWorkAssignmentRepository(input.db);
  const attempts = createPostgresStoryWorkAttemptRepository(input.db);
  const runs = createPostgresAgentRunRepository(input.db);
  const receipts = createPostgresContextReceiptRepository(input.db);

  const existing = await assignments.get({
    accountId: input.ownerAccountId,
    projectId: E2E_STORY_WORK_RECOVERY_PROJECT_ID,
    assignmentId: E2E_STORY_WORK_RECOVERY_ASSIGNMENT_ID
  });
  if (existing !== undefined) {
    return Object.freeze({
      assignmentId: E2E_STORY_WORK_RECOVERY_ASSIGNMENT_ID,
      runId: E2E_STORY_WORK_RECOVERY_RUN_ID,
      brief: E2E_STORY_WORK_RECOVERY_BRIEF,
      projectId: E2E_STORY_WORK_RECOVERY_PROJECT_ID,
      destinationStoryKnowledgeId: E2E_STORY_WORK_RECOVERY_KNOWLEDGE_ID,
      ...e2eStoryWorkRecoveryHermeticPaths()
    });
  }

  const assignment = createStoryWorkAssignment({
    id: E2E_STORY_WORK_RECOVERY_ASSIGNMENT_ID,
    projectId: E2E_STORY_WORK_RECOVERY_PROJECT_ID,
    initiatorAccountId: input.ownerAccountId,
    version: 1,
    taskKind: "character",
    brief: E2E_STORY_WORK_RECOVERY_BRIEF,
    constraints: "Hermetic E2E only — do not start a live provider run.",
    doneWhen: "Writer can cancel or mark interrupted from recovery controls.",
    sources: [
      {
        kind: "scene",
        sceneId: SOURCE_SCENE_ID,
        projectVersion,
        workingVersion: 1,
        contentHash: SOURCE_SCENE_CONTENT_HASH
      }
    ],
    destination: {
      kind: "story-knowledge",
      storyKnowledgeId: E2E_STORY_WORK_RECOVERY_KNOWLEDGE_ID,
      operation: "create"
    },
    provider: "openai",
    model: "gpt-4.1",
    status: "brief-ready",
    steps: [{ id: "character", title: "Character", dependencies: [] }],
    results: [],
    idempotencyKey: "idempotency-e2e-cp5a-story-work-recovery",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  });

  const createOutcome = await assignments.create({
    assignment,
    requestFingerprint: ASSIGNMENT_FINGERPRINT
  });
  if (!createOutcome.ok) {
    throw new Error("Failed to seed E2E story-work recovery assignment.");
  }

  const receiptInsert = await receipts.insertImmutable(
    Object.freeze({
      id: E2E_STORY_WORK_RECOVERY_RECEIPT_ID,
      projectId: E2E_STORY_WORK_RECOVERY_PROJECT_ID,
      workflowId: CHARACTER_STORY_WORK_WORKFLOW_ID,
      workflowVersion: "2026-09-12",
      layers: [],
      resources: [],
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
      targetStoryKnowledgeId: E2E_STORY_WORK_RECOVERY_KNOWLEDGE_ID,
      primaryTarget: {
        kind: "story-knowledge" as const,
        id: E2E_STORY_WORK_RECOVERY_KNOWLEDGE_ID
      },
      receiptHash: RECEIPT_HASH,
      createdAt: CREATED_AT
    })
  );
  if (!receiptInsert.ok) {
    throw new Error("Failed to seed E2E story-work recovery context receipt.");
  }

  const queuedRun = createQueuedAgentRun({
    id: E2E_STORY_WORK_RECOVERY_RUN_ID,
    projectId: E2E_STORY_WORK_RECOVERY_PROJECT_ID,
    initiatorAccountId: input.ownerAccountId,
    workflowId: CHARACTER_STORY_WORK_WORKFLOW_ID,
    workflowVersion: "2026-09-12",
    provider: "openai",
    model: "gpt-4.1",
    receiptId: E2E_STORY_WORK_RECOVERY_RECEIPT_ID,
    receiptHash: RECEIPT_HASH,
    status: "queued",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  });
  await runs.create(queuedRun);
  const runningRun = createAgentRun({
    ...queuedRun,
    status: "running",
    updatedAt: RUN_TRANSITION_AT
  });
  await runs.transition({
    runId: E2E_STORY_WORK_RECOVERY_RUN_ID,
    expectedStatus: "queued",
    next: runningRun
  });

  const attempt = createStoryWorkAttempt({
    assignmentId: E2E_STORY_WORK_RECOVERY_ASSIGNMENT_ID,
    projectId: E2E_STORY_WORK_RECOVERY_PROJECT_ID,
    initiatorAccountId: input.ownerAccountId,
    runId: E2E_STORY_WORK_RECOVERY_RUN_ID,
    version: 1,
    kind: "initial",
    sourceMode: "submitted-snapshot",
    instruction: assignment.brief,
    idempotencyKey: "attempt-e2e-cp5a-story-work-recovery",
    requestFingerprint: ATTEMPT_FINGERPRINT,
    createdAt: CREATED_AT
  });
  await attempts.create({ attempt });

  const runningAssignment = startStoryWorkAttempt({
    assignment,
    expectedVersion: 1,
    runId: E2E_STORY_WORK_RECOVERY_RUN_ID,
    updatedAt: RUNNING_AT
  });
  const runningUpdate = await assignments.compareAndSet({
    accountId: input.ownerAccountId,
    projectId: E2E_STORY_WORK_RECOVERY_PROJECT_ID,
    assignmentId: E2E_STORY_WORK_RECOVERY_ASSIGNMENT_ID,
    expectedVersion: 1,
    next: runningAssignment
  });
  if (!runningUpdate.ok) {
    throw new Error("Failed to transition E2E story-work recovery assignment to running.");
  }

  return Object.freeze({
    assignmentId: E2E_STORY_WORK_RECOVERY_ASSIGNMENT_ID,
    runId: E2E_STORY_WORK_RECOVERY_RUN_ID,
    brief: E2E_STORY_WORK_RECOVERY_BRIEF,
    projectId: E2E_STORY_WORK_RECOVERY_PROJECT_ID,
    destinationStoryKnowledgeId: E2E_STORY_WORK_RECOVERY_KNOWLEDGE_ID,
    ...e2eStoryWorkRecoveryHermeticPaths()
  });
}

export function e2eHermeticWriterAccountId(): AccountId {
  return accountId(E2E_HERMETIC_WRITER_ACCOUNT_ID);
}
