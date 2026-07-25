import type { ContextReceipt, AgentModelId } from "./agent-context-receipt.js";
import type { AsyncHashPort, CraftPartnerWorkflowId } from "./agent-domain.js";
import {
  CHARACTER_COACH_WORKFLOW_ID,
  CraftTargetRequiredError,
  SKETCH_PARTNER_WORKFLOW_ID,
  WORLDKEEPER_WORKFLOW_ID,
  craftPartnerOutputSchemaId,
  createCraftPartnerAssignment
} from "./agent-domain.js";
import type { ContextReceiptRepository } from "./agent-foundation-repository.js";
import type { AgentFoundationServices } from "./agent-foundation-services.js";
import type { AgentGuidanceServices } from "./agent-guidance-services.js";
import { compileCraftPartnerInstructions } from "./craft-instruction-compiler.js";
import type {
  ApplyCraftProposalInput,
  ApplyCraftProposalResult,
  CraftProposalApplyServices
} from "./craft-proposal-apply-services.js";
import {
  BACKDROP_FIELDS_V1_JSON_SCHEMA,
  CHARACTER_SHEET_V1_JSON_SCHEMA,
  SKETCH_FIELDS_V1_JSON_SCHEMA,
  isBackdropFieldsV1,
  isCharacterSheetFieldsV1,
  isSketchFieldsV1,
  type CraftPartnerPayload
} from "./craft-partner-schemas.js";
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
  DomainValidationError,
  agentProposalId,
  agentRunId,
  contextReceiptId,
  type AgentProposalId,
  type AgentRunId,
  type CaptureId,
  type ContextReceiptId,
  type ProjectId,
  type SceneId,
  type StoryKnowledgeId
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";

export type CraftPartnerProviderDiagnosticCode =
  | "auth_failed"
  | "rate_limited"
  | "upstream_error"
  | "timeout"
  | "cancelled"
  | "invalid_structured_output"
  | "refusal"
  | "budget_exceeded"
  | "validation_failed";

export type CraftPartnerStructuredCompletionProvider = Readonly<{
  completeStructured(input: Readonly<{
    workflow: string;
    model: string;
    instructions: string;
    inputText: string;
    outputSchema: Readonly<{ name: string; schema: Record<string, unknown> }>;
    maxOutputTokens: number;
    maxDurationMs: number;
    validateOutput: (value: unknown) => value is CraftPartnerPayload;
    signal?: AbortSignal;
  }>): Promise<
    | Readonly<{
        ok: true;
        output: CraftPartnerPayload;
        usage: AgentTokenUsage;
        providerResponseId: string;
      }>
    | Readonly<{
        ok: false;
        diagnostic: Readonly<{
          code: CraftPartnerProviderDiagnosticCode;
          retryable: boolean;
        }>;
      }>
  >;
}>;

export type StartCraftPartnerResult =
  | Readonly<{ kind: "ready"; run: AgentRun; proposal: AgentProposal }>
  | Readonly<{ kind: "stale"; run: AgentRun }>
  | Readonly<{ kind: "failed"; run: AgentRun }>
  | Readonly<{ kind: "canceled"; run: AgentRun }>;

export type CraftPartnerPreviewInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  captureId: CaptureId;
  workflowId: CraftPartnerWorkflowId;
  sceneId?: SceneId;
  storyKnowledgeId?: StoryKnowledgeId;
  model?: AgentModelId;
}>;

export type CraftPartnerServices = Readonly<{
  preview(input: CraftPartnerPreviewInput): Promise<ContextReceipt>;
  start(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    receiptId: ContextReceiptId;
    expectedReceiptHash: ContextReceipt["receiptHash"];
    provider: CraftPartnerStructuredCompletionProvider;
    signal?: AbortSignal;
  }>): Promise<StartCraftPartnerResult>;
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
  applyProposal(input: ApplyCraftProposalInput): Promise<ApplyCraftProposalResult>;
}>;

export type CraftPartnerServiceDependencies = Readonly<{
  projects: ProjectRepository;
  captureDocuments: CaptureDocumentRepository;
  receipts: ContextReceiptRepository;
  foundation: AgentFoundationServices;
  guidance: AgentGuidanceServices;
  craftApply: CraftProposalApplyServices;
  hashPort: AsyncHashPort;
  ids: IdGenerator;
  clock: Clock;
}>;

