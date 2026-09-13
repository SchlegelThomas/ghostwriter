import {
  AgentProposalStateConflictError,
  AgentRunReceiptMismatchError,
  CharacterStoryWorkArtifactMismatchError,
  CanvasVersionConflictError,
  CharacterStoryWorkContextStaleError,
  CharacterStoryWorkGenerationConflictError,
  SceneStoryWorkArtifactMismatchError,
  SceneStoryWorkContextStaleError,
  SceneStoryWorkGenerationConflictError,
  StoryCheckArtifactMismatchError,
  StoryCheckFindingNotFoundError,
  StoryCheckGenerationConflictError,
  StoryStructureGenerationConflictError,
  StoryStructureStoryWorkArtifactMismatchError,
  StoryStructureStoryWorkContextConflictError,
  StoryStructureStoryWorkContextStaleError,
  StoryStructureStoryWorkSelectionConflictError,
  StoryWorkApplyIdempotencyConflictError,
  DomainValidationError,
  InvalidSceneVariantNameError,
  ProjectArchivedMutationError,
  ProjectVersionConflictError,
  SceneLeaseConflictError,
  SceneLeaseExpiredError,
  SceneVariantNameConflictError,
  SceneWorkingVersionConflictError,
  StoryWorkAssignmentNotFoundError,
  StoryWorkAssignmentTransitionError,
  StoryWorkAttemptTransitionError,
  StoryWorkRecoveryActionConflictError,
  StoryWorkRecoveryTransitionConflictError,
  StoryWorkCoordinationBindIdempotencyConflictError,
  StoryWorkCoordinationCreateIdempotencyConflictError,
  StoryWorkCoordinationDependencyConflictError,
  StoryWorkCoordinationTransitionError,
  accountId as toAccountId,
  agentProposalId,
  agentRunId,
  assembleCaptureReflectionResource,
  assembleProposalArtifactContextResource,
  assembleStorySceneResource,
  assembleStoryStructureResource,
  buildCurrentStoryAssessmentRevisionVector,
  canonicalJsonStringify,
  evaluateStoredStoryCheckPayloadFreshness,
  sceneDocumentPlainText,
  storyCheckAttemptRequestFingerprint,
  validateSceneDraftV1,
  validateStoryCheckFindingsV1,
  bookId,
  canvasObjectId,
  chapterId,
  characterStoryWorkAttemptRequestFingerprint,
  createCanvasScopeRef,
  sceneStoryWorkAttemptRequestFingerprint,
  storyStructureAttemptRequestFingerprint,
  storyStructureLoweringContextFromBook,
  storyStructureOperationId,
  createCharacterStoryWorkServices,
  createStoryWorkAssignment,
  createStoryWorkCoordination,
  previewStoryStructureProposal,
  STORY_STRUCTURE_SCHEMA_ID,
  validateStoryStructureProposalV1,
  instructionContentHash,
  projectId,
  sceneContentHash,
  sceneLeaseHolderId,
  storyWorkApplyIdempotencyKey,
  providerForAgentModel,
  requireProjectOwner,
  captureId,
  sceneId,
  sliceCaptureProviderText,
  storyContextFromProjectRecords,
  storyKnowledgeId,
  storyWorkAssignmentId,
  storyWorkAssignmentRequestFingerprint,
  storyWorkAttemptIdempotencyKey,
  storyWorkCoordinationId,
  storyWorkCoordinationSemanticFingerprint,
  storyWorkCoordinationStepId,
  projectStoryWorkCoordination,
  validateStoryWorkCoordinationChildAssignments,
  type StoryWorkCoordination,
  type StoryWorkCoordinationRepository,
  type StoryWorkCoordinationUnitOfWork,
  type StoryWorkCoordinationId,
  type StoryWorkCoordinationStepId,
  type StoryWorkCoordinationProjection,
  type AgentProposalRepository,
  type AgentRunRepository,
  type AsyncHashPort,
  type AccountId,
  type ApplySceneStoryWorkInput,
  type ApplyStructureStoryWorkInput,
  type BookId,
  type StoryStructureGenerationServices,
  type StoryStructureGenerationUnitOfWork,
  type StoryStructurePreviewKnownCheck,
  type StoryStructureProposalV1,
  type StoryStructureResourceInput,
  type StoryStructureStoryWorkReviewUnitOfWork,
  type StructureStoryWorkApplyUnitOfWork,
  type CharacterStoryWorkApplyUnitOfWork,
  type CharacterStoryWorkGenerationServices,
  type CharacterStoryWorkGenerationUnitOfWork,
  type CharacterStoryWorkResourceInput,
  type CharacterStoryWorkReviewUnitOfWork,
  type CharacterCreateV2,
  type Clock,
  type CaptureDocumentRepository,
  type CaptureDocumentHead,
  type ContextReceiptRepository,
  type IdGenerator,
  type ProjectRecords,
  type ProjectRepository,
  type SceneDocumentRepository,
  type SceneDocumentHead,
  type Scene,
  type SceneId,
  type SceneDraftV1,
  type SceneStoryWorkApplyUnitOfWork,
  type SceneStoryWorkGenerationServices,
  type SceneStoryWorkGenerationUnitOfWork,
  type SceneStoryWorkResourceInput,
  type SceneStoryWorkReviewUnitOfWork,
  type StoryCheckGenerationServices,
  type StoryCheckGenerationUnitOfWork,
  type StoryCheckResourceInput,
  type StoryCheckReviewUnitOfWork,
  type StoryCheckTargetBindingInput,
  type StoryContextScope,
  type StoryContextProjection,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment,
  type StoryWorkAssignmentRepository,
  type StoryWorkAttemptRepository,
  type StoryWorkRecoveryUnitOfWork,
  type StoryWorkSourceReference,
  type AgentRun,
  type StoryWorkAttempt,
  grantAllowsAssignment,
  grantAllowsCoordination,
  grantOriginMatchesRecord,
  McpGrantResourceDeniedError,
  requireGrantAllowsAssignment,
  requireGrantAllowsBook,
  requireGrantAllowsCapture,
  requireGrantAllowsProjectStructureRead,
  requireGrantAllowsScene,
  STORY_WORK_ASSIGNMENT_LIST_MAX,
  STORY_WORK_COORDINATION_LIST_MAX,
  type McpGrantRecord,
  type McpStoryWorkOrigin
} from "@ghostwriter/core";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Context, Hono } from "hono";
import type { AuthenticatedSession } from "./auth.js";
import { providerAgentErrorStatusAndBody } from "./provider-agent-api.js";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import {
  applyCharacterStoryWorkRequestSchema,
  applySceneStoryWorkRequestSchema,
  applyStructureStoryWorkRequestSchema,
  completeCheckStoryWorkReviewRequestSchema,
  editCharacterStoryWorkReviewRequestSchema,
  editSceneStoryWorkReviewRequestSchema,
  editStructureStoryWorkReviewRequestSchema,
  generateStoryWorkRequestSchema,
  openCharacterStoryWorkReviewRequestSchema,
  openStoryWorkReviewRequestSchema,
  previewStructureStoryWorkRequestSchema,
  recoverActiveStoryWorkAttemptRequestSchema,
  continueStoryWorkCoordinationStepRequestSchema,
  createStoryWorkCoordinationRequestSchema,
  resolveCheckStoryWorkFindingRequestSchema,
  storyWorkAssignmentListQuerySchema,
  submitStoryWorkRequestSchema,
  type CreateStoryWorkCoordinationRequest,
  type ApplySceneStoryWorkRequest,
  type ApplyStructureStoryWorkRequest,
  type GenerateStoryWorkRequest,
  type SubmitStoryWorkRequest,
  type PreviewStructureStoryWorkRequest,
  type ContinueStoryWorkCoordinationStepRequest
} from "./story-work-api-contract.js";
import { resolveCheckProposalDraftFreshnessContentHash } from "./story-work-check-freshness.js";
import { parseJsonRequest } from "./api-contract.js";

type StoryWorkEnvironment = {
  Variables: { authSession: AuthenticatedSession };
};

const MAX_KNOWN_STRUCTURE_PREVIEW_CHECKS = 32;

export type StoryWorkApiRuntime = Readonly<{
  projects: ProjectRepository;
  sceneDocuments: SceneDocumentRepository;
  captureDocuments: CaptureDocumentRepository;
  assignments: StoryWorkAssignmentRepository;
  attempts: StoryWorkAttemptRepository;
  proposals: AgentProposalRepository;
  runs: AgentRunRepository;
  receipts: ContextReceiptRepository;
  characterGeneration: CharacterStoryWorkGenerationServices;
  characterGenerationReplay: Pick<CharacterStoryWorkGenerationUnitOfWork, "findReplay">;
  characterReview: CharacterStoryWorkReviewUnitOfWork;
  sceneGeneration: SceneStoryWorkGenerationServices;
  sceneGenerationReplay: Pick<SceneStoryWorkGenerationUnitOfWork, "findReplay">;
  sceneReview: SceneStoryWorkReviewUnitOfWork;
  checkGeneration: StoryCheckGenerationServices;
  checkGenerationReplay: Pick<StoryCheckGenerationUnitOfWork, "findReplay">;
  checkReview: StoryCheckReviewUnitOfWork;
  structureGeneration: StoryStructureGenerationServices;
  structureGenerationReplay: Pick<StoryStructureGenerationUnitOfWork, "findReplay">;
  structureReview: StoryStructureStoryWorkReviewUnitOfWork;
  structureApply: StructureStoryWorkApplyUnitOfWork;
  apply: CharacterStoryWorkApplyUnitOfWork;
  sceneApply: SceneStoryWorkApplyUnitOfWork;
  recovery: StoryWorkRecoveryUnitOfWork;
  coordinations: StoryWorkCoordinationRepository;
  coordinationUnitOfWork: StoryWorkCoordinationUnitOfWork;
  hashPort: AsyncHashPort;
  ids: IdGenerator;
  clock: Clock;
  createAssignmentId(): string;
  createCoordinationId(): string;
  createCoordinationStepId(): string;
}>;

export type StoryWorkCoordinationChildAssignmentSummary = Readonly<{
  stepId: StoryWorkCoordinationStepId;
  assignmentId: ReturnType<typeof storyWorkAssignmentId>;
  taskKind: StoryWorkAssignment["taskKind"];
  status: StoryWorkAssignment["status"];
}>;

export type StoryWorkCoordinationDetailResponse = Readonly<{
  coordination: StoryWorkCoordination;
  projection: StoryWorkCoordinationProjection;
  rootAssignment: StoryWorkAssignment;
  childAssignmentSummaries: readonly StoryWorkCoordinationChildAssignmentSummary[];
}>;

const STORY_WORK_RECOVERY_ACTIONS = Object.freeze(["cancel", "mark-interrupted"] as const);

export type StoryWorkRecoveryProjection = Readonly<
  | {
      status: "active-or-interrupted";
      runId: ReturnType<typeof agentRunId>;
      expectedAssignmentVersion: number;
      actions: typeof STORY_WORK_RECOVERY_ACTIONS;
      message: string;
    }
  | {
      status: "refresh-required";
      runId?: ReturnType<typeof agentRunId>;
      expectedAssignmentVersion: number;
      actions: typeof STORY_WORK_RECOVERY_ACTIONS;
      message: string;
    }
>;

export type StoryWorkRouteDependencies = Readonly<{
  storyWork: StoryWorkApiRuntime;
  agentProvider: Pick<AgentProviderRuntime, "createCompletionProviderForModel">;
}>;

type Dependencies = StoryWorkRouteDependencies;

class StoryCheckReviewStaleError extends Error {
  readonly code = "STORY_CHECK_STALE" as const;

  constructor(
    message = "Check findings are outdated; review sources before completing this check."
  ) {
    super(message);
    this.name = "StoryCheckReviewStaleError";
  }
}

function invalidRequestResponse(
  context: Context<StoryWorkEnvironment>,
  parsed: {
    success: false;
    code: string;
    issues?: readonly { path: string; message: string }[];
  }
) {
  return context.json(
    {
      error: "Invalid request.",
      code: parsed.code,
      ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
    },
    parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
  );
}

export function storyWorkErrorStatusAndBody(error: unknown):
  | Readonly<{
      status: ContentfulStatusCode;
      body: Readonly<{ error: string; code: string }>;
    }>
  | undefined {
  if (error instanceof StoryWorkAssignmentNotFoundError) {
    return {
      status: 404,
      body: { error: "Story work assignment not found.", code: error.code }
    };
  }
  if (error instanceof StoryWorkRecoveryTransitionConflictError) {
    return {
      status: 409,
      body: { error: error.message, code: error.code }
    };
  }
  if (error instanceof StoryWorkRecoveryActionConflictError) {
    return {
      status: 409,
      body: { error: error.message, code: error.code }
    };
  }
  if (
    error instanceof StoryWorkCoordinationCreateIdempotencyConflictError ||
    error instanceof StoryWorkCoordinationBindIdempotencyConflictError ||
    error instanceof StoryWorkCoordinationDependencyConflictError ||
    error instanceof StoryWorkCoordinationTransitionError
  ) {
    return {
      status: 409,
      body: { error: error.message, code: error.code }
    };
  }
  if (
    error instanceof StoryWorkAssignmentTransitionError ||
    error instanceof CharacterStoryWorkGenerationConflictError ||
    error instanceof CharacterStoryWorkArtifactMismatchError ||
    error instanceof SceneStoryWorkGenerationConflictError ||
    error instanceof SceneStoryWorkArtifactMismatchError ||
    error instanceof CharacterStoryWorkContextStaleError ||
    error instanceof SceneStoryWorkContextStaleError ||
    error instanceof StoryCheckGenerationConflictError ||
    error instanceof StoryCheckArtifactMismatchError ||
    error instanceof StoryStructureGenerationConflictError ||
    error instanceof StoryStructureStoryWorkArtifactMismatchError ||
    error instanceof StoryStructureStoryWorkContextStaleError ||
    error instanceof StoryStructureStoryWorkContextConflictError ||
    error instanceof StoryStructureStoryWorkSelectionConflictError ||
    error instanceof StoryCheckReviewStaleError ||
    error instanceof StoryWorkApplyIdempotencyConflictError ||
    error instanceof AgentProposalStateConflictError ||
    error instanceof AgentRunReceiptMismatchError ||
    error instanceof StoryWorkAttemptTransitionError ||
    error instanceof ProjectVersionConflictError ||
    error instanceof ProjectArchivedMutationError ||
    error instanceof CanvasVersionConflictError ||
    error instanceof SceneWorkingVersionConflictError ||
    error instanceof SceneLeaseConflictError ||
    error instanceof SceneLeaseExpiredError ||
    error instanceof SceneVariantNameConflictError
  ) {
    return {
      status: 409,
      body: {
        error: error.message,
        code:
          error instanceof ProjectVersionConflictError
            ? "PROJECT_VERSION_CONFLICT"
            : error instanceof CanvasVersionConflictError
              ? "CANVAS_VERSION_CONFLICT"
              : "code" in error && typeof error.code === "string"
                ? error.code
                : "STORY_WORK_CONFLICT"
      }
    };
  }
  if (error instanceof StoryCheckFindingNotFoundError) {
    return {
      status: 404,
      body: { error: error.message, code: error.code }
    };
  }
  if (
    error instanceof DomainValidationError ||
    error instanceof InvalidSceneVariantNameError
  ) {
    const code =
      error instanceof DomainValidationError
        ? error.code
        : "INVALID_SCENE_VARIANT_NAME";
    return { status: 422, body: { error: error.message, code } };
  }
  return providerAgentErrorStatusAndBody(error);
}

async function loadProjectRecords(
  projects: ProjectRepository,
  id: ReturnType<typeof projectId>
): Promise<ProjectRecords | undefined> {
  const [project, books, scenes, storyKnowledge, editions] = await Promise.all([
    projects.getProject(id),
    projects.listBooks(id),
    projects.listScenes(id),
    projects.listStoryKnowledge(id),
    projects.listEditions(id)
  ]);
  return project === undefined
    ? undefined
    : { project, books, scenes, storyKnowledge, editions };
}

async function requireOwnedRecords(
  runtime: StoryWorkApiRuntime,
  accountId: AccountId,
  id: ReturnType<typeof projectId>
): Promise<ProjectRecords> {
  const membership = await runtime.projects.getProjectMembership(id, accountId);
  try {
    requireProjectOwner(id, membership);
  } catch {
    throw new StoryWorkAssignmentNotFoundError();
  }
  const records = await loadProjectRecords(runtime.projects, id);
  if (records === undefined) throw new StoryWorkAssignmentNotFoundError();
  return records;
}

