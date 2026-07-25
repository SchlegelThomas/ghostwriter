import {
  AgentProposalStateConflictError,
  AgentRunStateConflictError,
  createAgentRun,
  createReadyAgentProposal,
  type AgentRunReflectionCompletionUnitOfWork,
  type CompleteAgentRunReflectionInput
} from "@ghostwriter/core";
import type { RepositoryDatabase } from "./client.js";
import {
  createPostgresAgentProposalRepository,
  createPostgresAgentRunRepository
} from "./postgres-agent-foundation-repository.js";

function assertTransitionOutcome(
  outcome: Awaited<
    ReturnType<ReturnType<typeof createPostgresAgentRunRepository>["transition"]>
  >
): void {
  if (outcome.ok) return;
  throw new AgentRunStateConflictError();
}

function assertProposalCreateOutcome(
  outcome: Awaited<
    ReturnType<ReturnType<typeof createPostgresAgentProposalRepository>["create"]>
  >
): void {
  if (outcome.ok) return;
  throw new AgentProposalStateConflictError();
}

export function createPostgresAgentRunReflectionCompletionUnitOfWork(
  db: RepositoryDatabase
): AgentRunReflectionCompletionUnitOfWork {
  return Object.freeze({
    async completeReflection(input: CompleteAgentRunReflectionInput): Promise<void> {
      const normalizedRun = createAgentRun(input.run);
      const normalizedProposal = createReadyAgentProposal(input.proposal);
      if (normalizedRun.id !== normalizedProposal.runId) {
        throw new AgentRunStateConflictError();
      }
      if (normalizedRun.projectId !== normalizedProposal.projectId) {
        throw new AgentRunStateConflictError();
      }
      if (normalizedRun.receiptId !== normalizedProposal.receiptId) {
        throw new AgentRunStateConflictError();
      }
      if (normalizedRun.status !== "ready") {
        throw new AgentRunStateConflictError();
      }

      await db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        const runs = createPostgresAgentRunRepository(exec);
        const proposals = createPostgresAgentProposalRepository(exec);
        const proposalOutcome = await proposals.create(normalizedProposal);
        assertProposalCreateOutcome(proposalOutcome);
        const runOutcome = await runs.transition({
          runId: normalizedRun.id,
          expectedStatus: "running",
          next: normalizedRun
        });
        assertTransitionOutcome(runOutcome);
      });
    }
  });
}
