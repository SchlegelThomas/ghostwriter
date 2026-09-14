import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionParticipant,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";
import type { ProjectRepository } from "./project-repository.js";
import {
  createRepositoryStoryWorkCoordinationExecutor,
  type StoryWorkCoordinationRepositoryDependencies
} from "./story-work-coordination-repository-uow.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import type { StoryWorkCoordinationRepository } from "./story-work-coordination-repository.js";
import type {
  BindProposalContinuityCheckInput,
  CreateStoryWorkCoordinationInput,
  FindStoryWorkCoordinationBindReplayInput,
  FindStoryWorkCoordinationCreateReplayInput,
  StoryWorkCoordinationUnitOfWork
} from "./story-work-coordination-uow.js";

type Dependencies = StoryWorkCoordinationRepositoryDependencies &
  Readonly<{
    projects: ProjectRepository;
    assignments: StoryWorkAssignmentRepository;
    coordinations: StoryWorkCoordinationRepository;
  }>;

function participant(repository: unknown, label: string): MemoryTransactionParticipant {
  const state = (repository as MemoryTransactionalRepository)[MEMORY_TRANSACTION_STATE];
  if (state === undefined) {
    throw new Error(`Memory story work coordination requires the ${label} memory repository.`);
  }
  return state;
}

export function createMemoryStoryWorkCoordinationUnitOfWork(
  dependencies: Dependencies
): StoryWorkCoordinationUnitOfWork {
  const executor = createRepositoryStoryWorkCoordinationExecutor(dependencies);
  const participants = [
    participant(dependencies.assignments, "assignment"),
    participant(dependencies.coordinations, "coordination")
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
    findCreateReplay(input: FindStoryWorkCoordinationCreateReplayInput) {
      return transact(() => executor.findCreateReplay(input));
    },
    create(input: CreateStoryWorkCoordinationInput) {
      return transact(() => executor.create(input));
    },
    findBindReplay(input: FindStoryWorkCoordinationBindReplayInput) {
      return transact(() => executor.findBindReplay(input));
    },
    bindProposalContinuityCheck(input: BindProposalContinuityCheckInput) {
      return transact(() => executor.bindProposalContinuityCheck(input));
    }
  });
}