function selectedScope(
  records: ProjectRecords,
  selectedSceneIds: readonly SceneId[]
): StoryContextScope {
  if (selectedSceneIds.length === 0) return Object.freeze({ kind: "project" });
  if (selectedSceneIds.length === 1) {
    return Object.freeze({ kind: "scene", sceneId: selectedSceneIds[0]! });
  }
  const chapterIds = new Set<string>();
  for (const book of records.books) {
    for (const part of book.manuscript.parts) {
      for (const chapter of part.chapters) {
        if (chapter.sceneIds.some((id) => selectedSceneIds.includes(id))) {
          chapterIds.add(chapter.id);
        }
      }
    }
  }
  return chapterIds.size === 1
    ? Object.freeze({ kind: "chapter", chapterId: chapterId([...chapterIds][0]!) })
    : Object.freeze({ kind: "project" });
}

function assignmentSources(
  records: ProjectRecords,
  selectedSceneIds: readonly SceneId[],
  sceneHeads: ReadonlyMap<SceneId, SceneDocumentHead>,
  captureHead?: CaptureDocumentHead
): readonly StoryWorkSourceReference[] {
  const scope = selectedScope(records, selectedSceneIds);
  const sceneSource = (id: SceneId): StoryWorkSourceReference => {
    const head = sceneHeads.get(id);
    if (head === undefined || head.projectId !== records.project.id) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Open each selected scene once before submitting it as story context."
      );
    }
    return {
      kind: "scene",
      sceneId: id,
      projectVersion: records.project.version,
      workingVersion: head.workingVersion,
      contentHash: head.contentHash
    };
  };
  const scopeSource: StoryWorkSourceReference = scope.kind === "project"
    ? { kind: "project", projectId: records.project.id, projectVersion: records.project.version }
    : scope.kind === "chapter"
      ? { kind: "chapter", chapterId: scope.chapterId, projectVersion: records.project.version }
      : sceneSource(scope.sceneId);
  const explicitScenes = selectedSceneIds
    .filter((id) => scope.kind !== "scene" || id !== scope.sceneId)
    .map(sceneSource);
  const captureSource: readonly StoryWorkSourceReference[] =
    captureHead === undefined
      ? []
      : [{
          kind: "capture",
          captureId: captureHead.captureId,
          workingVersion: captureHead.workingVersion,
          contentHash: captureHead.contentHash
        }];
  return Object.freeze([scopeSource, ...explicitScenes, ...captureSource]);
}

function validateSelectedScenes(
  records: ProjectRecords,
  selectedSceneIds: readonly SceneId[]
): void {
  for (const id of selectedSceneIds) {
    const scene = records.scenes.find((candidate) => candidate.id === id);
    const book = scene === undefined
      ? undefined
      : records.books.find((candidate) => candidate.id === scene.bookId);
    if (
      scene === undefined ||
      scene.archivedAt !== undefined ||
      book === undefined ||
      book.archivedAt !== undefined
    ) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Story work assignments require active scenes in the current project."
      );
    }
  }
}

function requireActiveTargetScene(
  records: ProjectRecords,
  targetSceneId: SceneId
): void {
  validateSelectedScenes(records, [targetSceneId]);
}

function requireActiveTargetBook(records: ProjectRecords, targetBookId: BookId): void {
  const book = records.books.find((candidate) => candidate.id === targetBookId);
  if (
    book === undefined ||
    book.projectId !== records.project.id ||
    book.archivedAt !== undefined
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Outline story work requires an active book in the current project."
    );
  }
}

function outlineAssignmentSources(
  records: ProjectRecords,
  targetBookId: BookId,
  selectedSceneIds: readonly SceneId[],
  sceneHeads: ReadonlyMap<SceneId, SceneDocumentHead>
): readonly StoryWorkSourceReference[] {
  requireActiveTargetBook(records, targetBookId);
  const sceneSource = (id: SceneId): StoryWorkSourceReference => {
    const head = sceneHeads.get(id);
    if (head === undefined || head.projectId !== records.project.id) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Open each selected scene once before submitting it as story context."
      );
    }
    return {
      kind: "scene",
      sceneId: id,
      projectVersion: records.project.version,
      workingVersion: head.workingVersion,
      contentHash: head.contentHash
    };
  };
  const bookSource: StoryWorkSourceReference = {
    kind: "book",
    bookId: targetBookId,
    projectVersion: records.project.version
  };
  return Object.freeze([bookSource, ...selectedSceneIds.map(sceneSource)]);
}

function isActiveCanonicalScene(
  records: ProjectRecords,
  targetSceneId: SceneId
): boolean {
  const scene = records.scenes.find((candidate) => candidate.id === targetSceneId);
  if (scene === undefined || scene.archivedAt !== undefined) {
    return false;
  }
  const book = records.books.find((candidate) => candidate.id === scene.bookId);
  return book !== undefined && book.archivedAt === undefined;
}

const NONCANONICAL_PROPOSAL_COVERAGE_SCENE_HEAD = Object.freeze({
  workingVersion: 1,
  contentHash: sceneContentHash("0".repeat(64))
});

function locateChapterForScene(
  records: ProjectRecords,
  targetSceneId: SceneId
): Readonly<{ id: ReturnType<typeof chapterId>; summary?: string }> | undefined {
  const scene = records.scenes.find((candidate) => candidate.id === targetSceneId);
  if (scene === undefined) return undefined;
  for (const book of records.books) {
    for (const part of book.manuscript.parts) {
      for (const chapter of part.chapters) {
        if (chapter.sceneIds.includes(targetSceneId)) {
          return Object.freeze({ id: chapter.id, summary: chapter.summary });
        }
      }
    }
  }
  return undefined;
}

function targetSceneIntent(
  records: ProjectRecords,
  targetSceneId: SceneId
): Pick<Scene, "id" | "summary" | "sketch"> | undefined {
  const scene = records.scenes.find((candidate) => candidate.id === targetSceneId);
  if (scene === undefined) return undefined;
  return Object.freeze({
    id: scene.id,
    ...(scene.summary === undefined ? {} : { summary: scene.summary }),
    ...(scene.sketch === undefined ? {} : { sketch: scene.sketch })
  });
}

async function resolveCheckProposalSource(
  runtime: StoryWorkApiRuntime,
  records: ProjectRecords,
  owner: AccountId,
  ownedProjectId: ReturnType<typeof projectId>,
  targetSceneId: SceneId,
  sourceAssignmentId: ReturnType<typeof storyWorkAssignmentId>,
  sourceArtifact: StoryWorkArtifactPointer
): Promise<
  Readonly<{
    assignmentId: ReturnType<typeof storyWorkAssignmentId>;
    proposalId: ReturnType<typeof agentProposalId>;
    sceneId: SceneId;
    artifactVersion: number;
    contentHash: ReturnType<typeof instructionContentHash>;
    draft: SceneDraftV1;
    providerText: string;
  }>
> {
  const sourceAssignment = await runtime.assignments.get({
    accountId: owner,
    projectId: ownedProjectId,
    assignmentId: sourceAssignmentId
  });
  if (sourceAssignment === undefined) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "The selected proposal assignment is not available in this project."
    );
  }
  if (
    sourceAssignment.taskKind !== "scene" &&
    sourceAssignment.taskKind !== "revise"
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Check proposal sources must come from scene or revise story work."
    );
  }
  if (sourceAssignment.destination.kind !== "scene") {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "The selected proposal must target a scene assess destination."
    );
  }
  if (sourceAssignment.destination.sceneId !== targetSceneId) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "The selected proposal must target the same scene as this check."
    );
  }
  if (sourceAssignment.status === "applied") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Applied story work proposals cannot be checked as reviewable drafts."
    );
  }
  if (sourceAssignment.destination.operation === "update") {
    requireActiveTargetScene(records, targetSceneId);
  } else if (sourceAssignment.destination.operation === "create") {
    if (isActiveCanonicalScene(records, targetSceneId)) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "New-scene proposal checks require a reserved target that is not yet an active manuscript scene."
      );
    }
  } else {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Check proposal sources must come from scene or revise story work."
    );
  }
  if (
    sourceAssignment.currentArtifact === undefined ||
    sourceAssignment.currentArtifact.proposalId !== sourceArtifact.proposalId ||
    sourceAssignment.currentArtifact.artifactVersion !== sourceArtifact.artifactVersion ||
    sourceAssignment.currentArtifact.contentHash !== sourceArtifact.contentHash
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "The selected proposal artifact is no longer current for its assignment."
    );
  }
  const proposal = await runtime.proposals.get(sourceArtifact.proposalId);
  if (
    proposal === undefined ||
    proposal.projectId !== ownedProjectId ||
    proposal.outputSchemaId !== "scene-draft-v1" ||
    proposal.contentHash !== sourceArtifact.contentHash
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "The selected scene draft proposal is not available."
    );
  }
  const draft = validateSceneDraftV1(proposal.payload);
  return Object.freeze({
    assignmentId: sourceAssignmentId,
    proposalId: sourceArtifact.proposalId,
    sceneId: targetSceneId,
    artifactVersion: sourceArtifact.artifactVersion,
    contentHash: sourceArtifact.contentHash,
    draft,
    providerText: draft.prose
  });
}

async function checkAssignmentSources(
  runtime: StoryWorkApiRuntime,
  records: ProjectRecords,
  input: Readonly<{
    checkMode: "applied-scene" | "proposal-draft";
    targetSceneId: SceneId;
    surroundingSceneIds: readonly SceneId[];
    proposalSource?: Awaited<ReturnType<typeof resolveCheckProposalSource>>;
  }>,
  sceneHeads: ReadonlyMap<SceneId, SceneDocumentHead>
): Promise<readonly StoryWorkSourceReference[]> {
  const scopeSceneIds =
    input.checkMode === "applied-scene"
      ? [...new Set([input.targetSceneId, ...input.surroundingSceneIds])]
      : input.surroundingSceneIds;
  const scope = selectedScope(records, scopeSceneIds);
  const sceneSource = (id: SceneId): StoryWorkSourceReference => {
    const head = sceneHeads.get(id);
    if (head === undefined || head.projectId !== records.project.id) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Open each selected scene once before submitting it as story context."
      );
    }
    return {
      kind: "scene",
      sceneId: id,
      projectVersion: records.project.version,
      workingVersion: head.workingVersion,
      contentHash: head.contentHash
    };
  };
  const scopeSource: StoryWorkSourceReference =
    scope.kind === "project"
      ? {
          kind: "project",
          projectId: records.project.id,
          projectVersion: records.project.version
        }
      : scope.kind === "chapter"
        ? {
            kind: "chapter",
            chapterId: scope.chapterId,
            projectVersion: records.project.version
          }
        : sceneSource(scope.sceneId);
  const explicitScenes =
    input.checkMode === "applied-scene"
      ? [...new Set([input.targetSceneId, ...input.surroundingSceneIds])]
          .filter((id) => scope.kind !== "scene" || id !== scope.sceneId)
          .map(sceneSource)
      : input.surroundingSceneIds
          .filter((id) => scope.kind !== "scene" || id !== scope.sceneId)
          .map(sceneSource);
  const proposalSource: readonly StoryWorkSourceReference[] =
    input.proposalSource === undefined
      ? []
      : [
          {
            kind: "proposal-artifact",
            assignmentId: input.proposalSource.assignmentId,
            proposalId: input.proposalSource.proposalId,
            sceneId: input.proposalSource.sceneId,
            artifactVersion: input.proposalSource.artifactVersion,
            contentHash: input.proposalSource.contentHash
          }
        ];
  return Object.freeze([scopeSource, ...explicitScenes, ...proposalSource]);
}

async function revalidateStoryWorkSources(
  runtime: StoryWorkApiRuntime,
  assignment: StoryWorkAssignment,
  records: ProjectRecords
): Promise<void> {
  const sceneIds = assignment.sources.flatMap((source) =>
    source.kind === "scene" ? [source.sceneId] : []
  );
  const heads =
    sceneIds.length === 0
      ? new Map<SceneId, SceneDocumentHead>()
      : await runtime.sceneDocuments.getHeads(sceneIds);
  for (const source of assignment.sources) {
    switch (source.kind) {
      case "project":
        if (
          source.projectId !== records.project.id ||
          source.projectVersion !== records.project.version
        ) {
          throw new SceneStoryWorkContextStaleError();
        }
        break;
      case "chapter": {
        const located = records.books.some((book) =>
          book.manuscript.parts.some((part) =>
            part.chapters.some((chapter) => chapter.id === source.chapterId)
          )
        );
        if (!located || source.projectVersion !== records.project.version) {
          throw new DomainValidationError(
            "UNKNOWN_REFERENCE",
            "The selected chapter source is no longer available."
          );
        }
        break;
      }
      case "book":
        if (
          !records.books.some((book) => book.id === source.bookId) ||
          source.projectVersion !== records.project.version
        ) {
          throw new DomainValidationError(
            "UNKNOWN_REFERENCE",
            "The selected book source is no longer available."
          );
        }
        break;
      case "scene": {
        const head = heads.get(source.sceneId);
        if (
          head === undefined ||
          head.projectId !== assignment.projectId ||
          source.workingVersion === undefined ||
          source.contentHash === undefined ||
          head.workingVersion !== source.workingVersion ||
          head.contentHash !== source.contentHash ||
          source.projectVersion !== records.project.version
        ) {
          throw new SceneStoryWorkContextStaleError();
        }
        break;
      }
      case "proposal-artifact": {
        const sourceAssignment = await runtime.assignments.get({
          accountId: assignment.initiatorAccountId,
          projectId: assignment.projectId,
          assignmentId: source.assignmentId
        });
        if (
          sourceAssignment === undefined ||
          sourceAssignment.currentArtifact === undefined ||
          sourceAssignment.currentArtifact.proposalId !== source.proposalId ||
          sourceAssignment.currentArtifact.artifactVersion !== source.artifactVersion
        ) {
          throw new SceneStoryWorkContextStaleError();
        }
        const proposal = await runtime.proposals.get(source.proposalId);
        if (
          proposal === undefined ||
          proposal.projectId !== assignment.projectId ||
          proposal.outputSchemaId !== "scene-draft-v1" ||
          proposal.contentHash !== sourceAssignment.currentArtifact.contentHash
        ) {
          throw new SceneStoryWorkContextStaleError();
        }
        if (source.contentHash !== sourceAssignment.currentArtifact.contentHash) {
          throw new SceneStoryWorkContextStaleError();
        }
        break;
      }
      default:
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "This story work assignment includes an unsupported source for regeneration."
        );
    }
  }
}

async function trustedCheckGenerationContext(
  runtime: StoryWorkApiRuntime,
  assignment: StoryWorkAssignment,
  records: ProjectRecords
): Promise<
  Readonly<{
    storyContext: StoryContextProjection;
    target: StoryCheckTargetBindingInput;
    resources: readonly StoryCheckResourceInput[];
    targetSceneIntent?: ReturnType<typeof targetSceneIntent>;
    chapterObjective?: Readonly<{ id: ReturnType<typeof chapterId>; summary?: string }>;
  }>
