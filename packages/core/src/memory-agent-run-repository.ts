import type {
  AgentFoundationListOptions,
  AgentRunRepository,
  CreateAgentRunOutcome,
  TransitionAgentRunInput,
  TransitionAgentRunOutcome
} from "./agent-foundation-repository.js";
import {
  assertAgentRunTransition,
  agentRunIdentityMatches,
  createAgentRun,
  createQueuedAgentRun,
  normalizeAgentFoundationListLimit,
  type AgentRun
} from "./agent-runs-proposals.js";
import type { AgentRunId, ProjectId } from "./domain.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

type MemoryAgentRunState = {
  runs: Map<string, AgentRun>;
};

function cloneRun(run: AgentRun): AgentRun {
  return createAgentRun(run);
}

function cloneMemoryAgentRunState(state: MemoryAgentRunState): MemoryAgentRunState {
  return {
    runs: new Map([...state.runs.entries()].map(([id, run]) => [id, cloneRun(run)]))
  };
}

function sortNewestFirstRuns(runs: readonly AgentRun[]): readonly AgentRun[] {
  return Object.freeze(
    [...runs].sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
    )
  );
}

export function createMemoryAgentRunRepository(): AgentRunRepository &
  MemoryTransactionalRepository {
  let state: MemoryAgentRunState = { runs: new Map() };
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

  const repository: AgentRunRepository & MemoryTransactionalRepository = {
    async get(runId: AgentRunId): Promise<AgentRun | undefined> {
      const run = state.runs.get(runId);
      return run === undefined ? undefined : cloneRun(run);
    },
    async listByProject(projectId: ProjectId, options: AgentFoundationListOptions = {}) {
      const limit = normalizeAgentFoundationListLimit(options.limit);
      const matches = [...state.runs.values()].filter((run) => run.projectId === projectId);
      return sortNewestFirstRuns(matches).slice(0, limit).map(cloneRun);
    },
    create(run: AgentRun): Promise<CreateAgentRunOutcome> {
      return serializeWrite(() => {
        const normalized = createQueuedAgentRun(run);
        if (state.runs.has(normalized.id)) {
          return { ok: false, reason: "duplicate-id" };
        }
        state.runs.set(normalized.id, normalized);
        return { ok: true, run: cloneRun(normalized) };
      });
    },
    transition(input: TransitionAgentRunInput): Promise<TransitionAgentRunOutcome> {
      return serializeWrite(() => {
        const current = state.runs.get(input.runId);
        if (current === undefined) {
          return { ok: false, reason: "not-found" };
        }
        if (current.projectId !== input.next.projectId) {
          return { ok: false, reason: "cross-project" };
        }
        if (current.status !== input.expectedStatus) {
          return { ok: false, reason: "status-conflict" };
        }
        if (!agentRunIdentityMatches(current, input.next)) {
          return { ok: false, reason: "status-conflict" };
        }
        try {
          assertAgentRunTransition(current.status, input.next.status);
        } catch {
          return { ok: false, reason: "status-conflict" };
        }
        const next = createAgentRun(input.next);
        state.runs.set(next.id, next);
        return { ok: true, run: cloneRun(next) };
      });
    },
    [MEMORY_TRANSACTION_STATE]: {
      snapshot(): MemoryAgentRunState {
        return cloneMemoryAgentRunState(state);
      },
      restore(snapshot: unknown): void {
        state = cloneMemoryAgentRunState(snapshot as MemoryAgentRunState);
      }
    }
  };

  return repository;
}
