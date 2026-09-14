import { canonicalJsonStringify } from "./agent-canonical-json.js";
import type { ContextReceipt } from "./agent-context-receipt.js";
import type {
  AgentOutputSchemaId,
  AgentWorkflowId,
  AsyncHashPort
} from "./agent-domain.js";
import { instructionContentHash } from "./agent-domain.js";
import type { AgentProposal, AgentProposalTargetKind, AgentRun } from "./agent-runs-proposals.js";
import type { CaptureDocumentHead } from "./capture-documents.js";
import type { CaptureId, SceneId } from "./domain.js";
import type { AccountId } from "./identity.js";
import type { SceneDocumentHead } from "./scene-documents.js";
import {
  assembleStoryStructureResource,
  type StoryContextReceiptResource
} from "./story-context-receipt.js";
import { storyContextFromProjectRecords } from "./story-context.js";
import type { ProjectRecords } from "./domain.js";
import type {
  StoryWorkArtifactPointer,
  StoryWorkAssignment
} from "./story-work-assignment.js";
import type { StoryWorkAttempt } from "./story-work-attempt.js";
import { StoryWorkAttemptTransitionError } from "./story-work-attempt.js";

export type StoryWorkApplyArtifactExpectation = Readonly<{
  projectId: StoryWorkAssignment["projectId"];
  assignmentId: StoryWorkAssignment["id"];
  proposalId: AgentProposal["id"];
  expectedArtifactVersion: number;
  expectedProposalContentHash: string;
}>;

export type StoryWorkCanonicalApplyInputs = Readonly<{
  accountId: AccountId;
  exactInput: StoryWorkApplyArtifactExpectation;
  assignment: StoryWorkAssignment;
  attempt: StoryWorkAttempt;
  proposal: AgentProposal;
  run: AgentRun;
  receipt: ContextReceipt;
}>;

export type StoryWorkApplyBindingPolicy<TargetId extends string> = Readonly<{
  workflowId: AgentWorkflowId;
  outputSchemaId: AgentOutputSchemaId;
  targetKind: AgentProposalTargetKind;
  destinationId(assignment: StoryWorkAssignment): TargetId;
  receiptTargetId(receipt: ContextReceipt): string | undefined;
  artifactMismatch(message?: string): Error;
}>;

function sameArtifactPointers(
  left: StoryWorkArtifactPointer | undefined,
  right: StoryWorkArtifactPointer | undefined
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.proposalId === right.proposalId &&
    left.artifactVersion === right.artifactVersion &&
    left.contentHash === right.contentHash
  );
}

/** Validates immutable assignment/run/receipt/proposal lineage before any apply mutation. */
export function validateStoryWorkApplyBindings<TargetId extends string>(
  input: StoryWorkCanonicalApplyInputs,
  policy: StoryWorkApplyBindingPolicy<TargetId>
): TargetId {
  const { assignment, attempt, proposal, receipt, run, exactInput } = input;
  const destinationId = policy.destinationId(assignment);
  const expectedContentHash = instructionContentHash(
    String(exactInput.expectedProposalContentHash)
  );
  if (
    assignment.id !== exactInput.assignmentId ||
    assignment.projectId !== exactInput.projectId ||
    assignment.initiatorAccountId !== input.accountId ||
    proposal.id !== exactInput.proposalId ||
    proposal.projectId !== exactInput.projectId ||
    proposal.runId !== run.id ||
    proposal.receiptId !== receipt.id ||
    run.projectId !== exactInput.projectId ||
    run.initiatorAccountId !== input.accountId ||
    run.receiptId !== receipt.id ||
    run.receiptHash !== receipt.receiptHash ||
    receipt.projectId !== exactInput.projectId ||
    run.workflowId !== policy.workflowId ||
    receipt.workflowId !== policy.workflowId ||
    run.workflowVersion !== receipt.workflowVersion ||
    assignment.provider !== run.provider ||
    assignment.model !== run.model ||
    receipt.provider !== run.provider ||
    receipt.model !== run.model ||
    proposal.outputSchemaId !== policy.outputSchemaId ||
    proposal.primaryTarget.kind !== policy.targetKind ||
    proposal.primaryTarget.id !== destinationId ||
    receipt.outputSchemaId !== policy.outputSchemaId ||
    policy.receiptTargetId(receipt) !== destinationId ||
    receipt.primaryTarget?.kind !== policy.targetKind ||
    receipt.primaryTarget.id !== destinationId ||
    assignment.currentArtifact?.proposalId !== exactInput.proposalId ||
    assignment.currentArtifact.artifactVersion !==
      exactInput.expectedArtifactVersion ||
    assignment.currentArtifact.contentHash !==
      expectedContentHash ||
    proposal.contentHash !== expectedContentHash
  ) {
    throw policy.artifactMismatch();
  }
  if (
    attempt.assignmentId !== assignment.id ||
    attempt.projectId !== exactInput.projectId ||
    attempt.initiatorAccountId !== input.accountId ||
    attempt.runId !== run.id ||
    !sameArtifactPointers(attempt.resultArtifact, assignment.generatedArtifact)
  ) {
    throw new StoryWorkAttemptTransitionError();
  }
  return destinationId;
}