> {
  await revalidateStoryWorkSources(runtime, assignment, records);
  const assessSceneId =
    assignment.destination.kind === "scene"
      ? assignment.destination.sceneId
      : undefined;
  if (assessSceneId === undefined) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Check story work requires an assess destination scene."
    );
  }
  const proposalSource = assignment.sources.find(
    (source): source is Extract<StoryWorkSourceReference, { kind: "proposal-artifact" }> =>
      source.kind === "proposal-artifact"
  );
  const scopeSource = assignment.sources.find(
    (source) =>
      source.kind === "project" ||
      source.kind === "chapter" ||
      source.kind === "scene" ||
      source.kind === "book"
  );
  const scope: StoryContextScope =
    scopeSource?.kind === "chapter"
      ? { kind: "chapter", chapterId: scopeSource.chapterId }
      : scopeSource?.kind === "scene"
        ? { kind: "scene", sceneId: scopeSource.sceneId }
        : { kind: "project" };
  const storyContext = storyContextFromProjectRecords(records, { scope });
  const structure = await assembleStoryStructureResource({
    projectId: assignment.projectId,
    context: storyContext,
    inclusionReason: "Canonical story structure selected for this story check.",
    hashPort: runtime.hashPort
  });
  const sceneSourceIds = assignment.sources.flatMap((source) =>
    source.kind === "scene" ? [source.sceneId] : []
  );
  const heads = await runtime.sceneDocuments.getHeads(sceneSourceIds);
  const sceneResources: StoryCheckResourceInput[] = [];
  for (const id of sceneSourceIds) {
    const head = heads.get(id);
    if (head === undefined) continue;
    const assembled = await assembleStorySceneResource({
      projectId: assignment.projectId,
      sceneId: id,
      head,
      inclusionReason:
        id === assessSceneId
          ? "Exact assess target scene head."
          : "Writer-selected surrounding scene.",
      hashPort: runtime.hashPort
    });
    sceneResources.push(
      Object.freeze({
        providerText: sceneDocumentPlainText(head.document),
        resource: assembled.resource
      })
    );
  }
  const resources: StoryCheckResourceInput[] = [structure, ...sceneResources];
  let target: StoryCheckTargetBindingInput;
  if (proposalSource === undefined) {
    const targetHead = heads.get(assessSceneId);
    if (targetHead === undefined) {
      throw new SceneStoryWorkContextStaleError();
    }
    target = Object.freeze({ mode: "applied-scene", head: targetHead });
  } else {
    const proposal = await runtime.proposals.get(proposalSource.proposalId);
    if (proposal === undefined) {
      throw new SceneStoryWorkContextStaleError();
    }
    const draft = validateSceneDraftV1(proposal.payload);
    const assessHeads = await runtime.sceneDocuments.getHeads([assessSceneId]);
    const targetHead = assessHeads.get(assessSceneId);
    const coverageSceneHead =
      targetHead === undefined
        ? NONCANONICAL_PROPOSAL_COVERAGE_SCENE_HEAD
        : Object.freeze({
            workingVersion: targetHead.workingVersion,
            contentHash: targetHead.contentHash
          });
    const proposalResource = await assembleProposalArtifactContextResource({
      projectId: assignment.projectId,
      assignmentId: proposalSource.assignmentId,
      proposalId: proposalSource.proposalId,
      sceneId: assessSceneId,
      artifactVersion: proposalSource.artifactVersion,
      contentHash: proposalSource.contentHash,
      draft,
      providerText: draft.prose,
      fullTextCharCount: draft.prose.length,
      truncated: false,
      inclusionReason: "Exact scene draft under review.",
      hashPort: runtime.hashPort
    });
    resources.unshift(proposalResource);
    target = Object.freeze({
      mode: "proposal-draft",
      draft,
      providerText: draft.prose,
      fullTextCharCount: draft.prose.length,
      truncated: false,
      artifactContentHash: proposalSource.contentHash,
      coverageSceneHead
    });
  }
  const assessIsCanonicalForIntent =
    proposalSource === undefined
      ? true
      : isActiveCanonicalScene(records, assessSceneId);
  const chapter =
    assessIsCanonicalForIntent
      ? locateChapterForScene(records, assessSceneId)
      : undefined;
  const intent =
    assessIsCanonicalForIntent
      ? targetSceneIntent(records, assessSceneId)
      : undefined;
  return Object.freeze({
    storyContext,
    target,
    resources: Object.freeze(resources),
    ...(intent === undefined ? {} : { targetSceneIntent: intent }),
    ...(chapter === undefined
      ? {}
      : {
          chapterObjective: Object.freeze({
            id: chapter.id,
            ...(chapter.summary === undefined ? {} : { summary: chapter.summary })
          })
        })
  });
}

async function checkFreshnessForProposal(
  runtime: StoryWorkApiRuntime,
  assignment: StoryWorkAssignment,
  records: ProjectRecords,
  proposalPayload: unknown
): Promise<ReturnType<typeof evaluateStoredStoryCheckPayloadFreshness>> {
  const payload = validateStoryCheckFindingsV1(proposalPayload);
  const proseSceneIds = payload.revisionVector.dependencies.flatMap((dependency) =>
    dependency.kind === "scene-prose" ? [dependency.sceneId] : []
  );
  const heads = await runtime.sceneDocuments.getHeads(proseSceneIds);
  const currentRevisionVector = await buildCurrentStoryAssessmentRevisionVector({
    assessed: payload.revisionVector,
    records,
    sceneDocumentHeads: heads,
    hashPort: runtime.hashPort
  });
  let currentProposalDraftContentHash: ReturnType<typeof instructionContentHash> | undefined;
  if (payload.target.mode === "proposal-draft") {
    const proposalSource = assignment.sources.find(
      (source): source is Extract<StoryWorkSourceReference, { kind: "proposal-artifact" }> =>
        source.kind === "proposal-artifact"
    );
    if (proposalSource !== undefined) {
      currentProposalDraftContentHash =
        await resolveCheckProposalDraftFreshnessContentHash(
          { assignments: runtime.assignments, proposals: runtime.proposals },
          {
            accountId: assignment.initiatorAccountId,
            projectId: assignment.projectId,
            proposalSource
          }
        );
    }
  }
  return evaluateStoredStoryCheckPayloadFreshness({
    storedPayload: payload,
    currentRevisionVector,
    ...(currentProposalDraftContentHash === undefined
      ? {}
      : { currentProposalDraftContentHash })
  });
}

export type StoryWorkAssignmentDetailResponse = Readonly<{
  assignment: StoryWorkAssignment;
  proposal?: NonNullable<Awaited<ReturnType<StoryWorkApiRuntime["proposals"]["get"]>>>;
  run?: AgentRun;
  receipt?: NonNullable<Awaited<ReturnType<StoryWorkApiRuntime["receipts"]["get"]>>>;
  attempt?: StoryWorkAttempt;
  recovery?: StoryWorkRecoveryProjection;
  checkFreshness?: Awaited<ReturnType<typeof checkFreshnessForProposal>>;
}>;

export const STORY_WORK_BRIDGE_RECOVERY_MESSAGE =
  "A first-party writer can refresh or manage this run." as const;

export type StoryWorkBridgeRecoveryProjection = Readonly<
  | {
      status: "active-or-interrupted";
      runId: ReturnType<typeof agentRunId>;
      expectedAssignmentVersion: number;
      message: typeof STORY_WORK_BRIDGE_RECOVERY_MESSAGE;
    }
  | {
      status: "refresh-required";
      runId?: ReturnType<typeof agentRunId>;
      expectedAssignmentVersion: number;
      message: typeof STORY_WORK_BRIDGE_RECOVERY_MESSAGE;
    }
>;

export type StoryWorkAssignmentBridgeDetailResponse = Readonly<
  Omit<StoryWorkAssignmentDetailResponse, "recovery"> & {
    recovery?: StoryWorkBridgeRecoveryProjection;
  }
>;

export function toStoryWorkBridgeRecoveryProjection(
  recovery: StoryWorkRecoveryProjection
): StoryWorkBridgeRecoveryProjection {
  if (recovery.status === "active-or-interrupted") {
    return Object.freeze({
      status: recovery.status,
      runId: recovery.runId,
      expectedAssignmentVersion: recovery.expectedAssignmentVersion,
      message: STORY_WORK_BRIDGE_RECOVERY_MESSAGE
    });
  }
  return Object.freeze({
    status: recovery.status,
    ...(recovery.runId === undefined ? {} : { runId: recovery.runId }),
    expectedAssignmentVersion: recovery.expectedAssignmentVersion,
    message: STORY_WORK_BRIDGE_RECOVERY_MESSAGE
  });
}

export function sanitizeStoryWorkAssignmentDetailForBridge(
  detail: StoryWorkAssignmentDetailResponse
): StoryWorkAssignmentBridgeDetailResponse {
  const { recovery, ...rest } = detail;
  return Object.freeze({
    ...rest,
    ...(recovery === undefined
      ? {}
      : { recovery: toStoryWorkBridgeRecoveryProjection(recovery) })
  });
}

export async function buildStoryWorkAssignmentDetailResponse(
  runtime: StoryWorkApiRuntime,
  account: AccountId,
  ownedProjectId: ReturnType<typeof projectId>,
  assignment: StoryWorkAssignment
): Promise<StoryWorkAssignmentDetailResponse> {
  if (
    assignment.projectId !== ownedProjectId ||
    assignment.initiatorAccountId !== account
  ) {
    throw new StoryWorkAssignmentNotFoundError();
  }
  const records = await loadProjectRecords(runtime.projects, ownedProjectId);
  if (records === undefined) throw new StoryWorkAssignmentNotFoundError();
  const proposal =
    assignment.currentArtifact === undefined
      ? undefined
      : await runtime.proposals.get(assignment.currentArtifact.proposalId);
  const attemptRunId =
    assignment.status === "running"
      ? assignment.activeAttemptId ?? assignment.latestAttemptId
      : assignment.latestAttemptId ??
        assignment.activeAttemptId ??
        proposal?.runId;
  if (attemptRunId === undefined) {
    return Object.freeze({ assignment: assignmentResponse(assignment) });
  }
  const assignmentId = assignment.id;
  const attempt = await runtime.attempts.get({
    accountId: account,
    projectId: ownedProjectId,
    assignmentId,
    runId: attemptRunId
  });
  const run =
    attempt === undefined ? undefined : await runtime.runs.get(attempt.runId);
  const receipt =
    run === undefined ? undefined : await runtime.receipts.get(run.receiptId);
  if (assignment.status === "running") {
    const recovery = storyWorkRecoveryProjection(assignment, attempt, run);
    if (recovery.status === "refresh-required") {
      return Object.freeze({
        assignment: assignmentResponse(assignment),
        recovery,
        ...(attempt === undefined ? {} : { attempt }),
        ...(run === undefined ? {} : { run }),
        ...(receipt === undefined ? {} : { receipt })
      });
    }
    if (
      attempt === undefined ||
      run === undefined ||
      receipt === undefined ||
      run.projectId !== ownedProjectId ||
      run.initiatorAccountId !== account ||
      receipt.projectId !== ownedProjectId
    ) {
      return Object.freeze({
        assignment: assignmentResponse(assignment),
        recovery: storyWorkRecoveryRefreshRequired(assignment, attemptRunId)
      });
    }
    return Object.freeze({
      assignment: assignmentResponse(assignment),
      recovery,
      run,
      receipt,
      attempt
    });
  }
  const artifactMismatchError =
    assignment.taskKind === "check"
      ? new StoryCheckArtifactMismatchError()
      : assignment.taskKind === "outline"
        ? new StoryStructureStoryWorkArtifactMismatchError()
        : new CharacterStoryWorkArtifactMismatchError();
  if (
    attempt === undefined ||
    run === undefined ||
    receipt === undefined ||
    run.projectId !== ownedProjectId ||
    run.initiatorAccountId !== account ||
    receipt.projectId !== ownedProjectId ||
    (assignment.currentArtifact !== undefined &&
      (proposal === undefined ||
        proposal.projectId !== ownedProjectId ||
        proposal.contentHash !== assignment.currentArtifact.contentHash))
  ) {
    throw artifactMismatchError;
  }
  const checkFreshness =
    proposal?.outputSchemaId === "story-check-findings-v1"
      ? await checkFreshnessForProposal(
          runtime,
          assignment,
          records,
          proposal.payload
        )
      : undefined;
  return Object.freeze({
    assignment: assignmentResponse(assignment),
    ...(proposal === undefined ? {} : { proposal }),
    run,
    receipt,
    attempt,
    ...(checkFreshness === undefined ? {} : { checkFreshness })
  });
}

function sortGrantVisibleAssignments(
  assignments: readonly StoryWorkAssignment[]
): readonly StoryWorkAssignment[] {
  return Object.freeze(
    [...assignments].sort((left, right) => {
      const byUpdated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      if (byUpdated !== 0) return byUpdated;
      return right.id.localeCompare(left.id);
    })
  );
}

/**
 * Bounded grant-visible assignment list for the local MCP bridge.
 * Explicit grant allowlist IDs are fetched directly and pinned in the response.
 * Grant-origin rows come from {@link StoryWorkAssignmentRepository.listByMcpGrantOrigin}
 * (max {@link STORY_WORK_ASSIGNMENT_LIST_MAX} by updatedAt/id). When a grant has more
 * than 100 origin resources, only the 100 most recently updated are indexed; pinned
 * allowlist rows may displace origin rows in the final cap.
 */
export async function listGrantVisibleStoryWorkAssignments(
  runtime: StoryWorkApiRuntime,
  record: McpGrantRecord
): Promise<readonly StoryWorkAssignment[]> {
  const account = record.accountId;
  const ownedProjectId = record.projectId;
  const allowlistedIds = new Set(record.assignmentIds);
  const visible = new Map<
    ReturnType<typeof storyWorkAssignmentId>,
    StoryWorkAssignment
  >();
  for (const allowlistedId of record.assignmentIds) {
    const assignment = await runtime.assignments.get({
      accountId: account,
      projectId: ownedProjectId,
      assignmentId: allowlistedId
    });
    if (
      assignment !== undefined &&
      assignment.projectId === ownedProjectId &&
      assignment.initiatorAccountId === account &&
      grantAllowsAssignment(record, assignment.id, assignment.origin)
    ) {
      visible.set(assignment.id, assignment);
    }
  }
  const listed = await runtime.assignments.listByMcpGrantOrigin({
    accountId: account,
    projectId: ownedProjectId,
    originMcpGrantId: record.id,
    options: { limit: STORY_WORK_ASSIGNMENT_LIST_MAX }
  });
  for (const assignment of listed) {
    if (
      assignment.projectId === ownedProjectId &&
      assignment.initiatorAccountId === account &&
      grantAllowsAssignment(record, assignment.id, assignment.origin)
    ) {
      visible.set(assignment.id, assignment);
    }
  }
  const merged = sortGrantVisibleAssignments([...visible.values()]);
  const pinned = merged.filter((assignment) => allowlistedIds.has(assignment.id));
  const remainder = merged.filter((assignment) => !allowlistedIds.has(assignment.id));
  return Object.freeze(
    [...pinned, ...remainder].slice(0, STORY_WORK_ASSIGNMENT_LIST_MAX)
  );
}

function sortGrantVisibleCoordinations(
  coordinations: readonly StoryWorkCoordination[]
): readonly StoryWorkCoordination[] {
  return Object.freeze(
    [...coordinations].sort((left, right) => {
      const byUpdated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      if (byUpdated !== 0) return byUpdated;
      return right.id.localeCompare(left.id);
    })
  );
}

/**
 * Bounded grant-visible coordination list for the local MCP bridge.
 * Explicit grant allowlist IDs are fetched directly and pinned in the response.
 * Grant-origin rows come from {@link StoryWorkCoordinationRepository.listByMcpGrantOrigin}
 * (max {@link STORY_WORK_COORDINATION_LIST_MAX} by updatedAt/id). When a grant has more
 * than 100 origin resources, only the 100 most recently updated are indexed; pinned
 * allowlist rows may displace origin rows in the final cap.
 */
export async function listGrantVisibleStoryWorkCoordinations(
  runtime: StoryWorkApiRuntime,
  record: McpGrantRecord
): Promise<readonly StoryWorkCoordination[]> {
  const account = record.accountId;
  const ownedProjectId = record.projectId;
  const allowlistedIds = new Set(record.coordinationIds);
  const visible = new Map<
    StoryWorkCoordinationId,
    StoryWorkCoordination
  >();
  for (const allowlistedId of record.coordinationIds) {
    const coordination = await runtime.coordinations.get({
      accountId: account,
      projectId: ownedProjectId,
      coordinationId: allowlistedId
    });
    if (
      coordination !== undefined &&
      coordination.projectId === ownedProjectId &&
      coordination.initiatorAccountId === account &&
      grantAllowsCoordination(record, coordination.id, coordination.origin)
    ) {
      visible.set(coordination.id, coordination);
    }
  }
  const listed = await runtime.coordinations.listByMcpGrantOrigin({
    accountId: account,
    projectId: ownedProjectId,
    originMcpGrantId: record.id,
    options: { limit: STORY_WORK_COORDINATION_LIST_MAX }
  });
  for (const coordination of listed) {
    if (
      coordination.projectId === ownedProjectId &&
      coordination.initiatorAccountId === account &&
      grantAllowsCoordination(record, coordination.id, coordination.origin)
    ) {
      visible.set(coordination.id, coordination);
    }
  }
  const merged = sortGrantVisibleCoordinations([...visible.values()]);
  const pinned = merged.filter((coordination) => allowlistedIds.has(coordination.id));
  const remainder = merged.filter(
    (coordination) => !allowlistedIds.has(coordination.id)
  );
  return Object.freeze(
    [...pinned, ...remainder].slice(0, STORY_WORK_COORDINATION_LIST_MAX)
  );
}

