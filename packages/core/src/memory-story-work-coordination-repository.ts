import { canonicalJsonStringify } from "./agent-canonical-json.js";
import type { InstructionContentHash } from "./agent-domain.js";
import { DomainValidationError } from "./domain.js";
import {
  assertStoryWorkCoordinationOriginImmutable,
  createStoryWorkCoordination,
  storyWorkCoordinationDefinitionFingerprint,
  storyWorkCoordinationRequestFingerprint,
  type StoryWorkCoordination,
  type StoryWorkCoordinationId
} from "./story-work-coordination.js";
import type {
  CompareAndSetStoryWorkCoordinationOutcome,
  CreateStoryWorkCoordinationOutcome,
  StoryWorkCoordinationRepository
} from "./story-work-coordination-repository.js";
import { STORY_WORK_COORDINATION_LIST_MAX } from "./story-work-coordination-repository.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

type StoredCoordination = Readonly<{
  coordination: StoryWorkCoordination;
  requestFingerprint: InstructionContentHash;
}>;

function cloneCoordination(coordination: StoryWorkCoordination): StoryWorkCoordination {
  return createStoryWorkCoordination(coordination);
}

function scopeKey(accountId: string, projectId: string): string {
  return `${accountId}\u0000${projectId}`;
}

function idempotencyKey(coordination: StoryWorkCoordination): string {
  return `${scopeKey(coordination.initiatorAccountId, coordination.projectId)}\u0000${coordination.idempotencyKey}`;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return STORY_WORK_COORDINATION_LIST_MAX;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Story work coordination list limit must be a positive integer."
    );
  }
  return Math.min(limit, STORY_WORK_COORDINATION_LIST_MAX);
}

function stepBindings(coordination: StoryWorkCoordination): readonly string[] {
  return coordination.steps.map((step) =>
    step.kind === "proposal-continuity-check" && step.binding !== undefined
      ? canonicalJsonStringify(step.binding)
      : ""
  );
}

function casTransitionPermitted(
  previous: StoryWorkCoordination,
  next: StoryWorkCoordination
): boolean {
  const previousBindings = stepBindings(previous);
  const nextBindings = stepBindings(next);
  for (let index = 0; index < previousBindings.length; index += 1) {
    const prior = previousBindings[index]!;
    const updated = nextBindings[index]!;
    if (prior.length > 0 && prior !== updated) {
      return false;
    }
    if (prior.length > 0 && updated.length === 0) {
      return false;
    }
  }
  const addedBindings = nextBindings.filter((binding, index) => {
    return binding.length > 0 && previousBindings[index]!.length === 0;
  }).length;
  if (addedBindings > 1) {
    return false;
  }
  if (previous.status === "canceled") {
    return next.status === "canceled" && addedBindings === 0;
  }
  if (next.status === "canceled") {
    return previous.status === "active" && addedBindings === 0;
  }
  if (next.status !== previous.status) {
    return false;
  }
  if (addedBindings === 1 && previous.status !== "active") {
    return false;
  }
  return true;
}

