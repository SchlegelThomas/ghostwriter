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
  type CanvasObjectId,
  type CaptureId,
  type ChapterId,
  type ProjectId,
  type RevisionId,
  type SceneId,
  type SceneVariantId,
  type StoryKnowledgeId
} from "./domain.js";
import type { StoryStructureOperationId } from "./story-structure-proposal-v1.js";
import type { AccountId } from "./identity.js";
import {
  mcpStoryWorkOriginsEqual,
  normalizeMcpStoryWorkOrigin,
  type McpStoryWorkOrigin
} from "./mcp-grants.js";
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
  "reviewed",
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
    }>
  | Readonly<{
      /** Exact scene-draft proposal under review; not a destination or authority. */
      kind: "proposal-artifact";
      assignmentId: StoryWorkAssignmentId;
      proposalId: AgentProposalId;
      sceneId: SceneId;
      artifactVersion: number;
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
      operation: "create" | "update" | "assess";
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
      variantId?: SceneVariantId;
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
    }>
  | Readonly<{
      kind: "story-check";
      proposalId: AgentProposalId;
      artifactVersion: number;
      contentHash: InstructionContentHash;
      sceneId: SceneId;
    }>
  | Readonly<{
      kind: "story-structure";
      bookId: BookId;
      projectVersion: number;
      resolvedOperationIds: readonly StoryStructureOperationId[];
      createdSceneIds: readonly SceneId[];
      canvasPlacedSceneId?: SceneId;
      canvasObjectId?: CanvasObjectId;
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
  /** Idempotency identity for the one successful canonical apply. */
  applyIdempotencyKey?: string;
  applyRequestFingerprint?: InstructionContentHash;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  /** Present when the row was created through scoped MCP; omitted for first-party work. */
  origin?: McpStoryWorkOrigin;
}>;

export type { McpStoryWorkOrigin };

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
    case "proposal-artifact":
      return `proposal-artifact:${source.assignmentId}:${source.proposalId}`;
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
      "story-revision-vector",
      "proposal-artifact"
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
    case "proposal-artifact":
      requireIdentifier(source.sceneId, "Scene");
      return Object.freeze({
        kind: source.kind,
        assignmentId: storyWorkAssignmentId(source.assignmentId),
        proposalId: requireIdentifier(source.proposalId, "Agent proposal") as AgentProposalId,
        sceneId: source.sceneId,
        artifactVersion: requirePositiveVersion(
          source.artifactVersion,
          "Proposal artifact version"
        ),
        contentHash: instructionContentHash(
          requireContentHash(source.contentHash, "Proposal artifact content hash")
        )
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
    case "scene": {
      requireIdentifier(destination.sceneId, "Scene destination");
      if (destination.operation === "assess") {
        if (taskKind !== "check") {
          throw new DomainValidationError(
            "INVALID_AGENT_POLICY",
            "Only check story work may assess a scene without a canonical update."
          );
        }
      } else if (
        destination.operation !== "create" &&
        destination.operation !== "update"
      ) {
        throw new DomainValidationError(
          "UNKNOWN_REFERENCE",
          "Scene destination operation is invalid."
        );
      }
      break;
    }
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
  if (taskKind === "check") {
    if (destination.kind !== "scene" || destination.operation !== "assess") {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Check story work must assess an exact scene without implying a canonical update."
      );
    }
  }
  if (taskKind === "outline") {
    if (destination.kind !== "book" || destination.operation !== "update") {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Outline story work must update one active book destination."
      );
    }
  }
  return Object.freeze({ ...destination });
}

