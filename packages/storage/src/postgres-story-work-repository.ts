import {
  STORY_WORK_ASSIGNMENT_LIST_MAX,
  STORY_WORK_ATTEMPT_LIST_MAX,
  DomainValidationError,
  accountId,
  agentRunId,
  canonicalJsonStringify,
  createStoryWorkAssignment,
  createStoryWorkAttempt,
  instructionContentHash,
  projectId,
  storyWorkAssignmentId,
  storyWorkAssignmentRequestFingerprint,
  storyWorkAttemptIdempotencyKey,
  type CompareAndSetStoryWorkAssignmentOutcome,
  type CompareAndSetStoryWorkAttemptOutcome,
  type CreateStoryWorkAssignmentOutcome,
  type CreateStoryWorkAttemptOutcome,
  type StoryWorkAssignment,
  type StoryWorkAssignmentRepository,
  type StoryWorkAttempt,
  type StoryWorkAttemptRepository
} from "@ghostwriter/core";
import { and, desc, eq } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import { storyWorkAssignments, storyWorkAttempts } from "./schema.js";

const STORED_ASSIGNMENT_INVALID = "Stored story work assignment is invalid.";
const STORED_ATTEMPT_INVALID = "Stored story work attempt is invalid.";
type AssignmentGetInput = Parameters<StoryWorkAssignmentRepository["get"]>[0];
type AssignmentListInput = Parameters<
  StoryWorkAssignmentRepository["listByProject"]
>[0];
type AssignmentIdempotencyInput = Parameters<
  StoryWorkAssignmentRepository["getByIdempotencyKey"]
>[0];
type AssignmentCreateInput = Parameters<
  StoryWorkAssignmentRepository["create"]
>[0];
type AssignmentCompareAndSetInput = Parameters<
  StoryWorkAssignmentRepository["compareAndSet"]
>[0];
type AttemptGetInput = Parameters<StoryWorkAttemptRepository["get"]>[0];
type AttemptIdempotencyInput = Parameters<
  StoryWorkAttemptRepository["getByIdempotencyKey"]
>[0];
type AttemptListInput = Parameters<
  StoryWorkAttemptRepository["listByAssignment"]
>[0];
type AttemptCreateInput = Parameters<StoryWorkAttemptRepository["create"]>[0];
type AttemptCompareAndSetInput = Parameters<
  StoryWorkAttemptRepository["compareAndSet"]
>[0];

function boundedLimit(value: number | undefined, maximum: number, label: string): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      `${label} list limit must be a positive integer.`
    );
  }
  return Math.min(value, maximum);
}

function assignmentFromRow(
  row: typeof storyWorkAssignments.$inferSelect
): StoryWorkAssignment {
  try {
    return createStoryWorkAssignment({
      id: storyWorkAssignmentId(row.id),
      projectId: projectId(row.projectId),
      initiatorAccountId: accountId(row.initiatorAccountId),
      version: row.version,
      taskKind: row.taskKind as StoryWorkAssignment["taskKind"],
      brief: row.brief,
      constraints: row.constraints,
      doneWhen: row.doneWhen,
      sources: row.sources as StoryWorkAssignment["sources"],
      destination: row.destination as StoryWorkAssignment["destination"],
      provider: row.provider as StoryWorkAssignment["provider"],
      model: row.model as StoryWorkAssignment["model"],
      status: row.status as StoryWorkAssignment["status"],
      steps: row.steps as StoryWorkAssignment["steps"],
      ...(row.activeAttemptId === null
        ? {}
        : { activeAttemptId: agentRunId(row.activeAttemptId) }),
      ...(row.latestAttemptId === null
        ? {}
        : { latestAttemptId: agentRunId(row.latestAttemptId) }),
      ...(row.generatedArtifact === null
        ? {}
        : {
            generatedArtifact:
              row.generatedArtifact as StoryWorkAssignment["generatedArtifact"]
          }),
      ...(row.currentArtifact === null
        ? {}
        : {
            currentArtifact:
              row.currentArtifact as StoryWorkAssignment["currentArtifact"]
          }),
      results: row.results as StoryWorkAssignment["results"],
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    });
  } catch {
    throw new Error(STORED_ASSIGNMENT_INVALID);
  }
}