async function selectedCaptureHead(
  runtime: StoryWorkApiRuntime,
  records: ProjectRecords,
  requestedCaptureId: string | undefined
): Promise<CaptureDocumentHead | undefined> {
  if (requestedCaptureId === undefined) return undefined;
  const head = await runtime.captureDocuments.get(captureId(requestedCaptureId));
  if (
    head === undefined ||
    head.projectId !== records.project.id ||
    head.archivedAt !== undefined ||
    head.status === "archived" ||
    head.status === "integrated"
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Scene work requires an active Capture in the current project."
    );
  }
  return head;
}

async function assignmentRequestFingerprint(
  runtime: StoryWorkApiRuntime,
  input: Readonly<{
    accountId: AccountId;
    projectId: ReturnType<typeof projectId>;
    expectedProjectVersion: number;
    brief: string;
    constraints: string;
    doneWhen: string;
    sceneIds: readonly string[];
    model: string;
    taskKind: "character" | "scene" | "revise" | "check" | "outline";
    targetBookId?: string;
    targetSceneId?: string;
    captureId?: string;
    specialist?: "continuity";
    checkMode?: "applied-scene" | "proposal-draft";
    sourceAssignmentId?: string;
    sourceArtifact?: Readonly<{
      proposalId: string;
      artifactVersion: number;
      contentHash: string;
    }>;
  }>
) {
  return storyWorkAssignmentRequestFingerprint(
    await runtime.hashPort.digestSha256Hex(
      canonicalJsonStringify(input)
    )
  );
}

async function trustedGenerationContext(
  runtime: StoryWorkApiRuntime,
  assignment: StoryWorkAssignment,
  records: ProjectRecords
) {
  const scopeSource = assignment.sources.find(
    (source) =>
      source.kind === "project" ||
      source.kind === "chapter" ||
      source.kind === "scene"
  );
  const scope: StoryContextScope = scopeSource?.kind === "chapter"
    ? { kind: "chapter", chapterId: scopeSource.chapterId }
    : scopeSource?.kind === "scene"
      ? { kind: "scene", sceneId: scopeSource.sceneId }
      : { kind: "project" };
  const storyContext = storyContextFromProjectRecords(records, { scope });
  const structure = await assembleStoryStructureResource({
    projectId: assignment.projectId,
    context: storyContext,
    inclusionReason: "Canonical story structure selected for this story work assignment.",
    hashPort: runtime.hashPort
  });
  const selectedSceneIds = assignment.sources.flatMap((source) =>
    source.kind === "scene" ? [source.sceneId] : []
  );
  const heads = await runtime.sceneDocuments.getHeads(selectedSceneIds);
  const sceneResources = await Promise.all(
    selectedSceneIds.flatMap((id) => {
      const head = heads.get(id);
      return head === undefined
        ? []
        : [
            assembleStorySceneResource({
              projectId: assignment.projectId,
              sceneId: id,
              head,
              inclusionReason: "Writer-selected manuscript scene.",
              hashPort: runtime.hashPort
            })
          ];
    })
  );
  const captureResources = await Promise.all(
    assignment.sources.flatMap((source) => {
      if (source.kind !== "capture") return [];
      return [
        (async () => {
          const head = await runtime.captureDocuments.get(source.captureId);
          if (
            head === undefined ||
            head.projectId !== assignment.projectId ||
            head.archivedAt !== undefined ||
            head.status === "archived" ||
            head.status === "integrated"
          ) {
            throw new DomainValidationError(
              "UNKNOWN_REFERENCE",
              "The selected Capture is no longer available to this assignment."
            );
          }
          const resource = await assembleCaptureReflectionResource({
            captureHead: head,
            assignment: { captureId: source.captureId },
            hashPort: runtime.hashPort
          });
          return Object.freeze({
            providerText: sliceCaptureProviderText(head.document).providerPlainText,
            resource
          });
        })()
      ];
    })
  );
  return Object.freeze({
    storyContext,
    resources: Object.freeze([
      structure,
      ...sceneResources,
      ...captureResources
    ])
  });
}

async function trustedStructureGenerationContext(
  runtime: StoryWorkApiRuntime,
  assignment: StoryWorkAssignment,
  records: ProjectRecords
): Promise<
  Readonly<{
    storyContext: StoryContextProjection;
    resources: readonly StoryStructureResourceInput[];
    trustedLoweringContext: ReturnType<typeof storyStructureLoweringContextFromBook>;
    targetBookId: BookId;
  }>
> {
  await revalidateStoryWorkSources(runtime, assignment, records);
  if (
    assignment.taskKind !== "outline" ||
    assignment.destination.kind !== "book" ||
    assignment.destination.operation !== "update"
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Structure generation requires an outline assignment with a book update destination."
    );
  }
  const targetBookId = assignment.destination.bookId;
  requireActiveTargetBook(records, targetBookId);
  const book = records.books.find((candidate) => candidate.id === targetBookId)!;
  const storyContext = storyContextFromProjectRecords(records, {
    scope: { kind: "project" }
  });
  const structure = await assembleStoryStructureResource({
    projectId: assignment.projectId,
    context: storyContext,
    inclusionReason: "Canonical story structure selected for this outline assignment.",
    hashPort: runtime.hashPort
  });
  const selectedSceneIds = assignment.sources.flatMap((source) =>
    source.kind === "scene" ? [source.sceneId] : []
  );
  const heads = await runtime.sceneDocuments.getHeads(selectedSceneIds);
  const sceneResources = await Promise.all(
    selectedSceneIds.map(async (id) => {
      const head = heads.get(id);
      if (head === undefined) {
        throw new DomainValidationError(
          "UNKNOWN_REFERENCE",
          "Open each selected scene once before submitting it as story context."
        );
      }
      return assembleStorySceneResource({
        projectId: assignment.projectId,
        sceneId: id,
        head,
        inclusionReason: "Writer-selected manuscript scene.",
        hashPort: runtime.hashPort
      });
    })
  );
  const trustedLoweringContext = storyStructureLoweringContextFromBook(
    assignment.projectId,
    book,
    records.scenes
  );
  return Object.freeze({
    storyContext,
    resources: Object.freeze([structure, ...sceneResources]),
    trustedLoweringContext,
    targetBookId
  });
}

async function collectStructurePreviewKnownChecks(
  runtime: StoryWorkApiRuntime,
  accountId: AccountId,
  projectIdValue: ReturnType<typeof projectId>
): Promise<readonly StoryStructurePreviewKnownCheck[]> {
  const assignments = await runtime.assignments.listByProject({
    accountId,
    projectId: projectIdValue,
    options: { limit: MAX_KNOWN_STRUCTURE_PREVIEW_CHECKS }
  });
  const knownChecks: StoryStructurePreviewKnownCheck[] = [];
  for (const assignment of assignments) {
    if (assignment.taskKind !== "check" || assignment.currentArtifact === undefined) {
      continue;
    }
    const proposal = await runtime.proposals.get(assignment.currentArtifact.proposalId);
    if (
      proposal === undefined ||
      proposal.projectId !== projectIdValue ||
      proposal.outputSchemaId !== "story-check-findings-v1" ||
      proposal.contentHash !== assignment.currentArtifact.contentHash
    ) {
      continue;
    }
    try {
      const findings = validateStoryCheckFindingsV1(proposal.payload);
      const proposalSource = assignment.sources.find(
        (source): source is Extract<StoryWorkSourceReference, { kind: "proposal-artifact" }> =>
          source.kind === "proposal-artifact"
      );
      const currentProposalDraftContentHash =
        proposalSource === undefined
          ? undefined
          : await resolveCheckProposalDraftFreshnessContentHash(
              { assignments: runtime.assignments, proposals: runtime.proposals },
              {
                accountId,
                projectId: projectIdValue,
                proposalSource
              }
            );
      knownChecks.push(
        Object.freeze({
          assignmentId: assignment.id,
          artifactId: assignment.currentArtifact.proposalId,
          findings,
          ...(currentProposalDraftContentHash === undefined
            ? {}
            : { currentProposalDraftContentHash })
        })
      );
    } catch {
      continue;
    }
    if (knownChecks.length >= MAX_KNOWN_STRUCTURE_PREVIEW_CHECKS) {
      break;
    }
  }
  return Object.freeze(knownChecks);
}

export function storyWorkAssignmentResponse(assignment: StoryWorkAssignment) {
  return Object.freeze({ ...assignment });
}

function assignmentResponse(assignment: StoryWorkAssignment) {
  return storyWorkAssignmentResponse(assignment);
}

function storyWorkRecoveryRefreshRequired(
  assignment: StoryWorkAssignment,
  runId?: ReturnType<typeof agentRunId>
): StoryWorkRecoveryProjection {
  return Object.freeze({
    status: "refresh-required",
    ...(runId === undefined ? {} : { runId }),
    expectedAssignmentVersion: assignment.version,
    actions: STORY_WORK_RECOVERY_ACTIONS,
    message:
      "Story work changed while this page was open. Refresh assignment details before canceling or marking interrupted."
  });
}

function storyWorkRecoveryProjection(
  assignment: StoryWorkAssignment,
  attempt: StoryWorkAttempt | undefined,
  run: AgentRun | undefined
): StoryWorkRecoveryProjection {
  const activeRunId = assignment.activeAttemptId;
  if (
    activeRunId === undefined ||
    assignment.latestAttemptId !== activeRunId ||
    assignment.activeAttemptId !== activeRunId
  ) {
    return storyWorkRecoveryRefreshRequired(
      assignment,
      activeRunId ?? assignment.latestAttemptId
    );
  }
  const attemptMatches =
    attempt !== undefined &&
    attempt.runId === activeRunId &&
    attempt.completedAt === undefined &&
    attempt.resultArtifact === undefined;
  const runMatches =
    run !== undefined &&
    run.id === activeRunId &&
    (run.status === "running" || run.status === "queued");
  if (!attemptMatches || !runMatches) {
    return storyWorkRecoveryRefreshRequired(assignment, activeRunId);
  }
  return Object.freeze({
    status: "active-or-interrupted",
    runId: activeRunId,
    expectedAssignmentVersion: assignment.version,
    actions: STORY_WORK_RECOVERY_ACTIONS,
    message:
      "Generation is still active or the provider outcome is uncertain. Cancel the run or mark it interrupted after reload."
  });
}

function invalidRecoverRequestResponse(
  context: Context<StoryWorkEnvironment>,
  parsed: {
    success: false;
    code: string;
    issues?: readonly { path: string; message: string }[];
  }
) {
  return context.json(
    {
      error: "Invalid request.",
      code: parsed.code,
      ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
    },
    parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 422
  );
}

function artifactFromRequest(input: Readonly<{
  proposalId: string;
  artifactVersion: number;
  contentHash: string;
}>): StoryWorkArtifactPointer {
  return Object.freeze({
    proposalId: agentProposalId(input.proposalId),
    artifactVersion: input.artifactVersion,
    contentHash: instructionContentHash(input.contentHash)
  });
}

function characterPayloadFromRequest(input: Readonly<{
  schemaId: "character-create-v2";
  name: string;
  summary: string;
  aliases: readonly string[];
  characterSheet: CharacterCreateV2["characterSheet"];
  sourceSceneIds?: readonly string[];
}>): CharacterCreateV2 {
  const { sourceSceneIds, ...payload } = input;
  return Object.freeze({
    ...payload,
    aliases: Object.freeze([...input.aliases]),
    ...(sourceSceneIds === undefined
      ? {}
      : { sourceSceneIds: Object.freeze(sourceSceneIds.map(sceneId)) })
  });
}

function scenePayloadFromRequest(input: Readonly<{
  schemaId: "scene-draft-v1";
  prose: string;
  sourceSceneIds: readonly string[];
}>): SceneDraftV1 {
  return Object.freeze({
    schemaId: "scene-draft-v1",
    prose: input.prose,
    sourceSceneIds: Object.freeze(input.sourceSceneIds.map(sceneId))
  });
}

function sceneApplyInputFromRequest(
  account: AccountId,
  ownedProjectId: ReturnType<typeof projectId>,
  assignmentId: ReturnType<typeof storyWorkAssignmentId>,
  sessionId: string,
  body: ApplySceneStoryWorkRequest
): ApplySceneStoryWorkInput {
  const base = Object.freeze({
    accountId: account,
    projectId: ownedProjectId,
    assignmentId,
    expectedAssignmentVersion: body.expectedAssignmentVersion,
    proposalId: agentProposalId(body.proposalId),
    expectedArtifactVersion: body.expectedArtifactVersion,
    expectedProposalContentHash: instructionContentHash(
      body.expectedProposalContentHash
    ),
    idempotencyKey: storyWorkApplyIdempotencyKey(body.idempotencyKey)
  });
  if (body.mode === "create-scene") {
    const placement = body.manuscriptPlacement;
    return Object.freeze({
      ...base,
      mode: "create-scene",
      expectedProjectVersion: body.expectedProjectVersion,
      title: body.title,
      manuscriptPlacement:
        placement.kind === "chapter"
          ? Object.freeze({
              kind: "chapter" as const,
              bookId: bookId(placement.bookId),
              chapterId: chapterId(placement.chapterId),
              ...(placement.position === undefined
                ? {}
                : { position: placement.position })
            })
          : Object.freeze({
              kind: "unassigned" as const,
              bookId: bookId(placement.bookId),
              ...(placement.position === undefined
                ? {}
                : { position: placement.position })
            }),
      ...(body.canvas === undefined
        ? {}
        : {
            canvas: Object.freeze({
              expectedCanvasVersion: body.canvas.expectedCanvasVersion,
              scope: createCanvasScopeRef(body.canvas.scope),
              x: body.canvas.x,
              y: body.canvas.y,
              width: body.canvas.width,
              height: body.canvas.height,
              z: body.canvas.z,
              ...(body.canvas.parentRegionId === undefined
                ? {}
                : { parentRegionId: canvasObjectId(body.canvas.parentRegionId) }),
              ...(body.canvas.storyOrderHint === undefined
                ? {}
                : { storyOrderHint: body.canvas.storyOrderHint })
            })
          })
    });
  }
  const existingBase = Object.freeze({
    ...base,
    expectedSceneWorkingVersion: body.expectedSceneWorkingVersion,
    expectedSceneContentHash: sceneContentHash(body.expectedSceneContentHash),
    leaseHolderId: sceneLeaseHolderId(sessionId)
  });
  if (body.mode === "named-variant") {
    return Object.freeze({
      ...existingBase,
      mode: "named-variant",
      variantName: body.variantName
    });
  }
  return Object.freeze({
    ...existingBase,
    mode: "apply-revision"
  });
}

function handleRouteError(context: Context<StoryWorkEnvironment>, error: unknown) {
  const mapped = storyWorkErrorStatusAndBody(error);
  if (mapped !== undefined) return context.json(mapped.body, mapped.status);
  console.error("Story work request failed.", {
    errorName: error instanceof Error ? error.name : "UnknownError"
  });
  return context.json(
    {
      error: "Story work is temporarily unavailable.",
      code: "STORY_WORK_UNAVAILABLE"
    },
    503
  );
}

function assignmentConflict(
  taskKind: "character" | "scene" | "revise" | "check" | "outline",
  message: string
): Error {
  if (taskKind === "character") {
    return new CharacterStoryWorkGenerationConflictError(message);
  }
  if (taskKind === "check") {
    return new StoryCheckGenerationConflictError(message);
  }
  if (taskKind === "outline") {
    return new StoryStructureGenerationConflictError(message);
  }
  return new SceneStoryWorkGenerationConflictError(message);
}

function structurePayloadFromRequest(payload: unknown): StoryStructureProposalV1 {
  return validateStoryStructureProposalV1(payload);
}

