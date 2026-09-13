import type { AgentModelId } from "./agent-context-receipt.js";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import type { AsyncHashPort, InstructionContentHash } from "./agent-domain.js";
import { instructionContentHash } from "./agent-domain.js";
import {
  DomainValidationError,
  type ProjectId,
  type SceneId
} from "./domain.js";
import type { AccountId } from "./identity.js";
import {
  mcpStoryWorkOriginsEqual,
  normalizeMcpStoryWorkOrigin,
  type McpStoryWorkOrigin
} from "./mcp-grants.js";
import { assertAgentModelId } from "./model-catalog.js";
import {
  createStoryWorkArtifactPointer,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment,
  type StoryWorkAssignmentId,
  storyWorkAssignmentId
} from "./story-work-assignment.js";

type BrandedId<Name extends string> = string & { readonly __brand: Name };

export type StoryWorkCoordinationId = BrandedId<"StoryWorkCoordinationId">;
export type StoryWorkCoordinationStepId = BrandedId<"StoryWorkCoordinationStepId">;

export function storyWorkCoordinationId(value: string): StoryWorkCoordinationId {
  return requireIdentifier(value, "Story work coordination") as StoryWorkCoordinationId;
}

export function storyWorkCoordinationStepId(
  value: string
): StoryWorkCoordinationStepId {
  return requireIdentifier(value, "Story work coordination step") as StoryWorkCoordinationStepId;
}

export const STORY_WORK_COORDINATION_STATUSES = Object.freeze([
  "active",
  "canceled"
] as const);

export type StoryWorkCoordinationStatus =
  (typeof STORY_WORK_COORDINATION_STATUSES)[number];

export const STORY_WORK_COORDINATION_MIN_STEPS = 2;
export const STORY_WORK_COORDINATION_MAX_STEPS = 8;
export const STORY_WORK_COORDINATION_V1_MIN_CHECK_STEPS = 1;
export const STORY_WORK_COORDINATION_V1_MAX_CHECK_STEPS = 7;
export const STORY_WORK_COORDINATION_TITLE_MAX = 200;
export const STORY_WORK_COORDINATION_MAX_SURROUNDING_SCENES = 20;

export const STORY_WORK_COORDINATION_STEP_STATES = Object.freeze([
  "ready",
  "draft-ready",
  "running",
  "awaiting-review",
  "completed",
  "blocked",
  "failed",
  "canceled",
  "stale",
  "rejected"
] as const);

export type StoryWorkCoordinationStepState =
  (typeof STORY_WORK_COORDINATION_STEP_STATES)[number];

export const STORY_WORK_COORDINATION_OVERALL_STATUSES = Object.freeze([
  "active",
  "paused-awaiting-human",
  "completed",
  "needs-attention",
  "canceled"
] as const);

export type StoryWorkCoordinationOverallStatus =
  (typeof STORY_WORK_COORDINATION_OVERALL_STATUSES)[number];

export type StoryWorkCoordinationStepDependency = Readonly<{
  stepId: StoryWorkCoordinationStepId;
  requiredState: "artifact-ready";
}>;

export type ProposalContinuityCheckDeferredConfig = Readonly<{
  brief: string;
  constraints: string;
  doneWhen: string;
  model: AgentModelId;
  surroundingSceneIds?: readonly SceneId[];
}>;

export type StoryWorkCoordinationStepBinding = Readonly<{
  assignmentId: StoryWorkAssignmentId;
  resolvedDependency: Readonly<{
    stepId: StoryWorkCoordinationStepId;
    artifact: StoryWorkArtifactPointer;
  }>;
  boundAt: string;
}>;

export type SceneDraftCoordinationStep = Readonly<{
  kind: "scene-draft";
  stepId: StoryWorkCoordinationStepId;
  title: string;
  assignmentId: StoryWorkAssignmentId;
}>;

export type ProposalContinuityCheckCoordinationStep = Readonly<{
  kind: "proposal-continuity-check";
  stepId: StoryWorkCoordinationStepId;
  title: string;
  dependencies: readonly [StoryWorkCoordinationStepDependency];
  deferred: ProposalContinuityCheckDeferredConfig;
  binding?: StoryWorkCoordinationStepBinding;
}>;

export type StoryWorkCoordinationStepDefinition =
  | SceneDraftCoordinationStep
  | ProposalContinuityCheckCoordinationStep;

export type StoryWorkCoordination = Readonly<{
  id: StoryWorkCoordinationId;
  projectId: ProjectId;
  initiatorAccountId: AccountId;
  version: number;
  title: string;
  status: StoryWorkCoordinationStatus;
  steps: readonly StoryWorkCoordinationStepDefinition[];
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  /** Present when the row was created through scoped MCP; omitted for first-party work. */
  origin?: McpStoryWorkOrigin;
}>;

