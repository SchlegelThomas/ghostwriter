import {
  createRepositoryStoryWorkCoordinationExecutor,
  type StoryWorkCoordinationRepositoryFailurePoint,
  type StoryWorkCoordinationUnitOfWork,
  type BindProposalContinuityCheckInput,
  type CreateStoryWorkCoordinationInput,
  type FindStoryWorkCoordinationBindReplayInput,
  type FindStoryWorkCoordinationCreateReplayInput,
  storyWorkAssignmentId,
  type StoryWorkAssignmentId,
  type StoryWorkCoordinationId,
  type AccountId,
  type ProjectId
} from "@ghostwriter/core";
import { and, asc, eq } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresStoryWorkCoordinationRepository } from "./postgres-story-work-coordination-repository.js";
import { createPostgresStoryWorkAssignmentRepository } from "./postgres-story-work-repository.js";
import {
  storyWorkAssignments,
  storyWorkCoordinationStepBindings,
  storyWorkCoordinations
} from "./schema.js";

type AssignmentScope = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignmentId;
}>;

type CoordinationScope = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  coordinationId: StoryWorkCoordinationId;
}>;

export type PostgresStoryWorkCoordinationUnitOfWorkOptions = Readonly<{
  failAfter?: StoryWorkCoordinationRepositoryFailurePoint;
}>;

/**
 * Lock order (always; assignment ids sorted ascending when multiple):
 * 1. `story_work_coordinations` — idempotency row and/or primary id row (create path), else
 *    scoped coordination parent (bind path).
 * 2. `story_work_coordination_step_bindings` for that coordination — `step_id` ascending.
 * 3. `story_work_assignments` — root scene assignment, then bound check assignment on replay.
 *
 * Matches nested repository transactions: coordination `compareAndSet` re-locks the parent
 * row inside a savepoint after bindings are read; acquiring bindings before assignments avoids
 * inversion with bind paths that hold the coordination lock then touch root/check rows. Provider,
 * canon, receipt, and run tables are intentionally excluded.
 */
async function lockAssignment(
  db: RepositoryDatabase,
  scope: AssignmentScope
): Promise<void> {
  await db
    .select({ id: storyWorkAssignments.id })
    .from(storyWorkAssignments)
    .where(
      and(
        eq(storyWorkAssignments.id, scope.assignmentId),
        eq(storyWorkAssignments.projectId, scope.projectId),
        eq(storyWorkAssignments.initiatorAccountId, scope.accountId)
      )
    )
    .for("update");
}

async function lockCoordinationById(
  db: RepositoryDatabase,
  scope: CoordinationScope
): Promise<void> {
  await db
    .select({ id: storyWorkCoordinations.id })
    .from(storyWorkCoordinations)
    .where(
      and(
        eq(storyWorkCoordinations.id, scope.coordinationId),
        eq(storyWorkCoordinations.projectId, scope.projectId),
        eq(storyWorkCoordinations.initiatorAccountId, scope.accountId)
      )
    )
    .for("update");
}

async function lockCoordinationIdempotency(
  db: RepositoryDatabase,
  input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    idempotencyKey: string;
  }>
): Promise<string | undefined> {
  const rows = await db
    .select({ id: storyWorkCoordinations.id })
    .from(storyWorkCoordinations)
    .where(
      and(
        eq(storyWorkCoordinations.projectId, input.projectId),
        eq(storyWorkCoordinations.initiatorAccountId, input.accountId),
        eq(storyWorkCoordinations.idempotencyKey, input.idempotencyKey)
      )
    )
    .for("update");
  return rows[0]?.id;
}

async function lockBindingsOrdered(
  db: RepositoryDatabase,
  coordinationId: string
): Promise<
  readonly (typeof storyWorkCoordinationStepBindings.$inferSelect)[]
> {
  return db
    .select()
    .from(storyWorkCoordinationStepBindings)
    .where(eq(storyWorkCoordinationStepBindings.coordinationId, coordinationId))
    .orderBy(asc(storyWorkCoordinationStepBindings.stepId))
    .for("update");
}

async function lockAssignmentsOrdered(
  db: RepositoryDatabase,
  scope: Readonly<{ accountId: AccountId; projectId: ProjectId }>,
  assignmentIds: readonly StoryWorkAssignmentId[]
): Promise<void> {
  const sorted = [...assignmentIds].sort((left, right) => left.localeCompare(right));
  for (const assignmentId of sorted) {
    await lockAssignment(db, { ...scope, assignmentId });
  }
}