function assignmentToRow(
  assignment: StoryWorkAssignment,
  requestFingerprint: string
): typeof storyWorkAssignments.$inferInsert {
  const candidate = createStoryWorkAssignment(assignment);
  return {
    id: candidate.id,
    projectId: candidate.projectId,
    initiatorAccountId: candidate.initiatorAccountId,
    version: candidate.version,
    taskKind: candidate.taskKind,
    brief: candidate.brief,
    constraints: candidate.constraints,
    doneWhen: candidate.doneWhen,
    sources: candidate.sources,
    destination: candidate.destination,
    provider: candidate.provider,
    model: candidate.model,
    status: candidate.status,
    steps: candidate.steps,
    activeAttemptId: candidate.activeAttemptId ?? null,
    latestAttemptId: candidate.latestAttemptId ?? null,
    generatedArtifact: candidate.generatedArtifact ?? null,
    currentArtifact: candidate.currentArtifact ?? null,
    results: candidate.results,
    idempotencyKey: candidate.idempotencyKey,
    requestFingerprint: storyWorkAssignmentRequestFingerprint(
      requestFingerprint
    ),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  };
}

function assignmentDefinition(assignment: StoryWorkAssignment): string {
  return canonicalJsonStringify({
    taskKind: assignment.taskKind,
    brief: assignment.brief,
    constraints: assignment.constraints,
    doneWhen: assignment.doneWhen,
    sources: assignment.sources,
    destination: assignment.destination,
    provider: assignment.provider,
    model: assignment.model,
    steps: assignment.steps
  });
}

async function loadScopedAssignment(
  db: RepositoryDatabase,
  input: AssignmentGetInput
) {
  const [row] = await db
    .select()
    .from(storyWorkAssignments)
    .where(
      and(
        eq(storyWorkAssignments.id, input.assignmentId),
        eq(storyWorkAssignments.projectId, input.projectId),
        eq(storyWorkAssignments.initiatorAccountId, input.accountId)
      )
    )
    .limit(1);
  return row;
}

export function createPostgresStoryWorkAssignmentRepository(
  db: RepositoryDatabase
): StoryWorkAssignmentRepository {
  return Object.freeze({
    async get(input: AssignmentGetInput) {
      const row = await loadScopedAssignment(db, input);
      return row === undefined ? undefined : assignmentFromRow(row);
    },

    async getByIdempotencyKey(input: AssignmentIdempotencyInput) {
      const [row] = await db
        .select()
        .from(storyWorkAssignments)
        .where(
          and(
            eq(storyWorkAssignments.projectId, input.projectId),
            eq(storyWorkAssignments.initiatorAccountId, input.accountId),
            eq(storyWorkAssignments.idempotencyKey, input.idempotencyKey)
          )
        )
        .limit(1);
      return row === undefined
        ? undefined
        : Object.freeze({
            assignment: assignmentFromRow(row),
            requestFingerprint: storyWorkAssignmentRequestFingerprint(
              row.requestFingerprint
            )
          });
    },

    async listByProject(input: AssignmentListInput) {
      const limit = boundedLimit(
        input.options?.limit,
        STORY_WORK_ASSIGNMENT_LIST_MAX,
        "Story work assignment"
      );
      const filters = [
        eq(storyWorkAssignments.projectId, input.projectId),
        eq(storyWorkAssignments.initiatorAccountId, input.accountId),
        ...(input.options?.status === undefined
          ? []
          : [eq(storyWorkAssignments.status, input.options.status)])
      ];
      const rows = await db
        .select()
        .from(storyWorkAssignments)
        .where(and(...filters))
        .orderBy(
          desc(storyWorkAssignments.updatedAt),
          desc(storyWorkAssignments.id)
        )
        .limit(limit);
      return Object.freeze(rows.map(assignmentFromRow));
    },

    async create(
      input: AssignmentCreateInput
    ): Promise<CreateStoryWorkAssignmentOutcome> {
      const assignment = createStoryWorkAssignment(input.assignment);
      const fingerprint = storyWorkAssignmentRequestFingerprint(
        input.requestFingerprint
      );
      const [inserted] = await db
        .insert(storyWorkAssignments)
        .values(assignmentToRow(assignment, fingerprint))
        .onConflictDoNothing()
        .returning();
      if (inserted !== undefined) {
        return {
          ok: true,
          assignment: assignmentFromRow(inserted),
          created: true
        };
      }
      const [idempotent] = await db
        .select()
        .from(storyWorkAssignments)
        .where(
          and(
            eq(storyWorkAssignments.projectId, assignment.projectId),
            eq(
              storyWorkAssignments.initiatorAccountId,
              assignment.initiatorAccountId
            ),
            eq(storyWorkAssignments.idempotencyKey, assignment.idempotencyKey)
          )
        )
        .limit(1);
      if (idempotent !== undefined) {
        return idempotent.requestFingerprint === fingerprint
          ? {
              ok: true,
              assignment: assignmentFromRow(idempotent),
              created: false
            }
          : { ok: false, reason: "idempotency-conflict" };
      }
      return { ok: false, reason: "duplicate-id" };
    },

    async compareAndSet(
      input: AssignmentCompareAndSetInput
    ): Promise<CompareAndSetStoryWorkAssignmentOutcome> {
      const row = await loadScopedAssignment(db, input);
      if (row === undefined) return { ok: false, reason: "not-found" };
      const current = assignmentFromRow(row);
      if (current.version !== input.expectedVersion) {
        return { ok: false, reason: "version-conflict" };
      }
      let next: StoryWorkAssignment;
      try {
        next = createStoryWorkAssignment(input.next);
      } catch {
        return { ok: false, reason: "version-conflict" };
      }
      if (
        next.id !== current.id ||
        next.projectId !== current.projectId ||
        next.initiatorAccountId !== current.initiatorAccountId ||
        next.idempotencyKey !== current.idempotencyKey ||
        next.createdAt !== current.createdAt ||
        next.version !== current.version + 1 ||
        assignmentDefinition(next) !== assignmentDefinition(current)
      ) {
        return { ok: false, reason: "version-conflict" };
      }
      const values = assignmentToRow(next, row.requestFingerprint);
      const [updated] = await db
        .update(storyWorkAssignments)
        .set({
          version: values.version,
          status: values.status,
          activeAttemptId: values.activeAttemptId,
          latestAttemptId: values.latestAttemptId,
          generatedArtifact: values.generatedArtifact,
          currentArtifact: values.currentArtifact,
          results: values.results,
          updatedAt: values.updatedAt
        })
        .where(
          and(
            eq(storyWorkAssignments.id, current.id),
            eq(storyWorkAssignments.projectId, current.projectId),
            eq(
              storyWorkAssignments.initiatorAccountId,
              current.initiatorAccountId
            ),
            eq(storyWorkAssignments.version, input.expectedVersion)
          )
        )
        .returning();
      return updated === undefined
        ? { ok: false, reason: "version-conflict" }
        : { ok: true, assignment: assignmentFromRow(updated) };
    }
  });
}

