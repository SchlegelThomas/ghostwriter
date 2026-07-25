import type { ContextReceipt } from "./agent-context-receipt.js";
import type { AsyncHashPort } from "./agent-domain.js";
import type { CaptureDocumentRepository } from "./capture-document-repository.js";
import type {
  AgentProposalRepository,
  AgentRunReflectionCompletionUnitOfWork,
  AgentRunRepository,
  ContextReceiptRepository
} from "./agent-foundation-repository.js";
import {
  createAgentProposalApplyServices,
  type AgentProposalApplyServiceDependencies,
  type ApplyAgentProposalInput,
  type ApplyAgentProposalResult
} from "./agent-proposal-apply-services.js";
import {
  AgentProposalContentMismatchError,
  AgentProposalNotFoundError,
  AgentProposalStateConflictError,
  AgentReceiptConflictError,
  AgentReceiptNotFoundError,
  AgentRunNotFoundError,
  AgentRunReceiptMismatchError,
  AgentRunStateConflictError,
  agentProposalSummaryFromProposal,
  agentRunSummaryFromRun,
  assertReceiptMatchesRun,
  computeAgentProposalContentHash,
  createAgentRun,
  createQueuedAgentRun,
  createReadyAgentProposal,
  evaluateReceiptCaptureBinding,
  primaryCaptureFromReceipt,
  validateAgentProposalPayload,
  type AgentProposal,
  type AgentProposalSummary,
  type AgentRun,
  type AgentRunSummary,
  type AgentRunTerminalDiagnosticCode,
  type AgentTokenUsage,
  type ReceiptCaptureBinding
} from "./agent-runs-proposals.js";
import type { CaptureContentHash } from "./capture-documents.js";
import {
  DomainValidationError,
  type AgentProposalId,
  type AgentRunId,
  type CaptureId,
  type ContextReceiptId,
  type ProjectId
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { Clock, ProjectRepository } from "./project-repository.js";

const ACTIVE_AGENT_RUN_STATUSES = Object.freeze([
  "queued",
  "running",
  "needs-input"
] as const);

export type CompleteReflectionRunResult =
  | Readonly<{ kind: "ready"; run: AgentRun; proposal: AgentProposal }>
  | Readonly<{ kind: "stale"; run: AgentRun }>;

export type AgentFoundationServices = Readonly<{
  persistPreview(input: Readonly<{
    accountId: AccountId;
    receipt: ContextReceipt;
  }>): Promise<ContextReceipt>;
  getReceipt(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    receiptId: ContextReceiptId;
  }>): Promise<ContextReceipt>;
  queueRun(input: Readonly<{
    accountId: AccountId;
    runId: AgentRunId;
    receiptId: ContextReceiptId;
    expectedReceiptHash: ContextReceipt["receiptHash"];
  }>): Promise<AgentRun>;
  markRunning(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    runId: AgentRunId;
  }>): Promise<AgentRun>;
  markRunStale(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    runId: AgentRunId;
  }>): Promise<AgentRun>;
  completeReflectionRun(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    runId: AgentRunId;
    proposalId: AgentProposalId;
    rawPayload: unknown;
    baseCaptureId: CaptureId;
    expectedCaptureWorkingVersion: number;
    expectedCaptureContentHash: CaptureContentHash;
    providerResponseId?: string;
    tokenUsage?: AgentTokenUsage;
  }>): Promise<CompleteReflectionRunResult>;
  failRun(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    runId: AgentRunId;
    diagnosticCode: AgentRunTerminalDiagnosticCode;
  }>): Promise<AgentRun>;
  cancelRun(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    runId: AgentRunId;
  }>): Promise<AgentRun>;
  rejectProposal(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    proposalId: AgentProposalId;
  }>): Promise<AgentProposal>;
  applyProposal(input: ApplyAgentProposalInput): Promise<ApplyAgentProposalResult>;
  getRun(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    runId: AgentRunId;
  }>): Promise<AgentRun>;
  getProposal(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    proposalId: AgentProposalId;
  }>): Promise<AgentProposal>;
  listRunSummaries(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    limit?: number;
  }>): Promise<readonly AgentRunSummary[]>;
  listProposalSummaries(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    limit?: number;
  }>): Promise<readonly AgentProposalSummary[]>;
}>;

export type AgentFoundationApplyDependencies = Omit<
  AgentProposalApplyServiceDependencies,
  "projects" | "captureDocuments" | "proposals" | "clock"
>;

export type AgentFoundationServiceDependencies = Readonly<{
  projects: ProjectRepository;
  captureDocuments: CaptureDocumentRepository;
  receipts: ContextReceiptRepository;
  runs: AgentRunRepository;
  proposals: AgentProposalRepository;
  completion: AgentRunReflectionCompletionUnitOfWork;
  hashPort: AsyncHashPort;
  clock: Clock;
  apply?: AgentFoundationApplyDependencies;
}>;

