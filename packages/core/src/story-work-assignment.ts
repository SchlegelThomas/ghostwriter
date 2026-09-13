import type { AgentModelId } from "./agent-context-receipt.js";
import type { InstructionContentHash } from "./agent-domain.js";
import { instructionContentHash } from "./agent-domain.js";
import {
  captureContentHash,
  type CaptureContentHash
} from "./capture-documents.js";
import {
  DomainValidationError,
  type AgentProposalId,
  type AgentRunId,
  type BookId,
  type CaptureId,
  type ChapterId,
  type ProjectId,
  type RevisionId,
  type SceneId,
  type StoryKnowledgeId
} from "./domain.js";
import type { AccountId } from "./identity.js";
import { assertAgentModelId, providerForAgentModel } from "./model-catalog.js";
import { assertProviderId, type ProviderId } from "./provider-credentials.js";
import { sceneContentHash, type SceneContentHash } from "./scene-documents.js";

type BrandedId<Name extends string> = string & { readonly __brand: Name };

export type StoryWorkAssignmentId = BrandedId<"StoryWorkAssignmentId">;

export function storyWorkAssignmentId(value: string): StoryWorkAssignmentId {
  return requireIdentifier(value, "Story work assignment") as StoryWorkAssignmentId;
}

export const STORY_WORK_TASK_KINDS = Object.freeze([
  "character",
  "outline",
  "chapter",
  "scene",
  "plan",
  "revise",
  "check"
] as const);

export type StoryWorkTaskKind = (typeof STORY_WORK_TASK_KINDS)[number];

export const STORY_WORK_ASSIGNMENT_STATUSES = Object.freeze([
  "brief-ready",
  "running",
  "artifact-ready",
  "awaiting-review",
  "failed",
  "canceled",
  "stale",
  "rejected",
  "applied"
] as const);

export type StoryWorkAssignmentStatus =
  (typeof STORY_WORK_ASSIGNMENT_STATUSES)[number];

export const STORY_WORK_MAX_SOURCES = 100;
export const STORY_WORK_MAX_STEPS = 20;
export const STORY_WORK_MAX_RESULTS = 100;
export const STORY_WORK_MAX_DEPENDENCIES_PER_STEP = 20;
export const STORY_WORK_ASSIGNMENT_LIST_MAX = 100;

export type StoryWorkSourceReference =
  | Readonly<{ kind: "project"; projectId: ProjectId; projectVersion: number }>
  | Readonly<{ kind: "book"; bookId: BookId; projectVersion: number }>
  | Readonly<{ kind: "chapter"; chapterId: ChapterId; projectVersion: number }>
  | Readonly<{
      kind: "scene";
      sceneId: SceneId;
      projectVersion: number;
      workingVersion?: number;
      contentHash?: SceneContentHash;
    }>
  | Readonly<{
      kind: "story-knowledge";
      storyKnowledgeId: StoryKnowledgeId;
      projectVersion: number;
    }>
  | Readonly<{
      kind: "capture";
      captureId: CaptureId;
      workingVersion: number;
      contentHash: CaptureContentHash;
    }>
  | Readonly<{
      /** Reference to the CP1a revision vector; its dependency rows are not copied here. */
      kind: "story-revision-vector";
      revisionVectorId: string;
      contentHash: InstructionContentHash;
    }>;

export type StoryWorkDestinationReference =
  | Readonly<{
      kind: "project";
      projectId: ProjectId;
      operation: "update";
    }>
  | Readonly<{
      kind: "book";
      bookId: BookId;
      operation: "create" | "update";
    }>
  | Readonly<{
      kind: "chapter";
      chapterId: ChapterId;
      operation: "create" | "update";
    }>
  | Readonly<{
      kind: "scene";
      sceneId: SceneId;
      operation: "create" | "update";
    }>
  | Readonly<{
      /** Create destinations reserve this canonical ID before provider execution. */
      kind: "story-knowledge";
      storyKnowledgeId: StoryKnowledgeId;
      operation: "create" | "update";
    }>
  | Readonly<{
      kind: "plan";
      planId: string;
      operation: "create" | "update";
    }>;

