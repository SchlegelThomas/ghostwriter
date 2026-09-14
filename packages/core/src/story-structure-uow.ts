import { canonicalJsonStringify } from "./agent-canonical-json.js";
import {
  instructionContentHash,
  type AsyncHashPort,
  type InstructionContentHash
} from "./agent-domain.js";
import type { AgentProposal } from "./agent-runs-proposals.js";
import { createCanvasScopeRef, type CanvasScopeRef } from "./canvas.js";
import type { AgentProposalId, BookId, CanvasObjectId, ProjectId, SceneId } from "./domain.js";
import { DomainValidationError } from "./domain.js";
import type { AccountId } from "./identity.js";
import type { StoryStructurePreview } from "./story-structure-preview.js";
import type { StoryStructureOperationId } from "./story-structure-proposal-v1.js";
import { StoryWorkApplyIdempotencyConflictError } from "./scene-story-work-uow.js";
import {
  storyWorkApplyIdempotencyKey,
  type StoryWorkAssignment,
  type StoryWorkAssignmentId,
  type StoryWorkResultReference
} from "./story-work-assignment.js";

export { StoryWorkApplyIdempotencyConflictError };

export type StructureStoryWorkCanvasPlacement = Readonly<{
  expectedCanvasVersion: number;
  sceneId: SceneId;
  scope: CanvasScopeRef;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  parentRegionId?: CanvasObjectId;
  storyOrderHint?: number;
}>;

export type ApplyStructureStoryWorkInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignmentId;
  expectedAssignmentVersion: number;
  proposalId: AgentProposalId;
  expectedArtifactVersion: number;
  expectedProposalContentHash: InstructionContentHash | string;
  expectedProjectVersion: number;
  selectedOperationIds: readonly StoryStructureOperationId[];
  idempotencyKey: string;
  canvasPlacement?: StructureStoryWorkCanvasPlacement;
}>;

export type StructureStoryWorkApplyResult = Readonly<{
  replayed: boolean;
  assignment: StoryWorkAssignment;
  proposal: AgentProposal;
  result: Extract<StoryWorkResultReference, { kind: "story-structure" }>;
  preview?: StoryStructurePreview;
}>;

export type StructureStoryWorkResultReference = Extract<
  StoryWorkResultReference,
  { kind: "story-structure" }
>;

export interface StructureStoryWorkApplyUnitOfWork {
  applyStructure(
    input: ApplyStructureStoryWorkInput & Readonly<{ appliedAt: string }>
  ): Promise<StructureStoryWorkApplyResult>;
}

function positiveVersion(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      `${label} must be a positive integer.`
    );
  }
  return value;
}

function sortedOperationIds(
  ids: readonly StoryStructureOperationId[]
): StoryStructureOperationId[] {
  return [...ids].map(String).sort((left, right) => left.localeCompare(right)) as StoryStructureOperationId[];
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new DomainValidationError("INVALID_VERSION", `${label} must be finite.`);
  }
  return value;
}

function canvasPlacementFingerprint(
  placement: StructureStoryWorkCanvasPlacement
): Record<string, unknown> {
  const scope = createCanvasScopeRef(placement.scope);
  const canvas = {
    expectedCanvasVersion: positiveVersion(
      placement.expectedCanvasVersion,
      "Expected Canvas version"
    ),
    sceneId: placement.sceneId,
    scope,
    x: finite(placement.x, "Canvas x"),
    y: finite(placement.y, "Canvas y"),
    width: finite(placement.width, "Canvas width"),
    height: finite(placement.height, "Canvas height"),
    z: finite(placement.z, "Canvas z"),
    ...(placement.parentRegionId === undefined
      ? {}
      : { parentRegionId: placement.parentRegionId }),
    ...(placement.storyOrderHint === undefined
      ? {}
      : {
          storyOrderHint: finite(placement.storyOrderHint, "Canvas story order hint")
        })
  };
  if (canvas.width <= 0 || canvas.height <= 0) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Canvas scene placement dimensions must be positive."
    );
  }
  return canvas;
}

function baseFingerprint(input: ApplyStructureStoryWorkInput) {
  return {
    accountId: input.accountId,
    projectId: input.projectId,
    assignmentId: input.assignmentId,
    expectedAssignmentVersion: positiveVersion(
      input.expectedAssignmentVersion,
      "Expected assignment version"
    ),
    proposalId: input.proposalId,
    expectedArtifactVersion: positiveVersion(
      input.expectedArtifactVersion,
      "Expected artifact version"
    ),
    expectedProposalContentHash: instructionContentHash(
      String(input.expectedProposalContentHash)
    ),
    expectedProjectVersion: positiveVersion(
      input.expectedProjectVersion,
      "Expected project version"
    )
  };
}

/** Hashes validated apply semantics; idempotency key, server time, and genesis IDs are excluded. */
export async function structureStoryWorkApplyRequestFingerprint(
  input: ApplyStructureStoryWorkInput,
  hashPort: AsyncHashPort
): Promise<InstructionContentHash> {
  storyWorkApplyIdempotencyKey(input.idempotencyKey);
  if (!Array.isArray(input.selectedOperationIds) || input.selectedOperationIds.length === 0) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "Structure apply requires at least one selected operation."
    );
  }
  const request = {
    ...baseFingerprint(input),
    selectedOperationIds: sortedOperationIds(input.selectedOperationIds),
    ...(input.canvasPlacement === undefined
      ? {}
      : { canvasPlacement: canvasPlacementFingerprint(input.canvasPlacement) })
  };
  return instructionContentHash(
    await hashPort.digestSha256Hex(canonicalJsonStringify(request))
  );
}

export type StructureStoryWorkApplySummary = Readonly<{
  bookId: BookId;
  projectVersion: number;
  createdSceneIds: readonly string[];
}>;