async function requireOwnedProject(
  dependencies: AgentFoundationServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId
): Promise<void> {
  try {
    requireProjectOwner(
      projectId,
      await dependencies.projects.getProjectMembership(projectId, accountId)
    );
  } catch (error) {
    if (error instanceof ProjectAccessDeniedError) {
      throw new AgentRunNotFoundError();
    }
    throw error;
  }
}

async function requireOwnedRun(
  dependencies: AgentFoundationServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId,
  runId: AgentRunId
): Promise<AgentRun> {
  await requireOwnedProject(dependencies, accountId, projectId);
  const run = await dependencies.runs.get(runId);
  if (run === undefined || run.projectId !== projectId) {
    throw new AgentRunNotFoundError();
  }
  return run;
}

async function requireOwnedProposal(
  dependencies: AgentFoundationServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId,
  proposalId: AgentProposalId
): Promise<AgentProposal> {
  await requireOwnedProject(dependencies, accountId, projectId);
  const proposal = await dependencies.proposals.get(proposalId);
  if (proposal === undefined || proposal.projectId !== projectId) {
    throw new AgentProposalNotFoundError();
  }
  return proposal;
}

function assertRunTransition(
  outcome: Awaited<ReturnType<AgentRunRepository["transition"]>>
): AgentRun {
  if (outcome.ok) return outcome.run;
  throw new AgentRunStateConflictError();
}

function assertProposalReject(
  outcome: Awaited<ReturnType<AgentProposalRepository["reject"]>>
): AgentProposal {
  if (outcome.ok) return outcome.proposal;
  if (outcome.reason === "not-found" || outcome.reason === "cross-project") {
    throw new AgentProposalNotFoundError();
  }
  throw new AgentProposalStateConflictError();
}

function assertRunInitiator(run: AgentRun, accountId: AccountId): void {
  if (run.initiatorAccountId !== accountId) {
    throw new AgentRunNotFoundError();
  }
}

function assertExecutorMatchesReceiptBinding(
  input: Readonly<{
    baseCaptureId: CaptureId;
    expectedCaptureWorkingVersion: number;
    expectedCaptureContentHash: CaptureContentHash;
  }>,
  binding: ReceiptCaptureBinding
): void {
  if (
    input.baseCaptureId !== binding.captureId ||
    input.expectedCaptureWorkingVersion !== binding.workingVersion ||
    input.expectedCaptureContentHash !== binding.contentHash
  ) {
    throw new AgentProposalContentMismatchError();
  }
}

async function evaluateLiveReceiptCaptureBinding(
  dependencies: AgentFoundationServiceDependencies,
  receipt: ContextReceipt,
  projectId: ProjectId
): Promise<ReturnType<typeof evaluateReceiptCaptureBinding>> {
  const binding = primaryCaptureFromReceipt(receipt);
  const head = await dependencies.captureDocuments.get(binding.captureId);
  return evaluateReceiptCaptureBinding(receipt, projectId, head);
}

function bindingFailureToServiceError(
  reason: "not-found" | "cross-project" | "context-stale"
): Error {
  if (reason === "context-stale") {
    return new AgentProposalContentMismatchError();
  }
  return new AgentRunNotFoundError();
}

async function transitionActiveRunToStale(
  dependencies: AgentFoundationServiceDependencies,
  current: AgentRun,
  accountId: AccountId
): Promise<AgentRun> {
  assertRunInitiator(current, accountId);
  if (
    !ACTIVE_AGENT_RUN_STATUSES.includes(
      current.status as (typeof ACTIVE_AGENT_RUN_STATUSES)[number]
    )
  ) {
    throw new AgentRunStateConflictError();
  }
  const now = dependencies.clock.now();
  return assertRunTransition(
    await dependencies.runs.transition({
      runId: current.id,
      expectedStatus: current.status,
      next: createAgentRun({
        ...current,
        status: "stale",
        updatedAt: now,
        completedAt: now
      })
    })
  );
}

async function requireFreshReceiptCaptureBinding(
  dependencies: AgentFoundationServiceDependencies,
  receipt: ContextReceipt,
  projectId: ProjectId
): Promise<ReceiptCaptureBinding> {
  const evaluation = await evaluateLiveReceiptCaptureBinding(
    dependencies,
    receipt,
    projectId
  );
  if (evaluation.ok) {
    return evaluation.binding;
  }
  throw bindingFailureToServiceError(evaluation.reason);
}

