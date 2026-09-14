import {
  executeSceneStoryWorkReview,
  type AsyncHashPort,
  type SceneStoryWorkReviewInput,
  type SceneStoryWorkReviewUnitOfWork,
  type IdGenerator
} from "@ghostwriter/core";
import { and, eq } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import {
  createPostgresAgentProposalRepository,
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresStoryWorkAssignmentRepository } from "./postgres-story-work-repository.js";
import {
  agentProposals,
  agentRuns,
  storyWorkAssignments
} from "./schema.js";

type Dependencies = Readonly<{
  db: RepositoryDatabase;
  ids: IdGenerator;
  hashPort: AsyncHashPort;
}>;

async function lockReviewRows(
  db: RepositoryDatabase,
  input: SceneStoryWorkReviewInput
): Promise<void> {
  await db
    .select({ id: storyWorkAssignments.id })
    .from(storyWorkAssignments)
    .where(
      and(
        eq(storyWorkAssignments.id, input.assignmentId),
        eq(storyWorkAssignments.projectId, input.projectId),
        eq(storyWorkAssignments.initiatorAccountId, input.accountId)
      )
    )
    .for("update");
  const proposalRows = await db
    .select({ runId: agentProposals.runId })
    .from(agentProposals)
    .where(
      and(
        eq(agentProposals.id, input.artifact.proposalId),
        eq(agentProposals.projectId, input.projectId)
      )
    )
    .for("update");
  const runId = proposalRows[0]?.runId;
  if (runId !== undefined) {
    await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(
        and(eq(agentRuns.id, runId), eq(agentRuns.projectId, input.projectId))
      )
      .for("update");
  }
}

export function createPostgresSceneStoryWorkReviewUnitOfWork(
  dependencies: Dependencies
): SceneStoryWorkReviewUnitOfWork {
  return Object.freeze({
    review(input: SceneStoryWorkReviewInput) {
      return dependencies.db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        await lockReviewRows(exec, input);
        return executeSceneStoryWorkReview(
          {
            projects: createPostgresProjectRepository(exec),
            assignments: createPostgresStoryWorkAssignmentRepository(exec),
            proposals: createPostgresAgentProposalRepository(exec),
            runs: createPostgresAgentRunRepository(exec),
            receipts: createPostgresContextReceiptRepository(exec),
            ids: dependencies.ids,
            hashPort: dependencies.hashPort
          },
          input
        );
      });
    }
  });
}
