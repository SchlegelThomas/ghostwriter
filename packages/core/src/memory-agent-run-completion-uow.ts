import type {
  AgentProposalRepository,
  AgentRunReflectionCompletionUnitOfWork,
  AgentRunRepository,
  CompleteAgentRunReflectionInput
} from "./agent-foundation-repository.js";
import {
  AgentProposalStateConflictError,
  AgentRunStateConflictError,
  createAgentRun,
  createReadyAgentProposal
} from "./agent-runs-proposals.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

function assertTransitionOutcome(
  outcome: Awaited<ReturnType<AgentRunRepository["transition"]>>
): void {
  if (outcome.ok) return;
  if (outcome.reason === "not-found" || outcome.reason === "cross-project") {
    throw new AgentRunStateConflictError();
  }
  throw new AgentRunStateConflictError();
}

function assertProposalCreateOutcome(
  outcome: Awaited<ReturnType<AgentProposalRepository["create"]>>
): void {
  if (outcome.ok) return;
  throw new AgentProposalStateConflictError();
}

export function createMemoryAgentRunReflectionCompletionUnitOfWork(dependencies: {
  runs: AgentRunRepository;
  proposals: AgentProposalRepository;
}): AgentRunReflectionCompletionUnitOfWork {
  let transactionTail: Promise<void> = Promise.resolve();
  const repositoryParticipants = [dependencies.runs, dependencies.proposals];
  const participants = repositoryParticipants.map((repository) => {
    const participant = (repository as MemoryTransactionalRepository)[
      MEMORY_TRANSACTION_STATE
    ];
    if (participant === undefined) {
      throw new Error(
        "Memory agent run completion requires memory repository participants."
      );
    }
    return participant;
  });

  return Object.freeze({
    async completeReflection(input: CompleteAgentRunReflectionInput): Promise<void> {
      const previous = transactionTail;
      let release = (): void => undefined;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const snapshots = participants.map((participant) => participant.snapshot());
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

      try {
        const proposalOutcome = await dependencies.proposals.create(normalizedProposal);
        assertProposalCreateOutcome(proposalOutcome);
        const runOutcome = await dependencies.runs.transition({
          runId: normalizedRun.id,
          expectedStatus: "running",
          next: normalizedRun
        });
        assertTransitionOutcome(runOutcome);
      } catch (error) {
        participants.forEach((participant, index) => {
          participant.restore(snapshots[index]);
        });
        throw error;
      } finally {
        release();
      }
    }
  });
}

export function createFailingMemoryAgentRunReflectionCompletionUnitOfWork(dependencies: {
  runs: AgentRunRepository;
  proposals: AgentProposalRepository;
  failAfter: "proposal-create";
}): AgentRunReflectionCompletionUnitOfWork {
  let transactionTail: Promise<void> = Promise.resolve();
  const repositoryParticipants = [dependencies.runs, dependencies.proposals];
  const participants = repositoryParticipants.map((repository) => {
    const participant = (repository as MemoryTransactionalRepository)[
      MEMORY_TRANSACTION_STATE
    ];
    if (participant === undefined) {
      throw new Error(
        "Memory agent run completion requires memory repository participants."
      );
    }
    return participant;
  });

  return Object.freeze({
    async completeReflection(input: CompleteAgentRunReflectionInput): Promise<void> {
      const previous = transactionTail;
      let release = (): void => undefined;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const snapshots = participants.map((participant) => participant.snapshot());
      const normalizedProposal = createReadyAgentProposal(input.proposal);
      try {
        const proposalOutcome = await dependencies.proposals.create(normalizedProposal);
        assertProposalCreateOutcome(proposalOutcome);
        throw new AgentRunStateConflictError();
      } catch (error) {
        participants.forEach((participant, index) => {
          participant.restore(snapshots[index]);
        });
        throw error;
      } finally {
        release();
      }
    }
  });
}