export type StoryWorkStepDependency = Readonly<{
  stepId: string;
  requiredState: "artifact-ready" | "applied";
}>;

export type StoryWorkStep = Readonly<{
  id: string;
  title: string;
  dependencies: readonly StoryWorkStepDependency[];
}>;

export type StoryWorkArtifactPointer = Readonly<{
  proposalId: AgentProposalId;
  artifactVersion: number;
  contentHash: InstructionContentHash;
}>;

export type StoryWorkResultReference =
  | Readonly<{
      kind: "project";
      projectId: ProjectId;
      projectVersion: number;
    }>
  | Readonly<{
      kind: "book";
      bookId: BookId;
      projectVersion: number;
    }>
  | Readonly<{
      kind: "chapter";
      chapterId: ChapterId;
      projectVersion: number;
    }>
  | Readonly<{
      kind: "scene";
      sceneId: SceneId;
      workingVersion: number;
      revisionId?: RevisionId;
    }>
  | Readonly<{
      kind: "story-knowledge";
      storyKnowledgeId: StoryKnowledgeId;
      projectVersion: number;
    }>
  | Readonly<{
      kind: "capture";
      captureId: CaptureId;
      workingVersion: number;
    }>
  | Readonly<{
      kind: "plan";
      planId: string;
      planVersion: number;
    }>;

export type StoryWorkAssignment = Readonly<{
  id: StoryWorkAssignmentId;
  projectId: ProjectId;
  initiatorAccountId: AccountId;
  version: number;
  taskKind: StoryWorkTaskKind;
  /** Exact writer-authored text. Validation does not trim or rewrite it. */
  brief: string;
  /** Exact writer-authored text. Validation does not trim or rewrite it. */
  constraints: string;
  /** Exact writer-authored text. Validation does not trim or rewrite it. */
  doneWhen: string;
  sources: readonly StoryWorkSourceReference[];
  destination: StoryWorkDestinationReference;
  provider: ProviderId;
  model: AgentModelId;
  status: StoryWorkAssignmentStatus;
  steps: readonly StoryWorkStep[];
  activeAttemptId?: AgentRunId;
  /** Most recently started attempt, retained after its active state ends. */
  latestAttemptId?: AgentRunId;
  /** Last provider-generated artifact; review edits advance currentArtifact only. */
  generatedArtifact?: StoryWorkArtifactPointer;
  currentArtifact?: StoryWorkArtifactPointer;
  results: readonly StoryWorkResultReference[];
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}>;

export class StoryWorkAssignmentTransitionError extends Error {
  readonly code = "STORY_WORK_ASSIGNMENT_TRANSITION_CONFLICT" as const;

