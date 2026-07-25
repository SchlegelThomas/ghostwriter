import type { ProjectId } from "./domain.js";
import type {
  InsertMcpGrantOutcome,
  McpGrantRepository,
  RevokeMcpGrantOutcome
} from "./mcp-grant-repository.js";
import {
  createMcpGrantRecord,
  type McpGrantId,
  type McpGrantRecord,
  type McpGrantTokenHash
} from "./mcp-grants.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

type MemoryMcpGrantState = {
  byId: Map<string, McpGrantRecord>;
  byTokenHash: Map<string, string>;
};

function cloneGrant(grant: McpGrantRecord): McpGrantRecord {
  return createMcpGrantRecord(grant);
}

function cloneState(state: MemoryMcpGrantState): MemoryMcpGrantState {
  return {
    byId: new Map(
      [...state.byId.entries()].map(([id, grant]) => [id, cloneGrant(grant)])
    ),
    byTokenHash: new Map(state.byTokenHash)
  };
}

export function createMemoryMcpGrantRepository(): McpGrantRepository &
  MemoryTransactionalRepository {
  let state: MemoryMcpGrantState = {
    byId: new Map(),
    byTokenHash: new Map()
  };
  let writeTail: Promise<void> = Promise.resolve();

  async function serializeWrite<Result>(
    operation: () => Result | Promise<Result>
  ): Promise<Result> {
    const previousWrite = writeTail;
    let release = (): void => undefined;
    writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previousWrite;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  const repository: McpGrantRepository & MemoryTransactionalRepository = {
    async getById(id: McpGrantId): Promise<McpGrantRecord | undefined> {
      const grant = state.byId.get(String(id));
      return grant === undefined ? undefined : cloneGrant(grant);
    },

    async getByTokenHash(
      tokenHash: McpGrantTokenHash
    ): Promise<McpGrantRecord | undefined> {
      const id = state.byTokenHash.get(String(tokenHash));
      if (id === undefined) return undefined;
      const grant = state.byId.get(id);
      return grant === undefined ? undefined : cloneGrant(grant);
    },

    async listByProject(projectId: ProjectId): Promise<readonly McpGrantRecord[]> {
      return Object.freeze(
        [...state.byId.values()]
          .filter((grant) => grant.projectId === projectId)
          .map(cloneGrant)
          .sort(
            (left, right) =>
              right.createdAt.localeCompare(left.createdAt) ||
              right.id.localeCompare(left.id)
          )
      );
    },

    insert(grant) {
      return serializeWrite((): InsertMcpGrantOutcome => {
        const stored = cloneGrant(grant);
        if (state.byId.has(String(stored.id))) {
          return { ok: false, reason: "conflict" };
        }
        if (state.byTokenHash.has(String(stored.tokenHash))) {
          return { ok: false, reason: "conflict" };
        }
        state.byId.set(String(stored.id), stored);
        state.byTokenHash.set(String(stored.tokenHash), String(stored.id));
        return { ok: true, grant: cloneGrant(stored) };
      });
    },

    revoke(input) {
      return serializeWrite((): RevokeMcpGrantOutcome => {
        const existing = state.byId.get(String(input.id));
        if (existing === undefined || existing.projectId !== input.projectId) {
          return { ok: false, reason: "not-found" };
        }
        if (existing.revokedAt !== undefined) {
          return { ok: false, reason: "already-revoked" };
        }
        const revoked = cloneGrant({
          ...existing,
          revokedAt: input.revokedAt,
          updatedAt: input.updatedAt
        });
        state.byId.set(String(revoked.id), revoked);
        return { ok: true, grant: cloneGrant(revoked) };
      });
    },

    [MEMORY_TRANSACTION_STATE]: {
      snapshot() {
        return cloneState(state);
      },
      restore(snapshot: unknown) {
        state = cloneState(snapshot as MemoryMcpGrantState);
      }
    }
  };

  return Object.freeze(repository);
}
