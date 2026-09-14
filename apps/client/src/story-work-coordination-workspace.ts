import {
  canonicalJsonStringify,
  SCENE_DRAFT_V1_MAX_SOURCE_SCENES,
  STORY_WORK_COORDINATION_MAX_SURROUNDING_SCENES,
  type AgentModelId,
  type ProjectNavigator,
  type SceneId,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment,
  type StoryWorkCoordinationProjection,
  type StoryWorkCoordinationStepId,
  type StoryWorkCoordinationStepProjection
} from "@ghostwriter/core";
import type {
  ContinueStoryWorkCoordinationStepRequest,
  CreateStoryWorkCoordinationRequest,
  StoryWorkCoordinationChildAssignmentSummary,
  StoryWorkCoordinationDetailResponse
} from "./api.js";
import { GhostwriterApiError } from "./api.js";
import type { startSceneStoryWorkAttempt } from "./api.js";

export type StoryWorkCoordinationCardStatusLabel =
  | "Blocked"
  | "Ready to continue"
  | "Working"
  | "Awaiting review"
  | "Needs attention"
  | "Complete"
  | "Canceled";

export type StoryWorkCoordinationCreateForm = Readonly<{
  coordinationTitle: string;
  sceneTitle: string;
  sceneBrief: string;
  sceneConstraints: string;
  sceneDoneWhen: string;
  checkTitle: string;
  checkBrief: string;
  checkConstraints: string;
  checkDoneWhen: string;
}>;

export type StoryWorkCoordinationStepAction =
  | Readonly<{ kind: "start-root"; assignmentId: StoryWorkAssignment["id"] }>
  | Readonly<{ kind: "open-root-review"; assignmentId: StoryWorkAssignment["id"] }>
  | Readonly<{
      kind: "continue-check";
      stepId: StoryWorkCoordinationStepId;
      request: ContinueStoryWorkCoordinationStepRequest;
    }>
  | Readonly<{ kind: "start-check"; assignmentId: StoryWorkAssignment["id"] }>
  | Readonly<{ kind: "open-check-review"; assignmentId: StoryWorkAssignment["id"] }>
  | Readonly<{ kind: "recover-child"; assignmentId: StoryWorkAssignment["id"] }>
  | Readonly<{ kind: "retry-child"; assignmentId: StoryWorkAssignment["id"] }>
  | Readonly<{ kind: "none" }>;

export type StoryWorkCoordinationWorkspaceState = Readonly<{
  detail?: StoryWorkCoordinationDetailResponse;
  inFlightContinueFingerprint?: string;
}>;

type RootAttemptInput = Parameters<typeof startSceneStoryWorkAttempt>[0];
type CheckAttemptInput = RootAttemptInput;

const TERMINAL_ASSIGNMENT_STATUSES = new Set<StoryWorkAssignment["status"]>([
  "failed",
  "canceled",
  "stale",
  "rejected"
]);

const OPEN_REVIEW_ASSIGNMENT_STATUSES = new Set<StoryWorkAssignment["status"]>([
  "artifact-ready",
  "awaiting-review",
  "reviewed"
]);

export class StoryWorkCoordinationCreateInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoryWorkCoordinationCreateInputError";
  }
}

function uniqueAvailableSceneIds(input: Readonly<{
  sceneIds: readonly SceneId[];
  availableSceneIds: ReadonlySet<SceneId>;
  maximum: number;
  duplicateMessage: string;
  unavailableMessage: string;
  overLimitMessage: string;
}>): readonly SceneId[] {
  if (input.sceneIds.length > input.maximum) {
    throw new StoryWorkCoordinationCreateInputError(input.overLimitMessage);
  }
  const unique: SceneId[] = [];
  const seen = new Set<SceneId>();
  for (const sceneId of input.sceneIds) {
    if (seen.has(sceneId)) {
      throw new StoryWorkCoordinationCreateInputError(input.duplicateMessage);
    }
    seen.add(sceneId);
    if (!input.availableSceneIds.has(sceneId)) {
      throw new StoryWorkCoordinationCreateInputError(input.unavailableMessage);
    }
    unique.push(sceneId);
  }
  return Object.freeze(unique);
}