  constructor(message = "The story work assignment changed before this action completed.") {
    super(message);
    this.name = "StoryWorkAssignmentTransitionError";
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

function requireContentHash(value: string, label: string): string {
  return requireIdentifier(value, label);
}

function sourceKey(source: StoryWorkSourceReference): string {
  switch (source.kind) {
    case "project":
      return `project:${source.projectId}`;
    case "book":
      return `book:${source.bookId}`;
    case "chapter":
      return `chapter:${source.chapterId}`;
    case "scene":
      return `scene:${source.sceneId}`;
    case "story-knowledge":
      return `story-knowledge:${source.storyKnowledgeId}`;
    case "capture":
      return `capture:${source.captureId}`;
    case "story-revision-vector":
      return `story-revision-vector:${source.revisionVectorId}`;
  }
}

function normalizeSource(
  source: StoryWorkSourceReference,
  projectId: ProjectId
): StoryWorkSourceReference {
  if (
    source === null ||
    typeof source !== "object" ||
    ![
      "project",
      "book",
      "chapter",
      "scene",
      "story-knowledge",
      "capture",
      "story-revision-vector"
    ].includes(source.kind)
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Story work source kind is invalid."
    );
  }
  switch (source.kind) {
    case "project": {
      if (source.projectId !== projectId) {
        throw new DomainValidationError(
          "CROSS_PROJECT_REFERENCE",
          "The assignment project source belongs to another project."
        );
      }
      return Object.freeze({
        kind: source.kind,
        projectId: source.projectId,
        projectVersion: requirePositiveVersion(source.projectVersion, "Project version")
      });
    }
    case "book":
      requireIdentifier(source.bookId, "Book");
      return Object.freeze({
        ...source,
        projectVersion: requirePositiveVersion(source.projectVersion, "Project version")
      });
    case "chapter":
      requireIdentifier(source.chapterId, "Chapter");
      return Object.freeze({
        ...source,
        projectVersion: requirePositiveVersion(source.projectVersion, "Project version")
      });
    case "scene": {
      requireIdentifier(source.sceneId, "Scene");
      const hasWorkingVersion = source.workingVersion !== undefined;
      const hasContentHash = source.contentHash !== undefined;
      if (hasWorkingVersion !== hasContentHash) {
        throw new DomainValidationError(
          "INVALID_VERSION",
          "Scene prose version and content hash must be supplied together."
        );
      }
      return Object.freeze({
        kind: source.kind,
        sceneId: source.sceneId,
        projectVersion: requirePositiveVersion(source.projectVersion, "Project version"),
        ...(source.workingVersion === undefined
          ? {}
          : {
              workingVersion: requirePositiveVersion(
                source.workingVersion,
                "Scene working version"
              ),
              contentHash: sceneContentHash(source.contentHash!)
            })
      });
    }
    case "story-knowledge":
      requireIdentifier(source.storyKnowledgeId, "Story knowledge");
      return Object.freeze({
        ...source,
        projectVersion: requirePositiveVersion(source.projectVersion, "Project version")
      });
    case "capture":
      requireIdentifier(source.captureId, "Capture");
      return Object.freeze({
        ...source,
        workingVersion: requirePositiveVersion(
          source.workingVersion,
          "Capture working version"
        ),
        contentHash: captureContentHash(source.contentHash)
      });
    case "story-revision-vector":
      return Object.freeze({
        ...source,
        revisionVectorId: requireIdentifier(
          source.revisionVectorId,
          "Story revision vector"
        ),
        contentHash: instructionContentHash(source.contentHash)
      });
  }
}

function normalizeSources(
  sources: readonly StoryWorkSourceReference[],
  projectId: ProjectId
): readonly StoryWorkSourceReference[] {
  if (!Array.isArray(sources) || sources.length > STORY_WORK_MAX_SOURCES) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      `Story work assignments are limited to ${STORY_WORK_MAX_SOURCES} sources.`
    );
  }
  const keys = new Set<string>();
  const normalized = sources.map((source) => {
    const next = normalizeSource(source, projectId);
    const key = sourceKey(next);
    if (keys.has(key)) {
      throw new DomainValidationError(
        "DUPLICATE_REFERENCE",
        `Story work assignment contains duplicate source "${key}".`
      );
    }
    keys.add(key);
    return next;
  });
  return Object.freeze(normalized);
}

function normalizeDestination(
  destination: StoryWorkDestinationReference,
  projectId: ProjectId,
  taskKind: StoryWorkTaskKind
): StoryWorkDestinationReference {
  if (
    destination === null ||
    typeof destination !== "object" ||
    ![
      "project",
      "book",
      "chapter",
      "scene",
      "story-knowledge",
      "plan"
    ].includes(destination.kind)
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Story work destination kind is invalid."
    );
  }
  switch (destination.kind) {
    case "project":
      if (destination.projectId !== projectId) {
        throw new DomainValidationError(
          "CROSS_PROJECT_REFERENCE",
          "The assignment destination belongs to another project."
        );
      }
      break;
    case "book":
      requireIdentifier(destination.bookId, "Book destination");
      break;
    case "chapter":
      requireIdentifier(destination.chapterId, "Chapter destination");
      break;
    case "scene":
      requireIdentifier(destination.sceneId, "Scene destination");
      break;
    case "story-knowledge":
      requireIdentifier(destination.storyKnowledgeId, "Story knowledge destination");
      break;
    case "plan":
      requireIdentifier(destination.planId, "Plan destination");
      break;
  }
  if (taskKind === "character" && destination.kind !== "story-knowledge") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Character work requires a reserved story-knowledge destination."
    );
  }
  return Object.freeze({ ...destination });
}

