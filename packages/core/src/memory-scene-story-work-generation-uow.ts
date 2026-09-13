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
  createRepositorySceneStoryWorkGenerationExecutor,
  type SceneStoryWorkGenerationRepositoryDependencies
} from "./scene-story-work-generation-repository-uow.js";
import type {
  BeginSceneStoryWorkGenerationInput,
  CompleteSceneStoryWorkGenerationInput,
  FinishSceneStoryWorkGenerationInput,
  SceneStoryWorkGenerationUnitOfWork
} from "./scene-story-work-generation-uow.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import type { StoryWorkAttemptRepository } from "./story-work-attempt-repository.js";

type Dependencies = SceneStoryWorkGenerationRepositoryDependencies &
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
    throw new Error(`Memory scene generation requires the ${label} memory repository.`);
  }
  return state;
}

export function createMemorySceneStoryWorkGenerationUnitOfWork(
  dependencies: Dependencies
): SceneStoryWorkGenerationUnitOfWork {
  const executor = createRepositorySceneStoryWorkGenerationExecutor(dependencies);
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
    begin(input: BeginSceneStoryWorkGenerationInput) {
      return transact(() => executor.begin(input));
    },
    complete(input: CompleteSceneStoryWorkGenerationInput) {
      return transact(() => executor.complete(input));
    },
    finishWithoutArtifact(input: FinishSceneStoryWorkGenerationInput) {
      return transact(() => executor.finishWithoutArtifact(input));
    }
  });
}