export function buildStoryWorkCoordinationCreateInput(input: Readonly<{
  project: ProjectNavigator;
  model: AgentModelId;
  sceneIds: readonly SceneId[];
  surroundingSceneIds?: readonly SceneId[];
  form: StoryWorkCoordinationCreateForm;
  idempotencyKey: string;
  availableSceneIds: ReadonlySet<SceneId>;
}>): Readonly<{ projectId: string } & CreateStoryWorkCoordinationRequest> {
  const sceneSourceIds = uniqueAvailableSceneIds({
    sceneIds: input.sceneIds,
    availableSceneIds: input.availableSceneIds,
    maximum: SCENE_DRAFT_V1_MAX_SOURCE_SCENES,
    duplicateMessage: "Selected scene source IDs must be unique.",
    unavailableMessage: "Selected scene sources include an unavailable scene.",
    overLimitMessage: `Coordinated scene drafts accept at most ${SCENE_DRAFT_V1_MAX_SOURCE_SCENES} scene sources.`
  });
  const surroundingSceneIds =
    input.surroundingSceneIds === undefined
      ? sceneSourceIds
      : uniqueAvailableSceneIds({
          sceneIds: input.surroundingSceneIds,
          availableSceneIds: input.availableSceneIds,
          maximum: STORY_WORK_COORDINATION_MAX_SURROUNDING_SCENES,
          duplicateMessage: "Surrounding context scene IDs must be unique.",
          unavailableMessage: "Surrounding context includes an unavailable scene.",
          overLimitMessage: `Continuity checks accept at most ${STORY_WORK_COORDINATION_MAX_SURROUNDING_SCENES} surrounding scenes.`
        });
  return Object.freeze({
    projectId: input.project.id,
    expectedProjectVersion: input.project.version,
    idempotencyKey: input.idempotencyKey,
    title: input.form.coordinationTitle,
    scene: Object.freeze({
      title: input.form.sceneTitle,
      brief: input.form.sceneBrief,
      constraints: input.form.sceneConstraints,
      doneWhen: input.form.sceneDoneWhen,
      model: input.model,
      sceneIds: sceneSourceIds
    }),
    check: Object.freeze({
      title: input.form.checkTitle,
      brief: input.form.checkBrief,
      constraints: input.form.checkConstraints,
      doneWhen: input.form.checkDoneWhen,
      model: input.model,
      surroundingSceneIds
    })
  });
}

export function deriveStoryWorkCoordinationCardStatus(
  projection: StoryWorkCoordinationProjection
): StoryWorkCoordinationCardStatusLabel {
  switch (projection.overallStatus) {
    case "canceled":
      return "Canceled";
    case "completed":
      return "Complete";
    case "needs-attention":
      return "Needs attention";
    case "paused-awaiting-human":
      return "Awaiting review";
    case "active": {
      if (projection.steps.some((step) => step.state === "running")) {
        return "Working";
      }
      if (projection.steps.some((step) => step.state === "ready")) {
        return "Ready to continue";
      }
      if (projection.steps.some((step) => step.state === "blocked")) {
        return "Blocked";
      }
      return "Ready to continue";
    }
    default: {
      const exhaustive: never = projection.overallStatus;
      return exhaustive;
    }
  }
}

export function presentStoryWorkCoordinationCard(input: Readonly<{
  title: string;
  projection: StoryWorkCoordinationProjection;
}>): Readonly<{ title: string; status: StoryWorkCoordinationCardStatusLabel }> {
  return Object.freeze({
    title: input.title,
    status: deriveStoryWorkCoordinationCardStatus(input.projection)
  });
}

function summaryForStep(
  detail: StoryWorkCoordinationDetailResponse,
  stepProjection: StoryWorkCoordinationStepProjection
): StoryWorkCoordinationChildAssignmentSummary | undefined {
  return detail.childAssignmentSummaries.find(
    (entry) => entry.stepId === stepProjection.stepId
  );
}

