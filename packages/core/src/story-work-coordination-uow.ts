import type { InstructionContentHash } from "./agent-domain.js";
import type { ProjectId } from "./domain.js";
import type { AccountId } from "./identity.js";
import type {
  StoryWorkArtifactPointer,
  StoryWorkAssignment
} from "./story-work-assignment.js";
import type {
  StoryWorkCoordination,
  StoryWorkCoordinationId,
  StoryWorkCoordinationProjection,
  StoryWorkCoordinationStepId
} from "./story-work-coordination.js";

/**
 * Caller-allocated coordination and root assignment IDs are written only after
 * `findCreateReplay` returns `undefined`. Same for the check assignment ID after
 * `findBindReplay` returns `undefined`. These UOW methods never invoke providers
 * or start generation attempts.
 */
export type FindStoryWorkCoordinationCreateReplayInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  idempotencyKey: string;
  coordinationRequestFingerprint: InstructionContentHash;
}>;

export type CreateStoryWorkCoordinationInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  coordination: StoryWorkCoordination;
  coordinationRequestFingerprint: InstructionContentHash;
  rootAssignment: StoryWorkAssignment;
  rootAssignmentRequestFingerprint: InstructionContentHash;
}>;

export type FindStoryWorkCoordinationBindReplayInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  coordinationId: StoryWorkCoordinationId;
  expectedCoordinationVersion: number;
  stepId: StoryWorkCoordinationStepId;
  resolvedDependency: Readonly<{
    stepId: StoryWorkCoordinationStepId;
    artifact: StoryWorkArtifactPointer;
  }>;
}>;

export type BindProposalContinuityCheckInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  coordinationId: StoryWorkCoordinationId;
  expectedCoordinationVersion: number;
  stepId: StoryWorkCoordinationStepId;
  resolvedDependency: Readonly<{
    stepId: StoryWorkCoordinationStepId;
    artifact: StoryWorkArtifactPointer;
  }>;
  checkAssignment: StoryWorkAssignment;
  checkAssignmentRequestFingerprint: InstructionContentHash;
  boundAt: string;
}>;

export type StoryWorkCoordinationCreateResult = Readonly<{
  replayed: boolean;
  coordination: StoryWorkCoordination;
  projection: StoryWorkCoordinationProjection;
  rootAssignment: StoryWorkAssignment;
}>;

export type StoryWorkCoordinationBindResult = Readonly<{
  replayed: boolean;
  coordination: StoryWorkCoordination;
  projection: StoryWorkCoordinationProjection;
  rootAssignment: StoryWorkAssignment;
  checkAssignment: StoryWorkAssignment;
}>;

export class StoryWorkCoordinationCreateIdempotencyConflictError extends Error {
  readonly code = "STORY_WORK_COORDINATION_CREATE_IDEMPOTENCY_CONFLICT" as const;

  constructor(
    message = "This coordination idempotency key was already used for a different request."
  ) {
    super(message);
    this.name = "StoryWorkCoordinationCreateIdempotencyConflictError";
  }
}

export class StoryWorkCoordinationBindIdempotencyConflictError extends Error {
  readonly code = "STORY_WORK_COORDINATION_BIND_IDEMPOTENCY_CONFLICT" as const;

  constructor(
    message = "This continuity-check idempotency key was already used for a different request."
  ) {
    super(message);
    this.name = "StoryWorkCoordinationBindIdempotencyConflictError";
  }
}

export class StoryWorkCoordinationDependencyConflictError extends Error {
  readonly code = "STORY_WORK_COORDINATION_DEPENDENCY_CONFLICT" as const;

  constructor(
    message = "The coordinated step is not ready for this dependency binding."
  ) {
    super(message);
    this.name = "StoryWorkCoordinationDependencyConflictError";
  }
}

export interface StoryWorkCoordinationUnitOfWork {
  findCreateReplay(
    input: FindStoryWorkCoordinationCreateReplayInput
  ): Promise<StoryWorkCoordinationCreateResult | undefined>;
  create(
    input: CreateStoryWorkCoordinationInput
  ): Promise<StoryWorkCoordinationCreateResult>;
  findBindReplay(
    input: FindStoryWorkCoordinationBindReplayInput
  ): Promise<StoryWorkCoordinationBindResult | undefined>;
  bindProposalContinuityCheck(
    input: BindProposalContinuityCheckInput
  ): Promise<StoryWorkCoordinationBindResult>;
}
