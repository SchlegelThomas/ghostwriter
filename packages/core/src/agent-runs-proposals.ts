import type {
  AgentModelId,
  AgentProviderId,
  ContextReceipt
} from "./agent-context-receipt.js";
import type {
  AgentOutputSchemaId,
  AgentWorkflowId,
  AsyncHashPort,
  InstructionContentHash
} from "./agent-domain.js";
import { AGENT_OUTPUT_SCHEMA_IDS, instructionContentHash } from "./agent-domain.js";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import type { CaptureReflectionV1 } from "./capture-reflection-v1.js";
import { validateCaptureReflectionV1 } from "./capture-reflection-v1.js";
import type { CraftPartnerPayload } from "./craft-partner-schemas.js";
import { validateCraftPartnerPayload } from "./craft-partner-schemas.js";
import type { PlanOutlineV1 } from "./plan-outline-v1.js";
import { validatePlanOutlineV1 } from "./plan-outline-v1.js";
import type { CatalogMemoV1 } from "./catalog-memo-v1.js";
import { validateCatalogMemoV1 } from "./catalog-memo-v1.js";
import type { PacingFindingsV1 } from "./pacing-findings-v1.js";
import { validatePacingFindingsV1 } from "./pacing-findings-v1.js";
import type { NextActionV1 } from "./next-action-v1.js";
import { validateNextActionV1 } from "./next-action-v1.js";
import type { WorkPlanV1 } from "./work-plan-v1.js";
import { validateWorkPlanV1 } from "./work-plan-v1.js";
import type { StoryKnowledgeCreateV1 } from "./story-knowledge-create-v1.js";
import { validateStoryKnowledgeCreateV1 } from "./story-knowledge-create-v1.js";
import {
  agentProposalListPreviewFromPayload,
  type AgentProposalListPreview
} from "./agent-proposal-list-preview.js";
import type { CaptureContentHash, CaptureDocumentHead } from "./capture-documents.js";
import {
  DomainValidationError,
  type AgentProposalId,
  type AgentRunId,
  type CaptureId,
  type ContextReceiptId,
  type ProjectId
} from "./domain.js";
import type { AccountId } from "./identity.js";

export type AgentProposalPayload =
  | CaptureReflectionV1
  | PlanOutlineV1
  | CatalogMemoV1
  | PacingFindingsV1
  | NextActionV1
  | WorkPlanV1
  | StoryKnowledgeCreateV1
  | CraftPartnerPayload;

export const AGENT_FOUNDATION_LIST_MAX = 100;

export const AGENT_PROPOSAL_TARGET_KINDS = Object.freeze([
  "capture",
  "scene",
  "story-knowledge",
  "book",
  "project"
] as const);

export type AgentProposalTargetKind = (typeof AGENT_PROPOSAL_TARGET_KINDS)[number];
export type AgentProposalPrimaryTarget = Readonly<{
  kind: AgentProposalTargetKind;
  id: string;
}>;

export const AGENT_RUN_STATUSES = Object.freeze([
  "queued",
  "running",
  "needs-input",
  "ready",
  "failed",
  "canceled",
  "stale"
] as const);

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_PROPOSAL_STATUSES = Object.freeze([
  "ready",
  "rejected",
  "stale",
  "applied"
] as const);

export type AgentProposalStatus = (typeof AGENT_PROPOSAL_STATUSES)[number];

export const AGENT_RUN_TERMINAL_DIAGNOSTIC_CODES = Object.freeze([
  "provider-timeout",
  "provider-rate-limited",
  "provider-malformed-output",
  "provider-unavailable",
  "run-canceled",
  "context-stale",
  "internal-failure"
] as const);

export type AgentRunTerminalDiagnosticCode =
  (typeof AGENT_RUN_TERMINAL_DIAGNOSTIC_CODES)[number];

export type AgentTokenUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}>;

