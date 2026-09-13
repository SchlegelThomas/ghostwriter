import { hashSceneDocument, type SceneDocumentV1 } from "@ghostwriter/editor";
import type { ContextReceipt } from "./agent-context-receipt.js";
import {
  SCENE_STORY_WORK_WORKFLOW_ID,
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
  revisionId,
  sceneVariantId,
  type CaptureId,
  type CanvasRevisionId,
  type ProjectRecords,
  type SceneId
} from "./domain.js";
import { applyProjectCommandToRecords } from "./project-commands.js";
import {
  ProjectVersionConflictError,
  type DomainIdKind,
  type IdGenerator
} from "./project-repository.js";
import { sceneDraftDocument } from "./scene-draft-document.js";
import { validateSceneDraftV1 } from "./scene-draft-v1.js";
import type { InitializeSceneDocumentInput } from "./scene-document-repository.js";
import {
  createSceneDocumentHead,
  createSceneRevision,
  SceneLeaseConflictError,
  SceneLeaseExpiredError,
  SceneWorkingVersionConflictError,
  sceneContentHash,
  sceneVariantName,
  type SceneDocumentHead,
  type SceneEditingLease
} from "./scene-documents.js";
import { SceneStoryWorkArtifactMismatchError } from "./scene-story-work-review.js";
import type {
  ApplySceneStoryWorkInput,
  SceneStoryWorkApplyResult
} from "./scene-story-work-uow.js";
import { StoryWorkApplyIdempotencyConflictError } from "./scene-story-work-uow.js";
import {
  validateStoryWorkApplyBindings,
  validateStoryWorkReceiptFreshness
} from "./story-work-apply-validation.js";
import {
  recordAppliedStoryWorkAssignmentFromUnitOfWork,
  StoryWorkAssignmentTransitionError,
  type StoryWorkAssignment,
  type StoryWorkResultReference
} from "./story-work-assignment.js";
import type { StoryWorkAttempt } from "./story-work-attempt.js";
import type { CaptureDocumentHead } from "./capture-documents.js";

export class SceneStoryWorkContextStaleError extends Error {
  readonly code = "SCENE_STORY_WORK_CONTEXT_STALE" as const;

  constructor(message = "The story context used for this scene changed before apply.") {
    super(message);
    this.name = "SceneStoryWorkContextStaleError";
  }
}

export type SceneStoryWorkCanonicalApplyInputs = Readonly<{
  exactInput: ApplySceneStoryWorkInput;
  applyRequestFingerprint: InstructionContentHash;
  assignment: StoryWorkAssignment;
  attempt: StoryWorkAttempt;
  proposal: AgentProposal;
  run: AgentRun;
  receipt: ContextReceipt;
}>;

export type ValidateSceneStoryWorkApplyInput =
  SceneStoryWorkCanonicalApplyInputs &
  Readonly<{
    appliedAt: string;
    currentRecords: ProjectRecords;
    sceneDocumentHeads: ReadonlyMap<SceneId, SceneDocumentHead>;
    captureDocumentHeads: ReadonlyMap<CaptureId, CaptureDocumentHead>;
    destinationHead?: SceneDocumentHead;
    destinationLease?: SceneEditingLease;
    canvasBoard?: CanvasBoard;
    canvasParentRevisionId?: CanvasRevisionId;
    ids: IdGenerator;
    hashPort: AsyncHashPort;
  }>;

type AppliedSceneResult = Extract<StoryWorkResultReference, { kind: "scene" }>;

type ValidatedCommon = Readonly<{
  updatedAssignment: StoryWorkAssignment;
  proposal: AgentProposal;
  result: AppliedSceneResult;
}>;

export type ValidatedSceneStoryWorkApply =
  | (ValidatedCommon &
      Readonly<{
        kind: "create-scene";
        updatedRecords: ProjectRecords;
        sceneDocument: InitializeSceneDocumentInput;
        canvasMutation?: CanvasMutationResult;
        expectedCanvasVersion?: number;
      }>)
  | (ValidatedCommon &
      Readonly<{
        kind: "named-variant";
        document: SceneDocumentV1;
        contentHash: ReturnType<typeof sceneContentHash>;
        revisionId: ReturnType<typeof revisionId>;
        variantId: ReturnType<typeof sceneVariantId>;
        variantName: string;
      }>)
  | (ValidatedCommon &
      Readonly<{
        kind: "apply-revision";
        document: SceneDocumentV1;
        contentHash: ReturnType<typeof sceneContentHash>;
        revisionId: ReturnType<typeof revisionId>;
      }>);