export function createMemoryStoryWorkCoordinationRepository(): StoryWorkCoordinationRepository &
  MemoryTransactionalRepository {
  const coordinations = new Map<string, StoredCoordination>();
  const coordinationsByIdempotencyKey = new Map<string, StoryWorkCoordinationId>();
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

  const repository: StoryWorkCoordinationRepository & MemoryTransactionalRepository = {
    async get(input) {
      const stored = coordinations.get(input.coordinationId);
      if (
        stored === undefined ||
        stored.coordination.projectId !== input.projectId ||
        stored.coordination.initiatorAccountId !== input.accountId
      ) {
        return undefined;
      }
      return cloneCoordination(stored.coordination);
    },

    async getByIdempotencyKey(input) {
      const coordinationId = coordinationsByIdempotencyKey.get(
        `${scopeKey(input.accountId, input.projectId)}\u0000${input.idempotencyKey}`
      );
      const stored =
        coordinationId === undefined ? undefined : coordinations.get(coordinationId);
      if (
        stored === undefined ||
        stored.coordination.projectId !== input.projectId ||
        stored.coordination.initiatorAccountId !== input.accountId
      ) {
        return undefined;
      }
      return Object.freeze({
        coordination: cloneCoordination(stored.coordination),
        requestFingerprint: stored.requestFingerprint
      });
    },

    async listByProject(input) {
      const limit = normalizeLimit(input.options?.limit);
      return Object.freeze(
        [...coordinations.values()]
          .map((stored) => stored.coordination)
          .filter(
            (coordination) =>
              coordination.projectId === input.projectId &&
              coordination.initiatorAccountId === input.accountId
          )
          .sort(
            (left, right) =>
              right.updatedAt.localeCompare(left.updatedAt) ||
              right.id.localeCompare(left.id)
          )
          .slice(0, limit)
          .map(cloneCoordination)
      );
    },

    async listByMcpGrantOrigin(input) {
      const limit = normalizeLimit(input.options?.limit);
      return Object.freeze(
        [...coordinations.values()]
          .map((stored) => stored.coordination)
          .filter(
            (coordination) =>
              coordination.projectId === input.projectId &&
              coordination.initiatorAccountId === input.accountId &&
              coordination.origin?.kind === "mcp" &&
              coordination.origin.grantId === input.originMcpGrantId
          )
          .sort(
            (left, right) =>
              right.updatedAt.localeCompare(left.updatedAt) ||
              right.id.localeCompare(left.id)
          )
          .slice(0, limit)
          .map(cloneCoordination)
      );
    },

    create(input): Promise<CreateStoryWorkCoordinationOutcome> {
      return serializeWrite(() => {
        const coordination = cloneCoordination(input.coordination);
        const requestFingerprint = storyWorkCoordinationRequestFingerprint(
          input.requestFingerprint
        );
        const key = idempotencyKey(coordination);
        const replayId = coordinationsByIdempotencyKey.get(key);
        if (replayId !== undefined) {
          const replay = coordinations.get(replayId);
          if (replay?.requestFingerprint === requestFingerprint) {
            return {
              ok: true,
              coordination: cloneCoordination(replay.coordination),
              created: false
            };
          }
          return { ok: false, reason: "idempotency-conflict" };
        }
        if (coordinations.has(coordination.id)) {
          return { ok: false, reason: "duplicate-id" };
        }
        coordinations.set(coordination.id, {
          coordination,
          requestFingerprint
        });
        coordinationsByIdempotencyKey.set(key, coordination.id);
        return { ok: true, coordination: cloneCoordination(coordination), created: true };
      });
    },

    compareAndSet(input): Promise<CompareAndSetStoryWorkCoordinationOutcome> {
      return serializeWrite(() => {
        const stored = coordinations.get(input.coordinationId);
        if (
          stored === undefined ||
          stored.coordination.projectId !== input.projectId ||
          stored.coordination.initiatorAccountId !== input.accountId
        ) {
          return { ok: false, reason: "not-found" };
        }
        if (stored.coordination.version !== input.expectedVersion) {
          return { ok: false, reason: "version-conflict" };
        }
        const next = cloneCoordination(input.next);
        try {
          assertStoryWorkCoordinationOriginImmutable(stored.coordination, next);
        } catch {
          return { ok: false, reason: "version-conflict" };
        }
        if (
          next.id !== stored.coordination.id ||
          next.projectId !== stored.coordination.projectId ||
          next.initiatorAccountId !== stored.coordination.initiatorAccountId ||
          next.idempotencyKey !== stored.coordination.idempotencyKey ||
          next.createdAt !== stored.coordination.createdAt ||
          next.version !== stored.coordination.version + 1 ||
          storyWorkCoordinationDefinitionFingerprint(next) !==
            storyWorkCoordinationDefinitionFingerprint(stored.coordination)
        ) {
          return { ok: false, reason: "version-conflict" };
        }
        if (!casTransitionPermitted(stored.coordination, next)) {
          return { ok: false, reason: "version-conflict" };
        }
        coordinations.set(next.id, {
          coordination: next,
          requestFingerprint: stored.requestFingerprint
        });
        return { ok: true, coordination: cloneCoordination(next) };
      });
    },

    [MEMORY_TRANSACTION_STATE]: {
      snapshot() {
        return {
          coordinations: new Map(
            [...coordinations.entries()].map(([id, stored]) => [
              id,
              {
                coordination: cloneCoordination(stored.coordination),
                requestFingerprint: stored.requestFingerprint
              }
            ])
          ),
          coordinationsByIdempotencyKey: new Map(coordinationsByIdempotencyKey)
        };
      },
      restore(snapshot: unknown): void {
        const restored = snapshot as Readonly<{
          coordinations: Map<string, StoredCoordination>;
          coordinationsByIdempotencyKey: Map<string, StoryWorkCoordinationId>;
        }>;
        coordinations.clear();
        for (const [id, stored] of restored.coordinations) {
          coordinations.set(id, {
            coordination: cloneCoordination(stored.coordination),
            requestFingerprint: stored.requestFingerprint
          });
        }
        coordinationsByIdempotencyKey.clear();
        for (const [key, id] of restored.coordinationsByIdempotencyKey) {
          coordinationsByIdempotencyKey.set(key, id);
        }
      }
    }
  };
  return Object.freeze(repository);
}