export type AgentRun = Readonly<{
  id: AgentRunId;
  projectId: ProjectId;
  initiatorAccountId: AccountId;
  workflowId: AgentWorkflowId;
  workflowVersion: string;
  provider: AgentProviderId;
  model: AgentModelId;
  receiptId: ContextReceiptId;
  receiptHash: InstructionContentHash;
  status: AgentRunStatus;
  createdAt: string;
  updatedAt: string;
  cancelRequestedAt?: string;
  completedAt?: string;
  providerResponseId?: string;
  tokenUsage?: AgentTokenUsage;
  terminalDiagnosticCode?: AgentRunTerminalDiagnosticCode;
}>;

export type AgentProposalDecision = Readonly<{
  actorAccountId: AccountId;
  decidedAt: string;
}>;

export type AgentProposalAppliedRecord = Readonly<{
  actorAccountId: AccountId;
  appliedAt: string;
}>;

type AgentProposalBase = Readonly<{
  id: AgentProposalId;
  projectId: ProjectId;
  runId: AgentRunId;
  receiptId: ContextReceiptId;
  status: AgentProposalStatus;
  outputSchemaId: AgentOutputSchemaId;
  payload: AgentProposalPayload;
  contentHash: InstructionContentHash;
  createdAt: string;
  updatedAt: string;
  decision?: AgentProposalDecision;
  applied?: AgentProposalAppliedRecord;
}>;

export type AgentProposal =
  | (AgentProposalBase &
      Readonly<{
        primaryTarget: Readonly<{ kind: "capture"; id: CaptureId }>;
        baseCaptureId: CaptureId;
        baseCaptureWorkingVersion: number;
        baseCaptureContentHash: CaptureContentHash;
      }>)
  | (AgentProposalBase &
      Readonly<{
        primaryTarget: Readonly<{
          kind: Exclude<AgentProposalTargetKind, "capture">;
          id: string;
        }>;
        baseCaptureId?: CaptureId;
        baseCaptureWorkingVersion?: number;
        baseCaptureContentHash?: CaptureContentHash;
      }>);

type AgentProposalInput = AgentProposalBase &
  Readonly<{
    primaryTarget: AgentProposalPrimaryTarget;
    baseCaptureId?: CaptureId;
    baseCaptureWorkingVersion?: number;
    baseCaptureContentHash?: CaptureContentHash;
  }>;

export type AgentRunSummary = Readonly<{
  id: AgentRunId;
  projectId: ProjectId;
  status: AgentRunStatus;
  workflowId: AgentWorkflowId;
  receiptId: ContextReceiptId;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}>;

export type { AgentProposalListPreview } from "./agent-proposal-list-preview.js";
export { agentProposalListPreviewFromPayload } from "./agent-proposal-list-preview.js";

export type AgentProposalSummary = Readonly<{
  id: AgentProposalId;
  projectId: ProjectId;
  runId: AgentRunId;
  status: AgentProposalStatus;
  outputSchemaId: AgentOutputSchemaId;
  contentHash: InstructionContentHash;
  primaryTarget: AgentProposalPrimaryTarget;
  baseCaptureId?: CaptureId;
  createdAt: string;
  updatedAt: string;
  preview: AgentProposalListPreview;
}>;

export class AgentRunNotFoundError extends Error {
  constructor() {
    super("The agent run could not be found.");
    this.name = "AgentRunNotFoundError";
  }
}

export class AgentProposalNotFoundError extends Error {
  constructor() {
    super("The agent proposal could not be found.");
    this.name = "AgentProposalNotFoundError";
  }
}

export class AgentReceiptNotFoundError extends Error {
  constructor() {
    super("The context receipt could not be found.");
    this.name = "AgentReceiptNotFoundError";
  }
}

export class AgentReceiptConflictError extends Error {
  constructor() {
    super("The context receipt identifier is already in use.");
    this.name = "AgentReceiptConflictError";
  }
}

