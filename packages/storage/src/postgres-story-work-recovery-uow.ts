import {
  createRepositoryStoryWorkRecoveryExecutor,
  type RecoverActiveStoryWorkAttemptInput,
  type StoryWorkAssignmentId,
  type StoryWorkRecoveryUnitOfWork
} from "@ghostwriter/core";
import { and, eq } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import { createPostgresAgentRunRepository } from "./postgres-agent-foundation-repository.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import {
  createPostgresStoryWorkAssignmentRepository,
  createPostgresStoryWorkAttemptRepository
} from "./postgres-story-work-repository.js";
import { agentRuns, storyWorkAssignments, storyWorkAttempts } from "./schema.js";

type Scope = Readonly<{
  accountId: RecoverActiveStoryWorkAttemptInput["accountId"];
  projectId: RecoverActiveStoryWorkAttemptInput["projectId"];
  assignmentId: StoryWorkAssignmentId;
}>;

/**
 * Lock order matches story-work generation UOWs: owner-scoped assignment, then the
 * exact attempt row, then the run row. `story_work_attempts.run_id` references
 * `agent_runs.id`, so attempt-before-run keeps FK-safe ordering consistent with
 * `complete` / `finishWithoutArtifact` paths. Predicates are identity-only (no
 * active-status filter) so terminal replay can load rows under the same locks.
 */
async function lockAssignment(db: RepositoryDatabase, scope: Scope): Promise<void> {
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

async function lockAttemptAndRun(
  db: RepositoryDatabase,
  scope: Scope,
  runId: RecoverActiveStoryWorkAttemptInput["runId"]
): Promise<void> {
  await db
    .select({ id: storyWorkAttempts.runId })
    .from(storyWorkAttempts)
    .where(
      and(
        eq(storyWorkAttempts.runId, runId),
        eq(storyWorkAttempts.assignmentId, scope.assignmentId),
        eq(storyWorkAttempts.projectId, scope.projectId),
        eq(storyWorkAttempts.initiatorAccountId, scope.accountId)
      )
    )
    .for("update");
  await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.projectId, scope.projectId)))
    .for("update");
}

function executor(db: RepositoryDatabase) {
  return createRepositoryStoryWorkRecoveryExecutor({
    projects: createPostgresProjectRepository(db),
    assignments: createPostgresStoryWorkAssignmentRepository(db),
    attempts: createPostgresStoryWorkAttemptRepository(db),
    runs: createPostgresAgentRunRepository(db)
  });
}

export function createPostgresStoryWorkRecoveryUnitOfWork(
  db: RepositoryDatabase
): StoryWorkRecoveryUnitOfWork {
  return Object.freeze({
    recoverActiveStoryWorkAttempt(input: RecoverActiveStoryWorkAttemptInput) {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        const scope = {
          accountId: input.accountId,
          projectId: input.projectId,
          assignmentId: input.assignmentId
        };
        await lockAssignment(exec, scope);
        await lockAttemptAndRun(exec, scope, input.runId);
        return executor(exec).recoverActiveStoryWorkAttempt(input);
      });
    }
  });
}