function normalizeSteps(steps: readonly StoryWorkStep[]): readonly StoryWorkStep[] {
  if (
    !Array.isArray(steps) ||
    steps.length < 1 ||
    steps.length > STORY_WORK_MAX_STEPS
  ) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      `Story work assignments require 1-${STORY_WORK_MAX_STEPS} steps.`
    );
  }
  const ids = new Set<string>();
  const normalized = steps.map((step) => {
    const id = requireIdentifier(step.id, "Story work step");
    if (ids.has(id)) {
      throw new DomainValidationError(
        "DUPLICATE_ID",
        `Story work assignment contains duplicate step "${id}".`
      );
    }
    ids.add(id);
    if (
      !Array.isArray(step.dependencies) ||
      step.dependencies.length > STORY_WORK_MAX_DEPENDENCIES_PER_STEP
    ) {
      throw new DomainValidationError(
        "VALUE_TOO_LONG",
        `Story work steps are limited to ${STORY_WORK_MAX_DEPENDENCIES_PER_STEP} dependencies.`
      );
    }
    const dependencyIds = new Set<string>();
    const dependencies = step.dependencies.map(
      (dependency: StoryWorkStepDependency) => {
      const stepId = requireIdentifier(dependency.stepId, "Dependency step");
      if (stepId === id) {
        throw new DomainValidationError(
          "DUPLICATE_REFERENCE",
          `Story work step "${id}" cannot depend on itself.`
        );
      }
      if (dependencyIds.has(stepId)) {
        throw new DomainValidationError(
          "DUPLICATE_REFERENCE",
          `Story work step "${id}" contains duplicate dependency "${stepId}".`
        );
      }
      if (
        dependency.requiredState !== "artifact-ready" &&
        dependency.requiredState !== "applied"
      ) {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "Story work step dependency state is invalid."
        );
      }
      dependencyIds.add(stepId);
        return Object.freeze({ stepId, requiredState: dependency.requiredState });
      }
    );
    return Object.freeze({
      id,
      title: requireWriterText(step.title, "Step title", 200),
      dependencies: Object.freeze(dependencies)
    });
  });

  for (const step of normalized) {
    for (const dependency of step.dependencies) {
      if (!ids.has(dependency.stepId)) {
        throw new DomainValidationError(
          "UNKNOWN_REFERENCE",
          `Story work dependency "${dependency.stepId}" does not identify a step.`
        );
      }
    }
  }
  const byId = new Map(normalized.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string): void => {
    if (visiting.has(stepId)) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Story work step dependencies must not contain a cycle."
      );
    }
    if (visited.has(stepId)) return;
    visiting.add(stepId);
    for (const dependency of byId.get(stepId)?.dependencies ?? []) {
      visit(dependency.stepId);
    }
    visiting.delete(stepId);
    visited.add(stepId);
  };
  normalized.forEach((step) => visit(step.id));
  return Object.freeze(normalized);
}

export function createStoryWorkArtifactPointer(
  pointer: StoryWorkArtifactPointer
): StoryWorkArtifactPointer {
  requireIdentifier(pointer.proposalId, "Agent proposal");
  return Object.freeze({
    proposalId: pointer.proposalId,
    artifactVersion: requirePositiveVersion(
      pointer.artifactVersion,
      "Artifact version"
    ),
    contentHash: instructionContentHash(
      requireContentHash(pointer.contentHash, "Artifact content hash")
    )
  });
}

function resultKey(result: StoryWorkResultReference): string {
  switch (result.kind) {
    case "project":
      return `project:${result.projectId}`;
    case "book":
      return `book:${result.bookId}`;
    case "chapter":
      return `chapter:${result.chapterId}`;
    case "scene":
      return `scene:${result.sceneId}`;
    case "story-knowledge":
      return `story-knowledge:${result.storyKnowledgeId}`;
    case "capture":
      return `capture:${result.captureId}`;
    case "plan":
      return `plan:${result.planId}`;
  }
}

