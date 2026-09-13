import type { ContextReceipt } from "./agent-context-receipt.js";
import {
  STORY_WORK_STRUCTURE_WORKFLOW_ID,
  type AsyncHashPort,
  type InstructionContentHash
} from "./agent-domain.js";
import {
  AgentProposalStateConflictError,
  type AgentProposal,
  type AgentRun
} from "./agent-runs-proposals.js";
import {
  applyCanvasCommand,
  CanvasVersionConflictError,
  type CanvasBoard,
  type CanvasMutationResult
} from "./canvas.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import {
  DomainValidationError,
  type BookId,
  type CanvasObjectId,
  type CanvasRevisionId,
  type ProjectRecords,
  type SceneId
} from "./domain.js";
import type { InitializeSceneDocumentInput } from "./scene-document-repository.js";
import {
  ProjectVersionConflictError,
  type IdGenerator
} from "./project-repository.js";
import { createInitialSceneDocumentState } from "./scene-writing-services.js";
import type { SceneDocumentHead } from "./scene-documents.js";
import { StoryWorkApplyIdempotencyConflictError } from "./scene-story-work-uow.js";
import {
  prepareStoryStructureProposal,
  type StoryStructurePreview,
  type StoryStructurePreviewRefusal
} from "./story-structure-preview.js";
import { StoryStructureStoryWorkArtifactMismatchError } from "./story-structure-review.js";
import {
  STORY_STRUCTURE_SCHEMA_ID,
  validateStoryStructureProposalV1,
  type StoryStructureOperationId,
  type StoryStructureProposalV1
} from "./story-structure-proposal-v1.js";
import type {
  ApplyStructureStoryWorkInput,
  StructureStoryWorkApplyResult,
  StructureStoryWorkResultReference
} from "./story-structure-uow.js";
import {
  validateStoryWorkApplyBindings,
  validateStoryWorkReceiptFreshness
} from "./story-work-apply-validation.js";
import {
  recordAppliedStoryWorkAssignmentFromUnitOfWork,
  StoryWorkAssignmentTransitionError,
  type StoryWorkAssignment
} from "./story-work-assignment.js";
import type { StoryWorkAttempt } from "./story-work-attempt.js";

export class StoryStructureStoryWorkContextStaleError extends Error {
  readonly code = "STORY_STRUCTURE_STORY_WORK_CONTEXT_STALE" as const;

  constructor(message = "The story context used for this structure changed before apply.") {
    super(message);
    this.name = "StoryStructureStoryWorkContextStaleError";
  }
}

export class StoryStructureStoryWorkSelectionConflictError extends Error {
  readonly code = "STORY_STRUCTURE_STORY_WORK_SELECTION_CONFLICT" as const;

  constructor(message = "Structure apply selection is invalid for the current proposal.") {
    super(message);
    this.name = "StoryStructureStoryWorkSelectionConflictError";
  }
}

export class StoryStructureStoryWorkContextConflictError extends Error {
  readonly code = "STORY_STRUCTURE_STORY_WORK_CONTEXT_CONFLICT" as const;

  constructor(message = "Structure apply preconditions no longer match the reviewed proposal.") {
    super(message);
    this.name = "StoryStructureStoryWorkContextConflictError";
  }
}

export type StructureStoryWorkCanonicalApplyInputs = Readonly<{
  exactInput: ApplyStructureStoryWorkInput;
  applyRequestFingerprint: InstructionContentHash;
  assignment: StoryWorkAssignment;
  attempt: StoryWorkAttempt;
  proposal: AgentProposal;
  run: AgentRun;
  receipt: ContextReceipt;
}>;

export type ValidateStructureStoryWorkApplyInput = StructureStoryWorkCanonicalApplyInputs &
  Readonly<{
    appliedAt: string;
    currentRecords: ProjectRecords;
    sceneDocumentHeads: ReadonlyMap<SceneId, SceneDocumentHead>;
    canvasBoard?: CanvasBoard;
    canvasParentRevisionId?: CanvasRevisionId;
    ids: IdGenerator;
    hashPort: AsyncHashPort;
  }>;

export type ValidatedStructureStoryWorkApply = Readonly<{
  updatedRecords: ProjectRecords;
  sceneDocuments: readonly InitializeSceneDocumentInput[];
  updatedAssignment: StoryWorkAssignment;
  proposal: AgentProposal;
  result: StructureStoryWorkResultReference;
  preview: StoryStructurePreview;
  canvasMutation?: CanvasMutationResult;
  expectedCanvasVersion?: number;
}>;