function mapProviderDiagnostic(
  code: CraftPartnerProviderDiagnosticCode
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

function isCraftWorkflow(workflowId: string): workflowId is CraftPartnerWorkflowId {
  return (
    workflowId === SKETCH_PARTNER_WORKFLOW_ID ||
    workflowId === CHARACTER_COACH_WORKFLOW_ID ||
    workflowId === WORLDKEEPER_WORKFLOW_ID
  );
}

function outputSchemaForWorkflow(workflowId: CraftPartnerWorkflowId): Readonly<{
  name: string;
  schema: Record<string, unknown>;
  validate: (value: unknown) => value is CraftPartnerPayload;
}> {
  switch (workflowId) {
    case SKETCH_PARTNER_WORKFLOW_ID:
      return {
        name: "sketch_fields_v1",
        schema: SKETCH_FIELDS_V1_JSON_SCHEMA as Record<string, unknown>,
        validate: isSketchFieldsV1
      };
    case CHARACTER_COACH_WORKFLOW_ID:
      return {
        name: "character_sheet_v1",
        schema: CHARACTER_SHEET_V1_JSON_SCHEMA as Record<string, unknown>,
        validate: isCharacterSheetFieldsV1
      };
    case WORLDKEEPER_WORKFLOW_ID:
      return {
        name: "backdrop_fields_v1",
        schema: BACKDROP_FIELDS_V1_JSON_SCHEMA as Record<string, unknown>,
        validate: isBackdropFieldsV1
      };
    default: {
      const _exhaustive: never = workflowId;
      return _exhaustive;
    }
  }
}

async function requireOwnedProject(
  dependencies: CraftPartnerServiceDependencies,
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
  dependencies: CraftPartnerServiceDependencies,
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

function assertCaptureEligible(head: CaptureDocumentHead): void {
  if (head.status === "archived" || head.status === "integrated") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Only draft or ready Captures can request craft partner help."
    );
  }
}

async function assertCraftTargets(
  dependencies: CraftPartnerServiceDependencies,
  projectId: ProjectId,
  workflowId: CraftPartnerWorkflowId,
  captureId: CaptureId,
  sceneId: SceneId | undefined,
  storyKnowledgeId: StoryKnowledgeId | undefined
): Promise<void> {
  createCraftPartnerAssignment({
    workflowId,
    captureId,
    ...(sceneId === undefined ? {} : { sceneId }),
    ...(storyKnowledgeId === undefined ? {} : { storyKnowledgeId })
  });

  if (sceneId !== undefined) {
    const scene = (await dependencies.projects.listScenes(projectId)).find(
      (candidate) => candidate.id === sceneId && candidate.projectId === projectId
    );
    if (scene === undefined || scene.archivedAt !== undefined) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "The selected scene target was not found in this project."
      );
    }
  }

  if (storyKnowledgeId !== undefined) {
    const record = (await dependencies.projects.listStoryKnowledge(projectId)).find(
      (candidate) =>
        candidate.id === storyKnowledgeId && candidate.projectId === projectId
    );
    if (record === undefined || record.archivedAt !== undefined) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "The selected cast target was not found in this project."
      );
    }
  }
}