function structureApplyInputFromRequest(
  account: AccountId,
  ownedProjectId: ReturnType<typeof projectId>,
  assignmentId: ReturnType<typeof storyWorkAssignmentId>,
  body: ApplyStructureStoryWorkRequest
): ApplyStructureStoryWorkInput {
  return Object.freeze({
    accountId: account,
    projectId: ownedProjectId,
    assignmentId,
    expectedAssignmentVersion: body.expectedAssignmentVersion,
    proposalId: agentProposalId(body.proposalId),
    expectedArtifactVersion: body.expectedArtifactVersion,
    expectedProposalContentHash: instructionContentHash(body.expectedProposalContentHash),
    expectedProjectVersion: body.expectedProjectVersion,
    selectedOperationIds: Object.freeze(
      body.selectedOperationIds.map(storyStructureOperationId)
    ),
    idempotencyKey: body.idempotencyKey,
    ...(body.canvas === undefined
      ? {}
      : {
          canvasPlacement: Object.freeze({
            expectedCanvasVersion: body.canvas.expectedCanvasVersion,
            sceneId: sceneId(body.canvas.sceneId),
            scope: createCanvasScopeRef(body.canvas.scope),
            x: body.canvas.x,
            y: body.canvas.y,
            width: body.canvas.width,
            height: body.canvas.height,
            z: body.canvas.z,
            ...(body.canvas.parentRegionId === undefined
              ? {}
              : { parentRegionId: canvasObjectId(body.canvas.parentRegionId) }),
            ...(body.canvas.storyOrderHint === undefined
              ? {}
              : { storyOrderHint: body.canvas.storyOrderHint })
          })
        })
  });
}

function structurePreviewRefusalStatus(
  code: string
): ContentfulStatusCode {
  return code === "INVALID_PROPOSAL" || code === "COMMAND_REFUSED" ? 422 : 409;
}

function invalidStrictStoryWorkRequestResponse(
  context: Context<StoryWorkEnvironment>,
  parsed: {
    success: false;
    code: string;
    issues?: readonly { path: string; message: string }[];
  }
) {
  return context.json(
    {
      error: "Invalid request.",
      code: parsed.code,
      ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
    },
    parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 422
  );
}

function coordinationRootAssignmentIdempotencyKey(idempotencyKey: string): string {
  const key = `sw-coord:${idempotencyKey}:root-scene`;
  return key.length <= 200 ? key : key.slice(0, 200);
}

function coordinationCheckAssignmentIdempotencyKey(
  coordinationId: StoryWorkCoordinationId,
  stepId: StoryWorkCoordinationStepId
): string {
  const key = `sw-coord:${coordinationId}:step:${stepId}:continuity-check`;
  return key.length <= 200 ? key : key.slice(0, 200);
}

function coordinationCreateResponse(input: Readonly<{
  replayed: boolean;
  coordination: StoryWorkCoordination;
  projection: StoryWorkCoordinationProjection;
  rootAssignment: StoryWorkAssignment;
}>) {
  return Object.freeze({
    replayed: input.replayed,
    coordination: input.coordination,
    projection: input.projection,
    rootAssignment: assignmentResponse(input.rootAssignment)
  });
}

function coordinationBindResponse(input: Readonly<{
  replayed: boolean;
  coordination: StoryWorkCoordination;
  projection: StoryWorkCoordinationProjection;
  rootAssignment: StoryWorkAssignment;
  checkAssignment: StoryWorkAssignment;
}>) {
  return Object.freeze({
    ...coordinationCreateResponse(input),
    checkAssignment: assignmentResponse(input.checkAssignment)
  });
}

function childAssignmentSummariesForCoordination(
  coordination: StoryWorkCoordination,
  childAssignments: ReadonlyMap<
    ReturnType<typeof storyWorkAssignmentId>,
    StoryWorkAssignment
  >
): readonly StoryWorkCoordinationChildAssignmentSummary[] {
  return Object.freeze(
    coordination.steps.flatMap((step) => {
      const assignmentId =
        step.kind === "scene-draft"
          ? step.assignmentId
          : step.binding?.assignmentId;
      if (assignmentId === undefined) return [];
      const assignment = childAssignments.get(assignmentId);
      if (assignment === undefined) return [];
      return [
        Object.freeze({
          stepId: step.stepId,
          assignmentId,
          taskKind: assignment.taskKind,
          status: assignment.status
        })
      ];
    })
  );
}

async function loadCoordinationChildAssignments(
  runtime: StoryWorkApiRuntime,
  account: AccountId,
  ownedProjectId: ReturnType<typeof projectId>,
  coordination: StoryWorkCoordination
): Promise<
  ReadonlyMap<ReturnType<typeof storyWorkAssignmentId>, StoryWorkAssignment>
> {
  const entries: Array<
    readonly [ReturnType<typeof storyWorkAssignmentId>, StoryWorkAssignment]
  > = [];
  for (const step of coordination.steps) {
    const assignmentId =
      step.kind === "scene-draft"
        ? step.assignmentId
        : step.binding?.assignmentId;
    if (assignmentId === undefined) continue;
    const assignment = await runtime.assignments.get({
      accountId: account,
      projectId: ownedProjectId,
      assignmentId
    });
    if (assignment === undefined) throw new StoryWorkAssignmentNotFoundError();
    entries.push([assignmentId, assignment]);
  }
  return new Map(entries);
}

export async function buildCoordinationDetailResponse(
  runtime: StoryWorkApiRuntime,
  account: AccountId,
  ownedProjectId: ReturnType<typeof projectId>,
  coordination: StoryWorkCoordination
): Promise<StoryWorkCoordinationDetailResponse> {
  const childAssignments = await loadCoordinationChildAssignments(
    runtime,
    account,
    ownedProjectId,
    coordination
  );
  validateStoryWorkCoordinationChildAssignments({
    coordination,
    childAssignments
  });
  const projection = projectStoryWorkCoordination({
    coordination,
    childAssignments
  });
  const rootStep = coordination.steps.find(
    (step): step is Extract<(typeof coordination.steps)[number], { kind: "scene-draft" }> =>
      step.kind === "scene-draft"
  );
  if (rootStep === undefined) throw new StoryWorkAssignmentNotFoundError();
  const rootAssignment = childAssignments.get(rootStep.assignmentId);
  if (rootAssignment === undefined) throw new StoryWorkAssignmentNotFoundError();
  return Object.freeze({
    coordination,
    projection,
    rootAssignment: assignmentResponse(rootAssignment),
    childAssignmentSummaries: childAssignmentSummariesForCoordination(
      coordination,
      childAssignments
    )
  });
}

async function sceneDraftAssignmentRequestFingerprint(
  runtime: StoryWorkApiRuntime,
  input: Readonly<{
    accountId: AccountId;
    projectId: ReturnType<typeof projectId>;
    expectedProjectVersion: number;
    body: CreateStoryWorkCoordinationRequest;
  }>
) {
  return assignmentRequestFingerprint(runtime, {
    accountId: input.accountId,
    projectId: input.projectId,
    expectedProjectVersion: input.expectedProjectVersion,
    brief: input.body.scene.brief,
    constraints: input.body.scene.constraints,
    doneWhen: input.body.scene.doneWhen,
    sceneIds: input.body.scene.sceneIds,
    model: input.body.scene.model,
    taskKind: "scene"
  });
}

async function coordinationRequestFingerprintForCreate(
  runtime: StoryWorkApiRuntime,
  input: Readonly<{
    body: CreateStoryWorkCoordinationRequest;
    sceneDraftRequestFingerprint: ReturnType<typeof instructionContentHash>;
  }>
) {
  return storyWorkCoordinationSemanticFingerprint(
    Object.freeze({
      title: input.body.title,
      steps: Object.freeze([
        Object.freeze({
          kind: "scene-draft" as const,
          title: input.body.scene.title,
          sceneDraftRequestFingerprint: input.sceneDraftRequestFingerprint
        }),
        Object.freeze({
          kind: "proposal-continuity-check" as const,
          title: input.body.check.title,
          dependencySceneDraftTitle: input.body.scene.title,
          deferred: Object.freeze({
            brief: input.body.check.brief,
            constraints: input.body.check.constraints,
            doneWhen: input.body.check.doneWhen,
            model: input.body.check.model,
            ...(input.body.check.surroundingSceneIds.length === 0
              ? {}
              : {
                  surroundingSceneIds: Object.freeze(
                    input.body.check.surroundingSceneIds.map(sceneId)
                  )
                })
          })
        })
      ])
    }),
    runtime.hashPort
  );
}

async function buildCoordinationCreatePayload(
  runtime: StoryWorkApiRuntime,
  input: Readonly<{
    accountId: AccountId;
    projectId: ReturnType<typeof projectId>;
    body: CreateStoryWorkCoordinationRequest;
    records: ProjectRecords;
    sceneHeads: ReadonlyMap<SceneId, SceneDocumentHead>;
    coordinationId: StoryWorkCoordinationId;
    sceneStepId: StoryWorkCoordinationStepId;
    checkStepId: StoryWorkCoordinationStepId;
    rootAssignmentId: ReturnType<typeof storyWorkAssignmentId>;
    reservedSceneId: SceneId;
    now: string;
    rootAssignmentRequestFingerprint: ReturnType<typeof instructionContentHash>;
    trustedOrigin?: McpStoryWorkOrigin;
  }>
) {
  const selectedSceneIds = input.body.scene.sceneIds.map(sceneId);
  const scopedSources = assignmentSources(
    input.records,
    selectedSceneIds,
    input.sceneHeads
  );
  const sources = scopedSources.some((source) => source.kind === "project")
    ? scopedSources
    : Object.freeze([
        {
          kind: "project" as const,
          projectId: input.records.project.id,
          projectVersion: input.records.project.version
        },
        ...scopedSources
      ]);
  const rootAssignment = createStoryWorkAssignment({
    id: input.rootAssignmentId,
    projectId: input.projectId,
    initiatorAccountId: input.accountId,
    version: 1,
    taskKind: "scene",
    brief: input.body.scene.brief,
    constraints: input.body.scene.constraints,
    doneWhen: input.body.scene.doneWhen,
    sources,
    destination: {
      kind: "scene",
      sceneId: input.reservedSceneId,
      operation: "create"
    },
    provider: providerForAgentModel(input.body.scene.model),
    model: input.body.scene.model,
    status: "brief-ready",
    steps: [
      {
        id: "draft-scene",
        title: "Draft new scene",
        dependencies: []
      }
    ],
    results: [],
    idempotencyKey: coordinationRootAssignmentIdempotencyKey(input.body.idempotencyKey),
    ...(input.trustedOrigin === undefined ? {} : { origin: input.trustedOrigin }),
    createdAt: input.now,
    updatedAt: input.now
  });
  const coordination = createStoryWorkCoordination({
    id: input.coordinationId,
    projectId: input.projectId,
    initiatorAccountId: input.accountId,
    version: 1,
    title: input.body.title,
    status: "active",
    steps: [
      {
        kind: "scene-draft",
        stepId: input.sceneStepId,
        title: input.body.scene.title,
        assignmentId: input.rootAssignmentId
      },
      {
        kind: "proposal-continuity-check",
        stepId: input.checkStepId,
        title: input.body.check.title,
        dependencies: [{ stepId: input.sceneStepId, requiredState: "artifact-ready" }],
        deferred: Object.freeze({
          brief: input.body.check.brief,
          constraints: input.body.check.constraints,
          doneWhen: input.body.check.doneWhen,
          model: input.body.check.model,
          ...(input.body.check.surroundingSceneIds.length === 0
            ? {}
            : {
                surroundingSceneIds: Object.freeze(
                  input.body.check.surroundingSceneIds.map(sceneId)
                )
              })
        })
      }
    ],
    idempotencyKey: input.body.idempotencyKey,
    ...(input.trustedOrigin === undefined ? {} : { origin: input.trustedOrigin }),
    createdAt: input.now,
    updatedAt: input.now
  });
  return Object.freeze({
    coordination,
    rootAssignment,
    rootAssignmentRequestFingerprint: input.rootAssignmentRequestFingerprint
  });
}

async function buildContinuityCheckBindPayload(
  runtime: StoryWorkApiRuntime,
  input: Readonly<{
    accountId: AccountId;
    projectId: ReturnType<typeof projectId>;
    coordination: StoryWorkCoordination;
    stepId: StoryWorkCoordinationStepId;
    records: ProjectRecords;
    rootAssignment: StoryWorkAssignment;
    expectedUpstreamArtifact: StoryWorkArtifactPointer;
    checkAssignmentId: ReturnType<typeof storyWorkAssignmentId>;
    now: string;
    checkAssignmentOrigin?: McpStoryWorkOrigin;
  }>
) {
  const step = input.coordination.steps.find(
    (candidate) => candidate.stepId === input.stepId
  );
  if (step === undefined || step.kind !== "proposal-continuity-check") {
    throw new StoryWorkAssignmentNotFoundError();
  }
  if (
    input.rootAssignment.destination.kind !== "scene" ||
    input.rootAssignment.destination.operation !== "create"
  ) {
    throw new StoryWorkCoordinationDependencyConflictError();
  }
  const targetSceneId = input.rootAssignment.destination.sceneId;
  const surroundingSceneIds = step.deferred.surroundingSceneIds ?? [];
  validateSelectedScenes(input.records, surroundingSceneIds);
  if (surroundingSceneIds.includes(targetSceneId)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Proposal-draft checks must not include the assess scene in surroundingSceneIds."
    );
  }
  const sceneHeads = await runtime.sceneDocuments.getHeads(surroundingSceneIds);
  const proposalSource = await resolveCheckProposalSource(
    runtime,
    input.records,
    input.accountId,
    input.projectId,
    targetSceneId,
    input.rootAssignment.id,
    input.expectedUpstreamArtifact
  );
  const sources = await checkAssignmentSources(
    runtime,
    input.records,
    {
      checkMode: "proposal-draft",
      targetSceneId,
      surroundingSceneIds,
      proposalSource
    },
    sceneHeads
  );
  const checkAssignment = createStoryWorkAssignment({
    id: input.checkAssignmentId,
    projectId: input.projectId,
    initiatorAccountId: input.accountId,
    version: 1,
    taskKind: "check",
    brief: step.deferred.brief,
    constraints: step.deferred.constraints,
    doneWhen: step.deferred.doneWhen,
    sources,
    destination: {
      kind: "scene",
      sceneId: targetSceneId,
      operation: "assess"
    },
    provider: providerForAgentModel(step.deferred.model),
    model: step.deferred.model,
    status: "brief-ready",
    steps: [
      {
        id: "check-continuity",
        title: "Run continuity check",
        dependencies: []
      }
    ],
    results: [],
    idempotencyKey: coordinationCheckAssignmentIdempotencyKey(
      input.coordination.id,
      input.stepId
    ),
    ...(input.checkAssignmentOrigin === undefined
      ? {}
      : { origin: input.checkAssignmentOrigin }),
    createdAt: input.now,
    updatedAt: input.now
  });
  const checkAssignmentRequestFingerprint = await assignmentRequestFingerprint(
    runtime,
    {
      accountId: input.accountId,
      projectId: input.projectId,
      expectedProjectVersion: input.records.project.version,
      brief: step.deferred.brief,
      constraints: step.deferred.constraints,
      doneWhen: step.deferred.doneWhen,
      sceneIds: surroundingSceneIds,
      model: step.deferred.model,
      taskKind: "check",
      targetSceneId,
      specialist: "continuity",
      checkMode: "proposal-draft",
      sourceAssignmentId: input.rootAssignment.id,
      sourceArtifact: input.expectedUpstreamArtifact
    }
  );
  return Object.freeze({
    checkAssignment,
    checkAssignmentRequestFingerprint,
    resolvedDependency: Object.freeze({
      stepId: (() => {
        const rootStep = input.coordination.steps.find(
          (candidate) => candidate.kind === "scene-draft"
        );
        if (rootStep === undefined || rootStep.kind !== "scene-draft") {
          throw new StoryWorkAssignmentNotFoundError();
        }
        return rootStep.stepId;
      })(),
      artifact: input.expectedUpstreamArtifact
    })
  });
}

function submitStoryWorkFingerprintFields(
  accountId: AccountId,
  ownedProjectId: ReturnType<typeof projectId>,
  body: SubmitStoryWorkRequest
) {
  return Object.freeze({
    accountId,
    projectId: ownedProjectId,
    expectedProjectVersion: body.expectedProjectVersion,
    brief: body.brief,
    constraints: body.constraints,
    doneWhen: body.doneWhen,
    sceneIds: body.sceneIds,
    model: body.model,
    taskKind: body.taskKind,
    ...(body.taskKind === "outline" ? { targetBookId: body.targetBookId } : {}),
    ...(body.taskKind === "revise" || body.taskKind === "check"
      ? { targetSceneId: body.targetSceneId }
      : {}),
    ...(body.taskKind === "check"
      ? {
          specialist: body.specialist,
          checkMode: body.checkMode,
          ...(body.checkMode === "proposal-draft"
            ? {
                sourceAssignmentId: body.sourceAssignmentId,
                sourceArtifact: body.sourceArtifact
              }
            : {})
        }
      : {}),
    ...(body.taskKind === "character" ||
    body.taskKind === "check" ||
    body.taskKind === "outline" ||
    body.captureId === undefined
      ? {}
      : { captureId: body.captureId })
  });
}

