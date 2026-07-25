import type { ContextReceipt } from "./agent-context-receipt.js";
import type {
  AgentFoundationListOptions,
  ContextReceiptRepository,
  InsertContextReceiptOutcome
} from "./agent-foundation-repository.js";
import {
  normalizeAgentFoundationListLimit,
  receiptsMatch
} from "./agent-runs-proposals.js";
import type { ContextReceiptId, ProjectId } from "./domain.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

type MemoryContextReceiptState = {
  receipts: Map<string, ContextReceipt>;
};

function cloneReceipt(receipt: ContextReceipt): ContextReceipt {
  return Object.freeze({ ...receipt });
}

function cloneMemoryContextReceiptState(
  state: MemoryContextReceiptState
): MemoryContextReceiptState {
  return {
    receipts: new Map(
      [...state.receipts.entries()].map(([id, receipt]) => [id, cloneReceipt(receipt)])
    )
  };
}

function sortNewestFirst<T extends { createdAt: string; id: string }>(
  values: readonly T[]
): readonly T[] {
  return Object.freeze(
    [...values].sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
    )
  );
}

export function createMemoryContextReceiptRepository(): ContextReceiptRepository &
  MemoryTransactionalRepository {
  let state: MemoryContextReceiptState = { receipts: new Map() };
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

  const repository: ContextReceiptRepository & MemoryTransactionalRepository = {
    async get(receiptId: ContextReceiptId): Promise<ContextReceipt | undefined> {
      const receipt = state.receipts.get(receiptId);
      return receipt === undefined ? undefined : cloneReceipt(receipt);
    },
    async listByProject(projectId: ProjectId, options: AgentFoundationListOptions = {}) {
      const limit = normalizeAgentFoundationListLimit(options.limit);
      const matches = [...state.receipts.values()].filter(
        (receipt) => receipt.projectId === projectId
      );
      return sortNewestFirst(matches).slice(0, limit).map(cloneReceipt);
    },
    insertImmutable(receipt: ContextReceipt): Promise<InsertContextReceiptOutcome> {
      return serializeWrite(() => {
        const existing = state.receipts.get(receipt.id);
        if (existing !== undefined) {
          if (receiptsMatch(existing, receipt)) {
            return { ok: true, receipt: cloneReceipt(existing), created: false };
          }
          return { ok: false, reason: "conflict" };
        }
        const stored = cloneReceipt(receipt);
        state.receipts.set(stored.id, stored);
        return { ok: true, receipt: cloneReceipt(stored), created: true };
      });
    },
    [MEMORY_TRANSACTION_STATE]: {
      snapshot(): MemoryContextReceiptState {
        return cloneMemoryContextReceiptState(state);
      },
      restore(snapshot: unknown): void {
        state = cloneMemoryContextReceiptState(snapshot as MemoryContextReceiptState);
      }
    }
  };

  return repository;
}