function validateCheckAssignmentDefinition(
  taskKind: StoryWorkTaskKind,
  sources: readonly StoryWorkSourceReference[],
  destination: StoryWorkDestinationReference
): void {
  if (taskKind !== "check") {
    return;
  }
  if (destination.kind !== "scene" || destination.operation !== "assess") {
    return;
  }
  const targetSceneId = destination.sceneId;
  if (sources.length < 1) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Check story work requires at least one source."
    );
  }

  for (const source of sources) {
    if (source.kind === "capture" || source.kind === "story-revision-vector") {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Check story work does not accept Capture or story-revision-vector sources."
      );
    }
    if (source.kind === "scene") {
      if (source.workingVersion === undefined || source.contentHash === undefined) {
        throw new DomainValidationError(
          "INVALID_VERSION",
          "Check story work scene sources require the exact acknowledged scene head."
        );
      }
    }
  }

  const proposalArtifacts = sources.filter(
    (source): source is Extract<StoryWorkSourceReference, { kind: "proposal-artifact" }> =>
      source.kind === "proposal-artifact"
  );
  const targetSceneSources = sources.filter(
    (source): source is Extract<StoryWorkSourceReference, { kind: "scene" }> =>
      source.kind === "scene" && source.sceneId === targetSceneId
  );

  if (proposalArtifacts.length > 1) {
    throw new DomainValidationError(
      "DUPLICATE_REFERENCE",
      "Check story work accepts at most one proposal-draft target."
    );
  }

  if (proposalArtifacts.length === 1) {
    const proposalTarget = proposalArtifacts[0]!;
    if (proposalTarget.sceneId !== targetSceneId) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Check story work source and assess destination must name the same scene."
      );
    }
    if (targetSceneSources.length > 0) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Proposal-draft checks cannot also name the assessed scene as a separate scene source."
      );
    }
    return;
  }

  if (targetSceneSources.length !== 1) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Applied-scene checks require exactly one exact scene head matching the assess destination."
    );
  }
}

function validateOutlineAssignmentDefinition(
  taskKind: StoryWorkTaskKind,
  sources: readonly StoryWorkSourceReference[],
  destination: StoryWorkDestinationReference
): void {
  if (taskKind !== "outline") {
    return;
  }
  if (destination.kind !== "book" || destination.operation !== "update") {
    return;
  }
  const targetBookId = destination.bookId;
  if (sources.length < 1) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Outline story work requires at least one source."
    );
  }

  for (const source of sources) {
    if (
      source.kind === "capture" ||
      source.kind === "story-revision-vector" ||
      source.kind === "proposal-artifact"
    ) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Outline story work does not accept Capture, proposal-artifact, or story-revision-vector sources."
      );
    }
  }

  const bookBaselines = sources.filter(
    (source): source is Extract<StoryWorkSourceReference, { kind: "book" }> =>
      source.kind === "book" && source.bookId === targetBookId
  );
  const projectBaselines = sources.filter(
    (source): source is Extract<StoryWorkSourceReference, { kind: "project" }> =>
      source.kind === "project"
  );

  if (bookBaselines.length === 0 && projectBaselines.length === 0) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Outline story work requires an exact target book or project baseline source."
    );
  }

  const baselineVersion =
    bookBaselines[0]?.projectVersion ?? projectBaselines[0]!.projectVersion;
  if (
    bookBaselines.some((source) => source.projectVersion !== baselineVersion) ||
    projectBaselines.some((source) => source.projectVersion !== baselineVersion)
  ) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Outline story work baseline sources must share one expected project version."
    );
  }

  for (const source of sources) {
    if ("projectVersion" in source && source.projectVersion !== baselineVersion) {
      throw new DomainValidationError(
        "INVALID_VERSION",
        "Outline story work sources must match the baseline project version."
      );
    }
  }
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

function requireStoryStructureOperationId(value: string): StoryStructureOperationId {
  const normalized = requireIdentifier(value, "Story structure operation");
  if (normalized.length > 128) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      "Story structure operation id length is out of bounds."
    );
  }
  return normalized as StoryStructureOperationId;
}

function normalizeUniqueIds<T extends string>(
  values: readonly string[],
  label: string,
  mapValue: (value: string) => T,
  allowEmpty: boolean
): readonly T[] {
  if (!Array.isArray(values)) {
    throw new DomainValidationError("UNKNOWN_REFERENCE", `${label} must be an array.`);
  }
  if (!allowEmpty && values.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", `${label} must not be empty.`);
  }
  if (values.length > STORY_WORK_MAX_RESULTS) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      `${label} exceeds the story work result limit.`
    );
  }
  const seen = new Set<string>();
  const normalized = values.map((value) => {
    const next = mapValue(value);
    if (seen.has(next)) {
      throw new DomainValidationError(
        "DUPLICATE_REFERENCE",
        `${label} must not contain duplicate entries.`
      );
    }
    seen.add(next);
    return next;
  });
  return Object.freeze(normalized);
}

