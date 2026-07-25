import type { ContextReceipt } from "./agent-context-receipt.js";
import type {
  AgentProposal,
  AgentRun
} from "./agent-runs-proposals.js";
import type {
  AgentProposalId,
  AgentRunId,
  ContextReceiptId,
  ProjectId
} from "./domain.js";
import type { AccountId } from "./identity.js";

export type AgentFoundationListOptions = Readonly<{
  limit?: number;
}>;

export type InsertContextReceiptOutcome =
  | Readonly<{ ok: true; receipt: ContextReceipt; created: boolean }>
  | Readonly<{ ok: false; reason: "conflict" }>;

export type CreateAgentRunOutcome =
  | Readonly<{ ok: true; run: AgentRun }>
  | Readonly<{ ok: false; reason: "duplicate-id" }>;

export type TransitionAgentRunInput = Readonly<{
  runId: AgentRunId;
  expectedStatus: AgentRun["status"];
  next: AgentRun;
}>;

export type TransitionAgentRunOutcome =
  | Readonly<{ ok: true; run: AgentRun }>
  | Readonly<{ ok: false; reason: "not-found" | "status-conflict" | "cross-project" }>;

export type CreateAgentProposalOutcome =
  | Readonly<{ ok: true; proposal: AgentProposal }>
  | Readonly<{ ok: false; reason: "duplicate-id" }>;

export type RejectAgentProposalInput = Readonly<{
  proposalId: AgentProposalId;
  projectId: ProjectId;
  expectedStatus: "ready";
  actorAccountId: AccountId;
  decidedAt: string;
  updatedAt: string;
}>;

export type MarkAgentProposalStaleInput = Readonly<{
  proposalId: AgentProposalId;
  projectId: ProjectId;
  expectedStatus: "ready";
  updatedAt: string;
}>;

export type MarkAgentProposalAppliedInput = Readonly<{
  proposalId: AgentProposalId;
  projectId: ProjectId;
  expectedStatus: "ready";
  actorAccountId: AccountId;
  appliedAt: string;
  updatedAt: string;
}>;

export type TransitionAgentProposalInput = Readonly<{
  proposalId: AgentProposalId;
  projectId: ProjectId;
  expectedStatus: AgentProposal["status"];
  next: AgentProposal;
}>;

export type TransitionAgentProposalOutcome =
  | Readonly<{ ok: true; proposal: AgentProposal }>
  | Readonly<{ ok: false; reason: "not-found" | "status-conflict" | "cross-project" }>;

export interface ContextReceiptRepository {
  get(receiptId: ContextReceiptId): Promise<ContextReceipt | undefined>;
  listByProject(
    projectId: ProjectId,
    options?: AgentFoundationListOptions
  ): Promise<readonly ContextReceipt[]>;
  insertImmutable(receipt: ContextReceipt): Promise<InsertContextReceiptOutcome>;
}

export interface AgentRunRepository {
  get(runId: AgentRunId): Promise<AgentRun | undefined>;
  listByProject(
    projectId: ProjectId,
    options?: AgentFoundationListOptions
  ): Promise<readonly AgentRun[]>;
  create(run: AgentRun): Promise<CreateAgentRunOutcome>;
  transition(input: TransitionAgentRunInput): Promise<TransitionAgentRunOutcome>;
}

export interface AgentProposalRepository {
  get(proposalId: AgentProposalId): Promise<AgentProposal | undefined>;
  listByProject(
    projectId: ProjectId,
    options?: AgentFoundationListOptions
  ): Promise<readonly AgentProposal[]>;
  create(proposal: AgentProposal): Promise<CreateAgentProposalOutcome>;
  transition(input: TransitionAgentProposalInput): Promise<TransitionAgentProposalOutcome>;
  reject(input: RejectAgentProposalInput): Promise<TransitionAgentProposalOutcome>;
  markStale(input: MarkAgentProposalStaleInput): Promise<TransitionAgentProposalOutcome>;
  markApplied(input: MarkAgentProposalAppliedInput): Promise<TransitionAgentProposalOutcome>;
}

export type CompleteAgentRunReflectionInput = Readonly<{
  run: AgentRun;
  proposal: AgentProposal;
}>;

export interface AgentRunReflectionCompletionUnitOfWork {
  completeReflection(input: CompleteAgentRunReflectionInput): Promise<void>;
}
