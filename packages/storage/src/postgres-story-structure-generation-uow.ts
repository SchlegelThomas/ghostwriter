import {
  createRepositoryStoryStructureGenerationExecutor,
  type BeginStoryStructureGenerationInput,
  type CompleteStoryStructureGenerationInput,
  type FindStoryStructureGenerationReplayInput,
  type FinishStoryStructureGenerationInput,
  type StoryStructureGenerationUnitOfWork,
  type StoryWorkAssignmentId
} from "@ghostwriter/core";
import { and, eq } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import {
  createPostgresAgentProposalRepository,
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import {
  createPostgresStoryWorkAssignmentRepository,
  createPostgresStoryWorkAttemptRepository
} from "./postgres-story-work-repository.js";
import { agentRuns, storyWorkAssignments, storyWorkAttempts } from "./schema.js";

type Scope = Readonly<{
  accountId: BeginStoryStructureGenerationInput["accountId"];
  projectId: BeginStoryStructureGenerationInput["projectId"];
  assignmentId: StoryWorkAssignmentId;
}>;

async function lockAssignment(
  db: RepositoryDatabase,
  scope: Scope
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

async function lockAttemptAndRun(
  db: RepositoryDatabase,
  scope: Scope,
  runId: CompleteStoryStructureGenerationInput["readyRun"]["id"]
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
  return createRepositoryStoryStructureGenerationExecutor({
    projects: createPostgresProjectRepository(db),
    assignments: createPostgresStoryWorkAssignmentRepository(db),
    attempts: createPostgresStoryWorkAttemptRepository(db),
    receipts: createPostgresContextReceiptRepository(db),
    runs: createPostgresAgentRunRepository(db),
    proposals: createPostgresAgentProposalRepository(db)
  });
}

export function createPostgresStoryStructureGenerationUnitOfWork(
  db: RepositoryDatabase
): StoryStructureGenerationUnitOfWork {
  return Object.freeze({
    findReplay(input: FindStoryStructureGenerationReplayInput) {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        await lockAssignment(exec, input);
        return executor(exec).findReplay(input);
      });
    },

    begin(input: BeginStoryStructureGenerationInput) {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        await lockAssignment(exec, {
          accountId: input.accountId,
          projectId: input.projectId,
          assignmentId: input.runningAssignment.id
        });
        return executor(exec).begin(input);
      });
    },

    complete(input: CompleteStoryStructureGenerationInput) {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        const scope = {
          accountId: input.accountId,
          projectId: input.projectId,
          assignmentId: input.artifactReadyAssignment.id
        };
        await lockAssignment(exec, scope);
        await lockAttemptAndRun(exec, scope, input.readyRun.id);
        return executor(exec).complete(input);
      });
    },

    finishWithoutArtifact(input: FinishStoryStructureGenerationInput) {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        const scope = {
          accountId: input.accountId,
          projectId: input.projectId,
          assignmentId: input.terminalAssignment.id
        };
        await lockAssignment(exec, scope);
        await lockAttemptAndRun(exec, scope, input.terminalRun.id);
        return executor(exec).finishWithoutArtifact(input);
      });
    }
  });
}
