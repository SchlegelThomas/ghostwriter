import type { ContextReceipt, AgentModelId } from "./agent-context-receipt.js";
import type { AsyncHashPort } from "./agent-domain.js";
import {
  CAPTURE_REFLECTION_WORKFLOW_ID,
  createCaptureReflectionAssignment
} from "./agent-domain.js";
import type { ContextReceiptRepository } from "./agent-foundation-repository.js";
import type { AgentFoundationServices } from "./agent-foundation-services.js";
import type { AgentGuidanceServices } from "./agent-guidance-services.js";
import { compileCaptureReflectionInstructions } from "./agent-instruction-compiler.js";
import type {
  ApplyAgentProposalInput,
  ApplyAgentProposalResult
} from "./agent-proposal-apply-services.js";
import {
  AgentProposalContentMismatchError,
  AgentReceiptNotFoundError,
  AgentRunReceiptMismatchError,
  AgentRunStateConflictError,
  primaryCaptureFromReceipt,
  type AgentProposal,
  type AgentProposalSummary,
  type AgentRun,
  type AgentRunSummary,
  type AgentRunTerminalDiagnosticCode,
  type AgentTokenUsage
} from "./agent-runs-proposals.js";
import type { CaptureDocumentRepository } from "./capture-document-repository.js";
import {
  CaptureNotFoundError,
  ProjectArchivedMutationError,
  type CaptureDocumentHead
} from "./capture-documents.js";
import {
  CAPTURE_REFLECTION_V1_JSON_SCHEMA,
  isCaptureReflectionV1,
  type CaptureReflectionV1
} from "./capture-reflection-v1.js";
import {
  DomainValidationError,
  agentProposalId,
  agentRunId,
  contextReceiptId,
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
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";

export type CaptureReflectionProviderDiagnosticCode =
  | "auth_failed"
  | "rate_limited"
  | "upstream_error"
  | "timeout"
  | "cancelled"
  | "invalid_structured_output"
  | "refusal"
  | "budget_exceeded"
  | "validation_failed";

export type CaptureReflectionStructuredCompletionProvider = Readonly<{
  completeStructured(input: Readonly<{
    workflow: string;
    model: string;
    instructions: string;
    inputText: string;
    outputSchema: Readonly<{ name: string; schema: Record<string, unknown> }>;
    maxOutputTokens: number;
    maxDurationMs: number;
    validateOutput: (value: unknown) => value is CaptureReflectionV1;
    signal?: AbortSignal;
  }>): Promise<
    | Readonly<{
        ok: true;
        output: CaptureReflectionV1;
        usage: AgentTokenUsage;
        providerResponseId: string;
      }>
    | Readonly<{
        ok: false;
        diagnostic: Readonly<{
          code: CaptureReflectionProviderDiagnosticCode;
          retryable: boolean;
        }>;
      }>
  >;
}>;

export type StartCaptureReflectionResult =
  | Readonly<{ kind: "ready"; run: AgentRun; proposal: AgentProposal }>
  | Readonly<{ kind: "stale"; run: AgentRun }>
  | Readonly<{ kind: "failed"; run: AgentRun }>
  | Readonly<{ kind: "canceled"; run: AgentRun }>;

export type CaptureReflectionServices = Readonly<{
  preview(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    captureId: CaptureId;
    model?: AgentModelId;
  }>): Promise<ContextReceipt>;
  start(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    receiptId: ContextReceiptId;
    expectedReceiptHash: ContextReceipt["receiptHash"];
    provider: CaptureReflectionStructuredCompletionProvider;
    signal?: AbortSignal;
  }>): Promise<StartCaptureReflectionResult>;
  getRun(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    runId: AgentRunId;
  }>): Promise<AgentRun>;
  cancelRun(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    runId: AgentRunId;
  }>): Promise<AgentRun>;
  listRunSummaries(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    limit?: number;
  }>): Promise<readonly AgentRunSummary[]>;
  getProposal(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    proposalId: AgentProposalId;
  }>): Promise<AgentProposal>;
  listProposalSummaries(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    limit?: number;
  }>): Promise<readonly AgentProposalSummary[]>;
  rejectProposal(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    proposalId: AgentProposalId;
  }>): Promise<AgentProposal>;
  applyProposal(input: ApplyAgentProposalInput): Promise<ApplyAgentProposalResult>;
}>;

export type CaptureReflectionServiceDependencies = Readonly<{
  projects: ProjectRepository;
  captureDocuments: CaptureDocumentRepository;
  receipts: ContextReceiptRepository;
  foundation: AgentFoundationServices;
  guidance: AgentGuidanceServices;
  hashPort: AsyncHashPort;
  ids: IdGenerator;
  clock: Clock;
}>;

function mapProviderDiagnostic(
  code: CaptureReflectionProviderDiagnosticCode
): AgentRunTerminalDiagnosticCode {
  switch (code) {
    case "timeout":
      return "provider-timeout";
    case "rate_limited":
      return "provider-rate-limited";
    case "invalid_structured_output":
    case "validation_failed":
    case "refusal":
      return "provider-malformed-output";
    case "cancelled":
      return "run-canceled";
    case "auth_failed":
    case "upstream_error":
    case "budget_exceeded":
      return "provider-unavailable";
    default:
      return "internal-failure";
  }
}