export async function assertMcpGrantStoryWorkSubmitResources(
  runtime: StoryWorkApiRuntime,
  record: McpGrantRecord,
  body: SubmitStoryWorkRequest
): Promise<void> {
  requireGrantAllowsProjectStructureRead(record);
  const selectedSceneIds = body.sceneIds.map(sceneId);
  if (body.taskKind === "check") {
    const targetSceneId = sceneId(body.targetSceneId);
    let skipTargetSceneGrant = false;
    if (body.checkMode === "proposal-draft") {
      const sourceAssignment = await runtime.assignments.get({
        accountId: record.accountId,
        projectId: record.projectId,
        assignmentId: storyWorkAssignmentId(body.sourceAssignmentId)
      });
      if (sourceAssignment === undefined) {
        throw new McpGrantResourceDeniedError();
      }
      requireGrantAllowsAssignment(
        record,
        storyWorkAssignmentId(body.sourceAssignmentId),
        sourceAssignment.origin
      );
      if (
        sourceAssignment.destination.kind === "scene" &&
        sourceAssignment.destination.operation === "create"
      ) {
        skipTargetSceneGrant = true;
      }
    }
    if (!skipTargetSceneGrant) {
      requireGrantAllowsScene(record, targetSceneId);
    }
    const appliedSceneIds =
      body.checkMode === "applied-scene"
        ? [...new Set([targetSceneId, ...selectedSceneIds])]
        : selectedSceneIds;
    for (const id of appliedSceneIds) {
      requireGrantAllowsScene(record, id);
    }
    return;
  }
  for (const id of selectedSceneIds) {
    requireGrantAllowsScene(record, id);
  }
  if (body.taskKind === "revise") {
    requireGrantAllowsScene(record, sceneId(body.targetSceneId));
  }
  if (body.taskKind === "outline") {
    requireGrantAllowsBook(record, bookId(body.targetBookId));
  }
  if (body.taskKind === "scene" && body.captureId !== undefined) {
    requireGrantAllowsCapture(record, captureId(body.captureId));
  }
}

export async function createStoryWorkAssignmentFromSubmitRequest(
  runtime: StoryWorkApiRuntime,
  input: Readonly<{
    accountId: AccountId;
    projectId: ReturnType<typeof projectId>;
    body: SubmitStoryWorkRequest;
    trustedOrigin?: McpStoryWorkOrigin;
  }>
): Promise<
  Readonly<{
    assignment: StoryWorkAssignment;
    created: boolean;
  }>
> {
  const records = await requireOwnedRecords(
    runtime,
    input.accountId,
    input.projectId
  );
  const requestFingerprint = await assignmentRequestFingerprint(
    runtime,
    submitStoryWorkFingerprintFields(input.accountId, input.projectId, input.body)
  );
  const replay = await runtime.assignments.getByIdempotencyKey({
    accountId: input.accountId,
    projectId: input.projectId,
    idempotencyKey: input.body.idempotencyKey
  });
  if (replay !== undefined) {
    if (replay.requestFingerprint !== requestFingerprint) {
      throw assignmentConflict(
        input.body.taskKind,
        "The assignment idempotency key was already used for different work."
      );
    }
    return Object.freeze({
      assignment: replay.assignment,
      created: false
    });
  }
  if (records.project.archivedAt !== undefined) throw new ProjectArchivedMutationError();
  if (records.project.version !== input.body.expectedProjectVersion) {
    throw new ProjectVersionConflictError(
      input.projectId,
      input.body.expectedProjectVersion
    );
  }
  const selectedSceneIds = input.body.sceneIds.map(sceneId);
  const targetScene =
    input.body.taskKind === "revise" || input.body.taskKind === "check"
      ? sceneId(input.body.targetSceneId)
      : undefined;
  if (input.body.taskKind === "check") {
    if (input.body.checkMode === "applied-scene") {
      requireActiveTargetScene(records, targetScene!);
    }
    if (
      input.body.checkMode === "proposal-draft" &&
      input.body.sceneIds.includes(input.body.targetSceneId)
    ) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Proposal-draft checks must not include the assess scene in sceneIds."
      );
    }
  }
  validateSelectedScenes(records, selectedSceneIds);
  if (input.body.taskKind === "outline") {
    requireActiveTargetBook(records, bookId(input.body.targetBookId));
  }
  if (targetScene !== undefined && input.body.taskKind === "revise") {
    requireActiveTargetScene(records, targetScene);
  }
  const appliedCheckSceneIds =
    input.body.taskKind === "check" && input.body.checkMode === "applied-scene"
      ? [...new Set([targetScene!, ...selectedSceneIds])]
      : selectedSceneIds;
  const sceneHeads = await runtime.sceneDocuments.getHeads(
    input.body.taskKind === "check" ? appliedCheckSceneIds : selectedSceneIds
  );
  const captureHead = await selectedCaptureHead(
    runtime,
    records,
    input.body.taskKind === "character" ||
      input.body.taskKind === "check" ||
      input.body.taskKind === "outline"
      ? undefined
      : input.body.captureId
  );
  let proposalSource: Awaited<ReturnType<typeof resolveCheckProposalSource>> | undefined;
  if (input.body.taskKind === "check" && input.body.checkMode === "proposal-draft") {
    proposalSource = await resolveCheckProposalSource(
      runtime,
      records,
      input.accountId,
      input.projectId,
      targetScene!,
      storyWorkAssignmentId(input.body.sourceAssignmentId),
      artifactFromRequest(input.body.sourceArtifact)
    );
  }
  const now = runtime.clock.now();
  const destination =
    input.body.taskKind === "character"
      ? {
          kind: "story-knowledge" as const,
          storyKnowledgeId: storyKnowledgeId(runtime.ids.create("storyKnowledge")),
          operation: "create" as const
        }
      : input.body.taskKind === "outline"
        ? {
            kind: "book" as const,
            bookId: bookId(input.body.targetBookId),
            operation: "update" as const
          }
        : input.body.taskKind === "check"
          ? {
              kind: "scene" as const,
              sceneId: targetScene!,
              operation: "assess" as const
            }
          : input.body.taskKind === "scene"
            ? {
                kind: "scene" as const,
                sceneId: sceneId(runtime.ids.create("scene")),
                operation: "create" as const
              }
            : {
                kind: "scene" as const,
                sceneId: targetScene!,
                operation: "update" as const
              };
  const sources =
    input.body.taskKind === "check"
      ? await checkAssignmentSources(
          runtime,
          records,
          {
            checkMode: input.body.checkMode,
            targetSceneId: targetScene!,
            surroundingSceneIds: selectedSceneIds,
            ...(proposalSource === undefined ? {} : { proposalSource })
          },
          sceneHeads
        )
      : input.body.taskKind === "outline"
        ? outlineAssignmentSources(
            records,
            bookId(input.body.targetBookId),
            selectedSceneIds,
            sceneHeads
          )
        : assignmentSources(records, selectedSceneIds, sceneHeads, captureHead);
  const assignment = createStoryWorkAssignment({
    id: storyWorkAssignmentId(runtime.createAssignmentId()),
    projectId: input.projectId,
    initiatorAccountId: input.accountId,
    version: 1,
    taskKind: input.body.taskKind,
    brief: input.body.brief,
    constraints: input.body.constraints,
    doneWhen: input.body.doneWhen,
    sources,
    destination,
    provider: providerForAgentModel(input.body.model),
    model: input.body.model,
    status: "brief-ready",
    steps: [
      input.body.taskKind === "character"
        ? {
            id: "draft-character",
            title: "Draft character dossier",
            dependencies: []
          }
        : input.body.taskKind === "outline"
          ? {
              id: "structure",
              title: "Propose structure",
              dependencies: []
            }
          : input.body.taskKind === "check"
            ? {
                id: "check-continuity",
                title: "Run continuity check",
                dependencies: []
              }
            : {
                id: "draft-scene",
                title:
                  input.body.taskKind === "scene"
                    ? "Draft new scene"
                    : "Draft scene revision",
                dependencies: []
              }
    ],
    results: [],
    idempotencyKey: input.body.idempotencyKey,
    ...(input.trustedOrigin === undefined ? {} : { origin: input.trustedOrigin }),
    createdAt: now,
    updatedAt: now
  });
  const created = await runtime.assignments.create({
    assignment,
    requestFingerprint
  });
  if (!created.ok) {
    throw assignmentConflict(
      input.body.taskKind,
      "The assignment idempotency key was already used for different work."
    );
  }
  return Object.freeze({
    assignment: created.assignment,
    created: created.created
  });
}

export async function executeStoryWorkGenerationAttempt(
  dependencies: Dependencies,
  input: Readonly<{
    accountId: AccountId;
    projectId: ReturnType<typeof projectId>;
    assignmentId: ReturnType<typeof storyWorkAssignmentId>;
    body: GenerateStoryWorkRequest;
    signal?: AbortSignal;
  }>
): Promise<
  Readonly<{
    payload: unknown;
    status: 200 | 201;
  }>
> {
  const records = await requireOwnedRecords(
    dependencies.storyWork,
    input.accountId,
    input.projectId
  );
  const assignment = await dependencies.storyWork.assignments.get({
    accountId: input.accountId,
    projectId: input.projectId,
    assignmentId: input.assignmentId
  });
  if (assignment === undefined) throw new StoryWorkAssignmentNotFoundError();
  const sceneWork = assignment.taskKind === "scene" || assignment.taskKind === "revise";
  const checkWork = assignment.taskKind === "check";
  const outlineWork = assignment.taskKind === "outline";
  if (!sceneWork && !checkWork && !outlineWork && assignment.taskKind !== "character") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "This story work kind does not have a generation workflow."
    );
  }
  if ((checkWork || outlineWork) && input.body.kind !== "initial") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Story check and outline attempts support initial generation only in this slice."
    );
  }
  if (outlineWork && input.body.sourceMode !== "submitted-snapshot") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Outline story work requires submitted-snapshot source mode."
    );
  }
  const priorArtifact =
    input.body.priorArtifact === undefined
      ? undefined
      : artifactFromRequest(input.body.priorArtifact);
  if (checkWork) {
    const trustedCheck = await trustedCheckGenerationContext(
      dependencies.storyWork,
      assignment,
      records
    );
    const requestFingerprint = await storyCheckAttemptRequestFingerprint(
      {
        accountId: input.accountId,
        projectId: input.projectId,
        assignmentId: input.assignmentId,
        kind: input.body.kind,
        sourceMode: input.body.sourceMode,
        instruction: input.body.instruction,
        storyContext: trustedCheck.storyContext,
        target: trustedCheck.target,
        resources: trustedCheck.resources,
        ...(trustedCheck.targetSceneIntent === undefined
          ? {}
          : { targetSceneIntent: trustedCheck.targetSceneIntent }),
        ...(trustedCheck.chapterObjective === undefined
          ? {}
          : { chapterObjective: trustedCheck.chapterObjective })
      },
      dependencies.storyWork.hashPort
    );
    const replay = await dependencies.storyWork.checkGenerationReplay.findReplay({
      accountId: input.accountId,
      projectId: input.projectId,
      assignmentId: input.assignmentId,
      idempotencyKey: storyWorkAttemptIdempotencyKey(input.body.idempotencyKey),
      requestFingerprint
    });
    if (replay !== undefined) {
      return Object.freeze({
        payload: { kind: "replayed", state: replay },
        status: 200
      });
    }
    const checkProvider =
      await dependencies.agentProvider.createCompletionProviderForModel({
        accountId: input.accountId,
        model: assignment.model,
        providerId: assignment.provider
      });
    const result = await dependencies.storyWork.checkGeneration.generate({
      accountId: input.accountId,
      projectId: input.projectId,
      assignmentId: input.assignmentId,
      expectedAssignmentVersion: input.body.expectedAssignmentVersion,
      kind: input.body.kind,
      sourceMode: input.body.sourceMode,
      instruction: input.body.instruction,
      idempotencyKey: input.body.idempotencyKey,
      storyContext: trustedCheck.storyContext,
      target: trustedCheck.target,
      resources: trustedCheck.resources,
      ...(trustedCheck.targetSceneIntent === undefined
        ? {}
        : { targetSceneIntent: trustedCheck.targetSceneIntent }),
      ...(trustedCheck.chapterObjective === undefined
        ? {}
        : { chapterObjective: trustedCheck.chapterObjective }),
      provider: checkProvider,
      signal: input.signal
    });
    return Object.freeze({
      payload: result,
      status: result.kind === "replayed" ? 200 : 201
    });
  }
  if (outlineWork) {
    const trustedStructure = await trustedStructureGenerationContext(
      dependencies.storyWork,
      assignment,
      records
    );
    const requestFingerprint = await storyStructureAttemptRequestFingerprint(
      {
        accountId: input.accountId,
        projectId: input.projectId,
        assignmentId: input.assignmentId,
        kind: input.body.kind,
        sourceMode: input.body.sourceMode,
        instruction: input.body.instruction,
        projectRecords: records,
        storyContext: trustedStructure.storyContext,
        resources: trustedStructure.resources,
        trustedLoweringContext: trustedStructure.trustedLoweringContext,
        targetBookId: trustedStructure.targetBookId
      },
      dependencies.storyWork.hashPort
    );
    const replay = await dependencies.storyWork.structureGenerationReplay.findReplay({
      accountId: input.accountId,
      projectId: input.projectId,
      assignmentId: input.assignmentId,
      idempotencyKey: storyWorkAttemptIdempotencyKey(input.body.idempotencyKey),
      requestFingerprint
    });
    if (replay !== undefined) {
      return Object.freeze({
        payload: { kind: "replayed", state: replay },
        status: 200
      });
    }
    const structureProvider =
      await dependencies.agentProvider.createCompletionProviderForModel({
        accountId: input.accountId,
        model: assignment.model,
        providerId: assignment.provider
      });
    const result = await dependencies.storyWork.structureGeneration.generate({
      accountId: input.accountId,
      projectId: input.projectId,
      assignmentId: input.assignmentId,
      expectedAssignmentVersion: input.body.expectedAssignmentVersion,
      kind: input.body.kind,
      sourceMode: input.body.sourceMode,
      instruction: input.body.instruction,
      idempotencyKey: input.body.idempotencyKey,
      projectRecords: records,
      storyContext: trustedStructure.storyContext,
      resources: trustedStructure.resources,
      trustedLoweringContext: trustedStructure.trustedLoweringContext,
      provider: structureProvider,
      signal: input.signal
    });
    return Object.freeze({
      payload: result,
      status: result.kind === "replayed" ? 200 : 201
    });
  }
  const requestFingerprint = await (sceneWork
    ? sceneStoryWorkAttemptRequestFingerprint
    : characterStoryWorkAttemptRequestFingerprint)(
    {
      accountId: input.accountId,
      projectId: input.projectId,
      assignmentId: input.assignmentId,
      kind: input.body.kind,
      sourceMode: input.body.sourceMode,
      instruction: input.body.instruction,
      ...(priorArtifact === undefined ? {} : { priorArtifact })
    },
    dependencies.storyWork.hashPort
  );
  const replay = await (sceneWork
    ? dependencies.storyWork.sceneGenerationReplay
    : dependencies.storyWork.characterGenerationReplay
  ).findReplay({
    accountId: input.accountId,
    projectId: input.projectId,
    assignmentId: input.assignmentId,
    idempotencyKey: storyWorkAttemptIdempotencyKey(input.body.idempotencyKey),
    requestFingerprint
  });
  if (replay !== undefined) {
    return Object.freeze({
      payload: { kind: "replayed", state: replay },
      status: 200
    });
  }
  const trusted = await trustedGenerationContext(
    dependencies.storyWork,
    assignment,
    records
  );
  const provider = await dependencies.agentProvider.createCompletionProviderForModel({
    accountId: input.accountId,
    model: assignment.model,
    providerId: assignment.provider
  });
  const generationInput = {
    accountId: input.accountId,
    projectId: input.projectId,
    assignmentId: input.assignmentId,
    expectedAssignmentVersion: input.body.expectedAssignmentVersion,
    kind: input.body.kind,
    sourceMode: input.body.sourceMode,
    instruction: input.body.instruction,
    ...(priorArtifact === undefined ? {} : { priorArtifact }),
    idempotencyKey: input.body.idempotencyKey,
    storyContext: trusted.storyContext,
    provider,
    signal: input.signal
  };
  const result = sceneWork
    ? await dependencies.storyWork.sceneGeneration.generate({
        ...generationInput,
        resources: trusted.resources as readonly SceneStoryWorkResourceInput[]
      })
    : await dependencies.storyWork.characterGeneration.generate({
        ...generationInput,
        resources: trusted.resources.filter(
          (resource) => resource.resource.resourceClass !== "capture"
        ) as readonly CharacterStoryWorkResourceInput[]
      });
  return Object.freeze({
    payload: result,
    status: result.kind === "replayed" ? 200 : 201
  });
}