function reservedDestination(assignment: StoryWorkAssignment): SceneId {
  if (assignment.destination.kind !== "scene") {
    throw new SceneStoryWorkArtifactMismatchError(
      "Scene apply requires the assignment's exact reserved scene destination."
    );
  }
  return assignment.destination.sceneId;
}

function requireModeDestination(
  assignment: StoryWorkAssignment,
  mode: ApplySceneStoryWorkInput["mode"]
): SceneId {
  const destination = reservedDestination(assignment);
  const create =
    assignment.taskKind === "scene" &&
    assignment.destination.kind === "scene" &&
    assignment.destination.operation === "create";
  const update =
    assignment.taskKind === "revise" &&
    assignment.destination.kind === "scene" &&
    assignment.destination.operation === "update";
  if ((mode === "create-scene" && !create) || (mode !== "create-scene" && !update)) {
    throw new SceneStoryWorkArtifactMismatchError(
      "The scene apply mode does not match the assignment's reserved operation."
    );
  }
  return destination;
}

function validateCanonicalBindings(
  input: SceneStoryWorkCanonicalApplyInputs
): SceneId {
  const destination = validateStoryWorkApplyBindings(
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
      workflowId: SCENE_STORY_WORK_WORKFLOW_ID,
      outputSchemaId: "scene-draft-v1",
      targetKind: "scene",
      destinationId: reservedDestination,
      receiptTargetId: (receipt) => receipt.targetSceneId,
      artifactMismatch: (message) => new SceneStoryWorkArtifactMismatchError(message)
    }
  );
  requireModeDestination(input.assignment, input.exactInput.mode);
  return destination;
}

function exactReplayResult(
  input: SceneStoryWorkCanonicalApplyInputs,
  destination: SceneId
): AppliedSceneResult | undefined {
  if (input.assignment.results.length !== 1) return undefined;
  const result = input.assignment.results[0];
  if (result?.kind !== "scene" || result.sceneId !== destination) return undefined;
  switch (input.exactInput.mode) {
    case "create-scene":
      return result.workingVersion === 1 &&
        result.revisionId !== undefined &&
        result.variantId === undefined
        ? result
        : undefined;
    case "named-variant":
      return result.workingVersion === input.exactInput.expectedSceneWorkingVersion &&
        result.revisionId !== undefined &&
        result.variantId !== undefined
        ? result
        : undefined;
    case "apply-revision":
      return result.workingVersion === input.exactInput.expectedSceneWorkingVersion + 1 &&
        result.revisionId !== undefined &&
        result.variantId === undefined
        ? result
        : undefined;
  }
}

