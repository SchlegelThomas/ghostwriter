import { DomainValidationError } from "./domain.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";
import {
  createStoryWorkAttempt,
  STORY_WORK_ATTEMPT_LIST_MAX,
  type StoryWorkAttempt
} from "./story-work-attempt.js";
import type {
  CompareAndSetStoryWorkAttemptOutcome,
  CreateStoryWorkAttemptOutcome,
  StoryWorkAttemptRepository
} from "./story-work-attempt-repository.js";

type MemoryStoryWorkAttemptState = Map<string, StoryWorkAttempt>;

function cloneState(state: MemoryStoryWorkAttemptState): MemoryStoryWorkAttemptState {
  return new Map(
    [...state.entries()].map(([id, attempt]) => [id, createStoryWorkAttempt(attempt)])
  );
}

function limit(value: number | undefined): number {
  if (value === undefined) return STORY_WORK_ATTEMPT_LIST_MAX;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Story work attempt list limit must be a positive integer."
    );
  }
  return Math.min(value, STORY_WORK_ATTEMPT_LIST_MAX);
}

export function createMemoryStoryWorkAttemptRepository(): StoryWorkAttemptRepository &
  MemoryTransactionalRepository {
  let state: MemoryStoryWorkAttemptState = new Map();
  let writeTail: Promise<void> = Promise.resolve();

  async function serializeWrite<Result>(operation: () => Result): Promise<Result> {
    const previous = writeTail;
    let release = (): void => undefined;
    writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return operation();
    } finally {
      release();
    }
  }

  const repository: StoryWorkAttemptRepository & MemoryTransactionalRepository = {
    async get(input) {
      const attempt = state.get(input.runId);
      if (
        attempt === undefined ||
        attempt.assignmentId !== input.assignmentId ||
        attempt.projectId !== input.projectId ||
        attempt.initiatorAccountId !== input.accountId
      ) return undefined;
      return createStoryWorkAttempt(attempt);
    },
    async listByAssignment(input) {
      return Object.freeze(
        [...state.values()]
          .filter(
            (attempt) =>
              attempt.assignmentId === input.assignmentId &&
              attempt.projectId === input.projectId &&
              attempt.initiatorAccountId === input.accountId
          )
          .sort(
            (left, right) =>
              right.createdAt.localeCompare(left.createdAt) ||
              right.runId.localeCompare(left.runId)
          )
          .slice(0, limit(input.limit))
          .map(createStoryWorkAttempt)
      );
    },
    create(input): Promise<CreateStoryWorkAttemptOutcome> {
      return serializeWrite(() => {
        const attempt = createStoryWorkAttempt(input.attempt);
        if (state.has(attempt.runId)) return { ok: false, reason: "duplicate-run" };
        state.set(attempt.runId, attempt);
        return { ok: true, attempt: createStoryWorkAttempt(attempt) };
      });
    },
    compareAndSet(input): Promise<CompareAndSetStoryWorkAttemptOutcome> {
      return serializeWrite(() => {
        const current = state.get(input.runId);
        if (
          current === undefined ||
          current.assignmentId !== input.assignmentId ||
          current.projectId !== input.projectId ||
          current.initiatorAccountId !== input.accountId
        ) return { ok: false, reason: "not-found" };
        if (current.version !== input.expectedVersion) {
          return { ok: false, reason: "version-conflict" };
        }
        const next = createStoryWorkAttempt(input.next);
        if (
          next.runId !== current.runId ||
          next.assignmentId !== current.assignmentId ||
          next.projectId !== current.projectId ||
          next.initiatorAccountId !== current.initiatorAccountId ||
          next.kind !== current.kind ||
          next.instruction !== current.instruction ||
          JSON.stringify(next.priorArtifact) !== JSON.stringify(current.priorArtifact) ||
          next.createdAt !== current.createdAt ||
          next.version !== current.version + 1
        ) return { ok: false, reason: "version-conflict" };
        state.set(next.runId, next);
        return { ok: true, attempt: createStoryWorkAttempt(next) };
      });
    },
    [MEMORY_TRANSACTION_STATE]: {
      snapshot: () => cloneState(state),
      restore(snapshot: unknown): void {
        state = cloneState(snapshot as MemoryStoryWorkAttemptState);
      }
    }
  };
  return repository;
}