function attemptFromRow(
  row: typeof storyWorkAttempts.$inferSelect
): StoryWorkAttempt {
  try {
    return createStoryWorkAttempt({
      assignmentId: storyWorkAssignmentId(row.assignmentId),
      projectId: projectId(row.projectId),
      initiatorAccountId: accountId(row.initiatorAccountId),
      runId: agentRunId(row.runId),
      version: row.version,
      kind: row.kind as StoryWorkAttempt["kind"],
      sourceMode: row.sourceMode as StoryWorkAttempt["sourceMode"],
      instruction: row.instruction,
      idempotencyKey: row.idempotencyKey,
      requestFingerprint: instructionContentHash(row.requestFingerprint),
      ...(row.priorArtifact === null
        ? {}
        : { priorArtifact: row.priorArtifact as StoryWorkAttempt["priorArtifact"] }),
      ...(row.resultArtifact === null
        ? {}
        : {
            resultArtifact:
              row.resultArtifact as StoryWorkAttempt["resultArtifact"]
          }),
      createdAt: row.createdAt,
      ...(row.completedAt === null ? {} : { completedAt: row.completedAt })
    });
  } catch {
    throw new Error(STORED_ATTEMPT_INVALID);
  }
}

function attemptToRow(
  attempt: StoryWorkAttempt
): typeof storyWorkAttempts.$inferInsert {
  const candidate = createStoryWorkAttempt(attempt);
  return {
    runId: candidate.runId,
    assignmentId: candidate.assignmentId,
    projectId: candidate.projectId,
    initiatorAccountId: candidate.initiatorAccountId,
    version: candidate.version,
    kind: candidate.kind,
    sourceMode: candidate.sourceMode,
    instruction: candidate.instruction,
    idempotencyKey: candidate.idempotencyKey,
    requestFingerprint: candidate.requestFingerprint,
    priorArtifact: candidate.priorArtifact ?? null,
    resultArtifact: candidate.resultArtifact ?? null,
    createdAt: candidate.createdAt,
    completedAt: candidate.completedAt ?? null
  };
}

function attemptIdentity(attempt: StoryWorkAttempt): string {
  return canonicalJsonStringify({
    runId: attempt.runId,
    assignmentId: attempt.assignmentId,
    projectId: attempt.projectId,
    initiatorAccountId: attempt.initiatorAccountId,
    kind: attempt.kind,
    sourceMode: attempt.sourceMode,
    instruction: attempt.instruction,
    idempotencyKey: attempt.idempotencyKey,
    requestFingerprint: attempt.requestFingerprint,
    priorArtifact: attempt.priorArtifact,
    createdAt: attempt.createdAt
  });
}

async function loadScopedAttempt(
  db: RepositoryDatabase,
  input: AttemptGetInput
) {
  const [row] = await db
    .select()
    .from(storyWorkAttempts)
    .where(
      and(
        eq(storyWorkAttempts.runId, input.runId),
        eq(storyWorkAttempts.assignmentId, input.assignmentId),
        eq(storyWorkAttempts.projectId, input.projectId),
        eq(storyWorkAttempts.initiatorAccountId, input.accountId)
      )
    )
    .limit(1);
  return row;
}