export class AgentRunStateConflictError extends Error {
  constructor() {
    super("The agent run is not in the expected state.");
    this.name = "AgentRunStateConflictError";
  }
}

export class AgentProposalStateConflictError extends Error {
  constructor() {
    super("The agent proposal is not in the expected state.");
    this.name = "AgentProposalStateConflictError";
  }
}

export class AgentRunReceiptMismatchError extends Error {
  constructor() {
    super("The agent run does not match the persisted context receipt.");
    this.name = "AgentRunReceiptMismatchError";
  }
}

export class AgentProposalContentMismatchError extends Error {
  constructor() {
    super("The agent proposal does not match the expected capture revision.");
    this.name = "AgentProposalContentMismatchError";
  }
}

const TERMINAL_RUN_STATUSES = new Set<AgentRunStatus>([
  "ready",
  "failed",
  "canceled",
  "stale"
]);

const VALID_RUN_TRANSITIONS = Object.freeze({
  queued: ["running", "canceled", "failed", "stale"],
  running: ["needs-input", "ready", "failed", "canceled", "stale"],
  "needs-input": ["running", "failed", "canceled", "stale"],
  ready: [],
  failed: [],
  canceled: [],
  stale: []
} as const satisfies Record<AgentRunStatus, readonly AgentRunStatus[]>);

const VALID_PROPOSAL_TRANSITIONS = Object.freeze({
  ready: ["rejected", "stale", "applied"],
  rejected: [],
  stale: [],
  applied: []
} as const satisfies Record<AgentProposalStatus, readonly AgentProposalStatus[]>);

function requireTimestamp(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", `${field} must not be empty.`);
  }
  return normalized;
}

function requireNonNegativeTokenCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      `${field} must be a non-negative integer.`
    );
  }
  return value;
}

export function createAgentTokenUsage(input: AgentTokenUsage): AgentTokenUsage {
  const inputTokens = requireNonNegativeTokenCount(input.inputTokens, "Input token count");
  const outputTokens = requireNonNegativeTokenCount(input.outputTokens, "Output token count");
  const totalTokens = requireNonNegativeTokenCount(input.totalTokens, "Total token count");
  if (totalTokens < inputTokens + outputTokens) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Total token count is inconsistent."
    );
  }
  return Object.freeze({ inputTokens, outputTokens, totalTokens });
}

function requireWorkflowVersion(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 64) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Workflow version is out of bounds."
    );
  }
  return normalized;
}

function requireProviderResponseId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 200) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Provider response identifier is out of bounds."
    );
  }
  return normalized;
}

function normalizeAgentProposalPrimaryTarget(
  target: AgentProposalPrimaryTarget
): AgentProposalPrimaryTarget {
  if (!AGENT_PROPOSAL_TARGET_KINDS.includes(target.kind)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Agent proposal target kind is not recognized."
    );
  }
  const id = target.id.trim();
  if (id.length === 0 || id.length > 200) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Agent proposal target identifier is out of bounds."
    );
  }
  return Object.freeze({ kind: target.kind, id });
}

function normalizeProposalBinding(input: Readonly<{
  primaryTarget: AgentProposalPrimaryTarget;
  baseCaptureId?: CaptureId;
  baseCaptureWorkingVersion?: number;
  baseCaptureContentHash?: CaptureContentHash;
}>): Readonly<{
  primaryTarget: AgentProposalPrimaryTarget;
  baseCaptureId?: CaptureId;
  baseCaptureWorkingVersion?: number;
  baseCaptureContentHash?: CaptureContentHash;
}> {
  const primaryTarget = normalizeAgentProposalPrimaryTarget(input.primaryTarget);
  const bindingCount = [
    input.baseCaptureId,
    input.baseCaptureWorkingVersion,
    input.baseCaptureContentHash
  ].filter((value) => value !== undefined).length;
  if (primaryTarget.kind === "capture") {
    if (
      bindingCount !== 3 ||
      input.baseCaptureId === undefined ||
      primaryTarget.id !== input.baseCaptureId
    ) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Capture-targeted proposals require a matching Capture base."
      );
    }
  } else if (bindingCount !== 0 && bindingCount !== 3) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Agent proposal Capture base fields must be supplied together."
    );
  }
  return Object.freeze({
    primaryTarget,
    ...(input.baseCaptureId === undefined ? {} : { baseCaptureId: input.baseCaptureId }),
    ...(input.baseCaptureWorkingVersion === undefined
      ? {}
      : { baseCaptureWorkingVersion: input.baseCaptureWorkingVersion }),
    ...(input.baseCaptureContentHash === undefined
      ? {}
      : { baseCaptureContentHash: input.baseCaptureContentHash })
  });
}