async function requireOwnedProject(
  dependencies: CaptureReflectionServiceDependencies,
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
      throw new CaptureNotFoundError();
    }
    throw error;
  }
}

async function requireOwnedCaptureHead(
  dependencies: CaptureReflectionServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId,
  captureId: CaptureId
): Promise<CaptureDocumentHead> {
  await requireOwnedProject(dependencies, accountId, projectId);
  const head = await dependencies.captureDocuments.get(captureId);
  if (head === undefined || head.projectId !== projectId) {
    throw new CaptureNotFoundError();
  }
  return head;
}

function assertCaptureEligibleForReflection(head: CaptureDocumentHead): void {
  if (head.status === "archived" || head.status === "integrated") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Only draft or ready Captures can request Scene Partner reflection."
    );
  }
}

async function selectMatchedPlaybook(
  guidance: AgentGuidanceServices,
  accountId: AccountId,
  projectId: ProjectId
) {
  const playbooks = await guidance.listProjectPlaybooks({
    accountId,
    projectId,
    includeArchived: false
  });
  return playbooks.find(
    (playbook) =>
      playbook.enabled &&
      playbook.trigger === "capture-reflection" &&
      playbook.outputSchemaId === "capture-reflection-v1" &&
      playbook.allowedContextClasses.includes("capture")
  );
}

async function compileForCapture(
  dependencies: CaptureReflectionServiceDependencies,
  input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    captureHead: CaptureDocumentHead;
    receiptId: ContextReceiptId;
    createdAt: string;
    model?: AgentModelId;
  }>
) {
  const [accountPreferences, projectInstructions, matchedPlaybook] = await Promise.all([
    dependencies.guidance.getAccountAiCollaborationProfile(input.accountId),
    dependencies.guidance.getProjectAgentInstructions({
      accountId: input.accountId,
      projectId: input.projectId
    }),
    selectMatchedPlaybook(
      dependencies.guidance,
      input.accountId,
      input.projectId
    )
  ]);

  return compileCaptureReflectionInstructions({
    projectId: input.projectId,
    receiptId: input.receiptId,
    createdAt: input.createdAt,
    assignment: createCaptureReflectionAssignment({
      workflowId: CAPTURE_REFLECTION_WORKFLOW_ID,
      captureId: input.captureHead.captureId
    }),
    captureHead: input.captureHead,
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(accountPreferences === undefined
      ? {}
      : { accountPreferences }),
    ...(projectInstructions === undefined
      ? {}
      : { projectInstructions }),
    ...(matchedPlaybook === undefined ? {} : { matchedPlaybook }),
    hashPort: dependencies.hashPort
  });
}

async function safeFailRun(
  foundation: AgentFoundationServices,
  input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    runId: AgentRunId;
    diagnosticCode: AgentRunTerminalDiagnosticCode;
  }>
): Promise<AgentRun> {
  try {
    return await foundation.failRun(input);
  } catch (error) {
    if (error instanceof AgentRunStateConflictError) {
      return foundation.getRun({
        accountId: input.accountId,
        projectId: input.projectId,
        runId: input.runId
      });
    }
    throw error;
  }
}

