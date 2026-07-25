import type {
  AgentFoundationListOptions,
  AgentProposalRepository,
  CreateAgentProposalOutcome,
  MarkAgentProposalAppliedInput,
  MarkAgentProposalStaleInput,
  RejectAgentProposalInput,
  TransitionAgentProposalInput,
  TransitionAgentProposalOutcome
} from "./agent-foundation-repository.js";
import {
  assertAgentProposalTransition,
  agentProposalIdentityMatches,
  createAgentProposal,
  createReadyAgentProposal,
  normalizeAgentFoundationListLimit,
  type AgentProposal
} from "./agent-runs-proposals.js";
import type { AgentProposalId, ProjectId } from "./domain.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

type MemoryAgentProposalState = {
  proposals: Map<string, AgentProposal>;
};

function cloneProposal(proposal: AgentProposal): AgentProposal {
  return createAgentProposal(proposal);
}

function cloneMemoryAgentProposalState(
  state: MemoryAgentProposalState
): MemoryAgentProposalState {
  return {
    proposals: new Map(
      [...state.proposals.entries()].map(([id, proposal]) => [id, cloneProposal(proposal)])
    )
  };
}

function sortNewestFirstProposals(
  proposals: readonly AgentProposal[]
): readonly AgentProposal[] {
  return Object.freeze(
    [...proposals].sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
    )
  );
}

export function createMemoryAgentProposalRepository(): AgentProposalRepository &
  MemoryTransactionalRepository {
  let state: MemoryAgentProposalState = { proposals: new Map() };
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

  const repository: AgentProposalRepository & MemoryTransactionalRepository = {
    async get(proposalId: AgentProposalId): Promise<AgentProposal | undefined> {
      const proposal = state.proposals.get(proposalId);
      return proposal === undefined ? undefined : cloneProposal(proposal);
    },
    async listByProject(projectId: ProjectId, options: AgentFoundationListOptions = {}) {
      const limit = normalizeAgentFoundationListLimit(options.limit);
      const matches = [...state.proposals.values()].filter(
        (proposal) => proposal.projectId === projectId
      );
      return sortNewestFirstProposals(matches).slice(0, limit).map(cloneProposal);
    },
    create(proposal: AgentProposal): Promise<CreateAgentProposalOutcome> {
      return serializeWrite(() => {
        const normalized = createReadyAgentProposal(proposal);
        if (state.proposals.has(normalized.id)) {
          return { ok: false, reason: "duplicate-id" };
        }
        state.proposals.set(normalized.id, normalized);
        return { ok: true, proposal: cloneProposal(normalized) };
      });
    },
    transition(input: TransitionAgentProposalInput): Promise<TransitionAgentProposalOutcome> {
      return serializeWrite(() => {
        const current = state.proposals.get(input.proposalId);
        if (current === undefined) {
          return { ok: false, reason: "not-found" };
        }
        if (current.projectId !== input.projectId) {
          return { ok: false, reason: "cross-project" };
        }
        if (current.status !== input.expectedStatus) {
          return { ok: false, reason: "status-conflict" };
        }
        if (!agentProposalIdentityMatches(current, input.next)) {
          return { ok: false, reason: "status-conflict" };
        }
        try {
          assertAgentProposalTransition(current.status, input.next.status);
        } catch {
          return { ok: false, reason: "status-conflict" };
        }
        const next = createAgentProposal(input.next);
        state.proposals.set(next.id, next);
        return { ok: true, proposal: cloneProposal(next) };
      });
    },
    reject(input: RejectAgentProposalInput): Promise<TransitionAgentProposalOutcome> {
      return serializeWrite(() => {
        const current = state.proposals.get(input.proposalId);
        if (current === undefined) {
          return { ok: false, reason: "not-found" };
        }
        if (current.projectId !== input.projectId) {
          return { ok: false, reason: "cross-project" };
        }
        if (current.status !== input.expectedStatus) {
          return { ok: false, reason: "status-conflict" };
        }
        try {
          assertAgentProposalTransition(current.status, "rejected");
        } catch {
          return { ok: false, reason: "status-conflict" };
        }
        const next = createAgentProposal({
          ...current,
          status: "rejected",
          updatedAt: input.updatedAt,
          decision: {
            actorAccountId: input.actorAccountId,
            decidedAt: input.decidedAt
          }
        });
        if (!agentProposalIdentityMatches(current, next)) {
          return { ok: false, reason: "status-conflict" };
        }
        state.proposals.set(next.id, next);
        return { ok: true, proposal: cloneProposal(next) };
      });
    },
    markStale(input: MarkAgentProposalStaleInput): Promise<TransitionAgentProposalOutcome> {
      return serializeWrite(() => {
        const current = state.proposals.get(input.proposalId);
        if (current === undefined) {
          return { ok: false, reason: "not-found" };
        }
        if (current.projectId !== input.projectId) {
          return { ok: false, reason: "cross-project" };
        }
        if (current.status !== input.expectedStatus) {
          return { ok: false, reason: "status-conflict" };
        }
        try {
          assertAgentProposalTransition(current.status, "stale");
        } catch {
          return { ok: false, reason: "status-conflict" };
        }
        const next = createAgentProposal({
          ...current,
          status: "stale",
          updatedAt: input.updatedAt
        });
        if (!agentProposalIdentityMatches(current, next)) {
          return { ok: false, reason: "status-conflict" };
        }
        state.proposals.set(next.id, next);
        return { ok: true, proposal: cloneProposal(next) };
      });
    },
    markApplied(input: MarkAgentProposalAppliedInput): Promise<TransitionAgentProposalOutcome> {
      return serializeWrite(() => {
        const current = state.proposals.get(input.proposalId);
        if (current === undefined) {
          return { ok: false, reason: "not-found" };
        }
        if (current.projectId !== input.projectId) {
          return { ok: false, reason: "cross-project" };
        }
        if (current.status !== input.expectedStatus) {
          return { ok: false, reason: "status-conflict" };
        }
        try {
          assertAgentProposalTransition(current.status, "applied");
        } catch {
          return { ok: false, reason: "status-conflict" };
        }
        const next = createAgentProposal({
          ...current,
          status: "applied",
          updatedAt: input.updatedAt,
          applied: {
            actorAccountId: input.actorAccountId,
            appliedAt: input.appliedAt
          }
        });
        if (!agentProposalIdentityMatches(current, next)) {
          return { ok: false, reason: "status-conflict" };
        }
        state.proposals.set(next.id, next);
        return { ok: true, proposal: cloneProposal(next) };
      });
    },
    [MEMORY_TRANSACTION_STATE]: {
      snapshot(): MemoryAgentProposalState {
        return cloneMemoryAgentProposalState(state);
      },
      restore(snapshot: unknown): void {
        state = cloneMemoryAgentProposalState(snapshot as MemoryAgentProposalState);
      }
    }
  };

  return repository;
}