export function assertAgentRunTransition(
  current: AgentRunStatus,
  next: AgentRunStatus
): void {
  const allowed = VALID_RUN_TRANSITIONS[current] as readonly AgentRunStatus[];
  if (!allowed.includes(next)) {
    throw new AgentRunStateConflictError();
  }
}

export function assertAgentProposalTransition(
  current: AgentProposalStatus,
  next: AgentProposalStatus
): void {
  const allowed = VALID_PROPOSAL_TRANSITIONS[current] as readonly AgentProposalStatus[];
  if (!allowed.includes(next)) {
    throw new AgentProposalStateConflictError();
  }
}

export function agentRunIdentityMatches(current: AgentRun, next: AgentRun): boolean {
  return (
    current.id === next.id &&
    current.projectId === next.projectId &&
    current.initiatorAccountId === next.initiatorAccountId &&
    current.workflowId === next.workflowId &&
    current.workflowVersion === next.workflowVersion &&
    current.provider === next.provider &&
    current.model === next.model &&
    current.receiptId === next.receiptId &&
    current.receiptHash === next.receiptHash &&
    current.createdAt === next.createdAt
  );
}

export function assertAgentRunIdentityPreserved(current: AgentRun, next: AgentRun): void {
  if (!agentRunIdentityMatches(current, next)) {
    throw new AgentRunStateConflictError();
  }
}

export function agentProposalIdentityMatches(
  current: AgentProposal,
  next: AgentProposal
): boolean {
  return (
    current.id === next.id &&
    current.projectId === next.projectId &&
    current.runId === next.runId &&
    current.receiptId === next.receiptId &&
    current.outputSchemaId === next.outputSchemaId &&
    canonicalJsonStringify(current.payload) === canonicalJsonStringify(next.payload) &&
    current.contentHash === next.contentHash &&
    canonicalJsonStringify(current.primaryTarget) ===
      canonicalJsonStringify(next.primaryTarget) &&
    current.baseCaptureId === next.baseCaptureId &&
    current.baseCaptureWorkingVersion === next.baseCaptureWorkingVersion &&
    current.baseCaptureContentHash === next.baseCaptureContentHash &&
    current.createdAt === next.createdAt
  );
}

export function assertAgentProposalIdentityPreserved(
  current: AgentProposal,
  next: AgentProposal
): void {
  if (!agentProposalIdentityMatches(current, next)) {
    throw new AgentProposalStateConflictError();
  }
}

export function isTerminalAgentRunStatus(status: AgentRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export function createQueuedAgentRun(input: AgentRun): AgentRun {
  if (input.status !== "queued") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "New agent runs must start queued."
    );
  }
  if (
    input.cancelRequestedAt !== undefined ||
    input.completedAt !== undefined ||
    input.providerResponseId !== undefined ||
    input.tokenUsage !== undefined ||
    input.terminalDiagnosticCode !== undefined
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Queued agent runs cannot include terminal fields."
    );
  }
  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    initiatorAccountId: input.initiatorAccountId,
    workflowId: input.workflowId,
    workflowVersion: requireWorkflowVersion(input.workflowVersion),
    provider: input.provider,
    model: input.model,
    receiptId: input.receiptId,
    receiptHash: instructionContentHash(String(input.receiptHash)),
    status: "queued",
    createdAt: requireTimestamp(input.createdAt, "Agent run creation time"),
    updatedAt: requireTimestamp(input.updatedAt, "Agent run update time")
  });
}