function normalizeResults(
  results: readonly StoryWorkResultReference[],
  projectId: ProjectId
): readonly StoryWorkResultReference[] {
  if (!Array.isArray(results) || results.length > STORY_WORK_MAX_RESULTS) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      `Story work assignments are limited to ${STORY_WORK_MAX_RESULTS} results.`
    );
  }
  const keys = new Set<string>();
  const normalized = results.map((result): StoryWorkResultReference => {
    if (
      result === null ||
      typeof result !== "object" ||
      ![
        "project",
        "book",
        "chapter",
        "scene",
        "story-knowledge",
        "capture",
        "plan"
      ].includes(result.kind)
    ) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Story work result kind is invalid."
      );
    }
    let next: StoryWorkResultReference;
    switch (result.kind) {
      case "project":
        if (result.projectId !== projectId) {
          throw new DomainValidationError(
            "CROSS_PROJECT_REFERENCE",
            "The assignment result belongs to another project."
          );
        }
        next = Object.freeze({
          ...result,
          projectVersion: requirePositiveVersion(
            result.projectVersion,
            "Project result version"
          )
        });
        break;
      case "book":
      case "chapter":
      case "story-knowledge":
        next = Object.freeze({
          ...result,
          projectVersion: requirePositiveVersion(
            result.projectVersion,
            "Project result version"
          )
        });
        break;
      case "scene":
        next = Object.freeze({
          ...result,
          workingVersion: requirePositiveVersion(
            result.workingVersion,
            "Scene result version"
          )
        });
        break;
      case "capture":
        next = Object.freeze({
          ...result,
          workingVersion: requirePositiveVersion(
            result.workingVersion,
            "Capture result version"
          )
        });
        break;
      case "plan":
        next = Object.freeze({
          ...result,
          planId: requireIdentifier(result.planId, "Plan result"),
          planVersion: requirePositiveVersion(
            result.planVersion,
            "Plan result version"
          )
        });
        break;
      default:
        throw new DomainValidationError(
          "UNKNOWN_REFERENCE",
          "Story work result kind is invalid."
        );
    }
    const key = resultKey(next);
    if (keys.has(key)) {
      throw new DomainValidationError(
        "DUPLICATE_REFERENCE",
        `Story work assignment contains duplicate result "${key}".`
      );
    }
    keys.add(key);
    return next;
  });
  return Object.freeze(normalized);
}

function resultsContainDestination(
  destination: StoryWorkDestinationReference,
  results: readonly StoryWorkResultReference[]
): boolean {
  switch (destination.kind) {
    case "project":
      return results.some(
        (result) =>
          result.kind === "project" && result.projectId === destination.projectId
      );
    case "book":
      return results.some(
        (result) => result.kind === "book" && result.bookId === destination.bookId
      );
    case "chapter":
      return results.some(
        (result) =>
          result.kind === "chapter" && result.chapterId === destination.chapterId
      );
    case "scene":
      return results.some(
        (result) => result.kind === "scene" && result.sceneId === destination.sceneId
      );
    case "story-knowledge":
      return results.some(
        (result) =>
          result.kind === "story-knowledge" &&
          result.storyKnowledgeId === destination.storyKnowledgeId
      );
    case "plan":
      return results.some(
        (result) => result.kind === "plan" && result.planId === destination.planId
      );
  }
}