export function createCaptureReflectionServices(
  dependencies: CaptureReflectionServiceDependencies
): CaptureReflectionServices {
  return Object.freeze({
    async preview(input) {
      const project = await dependencies.projects.getProject(input.projectId);
      if (project?.archivedAt !== undefined) {
        throw new ProjectArchivedMutationError();
      }
      const captureHead = await requireOwnedCaptureHead(
        dependencies,
        input.accountId,
        input.projectId,
        input.captureId
      );
      assertCaptureEligibleForReflection(captureHead);
      const compiled = await compileForCapture(dependencies, {
        accountId: input.accountId,
        projectId: input.projectId,
        captureHead,
        receiptId: contextReceiptId(dependencies.ids.create("contextReceipt")),
        createdAt: dependencies.clock.now(),
        ...(input.model === undefined ? {} : { model: input.model })
      });
      return dependencies.foundation.persistPreview({
        accountId: input.accountId,
        receipt: compiled.receipt
      });
    },

    async start(input) {
      const receipt = await dependencies.receipts.get(input.receiptId);
      if (receipt === undefined || receipt.projectId !== input.projectId) {
        throw new AgentReceiptNotFoundError();
      }
      if (receipt.receiptHash !== input.expectedReceiptHash) {
        throw new AgentRunReceiptMismatchError();
      }

      const runId = agentRunId(dependencies.ids.create("agentRun"));
      await dependencies.foundation.queueRun({
        accountId: input.accountId,
        runId,
        receiptId: input.receiptId,
        expectedReceiptHash: input.expectedReceiptHash
      });

      let running: AgentRun;
      try {
        running = await dependencies.foundation.markRunning({
          accountId: input.accountId,
          projectId: input.projectId,
          runId
        });
      } catch (error) {
        if (error instanceof AgentProposalContentMismatchError) {
          const stale = await dependencies.foundation.getRun({
            accountId: input.accountId,
            projectId: input.projectId,
            runId
          });
          return Object.freeze({ kind: "stale" as const, run: stale });
        }
        throw error;
      }

      const binding = primaryCaptureFromReceipt(receipt);
      const captureHead = await dependencies.captureDocuments.get(binding.captureId);
      if (
        captureHead === undefined ||
        captureHead.projectId !== input.projectId ||
        captureHead.workingVersion !== binding.workingVersion ||
        captureHead.contentHash !== binding.contentHash
      ) {
        const stale = await dependencies.foundation.markRunStale({
          accountId: input.accountId,
          projectId: input.projectId,
          runId
        });
        return Object.freeze({ kind: "stale" as const, run: stale });
      }

      let compiled;
      try {
        compiled = await compileForCapture(dependencies, {
          accountId: input.accountId,
          projectId: input.projectId,
          captureHead,
          receiptId: receipt.id,
          createdAt: receipt.createdAt,
          model: receipt.model
        });
      } catch {
        const failed = await safeFailRun(dependencies.foundation, {
          accountId: input.accountId,
          projectId: input.projectId,
          runId,
          diagnosticCode: "internal-failure"
        });
        return Object.freeze({ kind: "failed" as const, run: failed });
      }

      if (compiled.receipt.receiptHash !== receipt.receiptHash) {
        const failed = await safeFailRun(dependencies.foundation, {
          accountId: input.accountId,
          projectId: input.projectId,
          runId,
          diagnosticCode: "internal-failure"
        });
        return Object.freeze({ kind: "failed" as const, run: failed });
      }

      const completion = await input.provider.completeStructured({
        workflow: CAPTURE_REFLECTION_WORKFLOW_ID,
        model: compiled.model,
        instructions: compiled.systemInstructionText,
        inputText: compiled.inputText,
        outputSchema: {
          name: "capture_reflection_v1",
          schema: CAPTURE_REFLECTION_V1_JSON_SCHEMA as Record<string, unknown>
        },
        maxOutputTokens: compiled.maxOutputTokens,
        maxDurationMs: compiled.wallClockSeconds * 1_000,
        validateOutput: isCaptureReflectionV1,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });

      if (!completion.ok) {
        const diagnosticCode = mapProviderDiagnostic(completion.diagnostic.code);
        const failed = await safeFailRun(dependencies.foundation, {
          accountId: input.accountId,
          projectId: input.projectId,
          runId,
          diagnosticCode
        });
        return Object.freeze({
          kind: diagnosticCode === "run-canceled" ? ("canceled" as const) : ("failed" as const),
          run: failed
        });
      }

      try {
        const completed = await dependencies.foundation.completeReflectionRun({
          accountId: input.accountId,
          projectId: input.projectId,
          runId,
          proposalId: agentProposalId(dependencies.ids.create("agentProposal")),
          rawPayload: completion.output,
          baseCaptureId: binding.captureId,
          expectedCaptureWorkingVersion: binding.workingVersion,
          expectedCaptureContentHash: binding.contentHash,
          providerResponseId: completion.providerResponseId,
          tokenUsage: completion.usage
        });
        if (completed.kind === "stale") {
          return Object.freeze({ kind: "stale" as const, run: completed.run });
        }
        return Object.freeze({
          kind: "ready" as const,
          run: completed.run,
          proposal: completed.proposal
        });
      } catch (error) {
        if (error instanceof AgentRunStateConflictError) {
          const current = await dependencies.foundation.getRun({
            accountId: input.accountId,
            projectId: input.projectId,
            runId
          });
          if (current.status === "canceled") {
            return Object.freeze({ kind: "canceled" as const, run: current });
          }
          if (current.status === "stale") {
            return Object.freeze({ kind: "stale" as const, run: current });
          }
          return Object.freeze({ kind: "failed" as const, run: current });
        }
        if (error instanceof AgentProposalContentMismatchError) {
          const stale = await dependencies.foundation.markRunStale({
            accountId: input.accountId,
            projectId: input.projectId,
            runId
          });
          return Object.freeze({ kind: "stale" as const, run: stale });
        }
        const failed = await safeFailRun(dependencies.foundation, {
          accountId: input.accountId,
          projectId: input.projectId,
          runId: running.id,
          diagnosticCode: "internal-failure"
        });
        return Object.freeze({ kind: "failed" as const, run: failed });
      }
    },

    getRun(input) {
      return dependencies.foundation.getRun(input);
    },

    cancelRun(input) {
      return dependencies.foundation.cancelRun(input);
    },

    listRunSummaries(input) {
      return dependencies.foundation.listRunSummaries(input);
    },

    getProposal(input) {
      return dependencies.foundation.getProposal(input);
    },

    listProposalSummaries(input) {
      return dependencies.foundation.listProposalSummaries(input);
    },

    rejectProposal(input) {
      return dependencies.foundation.rejectProposal(input);
    },
    applyProposal(input) {
      return dependencies.foundation.applyProposal(input);
    }
  });
}