export function createAgentRun(input: AgentRun): AgentRun {
  if (!AGENT_RUN_STATUSES.includes(input.status)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Agent run status is not recognized."
    );
  }
  const base = Object.freeze({
    id: input.id,
    projectId: input.projectId,
    initiatorAccountId: input.initiatorAccountId,
    workflowId: input.workflowId,
    workflowVersion: requireWorkflowVersion(input.workflowVersion),
    provider: input.provider,
    model: input.model,
    receiptId: input.receiptId,
    receiptHash: instructionContentHash(String(input.receiptHash)),
    status: input.status,
    createdAt: requireTimestamp(input.createdAt, "Agent run creation time"),
    updatedAt: requireTimestamp(input.updatedAt, "Agent run update time"),
    ...(input.cancelRequestedAt === undefined
      ? {}
      : { cancelRequestedAt: requireTimestamp(input.cancelRequestedAt, "Cancel request time") }),
    ...(input.completedAt === undefined
      ? {}
      : { completedAt: requireTimestamp(input.completedAt, "Agent run completion time") }),
    ...(input.providerResponseId === undefined
      ? {}
      : { providerResponseId: requireProviderResponseId(input.providerResponseId) }),
    ...(input.tokenUsage === undefined
      ? {}
      : { tokenUsage: createAgentTokenUsage(input.tokenUsage) }),
    ...(input.terminalDiagnosticCode === undefined
      ? {}
      : { terminalDiagnosticCode: input.terminalDiagnosticCode })
  });
  if (isTerminalAgentRunStatus(base.status)) {
    if (base.completedAt === undefined) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Terminal agent runs require a completion timestamp."
      );
    }
    if (base.status === "failed" && base.terminalDiagnosticCode === undefined) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Failed agent runs require a diagnostic code."
      );
    }
    if (base.status !== "failed" && base.terminalDiagnosticCode !== undefined) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Only failed agent runs may record a diagnostic code."
      );
    }
    if (base.status === "ready" && base.terminalDiagnosticCode !== undefined) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Ready agent runs cannot record failure diagnostics."
      );
    }
  } else if (
    base.terminalDiagnosticCode !== undefined ||
    base.completedAt !== undefined
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Non-terminal agent runs cannot include completion diagnostics."
    );
  }
  if (
    base.terminalDiagnosticCode !== undefined &&
    !AGENT_RUN_TERMINAL_DIAGNOSTIC_CODES.includes(base.terminalDiagnosticCode)
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Agent run diagnostic code is not recognized."
    );
  }
  return base;
}

export function validateAgentProposalPayload(
  outputSchemaId: AgentOutputSchemaId,
  payload: unknown
): AgentProposalPayload {
  if (!AGENT_OUTPUT_SCHEMA_IDS.includes(outputSchemaId)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Agent proposal output schema is not supported."
    );
  }
  if (outputSchemaId === "capture-reflection-v1") {
    return validateCaptureReflectionV1(payload);
  }
  if (outputSchemaId === "plan-outline-v1") {
    return validatePlanOutlineV1(payload);
  }
  if (outputSchemaId === "catalog-memo-v1") {
    return validateCatalogMemoV1(payload);
  }
  if (outputSchemaId === "pacing-findings-v1") {
    return validatePacingFindingsV1(payload);
  }
  if (outputSchemaId === "next-action-v1") {
    return validateNextActionV1(payload);
  }
  if (outputSchemaId === "work-plan-v1") {
    return validateWorkPlanV1(payload);
  }
  if (outputSchemaId === "story-knowledge-create-v1") {
    return validateStoryKnowledgeCreateV1(payload);
  }
  return validateCraftPartnerPayload(outputSchemaId, payload);
}