function validateStateShape(assignment: StoryWorkAssignment): void {
  const active = assignment.activeAttemptId !== undefined;
  if ((assignment.status === "running") !== active) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Only a running assignment may have an active attempt."
    );
  }
  if (
    assignment.activeAttemptId !== undefined &&
    assignment.latestAttemptId !== undefined &&
    assignment.activeAttemptId !== assignment.latestAttemptId
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "The active attempt must also be the latest attempt."
    );
  }
  const requiresArtifact =
    (assignment.status === "artifact-ready" ||
      assignment.status === "awaiting-review" ||
      assignment.status === "rejected" ||
      assignment.status === "applied");
  if (
    requiresArtifact &&
    (assignment.currentArtifact === undefined ||
      assignment.generatedArtifact === undefined)
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "This assignment state requires current and generated artifact lineage."
    );
  }
  if (
    (assignment.currentArtifact === undefined) !==
    (assignment.generatedArtifact === undefined)
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Current story work artifacts require their generated origin."
    );
  }
  if (
    assignment.currentArtifact !== undefined &&
    assignment.generatedArtifact !== undefined
  ) {
    if (
      assignment.generatedArtifact.artifactVersion >
      assignment.currentArtifact.artifactVersion
    ) {
      throw new DomainValidationError(
        "INVALID_VERSION",
        "Generated artifact lineage cannot be newer than the current review artifact."
      );
    }
    if (
      assignment.generatedArtifact.artifactVersion ===
        assignment.currentArtifact.artifactVersion &&
      !sameArtifact(assignment.generatedArtifact, assignment.currentArtifact)
    ) {
      throw new DomainValidationError(
        "INVALID_VERSION",
        "A review edit must advance beyond its generated artifact version."
      );
    }
    if (
      assignment.status === "artifact-ready" &&
      !sameArtifact(assignment.generatedArtifact, assignment.currentArtifact)
    ) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "A newly generated artifact must be the current review artifact."
      );
    }
  }
  if (assignment.status === "applied" && assignment.results.length === 0) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "An applied assignment requires at least one canonical result reference."
    );
  }
  if (
    assignment.status === "applied" &&
    !resultsContainDestination(assignment.destination, assignment.results)
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Applied story work must include its exact reserved destination in the canonical results."
    );
  }
  if (assignment.status !== "applied" && assignment.results.length > 0) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Canonical result references may be recorded only when work is applied."
    );
  }
}

export function createStoryWorkAssignment(
  input: StoryWorkAssignment
): StoryWorkAssignment {
  const id = storyWorkAssignmentId(input.id);
  const projectId = input.projectId;
  requireIdentifier(projectId, "Project");
  requireIdentifier(input.initiatorAccountId, "Initiator account");
  if (!STORY_WORK_TASK_KINDS.includes(input.taskKind)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Story work task kind is invalid."
    );
  }
  if (!STORY_WORK_ASSIGNMENT_STATUSES.includes(input.status)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Story work assignment status is invalid."
    );
  }
  const provider = assertProviderId(input.provider);
  const model = assertAgentModelId(input.model);
  if (providerForAgentModel(model) !== provider) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "The selected model does not belong to the selected provider."
    );
  }
  const createdAt = requireTimestamp(input.createdAt, "Assignment creation time");
  const updatedAt = requireTimestamp(input.updatedAt, "Assignment update time");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Assignment update time cannot precede creation time."
    );
  }
  const assignment: StoryWorkAssignment = Object.freeze({
    id,
    projectId,
    initiatorAccountId: input.initiatorAccountId,
    version: requirePositiveVersion(input.version, "Assignment version"),
    taskKind: input.taskKind,
    brief: requireWriterText(input.brief, "Writer brief", 20_000),
    constraints: requireWriterText(
      input.constraints,
      "Assignment constraints",
      8_000
    ),
    doneWhen: requireWriterText(
      input.doneWhen,
      "Assignment done condition",
      4_000
    ),
    sources: normalizeSources(input.sources, projectId),
    destination: normalizeDestination(input.destination, projectId, input.taskKind),
    provider,
    model,
    status: input.status,
    steps: normalizeSteps(input.steps),
    ...(input.activeAttemptId === undefined
      ? {}
      : {
          activeAttemptId: requireIdentifier(
            input.activeAttemptId,
            "Active agent run"
          ) as AgentRunId
        }),
    ...(input.latestAttemptId === undefined
      ? {}
      : {
          latestAttemptId: requireIdentifier(
            input.latestAttemptId,
            "Latest agent run"
          ) as AgentRunId
        }),
    ...(input.currentArtifact === undefined
      ? {}
      : { currentArtifact: createStoryWorkArtifactPointer(input.currentArtifact) }),
    ...(input.generatedArtifact === undefined
      ? {}
      : { generatedArtifact: createStoryWorkArtifactPointer(input.generatedArtifact) }),
    results: normalizeResults(input.results, projectId),
    idempotencyKey: requireIdentifier(input.idempotencyKey, "Idempotency key"),
    createdAt,
    updatedAt
  });
  validateStateShape(assignment);
  return assignment;
}