export type { McpStoryWorkOrigin };

export class StoryWorkCoordinationNotFoundError extends Error {
  constructor() {
    super("Story work coordination not found.");
    this.name = "StoryWorkCoordinationNotFoundError";
  }
}

export type StoryWorkCoordinationChildAssignmentMap = ReadonlyMap<
  StoryWorkAssignmentId,
  StoryWorkAssignment
>;

export type StoryWorkCoordinationStepBlockedReason =
  | "upstream-not-ready"
  | "upstream-terminal"
  | "upstream-artifact-missing"
  | "upstream-artifact-expired";

export type StoryWorkCoordinationStepProjection = Readonly<
  {
    stepId: StoryWorkCoordinationStepId;
    kind: StoryWorkCoordinationStepDefinition["kind"];
    title: string;
  } & (
    | {
        state: "blocked";
        reasons: readonly StoryWorkCoordinationStepBlockedReason[];
      }
    | {
        state: "ready";
        assignmentId?: StoryWorkAssignmentId;
        resolvedDependency?: Readonly<{
          stepId: StoryWorkCoordinationStepId;
          artifact: StoryWorkArtifactPointer;
        }>;
      }
    | {
        state: Exclude<
          StoryWorkCoordinationStepState,
          "blocked" | "ready"
        >;
        assignmentId?: StoryWorkAssignmentId;
      }
  )
>;

export type StoryWorkCoordinationProjection = Readonly<{
  coordinationId: StoryWorkCoordinationId;
  status: StoryWorkCoordinationStatus;
  overallStatus: StoryWorkCoordinationOverallStatus;
  version: number;
  steps: readonly StoryWorkCoordinationStepProjection[];
}>;

export class StoryWorkCoordinationTransitionError extends Error {
  readonly code = "STORY_WORK_COORDINATION_TRANSITION_CONFLICT" as const;