export function createReadyAgentProposal(input: AgentProposalInput): AgentProposal {
  if (input.status !== "ready") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "New agent proposals must start ready."
    );
  }
  if (!AGENT_OUTPUT_SCHEMA_IDS.includes(input.outputSchemaId)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Agent proposal output schema is not supported."
    );
  }
  if (input.decision !== undefined || input.applied !== undefined) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Ready agent proposals cannot include decision or apply records."
    );
  }
  const payload = validateAgentProposalPayload(input.outputSchemaId, input.payload);
  const binding = normalizeProposalBinding(input);
  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    runId: input.runId,
    receiptId: input.receiptId,
    status: "ready",
    outputSchemaId: input.outputSchemaId,
    payload,
    contentHash: instructionContentHash(String(input.contentHash)),
    ...binding,
    createdAt: requireTimestamp(input.createdAt, "Agent proposal creation time"),
    updatedAt: requireTimestamp(input.updatedAt, "Agent proposal update time")
  }) as AgentProposal;
}

export function createAgentProposal(input: AgentProposalInput): AgentProposal {
  if (!AGENT_PROPOSAL_STATUSES.includes(input.status)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Agent proposal status is not recognized."
    );
  }
  if (!AGENT_OUTPUT_SCHEMA_IDS.includes(input.outputSchemaId)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Agent proposal output schema is not supported."
    );
  }
  const payload = validateAgentProposalPayload(input.outputSchemaId, input.payload);
  const binding = normalizeProposalBinding(input);
  const proposal = Object.freeze({
    id: input.id,
    projectId: input.projectId,
    runId: input.runId,
    receiptId: input.receiptId,
    status: input.status,
    outputSchemaId: input.outputSchemaId,
    payload,
    contentHash: instructionContentHash(String(input.contentHash)),
    ...binding,
    createdAt: requireTimestamp(input.createdAt, "Agent proposal creation time"),
    updatedAt: requireTimestamp(input.updatedAt, "Agent proposal update time"),
    ...(input.decision === undefined
      ? {}
      : {
          decision: Object.freeze({
            actorAccountId: input.decision.actorAccountId,
            decidedAt: requireTimestamp(input.decision.decidedAt, "Proposal decision time")
          })
        }),
    ...(input.applied === undefined
      ? {}
      : {
          applied: Object.freeze({
            actorAccountId: input.applied.actorAccountId,
            appliedAt: requireTimestamp(input.applied.appliedAt, "Proposal apply time")
          })
        })
  });
  if (proposal.status === "ready") {
    if (proposal.decision !== undefined || proposal.applied !== undefined) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Ready agent proposals cannot include decision or apply records."
      );
    }
  }
  if (proposal.status === "rejected") {
    if (proposal.decision === undefined || proposal.applied !== undefined) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Rejected agent proposals require a human decision record."
      );
    }
  }
  if (proposal.status === "applied") {
    if (proposal.applied === undefined) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Applied agent proposals require an apply record."
      );
    }
  }
  if (proposal.status === "stale") {
    if (proposal.applied !== undefined) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Stale agent proposals cannot include apply records."
      );
    }
  }
  return proposal as AgentProposal;
}

export function agentRunSummaryFromRun(run: AgentRun): AgentRunSummary {
  return Object.freeze({
    id: run.id,
    projectId: run.projectId,
    status: run.status,
    workflowId: run.workflowId,
    receiptId: run.receiptId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt })
  });
}

export function agentProposalSummaryFromProposal(
  proposal: AgentProposal
): AgentProposalSummary {
  return Object.freeze({
    id: proposal.id,
    projectId: proposal.projectId,
    runId: proposal.runId,
    status: proposal.status,
    outputSchemaId: proposal.outputSchemaId,
    contentHash: proposal.contentHash,
    primaryTarget: proposal.primaryTarget,
    ...(proposal.baseCaptureId === undefined
      ? {}
      : { baseCaptureId: proposal.baseCaptureId }),
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    preview: agentProposalListPreviewFromPayload(
      proposal.outputSchemaId,
      proposal.payload
    )
  });
}

