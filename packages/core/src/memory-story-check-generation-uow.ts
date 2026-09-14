import type {
  AgentProposalRepository,
  AgentRunRepository,
  ContextReceiptRepository
} from "./agent-foundation-repository.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionParticipant,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";
import type { ProjectRepository } from "./project-repository.js";
import {
  createRepositoryStoryCheckGenerationExecutor,
  type StoryCheckGenerationRepositoryDependencies
} from "./story-check-generation-repository-uow.js";
import type {
  BeginStoryCheckGenerationInput,
  CompleteStoryCheckGenerationInput,
  FinishStoryCheckGenerationInput,
  StoryCheckGenerationUnitOfWork
} from "./story-check-generation-uow.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import type { StoryWorkAttemptRepository } from "./story-work-attempt-repository.js";

type Dependencies = StoryCheckGenerationRepositoryDependencies &
  Readonly<{
    projects: ProjectRepository;
    assignments: StoryWorkAssignmentRepository;
    attempts: StoryWorkAttemptRepository;
    receipts: ContextReceiptRepository;
    runs: AgentRunRepository;
    proposals: AgentProposalRepository;
  }>;

function participant(repository: unknown, label: string): MemoryTransactionParticipant {
  const state = (repository as MemoryTransactionalRepository)[MEMORY_TRANSACTION_STATE];
  if (state === undefined) {
    throw new Error(`Memory story check generation requires the ${label} memory repository.`);
  }
  return state;
}

export function createMemoryStoryCheckGenerationUnitOfWork(
  dependencies: Dependencies
): StoryCheckGenerationUnitOfWork {
  const executor = createRepositoryStoryCheckGenerationExecutor(dependencies);
  const participants = [
    participant(dependencies.assignments, "assignment"),
    participant(dependencies.attempts, "attempt"),
    participant(dependencies.receipts, "receipt"),
    participant(dependencies.runs, "run"),
    participant(dependencies.proposals, "proposal")
  ];
  let transactionTail: Promise<void> = Promise.resolve();

  async function transact<Result>(operation: () => Promise<Result>): Promise<Result> {
    const previous = transactionTail;
    let release = (): void => undefined;
    transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshots = participants.map((entry) => entry.snapshot());
    try {
      return await operation();
    } catch (error) {
      participants.forEach((entry, index) => entry.restore(snapshots[index]));
      throw error;
    } finally {
      release();
    }
  }

  return Object.freeze({
    findReplay: executor.findReplay,
    begin(input: BeginStoryCheckGenerationInput) {
      return transact(() => executor.begin(input));
    },
    complete(input: CompleteStoryCheckGenerationInput) {
      return transact(() => executor.complete(input));
    },
    finishWithoutArtifact(input: FinishStoryCheckGenerationInput) {
      return transact(() => executor.finishWithoutArtifact(input));
    }
  });
}
