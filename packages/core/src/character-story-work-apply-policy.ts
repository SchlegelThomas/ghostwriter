import { canonicalJsonStringify } from "./agent-canonical-json.js";
import type { ContextReceipt } from "./agent-context-receipt.js";
import {
  CHARACTER_STORY_WORK_WORKFLOW_ID,
  instructionContentHash,
  type AsyncHashPort
} from "./agent-domain.js";
import {
  AgentProposalStateConflictError,
  AgentRunReceiptMismatchError,
  type AgentProposal,
  type AgentRun
} from "./agent-runs-proposals.js";
import {
  CharacterStoryWorkArtifactMismatchError
} from "./character-story-work-services.js";
import type {
  ApplyCharacterStoryWorkInput,
  CharacterStoryWorkApplyResult
} from "./character-story-work-uow.js";
import { validateCharacterCreateV2 } from "./character-create-v2.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import {
  createStoryKnowledge,
  defineProjectRecords,
  DomainValidationError,
  storyKnowledgeId,
  type ProjectRecords,
  type SceneId,
  type StoryKnowledgeId
} from "./domain.js";
import type { AccountId } from "./identity.js";
import { applyProjectCommandToRecords } from "./project-commands.js";
import {
  ProjectVersionConflictError,
  type DomainIdKind,
  type IdGenerator
} from "./project-repository.js";
import type { SceneDocumentHead } from "./scene-documents.js";
import {
  assembleStoryStructureResource,
  type StoryContextReceiptResource
} from "./story-context-receipt.js";
import { storyContextFromProjectRecords } from "./story-context.js";
import {
  recordAppliedStoryWorkAssignmentFromUnitOfWork,
  StoryWorkAssignmentTransitionError,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment,
  type StoryWorkResultReference
} from "./story-work-assignment.js";
import type { StoryWorkAttempt } from "./story-work-attempt.js";
import { StoryWorkAttemptTransitionError } from "./story-work-attempt.js";

export class CharacterStoryWorkContextStaleError extends Error {
  readonly code = "CHARACTER_STORY_WORK_CONTEXT_STALE" as const;

  constructor(message = "The story context used for this character changed before apply.") {
    super(message);
    this.name = "CharacterStoryWorkContextStaleError";
  }
}

export type CharacterStoryWorkCanonicalApplyInputs = Readonly<{
  accountId: AccountId;
  exactInput: ApplyCharacterStoryWorkInput;
  assignment: StoryWorkAssignment;
  attempt: StoryWorkAttempt;
  proposal: AgentProposal;
  run: AgentRun;
  receipt: ContextReceipt;
}>;

export type ValidateCharacterStoryWorkApplyInput =
  CharacterStoryWorkCanonicalApplyInputs &
  Readonly<{
    appliedAt: string;
    currentRecords: ProjectRecords;
    sceneDocumentHeads: ReadonlyMap<SceneId, SceneDocumentHead>;
    hashPort: AsyncHashPort;
  }>;

export type ValidatedCharacterStoryWorkApply = Readonly<{
  updatedRecords: ProjectRecords;
  updatedAssignment: StoryWorkAssignment;
  proposal: AgentProposal;
  result: Extract<StoryWorkResultReference, { kind: "story-knowledge" }>;
}>;

function sameArtifact(
  left: StoryWorkArtifactPointer | undefined,
  input: Pick<
    ApplyCharacterStoryWorkInput,
    "proposalId" | "expectedArtifactVersion" | "expectedProposalContentHash"
  >
): boolean {
  return (
    left?.proposalId === input.proposalId &&
    left.artifactVersion === input.expectedArtifactVersion &&
    left.contentHash === instructionContentHash(String(input.expectedProposalContentHash))
  );
}

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

function reservedDestination(assignment: StoryWorkAssignment): StoryKnowledgeId {
  if (
    assignment.taskKind !== "character" ||
    assignment.destination.kind !== "story-knowledge" ||
    assignment.destination.operation !== "create"
  ) {
    throw new CharacterStoryWorkArtifactMismatchError(
      "Character apply requires the assignment's exact reserved Cast destination."
    );
  }
  return assignment.destination.storyKnowledgeId;
}