export function createAgentFoundationServices(
  dependencies: AgentFoundationServiceDependencies
): AgentFoundationServices {
  const applyServices =
    dependencies.apply === undefined
      ? undefined
      : createAgentProposalApplyServices({
          projects: dependencies.projects,
          captureDocuments: dependencies.captureDocuments,
          proposals: dependencies.proposals,
          clock: dependencies.clock,
          ...dependencies.apply
        });

  return Object.freeze({
    async persistPreview(input) {
      await requireOwnedProject(dependencies, input.accountId, input.receipt.projectId);
      const outcome = await dependencies.receipts.insertImmutable(input.receipt);
      if (!outcome.ok) {
        throw new AgentReceiptConflictError();
      }
      return outcome.receipt;
    },

    async getReceipt(input) {
      await requireOwnedProject(dependencies, input.accountId, input.projectId);
      const receipt = await dependencies.receipts.get(input.receiptId);
      if (receipt === undefined || receipt.projectId !== input.projectId) {
        throw new AgentReceiptNotFoundError();
      }
      return receipt;
    },

    async queueRun(input) {
      const receipt = await dependencies.receipts.get(input.receiptId);
      if (receipt === undefined) {
        throw new AgentReceiptNotFoundError();
      }
      await requireOwnedProject(dependencies, input.accountId, receipt.projectId);
      if (receipt.receiptHash !== input.expectedReceiptHash) {
        throw new AgentRunReceiptMismatchError();
      }
      await requireFreshReceiptCaptureBinding(
        dependencies,
        receipt,
        receipt.projectId
      );
      const now = dependencies.clock.now();
      const run = createQueuedAgentRun({
        id: input.runId,
        projectId: receipt.projectId,
        initiatorAccountId: input.accountId,
        workflowId: receipt.workflowId,
        workflowVersion: receipt.workflowVersion,
        provider: receipt.provider,
        model: receipt.model,
        receiptId: receipt.id,
        receiptHash: receipt.receiptHash,
        status: "queued",
        createdAt: now,
        updatedAt: now
      });
      const outcome = await dependencies.runs.create(run);
      if (!outcome.ok) {
        throw new AgentRunStateConflictError();
      }
      return outcome.run;
    },

    async markRunning(input) {
      const current = await requireOwnedRun(
        dependencies,
        input.accountId,
        input.projectId,
        input.runId
      );
      assertRunInitiator(current, input.accountId);
      const receipt = await dependencies.receipts.get(current.receiptId);
      if (receipt === undefined) {
        throw new AgentReceiptNotFoundError();
      }
      assertReceiptMatchesRun(receipt, current);
      const evaluation = await evaluateLiveReceiptCaptureBinding(
        dependencies,
        receipt,
        input.projectId
      );
      if (!evaluation.ok) {
        if (evaluation.reason === "context-stale") {
          await transitionActiveRunToStale(dependencies, current, input.accountId);
        }
        throw bindingFailureToServiceError(evaluation.reason);
      }
      const now = dependencies.clock.now();
      return assertRunTransition(
        await dependencies.runs.transition({
          runId: current.id,
          expectedStatus: "queued",
          next: createAgentRun({
            ...current,
            status: "running",
            updatedAt: now
          })
        })
      );
    },

    async markRunStale(input) {
      const current = await requireOwnedRun(
        dependencies,
        input.accountId,
        input.projectId,
        input.runId
      );
      return transitionActiveRunToStale(dependencies, current, input.accountId);
    },

    async completeReflectionRun(input) {
      const current = await requireOwnedRun(
        dependencies,
        input.accountId,
        input.projectId,
        input.runId
      );
      if (current.status !== "running") {
        throw new AgentRunStateConflictError();
      }
      assertRunInitiator(current, input.accountId);
      const receipt = await dependencies.receipts.get(current.receiptId);
      if (receipt === undefined) {
        throw new AgentReceiptNotFoundError();
      }
      assertReceiptMatchesRun(receipt, current);
      const receiptBinding = primaryCaptureFromReceipt(receipt);
      assertExecutorMatchesReceiptBinding(input, receiptBinding);
      const evaluation = await evaluateLiveReceiptCaptureBinding(
        dependencies,
        receipt,
        input.projectId
      );
      if (!evaluation.ok) {
        if (evaluation.reason === "context-stale") {
          const staleRun = await transitionActiveRunToStale(
            dependencies,
            current,
            input.accountId
          );
          return Object.freeze({ kind: "stale", run: staleRun });
        }
        throw bindingFailureToServiceError(evaluation.reason);
      }
      const payload = validateAgentProposalPayload(
        receipt.outputSchemaId,
        input.rawPayload
      );
      const contentHash = await computeAgentProposalContentHash(
        {
          outputSchemaId: receipt.outputSchemaId,
          payload,
          baseCaptureId: receiptBinding.captureId,
          baseCaptureWorkingVersion: receiptBinding.workingVersion,
          baseCaptureContentHash: receiptBinding.contentHash
        },
        dependencies.hashPort
      );
      const now = dependencies.clock.now();
      const proposal = createReadyAgentProposal({
        id: input.proposalId,
        projectId: input.projectId,
        runId: current.id,
        receiptId: current.receiptId,
        status: "ready",
        outputSchemaId: receipt.outputSchemaId,
        payload,
        contentHash,
        baseCaptureId: receiptBinding.captureId,
        baseCaptureWorkingVersion: receiptBinding.workingVersion,
        baseCaptureContentHash: receiptBinding.contentHash,
        createdAt: now,
        updatedAt: now
      });
      const readyRun = createAgentRun({
        ...current,
        status: "ready",
        updatedAt: now,
        completedAt: now,
        ...(input.providerResponseId === undefined
          ? {}
          : { providerResponseId: input.providerResponseId }),
        ...(input.tokenUsage === undefined ? {} : { tokenUsage: input.tokenUsage })
      });
      await dependencies.completion.completeReflection({
        run: readyRun,
        proposal
      });
      return Object.freeze({
        kind: "ready",
        run: readyRun,
        proposal
      });
    },

    async failRun(input) {
      const current = await requireOwnedRun(
        dependencies,
        input.accountId,
        input.projectId,
        input.runId
      );
      if (
        !ACTIVE_AGENT_RUN_STATUSES.includes(
          current.status as (typeof ACTIVE_AGENT_RUN_STATUSES)[number]
        )
      ) {
        throw new AgentRunStateConflictError();
      }
      assertRunInitiator(current, input.accountId);
      const now = dependencies.clock.now();
      return assertRunTransition(
        await dependencies.runs.transition({
          runId: current.id,
          expectedStatus: current.status,
          next: createAgentRun({
            ...current,
            status: "failed",
            updatedAt: now,
            completedAt: now,
            terminalDiagnosticCode: input.diagnosticCode
          })
        })
      );
    },

    async cancelRun(input) {
      const current = await requireOwnedRun(
        dependencies,
        input.accountId,
        input.projectId,
        input.runId
      );
      if (
        !ACTIVE_AGENT_RUN_STATUSES.includes(
          current.status as (typeof ACTIVE_AGENT_RUN_STATUSES)[number]
        )
      ) {
        throw new AgentRunStateConflictError();
      }
      assertRunInitiator(current, input.accountId);
      const now = dependencies.clock.now();
      return assertRunTransition(
        await dependencies.runs.transition({
          runId: current.id,
          expectedStatus: current.status,
          next: createAgentRun({
            ...current,
            status: "canceled",
            updatedAt: now,
            cancelRequestedAt: now,
            completedAt: now
          })
        })
      );
    },

    async rejectProposal(input) {
      try {
        requireProjectOwner(
          input.projectId,
          await dependencies.projects.getProjectMembership(
            input.projectId,
            input.accountId
          )
        );
      } catch (error) {
        if (error instanceof ProjectAccessDeniedError) {
          throw new AgentProposalNotFoundError();
        }
        throw error;
      }
      const current = await dependencies.proposals.get(input.proposalId);
      if (current === undefined || current.projectId !== input.projectId) {
        throw new AgentProposalNotFoundError();
      }
      if (current.status !== "ready") {
        throw new AgentProposalStateConflictError();
      }
      const now = dependencies.clock.now();
      return assertProposalReject(
        await dependencies.proposals.reject({
          proposalId: current.id,
          projectId: input.projectId,
          expectedStatus: "ready",
          actorAccountId: input.accountId,
          decidedAt: now,
          updatedAt: now
        })
      );
    },

    async applyProposal(input) {
      if (applyServices === undefined) {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "Agent proposal apply is not configured."
        );
      }
      return applyServices.applyProposal(input);
    },

    async getRun(input) {
      return requireOwnedRun(
        dependencies,
        input.accountId,
        input.projectId,
        input.runId
      );
    },

    async getProposal(input) {
      return requireOwnedProposal(
        dependencies,
        input.accountId,
        input.projectId,
        input.proposalId
      );
    },

    async listRunSummaries(input) {
      await requireOwnedProject(dependencies, input.accountId, input.projectId);
      const runs = await dependencies.runs.listByProject(input.projectId, {
        limit: input.limit
      });
      return runs.map(agentRunSummaryFromRun);
    },

    async listProposalSummaries(input) {
      await requireOwnedProject(dependencies, input.accountId, input.projectId);
      const proposals = await dependencies.proposals.listByProject(input.projectId, {
        limit: input.limit
      });
      return proposals.map(agentProposalSummaryFromProposal);
    }
  });
}