export function assertMcpGrantCoordinationCreateResources(
  record: McpGrantRecord,
  body: CreateStoryWorkCoordinationRequest
): void {
  requireGrantAllowsProjectStructureRead(record);
  for (const id of body.scene.sceneIds) {
    requireGrantAllowsScene(record, sceneId(id));
  }
  for (const id of body.check.surroundingSceneIds) {
    requireGrantAllowsScene(record, sceneId(id));
  }
}

export function assertMcpGrantCoordinationContinueMutation(
  record: McpGrantRecord,
  coordination: StoryWorkCoordination,
  surroundingSceneIds: readonly SceneId[]
): void {
  if (!grantOriginMatchesRecord(record, coordination.origin)) {
    throw new McpGrantResourceDeniedError();
  }
  requireGrantAllowsProjectStructureRead(record);
  for (const id of surroundingSceneIds) {
    requireGrantAllowsScene(record, id);
  }
}

export async function assertMcpGrantStructurePreviewAccess(
  runtime: StoryWorkApiRuntime,
  record: McpGrantRecord,
  assignmentId: ReturnType<typeof storyWorkAssignmentId>
): Promise<StoryWorkAssignment> {
  requireGrantAllowsProjectStructureRead(record);
  const assignment = await runtime.assignments.get({
    accountId: record.accountId,
    projectId: record.projectId,
    assignmentId
  });
  if (assignment === undefined) {
    throw new McpGrantResourceDeniedError();
  }
  requireGrantAllowsAssignment(record, assignmentId, assignment.origin);
  if (assignment.taskKind !== "outline") {
    throw new McpGrantResourceDeniedError();
  }
  return assignment;
}

export async function previewStructureStoryWorkForAssignment(
  runtime: StoryWorkApiRuntime,
  input: Readonly<{
    accountId: AccountId;
    projectId: ReturnType<typeof projectId>;
    assignmentId: ReturnType<typeof storyWorkAssignmentId>;
    body: PreviewStructureStoryWorkRequest;
  }>
): Promise<
  Readonly<
    | { ok: true; preview: unknown }
    | {
        ok: false;
        status: ContentfulStatusCode;
        body: Readonly<{
          error: string;
          code: string;
          missingRequired?: unknown;
        }>;
      }
  >
> {
  const records = await requireOwnedRecords(runtime, input.accountId, input.projectId);
  const assignment = await runtime.assignments.get({
    accountId: input.accountId,
    projectId: input.projectId,
    assignmentId: input.assignmentId
  });
  if (assignment === undefined) throw new StoryWorkAssignmentNotFoundError();
  if (assignment.taskKind !== "outline") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Only outline story work supports structure preview."
    );
  }
  if (assignment.version !== input.body.expectedAssignmentVersion) {
    throw new StoryStructureGenerationConflictError();
  }
  const artifact = artifactFromRequest(input.body.artifact);
  if (
    assignment.currentArtifact === undefined ||
    assignment.currentArtifact.proposalId !== artifact.proposalId ||
    assignment.currentArtifact.artifactVersion !== artifact.artifactVersion ||
    assignment.currentArtifact.contentHash !== artifact.contentHash
  ) {
    throw new StoryStructureStoryWorkArtifactMismatchError();
  }
  if (records.project.version !== input.body.expectedProjectVersion) {
    throw new ProjectVersionConflictError(input.projectId, input.body.expectedProjectVersion);
  }
  const proposalRecord = await runtime.proposals.get(artifact.proposalId);
  if (
    proposalRecord === undefined ||
    proposalRecord.projectId !== input.projectId ||
    proposalRecord.outputSchemaId !== STORY_STRUCTURE_SCHEMA_ID ||
    proposalRecord.contentHash !== artifact.contentHash
  ) {
    throw new StoryStructureStoryWorkArtifactMismatchError();
  }
  const proposal = validateStoryStructureProposalV1(proposalRecord.payload);
  const sceneIdsForHeads = records.scenes.map((scene) => scene.id);
  const sceneDocumentHeads =
    sceneIdsForHeads.length === 0
      ? new Map<SceneId, SceneDocumentHead>()
      : await runtime.sceneDocuments.getHeads(sceneIdsForHeads);
  const knownChecks = await collectStructurePreviewKnownChecks(
    runtime,
    input.accountId,
    input.projectId
  );
  const previewResult = await previewStoryStructureProposal({
    records,
    proposal,
    selectedOperationIds: input.body.selectedOperationIds.map(storyStructureOperationId),
    now: runtime.clock.now(),
    knownChecks,
    sceneDocumentHeads,
    hashPort: runtime.hashPort
  });
  if (!previewResult.ok) {
    return Object.freeze({
      ok: false as const,
      status: structurePreviewRefusalStatus(previewResult.code),
      body: Object.freeze({
        error: previewResult.message,
        code: previewResult.code,
        ...(previewResult.missingRequired === undefined
          ? {}
          : { missingRequired: previewResult.missingRequired })
      })
    });
  }
  return Object.freeze({ ok: true as const, preview: previewResult.preview });
}

export async function createStoryWorkCoordinationFromRequest(
  runtime: StoryWorkApiRuntime,
  input: Readonly<{
    accountId: AccountId;
    projectId: ReturnType<typeof projectId>;
    body: CreateStoryWorkCoordinationRequest;
    trustedOrigin?: McpStoryWorkOrigin;
  }>
): Promise<
  Readonly<{
    response: ReturnType<typeof coordinationCreateResponse>;
    status: 200 | 201;
  }>
> {
  const records = await requireOwnedRecords(runtime, input.accountId, input.projectId);
  const sceneDraftRequestFingerprint = await sceneDraftAssignmentRequestFingerprint(runtime, {
    accountId: input.accountId,
    projectId: input.projectId,
    expectedProjectVersion: input.body.expectedProjectVersion,
    body: input.body
  });
  const coordinationRequestFingerprint = await coordinationRequestFingerprintForCreate(runtime, {
    body: input.body,
    sceneDraftRequestFingerprint
  });
  const createReplay = await runtime.coordinationUnitOfWork.findCreateReplay({
    accountId: input.accountId,
    projectId: input.projectId,
    idempotencyKey: input.body.idempotencyKey,
    coordinationRequestFingerprint
  });
  if (createReplay !== undefined) {
    return Object.freeze({
      response: coordinationCreateResponse(createReplay),
      status: 200
    });
  }
  if (records.project.archivedAt !== undefined) throw new ProjectArchivedMutationError();
  if (records.project.version !== input.body.expectedProjectVersion) {
    throw new ProjectVersionConflictError(input.projectId, input.body.expectedProjectVersion);
  }
  const selectedSceneIds = input.body.scene.sceneIds.map(sceneId);
  validateSelectedScenes(records, selectedSceneIds);
  const surroundingSceneIds = input.body.check.surroundingSceneIds.map(sceneId);
  validateSelectedScenes(records, surroundingSceneIds);
  const sceneHeads = await runtime.sceneDocuments.getHeads(selectedSceneIds);
  const now = runtime.clock.now();
  const coordinationId = storyWorkCoordinationId(runtime.createCoordinationId());
  const sceneStepId = storyWorkCoordinationStepId(runtime.createCoordinationStepId());
  const checkStepId = storyWorkCoordinationStepId(runtime.createCoordinationStepId());
  const rootAssignmentId = storyWorkAssignmentId(runtime.createAssignmentId());
  const reservedSceneId = sceneId(runtime.ids.create("scene"));
  const payload = await buildCoordinationCreatePayload(runtime, {
    accountId: input.accountId,
    projectId: input.projectId,
    body: input.body,
    records,
    sceneHeads,
    coordinationId,
    sceneStepId,
    checkStepId,
    rootAssignmentId,
    reservedSceneId,
    now,
    rootAssignmentRequestFingerprint: sceneDraftRequestFingerprint,
    ...(input.trustedOrigin === undefined ? {} : { trustedOrigin: input.trustedOrigin })
  });
  const created = await runtime.coordinationUnitOfWork.create({
    accountId: input.accountId,
    projectId: input.projectId,
    coordination: payload.coordination,
    coordinationRequestFingerprint,
    rootAssignment: payload.rootAssignment,
    rootAssignmentRequestFingerprint: payload.rootAssignmentRequestFingerprint
  });
  return Object.freeze({
    response: coordinationCreateResponse(created),
    status: created.replayed ? 200 : 201
  });
}

export async function continueStoryWorkCoordinationStepFromRequest(
  runtime: StoryWorkApiRuntime,
  input: Readonly<{
    accountId: AccountId;
    projectId: ReturnType<typeof projectId>;
    coordinationId: StoryWorkCoordinationId;
    stepId: StoryWorkCoordinationStepId;
    body: ContinueStoryWorkCoordinationStepRequest;
  }>
): Promise<
  Readonly<{
    response: ReturnType<typeof coordinationBindResponse>;
    status: 200 | 201;
  }>
> {
  const expectedUpstreamArtifact = artifactFromRequest(input.body.expectedUpstreamArtifact);
  await requireOwnedRecords(runtime, input.accountId, input.projectId);
  const coordination = await runtime.coordinations.get({
    accountId: input.accountId,
    projectId: input.projectId,
    coordinationId: input.coordinationId
  });
  if (coordination === undefined) throw new StoryWorkAssignmentNotFoundError();
  const rootStepForReplay = coordination.steps.find(
    (step): step is Extract<(typeof coordination.steps)[number], { kind: "scene-draft" }> =>
      step.kind === "scene-draft"
  );
  if (rootStepForReplay === undefined) throw new StoryWorkAssignmentNotFoundError();
  const bindReplay = await runtime.coordinationUnitOfWork.findBindReplay({
    accountId: input.accountId,
    projectId: input.projectId,
    coordinationId: input.coordinationId,
    expectedCoordinationVersion: input.body.expectedCoordinationVersion,
    stepId: input.stepId,
    resolvedDependency: Object.freeze({
      stepId: rootStepForReplay.stepId,
      artifact: expectedUpstreamArtifact
    })
  });
  if (bindReplay !== undefined) {
    return Object.freeze({
      response: coordinationBindResponse(bindReplay),
      status: 200
    });
  }
  const records = await requireOwnedRecords(runtime, input.accountId, input.projectId);
  if (records.project.archivedAt !== undefined) {
    throw new ProjectArchivedMutationError();
  }
  if (coordination.version !== input.body.expectedCoordinationVersion) {
    throw new StoryWorkCoordinationTransitionError();
  }
  const childAssignments = await loadCoordinationChildAssignments(
    runtime,
    input.accountId,
    input.projectId,
    coordination
  );
  const rootStep = coordination.steps.find(
    (step): step is Extract<(typeof coordination.steps)[number], { kind: "scene-draft" }> =>
      step.kind === "scene-draft"
  );
  if (rootStep === undefined) throw new StoryWorkAssignmentNotFoundError();
  const rootAssignment = childAssignments.get(rootStep.assignmentId);
  if (rootAssignment === undefined) throw new StoryWorkAssignmentNotFoundError();
  const projection = projectStoryWorkCoordination({
    coordination,
    childAssignments
  });
  const stepProjection = projection.steps.find((candidate) => candidate.stepId === input.stepId);
  if (
    stepProjection === undefined ||
    stepProjection.state !== "ready" ||
    stepProjection.resolvedDependency === undefined ||
    !(
      stepProjection.resolvedDependency.artifact.proposalId ===
        expectedUpstreamArtifact.proposalId &&
      stepProjection.resolvedDependency.artifact.artifactVersion ===
        expectedUpstreamArtifact.artifactVersion &&
      stepProjection.resolvedDependency.artifact.contentHash ===
        expectedUpstreamArtifact.contentHash
    )
  ) {
    throw new StoryWorkCoordinationDependencyConflictError();
  }
  const now = runtime.clock.now();
  const checkAssignmentId = storyWorkAssignmentId(runtime.createAssignmentId());
  const bindPayload = await buildContinuityCheckBindPayload(runtime, {
    accountId: input.accountId,
    projectId: input.projectId,
    coordination,
    stepId: input.stepId,
    records,
    rootAssignment,
    expectedUpstreamArtifact,
    checkAssignmentId,
    now,
    ...(coordination.origin === undefined
      ? {}
      : { checkAssignmentOrigin: coordination.origin })
  });
  const bound = await runtime.coordinationUnitOfWork.bindProposalContinuityCheck({
    accountId: input.accountId,
    projectId: input.projectId,
    coordinationId: input.coordinationId,
    expectedCoordinationVersion: input.body.expectedCoordinationVersion,
    stepId: input.stepId,
    resolvedDependency: bindPayload.resolvedDependency,
    checkAssignment: bindPayload.checkAssignment,
    checkAssignmentRequestFingerprint: bindPayload.checkAssignmentRequestFingerprint,
    boundAt: now
  });
  return Object.freeze({
    response: coordinationBindResponse(bound),
    status: bound.replayed ? 200 : 201
  });
}

