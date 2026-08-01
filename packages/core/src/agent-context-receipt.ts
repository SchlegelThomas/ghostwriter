import type { SceneDocumentV1 } from "@ghostwriter/editor";
import { sceneDocumentPlainText } from "./book-reader.js";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import type {
  AgentOutputSchemaId,
  AgentWorkflowId,
  AsyncHashPort,
  CaptureReflectionAssignment,
  CraftPartnerWorkflowId,
  InstructionContentHash,
  InstructionLayerMetadata
} from "./agent-domain.js";
import {
  CAPTURE_REFLECTION_WORKFLOW_ID,
  craftPartnerOutputSchemaId,
  instructionContentHash,
  PLAN_MODE_OUTLINE_WORKFLOW_ID
} from "./agent-domain.js";
import type { CaptureContentHash, CaptureDocumentHead } from "./capture-documents.js";
import type { AgentProposalPrimaryTarget } from "./agent-runs-proposals.js";
import {
  DomainValidationError,
  type CaptureId,
  type ContextReceiptId,
  type ProjectId,
  type SceneId,
  type StoryKnowledgeId
} from "./domain.js";
import {
  agentEgressClassForProvider,
  assertAgentModelId,
  providerForAgentModel,
  type AgentEgressClass
} from "./model-catalog.js";
import type { ProviderId } from "./provider-credentials.js";

export const CAPTURE_REFLECTION_MAX_CAPTURE_CHARS = 24_000;

/** Alias of {@link ProviderId} for receipt/run surfaces. */
export type AgentProviderId = ProviderId;

/**
 * Catalog-validated upstream model id (e.g. `gpt-4.1`, `claude-sonnet-4-5`).
 * Use {@link assertAgentModelId} / {@link isAgentModelId} at boundaries.
 */
export type AgentModelId = string;

export const CAPTURE_REFLECTION_MAX_OUTPUT_TOKENS = 1_500;

export const CAPTURE_REFLECTION_WALL_CLOCK_SECONDS = 60;

export type ContextResourceClass = "capture";

export type ContextReceiptResource = Readonly<{
  resourceClass: ContextResourceClass;
  captureId: CaptureId;
  workingVersion: number;
  contentHash: CaptureContentHash;
  inclusionReason: string;
  providerTextCharCount: number;
  providerTextHash: InstructionContentHash;
}>;

export const CAPTURE_REFLECTION_EXCLUDED_CONTEXT_CLASSES = Object.freeze([
  "publishing-profile",
  "attachments",
  "canvas",
  "manuscript",
  "credentials",
  "unrelated-project-resources"
] as const);

export type ContextReceipt = Readonly<{
  id: ContextReceiptId;
  projectId: ProjectId;
  workflowId: AgentWorkflowId;
  workflowVersion: string;
  layers: readonly InstructionLayerMetadata[];
  resources: readonly ContextReceiptResource[];
  excludedContextClasses: readonly (typeof CAPTURE_REFLECTION_EXCLUDED_CONTEXT_CLASSES)[number][];
  provider: AgentProviderId;
  model: AgentModelId;
  maxOutputTokens: number;
  wallClockSeconds: number;
  toolCount: 0;
  egressClass: AgentEgressClass;
  outputSchemaId: AgentOutputSchemaId;
  targetSceneId?: SceneId;
  targetStoryKnowledgeId?: StoryKnowledgeId;
  primaryTarget?: AgentProposalPrimaryTarget;
  receiptHash: InstructionContentHash;
  createdAt: string;
}>;

export type CaptureProviderTextSlice = Readonly<{
  fullPlainText: string;
  providerPlainText: string;
  truncated: boolean;
}>;

export function sliceCaptureProviderText(document: SceneDocumentV1): CaptureProviderTextSlice {
  const fullPlainText = sceneDocumentPlainText(document);
  if (fullPlainText.length <= CAPTURE_REFLECTION_MAX_CAPTURE_CHARS) {
    return Object.freeze({
      fullPlainText,
      providerPlainText: fullPlainText,
      truncated: false
    });
  }
  return Object.freeze({
    fullPlainText,
    providerPlainText: fullPlainText.slice(0, CAPTURE_REFLECTION_MAX_CAPTURE_CHARS),
    truncated: true
  });
}

export type AssembleCaptureReflectionResourceInput = Readonly<{
  captureHead: CaptureDocumentHead;
  assignment: Readonly<{ captureId: CaptureId }> | CaptureReflectionAssignment;
  hashPort: AsyncHashPort;
}>;

export async function assembleCaptureReflectionResource(
  input: AssembleCaptureReflectionResourceInput
): Promise<ContextReceiptResource> {
  if (input.captureHead.captureId !== input.assignment.captureId) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Capture assignment does not match the loaded Capture."
    );
  }
  const slice = sliceCaptureProviderText(input.captureHead.document);
  const providerTextHash = instructionContentHash(
    await input.hashPort.digestSha256Hex(slice.providerPlainText)
  );
  return Object.freeze({
    resourceClass: "capture",
    captureId: input.captureHead.captureId,
    workingVersion: input.captureHead.workingVersion,
    contentHash: input.captureHead.contentHash,
    inclusionReason: "selected-capture",
    providerTextCharCount: slice.providerPlainText.length,
    providerTextHash
  });
}

