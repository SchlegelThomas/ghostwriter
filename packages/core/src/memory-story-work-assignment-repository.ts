import type { InstructionContentHash } from "./agent-domain.js";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import { DomainValidationError } from "./domain.js";
import {
  STORY_WORK_ASSIGNMENT_LIST_MAX,
  createStoryWorkAssignment,
  storyWorkAssignmentRequestFingerprint,
  type StoryWorkAssignment,
  type StoryWorkAssignmentId
} from "./story-work-assignment.js";
import type {
  CompareAndSetStoryWorkAssignmentOutcome,
  CreateStoryWorkAssignmentOutcome,
  StoryWorkAssignmentRepository
} from "./story-work-assignment-repository.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

type StoredAssignment = Readonly<{
  assignment: StoryWorkAssignment;
  requestFingerprint: InstructionContentHash;
}>;

function cloneAssignment(assignment: StoryWorkAssignment): StoryWorkAssignment {
  return createStoryWorkAssignment(assignment);
}

function scopeKey(accountId: string, projectId: string): string {
  return `${accountId}\u0000${projectId}`;
}

function idempotencyKey(assignment: StoryWorkAssignment): string {
  return `${scopeKey(assignment.initiatorAccountId, assignment.projectId)}\u0000${assignment.idempotencyKey}`;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return STORY_WORK_ASSIGNMENT_LIST_MAX;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Story work assignment list limit must be a positive integer."
    );
  }
  return Math.min(limit, STORY_WORK_ASSIGNMENT_LIST_MAX);
}

function assignmentDefinitionFingerprint(assignment: StoryWorkAssignment): string {
  return canonicalJsonStringify({
    taskKind: assignment.taskKind,
    brief: assignment.brief,
    constraints: assignment.constraints,
    doneWhen: assignment.doneWhen,
    sources: assignment.sources,
    destination: assignment.destination,
    provider: assignment.provider,
    model: assignment.model,
    steps: assignment.steps
  });
}