export function registerStoryWorkRoutes(
  app: Hono<StoryWorkEnvironment>,
  dependencies: Dependencies
): void {
  app.post("/api/projects/:projectId/story-work/assignments", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      submitStoryWorkRequestSchema
    );
    if (!parsed.success) return invalidRequestResponse(context, parsed);
    try {
      const owner = toAccountId(context.get("authSession").account.id);
      const id = projectId(context.req.param("projectId"));
      const created = await createStoryWorkAssignmentFromSubmitRequest(
        dependencies.storyWork,
        {
          accountId: owner,
          projectId: id,
          body: parsed.data
        }
      );
      return context.json(
        {
          assignment: assignmentResponse(created.assignment),
          created: created.created
        },
        created.created ? 201 : 200
      );
    } catch (error) {
      return handleRouteError(context, error);
    }
  });

  app.get("/api/projects/:projectId/story-work/assignments", async (context) => {
    const parsed = storyWorkAssignmentListQuerySchema.safeParse(context.req.query());
    if (!parsed.success) {
      return context.json({ error: "Invalid request.", code: "INVALID_REQUEST" }, 400);
    }
    try {
      const account = toAccountId(context.get("authSession").account.id);
      const id = projectId(context.req.param("projectId"));
      await requireOwnedRecords(dependencies.storyWork, account, id);
      const assignments = await dependencies.storyWork.assignments.listByProject({
        accountId: account,
        projectId: id,
        options: parsed.data
      });
      return context.json({ assignments: assignments.map(assignmentResponse) });
    } catch (error) {
      return handleRouteError(context, error);
    }
  });

  app.get(
    "/api/projects/:projectId/story-work/assignments/:assignmentId",
    async (context) => {
      try {
        const account = toAccountId(context.get("authSession").account.id);
        const id = projectId(context.req.param("projectId"));
        const assignmentId = storyWorkAssignmentId(context.req.param("assignmentId"));
        await requireOwnedRecords(dependencies.storyWork, account, id);
        const assignment = await dependencies.storyWork.assignments.get({
          accountId: account,
          projectId: id,
          assignmentId
        });
        if (assignment === undefined) throw new StoryWorkAssignmentNotFoundError();
        const detail = await buildStoryWorkAssignmentDetailResponse(
          dependencies.storyWork,
          account,
          id,
          assignment
        );
        return context.json(detail);
      } catch (error) {
        return handleRouteError(context, error);
      }
    }
  );

  app.post(
    "/api/projects/:projectId/story-work/assignments/:assignmentId/recover",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        recoverActiveStoryWorkAttemptRequestSchema
      );
      if (!parsed.success) return invalidRecoverRequestResponse(context, parsed);
      try {
        const account = toAccountId(context.get("authSession").account.id);
        const id = projectId(context.req.param("projectId"));
        const assignmentId = storyWorkAssignmentId(context.req.param("assignmentId"));
        await requireOwnedRecords(dependencies.storyWork, account, id);
        const result = await dependencies.storyWork.recovery.recoverActiveStoryWorkAttempt({
          accountId: account,
          projectId: id,
          assignmentId,
          expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
          runId: agentRunId(parsed.data.runId),
          action: parsed.data.action,
          completedAt: dependencies.storyWork.clock.now()
        });
        return context.json({
          replayed: result.replayed,
          assignment: assignmentResponse(result.assignment),
          attempt: result.attempt,
          run: result.run
        });
      } catch (error) {
        return handleRouteError(context, error);
      }
    }
  );

  app.post(
    "/api/projects/:projectId/story-work/assignments/:assignmentId/attempts",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        generateStoryWorkRequestSchema
      );
      if (!parsed.success) return invalidRequestResponse(context, parsed);
      try {
        const account = toAccountId(context.get("authSession").account.id);
        const id = projectId(context.req.param("projectId"));
        const assignmentId = storyWorkAssignmentId(context.req.param("assignmentId"));
        const result = await executeStoryWorkGenerationAttempt(dependencies, {
          accountId: account,
          projectId: id,
          assignmentId,
          body: parsed.data,
          signal: context.req.raw.signal
        });
        return context.json(result.payload, result.status);
      } catch (error) {
        return handleRouteError(context, error);
      }
    }
  );

  const reviewRoute = async (
    context: Context<StoryWorkEnvironment>,
    action: "open" | "edit" | "reject"
  ) => {
    try {
      const account = toAccountId(context.get("authSession").account.id);
      const id = projectId(context.req.param("projectId") ?? "");
      const assignmentId = storyWorkAssignmentId(
        context.req.param("assignmentId") ?? ""
      );
      await requireOwnedRecords(dependencies.storyWork, account, id);
      const assignment = await dependencies.storyWork.assignments.get({
        accountId: account,
        projectId: id,
        assignmentId
      });
      if (assignment === undefined) throw new StoryWorkAssignmentNotFoundError();
      const currentProposal = assignment.currentArtifact === undefined
        ? undefined
        : await dependencies.storyWork.proposals.get(
            assignment.currentArtifact.proposalId
          );
      if (
        currentProposal === undefined ||
        currentProposal.projectId !== id
      ) {
        throw new StoryWorkAssignmentNotFoundError();
      }
      const sceneReview = currentProposal.outputSchemaId === "scene-draft-v1";
      const checkReview = currentProposal.outputSchemaId === "story-check-findings-v1";
      const structureReview = currentProposal.outputSchemaId === STORY_STRUCTURE_SCHEMA_ID;
      if (
        !sceneReview &&
        !checkReview &&
        !structureReview &&
        currentProposal.outputSchemaId !== "character-create-v2"
      ) {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "This story work artifact does not have a review workflow."
        );
      }
      if (checkReview) {
        if (action === "edit" || action === "reject") {
          throw new DomainValidationError(
            "INVALID_AGENT_POLICY",
            "Check findings use resolve and complete review actions."
          );
        }
        const parsed = await parseJsonRequest(
          context.req.raw,
          openStoryWorkReviewRequestSchema
        );
        if (!parsed.success) return invalidRequestResponse(context, parsed);
        const result = await dependencies.storyWork.checkReview.review({
          accountId: account,
          projectId: id,
          assignmentId,
          expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
          artifact: artifactFromRequest(parsed.data.artifact),
          updatedAt: dependencies.storyWork.clock.now(),
          action: "open"
        });
        return context.json(result);
      }
      if (action === "edit") {
        if (structureReview) {
          const parsed = await parseJsonRequest(
            context.req.raw,
            editStructureStoryWorkReviewRequestSchema
          );
          if (!parsed.success) return invalidRequestResponse(context, parsed);
          const result = await dependencies.storyWork.structureReview.review({
            accountId: account,
            projectId: id,
            assignmentId,
            expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
            artifact: artifactFromRequest(parsed.data.artifact),
            updatedAt: dependencies.storyWork.clock.now(),
            action,
            payload: structurePayloadFromRequest(parsed.data.payload)
          });
          return context.json(result);
        }
        if (sceneReview) {
          const parsed = await parseJsonRequest(
            context.req.raw,
            editSceneStoryWorkReviewRequestSchema
          );
          if (!parsed.success) return invalidRequestResponse(context, parsed);
          const result = await dependencies.storyWork.sceneReview.review({
            accountId: account,
            projectId: id,
            assignmentId,
            expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
            artifact: artifactFromRequest(parsed.data.artifact),
            updatedAt: dependencies.storyWork.clock.now(),
            action,
            payload: scenePayloadFromRequest(parsed.data.payload)
          });
          return context.json(result);
        }
        const parsed = await parseJsonRequest(
          context.req.raw,
          editCharacterStoryWorkReviewRequestSchema
        );
        if (!parsed.success) return invalidRequestResponse(context, parsed);
        const result = await dependencies.storyWork.characterReview.review({
          accountId: account,
          projectId: id,
          assignmentId,
          expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
          artifact: artifactFromRequest(parsed.data.artifact),
          updatedAt: dependencies.storyWork.clock.now(),
          action,
          payload: characterPayloadFromRequest(parsed.data.payload)
        });
        return context.json(result);
      }
      const parsed = await parseJsonRequest(
        context.req.raw,
        openCharacterStoryWorkReviewRequestSchema
      );
      if (!parsed.success) return invalidRequestResponse(context, parsed);
      const reviewInput = {
        accountId: account,
        projectId: id,
        assignmentId,
        expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
        artifact: artifactFromRequest(parsed.data.artifact),
        updatedAt: dependencies.storyWork.clock.now(),
        action
      } as const;
      const result = sceneReview
        ? await dependencies.storyWork.sceneReview.review(reviewInput)
        : structureReview
          ? await dependencies.storyWork.structureReview.review(reviewInput)
          : await dependencies.storyWork.characterReview.review(reviewInput);
      return context.json(result);
    } catch (error) {
      return handleRouteError(context, error);
    }
  };

  app.post(
    "/api/projects/:projectId/story-work/assignments/:assignmentId/review/preview",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        previewStructureStoryWorkRequestSchema
      );
      if (!parsed.success) return invalidRequestResponse(context, parsed);
      try {
        const account = toAccountId(context.get("authSession").account.id);
        const id = projectId(context.req.param("projectId"));
        const assignmentId = storyWorkAssignmentId(context.req.param("assignmentId"));
        const previewResult = await previewStructureStoryWorkForAssignment(
          dependencies.storyWork,
          {
            accountId: account,
            projectId: id,
            assignmentId,
            body: parsed.data
          }
        );
        if (!previewResult.ok) {
          return context.json(previewResult.body, previewResult.status);
        }
        return context.json({ preview: previewResult.preview });
      } catch (error) {
        return handleRouteError(context, error);
      }
    }
  );

  app.post(
    "/api/projects/:projectId/story-work/assignments/:assignmentId/review/open",
    (context) => reviewRoute(context, "open")
  );
  app.patch(
    "/api/projects/:projectId/story-work/assignments/:assignmentId/review",
    (context) => reviewRoute(context, "edit")
  );
  app.post(
    "/api/projects/:projectId/story-work/assignments/:assignmentId/review/reject",
    (context) => reviewRoute(context, "reject")
  );

  app.patch(
    "/api/projects/:projectId/story-work/assignments/:assignmentId/review/findings/:findingId",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        resolveCheckStoryWorkFindingRequestSchema
      );
      if (!parsed.success) return invalidRequestResponse(context, parsed);
      try {
        const account = toAccountId(context.get("authSession").account.id);
        const id = projectId(context.req.param("projectId"));
        const assignmentId = storyWorkAssignmentId(context.req.param("assignmentId"));
        const findingId = context.req.param("findingId");
        await requireOwnedRecords(dependencies.storyWork, account, id);
        const result = await dependencies.storyWork.checkReview.review({
          accountId: account,
          projectId: id,
          assignmentId,
          expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
          artifact: artifactFromRequest(parsed.data.artifact),
          updatedAt: dependencies.storyWork.clock.now(),
          action: "resolve",
          findingId,
          resolution: parsed.data.resolution
        });
        return context.json(result);
      } catch (error) {
        return handleRouteError(context, error);
      }
    }
  );

  app.post(
    "/api/projects/:projectId/story-work/assignments/:assignmentId/review/complete",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        completeCheckStoryWorkReviewRequestSchema
      );
      if (!parsed.success) return invalidRequestResponse(context, parsed);
      try {
        const account = toAccountId(context.get("authSession").account.id);
        const id = projectId(context.req.param("projectId"));
        const assignmentId = storyWorkAssignmentId(context.req.param("assignmentId"));
        const records = await requireOwnedRecords(dependencies.storyWork, account, id);
        const assignment = await dependencies.storyWork.assignments.get({
          accountId: account,
          projectId: id,
          assignmentId
        });
        if (assignment === undefined) throw new StoryWorkAssignmentNotFoundError();
        if (
          assignment.taskKind !== "check" ||
          assignment.destination.kind !== "scene" ||
          assignment.destination.operation !== "assess"
        ) {
          throw new DomainValidationError(
            "INVALID_AGENT_POLICY",
            "Only check story work can complete findings review."
          );
        }
        const artifact = artifactFromRequest(parsed.data.artifact);
        const currentProposal = await dependencies.storyWork.proposals.get(artifact.proposalId);
        if (
          currentProposal === undefined ||
          currentProposal.projectId !== id ||
          currentProposal.outputSchemaId !== "story-check-findings-v1" ||
          currentProposal.contentHash !== artifact.contentHash ||
          assignment.currentArtifact === undefined ||
          assignment.currentArtifact.proposalId !== artifact.proposalId ||
          assignment.currentArtifact.artifactVersion !== artifact.artifactVersion ||
          assignment.currentArtifact.contentHash !== artifact.contentHash
        ) {
          throw new StoryCheckArtifactMismatchError();
        }
        const freshness = await checkFreshnessForProposal(
          dependencies.storyWork,
          assignment,
          records,
          currentProposal.payload
        );
        if (freshness.status === "needs-recheck") {
          throw new StoryCheckReviewStaleError();
        }
        const result = await dependencies.storyWork.checkReview.review({
          accountId: account,
          projectId: id,
          assignmentId,
          expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
          artifact,
          updatedAt: dependencies.storyWork.clock.now(),
          action: "complete",
          result: Object.freeze({
            kind: "story-check",
            sceneId: assignment.destination.sceneId,
            proposalId: artifact.proposalId,
            artifactVersion: artifact.artifactVersion,
            contentHash: artifact.contentHash
          })
        });
        return context.json(result);
      } catch (error) {
        return handleRouteError(context, error);
      }
    }
  );

  app.post(
    "/api/projects/:projectId/story-work/assignments/:assignmentId/apply",
    async (context) => {
      try {
        const account = toAccountId(context.get("authSession").account.id);
        const id = projectId(context.req.param("projectId"));
        await requireOwnedRecords(dependencies.storyWork, account, id);
        const assignmentId = storyWorkAssignmentId(context.req.param("assignmentId"));
        const assignment = await dependencies.storyWork.assignments.get({
          accountId: account,
          projectId: id,
          assignmentId
        });
        if (assignment === undefined) throw new StoryWorkAssignmentNotFoundError();
        if (assignment.taskKind === "check") {
          throw new DomainValidationError(
            "INVALID_AGENT_POLICY",
            "Check story work does not have an apply workflow."
          );
        }
        if (assignment.taskKind === "scene" || assignment.taskKind === "revise") {
          const parsed = await parseJsonRequest(
            context.req.raw,
            applySceneStoryWorkRequestSchema
          );
          if (!parsed.success) return invalidRequestResponse(context, parsed);
          const result = await dependencies.storyWork.sceneApply.applyScene({
            ...sceneApplyInputFromRequest(
              account,
              id,
              assignmentId,
              context.get("authSession").session.id,
              parsed.data
            ),
            appliedAt: dependencies.storyWork.clock.now()
          });
          return context.json(result);
        }
        if (assignment.taskKind === "outline") {
          const parsed = await parseJsonRequest(
            context.req.raw,
            applyStructureStoryWorkRequestSchema
          );
          if (!parsed.success) return invalidRequestResponse(context, parsed);
          const result = await dependencies.storyWork.structureApply.applyStructure({
            ...structureApplyInputFromRequest(account, id, assignmentId, parsed.data),
            appliedAt: dependencies.storyWork.clock.now()
          });
          return context.json(result);
        }
        if (assignment.taskKind !== "character") {
          throw new DomainValidationError(
            "INVALID_AGENT_POLICY",
            "This story work kind does not have an apply workflow."
          );
        }
        const parsed = await parseJsonRequest(
          context.req.raw,
          applyCharacterStoryWorkRequestSchema
        );
        if (!parsed.success) return invalidRequestResponse(context, parsed);
        const services = createCharacterStoryWorkServices({
          apply: dependencies.storyWork.apply,
          clock: dependencies.storyWork.clock
        });
        const result = await services.applyCharacterProposal({
          accountId: account,
          projectId: id,
          assignmentId,
          expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
          proposalId: agentProposalId(parsed.data.proposalId),
          expectedArtifactVersion: parsed.data.expectedArtifactVersion,
          expectedProposalContentHash: instructionContentHash(
            parsed.data.expectedProposalContentHash
          ),
          expectedProjectVersion: parsed.data.expectedProjectVersion
        });
        return context.json(result);
      } catch (error) {
        return handleRouteError(context, error);
      }
    }
  );

  app.post("/api/projects/:projectId/story-work/coordinations", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      createStoryWorkCoordinationRequestSchema
    );
    if (!parsed.success) return invalidStrictStoryWorkRequestResponse(context, parsed);
    try {
      const owner = toAccountId(context.get("authSession").account.id);
      const ownedProjectId = projectId(context.req.param("projectId"));
      const created = await createStoryWorkCoordinationFromRequest(dependencies.storyWork, {
        accountId: owner,
        projectId: ownedProjectId,
        body: parsed.data
      });
      return context.json(created.response, created.status);
    } catch (error) {
      return handleRouteError(context, error);
    }
  });

  app.get("/api/projects/:projectId/story-work/coordinations", async (context) => {
    try {
      const account = toAccountId(context.get("authSession").account.id);
      const ownedProjectId = projectId(context.req.param("projectId"));
      await requireOwnedRecords(dependencies.storyWork, account, ownedProjectId);
      const coordinations = await dependencies.storyWork.coordinations.listByProject({
        accountId: account,
        projectId: ownedProjectId
      });
      const items = await Promise.all(
        coordinations.map((coordination) =>
          buildCoordinationDetailResponse(
            dependencies.storyWork,
            account,
            ownedProjectId,
            coordination
          )
        )
      );
      return context.json({ coordinations: items });
    } catch (error) {
      return handleRouteError(context, error);
    }
  });

  app.get(
    "/api/projects/:projectId/story-work/coordinations/:coordinationId",
    async (context) => {
      try {
        const account = toAccountId(context.get("authSession").account.id);
        const ownedProjectId = projectId(context.req.param("projectId"));
        await requireOwnedRecords(dependencies.storyWork, account, ownedProjectId);
        const coordinationId = storyWorkCoordinationId(
          context.req.param("coordinationId")
        );
        const coordination = await dependencies.storyWork.coordinations.get({
          accountId: account,
          projectId: ownedProjectId,
          coordinationId
        });
        if (coordination === undefined) throw new StoryWorkAssignmentNotFoundError();
        const detail = await buildCoordinationDetailResponse(
          dependencies.storyWork,
          account,
          ownedProjectId,
          coordination
        );
        return context.json(detail);
      } catch (error) {
        return handleRouteError(context, error);
      }
    }
  );

  app.post(
    "/api/projects/:projectId/story-work/coordinations/:coordinationId/steps/:stepId/continue",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        continueStoryWorkCoordinationStepRequestSchema
      );
      if (!parsed.success) return invalidStrictStoryWorkRequestResponse(context, parsed);
      try {
        const owner = toAccountId(context.get("authSession").account.id);
        const ownedProjectId = projectId(context.req.param("projectId"));
        const coordinationId = storyWorkCoordinationId(
          context.req.param("coordinationId")
        );
        const stepId = storyWorkCoordinationStepId(context.req.param("stepId"));
        const bound = await continueStoryWorkCoordinationStepFromRequest(
          dependencies.storyWork,
          {
            accountId: owner,
            projectId: ownedProjectId,
            coordinationId,
            stepId,
            body: parsed.data
          }
        );
        return context.json(bound.response, bound.status);
      } catch (error) {
        return handleRouteError(context, error);
      }
    }
  );
}