function requireTransition(
  assignment: StoryWorkAssignment,
  expectedVersion: number,
  statuses: readonly StoryWorkAssignmentStatus[]
): StoryWorkAssignment {
  const current = createStoryWorkAssignment(assignment);
  if (current.version !== expectedVersion || !statuses.includes(current.status)) {
    throw new StoryWorkAssignmentTransitionError();
  }
  return current;
}

function sameArtifact(
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

function nextAssignment(
  current: StoryWorkAssignment,
  updatedAt: string,
  patch: Partial<StoryWorkAssignment>
): StoryWorkAssignment {
  const nextUpdatedAt = requireTimestamp(updatedAt, "Assignment update time");
  if (Date.parse(nextUpdatedAt) < Date.parse(current.updatedAt)) {
    throw new StoryWorkAssignmentTransitionError(
      "Assignment update time cannot move backward."
    );
  }
  return createStoryWorkAssignment({
    ...current,
    ...patch,
    version: current.version + 1,
    updatedAt: nextUpdatedAt
  });
}

export function startStoryWorkAttempt(input: Readonly<{
  assignment: StoryWorkAssignment;
  expectedVersion: number;
  runId: AgentRunId;
  updatedAt: string;
}>): StoryWorkAssignment {
  const current = requireTransition(input.assignment, input.expectedVersion, [
    "brief-ready",
    "artifact-ready",
    "awaiting-review",
    "failed",
    "canceled",
    "stale",
    "rejected"
  ]);
  return nextAssignment(current, input.updatedAt, {
    status: "running",
    activeAttemptId: requireIdentifier(input.runId, "Agent run") as AgentRunId,
    latestAttemptId: requireIdentifier(input.runId, "Agent run") as AgentRunId
  });
}

export function finishStoryWorkAttemptWithoutArtifact(input: Readonly<{
  assignment: StoryWorkAssignment;
  expectedVersion: number;
  runId: AgentRunId;
  outcome: "failed" | "canceled" | "stale";
  updatedAt: string;
}>): StoryWorkAssignment {
  const current = requireTransition(input.assignment, input.expectedVersion, [
    "running"
  ]);
  if (current.activeAttemptId !== input.runId) {
    throw new StoryWorkAssignmentTransitionError(
      "The completed attempt is no longer active for this assignment."
    );
  }
  const { activeAttemptId: _activeAttemptId, ...withoutActiveAttempt } = current;
  return nextAssignment(withoutActiveAttempt, input.updatedAt, {
    status: input.outcome
  });
}

export function attachGeneratedStoryWorkArtifact(input: Readonly<{
  assignment: StoryWorkAssignment;
  expectedVersion: number;
  runId: AgentRunId;
  artifact: StoryWorkArtifactPointer;
  expectedCurrentArtifact?: StoryWorkArtifactPointer;
  updatedAt: string;
}>): StoryWorkAssignment {
  const current = requireTransition(input.assignment, input.expectedVersion, [
    "running"
  ]);
  if (current.activeAttemptId !== input.runId) {
    throw new StoryWorkAssignmentTransitionError(
      "The generated artifact belongs to an inactive attempt."
    );
  }
  const artifact = createStoryWorkArtifactPointer(input.artifact);
  if (current.currentArtifact === undefined) {
    if (input.expectedCurrentArtifact !== undefined || artifact.artifactVersion !== 1) {
      throw new StoryWorkAssignmentTransitionError(
        "The first assignment artifact must have artifact version 1."
      );
    }
  } else {
    if (!sameArtifact(current.currentArtifact, input.expectedCurrentArtifact)) {
      throw new StoryWorkAssignmentTransitionError(
        "The prior review artifact changed before generation completed."
      );
    }
    if (
      artifact.artifactVersion !== current.currentArtifact.artifactVersion + 1 ||
      artifact.proposalId === current.currentArtifact.proposalId
    ) {
      throw new StoryWorkAssignmentTransitionError(
        "A revised generated artifact requires a new proposal and next version."
      );
    }
  }
  const { activeAttemptId: _activeAttemptId, ...withoutActiveAttempt } = current;
  return nextAssignment(withoutActiveAttempt, input.updatedAt, {
    status: "artifact-ready",
    generatedArtifact: artifact,
    currentArtifact: artifact
  });
}

export function openStoryWorkArtifactReview(input: Readonly<{
  assignment: StoryWorkAssignment;
  expectedVersion: number;
  artifact: StoryWorkArtifactPointer;
  updatedAt: string;
}>): StoryWorkAssignment {
  const current = requireTransition(input.assignment, input.expectedVersion, [
    "artifact-ready"
  ]);
  if (!sameArtifact(current.currentArtifact, input.artifact)) {
    throw new StoryWorkAssignmentTransitionError(
      "The requested review artifact is no longer current."
    );
  }
  return nextAssignment(current, input.updatedAt, { status: "awaiting-review" });
}

export function replaceStoryWorkReviewArtifact(input: Readonly<{
  assignment: StoryWorkAssignment;
  expectedVersion: number;
  expectedCurrentArtifact: StoryWorkArtifactPointer;
  nextArtifact: StoryWorkArtifactPointer;
  updatedAt: string;
}>): StoryWorkAssignment {
  const current = requireTransition(input.assignment, input.expectedVersion, [
    "awaiting-review"
  ]);
  if (!sameArtifact(current.currentArtifact, input.expectedCurrentArtifact)) {
    throw new StoryWorkAssignmentTransitionError(
      "The edited review artifact is no longer current."
    );
  }
  const nextArtifact = createStoryWorkArtifactPointer(input.nextArtifact);
  if (
    nextArtifact.artifactVersion !==
      input.expectedCurrentArtifact.artifactVersion + 1 ||
    nextArtifact.proposalId === input.expectedCurrentArtifact.proposalId
  ) {
    throw new StoryWorkAssignmentTransitionError(
      "An edit requires a new proposal and next artifact version."
    );
  }
  return nextAssignment(current, input.updatedAt, {
    currentArtifact: nextArtifact
  });
}

export function rejectStoryWorkArtifact(input: Readonly<{
  assignment: StoryWorkAssignment;
  expectedVersion: number;
  artifact: StoryWorkArtifactPointer;
  updatedAt: string;
}>): StoryWorkAssignment {
  const current = requireTransition(input.assignment, input.expectedVersion, [
    "artifact-ready",
    "awaiting-review"
  ]);
  if (!sameArtifact(current.currentArtifact, input.artifact)) {
    throw new StoryWorkAssignmentTransitionError(
      "The rejected artifact is no longer current."
    );
  }
  return nextAssignment(current, input.updatedAt, { status: "rejected" });
}

/**
 * Records the result of an atomic canonical apply. Call only inside the storage
 * unit of work that has already written every result reference. This is not a
 * generic status mutation and must not be exposed directly through an API.
 */
export function recordAppliedStoryWorkAssignmentFromUnitOfWork(input: Readonly<{
  assignment: StoryWorkAssignment;
  expectedVersion: number;
  artifact: StoryWorkArtifactPointer;
  results: readonly StoryWorkResultReference[];
  updatedAt: string;
}>): StoryWorkAssignment {
  const current = requireTransition(input.assignment, input.expectedVersion, [
    "awaiting-review"
  ]);
  if (!sameArtifact(current.currentArtifact, input.artifact)) {
    throw new StoryWorkAssignmentTransitionError(
      "The applied artifact is no longer current."
    );
  }
  const results = normalizeResults(input.results, current.projectId);
  if (results.length === 0) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "Applying story work requires at least one canonical result reference."
    );
  }
  if (!resultsContainDestination(current.destination, results)) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Applying story work requires a result for its exact reserved destination."
    );
  }
  return nextAssignment(current, input.updatedAt, {
    status: "applied",
    results
  });
}

export function storyWorkAssignmentRequestFingerprint(
  value: string
): InstructionContentHash {
  return instructionContentHash(
    requireContentHash(value, "Assignment request fingerprint")
  );
}