export function normalizeAgentFoundationListLimit(limit: number | undefined): number {
  if (limit === undefined) return AGENT_FOUNDATION_LIST_MAX;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > AGENT_FOUNDATION_LIST_MAX) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      `List limit must be between 1 and ${AGENT_FOUNDATION_LIST_MAX}.`
    );
  }
  return limit;
}

export function receiptsMatch(left: ContextReceipt, right: ContextReceipt): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

export type ProposalContentHashInput = Readonly<{
  outputSchemaId: AgentOutputSchemaId;
  payload: AgentProposalPayload;
  primaryTarget: AgentProposalPrimaryTarget;
  baseCaptureId?: CaptureId;
  baseCaptureWorkingVersion?: number;
  baseCaptureContentHash?: CaptureContentHash;
}>;

export async function computeAgentProposalContentHash(
  input: ProposalContentHashInput,
  hashPort: AsyncHashPort
): Promise<InstructionContentHash> {
  const binding = normalizeProposalBinding(input);
  const body = Object.freeze({
    outputSchemaId: input.outputSchemaId,
    payload: input.payload,
    ...binding
  });
  return instructionContentHash(
    await hashPort.digestSha256Hex(canonicalJsonStringify(body))
  );
}

export function assertReceiptMatchesRun(receipt: ContextReceipt, run: AgentRun): void {
  if (
    receipt.id !== run.receiptId ||
    receipt.projectId !== run.projectId ||
    receipt.receiptHash !== run.receiptHash
  ) {
    throw new AgentRunReceiptMismatchError();
  }
}

export function primaryCaptureFromReceipt(receipt: ContextReceipt): Readonly<{
  captureId: CaptureId;
  workingVersion: number;
  contentHash: CaptureContentHash;
}> {
  const captureResources = receipt.resources.filter(
    (resource) => resource.resourceClass === "capture"
  );
  if (captureResources.length !== 1) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Capture reflection receipts must include exactly one Capture resource."
    );
  }
  const resource = captureResources[0];
  if (resource === undefined) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Capture reflection receipts must include exactly one Capture resource."
    );
  }
  return Object.freeze({
    captureId: resource.captureId,
    workingVersion: resource.workingVersion,
    contentHash: resource.contentHash
  });
}

export type ReceiptCaptureBinding = Readonly<{
  captureId: CaptureId;
  workingVersion: number;
  contentHash: CaptureContentHash;
}>;

export type ReceiptCaptureBindingEvaluation =
  | Readonly<{ ok: true; binding: ReceiptCaptureBinding; head: CaptureDocumentHead }>
  | Readonly<{ ok: false; reason: "not-found" | "cross-project" | "context-stale" }>;

export function evaluateReceiptCaptureBinding(
  receipt: ContextReceipt,
  projectId: ProjectId,
  head: CaptureDocumentHead | undefined
): ReceiptCaptureBindingEvaluation {
  const binding = primaryCaptureFromReceipt(receipt);
  if (head === undefined || head.captureId !== binding.captureId) {
    return Object.freeze({ ok: false, reason: "not-found" });
  }
  if (head.projectId !== projectId || head.projectId !== receipt.projectId) {
    return Object.freeze({ ok: false, reason: "cross-project" });
  }
  if (head.status === "integrated" || head.status === "archived") {
    return Object.freeze({ ok: false, reason: "context-stale" });
  }
  if (
    head.workingVersion !== binding.workingVersion ||
    head.contentHash !== binding.contentHash
  ) {
    return Object.freeze({ ok: false, reason: "context-stale" });
  }
  return Object.freeze({ ok: true, binding, head });
}