function reservedBookId(assignment: StoryWorkAssignment): BookId {
  if (
    assignment.taskKind !== "outline" ||
    assignment.destination.kind !== "book" ||
    assignment.destination.operation !== "update"
  ) {
    throw new StoryStructureStoryWorkArtifactMismatchError(
      "Structure apply requires the assignment's exact reserved book destination."
    );
  }
  return assignment.destination.bookId;
}

function validateCanonicalBindings(input: StructureStoryWorkCanonicalApplyInputs): BookId {
  return validateStoryWorkApplyBindings(
    {
      accountId: input.exactInput.accountId,
      exactInput: input.exactInput,
      assignment: input.assignment,
      attempt: input.attempt,
      proposal: input.proposal,
      run: input.run,
      receipt: input.receipt
    },
    {
      workflowId: STORY_WORK_STRUCTURE_WORKFLOW_ID,
      outputSchemaId: STORY_STRUCTURE_SCHEMA_ID,
      targetKind: "book",
      destinationId: reservedBookId,
      receiptTargetId: (receipt) =>
        receipt.primaryTarget?.kind === "book" ? receipt.primaryTarget.id : undefined,
      artifactMismatch: (message) =>
        new StoryStructureStoryWorkArtifactMismatchError(message)
    }
  );
}

function exactStructureResult(
  assignment: StoryWorkAssignment,
  bookId: BookId,
  projectVersion: number
): StructureStoryWorkResultReference | undefined {
  if (assignment.results.length !== 1) return undefined;
  const result = assignment.results[0];
  return result?.kind === "story-structure" &&
    result.bookId === bookId &&
    result.projectVersion === projectVersion
    ? result
    : undefined;
}

function sameIdMultiset(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = [...left].map(String).sort();
  const actual = [...right].map(String).sort();
  return expected.every((id, index) => id === actual[index]);
}

function structureReplayMatchesRequest(
  stored: StructureStoryWorkResultReference,
  input: StructureStoryWorkCanonicalApplyInputs,
  bookId: BookId
): boolean {
  if (
    stored.bookId !== bookId ||
    stored.projectVersion !== input.exactInput.expectedProjectVersion + 1
  ) {
    return false;
  }
  if (
    !sameIdMultiset(stored.resolvedOperationIds, input.exactInput.selectedOperationIds)
  ) {
    return false;
  }
  const placement = input.exactInput.canvasPlacement;
  if (placement === undefined) {
    return (
      stored.canvasPlacedSceneId === undefined && stored.canvasObjectId === undefined
    );
  }
  return (
    stored.canvasPlacedSceneId === placement.sceneId &&
    stored.canvasObjectId !== undefined
  );
}

/** Returns a prior apply without consulting mutable sources or allocating IDs. */
export function structureStoryWorkExactReplay(
  input: StructureStoryWorkCanonicalApplyInputs
): StructureStoryWorkApplyResult | undefined {
  const bookId = validateCanonicalBindings(input);
  if (input.assignment.status !== "applied") return undefined;
  const result = exactStructureResult(
    input.assignment,
    bookId,
    input.exactInput.expectedProjectVersion + 1
  );
  if (
    input.assignment.applyIdempotencyKey !== input.exactInput.idempotencyKey ||
    input.assignment.applyRequestFingerprint !== input.applyRequestFingerprint ||
    input.assignment.version !== input.exactInput.expectedAssignmentVersion + 1 ||
    input.proposal.status !== "applied" ||
    input.proposal.applied?.actorAccountId !== input.exactInput.accountId ||
    input.run.status !== "ready" ||
    result === undefined ||
    !structureReplayMatchesRequest(result, input, bookId)
  ) {
    throw new StoryWorkApplyIdempotencyConflictError();
  }
  return Object.freeze({
    replayed: true,
    assignment: input.assignment,
    proposal: input.proposal,
    result
  });
}

function selectedCreatedPlannedSceneIds(
  proposal: StoryStructureProposalV1,
  selectedOperationIds: readonly StoryStructureOperationId[]
): ReadonlySet<SceneId> {
  const selected = new Set(selectedOperationIds.map(String));
  const sceneIds = new Set<SceneId>();
  for (const operation of proposal.operations) {
    if (
      operation.type === "scene.createPlanned" &&
      selected.has(String(operation.operationId))
    ) {
      sceneIds.add(operation.sceneId);
    }
  }
  return sceneIds;
}

function activeScene(records: ProjectRecords, sceneIdValue: SceneId): boolean {
  const scene = records.scenes.find((candidate) => candidate.id === sceneIdValue);
  return scene !== undefined && scene.archivedAt === undefined;
}