function exactResult(
  assignment: StoryWorkAssignment,
  destinationId: StoryKnowledgeId,
  projectVersion: number
): Extract<StoryWorkResultReference, { kind: "story-knowledge" }> | undefined {
  if (assignment.results.length !== 1) return undefined;
  const [result] = assignment.results;
  return result?.kind === "story-knowledge" &&
    result.storyKnowledgeId === destinationId &&
    result.projectVersion === projectVersion
    ? result
    : undefined;
}

function validateCanonicalBindings(
  input: CharacterStoryWorkCanonicalApplyInputs
): StoryKnowledgeId {
  const { assignment, attempt, proposal, receipt, run, exactInput } = input;
  const destinationId = reservedDestination(assignment);
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
    receipt.projectId !== exactInput.projectId
  ) {
    throw new CharacterStoryWorkArtifactMismatchError();
  }
  if (
    run.workflowId !== CHARACTER_STORY_WORK_WORKFLOW_ID ||
    receipt.workflowId !== CHARACTER_STORY_WORK_WORKFLOW_ID ||
    run.workflowVersion !== receipt.workflowVersion ||
    assignment.provider !== run.provider ||
    assignment.model !== run.model ||
    receipt.provider !== run.provider ||
    receipt.model !== run.model ||
    proposal.outputSchemaId !== "character-create-v2" ||
    proposal.primaryTarget.kind !== "story-knowledge" ||
    proposal.primaryTarget.id !== destinationId ||
    receipt.outputSchemaId !== "character-create-v2" ||
    receipt.targetStoryKnowledgeId !== destinationId ||
    receipt.primaryTarget?.kind !== "story-knowledge" ||
    receipt.primaryTarget.id !== destinationId
  ) {
    throw new CharacterStoryWorkArtifactMismatchError();
  }
  if (
    !sameArtifact(assignment.currentArtifact, exactInput)
  ) {
    throw new CharacterStoryWorkArtifactMismatchError();
  }
  if (
    proposal.contentHash !==
    instructionContentHash(String(exactInput.expectedProposalContentHash))
  ) {
    throw new CharacterStoryWorkArtifactMismatchError();
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

export function characterStoryWorkExactReplay(
  input: CharacterStoryWorkCanonicalApplyInputs
): CharacterStoryWorkApplyResult | undefined {
  const destinationId = validateCanonicalBindings(input);
  if (input.assignment.status !== "applied") return undefined;
  const result = exactResult(
    input.assignment,
    destinationId,
    input.exactInput.expectedProjectVersion + 1
  );
  if (
    input.assignment.version !== input.exactInput.expectedAssignmentVersion + 1 ||
    input.proposal.status !== "applied" ||
    input.proposal.applied?.actorAccountId !== input.accountId ||
    input.run.status !== "ready" ||
    result === undefined
  ) {
    throw new StoryWorkAssignmentTransitionError();
  }
  return Object.freeze({
    replayed: true,
    assignment: input.assignment,
    proposal: input.proposal,
    result
  });
}

function stale(
  message = "The story context used for this character changed before apply."
): never {
  throw new CharacterStoryWorkContextStaleError(message);
}

async function validateReceiptFreshness(input: ValidateCharacterStoryWorkApplyInput) {
  const resources = input.receipt.resources;
  const storyResources = resources.filter(
    (resource): resource is StoryContextReceiptResource =>
      resource.resourceClass === "scene-document" ||
      resource.resourceClass === "story-context"
  );
  if (storyResources.length !== resources.length) {
    stale("Character apply receipt contains an unsupported context resource.");
  }
  const structureResources = storyResources.filter(
    (resource) => resource.resourceClass === "story-context"
  );
  if (structureResources.length !== 1) {
    stale("Character apply requires one exact story-context dependency.");
  }
  const structure = structureResources[0]!;
  let currentStructure;
  try {
    currentStructure = await assembleStoryStructureResource({
      projectId: input.currentRecords.project.id,
      context: storyContextFromProjectRecords(input.currentRecords, {
        scope: structure.scope
      }),
      inclusionReason: structure.inclusionReason,
      hashPort: input.hashPort
    });
  } catch {
    stale();
  }
  if (canonicalJsonStringify(currentStructure.resource) !== canonicalJsonStringify(structure)) {
    stale();
  }
  const includedSceneIds = new Set(currentStructure.resource.sceneIds);
  const seenSceneIds = new Set<SceneId>();
  for (const resource of storyResources) {
    if (resource.resourceClass !== "scene-document") continue;
    if (seenSceneIds.has(resource.sceneId) || !includedSceneIds.has(resource.sceneId)) {
      stale("Character apply scene dependencies no longer match the consumed story scope.");
    }
    seenSceneIds.add(resource.sceneId);
    const head = input.sceneDocumentHeads.get(resource.sceneId);
    if (
      head === undefined ||
      head.projectId !== resource.projectId ||
      head.sceneId !== resource.sceneId ||
      head.workingVersion !== resource.workingVersion ||
      head.contentHash !== resource.contentHash
    ) {
      stale("Consumed scene prose changed before character apply.");
    }
  }
}

function fixedKnowledgeIdGenerator(id: StoryKnowledgeId): IdGenerator {
  return Object.freeze({
    create(kind: DomainIdKind): string {
      if (kind !== "storyKnowledge") {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "Character apply may generate only its reserved story-knowledge ID."
        );
      }
      return id;
    }
  });
}

