import type {
  AgentRunRepository
} from "./agent-foundation-repository.js";
import type { ProjectRepository } from "./project-repository.js";
import {
  createRepositoryStoryWorkRecoveryExecutor,
  type RecoverActiveStoryWorkAttemptInput,
  type RecoverActiveStoryWorkAttemptResult,
  type StoryWorkRecoveryRepositoryDependencies,
  type StoryWorkRecoveryUnitOfWork
} from "./story-work-recovery.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import type { StoryWorkAttemptRepository } from "./story-work-attempt-repository.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionParticipant,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

type Dependencies = StoryWorkRecoveryRepositoryDependencies &
  Readonly<{
    projects: ProjectRepository;
    assignments: StoryWorkAssignmentRepository;
    attempts: StoryWorkAttemptRepository;
    runs: AgentRunRepository;
  }>;

function participant(repository: unknown, label: string): MemoryTransactionParticipant {
  const state = (repository as MemoryTransactionalRepository)[MEMORY_TRANSACTION_STATE];
  if (state === undefined) {
    throw new Error(`Memory story work recovery requires the ${label} memory repository.`);
  }
  return state;
}

export function createMemoryStoryWorkRecoveryUnitOfWork(
  dependencies: Dependencies
): StoryWorkRecoveryUnitOfWork {
  const executor = createRepositoryStoryWorkRecoveryExecutor(dependencies);
  const participants = [
    participant(dependencies.assignments, "assignment"),
    participant(dependencies.runs, "run")
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
    recoverActiveStoryWorkAttempt(
      input: RecoverActiveStoryWorkAttemptInput
    ): Promise<RecoverActiveStoryWorkAttemptResult> {
      return transact(() => executor.recoverActiveStoryWorkAttempt(input));
    }
  });
}