/** Returns an applied request without consulting mutable sources or allocating IDs. */
export function sceneStoryWorkExactReplay(
  input: SceneStoryWorkCanonicalApplyInputs
): SceneStoryWorkApplyResult | undefined {
  const destination = validateCanonicalBindings(input);
  if (input.assignment.status !== "applied") return undefined;
  const result = exactReplayResult(input, destination);
  if (
    input.assignment.applyIdempotencyKey !== input.exactInput.idempotencyKey ||
    input.assignment.applyRequestFingerprint !== input.applyRequestFingerprint ||
    input.assignment.version !== input.exactInput.expectedAssignmentVersion + 1 ||
    input.proposal.status !== "applied" ||
    input.proposal.applied?.actorAccountId !== input.exactInput.accountId ||
    input.run.status !== "ready" ||
    result === undefined
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

function fixedSceneIdGenerator(id: SceneId): IdGenerator {
  return Object.freeze({
    create(kind: DomainIdKind): string {
      if (kind !== "scene") {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "Scene apply may create only its reserved project scene ID."
        );
      }
      return id;
    }
  });
}

function sameSceneIds(left: readonly SceneId[], right: readonly SceneId[]): boolean {
  if (left.length !== right.length) return false;
  const expected = [...left].sort();
  const actual = [...right].sort();
  return expected.every((id, index) => id === actual[index]);
}

function activeScene(records: ProjectRecords, id: SceneId): boolean {
  const scene = records.scenes.find((candidate) => candidate.id === id);
  return scene !== undefined && scene.archivedAt === undefined;
}

function requireDestinationHead(
  input: ValidateSceneStoryWorkApplyInput,
  destination: SceneId
): SceneDocumentHead {
  const head = input.destinationHead;
  if (
    head === undefined ||
    head.projectId !== input.exactInput.projectId ||
    head.sceneId !== destination ||
    !activeScene(input.currentRecords, destination)
  ) {
    throw new SceneStoryWorkContextStaleError(
      "The destination scene is no longer active and current."
    );
  }
  if (input.exactInput.mode === "create-scene") {
    throw new SceneStoryWorkArtifactMismatchError();
  }
  if (
    head.workingVersion !== input.exactInput.expectedSceneWorkingVersion ||
    head.contentHash !== sceneContentHash(String(input.exactInput.expectedSceneContentHash))
  ) {
    throw new SceneWorkingVersionConflictError();
  }
  return head;
}

function requireLease(
  input: ValidateSceneStoryWorkApplyInput,
  destination: SceneId
): void {
  if (input.exactInput.mode === "create-scene") return;
  const lease = input.destinationLease;
  if (
    lease === undefined ||
    lease.projectId !== input.exactInput.projectId ||
    lease.sceneId !== destination ||
    lease.holderId !== input.exactInput.leaseHolderId
  ) {
    throw new SceneLeaseConflictError();
  }
  if (Date.parse(lease.expiresAt) <= Date.parse(input.appliedAt)) {
    throw new SceneLeaseExpiredError();
  }
}

function nextAssignment(
  input: ValidateSceneStoryWorkApplyInput,
  result: AppliedSceneResult
): StoryWorkAssignment {
  return recordAppliedStoryWorkAssignmentFromUnitOfWork({
    assignment: input.assignment,
    expectedVersion: input.exactInput.expectedAssignmentVersion,
    artifact: input.assignment.currentArtifact!,
    results: [result],
    applyRequest: {
      idempotencyKey: input.exactInput.idempotencyKey,
      requestFingerprint: input.applyRequestFingerprint
    },
    updatedAt: input.appliedAt
  });
}

/** Builds a complete deterministic effect after all mutable dependencies are loaded. */
export async function validateSceneStoryWorkApply(
  input: ValidateSceneStoryWorkApplyInput
): Promise<ValidatedSceneStoryWorkApply> {
  const destination = validateCanonicalBindings(input);
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
  await validateStoryWorkReceiptFreshness(input, {
    label: "Scene",
    allowCapture: true,
    maximumCaptures: 1,
    requireExactAssignmentSources: true,
    requireActiveSceneSources: true,
    stale: (message) => new SceneStoryWorkContextStaleError(message)
  });

  const payload = validateSceneDraftV1(input.proposal.payload);
  const selectedSceneIds = input.assignment.sources.flatMap((source) =>
    source.kind === "scene" ? [source.sceneId] : []
  );
  if (!sameSceneIds(payload.sourceSceneIds, selectedSceneIds)) {
    throw new SceneStoryWorkArtifactMismatchError(
      "The reviewed scene artifact must retain the assignment's exact scene sources."
    );
  }

  if (input.exactInput.mode === "create-scene") {
    if (input.currentRecords.project.version !== input.exactInput.expectedProjectVersion) {
      throw new ProjectVersionConflictError(
        input.exactInput.projectId,
        input.exactInput.expectedProjectVersion
      );
    }
    if (
      input.currentRecords.scenes.some((scene) => scene.id === destination) ||
      input.destinationHead !== undefined
    ) {
      throw new DomainValidationError(
        "DUPLICATE_ID",
        "The reserved scene destination is already in use."
      );
    }
    const updatedRecords = applyProjectCommandToRecords(
      input.currentRecords,
      {
        type: "scene.create",
        bookId: input.exactInput.manuscriptPlacement.bookId,
        ...(input.exactInput.manuscriptPlacement.kind === "chapter"
          ? { chapterId: input.exactInput.manuscriptPlacement.chapterId }
          : {}),
        ...(input.exactInput.manuscriptPlacement.position === undefined
          ? {}
          : { position: input.exactInput.manuscriptPlacement.position }),
        title: input.exactInput.title
      },
      fixedSceneIdGenerator(destination),
      input.appliedAt
    );
    const document = sceneDraftDocument(input.proposal.payload, () =>
      input.ids.create("sceneDocumentBlock")
    );
    const contentHash = sceneContentHash(await hashSceneDocument(document));
    const genesisRevisionId = revisionId(input.ids.create("revision"));
    const genesisRevision = createSceneRevision({
      id: genesisRevisionId,
      sceneId: destination,
      projectId: input.exactInput.projectId,
      document,
      contentHash,
      actorAccountId: input.exactInput.accountId,
      origin: "agent",
      reason: "genesis",
      createdAt: input.appliedAt
    });
    const sceneDocument = Object.freeze({
      genesisRevision,
      head: createSceneDocumentHead({
        sceneId: destination,
        projectId: input.exactInput.projectId,
        workingVersion: 1,
        document,
        contentHash,
        checkpointRevisionId: genesisRevisionId,
        updatedByAccountId: input.exactInput.accountId,
        createdAt: input.appliedAt,
        updatedAt: input.appliedAt
      })
    });
    let canvasMutation: CanvasMutationResult | undefined;
    if (input.exactInput.canvas !== undefined) {
      if (
        input.canvasBoard === undefined ||
        input.canvasBoard.version !== input.exactInput.canvas.expectedCanvasVersion
      ) {
        throw new CanvasVersionConflictError(
          input.exactInput.projectId,
          input.exactInput.canvas.expectedCanvasVersion
        );
      }
      const createdScene = updatedRecords.scenes.find((scene) => scene.id === destination)!;
      canvasMutation = await applyCanvasCommand({
        board: input.canvasBoard,
        projectRecords: updatedRecords,
        expectedCanvasVersion: input.exactInput.canvas.expectedCanvasVersion,
        command: {
          type: "canvas.object.place",
          scope: input.exactInput.canvas.scope,
          object: {
            kind: "scene-card",
            sceneId: destination,
            label: createdScene.title,
            authority: "confirmed",
            x: input.exactInput.canvas.x,
            y: input.exactInput.canvas.y,
            width: input.exactInput.canvas.width,
            height: input.exactInput.canvas.height,
            z: input.exactInput.canvas.z,
            ...(input.exactInput.canvas.parentRegionId === undefined
              ? {}
              : { parentRegionId: input.exactInput.canvas.parentRegionId }),
            ...(input.exactInput.canvas.storyOrderHint === undefined
              ? {}
              : { storyOrderHint: input.exactInput.canvas.storyOrderHint }),
            sourceKey: `story-work:${input.assignment.id}`,
            provenance: "story-work.scene"
          }
        },
        actorAccountId: input.exactInput.accountId,
        ids: input.ids,
        now: input.appliedAt,
        ...(input.canvasParentRevisionId === undefined
          ? {}
          : { parentRevisionId: input.canvasParentRevisionId })
      });
    }
    const result = Object.freeze({
      kind: "scene" as const,
      sceneId: destination,
      workingVersion: 1,
      revisionId: genesisRevisionId
    });
    return Object.freeze({
      kind: "create-scene" as const,
      updatedRecords,
      sceneDocument,
      ...(canvasMutation === undefined
        ? {}
        : {
            canvasMutation,
            expectedCanvasVersion: input.exactInput.canvas!.expectedCanvasVersion
          }),
      updatedAssignment: nextAssignment(input, result),
      proposal: input.proposal,
      result
    });
  }

  const head = requireDestinationHead(input, destination);
  requireLease(input, destination);
  const document = sceneDraftDocument(input.proposal.payload, () =>
    input.ids.create("sceneDocumentBlock")
  );
  const contentHash = sceneContentHash(await hashSceneDocument(document));
  const newRevisionId = revisionId(input.ids.create("revision"));
  if (input.exactInput.mode === "named-variant") {
    const variantId = sceneVariantId(input.ids.create("sceneVariant"));
    const result = Object.freeze({
      kind: "scene" as const,
      sceneId: destination,
      workingVersion: head.workingVersion,
      revisionId: newRevisionId,
      variantId
    });
    return Object.freeze({
      kind: "named-variant" as const,
      document,
      contentHash,
      revisionId: newRevisionId,
      variantId,
      variantName: sceneVariantName(input.exactInput.variantName),
      updatedAssignment: nextAssignment(input, result),
      proposal: input.proposal,
      result
    });
  }
  const result = Object.freeze({
    kind: "scene" as const,
    sceneId: destination,
    workingVersion: head.workingVersion + 1,
    revisionId: newRevisionId
  });
  return Object.freeze({
    kind: "apply-revision" as const,
    document,
    contentHash,
    revisionId: newRevisionId,
    updatedAssignment: nextAssignment(input, result),
    proposal: input.proposal,
    result
  });
}
