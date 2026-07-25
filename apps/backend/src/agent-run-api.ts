import {
  AgentProposalContentMismatchError,
  AgentProposalNotFoundError,
  AgentProposalStateConflictError,
  AgentReceiptConflictError,
  AgentReceiptNotFoundError,
  AgentRunNotFoundError,
  AgentRunReceiptMismatchError,
  AgentRunStateConflictError,
  CaptureNotFoundError,
  CapturePromotionNotEligibleError,
  CraftTargetRequiredError,
  DomainValidationError,
  ProjectArchivedMutationError,
  ProjectVersionConflictError,
  SceneLeaseConflictError,
  SceneLeaseExpiredError,
  SceneNotFoundError,
  SceneVariantNameConflictError,
  SceneWorkingVersionConflictError,
  sceneRevisionMetadata,
  type AgentProposal,
  type AgentProposalSummary,
  type AgentRun,
  type AgentRunSummary,
  type ApplyAgentProposalResult,
  type ApplyCraftProposalResult,
  type ContextReceipt,
  type StartCaptureReflectionResult,
  type StartCraftPartnerResult
} from "@ghostwriter/core";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { providerAgentErrorStatusAndBody } from "./provider-agent-api.js";

export function contextReceiptResponse(receipt: ContextReceipt) {
  return Object.freeze({
    receipt: Object.freeze({
      id: receipt.id,
      projectId: receipt.projectId,
      workflowId: receipt.workflowId,
      workflowVersion: receipt.workflowVersion,
      layers: receipt.layers,
      resources: receipt.resources.map((resource) =>
        Object.freeze({
          resourceClass: resource.resourceClass,
          captureId: resource.captureId,
          workingVersion: resource.workingVersion,
          contentHash: resource.contentHash,
          inclusionReason: resource.inclusionReason,
          providerTextCharCount: resource.providerTextCharCount,
          providerTextHash: resource.providerTextHash
        })
      ),
      excludedContextClasses: receipt.excludedContextClasses,
      provider: receipt.provider,
      model: receipt.model,
      maxOutputTokens: receipt.maxOutputTokens,
      wallClockSeconds: receipt.wallClockSeconds,
      toolCount: receipt.toolCount,
      egressClass: receipt.egressClass,
      outputSchemaId: receipt.outputSchemaId,
      receiptHash: receipt.receiptHash,
      createdAt: receipt.createdAt,
      ...(receipt.targetSceneId === undefined
        ? {}
        : { targetSceneId: receipt.targetSceneId }),
      ...(receipt.targetStoryKnowledgeId === undefined
        ? {}
        : { targetStoryKnowledgeId: receipt.targetStoryKnowledgeId })
    })
  });
}

export function agentRunResponse(run: AgentRun) {
  return Object.freeze({
    run: Object.freeze({
      id: run.id,
      projectId: run.projectId,
      initiatorAccountId: run.initiatorAccountId,
      workflowId: run.workflowId,
      workflowVersion: run.workflowVersion,
      provider: run.provider,
      model: run.model,
      receiptId: run.receiptId,
      receiptHash: run.receiptHash,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      ...(run.cancelRequestedAt === undefined
        ? {}
        : { cancelRequestedAt: run.cancelRequestedAt }),
      ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
      ...(run.providerResponseId === undefined
        ? {}
        : { providerResponseId: run.providerResponseId }),
      ...(run.tokenUsage === undefined ? {} : { tokenUsage: run.tokenUsage }),
      ...(run.terminalDiagnosticCode === undefined
        ? {}
        : { terminalDiagnosticCode: run.terminalDiagnosticCode })
    })
  });
}

export function agentRunSummaryResponse(summary: AgentRunSummary) {
  return Object.freeze({
    id: summary.id,
    projectId: summary.projectId,
    status: summary.status,
    workflowId: summary.workflowId,
    receiptId: summary.receiptId,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    ...(summary.completedAt === undefined ? {} : { completedAt: summary.completedAt })
  });
}

export function agentProposalResponse(proposal: AgentProposal) {
  return Object.freeze({
    proposal: Object.freeze({
      id: proposal.id,
      projectId: proposal.projectId,
      runId: proposal.runId,
      receiptId: proposal.receiptId,
      status: proposal.status,
      outputSchemaId: proposal.outputSchemaId,
      payload: proposal.payload,
      contentHash: proposal.contentHash,
      baseCaptureId: proposal.baseCaptureId,
      baseCaptureWorkingVersion: proposal.baseCaptureWorkingVersion,
      baseCaptureContentHash: proposal.baseCaptureContentHash,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
      ...(proposal.decision === undefined ? {} : { decision: proposal.decision }),
      ...(proposal.applied === undefined ? {} : { applied: proposal.applied })
    })
  });
}