export function createMemoryStoryWorkAssignmentRepository(): StoryWorkAssignmentRepository &
  MemoryTransactionalRepository {
  const assignments = new Map<string, StoredAssignment>();
  const assignmentsByIdempotencyKey = new Map<string, StoryWorkAssignmentId>();
  let writeTail: Promise<void> = Promise.resolve();

  async function serializeWrite<Result>(
    operation: () => Result | Promise<Result>
  ): Promise<Result> {
    const previous = writeTail;
    let release = (): void => undefined;
    writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  const repository: StoryWorkAssignmentRepository & MemoryTransactionalRepository = {
    async get(input) {
      const stored = assignments.get(input.assignmentId);
      if (
        stored === undefined ||
        stored.assignment.projectId !== input.projectId ||
        stored.assignment.initiatorAccountId !== input.accountId
      ) {
        return undefined;
      }
      return cloneAssignment(stored.assignment);
    },

    async getByIdempotencyKey(input) {
      const assignmentId = assignmentsByIdempotencyKey.get(
        `${scopeKey(input.accountId, input.projectId)}\u0000${input.idempotencyKey}`
      );
      const stored = assignmentId === undefined
        ? undefined
        : assignments.get(assignmentId);
      if (
        stored === undefined ||
        stored.assignment.projectId !== input.projectId ||
        stored.assignment.initiatorAccountId !== input.accountId
      ) {
        return undefined;
      }
      return Object.freeze({
        assignment: cloneAssignment(stored.assignment),
        requestFingerprint: stored.requestFingerprint
      });
    },

    async listByProject(input) {
      const limit = normalizeLimit(input.options?.limit);
      return Object.freeze(
        [...assignments.values()]
          .map((stored) => stored.assignment)
          .filter(
            (assignment) =>
              assignment.projectId === input.projectId &&
              assignment.initiatorAccountId === input.accountId &&
              (input.options?.status === undefined ||
                assignment.status === input.options.status)
          )
          .sort(
            (left, right) =>
              right.updatedAt.localeCompare(left.updatedAt) ||
              right.id.localeCompare(left.id)
          )
          .slice(0, limit)
          .map(cloneAssignment)
      );
    },

    create(input): Promise<CreateStoryWorkAssignmentOutcome> {
      return serializeWrite(() => {
        const assignment = cloneAssignment(input.assignment);
        const requestFingerprint = storyWorkAssignmentRequestFingerprint(
          input.requestFingerprint
        );
        const key = idempotencyKey(assignment);
        const replayId = assignmentsByIdempotencyKey.get(key);
        if (replayId !== undefined) {
          const replay = assignments.get(replayId);
          if (replay?.requestFingerprint === requestFingerprint) {
            return {
              ok: true,
              assignment: cloneAssignment(replay.assignment),
              created: false
            };
          }
          return { ok: false, reason: "idempotency-conflict" };
        }
        if (assignments.has(assignment.id)) {
          return { ok: false, reason: "duplicate-id" };
        }
        assignments.set(assignment.id, {
          assignment,
          requestFingerprint
        });
        assignmentsByIdempotencyKey.set(key, assignment.id);
        return { ok: true, assignment: cloneAssignment(assignment), created: true };
      });
    },

    compareAndSet(input): Promise<CompareAndSetStoryWorkAssignmentOutcome> {
      return serializeWrite(() => {
        const stored = assignments.get(input.assignmentId);
        if (
          stored === undefined ||
          stored.assignment.projectId !== input.projectId ||
          stored.assignment.initiatorAccountId !== input.accountId
        ) {
          return { ok: false, reason: "not-found" };
        }
        if (stored.assignment.version !== input.expectedVersion) {
          return { ok: false, reason: "version-conflict" };
        }
        const next = cloneAssignment(input.next);
        if (
          next.id !== stored.assignment.id ||
          next.projectId !== stored.assignment.projectId ||
          next.initiatorAccountId !== stored.assignment.initiatorAccountId ||
          next.idempotencyKey !== stored.assignment.idempotencyKey ||
          next.createdAt !== stored.assignment.createdAt ||
          next.version !== stored.assignment.version + 1 ||
          assignmentDefinitionFingerprint(next) !==
            assignmentDefinitionFingerprint(stored.assignment)
        ) {
          return { ok: false, reason: "version-conflict" };
        }
        const currentHasApplyIdentity =
          stored.assignment.applyIdempotencyKey !== undefined;
        const changesApplyIdentity =
          next.applyIdempotencyKey !== stored.assignment.applyIdempotencyKey ||
          next.applyRequestFingerprint !==
            stored.assignment.applyRequestFingerprint;
        if (
          (currentHasApplyIdentity && changesApplyIdentity) ||
          (stored.assignment.status === "applied" && changesApplyIdentity) ||
          (!currentHasApplyIdentity &&
            changesApplyIdentity &&
            next.status !== "applied")
        ) {
          return { ok: false, reason: "version-conflict" };
        }
        assignments.set(next.id, {
          assignment: next,
          requestFingerprint: stored.requestFingerprint
        });
        return { ok: true, assignment: cloneAssignment(next) };
      });
    },
    [MEMORY_TRANSACTION_STATE]: {
      snapshot() {
        return {
          assignments: new Map(
            [...assignments.entries()].map(([id, stored]) => [
              id,
              {
                assignment: cloneAssignment(stored.assignment),
                requestFingerprint: stored.requestFingerprint
              }
            ])
          ),
          assignmentsByIdempotencyKey: new Map(assignmentsByIdempotencyKey)
        };
      },
      restore(snapshot: unknown): void {
        const restored = snapshot as Readonly<{
          assignments: Map<string, StoredAssignment>;
          assignmentsByIdempotencyKey: Map<string, StoryWorkAssignmentId>;
        }>;
        assignments.clear();
        for (const [id, stored] of restored.assignments) {
          assignments.set(id, {
            assignment: cloneAssignment(stored.assignment),
            requestFingerprint: stored.requestFingerprint
          });
        }
        assignmentsByIdempotencyKey.clear();
        for (const [key, id] of restored.assignmentsByIdempotencyKey) {
          assignmentsByIdempotencyKey.set(key, id);
        }
      }
    }
  };
  return Object.freeze(repository);
}