export function createPostgresStoryWorkAttemptRepository(
  db: RepositoryDatabase
): StoryWorkAttemptRepository {
  return Object.freeze({
    async get(input: AttemptGetInput) {
      const row = await loadScopedAttempt(db, input);
      return row === undefined ? undefined : attemptFromRow(row);
    },

    async getByIdempotencyKey(input: AttemptIdempotencyInput) {
      const idempotencyKey = storyWorkAttemptIdempotencyKey(
        input.idempotencyKey
      );
      const [row] = await db
        .select()
        .from(storyWorkAttempts)
        .where(
          and(
            eq(storyWorkAttempts.assignmentId, input.assignmentId),
            eq(storyWorkAttempts.projectId, input.projectId),
            eq(storyWorkAttempts.initiatorAccountId, input.accountId),
            eq(storyWorkAttempts.idempotencyKey, idempotencyKey)
          )
        )
        .limit(1);
      return row === undefined ? undefined : attemptFromRow(row);
    },

    async listByAssignment(input: AttemptListInput) {
      const limit = boundedLimit(
        input.limit,
        STORY_WORK_ATTEMPT_LIST_MAX,
        "Story work attempt"
      );
      const rows = await db
        .select()
        .from(storyWorkAttempts)
        .where(
          and(
            eq(storyWorkAttempts.assignmentId, input.assignmentId),
            eq(storyWorkAttempts.projectId, input.projectId),
            eq(storyWorkAttempts.initiatorAccountId, input.accountId)
          )
        )
        .orderBy(
          desc(storyWorkAttempts.createdAt),
          desc(storyWorkAttempts.runId)
        )
        .limit(limit);
      return Object.freeze(rows.map(attemptFromRow));
    },

    async create(input: AttemptCreateInput): Promise<CreateStoryWorkAttemptOutcome> {
      const attempt = createStoryWorkAttempt(input.attempt);
      const [inserted] = await db
        .insert(storyWorkAttempts)
        .values(attemptToRow(attempt))
        .onConflictDoNothing()
        .returning();
      if (inserted !== undefined) {
        return { ok: true, attempt: attemptFromRow(inserted), created: true };
      }
      const [idempotent] = await db
        .select()
        .from(storyWorkAttempts)
        .where(
          and(
            eq(storyWorkAttempts.assignmentId, attempt.assignmentId),
            eq(storyWorkAttempts.projectId, attempt.projectId),
            eq(
              storyWorkAttempts.initiatorAccountId,
              attempt.initiatorAccountId
            ),
            eq(storyWorkAttempts.idempotencyKey, attempt.idempotencyKey)
          )
        )
        .limit(1);
      if (idempotent !== undefined) {
        return idempotent.requestFingerprint === attempt.requestFingerprint
          ? { ok: true, attempt: attemptFromRow(idempotent), created: false }
          : { ok: false, reason: "idempotency-conflict" };
      }
      return { ok: false, reason: "duplicate-run" };
    },

    async compareAndSet(
      input: AttemptCompareAndSetInput
    ): Promise<CompareAndSetStoryWorkAttemptOutcome> {
      const row = await loadScopedAttempt(db, input);
      if (row === undefined) return { ok: false, reason: "not-found" };
      const current = attemptFromRow(row);
      if (current.version !== input.expectedVersion) {
        return { ok: false, reason: "version-conflict" };
      }
      let next: StoryWorkAttempt;
      try {
        next = createStoryWorkAttempt(input.next);
      } catch {
        return { ok: false, reason: "version-conflict" };
      }
      if (
        next.version !== current.version + 1 ||
        attemptIdentity(next) !== attemptIdentity(current)
      ) {
        return { ok: false, reason: "version-conflict" };
      }
      const values = attemptToRow(next);
      const [updated] = await db
        .update(storyWorkAttempts)
        .set({
          version: values.version,
          resultArtifact: values.resultArtifact,
          completedAt: values.completedAt
        })
        .where(
          and(
            eq(storyWorkAttempts.runId, current.runId),
            eq(storyWorkAttempts.assignmentId, current.assignmentId),
            eq(storyWorkAttempts.projectId, current.projectId),
            eq(
              storyWorkAttempts.initiatorAccountId,
              current.initiatorAccountId
            ),
            eq(storyWorkAttempts.version, input.expectedVersion)
          )
        )
        .returning();
      return updated === undefined
        ? { ok: false, reason: "version-conflict" }
        : { ok: true, attempt: attemptFromRow(updated) };
    }
  });
}