export function agentProposalSummaryResponse(summary: AgentProposalSummary) {
  return Object.freeze({
    id: summary.id,
    projectId: summary.projectId,
    runId: summary.runId,
    status: summary.status,
    outputSchemaId: summary.outputSchemaId,
    contentHash: summary.contentHash,
    baseCaptureId: summary.baseCaptureId,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt
  });
}

export function startCaptureReflectionResponse(
  result: StartCaptureReflectionResult | StartCraftPartnerResult
) {
  if (result.kind === "ready") {
    return Object.freeze({
      kind: "ready" as const,
      ...agentRunResponse(result.run),
      ...agentProposalResponse(result.proposal)
    });
  }
  return Object.freeze({
    kind: result.kind,
    ...agentRunResponse(result.run)
  });
}

export function applyCraftProposalResponse(result: ApplyCraftProposalResult) {
  return Object.freeze({
    mode: "craft-fields" as const,
    ...agentProposalResponse(result.proposal),
    navigator: result.project
  });
}

export function applyAgentProposalResponse(result: ApplyAgentProposalResult) {
  if (result.mode === "new-scene") {
    return Object.freeze({
      mode: "new-scene" as const,
      ...agentProposalResponse(result.proposal),
      scene: result.promotion.scene,
      sceneDocumentHead: Object.freeze({
        sceneId: result.promotion.sceneDocumentHead.sceneId,
        projectId: result.promotion.sceneDocumentHead.projectId,
        workingVersion: result.promotion.sceneDocumentHead.workingVersion,
        document: result.promotion.sceneDocumentHead.document,
        contentHash: result.promotion.sceneDocumentHead.contentHash,
        checkpointRevisionId: result.promotion.sceneDocumentHead.checkpointRevisionId,
        updatedByAccountId: result.promotion.sceneDocumentHead.updatedByAccountId,
        createdAt: result.promotion.sceneDocumentHead.createdAt,
        updatedAt: result.promotion.sceneDocumentHead.updatedAt
      }),
      captureHead: Object.freeze({
        captureId: result.promotion.captureHead.captureId,
        projectId: result.promotion.captureHead.projectId,
        status: result.promotion.captureHead.status,
        sourceModality: result.promotion.captureHead.sourceModality,
        workingVersion: result.promotion.captureHead.workingVersion,
        document: result.promotion.captureHead.document,
        contentHash: result.promotion.captureHead.contentHash,
        genesisRevisionId: result.promotion.captureHead.genesisRevisionId,
        authorAccountId: result.promotion.captureHead.authorAccountId,
        updatedByAccountId: result.promotion.captureHead.updatedByAccountId,
        createdAt: result.promotion.captureHead.createdAt,
        updatedAt: result.promotion.captureHead.updatedAt,
        ...(result.promotion.captureHead.integratedSceneId === undefined
          ? {}
          : { integratedSceneId: result.promotion.captureHead.integratedSceneId }),
        ...(result.promotion.captureHead.integratedAt === undefined
          ? {}
          : { integratedAt: result.promotion.captureHead.integratedAt })
      }),
      navigator: result.promotion.navigator,
      ...(result.promotion.canvas === undefined
        ? {}
        : { canvas: result.promotion.canvas })
    });
  }
  const revision = sceneRevisionMetadata(result.revision);
  return Object.freeze({
    mode: "named-variant" as const,
    ...agentProposalResponse(result.proposal),
    head: Object.freeze({
      sceneId: result.head.sceneId,
      projectId: result.head.projectId,
      workingVersion: result.head.workingVersion,
      contentHash: result.head.contentHash,
      checkpointRevisionId: result.head.checkpointRevisionId,
      updatedByAccountId: result.head.updatedByAccountId,
      createdAt: result.head.createdAt,
      updatedAt: result.head.updatedAt
    }),
    revision: Object.freeze({
      id: revision.id,
      sceneId: revision.sceneId,
      projectId: revision.projectId,
      ...(revision.parentRevisionId === undefined
        ? {}
        : { parentRevisionId: revision.parentRevisionId }),
      schemaVersion: revision.schemaVersion,
      contentHash: revision.contentHash,
      actorAccountId: revision.actorAccountId,
      origin: revision.origin,
      reason: revision.reason,
      createdAt: revision.createdAt
    }),
    variant: Object.freeze({
      id: result.variant.id,
      sceneId: result.variant.sceneId,
      projectId: result.variant.projectId,
      revisionId: result.variant.revisionId,
      creatorAccountId: result.variant.creatorAccountId,
      name: result.variant.name,
      createdAt: result.variant.createdAt,
      updatedAt: result.variant.updatedAt
    })
  });
}