async function lockCreateScope(
  db: RepositoryDatabase,
  input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    idempotencyKey: string;
    coordinationId: StoryWorkCoordinationId;
    rootAssignmentId: StoryWorkAssignmentId;
  }>
): Promise<void> {
  const scope = {
    accountId: input.accountId,
    projectId: input.projectId
  };
  const idFromKey = await lockCoordinationIdempotency(db, input);
  await lockCoordinationById(db, {
    ...scope,
    coordinationId: input.coordinationId
  });
  const coordinationIds = new Set<string>();
  if (idFromKey !== undefined) coordinationIds.add(idFromKey);
  if (input.coordinationId !== idFromKey) {
    const [byId] = await db
      .select({ id: storyWorkCoordinations.id })
      .from(storyWorkCoordinations)
      .where(eq(storyWorkCoordinations.id, input.coordinationId))
      .limit(1);
    if (byId !== undefined) coordinationIds.add(byId.id);
  }
  const assignmentIds: StoryWorkAssignmentId[] = [];
  for (const coordinationId of coordinationIds) {
    const bindings = await lockBindingsOrdered(db, coordinationId);
    const rootBinding = bindings.find((row) => row.resolvedDependency === null);
    if (rootBinding !== undefined) {
      assignmentIds.push(storyWorkAssignmentId(rootBinding.assignmentId));
    }
  }
  assignmentIds.push(input.rootAssignmentId);
  await lockAssignmentsOrdered(db, scope, assignmentIds);
}

async function lockFindCreateReplayScope(
  db: RepositoryDatabase,
  input: FindStoryWorkCoordinationCreateReplayInput
): Promise<void> {
  const idFromKey = await lockCoordinationIdempotency(db, input);
  if (idFromKey === undefined) return;
  const bindings = await lockBindingsOrdered(db, idFromKey);
  const rootBinding = bindings.find((row) => row.resolvedDependency === null);
  if (rootBinding === undefined) return;
  await lockAssignment(db, {
    accountId: input.accountId,
    projectId: input.projectId,
    assignmentId: storyWorkAssignmentId(rootBinding.assignmentId)
  });
}

async function lockBindScope(
  db: RepositoryDatabase,
  input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    coordinationId: StoryWorkCoordinationId;
    stepId: string;
  }>
): Promise<void> {
  const scope = {
    accountId: input.accountId,
    projectId: input.projectId
  };
  await lockCoordinationById(db, {
    ...scope,
    coordinationId: input.coordinationId
  });
  const bindings = await lockBindingsOrdered(db, input.coordinationId);
  const assignmentIds: StoryWorkAssignmentId[] = [];
  const rootBinding = bindings.find((row) => row.resolvedDependency === null);
  if (rootBinding !== undefined) {
    assignmentIds.push(storyWorkAssignmentId(rootBinding.assignmentId));
  }
  const stepBinding = bindings.find((row) => row.stepId === input.stepId);
  if (stepBinding !== undefined && stepBinding.resolvedDependency !== null) {
    assignmentIds.push(storyWorkAssignmentId(stepBinding.assignmentId));
  }
  await lockAssignmentsOrdered(db, scope, assignmentIds);
}

function executor(
  db: RepositoryDatabase,
  options: PostgresStoryWorkCoordinationUnitOfWorkOptions | undefined
) {
  return createRepositoryStoryWorkCoordinationExecutor({
    projects: createPostgresProjectRepository(db),
    assignments: createPostgresStoryWorkAssignmentRepository(db),
    coordinations: createPostgresStoryWorkCoordinationRepository(db),
    ...(options?.failAfter === undefined ? {} : { failAfter: options.failAfter })
  });
}

export function createPostgresStoryWorkCoordinationUnitOfWork(
  db: RepositoryDatabase,
  options?: PostgresStoryWorkCoordinationUnitOfWorkOptions
): StoryWorkCoordinationUnitOfWork {
  return Object.freeze({
    findCreateReplay(input: FindStoryWorkCoordinationCreateReplayInput) {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        await lockFindCreateReplayScope(exec, input);
        return executor(exec, options).findCreateReplay(input);
      });
    },

    create(input: CreateStoryWorkCoordinationInput) {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        const rootStep = input.coordination.steps.find((step) => step.kind === "scene-draft");
        if (rootStep === undefined || rootStep.kind !== "scene-draft") {
          throw new Error("Story work coordination create requires a scene-draft root step.");
        }
        await lockCreateScope(exec, {
          accountId: input.accountId,
          projectId: input.projectId,
          idempotencyKey: input.coordination.idempotencyKey,
          coordinationId: input.coordination.id,
          rootAssignmentId: rootStep.assignmentId
        });
        return executor(exec, options).create(input);
      });
    },

    findBindReplay(input: FindStoryWorkCoordinationBindReplayInput) {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        await lockBindScope(exec, input);
        return executor(exec, options).findBindReplay(input);
      });
    },

    bindProposalContinuityCheck(input: BindProposalContinuityCheckInput) {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        await lockBindScope(exec, input);
        return executor(exec, options).bindProposalContinuityCheck(input);
      });
    }
  });
}