  constructor(message = "The story work coordination changed before this action completed.") {
    super(message);
    this.name = "StoryWorkCoordinationTransitionError";
  }
}

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new DomainValidationError("EMPTY_VALUE", `${label} ID must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", `${label} ID must not be empty.`);
  }
  if (normalized.length > 200) {
    throw new DomainValidationError("VALUE_TOO_LONG", `${label} ID is too long.`);
  }
  return normalized;
}

function requireWriterText(value: string, label: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", `${label} must not be empty.`);
  }
  if (value.length > maximum) {
    throw new DomainValidationError("VALUE_TOO_LONG", `${label} is too long.`);
  }
  return value;
}

function requirePositiveVersion(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      `${label} must be a positive integer.`
    );
  }
  return value;
}

function requireTimestamp(value: string, label: string): string {
  const normalized = requireIdentifier(value, label);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new DomainValidationError("EMPTY_VALUE", `${label} must be a timestamp.`);
  }
  return normalized;
}

function invalid(message: string): never {
  throw new DomainValidationError("INVALID_AGENT_POLICY", message);
}

function normalizeDeferredConfig(
  raw: ProposalContinuityCheckDeferredConfig
): ProposalContinuityCheckDeferredConfig {
  const surroundingSceneIds =
    raw.surroundingSceneIds === undefined
      ? undefined
      : normalizeSurroundingSceneIds(raw.surroundingSceneIds);
  return Object.freeze({
    brief: requireWriterText(raw.brief, "Deferred check brief", 20_000),
    constraints: requireWriterText(raw.constraints, "Deferred check constraints", 8_000),
    doneWhen: requireWriterText(raw.doneWhen, "Deferred check done condition", 4_000),
    model: assertAgentModelId(raw.model),
    ...(surroundingSceneIds === undefined ? {} : { surroundingSceneIds })
  });
}

function normalizeSurroundingSceneIds(
  sceneIds: readonly SceneId[]
): readonly SceneId[] {
  if (sceneIds.length > STORY_WORK_COORDINATION_MAX_SURROUNDING_SCENES) {
    invalid("Deferred continuity check surrounding scene list is out of bounds.");
  }
  const seen = new Set<string>();
  const normalized: SceneId[] = [];
  for (const sceneId of sceneIds) {
    requireIdentifier(sceneId, "Scene");
    if (seen.has(sceneId)) {
      invalid("Deferred continuity check surrounding scene ids must be unique.");
    }
    seen.add(sceneId);
    normalized.push(sceneId);
  }
  return Object.freeze(normalized);
}

function normalizeStepDependency(
  dependency: StoryWorkCoordinationStepDependency
): StoryWorkCoordinationStepDependency {
  if (dependency.requiredState !== "artifact-ready") {
    invalid("Coordination step dependencies must require artifact-ready state in v1.");
  }
  return Object.freeze({
    stepId: storyWorkCoordinationStepId(dependency.stepId),
    requiredState: dependency.requiredState
  });
}

function normalizeStepBinding(
  binding: StoryWorkCoordinationStepBinding
): StoryWorkCoordinationStepBinding {
  return Object.freeze({
    assignmentId: storyWorkAssignmentId(binding.assignmentId),
    resolvedDependency: Object.freeze({
      stepId: storyWorkCoordinationStepId(binding.resolvedDependency.stepId),
      artifact: createStoryWorkArtifactPointer(binding.resolvedDependency.artifact)
    }),
    boundAt: requireTimestamp(binding.boundAt, "Step binding time")
  });
}

function normalizeStepDefinition(
  step: StoryWorkCoordinationStepDefinition
): StoryWorkCoordinationStepDefinition {
  const stepId = storyWorkCoordinationStepId(step.stepId);
  const title = requireWriterText(step.title, "Coordination step title", 120);
  if (step.kind === "scene-draft") {
    if ("dependencies" in step || "deferred" in step || "binding" in step) {
      invalid("Scene-draft coordination steps cannot carry deferred or binding fields.");
    }
    return Object.freeze({
      kind: "scene-draft",
      stepId,
      title,
      assignmentId: storyWorkAssignmentId(step.assignmentId)
    });
  }
  if (step.kind !== "proposal-continuity-check") {
    invalid("Story work coordination step kind is invalid.");
  }
  if (step.dependencies.length !== 1) {
    invalid("Proposal continuity check steps require exactly one dependency.");
  }
  const dependencies = Object.freeze([
    normalizeStepDependency(step.dependencies[0]!)
  ]) as readonly [StoryWorkCoordinationStepDependency];
  const deferred = normalizeDeferredConfig(step.deferred);
  const binding =
    step.binding === undefined ? undefined : normalizeStepBinding(step.binding);
  return Object.freeze({
    kind: "proposal-continuity-check",
    stepId,
    title,
    dependencies,
    deferred,
    ...(binding === undefined ? {} : { binding })
  });
}

function sceneDraftRootStep(
  steps: readonly StoryWorkCoordinationStepDefinition[]
): SceneDraftCoordinationStep | undefined {
  const sceneDraftSteps = steps.filter(
    (step): step is SceneDraftCoordinationStep => step.kind === "scene-draft"
  );
  return sceneDraftSteps.length === 1 ? sceneDraftSteps[0] : undefined;
}

function resolveUpstreamSceneDraftStep(input: Readonly<{
  steps: readonly StoryWorkCoordinationStepDefinition[];
  checkStep: ProposalContinuityCheckCoordinationStep;
}>): SceneDraftCoordinationStep {
  const upstreamStepId = input.checkStep.dependencies[0]!.stepId;
  const upstream = input.steps.find((candidate) => candidate.stepId === upstreamStepId);
  if (upstream === undefined || upstream.kind !== "scene-draft") {
    invalid("Continuity check binding upstream step is invalid.");
  }
  return upstream;
}

export function validateStoryWorkCoordinationStepGraph(
  steps: readonly StoryWorkCoordinationStepDefinition[]
): void {
  if (steps.length < STORY_WORK_COORDINATION_MIN_STEPS) {
    invalid("Story work coordination must include at least two steps.");
  }
  if (steps.length > STORY_WORK_COORDINATION_MAX_STEPS) {
    invalid("Story work coordination step list is out of bounds.");
  }
  const stepIds = steps.map((step) => step.stepId);
  if (new Set(stepIds).size !== stepIds.length) {
    invalid("Story work coordination step ids must be unique.");
  }
  const sceneDraftSteps = steps.filter(
    (step): step is SceneDraftCoordinationStep => step.kind === "scene-draft"
  );
  const checkSteps = steps.filter(
    (step): step is ProposalContinuityCheckCoordinationStep =>
      step.kind === "proposal-continuity-check"
  );
  if (sceneDraftSteps.length !== 1) {
    invalid("Story work coordination v1 requires exactly one scene-draft root step.");
  }
  if (
    checkSteps.length < STORY_WORK_COORDINATION_V1_MIN_CHECK_STEPS ||
    checkSteps.length > STORY_WORK_COORDINATION_V1_MAX_CHECK_STEPS
  ) {
    invalid(
      "Story work coordination v1 requires one to seven proposal continuity check steps."
    );
  }
  if (steps.length !== sceneDraftSteps.length + checkSteps.length) {
    invalid(
      "Story work coordination v1 accepts only scene-draft and proposal-continuity-check steps."
    );
  }
  const rootStepId = sceneDraftSteps[0]!.stepId;
  const known = new Set(stepIds);
  for (const step of checkSteps) {
    const dependency = step.dependencies[0]!;
    if (dependency.stepId === step.stepId) {
      invalid("Story work coordination steps cannot depend on themselves.");
    }
    if (!known.has(dependency.stepId)) {
      invalid("Story work coordination dependency references an unknown step.");
    }
    if (dependency.stepId !== rootStepId) {
      invalid("Proposal continuity check steps must depend on the scene-draft root step.");
    }
  }

  const adjacency = new Map<StoryWorkCoordinationStepId, readonly StoryWorkCoordinationStepId[]>();
  for (const step of steps) {
    if (step.kind === "proposal-continuity-check") {
      adjacency.set(step.stepId, [step.dependencies[0]!.stepId]);
    } else {
      adjacency.set(step.stepId, []);
    }
  }
  const visiting = new Set<StoryWorkCoordinationStepId>();
  const visited = new Set<StoryWorkCoordinationStepId>();
  const visit = (node: StoryWorkCoordinationStepId): void => {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      invalid("Story work coordination step dependencies must not contain cycles.");
    }
    visiting.add(node);
    for (const required of adjacency.get(node) ?? []) {
      visit(required);
    }
    visiting.delete(node);
    visited.add(node);
  };
  for (const stepId of stepIds) {
    visit(stepId);
  }
}

function artifactPointerEquals(
  left: StoryWorkArtifactPointer,
  right: StoryWorkArtifactPointer
): boolean {
  return (
    left.proposalId === right.proposalId &&
    left.artifactVersion === right.artifactVersion &&
    left.contentHash === right.contentHash
  );
}

function resolveSceneDraftTargetSceneId(
  assignment: StoryWorkAssignment
): SceneId | undefined {
  if (
    assignment.destination.kind === "scene" &&
    assignment.destination.operation === "create"
  ) {
    return assignment.destination.sceneId;
  }
  return undefined;
}

function validateChildAssignmentOriginParity(input: Readonly<{
  coordination: StoryWorkCoordination;
  assignment: StoryWorkAssignment;
}>): void {
  const coordinationOrigin = input.coordination.origin;
  const assignmentOrigin = input.assignment.origin;
  if (coordinationOrigin === undefined) {
    if (assignmentOrigin !== undefined) {
      invalid(
        "First-party story work coordinations cannot include MCP-origin child assignments."
      );
    }
    return;
  }
  if (!mcpStoryWorkOriginsEqual(coordinationOrigin, assignmentOrigin)) {
    invalid(
      "MCP-origin story work coordinations require matching child assignment origin."
    );
  }
}

function validateSceneDraftChildAssignment(input: Readonly<{
  coordination: StoryWorkCoordination;
  step: SceneDraftCoordinationStep;
  assignment: StoryWorkAssignment;
}>): SceneId {
  const { coordination, step, assignment } = input;
  if (assignment.id !== step.assignmentId) {
    invalid("Scene-draft coordination binding references the wrong assignment.");
  }
  validateChildAssignmentOriginParity({ coordination, assignment });
  if (assignment.projectId !== coordination.projectId) {
    invalid("Scene-draft assignment belongs to another project.");
  }
  if (assignment.initiatorAccountId !== coordination.initiatorAccountId) {
    invalid("Scene-draft assignment belongs to another account.");
  }
  if (assignment.taskKind !== "scene") {
    invalid("Scene-draft coordination steps require a scene assignment.");
  }
  const targetSceneId = resolveSceneDraftTargetSceneId(assignment);
  if (targetSceneId === undefined) {
    invalid("Scene-draft coordination requires a reserved scene create destination.");
  }
  if (
    !assignment.sources.some(
      (source) => source.kind === "project" && source.projectId === coordination.projectId
    )
  ) {
    invalid("Scene-draft assignment must include a project baseline source.");
  }
  return targetSceneId;
}

function validateProposalContinuityCheckBinding(input: Readonly<{
  coordination: StoryWorkCoordination;
  step: ProposalContinuityCheckCoordinationStep;
  binding: StoryWorkCoordinationStepBinding;
  childAssignments: StoryWorkCoordinationChildAssignmentMap;
  upstreamSceneDraftStep: SceneDraftCoordinationStep;
}>): void {
  const { step, binding, childAssignments, upstreamSceneDraftStep } = input;
  if (binding.resolvedDependency.stepId !== step.dependencies[0]!.stepId) {
    invalid("Continuity check binding must resolve the declared upstream dependency.");
  }
  if (binding.resolvedDependency.stepId !== upstreamSceneDraftStep.stepId) {
    invalid("Continuity check binding must resolve the declared scene-draft root.");
  }
  const upstreamAssignment = childAssignments.get(upstreamSceneDraftStep.assignmentId);
  if (upstreamAssignment === undefined) {
    invalid("Scene-draft coordination step references a missing assignment.");
  }
  const targetSceneId = validateSceneDraftChildAssignment({
    coordination: input.coordination,
    step: upstreamSceneDraftStep,
    assignment: upstreamAssignment
  });
  const checkAssignment = childAssignments.get(binding.assignmentId);
  if (checkAssignment === undefined) {
    invalid("Continuity check binding references a missing assignment.");
  }
  validateChildAssignmentOriginParity({
    coordination: input.coordination,
    assignment: checkAssignment
  });
  if (checkAssignment.taskKind !== "check") {
    invalid("Continuity check binding must reference a check assignment.");
  }
  if (
    checkAssignment.destination.kind !== "scene" ||
    checkAssignment.destination.operation !== "assess" ||
    checkAssignment.destination.sceneId !== targetSceneId
  ) {
    invalid(
      "Continuity check assignment must assess the same scene reserved by the scene-draft step."
    );
  }
  const proposalSources = checkAssignment.sources.filter(
    (source): source is Extract<
      (typeof checkAssignment.sources)[number],
      { kind: "proposal-artifact" }
    > => source.kind === "proposal-artifact"
  );
  if (proposalSources.length !== 1) {
    invalid("Continuity check binding requires exactly one proposal-draft source.");
  }
  const proposalSource = proposalSources[0]!;
  if (proposalSource.assignmentId !== upstreamSceneDraftStep.assignmentId) {
    invalid("Continuity check proposal source must reference the upstream scene assignment.");
  }
  if (proposalSource.sceneId !== targetSceneId) {
    invalid("Continuity check proposal source must target the coordinated scene.");
  }
  if (
    !artifactPointerEquals(
      {
        proposalId: proposalSource.proposalId,
        artifactVersion: proposalSource.artifactVersion,
        contentHash: proposalSource.contentHash
      },
      binding.resolvedDependency.artifact
    )
  ) {
    invalid("Continuity check binding must match the resolved upstream artifact pointer.");
  }
}

export function validateStoryWorkCoordinationChildAssignments(input: Readonly<{
  coordination: StoryWorkCoordination;
  childAssignments: StoryWorkCoordinationChildAssignmentMap;
}>): void {
  validateStoryWorkCoordinationStepGraph(input.coordination.steps);
  const rootStep = sceneDraftRootStep(input.coordination.steps);
  if (rootStep === undefined) {
    invalid("Story work coordination v1 requires exactly one scene-draft root step.");
  }
  const rootAssignment = input.childAssignments.get(rootStep.assignmentId);
  if (rootAssignment === undefined) {
    invalid("Scene-draft coordination step references a missing assignment.");
  }
  validateSceneDraftChildAssignment({
    coordination: input.coordination,
    step: rootStep,
    assignment: rootAssignment
  });
  for (const step of input.coordination.steps) {
    if (step.kind !== "proposal-continuity-check" || step.binding === undefined) {
      continue;
    }
    validateProposalContinuityCheckBinding({
      coordination: input.coordination,
      step,
      binding: step.binding,
      childAssignments: input.childAssignments,
      upstreamSceneDraftStep: resolveUpstreamSceneDraftStep({
        steps: input.coordination.steps,
        checkStep: step
      })
    });
  }
}

function stepDefinitionWithoutBinding(
  step: StoryWorkCoordinationStepDefinition
): unknown {
  if (step.kind === "scene-draft") {
    return Object.freeze({
      kind: step.kind,
      stepId: step.stepId,
      title: step.title,
      assignmentId: step.assignmentId
    });
  }
  return Object.freeze({
    kind: step.kind,
    stepId: step.stepId,
    title: step.title,
    dependencies: step.dependencies,
    deferred: step.deferred
  });
}

export function storyWorkCoordinationDefinitionFingerprint(
  coordination: StoryWorkCoordination
): string {
  return canonicalJsonStringify({
    projectId: coordination.projectId,
    initiatorAccountId: coordination.initiatorAccountId,
    title: coordination.title.trim(),
    steps: coordination.steps.map(stepDefinitionWithoutBinding)
  });
}

export type StoryWorkCoordinationSemanticStepInput =
  | Readonly<{
      kind: "scene-draft";
      title: string;
      sceneDraftRequestFingerprint: InstructionContentHash;
    }>
  | Readonly<{
      kind: "proposal-continuity-check";
      title: string;
      dependencySceneDraftTitle: string;
      deferred: ProposalContinuityCheckDeferredConfig;
    }>;

export type StoryWorkCoordinationSemanticFingerprintInput = Readonly<{
  title: string;
  steps: readonly StoryWorkCoordinationSemanticStepInput[];
}>;

export async function storyWorkCoordinationSemanticFingerprint(
  input: StoryWorkCoordinationSemanticFingerprintInput,
  hashPort: AsyncHashPort
): Promise<InstructionContentHash> {
  const normalized = Object.freeze({
    title: input.title.trim(),
    steps: input.steps.map((step) => {
      if (step.kind === "scene-draft") {
        return Object.freeze({
          kind: step.kind,
          title: step.title.trim(),
          sceneDraftRequestFingerprint: instructionContentHash(
            String(step.sceneDraftRequestFingerprint)
          )
        });
      }
      return Object.freeze({
        kind: step.kind,
        title: step.title.trim(),
        dependencySceneDraftTitle: step.dependencySceneDraftTitle.trim(),
        deferred: normalizeDeferredConfig(step.deferred)
      });
    })
  });
  return instructionContentHash(
    await hashPort.digestSha256Hex(canonicalJsonStringify(normalized))
  );
}

export function storyWorkCoordinationRequestFingerprint(
  value: InstructionContentHash
): InstructionContentHash {
  return instructionContentHash(String(value));
}

export function createStoryWorkCoordination(
  input: StoryWorkCoordination
): StoryWorkCoordination {
  const id = storyWorkCoordinationId(input.id);
  const projectId = input.projectId;
  requireIdentifier(projectId, "Project");
  requireIdentifier(input.initiatorAccountId, "Initiator account");
  if (!STORY_WORK_COORDINATION_STATUSES.includes(input.status)) {
    invalid("Story work coordination status is invalid.");
  }
  const createdAt = requireTimestamp(input.createdAt, "Coordination creation time");
  const updatedAt = requireTimestamp(input.updatedAt, "Coordination update time");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Coordination update time cannot precede creation time."
    );
  }
  const steps = Object.freeze(input.steps.map(normalizeStepDefinition));
  validateStoryWorkCoordinationStepGraph(steps);
  const origin = normalizeMcpStoryWorkOrigin(input.origin);
  return Object.freeze({
    id,
    projectId,
    initiatorAccountId: input.initiatorAccountId,
    version: requirePositiveVersion(input.version, "Coordination version"),
    title: requireWriterText(input.title, "Coordination title", STORY_WORK_COORDINATION_TITLE_MAX),
    status: input.status,
    steps,
    idempotencyKey: requireIdentifier(input.idempotencyKey, "Coordination idempotency key"),
    createdAt,
    updatedAt,
    ...(origin === undefined ? {} : { origin })
  });
}

export function assertStoryWorkCoordinationOriginImmutable(
  previous: StoryWorkCoordination,
  next: StoryWorkCoordination
): void {
  if (!mcpStoryWorkOriginsEqual(previous.origin, next.origin)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Story work coordination MCP origin cannot change."
    );
  }
}

const UPSTREAM_SATISFIED_STATUSES: ReadonlySet<StoryWorkAssignment["status"]> =
  new Set(["artifact-ready", "awaiting-review"]);

const UPSTREAM_TERMINAL_STATUSES: ReadonlySet<StoryWorkAssignment["status"]> =
  new Set(["failed", "canceled", "stale", "rejected"]);

function blockedReasons(
  ...reasons: StoryWorkCoordinationStepBlockedReason[]
): readonly StoryWorkCoordinationStepBlockedReason[] {
  return Object.freeze(reasons);
}

function mapAssignmentStatusToStepState(
  status: StoryWorkAssignment["status"]
): Exclude<StoryWorkCoordinationStepState, "blocked"> {
  switch (status) {
    case "brief-ready":
      return "ready";
    case "running":
      return "running";
    case "artifact-ready":
      return "draft-ready";
    case "awaiting-review":
      return "awaiting-review";
    case "reviewed":
    case "applied":
      return "completed";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    case "stale":
      return "stale";
    case "rejected":
      return "rejected";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function evaluateUpstreamArtifactDependency(input: Readonly<{
  upstreamAssignment: StoryWorkAssignment;
}>):
  | Readonly<{ ok: true; artifact: StoryWorkArtifactPointer }>
  | Readonly<{
      ok: false;
      reasons: readonly StoryWorkCoordinationStepBlockedReason[];
    }> {
  const { upstreamAssignment } = input;
  if (upstreamAssignment.status === "applied") {
    return Object.freeze({
      ok: false,
      reasons: blockedReasons("upstream-artifact-expired")
    });
  }
  if (UPSTREAM_TERMINAL_STATUSES.has(upstreamAssignment.status)) {
    return Object.freeze({
      ok: false,
      reasons: blockedReasons("upstream-terminal")
    });
  }
  if (!UPSTREAM_SATISFIED_STATUSES.has(upstreamAssignment.status)) {
    return Object.freeze({
      ok: false,
      reasons: blockedReasons("upstream-not-ready")
    });
  }
  if (upstreamAssignment.currentArtifact === undefined) {
    return Object.freeze({
      ok: false,
      reasons: blockedReasons("upstream-artifact-missing")
    });
  }
  return Object.freeze({
    ok: true,
    artifact: upstreamAssignment.currentArtifact
  });
}

function projectSceneDraftStep(input: Readonly<{
  step: SceneDraftCoordinationStep;
  childAssignments: StoryWorkCoordinationChildAssignmentMap;
  coordinationCanceled: boolean;
}>): StoryWorkCoordinationStepProjection {
  if (input.coordinationCanceled) {
    return Object.freeze({
      stepId: input.step.stepId,
      kind: input.step.kind,
      title: input.step.title,
      state: "canceled",
      assignmentId: input.step.assignmentId
    });
  }
  const assignment = input.childAssignments.get(input.step.assignmentId);
  if (assignment === undefined) {
    return Object.freeze({
      stepId: input.step.stepId,
      kind: input.step.kind,
      title: input.step.title,
      state: "blocked",
      reasons: blockedReasons("upstream-artifact-missing")
    });
  }
  return Object.freeze({
    stepId: input.step.stepId,
    kind: input.step.kind,
    title: input.step.title,
    state: mapAssignmentStatusToStepState(assignment.status),
    assignmentId: input.step.assignmentId
  });
}

function projectProposalContinuityCheckStep(input: Readonly<{
  step: ProposalContinuityCheckCoordinationStep;
  childAssignments: StoryWorkCoordinationChildAssignmentMap;
  coordinationCanceled: boolean;
  sceneDraftAssignmentId: StoryWorkAssignmentId | undefined;
}>): StoryWorkCoordinationStepProjection {
  const base = Object.freeze({
    stepId: input.step.stepId,
    kind: input.step.kind,
    title: input.step.title
  });
  if (input.coordinationCanceled) {
    return Object.freeze({
      ...base,
      state: "canceled",
      ...(input.step.binding === undefined
        ? {}
        : { assignmentId: input.step.binding.assignmentId })
    });
  }
  if (input.step.binding !== undefined) {
    const assignment = input.childAssignments.get(input.step.binding.assignmentId);
    if (assignment === undefined) {
      return Object.freeze({
        ...base,
        state: "blocked",
        reasons: blockedReasons("upstream-artifact-missing")
      });
    }
    return Object.freeze({
      ...base,
      state: mapAssignmentStatusToStepState(assignment.status),
      assignmentId: input.step.binding.assignmentId
    });
  }
  const upstreamStepId = input.step.dependencies[0]!.stepId;
  if (input.sceneDraftAssignmentId === undefined) {
    return Object.freeze({
      ...base,
      state: "blocked",
      reasons: blockedReasons("upstream-artifact-missing")
    });
  }
  const dependencyAssignment = input.childAssignments.get(input.sceneDraftAssignmentId);
  if (dependencyAssignment === undefined) {
    return Object.freeze({
      ...base,
      state: "blocked",
      reasons: blockedReasons("upstream-artifact-missing")
    });
  }
  const dependency = evaluateUpstreamArtifactDependency({
    upstreamAssignment: dependencyAssignment
  });
  if (!dependency.ok) {
    return Object.freeze({
      ...base,
      state: "blocked",
      reasons: dependency.reasons
    });
  }
  return Object.freeze({
    ...base,
    state: "ready",
    resolvedDependency: Object.freeze({
      stepId: upstreamStepId,
      artifact: dependency.artifact
    })
  });
}

export function projectStoryWorkCoordination(input: Readonly<{
  coordination: StoryWorkCoordination;
  childAssignments: StoryWorkCoordinationChildAssignmentMap;
}>): StoryWorkCoordinationProjection {
  const coordinationCanceled = input.coordination.status === "canceled";
  const sceneDraftByStepId = new Map<
    StoryWorkCoordinationStepId,
    SceneDraftCoordinationStep
  >();
  for (const step of input.coordination.steps) {
    if (step.kind === "scene-draft") {
      sceneDraftByStepId.set(step.stepId, step);
    }
  }
  const steps = input.coordination.steps.map((step) => {
    if (step.kind === "scene-draft") {
      return projectSceneDraftStep({
        step,
        childAssignments: input.childAssignments,
        coordinationCanceled
      });
    }
    const upstream = sceneDraftByStepId.get(step.dependencies[0]!.stepId);
    return projectProposalContinuityCheckStep({
      step,
      childAssignments: input.childAssignments,
      coordinationCanceled,
      sceneDraftAssignmentId: upstream?.assignmentId
    });
  });
  return Object.freeze({
    coordinationId: input.coordination.id,
    status: input.coordination.status,
    overallStatus: deriveOverallStatus({
      coordinationCanceled,
      steps
    }),
    version: input.coordination.version,
    steps
  });
}

function deriveOverallStatus(input: Readonly<{
  coordinationCanceled: boolean;
  steps: readonly StoryWorkCoordinationStepProjection[];
}>): StoryWorkCoordinationOverallStatus {
  if (input.coordinationCanceled) {
    return "canceled";
  }
  if (input.steps.every((step) => step.state === "completed")) {
    return "completed";
  }
  if (
    input.steps.some(
      (step) =>
        step.state === "failed" ||
        step.state === "rejected" ||
        step.state === "stale"
    )
  ) {
    return "needs-attention";
  }
  if (
    input.steps.some(
      (step) => step.state === "draft-ready" || step.state === "awaiting-review"
    )
  ) {
    return "paused-awaiting-human";
  }
  return "active";
}

export function cancelStoryWorkCoordination(input: Readonly<{
  coordination: StoryWorkCoordination;
  expectedVersion: number;
  updatedAt: string;
}>): StoryWorkCoordination {
  if (input.coordination.version !== input.expectedVersion) {
    throw new StoryWorkCoordinationTransitionError();
  }
  if (input.coordination.status === "canceled") {
    return createStoryWorkCoordination(input.coordination);
  }
  if (input.coordination.status !== "active") {
    invalid("Only active story work coordinations may be canceled.");
  }
  return createStoryWorkCoordination({
    ...input.coordination,
    status: "canceled",
    version: input.coordination.version + 1,
    updatedAt: requireTimestamp(input.updatedAt, "Coordination update time")
  });
}

export function bindProposalContinuityCheckStep(input: Readonly<{
  coordination: StoryWorkCoordination;
  expectedVersion: number;
  stepId: StoryWorkCoordinationStepId;
  binding: StoryWorkCoordinationStepBinding;
  childAssignments: StoryWorkCoordinationChildAssignmentMap;
  updatedAt: string;
}>): StoryWorkCoordination {
  if (input.coordination.version !== input.expectedVersion) {
    throw new StoryWorkCoordinationTransitionError();
  }
  if (input.coordination.status === "canceled") {
    invalid("Canceled story work coordinations cannot bind deferred steps.");
  }
  if (input.coordination.status !== "active") {
    invalid("Only active story work coordinations may bind deferred steps.");
  }
  const stepId = storyWorkCoordinationStepId(input.stepId);
  const stepIndex = input.coordination.steps.findIndex((step) => step.stepId === stepId);
  if (stepIndex < 0) {
    invalid("Story work coordination step was not found.");
  }
  const step = input.coordination.steps[stepIndex]!;
  if (step.kind !== "proposal-continuity-check") {
    invalid("Only proposal continuity check steps accept deferred bindings.");
  }
  if (step.binding !== undefined) {
    invalid("Story work coordination step binding cannot be replaced.");
  }
  const projection = projectStoryWorkCoordination({
    coordination: input.coordination,
    childAssignments: input.childAssignments
  });
  const stepProjection = projection.steps.find((candidate) => candidate.stepId === stepId);
  if (
    stepProjection === undefined ||
    stepProjection.state !== "ready" ||
    stepProjection.resolvedDependency === undefined
  ) {
    invalid("Deferred continuity check binding requires a ready step projection.");
  }
  const resolvedDependency = stepProjection.resolvedDependency;
  if (
    !artifactPointerEquals(
      resolvedDependency.artifact,
      input.binding.resolvedDependency.artifact
    ) ||
    resolvedDependency.stepId !== input.binding.resolvedDependency.stepId
  ) {
    invalid("Deferred continuity check binding must match the resolved upstream artifact.");
  }
  const binding = normalizeStepBinding(input.binding);
  const upstreamSceneDraftStep = resolveUpstreamSceneDraftStep({
    steps: input.coordination.steps,
    checkStep: step
  });
  validateProposalContinuityCheckBinding({
    coordination: input.coordination,
    step,
    binding,
    childAssignments: input.childAssignments,
    upstreamSceneDraftStep
  });
  const nextSteps = input.coordination.steps.map((candidate, index) => {
    if (index !== stepIndex) {
      return candidate;
    }
    return Object.freeze({
      ...candidate,
      binding
    });
  }) as readonly StoryWorkCoordinationStepDefinition[];
  return createStoryWorkCoordination({
    ...input.coordination,
    steps: nextSteps,
    version: input.coordination.version + 1,
    updatedAt: requireTimestamp(input.updatedAt, "Coordination update time")
  });
}