export function mapAgentRunRouteError(
  error: unknown
):
  | Readonly<{ status: ContentfulStatusCode; body: Readonly<{ error: string; code: string }> }>
  | undefined {
  const providerMapped = providerAgentErrorStatusAndBody(error);
  if (providerMapped !== undefined) {
    return providerMapped;
  }
  if (error instanceof ProjectArchivedMutationError) {
    return {
      status: 409,
      body: {
        error: "Archived projects cannot be changed.",
        code: "PROJECT_ARCHIVED"
      }
    };
  }
  if (error instanceof CaptureNotFoundError) {
    return {
      status: 404,
      body: {
        error: "Capture not found.",
        code: "CAPTURE_NOT_FOUND"
      }
    };
  }
  if (error instanceof CraftTargetRequiredError) {
    return {
      status: 400,
      body: {
        error: error.message,
        code: error.code
      }
    };
  }
  if (error instanceof CapturePromotionNotEligibleError) {
    return {
      status: 409,
      body: {
        error: "This capture cannot be promoted.",
        code: "CAPTURE_NOT_PROMOTABLE"
      }
    };
  }
  if (error instanceof AgentReceiptNotFoundError) {
    return {
      status: 404,
      body: {
        error: "Context receipt not found.",
        code: "CONTEXT_RECEIPT_NOT_FOUND"
      }
    };
  }
  if (error instanceof AgentRunNotFoundError) {
    return {
      status: 404,
      body: {
        error: "Agent run not found.",
        code: "AGENT_RUN_NOT_FOUND"
      }
    };
  }
  if (error instanceof AgentProposalNotFoundError) {
    return {
      status: 404,
      body: {
        error: "Agent proposal not found.",
        code: "AGENT_PROPOSAL_NOT_FOUND"
      }
    };
  }
  if (error instanceof AgentRunReceiptMismatchError) {
    return {
      status: 409,
      body: {
        error: "The context receipt hash did not match.",
        code: "CONTEXT_RECEIPT_HASH_MISMATCH"
      }
    };
  }
  if (
    error instanceof AgentRunStateConflictError ||
    error instanceof AgentProposalStateConflictError ||
    error instanceof AgentReceiptConflictError
  ) {
    return {
      status: 409,
      body: {
        error: "The agent run or proposal changed since it was loaded.",
        code: "AGENT_STATE_CONFLICT"
      }
    };
  }
  if (error instanceof AgentProposalContentMismatchError) {
    return {
      status: 409,
      body: {
        error: "The Capture changed since this context receipt was created.",
        code: "CONTEXT_STALE"
      }
    };
  }
  if (error instanceof ProjectVersionConflictError) {
    return {
      status: 409,
      body: {
        error: "The project changed since it was loaded.",
        code: "PROJECT_VERSION_CONFLICT"
      }
    };
  }
  if (error instanceof SceneNotFoundError) {
    return {
      status: 404,
      body: {
        error: "Scene not found.",
        code: "SCENE_NOT_FOUND"
      }
    };
  }
  if (error instanceof SceneWorkingVersionConflictError) {
    return {
      status: 409,
      body: {
        error: "The scene document changed since it was loaded.",
        code: "SCENE_WORKING_VERSION_CONFLICT"
      }
    };
  }
  if (
    error instanceof SceneLeaseConflictError ||
    error instanceof SceneLeaseExpiredError
  ) {
    return {
      status: 409,
      body: {
        error: "Another session holds the scene editing lease.",
        code: "SCENE_LEASE_CONFLICT"
      }
    };
  }
  if (error instanceof SceneVariantNameConflictError) {
    return {
      status: 409,
      body: {
        error: "A scene variant with that name already exists.",
        code: "SCENE_VARIANT_NAME_CONFLICT"
      }
    };
  }
  if (error instanceof DomainValidationError) {
    return {
      status: 400,
      body: {
        error: error.message,
        code: error.code
      }
    };
  }
  return undefined;
}
