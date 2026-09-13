import {
  AgentProposalStateConflictError,
  AgentRunReceiptMismatchError,
  CharacterStoryWorkArtifactMismatchError,
  CharacterStoryWorkContextStaleError,
  CharacterStoryWorkGenerationConflictError,
  DomainValidationError,
  ProjectArchivedMutationError,
  ProjectVersionConflictError,
  StoryWorkAssignmentNotFoundError,
  StoryWorkAssignmentTransitionError,
  StoryWorkAttemptTransitionError,
  accountId as toAccountId,
  agentProposalId,
  assembleStorySceneResource,
  assembleStoryStructureResource,
  canonicalJsonStringify,
  chapterId,
  characterStoryWorkAttemptRequestFingerprint,
  createCharacterStoryWorkServices,
  createStoryWorkAssignment,
  instructionContentHash,
  projectId,
  providerForAgentModel,
  requireProjectOwner,
  sceneId,
  storyContextFromProjectRecords,
  storyKnowledgeId,
  storyWorkAssignmentId,
  storyWorkAssignmentRequestFingerprint,
  storyWorkAttemptIdempotencyKey,
  type AgentProposalRepository,
  type AgentRunRepository,
  type AsyncHashPort,
  type AccountId,
  type CharacterStoryWorkApplyUnitOfWork,
  type CharacterStoryWorkGenerationServices,
  type CharacterStoryWorkGenerationUnitOfWork,
  type CharacterStoryWorkReviewUnitOfWork,
  type CharacterCreateV2,
  type Clock,
  type ContextReceiptRepository,
  type IdGenerator,
  type ProjectRecords,
  type ProjectRepository,
  type SceneDocumentRepository,
  type SceneDocumentHead,
  type SceneId,
  type StoryContextScope,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment,
  type StoryWorkAssignmentRepository,
  type StoryWorkAttemptRepository,
  type StoryWorkSourceReference
} from "@ghostwriter/core";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Context, Hono } from "hono";
import type { AuthenticatedSession } from "./auth.js";
import { providerAgentErrorStatusAndBody } from "./provider-agent-api.js";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import {
  applyCharacterStoryWorkRequestSchema,
  editCharacterStoryWorkReviewRequestSchema,
  generateCharacterStoryWorkRequestSchema,
  openCharacterStoryWorkReviewRequestSchema,
  storyWorkAssignmentListQuerySchema,
  submitCharacterStoryWorkRequestSchema
} from "./story-work-api-contract.js";
import { parseJsonRequest } from "./api-contract.js";

type StoryWorkEnvironment = {
  Variables: { authSession: AuthenticatedSession };
};

export type StoryWorkApiRuntime = Readonly<{
  projects: ProjectRepository;
  sceneDocuments: SceneDocumentRepository;
  assignments: StoryWorkAssignmentRepository;
  attempts: StoryWorkAttemptRepository;
  proposals: AgentProposalRepository;
  runs: AgentRunRepository;
  receipts: ContextReceiptRepository;
  generation: CharacterStoryWorkGenerationServices;
  generationReplay: Pick<CharacterStoryWorkGenerationUnitOfWork, "findReplay">;
  review: CharacterStoryWorkReviewUnitOfWork;
  apply: CharacterStoryWorkApplyUnitOfWork;
  hashPort: AsyncHashPort;
  ids: IdGenerator;
  clock: Clock;
  createAssignmentId(): string;
}>;

type Dependencies = Readonly<{
  storyWork: StoryWorkApiRuntime;
  agentProvider: Pick<AgentProviderRuntime, "createCompletionProviderForModel">;
}>;

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
  if (
    error instanceof StoryWorkAssignmentTransitionError ||
    error instanceof CharacterStoryWorkGenerationConflictError ||
    error instanceof CharacterStoryWorkArtifactMismatchError ||
    error instanceof CharacterStoryWorkContextStaleError ||
    error instanceof AgentProposalStateConflictError ||
    error instanceof AgentRunReceiptMismatchError ||
    error instanceof StoryWorkAttemptTransitionError ||
    error instanceof ProjectVersionConflictError ||
    error instanceof ProjectArchivedMutationError
  ) {
    return {
      status: 409,
      body: {
        error: error.message,
        code: "code" in error && typeof error.code === "string"
          ? error.code
          : "STORY_WORK_CONFLICT"
      }
    };
  }
  if (error instanceof DomainValidationError) {
    return { status: 422, body: { error: error.message, code: error.code } };
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
  sceneHeads: ReadonlyMap<SceneId, SceneDocumentHead>
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
  return Object.freeze([scopeSource, ...explicitScenes]);
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
        "Character assignments require active scenes in the current project."
      );
    }
  }
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
    inclusionReason: "Canonical story structure selected for this character assignment.",
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
  return Object.freeze({
    storyContext,
    resources: Object.freeze([structure, ...sceneResources])
  });
}