async function compileForCraft(
  dependencies: CraftPartnerServiceDependencies,
  input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    captureHead: CaptureDocumentHead;
    receiptId: ContextReceiptId;
    createdAt: string;
    workflowId: CraftPartnerWorkflowId;
    sceneId?: SceneId;
    storyKnowledgeId?: StoryKnowledgeId;
    model?: AgentModelId;
  }>
) {
  const [accountPreferences, projectInstructions] = await Promise.all([
    dependencies.guidance.getAccountAiCollaborationProfile(input.accountId),
    dependencies.guidance.getProjectAgentInstructions({
      accountId: input.accountId,
      projectId: input.projectId
    })
  ]);

  return compileCraftPartnerInstructions({
    projectId: input.projectId,
    receiptId: input.receiptId,
    createdAt: input.createdAt,
    assignment: {
      workflowId: input.workflowId,
      captureId: input.captureHead.captureId,
      ...(input.sceneId === undefined ? {} : { sceneId: input.sceneId }),
      ...(input.storyKnowledgeId === undefined
        ? {}
        : { storyKnowledgeId: input.storyKnowledgeId })
    },
    captureHead: input.captureHead,
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(accountPreferences === undefined ? {} : { accountPreferences }),
    ...(projectInstructions === undefined ? {} : { projectInstructions }),
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

export function createCraftPartnerServices(
  dependencies: CraftPartnerServiceDependencies
): CraftPartnerServices {
  return Object.freeze({
    async preview(input) {
      const project = await dependencies.projects.getProject(input.projectId);
      if (project?.archivedAt !== undefined) {
        throw new ProjectArchivedMutationError();
      }
      if (!isCraftWorkflow(input.workflowId)) {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "Craft partner workflow is not recognized."
        );
      }
      const captureHead = await requireOwnedCaptureHead(
        dependencies,
        input.accountId,
        input.projectId,
        input.captureId
      );
      assertCaptureEligible(captureHead);
      try {
        await assertCraftTargets(
          dependencies,
          input.projectId,
          input.workflowId,
          input.captureId,
          input.sceneId,
          input.storyKnowledgeId
        );
      } catch (error) {
        if (error instanceof CraftTargetRequiredError) {
          throw error;
        }
        throw error;
      }
      const compiled = await compileForCraft(dependencies, {
        accountId: input.accountId,
        projectId: input.projectId,
        captureHead,
        receiptId: contextReceiptId(dependencies.ids.create("contextReceipt")),
        createdAt: dependencies.clock.now(),
        workflowId: input.workflowId,
        ...(input.sceneId === undefined ? {} : { sceneId: input.sceneId }),
        ...(input.storyKnowledgeId === undefined
          ? {}
          : { storyKnowledgeId: input.storyKnowledgeId }),
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
      if (!isCraftWorkflow(receipt.workflowId)) {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "Receipt workflow is not a craft partner workflow."
        );
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
        compiled = await compileForCraft(dependencies, {
          accountId: input.accountId,
          projectId: input.projectId,
          captureHead,
          receiptId: receipt.id,
          createdAt: receipt.createdAt,
          workflowId: receipt.workflowId,
          ...(receipt.targetSceneId === undefined
            ? {}
            : { sceneId: receipt.targetSceneId }),
          ...(receipt.targetStoryKnowledgeId === undefined
            ? {}
            : { storyKnowledgeId: receipt.targetStoryKnowledgeId }),
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

      const schema = outputSchemaForWorkflow(receipt.workflowId);
      const completion = await input.provider.completeStructured({
        workflow: receipt.workflowId,
        model: compiled.model,
        instructions: compiled.systemInstructionText,
        inputText: compiled.inputText,
        outputSchema: {
          name: schema.name,
          schema: schema.schema
        },
        maxOutputTokens: compiled.maxOutputTokens,
        maxDurationMs: compiled.wallClockSeconds * 1_000,
        validateOutput: schema.validate,
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

      // Ensure character coach payload target matches receipt assignment.
      if (
        receipt.workflowId === CHARACTER_COACH_WORKFLOW_ID &&
        isCharacterSheetFieldsV1(completion.output) &&
        receipt.targetStoryKnowledgeId !== undefined &&
        completion.output.storyKnowledgeId !== receipt.targetStoryKnowledgeId
      ) {
        const failed = await safeFailRun(dependencies.foundation, {
          accountId: input.accountId,
          projectId: input.projectId,
          runId,
          diagnosticCode: "provider-malformed-output"
        });
        return Object.freeze({ kind: "failed" as const, run: failed });
      }

      if (completion.output.schemaId !== craftPartnerOutputSchemaId(receipt.workflowId)) {
        const failed = await safeFailRun(dependencies.foundation, {
          accountId: input.accountId,
          projectId: input.projectId,
          runId,
          diagnosticCode: "provider-malformed-output"
        });
        return Object.freeze({ kind: "failed" as const, run: failed });
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
      return dependencies.craftApply.applyCraftProposal(input);
    }
  });
}