function normalizeStoryStructureCanvasFields(
  createdSceneIds: readonly SceneId[],
  canvasPlacedSceneId: SceneId | undefined,
  canvasObjectId: CanvasObjectId | undefined
): Readonly<{
  canvasPlacedSceneId?: SceneId;
  canvasObjectId?: CanvasObjectId;
}> {
  const hasScene = canvasPlacedSceneId !== undefined;
  const hasObject = canvasObjectId !== undefined;
  if (hasScene !== hasObject) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Structure Canvas placement requires both scene and object identifiers."
    );
  }
  if (
    hasScene &&
    !createdSceneIds.some((sceneIdValue) => sceneIdValue === canvasPlacedSceneId)
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Structure Canvas placement must reference one of the created scenes."
    );
  }
  return hasScene && hasObject
    ? Object.freeze({
        canvasPlacedSceneId,
        canvasObjectId: requireIdentifier(canvasObjectId, "Canvas object") as CanvasObjectId
      })
    : Object.freeze({});
}

function resultKey(result: StoryWorkResultReference): string {
  switch (result.kind) {
    case "project":
      return `project:${result.projectId}`;
    case "book":
      return `book:${result.bookId}`;
    case "story-structure":
      return `story-structure:${result.bookId}`;
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
    case "story-check":
      return `story-check:${result.proposalId}:${result.artifactVersion}`;
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
        "plan",
        "story-check",
        "story-structure"
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
        if (result.variantId !== undefined && result.revisionId === undefined) {
          throw new DomainValidationError(
            "UNKNOWN_REFERENCE",
            "A named scene variant result requires its immutable revision."
          );
        }
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
      case "story-check":
        requireIdentifier(result.sceneId, "Story check scene");
        next = Object.freeze({
          kind: result.kind,
          proposalId: requireIdentifier(result.proposalId, "Agent proposal") as AgentProposalId,
          artifactVersion: requirePositiveVersion(
            result.artifactVersion,
            "Story check artifact version"
          ),
          contentHash: instructionContentHash(
            requireContentHash(result.contentHash, "Story check content hash")
          ),
          sceneId: result.sceneId
        });
        break;
      case "story-structure": {
        const createdSceneIds = normalizeUniqueIds(
          result.createdSceneIds,
          "Structure created scene ids",
          (value) => requireIdentifier(value, "Scene") as SceneId,
          true
        );
        const canvasFields = normalizeStoryStructureCanvasFields(
          createdSceneIds,
          result.canvasPlacedSceneId,
          result.canvasObjectId
        );
        next = Object.freeze({
          kind: "story-structure" as const,
          bookId: requireIdentifier(result.bookId, "Book") as BookId,
          projectVersion: requirePositiveVersion(
            result.projectVersion,
            "Project result version"
          ),
          resolvedOperationIds: normalizeUniqueIds(
            result.resolvedOperationIds,
            "Structure resolved operation ids",
            requireStoryStructureOperationId,
            false
          ),
          createdSceneIds,
          ...canvasFields
        });
        break;
      }
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

function storyCheckResultMatchesReview(
  assignment: Readonly<{
    taskKind: StoryWorkTaskKind;
    destination: StoryWorkDestinationReference;
    currentArtifact?: StoryWorkArtifactPointer;
  }>,
  results: readonly StoryWorkResultReference[]
): boolean {
  if (
    assignment.taskKind !== "check" ||
    assignment.destination.kind !== "scene" ||
    assignment.destination.operation !== "assess" ||
    assignment.currentArtifact === undefined
  ) {
    return false;
  }
  const artifact = assignment.currentArtifact;
  const targetSceneId = assignment.destination.sceneId;
  return results.some(
    (result) =>
      result.kind === "story-check" &&
      result.sceneId === targetSceneId &&
      result.proposalId === artifact.proposalId &&
      result.artifactVersion === artifact.artifactVersion &&
      result.contentHash === artifact.contentHash
  );
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
        (result) =>
          (result.kind === "book" || result.kind === "story-structure") &&
          result.bookId === destination.bookId
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
      assignment.status === "reviewed" ||
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
  if (assignment.taskKind === "check" && assignment.status === "applied") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Check story work completes in reviewed state and never records a canonical apply."
    );
  }
  if (assignment.taskKind === "outline" && assignment.status === "applied") {
    if (assignment.results.length !== 1) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Outline apply requires exactly one story-structure result reference."
      );
    }
    if (assignment.results[0]?.kind !== "story-structure") {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Outline apply requires a story-structure result reference."
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
  if (assignment.status === "reviewed") {
    if (assignment.taskKind !== "check") {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Only check story work may complete in reviewed state."
      );
    }
    if (assignment.results.length !== 1) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "A reviewed check requires exactly one story-check result reference."
      );
    }
    if (!storyCheckResultMatchesReview(assignment, assignment.results)) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Reviewed check results must match the current findings artifact and assess destination."
      );
    }
  }
  if (
    assignment.status !== "applied" &&
    assignment.status !== "reviewed" &&
    assignment.results.length > 0
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Result references may be recorded only when work is applied or a check is reviewed."
    );
  }
  if (
    (assignment.applyIdempotencyKey === undefined) !==
    (assignment.applyRequestFingerprint === undefined)
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Story work apply idempotency key and fingerprint must be recorded together."
    );
  }
  if (
    assignment.applyIdempotencyKey !== undefined &&
    assignment.status !== "applied"
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Only applied story work may record its apply request identity."
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
  if (
    (input.applyIdempotencyKey === undefined) !==
    (input.applyRequestFingerprint === undefined)
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Story work apply idempotency key and fingerprint must be recorded together."
    );
  }
  const sources = normalizeSources(input.sources, projectId);
  const destination = normalizeDestination(input.destination, projectId, input.taskKind);
  validateCheckAssignmentDefinition(input.taskKind, sources, destination);
  validateOutlineAssignmentDefinition(input.taskKind, sources, destination);
  const origin = normalizeMcpStoryWorkOrigin(input.origin);
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
    sources,
    destination,
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
    ...(input.applyIdempotencyKey === undefined ||
    input.applyRequestFingerprint === undefined
      ? {}
      : {
          applyIdempotencyKey: requireIdentifier(
            input.applyIdempotencyKey,
            "Apply idempotency key"
          ),
          applyRequestFingerprint: instructionContentHash(
            requireContentHash(
              input.applyRequestFingerprint,
              "Apply request fingerprint"
            )
          )
        }),
    idempotencyKey: requireIdentifier(input.idempotencyKey, "Idempotency key"),
    createdAt,
    updatedAt,
    ...(origin === undefined ? {} : { origin })
  });
  validateStateShape(assignment);
  return assignment;
}