function assignmentResponse(assignment: StoryWorkAssignment) {
  return Object.freeze({ ...assignment });
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

export function registerStoryWorkRoutes(
  app: Hono<StoryWorkEnvironment>,
  dependencies: Dependencies
): void {
  app.post("/api/projects/:projectId/story-work/assignments", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      submitCharacterStoryWorkRequestSchema
    );
    if (!parsed.success) return invalidRequestResponse(context, parsed);
    try {
      const owner = toAccountId(context.get("authSession").account.id);
      const id = projectId(context.req.param("projectId"));
      const records = await requireOwnedRecords(dependencies.storyWork, owner, id);
      const requestFingerprint = await assignmentRequestFingerprint(
        dependencies.storyWork,
        {
          accountId: owner,
          projectId: id,
          expectedProjectVersion: parsed.data.expectedProjectVersion,
          brief: parsed.data.brief,
          constraints: parsed.data.constraints,
          doneWhen: parsed.data.doneWhen,
          sceneIds: parsed.data.sceneIds,
          model: parsed.data.model
        }
      );
      const replay = await dependencies.storyWork.assignments.getByIdempotencyKey({
        accountId: owner,
        projectId: id,
        idempotencyKey: parsed.data.idempotencyKey
      });
      if (replay !== undefined) {
        if (replay.requestFingerprint !== requestFingerprint) {
          throw new CharacterStoryWorkGenerationConflictError(
            "The assignment idempotency key was already used for different work."
          );
        }
        return context.json(
          { assignment: assignmentResponse(replay.assignment), created: false },
          200
        );
      }
      if (records.project.archivedAt !== undefined) throw new ProjectArchivedMutationError();
      if (records.project.version !== parsed.data.expectedProjectVersion) {
        throw new ProjectVersionConflictError(id, parsed.data.expectedProjectVersion);
      }
      const selectedSceneIds = parsed.data.sceneIds.map(sceneId);
      validateSelectedScenes(records, selectedSceneIds);
      const sceneHeads = await dependencies.storyWork.sceneDocuments.getHeads(
        selectedSceneIds
      );
      const now = dependencies.storyWork.clock.now();
      const assignment = createStoryWorkAssignment({
        id: storyWorkAssignmentId(dependencies.storyWork.createAssignmentId()),
        projectId: id,
        initiatorAccountId: owner,
        version: 1,
        taskKind: "character",
        brief: parsed.data.brief,
        constraints: parsed.data.constraints,
        doneWhen: parsed.data.doneWhen,
        sources: assignmentSources(records, selectedSceneIds, sceneHeads),
        destination: {
          kind: "story-knowledge",
          storyKnowledgeId: storyKnowledgeId(
            dependencies.storyWork.ids.create("storyKnowledge")
          ),
          operation: "create"
        },
        provider: providerForAgentModel(parsed.data.model),
        model: parsed.data.model,
        status: "brief-ready",
        steps: [
          { id: "draft-character", title: "Draft character dossier", dependencies: [] }
        ],
        results: [],
        idempotencyKey: parsed.data.idempotencyKey,
        createdAt: now,
        updatedAt: now
      });
      const created = await dependencies.storyWork.assignments.create({
        assignment,
        requestFingerprint
      });
      if (!created.ok) {
        throw new CharacterStoryWorkGenerationConflictError(
          "The assignment idempotency key was already used for different work."
        );
      }
      return context.json(
        { assignment: assignmentResponse(created.assignment), created: created.created },
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
        const proposal = assignment.currentArtifact === undefined
          ? undefined
          : await dependencies.storyWork.proposals.get(
              assignment.currentArtifact.proposalId
            );
        const attemptRunId = assignment.latestAttemptId ??
          assignment.activeAttemptId ??
          proposal?.runId;
        if (attemptRunId === undefined) {
          return context.json({ assignment: assignmentResponse(assignment) });
        }
        const attempt = await dependencies.storyWork.attempts.get({
          accountId: account,
          projectId: id,
          assignmentId,
          runId: attemptRunId
        });
        const run = attempt === undefined
          ? undefined
          : await dependencies.storyWork.runs.get(attempt.runId);
        const receipt = run === undefined
          ? undefined
          : await dependencies.storyWork.receipts.get(run.receiptId);
        if (
          attempt === undefined ||
          run === undefined ||
          receipt === undefined ||
          run.projectId !== id ||
          run.initiatorAccountId !== account ||
          receipt.projectId !== id ||
          (assignment.currentArtifact !== undefined &&
            (proposal === undefined ||
              proposal.projectId !== id ||
              proposal.contentHash !== assignment.currentArtifact.contentHash))
        ) {
          throw new CharacterStoryWorkArtifactMismatchError();
        }
        return context.json({
          assignment: assignmentResponse(assignment),
          ...(proposal === undefined ? {} : { proposal }),
          run,
          receipt,
          attempt
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
        generateCharacterStoryWorkRequestSchema
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
        const priorArtifact = parsed.data.priorArtifact === undefined
          ? undefined
          : artifactFromRequest(parsed.data.priorArtifact);
        const requestFingerprint = await characterStoryWorkAttemptRequestFingerprint(
          {
            accountId: account,
            projectId: id,
            assignmentId,
            kind: parsed.data.kind,
            sourceMode: parsed.data.sourceMode,
            instruction: parsed.data.instruction,
            ...(priorArtifact === undefined ? {} : { priorArtifact })
          },
          dependencies.storyWork.hashPort
        );
        const replay = await dependencies.storyWork.generationReplay.findReplay({
          accountId: account,
          projectId: id,
          assignmentId,
          idempotencyKey: storyWorkAttemptIdempotencyKey(parsed.data.idempotencyKey),
          requestFingerprint
        });
        if (replay !== undefined) {
          return context.json({ kind: "replayed", state: replay });
        }
        const trusted = await trustedGenerationContext(
          dependencies.storyWork,
          assignment,
          records
        );
        const provider = await dependencies.agentProvider.createCompletionProviderForModel({
          accountId: account,
          model: assignment.model,
          providerId: assignment.provider
        });
        const result = await dependencies.storyWork.generation.generate({
          accountId: account,
          projectId: id,
          assignmentId,
          expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
          kind: parsed.data.kind,
          sourceMode: parsed.data.sourceMode,
          instruction: parsed.data.instruction,
          ...(priorArtifact === undefined
            ? {}
            : { priorArtifact }),
          idempotencyKey: parsed.data.idempotencyKey,
          storyContext: trusted.storyContext,
          resources: trusted.resources,
          provider,
          signal: context.req.raw.signal
        });
        return context.json(result, result.kind === "replayed" ? 200 : 201);
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
      if (action === "edit") {
        const parsed = await parseJsonRequest(
          context.req.raw,
          editCharacterStoryWorkReviewRequestSchema
        );
        if (!parsed.success) return invalidRequestResponse(context, parsed);
        const result = await dependencies.storyWork.review.review({
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
      const result = await dependencies.storyWork.review.review({
        accountId: account,
        projectId: id,
        assignmentId,
        expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
        artifact: artifactFromRequest(parsed.data.artifact),
        updatedAt: dependencies.storyWork.clock.now(),
        action
      });
      return context.json(result);
    } catch (error) {
      return handleRouteError(context, error);
    }
  };

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

  app.post(
    "/api/projects/:projectId/story-work/assignments/:assignmentId/apply",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        applyCharacterStoryWorkRequestSchema
      );
      if (!parsed.success) return invalidRequestResponse(context, parsed);
      try {
        const account = toAccountId(context.get("authSession").account.id);
        const id = projectId(context.req.param("projectId"));
        const services = createCharacterStoryWorkServices({
          apply: dependencies.storyWork.apply,
          clock: dependencies.storyWork.clock
        });
        const result = await services.applyCharacterProposal({
          accountId: account,
          projectId: id,
          assignmentId: storyWorkAssignmentId(context.req.param("assignmentId")),
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
}