function resolveStepAssignment(input: Readonly<{
  detail: StoryWorkCoordinationDetailResponse;
  stepProjection: StoryWorkCoordinationStepProjection;
  childAssignmentsById?: ReadonlyMap<StoryWorkAssignment["id"], StoryWorkAssignment>;
}>): StoryWorkAssignment | undefined {
  if (input.stepProjection.kind === "scene-draft") {
    return input.detail.rootAssignment;
  }
  if (input.stepProjection.state === "blocked") return undefined;
  const assignmentId = input.stepProjection.assignmentId;
  if (assignmentId === undefined) return undefined;
  return input.childAssignmentsById?.get(assignmentId);
}

function resolveStepAssignmentStatus(input: Readonly<{
  detail: StoryWorkCoordinationDetailResponse;
  stepProjection: StoryWorkCoordinationStepProjection;
  assignment?: StoryWorkAssignment;
}>): StoryWorkAssignment["status"] | undefined {
  if (input.assignment !== undefined) return input.assignment.status;
  if (input.stepProjection.kind === "scene-draft") {
    return input.detail.rootAssignment.status;
  }
  return summaryForStep(input.detail, input.stepProjection)?.status;
}

export function deriveStoryWorkCoordinationStepAction(input: Readonly<{
  detail: StoryWorkCoordinationDetailResponse;
  stepProjection: StoryWorkCoordinationStepProjection;
  childAssignmentsById?: ReadonlyMap<
    StoryWorkAssignment["id"],
    StoryWorkAssignment
  >;
}>): StoryWorkCoordinationStepAction {
  const assignment = resolveStepAssignment(input);
  const assignmentStatus = resolveStepAssignmentStatus({
    detail: input.detail,
    stepProjection: input.stepProjection,
    assignment
  });
  const projectedAssignmentId =
    input.stepProjection.state === "blocked"
      ? undefined
      : input.stepProjection.assignmentId;
  const assignmentId =
    assignment?.id ??
    projectedAssignmentId ??
    (input.stepProjection.kind === "scene-draft"
      ? input.detail.rootAssignment.id
      : summaryForStep(input.detail, input.stepProjection)?.assignmentId);

  if (input.stepProjection.kind === "scene-draft") {
    if (assignmentId === undefined || assignmentStatus === undefined) {
      return Object.freeze({ kind: "none" });
    }
    if (assignmentStatus === "brief-ready") {
      return Object.freeze({ kind: "start-root", assignmentId });
    }
    if (
      assignmentStatus === "artifact-ready" ||
      assignmentStatus === "awaiting-review"
    ) {
      return Object.freeze({ kind: "open-root-review", assignmentId });
    }
    if (assignmentStatus === "running") {
      return Object.freeze({ kind: "recover-child", assignmentId });
    }
    if (TERMINAL_ASSIGNMENT_STATUSES.has(assignmentStatus)) {
      return Object.freeze({ kind: "retry-child", assignmentId });
    }
    return Object.freeze({ kind: "none" });
  }

  if (input.stepProjection.state === "blocked") {
    return Object.freeze({ kind: "none" });
  }
  if (
    input.stepProjection.state === "ready" &&
    input.stepProjection.resolvedDependency !== undefined
  ) {
    return Object.freeze({
      kind: "continue-check",
      stepId: input.stepProjection.stepId,
      request: Object.freeze({
        expectedCoordinationVersion: input.detail.projection.version,
        expectedUpstreamArtifact: input.stepProjection.resolvedDependency.artifact
      })
    });
  }
  if (assignmentId === undefined || assignmentStatus === undefined) {
    return Object.freeze({ kind: "none" });
  }
  if (assignmentStatus === "brief-ready") {
    return Object.freeze({ kind: "start-check", assignmentId });
  }
  if (OPEN_REVIEW_ASSIGNMENT_STATUSES.has(assignmentStatus)) {
    return Object.freeze({ kind: "open-check-review", assignmentId });
  }
  if (assignmentStatus === "running") {
    return Object.freeze({ kind: "recover-child", assignmentId });
  }
  if (TERMINAL_ASSIGNMENT_STATUSES.has(assignmentStatus)) {
    return Object.freeze({ kind: "retry-child", assignmentId });
  }
  return Object.freeze({ kind: "none" });
}