function assertNonEmptySelection(
  selectedOperationIds: readonly StoryStructureOperationId[]
): void {
  if (!Array.isArray(selectedOperationIds) || selectedOperationIds.length === 0) {
    throw new StoryStructureStoryWorkSelectionConflictError(
      "Structure apply requires a dependency-complete non-empty operation selection."
    );
  }
}

function mapPrepareRefusal(
  refusal: StoryStructurePreviewRefusal,
  projectId: ApplyStructureStoryWorkInput["projectId"],
  expectedProjectVersion: number
): never {
  switch (refusal.code) {
    case "EMPTY_SELECTION":
    case "UNKNOWN_OPERATION":
    case "MISSING_REQUIREMENTS":
      throw new StoryStructureStoryWorkSelectionConflictError(refusal.message);
    case "STALE_PROJECT_VERSION":
      throw new ProjectVersionConflictError(projectId, expectedProjectVersion);
    case "PROPOSAL_SCOPE_MISMATCH":
    case "INACTIVE_PROJECT":
    case "INACTIVE_BOOK":
    case "INVALID_PROPOSAL":
    case "COMMAND_REFUSED":
      throw new StoryStructureStoryWorkContextConflictError(refusal.message);
    default:
      throw new StoryStructureStoryWorkContextConflictError(refusal.message);
  }
}

function validateProposalPayload(
  proposal: AgentProposal,
  input: ValidateStructureStoryWorkApplyInput,
  bookId: BookId
): void {
  const payload = validateStoryStructureProposalV1(proposal.payload);
  if (
    payload.projectId !== input.exactInput.projectId ||
    payload.bookId !== bookId ||
    payload.expectedProjectVersion !== input.exactInput.expectedProjectVersion ||
    payload.contextReceiptHash !== input.receipt.receiptHash
  ) {
    throw new StoryStructureStoryWorkArtifactMismatchError(
      "The reviewed structure artifact no longer matches the bound receipt and project version."
    );
  }
}

function nextAssignment(
  input: ValidateStructureStoryWorkApplyInput,
  applyRequestFingerprint: InstructionContentHash,
  result: StructureStoryWorkResultReference
): StoryWorkAssignment {
  return recordAppliedStoryWorkAssignmentFromUnitOfWork({
    assignment: input.assignment,
    expectedVersion: input.exactInput.expectedAssignmentVersion,
    artifact: input.assignment.currentArtifact!,
    results: [result],
    applyRequest: {
      idempotencyKey: input.exactInput.idempotencyKey,
      requestFingerprint: applyRequestFingerprint
    },
    updatedAt: input.appliedAt
  });
}