export function assertStoryWorkAssignmentOriginImmutable(
  previous: StoryWorkAssignment,
  next: StoryWorkAssignment
): void {
  if (!mcpStoryWorkOriginsEqual(previous.origin, next.origin)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Story work assignment MCP origin cannot change."
    );
  }
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
  applyRequest?: Readonly<{
    idempotencyKey: string;
    requestFingerprint: InstructionContentHash | string;
  }>;
  updatedAt: string;
}>): StoryWorkAssignment {
  const current = requireTransition(input.assignment, input.expectedVersion, [
    "awaiting-review"
  ]);
  if (current.taskKind === "check") {
    throw new StoryWorkAssignmentTransitionError(
      "Check story work completes through review, not canonical apply."
    );
  }
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
    results,
    ...(input.applyRequest === undefined
      ? {}
      : {
          applyIdempotencyKey: requireIdentifier(
            input.applyRequest.idempotencyKey,
            "Apply idempotency key"
          ),
          applyRequestFingerprint: instructionContentHash(
            requireContentHash(
              input.applyRequest.requestFingerprint,
              "Apply request fingerprint"
            )
          )
        })
  });
}

/**
 * Records advisory check completion. This is not a canonical apply and must not
 * record apply replay identity.
 */
export function recordReviewedStoryWorkAssignment(input: Readonly<{
  assignment: StoryWorkAssignment;
  expectedVersion: number;
  artifact: StoryWorkArtifactPointer;
  result: StoryWorkResultReference;
  updatedAt: string;
}>): StoryWorkAssignment {
  const current = requireTransition(input.assignment, input.expectedVersion, [
    "awaiting-review"
  ]);
  if (current.taskKind !== "check") {
    throw new StoryWorkAssignmentTransitionError(
      "Only check story work may complete in reviewed state."
    );
  }
  if (!sameArtifact(current.currentArtifact, input.artifact)) {
    throw new StoryWorkAssignmentTransitionError(
      "The reviewed findings artifact is no longer current."
    );
  }
  const results = normalizeResults([input.result], current.projectId);
  if (results.length !== 1 || results[0]?.kind !== "story-check") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Reviewed check completion requires one story-check result reference."
    );
  }
  if (!storyCheckResultMatchesReview({ ...current, currentArtifact: input.artifact }, results)) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "The story-check result must match the current findings artifact and assess destination."
    );
  }
  return nextAssignment(current, input.updatedAt, {
    status: "reviewed",
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

export function storyWorkApplyIdempotencyKey(value: string): string {
  return requireIdentifier(value, "Apply idempotency key");
}

export function storyWorkApplyRequestFingerprint(
  value: string
): InstructionContentHash {
  return instructionContentHash(
    requireContentHash(value, "Apply request fingerprint")
  );
}
