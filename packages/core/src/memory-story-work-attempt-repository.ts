import { DomainValidationError, type AgentRunId } from "./domain.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";
import {
  createStoryWorkAttempt,
  STORY_WORK_ATTEMPT_LIST_MAX,
  storyWorkAttemptIdempotencyKey,
  type StoryWorkAttempt
} from "./story-work-attempt.js";
import type {
  CompareAndSetStoryWorkAttemptOutcome,
  CreateStoryWorkAttemptOutcome,
  StoryWorkAttemptRepository
} from "./story-work-attempt-repository.js";

type MemoryStoryWorkAttemptState = Map<string, StoryWorkAttempt>;

type MemoryStoryWorkAttemptSnapshot = Readonly<{
  attempts: MemoryStoryWorkAttemptState;
  attemptsByIdempotencyKey: Map<string, AgentRunId>;
}>;

function idempotencyKey(attempt: StoryWorkAttempt): string {
  return `${attempt.initiatorAccountId}\u0000${attempt.projectId}\u0000${attempt.assignmentId}\u0000${attempt.idempotencyKey}`;
}

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
  let attemptsByIdempotencyKey = new Map<string, AgentRunId>();
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
    async getByIdempotencyKey(input) {
      const runId = attemptsByIdempotencyKey.get(
        `${input.accountId}\u0000${input.projectId}\u0000${input.assignmentId}\u0000${storyWorkAttemptIdempotencyKey(input.idempotencyKey)}`
      );
      const attempt = runId === undefined ? undefined : state.get(runId);
      return attempt === undefined ? undefined : createStoryWorkAttempt(attempt);
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
        const key = idempotencyKey(attempt);
        const replayRunId = attemptsByIdempotencyKey.get(key);
        if (replayRunId !== undefined) {
          const replay = state.get(replayRunId);
          if (replay?.requestFingerprint === attempt.requestFingerprint) {
            return {
              ok: true,
              attempt: createStoryWorkAttempt(replay),
              created: false
            };
          }
          return { ok: false, reason: "idempotency-conflict" };
        }
        if (state.has(attempt.runId)) return { ok: false, reason: "duplicate-run" };
        state.set(attempt.runId, attempt);
        attemptsByIdempotencyKey.set(key, attempt.runId);
        return { ok: true, attempt: createStoryWorkAttempt(attempt), created: true };
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
          next.sourceMode !== current.sourceMode ||
          next.instruction !== current.instruction ||
          next.idempotencyKey !== current.idempotencyKey ||
          next.requestFingerprint !== current.requestFingerprint ||
          JSON.stringify(next.priorArtifact) !== JSON.stringify(current.priorArtifact) ||
          next.createdAt !== current.createdAt ||
          next.version !== current.version + 1
        ) return { ok: false, reason: "version-conflict" };
        state.set(next.runId, next);
        return { ok: true, attempt: createStoryWorkAttempt(next) };
      });
    },
    [MEMORY_TRANSACTION_STATE]: {
      snapshot: (): MemoryStoryWorkAttemptSnapshot => ({
        attempts: cloneState(state),
        attemptsByIdempotencyKey: new Map(attemptsByIdempotencyKey)
      }),
      restore(snapshot: unknown): void {
        const restored = snapshot as MemoryStoryWorkAttemptSnapshot;
        state = cloneState(restored.attempts);
        attemptsByIdempotencyKey = new Map(restored.attemptsByIdempotencyKey);
      }
    }
  };
  return repository;
}