/** Builds deterministic project/scene effects after mutable dependencies are loaded. */
export async function validateStructureStoryWorkApply(
  input: ValidateStructureStoryWorkApplyInput
): Promise<ValidatedStructureStoryWorkApply> {
  const bookId = validateCanonicalBindings(input);
  assertNonEmptySelection(input.exactInput.selectedOperationIds);
  if (
    input.assignment.version !== input.exactInput.expectedAssignmentVersion ||
    input.assignment.status !== "awaiting-review"
  ) {
    throw new StoryWorkAssignmentTransitionError();
  }
  if (input.proposal.status !== "ready" || input.run.status !== "ready") {
    throw new AgentProposalStateConflictError();
  }
  if (
    input.currentRecords.project.id !== input.exactInput.projectId ||
    input.currentRecords.project.archivedAt !== undefined
  ) {
    throw new ProjectArchivedMutationError();
  }
  if (input.currentRecords.project.version !== input.exactInput.expectedProjectVersion) {
    throw new ProjectVersionConflictError(
      input.exactInput.projectId,
      input.exactInput.expectedProjectVersion
    );
  }
  validateProposalPayload(input.proposal, input, bookId);
  await validateStoryWorkReceiptFreshness(input, {
    label: "Structure",
    allowCapture: false,
    stale: (message) => new StoryStructureStoryWorkContextStaleError(message)
  });

  const payload = validateStoryStructureProposalV1(input.proposal.payload);
  const prepared = await prepareStoryStructureProposal({
    records: input.currentRecords,
    proposal: payload,
    selectedOperationIds: input.exactInput.selectedOperationIds,
    now: input.appliedAt,
    sceneDocumentHeads: input.sceneDocumentHeads,
    hashPort: input.hashPort
  });
  if (!prepared.ok) {
    mapPrepareRefusal(
      prepared,
      input.exactInput.projectId,
      input.exactInput.expectedProjectVersion
    );
  }

  for (const descriptor of prepared.preview.emptyGenesisDescriptors) {
    if (input.sceneDocumentHeads.get(descriptor.sceneId) !== undefined) {
      throw new DomainValidationError(
        "DUPLICATE_ID",
        "A reserved structure scene destination already has scene document state."
      );
    }
    if (input.currentRecords.scenes.some((scene) => scene.id === descriptor.sceneId)) {
      throw new DomainValidationError(
        "DUPLICATE_ID",
        "A reserved structure scene destination is already in use."
      );
    }
  }

  const sceneDocuments: InitializeSceneDocumentInput[] = [];
  for (const descriptor of prepared.preview.emptyGenesisDescriptors) {
    sceneDocuments.push(
      await createInitialSceneDocumentState({
        projectId: descriptor.projectId,
        sceneId: descriptor.sceneId,
        actorAccountId: input.exactInput.accountId,
        ids: input.ids,
        now: input.appliedAt
      })
    );
  }

  const placement = input.exactInput.canvasPlacement;
  let canvasMutation: CanvasMutationResult | undefined;
  let expectedCanvasVersion: number | undefined;
  let canvasObjectId: CanvasObjectId | undefined;
  if (placement !== undefined) {
    const permittedSceneIds = selectedCreatedPlannedSceneIds(
      payload,
      input.exactInput.selectedOperationIds
    );
    if (!permittedSceneIds.has(placement.sceneId)) {
      throw new StoryStructureStoryWorkSelectionConflictError(
        "Structure Canvas placement must target one selected new planned scene."
      );
    }
    if (!activeScene(prepared.nextRecords, placement.sceneId)) {
      throw new StoryStructureStoryWorkContextConflictError(
        "Structure Canvas placement requires an active scene in the applied project records."
      );
    }
    if (
      input.canvasBoard === undefined ||
      input.canvasBoard.version !== placement.expectedCanvasVersion
    ) {
      throw new CanvasVersionConflictError(
        input.exactInput.projectId,
        placement.expectedCanvasVersion
      );
    }
    const placedScene = prepared.nextRecords.scenes.find(
      (scene) => scene.id === placement.sceneId
    )!;
    canvasMutation = await applyCanvasCommand({
      board: input.canvasBoard,
      projectRecords: prepared.nextRecords,
      expectedCanvasVersion: placement.expectedCanvasVersion,
      command: {
        type: "canvas.object.place",
        scope: placement.scope,
        object: {
          kind: "scene-card",
          sceneId: placement.sceneId,
          label: placedScene.title,
          authority: "confirmed",
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
          z: placement.z,
          ...(placement.parentRegionId === undefined
            ? {}
            : { parentRegionId: placement.parentRegionId }),
          ...(placement.storyOrderHint === undefined
            ? {}
            : { storyOrderHint: placement.storyOrderHint }),
          sourceKey: `story-work:${input.assignment.id}`,
          provenance: "story-work.structure"
        }
      },
      actorAccountId: input.exactInput.accountId,
      ids: input.ids,
      now: input.appliedAt,
      ...(input.canvasParentRevisionId === undefined
        ? {}
        : { parentRevisionId: input.canvasParentRevisionId })
    });
    expectedCanvasVersion = placement.expectedCanvasVersion;
    const placedCard = canvasMutation.board.objects.find(
      (object) =>
        object.kind === "scene-card" &&
        object.sceneId === placement.sceneId &&
        object.archivedAt === undefined
    );
    if (placedCard === undefined) {
      throw new StoryStructureStoryWorkContextConflictError(
        "Structure Canvas placement did not create its scene card."
      );
    }
    canvasObjectId = placedCard.id;
  }

  const result = Object.freeze({
    kind: "story-structure" as const,
    bookId,
    projectVersion: prepared.nextRecords.project.version,
    resolvedOperationIds: Object.freeze([...prepared.preview.resolvedOperationIds]),
    createdSceneIds: Object.freeze([...prepared.preview.createdSceneIds]),
    ...(placement === undefined || canvasObjectId === undefined
      ? {}
      : {
          canvasPlacedSceneId: placement.sceneId,
          canvasObjectId
        })
  });

  return Object.freeze({
    updatedRecords: prepared.nextRecords,
    sceneDocuments: Object.freeze(sceneDocuments),
    updatedAssignment: nextAssignment(
      input,
      input.applyRequestFingerprint,
      result
    ),
    proposal: input.proposal,
    result,
    preview: prepared.preview,
    ...(canvasMutation === undefined
      ? {}
      : {
          canvasMutation,
          expectedCanvasVersion
        })
  });
}