export type StoryWorkReceiptFreshnessPolicy = Readonly<{
  label: string;
  allowCapture: boolean;
  requireExactAssignmentSources?: boolean;
  requireActiveSceneSources?: boolean;
  maximumCaptures?: number;
  stale(message: string): Error;
}>;

export type ValidateStoryWorkReceiptFreshnessInput = Readonly<{
  assignment: StoryWorkAssignment;
  receipt: ContextReceipt;
  currentRecords: ProjectRecords;
  sceneDocumentHeads: ReadonlyMap<SceneId, SceneDocumentHead>;
  captureDocumentHeads?: ReadonlyMap<CaptureId, CaptureDocumentHead>;
  hashPort: AsyncHashPort;
}>;

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = [...left].sort();
  const actual = [...right].sort();
  return expected.every((id, index) => id === actual[index]);
}

/** Rebuilds canonical context and checks every consumed independent document head. */
export async function validateStoryWorkReceiptFreshness(
  input: ValidateStoryWorkReceiptFreshnessInput,
  policy: StoryWorkReceiptFreshnessPolicy
): Promise<void> {
  const stale = (message: string): never => {
    throw policy.stale(message);
  };
  const resources = input.receipt.resources;
  const structureResources = resources.filter(
    (resource): resource is Extract<StoryContextReceiptResource, { resourceClass: "story-context" }> =>
      resource.resourceClass === "story-context"
  );
  const sceneResources = resources.filter(
    (resource): resource is Extract<StoryContextReceiptResource, { resourceClass: "scene-document" }> =>
      resource.resourceClass === "scene-document"
  );
  const captureResources = resources.filter(
    (resource) => resource.resourceClass === "capture"
  );
  const proposalArtifactResources = resources.filter(
    (resource) => resource.resourceClass === "proposal-artifact"
  );
  if (proposalArtifactResources.length > 0) {
    stale(`${policy.label} apply receipt contains an unsupported proposal-artifact resource.`);
  }
  if (!policy.allowCapture && captureResources.length > 0) {
    stale(`${policy.label} apply receipt contains an unsupported context resource.`);
  }
  if (
    policy.maximumCaptures !== undefined &&
    captureResources.length > policy.maximumCaptures
  ) {
    stale(`${policy.label} apply receipt contains too many Capture dependencies.`);
  }
  if (structureResources.length !== 1) {
    stale(`${policy.label} apply requires one exact story-context dependency.`);
  }
  const structure = structureResources[0]!;
  const currentStructure = await assembleStoryStructureResource({
      projectId: input.currentRecords.project.id,
      context: storyContextFromProjectRecords(input.currentRecords, {
        scope: structure.scope
      }),
      inclusionReason: structure.inclusionReason,
      hashPort: input.hashPort
    }).catch(() =>
      stale(`The story context used for ${policy.label.toLowerCase()} work changed before apply.`)
    );
  if (
    canonicalJsonStringify(currentStructure.resource) !==
    canonicalJsonStringify(structure)
  ) {
    stale(`The story context used for ${policy.label.toLowerCase()} work changed before apply.`);
  }

  const includedSceneIds = new Set(currentStructure.resource.sceneIds);
  const seenSceneIds = new Set<SceneId>();
  for (const resource of sceneResources) {
    if (seenSceneIds.has(resource.sceneId) || !includedSceneIds.has(resource.sceneId)) {
      stale(`${policy.label} apply scene dependencies no longer match the consumed story scope.`);
    }
    seenSceneIds.add(resource.sceneId);
    const head = input.sceneDocumentHeads.get(resource.sceneId);
    const scene = input.currentRecords.scenes.find(
      (candidate) => candidate.id === resource.sceneId
    );
    if (
      head === undefined ||
      head.projectId !== resource.projectId ||
      head.sceneId !== resource.sceneId ||
      head.workingVersion !== resource.workingVersion ||
      head.contentHash !== resource.contentHash ||
      (policy.requireActiveSceneSources === true &&
        (scene === undefined || scene.archivedAt !== undefined))
    ) {
      stale(`Consumed scene prose changed before ${policy.label.toLowerCase()} apply.`);
    }
  }

  const seenCaptureIds = new Set<CaptureId>();
  for (const resource of captureResources) {
    if (seenCaptureIds.has(resource.captureId)) {
      stale(`${policy.label} apply contains a duplicate Capture dependency.`);
    }
    seenCaptureIds.add(resource.captureId);
    const head = input.captureDocumentHeads?.get(resource.captureId);
    if (
      head === undefined ||
      head.projectId !== input.currentRecords.project.id ||
      head.captureId !== resource.captureId ||
      head.workingVersion !== resource.workingVersion ||
      head.contentHash !== resource.contentHash ||
      head.status === "archived"
    ) {
      stale(`Consumed Capture changed before ${policy.label.toLowerCase()} apply.`);
    }
  }

  if (policy.requireExactAssignmentSources === true) {
    const assignmentSceneIds = input.assignment.sources.flatMap((source) =>
      source.kind === "scene" ? [source.sceneId] : []
    );
    const assignmentCaptureIds = input.assignment.sources.flatMap((source) =>
      source.kind === "capture" ? [source.captureId] : []
    );
    if (
      !sameIds([...seenSceneIds], assignmentSceneIds) ||
      !sameIds([...seenCaptureIds], assignmentCaptureIds)
    ) {
      stale(`${policy.label} apply must retain the assignment's exact source set.`);
    }
  }
}