export async function validateCharacterStoryWorkApply(
  input: ValidateCharacterStoryWorkApplyInput
): Promise<ValidatedCharacterStoryWorkApply> {
  const destinationId = validateCanonicalBindings(input);
  if (
    input.assignment.version !== input.exactInput.expectedAssignmentVersion ||
    input.assignment.status !== "awaiting-review"
  ) {
    throw new StoryWorkAssignmentTransitionError();
  }
  if (input.proposal.status !== "ready" || input.run.status !== "ready") {
    throw new AgentProposalStateConflictError();
  }
  if (input.currentRecords.project.version !== input.exactInput.expectedProjectVersion) {
    throw new ProjectVersionConflictError(
      input.exactInput.projectId,
      input.exactInput.expectedProjectVersion
    );
  }
  if (input.currentRecords.project.archivedAt !== undefined) {
    throw new ProjectArchivedMutationError();
  }
  if (
    input.currentRecords.project.id !== input.exactInput.projectId ||
    input.receipt.receiptHash !== input.run.receiptHash
  ) {
    throw new AgentRunReceiptMismatchError();
  }
  await validateReceiptFreshness(input);

  const payload = validateCharacterCreateV2(input.proposal.payload);
  if (input.currentRecords.storyKnowledge.some((entry) => entry.id === destinationId)) {
    throw new DomainValidationError(
      "DUPLICATE_ID",
      "The reserved Cast destination is already in use."
    );
  }
  const permittedSceneIds = new Set(
    input.assignment.sources.flatMap((source) =>
      source.kind === "scene" ? [source.sceneId] : []
    )
  );
  for (const sourceSceneId of payload.sourceSceneIds ?? []) {
    if (!permittedSceneIds.has(sourceSceneId)) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Character scene links must stay within the assignment's explicit scene sources."
      );
    }
    const scene = input.currentRecords.scenes.find(
      (candidate) => candidate.id === sourceSceneId
    );
    if (scene === undefined || scene.archivedAt !== undefined) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Character scene links require active scenes in the current project."
      );
    }
  }

  const created = applyProjectCommandToRecords(
    input.currentRecords,
    {
      type: "storyKnowledge.create",
      label: payload.name,
      kind: "character",
      authority: "planned"
    },
    fixedKnowledgeIdGenerator(destinationId),
    input.appliedAt
  );
  const base = created.storyKnowledge.find((entry) => entry.id === destinationId);
  if (base === undefined) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Character apply did not create its reserved Cast destination."
    );
  }
  const dossier = createStoryKnowledge({
    ...base,
    notes: payload.summary,
    aliases: payload.aliases,
    characterSheet: payload.characterSheet,
    linkedSceneIds: payload.sourceSceneIds ?? []
  });
  const updatedRecords = defineProjectRecords({
    ...created,
    storyKnowledge: created.storyKnowledge.map((entry) =>
      entry.id === dossier.id ? dossier : entry
    )
  });
  const result = Object.freeze({
    kind: "story-knowledge" as const,
    storyKnowledgeId: storyKnowledgeId(destinationId),
    projectVersion: updatedRecords.project.version
  });
  const updatedAssignment = recordAppliedStoryWorkAssignmentFromUnitOfWork({
    assignment: input.assignment,
    expectedVersion: input.exactInput.expectedAssignmentVersion,
    artifact: input.assignment.currentArtifact!,
    results: [result],
    updatedAt: input.appliedAt
  });
  return Object.freeze({
    updatedRecords,
    updatedAssignment,
    proposal: input.proposal,
    result
  });
}
