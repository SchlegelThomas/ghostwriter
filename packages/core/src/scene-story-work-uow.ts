import { canonicalJsonStringify } from "./agent-canonical-json.js";
import {
  instructionContentHash,
  type AsyncHashPort,
  type InstructionContentHash
} from "./agent-domain.js";
import type { AgentProposal } from "./agent-runs-proposals.js";
import { createCanvasScopeRef, type CanvasScopeRef } from "./canvas.js";
import {
  DomainValidationError,
  type AgentProposalId,
  type BookId,
  type CanvasObjectId,
  type ChapterId,
  type ProjectId
} from "./domain.js";
import type { AccountId } from "./identity.js";
import {
  sceneContentHash,
  sceneLeaseHolderId,
  sceneVariantName,
  type SceneContentHash,
  type SceneLeaseHolderId
} from "./scene-documents.js";
import {
  storyWorkApplyIdempotencyKey,
  type StoryWorkAssignment,
  type StoryWorkAssignmentId,
  type StoryWorkResultReference
} from "./story-work-assignment.js";

export type SceneStoryWorkApplyBase = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignmentId;
  expectedAssignmentVersion: number;
  proposalId: AgentProposalId;
  expectedArtifactVersion: number;
  expectedProposalContentHash: InstructionContentHash | string;
  idempotencyKey: string;
}>;

export type CreateSceneStoryWorkPlacement =
  | Readonly<{
      kind: "chapter";
      bookId: BookId;
      chapterId: ChapterId;
      position?: number;
    }>
  | Readonly<{
      kind: "unassigned";
      bookId: BookId;
      position?: number;
    }>;

export type CreateSceneStoryWorkCanvasPlacement = Readonly<{
  expectedCanvasVersion: number;
  scope: CanvasScopeRef;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  parentRegionId?: CanvasObjectId;
  storyOrderHint?: number;
}>;

export type CreateSceneStoryWorkApplyInput = SceneStoryWorkApplyBase &
  Readonly<{
    mode: "create-scene";
    expectedProjectVersion: number;
    title: string;
    manuscriptPlacement: CreateSceneStoryWorkPlacement;
    canvas?: CreateSceneStoryWorkCanvasPlacement;
  }>;

/** The backend derives leaseHolderId from the authenticated session. */
export type ExistingSceneStoryWorkApplyBase = SceneStoryWorkApplyBase &
  Readonly<{
    expectedSceneWorkingVersion: number;
    expectedSceneContentHash: SceneContentHash | string;
    leaseHolderId: SceneLeaseHolderId;
  }>;

export type NamedVariantSceneStoryWorkApplyInput =
  ExistingSceneStoryWorkApplyBase &
  Readonly<{
    mode: "named-variant";
    variantName: string;
  }>;

export type ApplyRevisionSceneStoryWorkInput = ExistingSceneStoryWorkApplyBase &
  Readonly<{ mode: "apply-revision" }>;

export type ApplySceneStoryWorkInput =
  | CreateSceneStoryWorkApplyInput
  | NamedVariantSceneStoryWorkApplyInput
  | ApplyRevisionSceneStoryWorkInput;

export type SceneStoryWorkApplyResult = Readonly<{
  replayed: boolean;
  assignment: StoryWorkAssignment;
  proposal: AgentProposal;
  result: Extract<StoryWorkResultReference, { kind: "scene" }>;
}>;

export interface SceneStoryWorkApplyUnitOfWork {
  applyScene(
    input: ApplySceneStoryWorkInput & Readonly<{ appliedAt: string }>
  ): Promise<SceneStoryWorkApplyResult>;
}

export class StoryWorkApplyIdempotencyConflictError extends Error {
  readonly code = "STORY_WORK_APPLY_IDEMPOTENCY_CONFLICT" as const;

  constructor() {
    super("This apply idempotency key was already used for a different request.");
    this.name = "StoryWorkApplyIdempotencyConflictError";
  }
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

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new DomainValidationError("INVALID_VERSION", `${label} must be finite.`);
  }
  return value;
}

function position(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Scene placement position must be a nonnegative integer."
    );
  }
  return value;
}

function baseFingerprint(input: ApplySceneStoryWorkInput) {
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
    )
  };
}

/** Hashes only validated client semantics; server time and generated IDs are excluded. */
export async function sceneStoryWorkApplyRequestFingerprint(
  input: ApplySceneStoryWorkInput,
  hashPort: AsyncHashPort
): Promise<InstructionContentHash> {
  storyWorkApplyIdempotencyKey(input.idempotencyKey);
  const base = baseFingerprint(input);
  let request: Record<string, unknown>;
  switch (input.mode) {
    case "create-scene": {
      if (typeof input.title !== "string" || input.title.trim().length === 0) {
        throw new DomainValidationError(
          "EMPTY_VALUE",
          "Scene title must not be empty."
        );
      }
      const placement = {
        kind: input.manuscriptPlacement.kind,
        bookId: input.manuscriptPlacement.bookId,
        ...(input.manuscriptPlacement.kind === "chapter"
          ? { chapterId: input.manuscriptPlacement.chapterId }
          : {}),
        ...(position(input.manuscriptPlacement.position) === undefined
          ? {}
          : { position: input.manuscriptPlacement.position })
      };
      const canvas = input.canvas === undefined
        ? undefined
        : {
            expectedCanvasVersion: positiveVersion(
              input.canvas.expectedCanvasVersion,
              "Expected Canvas version"
            ),
            scope: createCanvasScopeRef(input.canvas.scope),
            x: finite(input.canvas.x, "Canvas x"),
            y: finite(input.canvas.y, "Canvas y"),
            width: finite(input.canvas.width, "Canvas width"),
            height: finite(input.canvas.height, "Canvas height"),
            z: finite(input.canvas.z, "Canvas z"),
            ...(input.canvas.parentRegionId === undefined
              ? {}
              : { parentRegionId: input.canvas.parentRegionId }),
            ...(input.canvas.storyOrderHint === undefined
              ? {}
              : {
                  storyOrderHint: finite(
                    input.canvas.storyOrderHint,
                    "Canvas story order hint"
                  )
                })
          };
      if (canvas !== undefined && (canvas.width <= 0 || canvas.height <= 0)) {
        throw new DomainValidationError(
          "INVALID_VERSION",
          "Canvas scene placement dimensions must be positive."
        );
      }
      request = {
        ...base,
        mode: input.mode,
        expectedProjectVersion: positiveVersion(
          input.expectedProjectVersion,
          "Expected project version"
        ),
        title: input.title,
        manuscriptPlacement: placement,
        ...(canvas === undefined ? {} : { canvas })
      };
      break;
    }
    case "named-variant":
      request = {
        ...base,
        mode: input.mode,
        expectedSceneWorkingVersion: positiveVersion(
          input.expectedSceneWorkingVersion,
          "Expected scene working version"
        ),
        expectedSceneContentHash: sceneContentHash(
          String(input.expectedSceneContentHash)
        ),
        leaseHolderId: sceneLeaseHolderId(input.leaseHolderId),
        variantName: sceneVariantName(input.variantName)
      };
      break;
    case "apply-revision":
      request = {
        ...base,
        mode: input.mode,
        expectedSceneWorkingVersion: positiveVersion(
          input.expectedSceneWorkingVersion,
          "Expected scene working version"
        ),
        expectedSceneContentHash: sceneContentHash(
          String(input.expectedSceneContentHash)
        ),
        leaseHolderId: sceneLeaseHolderId(input.leaseHolderId)
      };
      break;
  }
  return instructionContentHash(
    await hashPort.digestSha256Hex(canonicalJsonStringify(request))
  );
}