export function buildStoryWorkCoordinationRootAttemptInput(input: Readonly<{
  projectId: string;
  rootAssignment: StoryWorkAssignment;
  callerIdempotencyKey: string;
}>): RootAttemptInput {
  return Object.freeze({
    projectId: input.projectId,
    assignmentId: input.rootAssignment.id,
    expectedAssignmentVersion: input.rootAssignment.version,
    kind: "initial",
    sourceMode: "submitted-snapshot",
    instruction: input.rootAssignment.brief,
    idempotencyKey: input.callerIdempotencyKey
  });
}

export function buildStoryWorkCoordinationCheckAttemptInput(input: Readonly<{
  projectId: string;
  checkAssignment: StoryWorkAssignment;
  callerIdempotencyKey: string;
}>): CheckAttemptInput {
  return Object.freeze({
    projectId: input.projectId,
    assignmentId: input.checkAssignment.id,
    expectedAssignmentVersion: input.checkAssignment.version,
    kind: "initial",
    sourceMode: "submitted-snapshot",
    instruction: input.checkAssignment.brief,
    idempotencyKey: input.callerIdempotencyKey
  });
}

export function buildStoryWorkCoordinationContinueCheckRequest(input: Readonly<{
  detail: StoryWorkCoordinationDetailResponse;
  stepProjection: StoryWorkCoordinationStepProjection;
}>): ContinueStoryWorkCoordinationStepRequest {
  if (
    input.stepProjection.kind !== "proposal-continuity-check" ||
    input.stepProjection.state !== "ready" ||
    input.stepProjection.resolvedDependency === undefined
  ) {
    throw new Error(
      "Refresh coordination details before continuing the continuity check."
    );
  }
  return Object.freeze({
    expectedCoordinationVersion: input.detail.projection.version,
    expectedUpstreamArtifact: input.stepProjection.resolvedDependency.artifact
  });
}

export function reloadStoryWorkCoordinationWorkspaceDetail(
  state: StoryWorkCoordinationWorkspaceState,
  detail: StoryWorkCoordinationDetailResponse
): StoryWorkCoordinationWorkspaceState {
  return Object.freeze({
    ...state,
    detail
  });
}

export function deriveStoryWorkCoordinationReloadAutoAction(
  _previous: StoryWorkCoordinationWorkspaceState,
  _detail: StoryWorkCoordinationDetailResponse
): Readonly<{ kind: "none" }> {
  return Object.freeze({ kind: "none" });
}

export function storyWorkCoordinationContinueSemanticFingerprint(input: Readonly<{
  coordinationId: string;
  stepId: string;
  expectedCoordinationVersion: number;
  expectedUpstreamArtifact: StoryWorkArtifactPointer;
}>): string {
  return canonicalJsonStringify(
    Object.freeze({
      coordinationId: input.coordinationId,
      stepId: input.stepId,
      expectedCoordinationVersion: input.expectedCoordinationVersion,
      expectedUpstreamArtifact: input.expectedUpstreamArtifact
    })
  );
}

export function tryAcquireStoryWorkCoordinationContinue(
  state: StoryWorkCoordinationWorkspaceState,
  fingerprint: string
): Readonly<{ accepted: boolean; next: StoryWorkCoordinationWorkspaceState }> {
  if (state.inFlightContinueFingerprint === fingerprint) {
    return Object.freeze({ accepted: false, next: state });
  }
  return Object.freeze({
    accepted: true,
    next: Object.freeze({
      ...state,
      inFlightContinueFingerprint: fingerprint
    })
  });
}

export function releaseStoryWorkCoordinationContinue(
  state: StoryWorkCoordinationWorkspaceState,
  fingerprint: string
): StoryWorkCoordinationWorkspaceState {
  if (state.inFlightContinueFingerprint !== fingerprint) {
    return state;
  }
  return Object.freeze({
    ...state,
    inFlightContinueFingerprint: undefined
  });
}

export function storyWorkCoordinationTransitionConflictRequiresDetailRefresh(
  error: unknown
): error is GhostwriterApiError {
  return (
    error instanceof GhostwriterApiError &&
    error.status === 409 &&
    (error.code === "STORY_WORK_COORDINATION_TRANSITION_CONFLICT" ||
      error.code === "STORY_WORK_COORDINATION_DEPENDENCY_CONFLICT" ||
      error.code === "STORY_WORK_COORDINATION_BIND_IDEMPOTENCY_CONFLICT")
  );
}