export type BuildContextReceiptInput = Readonly<{
  id: ContextReceiptId;
  projectId: ProjectId;
  workflowVersion: string;
  layers: readonly InstructionLayerMetadata[];
  resources: readonly ContextReceiptResource[];
  model: AgentModelId;
  createdAt: string;
  hashPort: AsyncHashPort;
}>;

export async function buildCaptureReflectionContextReceipt(
  input: BuildContextReceiptInput
): Promise<ContextReceipt> {
  const model = assertAgentModelId(input.model);
  const provider = providerForAgentModel(model);
  const egressClass = agentEgressClassForProvider(provider);
  const receiptBody = {
    id: input.id,
    projectId: input.projectId,
    workflowId: CAPTURE_REFLECTION_WORKFLOW_ID,
    workflowVersion: input.workflowVersion,
    layers: input.layers,
    resources: input.resources,
    excludedContextClasses: CAPTURE_REFLECTION_EXCLUDED_CONTEXT_CLASSES,
    provider,
    model,
    maxOutputTokens: CAPTURE_REFLECTION_MAX_OUTPUT_TOKENS,
    wallClockSeconds: CAPTURE_REFLECTION_WALL_CLOCK_SECONDS,
    toolCount: 0 as const,
    egressClass,
    outputSchemaId: "capture-reflection-v1" as const,
    createdAt: input.createdAt
  };
  const receiptHash = instructionContentHash(
    await input.hashPort.digestSha256Hex(canonicalJsonStringify(receiptBody))
  );
  return Object.freeze({
    ...receiptBody,
    receiptHash
  });
}

export type BuildCraftPartnerContextReceiptInput = BuildContextReceiptInput &
  Readonly<{
    workflowId: CraftPartnerWorkflowId;
    targetSceneId?: SceneId;
    targetStoryKnowledgeId?: StoryKnowledgeId;
  }>;

export async function buildCraftPartnerContextReceipt(
  input: BuildCraftPartnerContextReceiptInput
): Promise<ContextReceipt> {
  const model = assertAgentModelId(input.model);
  const provider = providerForAgentModel(model);
  const egressClass = agentEgressClassForProvider(provider);
  const receiptBody = {
    id: input.id,
    projectId: input.projectId,
    workflowId: input.workflowId,
    workflowVersion: input.workflowVersion,
    layers: input.layers,
    resources: input.resources,
    excludedContextClasses: CAPTURE_REFLECTION_EXCLUDED_CONTEXT_CLASSES,
    provider,
    model,
    maxOutputTokens: CAPTURE_REFLECTION_MAX_OUTPUT_TOKENS,
    wallClockSeconds: CAPTURE_REFLECTION_WALL_CLOCK_SECONDS,
    toolCount: 0 as const,
    egressClass,
    outputSchemaId: craftPartnerOutputSchemaId(input.workflowId),
    createdAt: input.createdAt,
    ...(input.targetSceneId === undefined ? {} : { targetSceneId: input.targetSceneId }),
    ...(input.targetStoryKnowledgeId === undefined
      ? {}
      : { targetStoryKnowledgeId: input.targetStoryKnowledgeId })
  };
  const receiptHash = instructionContentHash(
    await input.hashPort.digestSha256Hex(canonicalJsonStringify(receiptBody))
  );
  return Object.freeze({
    ...receiptBody,
    receiptHash
  });
}

export const PLAN_MODE_OUTLINE_WORKFLOW_CONTRACT_VERSION = "1" as const;

export async function buildPlanModeOutlineContextReceipt(
  input: BuildContextReceiptInput
): Promise<ContextReceipt> {
  const model = assertAgentModelId(input.model);
  const provider = providerForAgentModel(model);
  const egressClass = agentEgressClassForProvider(provider);
  const receiptBody = {
    id: input.id,
    projectId: input.projectId,
    workflowId: PLAN_MODE_OUTLINE_WORKFLOW_ID,
    workflowVersion: input.workflowVersion,
    layers: input.layers,
    resources: input.resources,
    excludedContextClasses: CAPTURE_REFLECTION_EXCLUDED_CONTEXT_CLASSES,
    provider,
    model,
    maxOutputTokens: CAPTURE_REFLECTION_MAX_OUTPUT_TOKENS,
    wallClockSeconds: CAPTURE_REFLECTION_WALL_CLOCK_SECONDS,
    toolCount: 0 as const,
    egressClass,
    outputSchemaId: "plan-outline-v1" as const,
    createdAt: input.createdAt
  };
  const receiptHash = instructionContentHash(
    await input.hashPort.digestSha256Hex(canonicalJsonStringify(receiptBody))
  );
  return Object.freeze({
    ...receiptBody,
    receiptHash
  });
}
