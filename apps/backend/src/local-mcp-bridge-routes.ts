import {
  CaptureNotFoundError,
  CharacterStoryWorkArtifactMismatchError,
  CharacterStoryWorkGenerationConflictError,
  DomainValidationError,
  McpGrantCaptureDeniedError,
  McpGrantNotFoundError,
  McpGrantResourceDeniedError,
  McpGrantToolDeniedError,
  ProjectVersionConflictError,
  ProviderCredentialNotFoundError,
  SceneStoryWorkArtifactMismatchError,
  SceneStoryWorkGenerationConflictError,
  StoryCheckArtifactMismatchError,
  StoryCheckGenerationConflictError,
  StoryStructureGenerationConflictError,
  StoryStructureStoryWorkArtifactMismatchError,
  StoryStructureStoryWorkContextStaleError,
  StoryStructureStoryWorkSelectionConflictError,
  StoryWorkCoordinationDependencyConflictError,
  StoryWorkCoordinationTransitionError,
  StoryWorkAssignmentNotFoundError,
  StoryWorkCoordinationNotFoundError,
  captureId,
  storyWorkAssignmentId,
  storyWorkCoordinationId,
  storyWorkCoordinationStepId,
  type ContextReceipt,
  type McpGrantRecord,
  type McpGrantToolName,
  type StartCaptureReflectionResult
} from "@ghostwriter/core";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { parseJsonRequest, parseOptionalJsonRequest } from "./api-contract.js";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import { ProviderCallsDisabledError } from "./agent-provider-runtime.js";
import {
  localMcpBridgeCharacterSubmitRequestSchema,
  localMcpBridgeCheckSubmitRequestSchema,
  localMcpBridgeSceneSubmitRequestSchema,
  localMcpBridgeStructureSubmitRequestSchema,
  localMcpBridgeStructurePreviewRequestSchema,
  createStoryWorkCoordinationRequestSchema,
  continueStoryWorkCoordinationStepRequestSchema,
  type LocalMcpBridgeAppliedSceneCheckSubmitRequest,
  type LocalMcpBridgeCharacterSubmitRequest,
  type LocalMcpBridgeCheckSubmitRequest,
  type LocalMcpBridgeProposalDraftCheckSubmitRequest,
  type LocalMcpBridgeSceneSubmitRequest,
  type LocalMcpBridgeStructureSubmitRequest,
  type SubmitStoryWorkRequest
} from "./story-work-api-contract.js";
import {
  assertMcpGrantStoryWorkSubmitResources,
  assertMcpGrantStructurePreviewAccess,
  assertMcpGrantCoordinationCreateResources,
  assertMcpGrantCoordinationContinueMutation,
  buildCoordinationDetailResponse,
  buildStoryWorkAssignmentDetailResponse,
  createStoryWorkAssignmentFromSubmitRequest,
  createStoryWorkCoordinationFromRequest,
  continueStoryWorkCoordinationStepFromRequest,
  previewStructureStoryWorkForAssignment,
  executeStoryWorkGenerationAttempt,
  listGrantVisibleStoryWorkAssignments,
  listGrantVisibleStoryWorkCoordinations,
  sanitizeStoryWorkAssignmentDetailForBridge,
  storyWorkAssignmentResponse,
  type StoryWorkRouteDependencies
} from "./story-work-api.js";

export const LOCAL_MCP_BRIDGE_NOT_FOUND_BODY = Object.freeze({
  error: "Not found.",
  code: "NOT_FOUND"
} as const);

export const LOCAL_MCP_BRIDGE_INTERNAL_ERROR_BODY = Object.freeze({
  error: "Request failed.",
  code: "INTERNAL_ERROR"
} as const);

export const LOCAL_MCP_BRIDGE_INVALID_REQUEST_BODY = Object.freeze({
  error: "Invalid request.",
  code: "INVALID_REQUEST"
} as const);

export const LOCAL_MCP_BRIDGE_CONFLICT_BODY = Object.freeze({
  error: "Request conflict.",
  code: "REQUEST_CONFLICT"
} as const);

export const LOCAL_MCP_BRIDGE_UNAVAILABLE_BODY = Object.freeze({
  error: "Service unavailable.",
  code: "SERVICE_UNAVAILABLE"
} as const);

export type LocalMcpBridgeDependencies = Readonly<{
  enabled: boolean;
  agentProvider: AgentProviderRuntime;
}>;

const localMcpBridgeStrictEmptyBodySchema = z.object({}).strict();

export function bridgeCaptureReflectionContextResponse(receipt: ContextReceipt) {
  return Object.freeze({
    id: receipt.id,
    projectId: receipt.projectId,
    workflowId: receipt.workflowId,
    receiptHash: receipt.receiptHash,
    model: receipt.model,
    createdAt: receipt.createdAt
  });
}

export function bridgeCaptureReflectionProposeResponse(
  result: StartCaptureReflectionResult
) {
  if (result.kind === "ready") {
    return Object.freeze({
      kind: result.kind,
      runId: result.run.id,
      proposalId: result.proposal.id,
      status: result.proposal.status
    });
  }
  return Object.freeze({
    kind: result.kind,
    runId: result.run.id,
    status: result.run.status
  });
}

async function requireStrictEmptyBridgeBody(request: Request): Promise<boolean> {
  const parsed = await parseOptionalJsonRequest(
    request,
    localMcpBridgeStrictEmptyBodySchema
  );
  return parsed.success;
}

function bridgeCaptureMutationErrorResponse(context: Context, error: unknown): Response {
  if (isBridgeReadRouteError(error)) {
    return bridgeNotFound(context);
  }
  if (isBridgeSubmitConflict(error)) {
    return context.json(LOCAL_MCP_BRIDGE_CONFLICT_BODY, 409);
  }
  if (isBridgeSubmitUnavailable(error)) {
    return context.json(LOCAL_MCP_BRIDGE_UNAVAILABLE_BODY, 503);
  }
  return bridgeInternalError(context, error);
}

function parseBearerGrantToken(
  authorizationHeader: string | undefined
): string | undefined {
  if (authorizationHeader === undefined) return undefined;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorizationHeader.trim());
  return match?.[1];
}

function isBridgeReadRouteError(error: unknown): boolean {
  return (
    error instanceof DomainValidationError || isBridgeNondisclosingError(error)
  );
}

function bridgeReadRouteErrorResponse(context: Context, error: unknown): Response {
  if (isBridgeReadRouteError(error)) {
    return bridgeNotFound(context);
  }
  return bridgeInternalError(context, error);
}

function isBridgeNondisclosingError(error: unknown): boolean {
  return (
    error instanceof McpGrantNotFoundError ||
    error instanceof McpGrantToolDeniedError ||
    error instanceof McpGrantResourceDeniedError ||
    error instanceof McpGrantCaptureDeniedError ||
    error instanceof CaptureNotFoundError ||
    error instanceof StoryWorkAssignmentNotFoundError ||
    error instanceof StoryWorkCoordinationNotFoundError ||
    error instanceof CharacterStoryWorkArtifactMismatchError ||
    error instanceof SceneStoryWorkArtifactMismatchError ||
    error instanceof StoryCheckArtifactMismatchError ||
    error instanceof StoryStructureStoryWorkArtifactMismatchError
  );
}

function isBridgeSubmitConflict(error: unknown): boolean {
  return (
    error instanceof CharacterStoryWorkGenerationConflictError ||
    error instanceof SceneStoryWorkGenerationConflictError ||
    error instanceof StoryCheckGenerationConflictError ||
    error instanceof StoryStructureGenerationConflictError ||
    error instanceof StoryStructureStoryWorkArtifactMismatchError ||
    error instanceof StoryStructureStoryWorkContextStaleError ||
    error instanceof StoryStructureStoryWorkSelectionConflictError ||
    error instanceof StoryWorkCoordinationDependencyConflictError ||
    error instanceof StoryWorkCoordinationTransitionError ||
    error instanceof ProjectVersionConflictError
  );
}

function bridgeMutationErrorResponse(context: Context, error: unknown): Response {
  if (isBridgeNondisclosingError(error)) {
    return bridgeNotFound(context);
  }
  if (error instanceof DomainValidationError) {
    return context.json(LOCAL_MCP_BRIDGE_INVALID_REQUEST_BODY, 422);
  }
  if (isBridgeSubmitConflict(error)) {
    return context.json(LOCAL_MCP_BRIDGE_CONFLICT_BODY, 409);
  }
  if (isBridgeSubmitUnavailable(error)) {
    return context.json(LOCAL_MCP_BRIDGE_UNAVAILABLE_BODY, 503);
  }
  return bridgeInternalError(context, error);
}

function isBridgeSubmitUnavailable(error: unknown): boolean {
  return (
    error instanceof ProviderCredentialNotFoundError ||
    error instanceof ProviderCallsDisabledError
  );
}

function storyWorkRouteDependencies(
  agentProvider: AgentProviderRuntime
): StoryWorkRouteDependencies {
  return Object.freeze({
    storyWork: agentProvider.storyWork,
    agentProvider
  });
}

function bridgeSubmitErrorResponse(context: Context, error: unknown): Response {
  if (isBridgeNondisclosingError(error)) {
    return bridgeNotFound(context);
  }
  if (error instanceof DomainValidationError) {
    return context.json(LOCAL_MCP_BRIDGE_INVALID_REQUEST_BODY, 422);
  }
  if (isBridgeSubmitConflict(error)) {
    return context.json(LOCAL_MCP_BRIDGE_CONFLICT_BODY, 409);
  }
  if (isBridgeSubmitUnavailable(error)) {
    return context.json(LOCAL_MCP_BRIDGE_UNAVAILABLE_BODY, 503);
  }
  return bridgeInternalError(context, error);
}

async function submitStoryWorkThroughBridge(
  context: Context,
  dependencies: LocalMcpBridgeDependencies,
  record: McpGrantRecord,
  submitBody: SubmitStoryWorkRequest,
  attemptInstruction: string,
  attemptIdempotencyKey: string
): Promise<Response> {
  await assertMcpGrantStoryWorkSubmitResources(
    dependencies.agentProvider.storyWork,
    record,
    submitBody
  );
  const routeDependencies = storyWorkRouteDependencies(dependencies.agentProvider);
  const created = await createStoryWorkAssignmentFromSubmitRequest(
    dependencies.agentProvider.storyWork,
    {
      accountId: record.accountId,
      projectId: record.projectId,
      body: submitBody,
      trustedOrigin: Object.freeze({ kind: "mcp", grantId: record.id })
    }
  );
  const generation = await executeStoryWorkGenerationAttempt(routeDependencies, {
    accountId: record.accountId,
    projectId: record.projectId,
    assignmentId: created.assignment.id,
    body: {
      expectedAssignmentVersion: created.assignment.version,
      kind: "initial",
      sourceMode: "submitted-snapshot",
      instruction: attemptInstruction,
      idempotencyKey: attemptIdempotencyKey
    },
    signal: context.req.raw.signal
  });
  const status = created.created || generation.status === 201 ? 201 : 200;
  return context.json(
    Object.freeze({
      assignment: storyWorkAssignmentResponse(created.assignment),
      created: created.created,
      generation: generation.payload
    }),
    status
  );
}

function characterBridgeSubmitBody(
  body: LocalMcpBridgeCharacterSubmitRequest
): SubmitStoryWorkRequest {
  return Object.freeze({
    taskKind: "character",
    idempotencyKey: body.assignmentIdempotencyKey,
    expectedProjectVersion: body.expectedProjectVersion,
    brief: body.brief,
    constraints: body.constraints,
    doneWhen: body.doneWhen,
    sceneIds: body.sceneIds,
    model: body.model
  });
}

function sceneBridgeSubmitBody(body: LocalMcpBridgeSceneSubmitRequest): SubmitStoryWorkRequest {
  return Object.freeze({
    taskKind: "scene",
    idempotencyKey: body.assignmentIdempotencyKey,
    expectedProjectVersion: body.expectedProjectVersion,
    brief: body.brief,
    constraints: body.constraints,
    doneWhen: body.doneWhen,
    sceneIds: body.sceneIds,
    model: body.model,
    ...(body.captureId === undefined ? {} : { captureId: body.captureId })
  });
}

function checkBridgeSubmitBody(body: LocalMcpBridgeCheckSubmitRequest): SubmitStoryWorkRequest {
  if (body.checkMode === "applied-scene") {
    const applied = body as LocalMcpBridgeAppliedSceneCheckSubmitRequest;
    return Object.freeze({
      taskKind: "check",
      specialist: applied.specialist,
      checkMode: applied.checkMode,
      targetSceneId: applied.targetSceneId,
      idempotencyKey: applied.assignmentIdempotencyKey,
      expectedProjectVersion: applied.expectedProjectVersion,
      brief: applied.brief,
      constraints: applied.constraints,
      doneWhen: applied.doneWhen,
      sceneIds: applied.sceneIds,
      model: applied.model
    });
  }
  const draft = body as LocalMcpBridgeProposalDraftCheckSubmitRequest;
  return Object.freeze({
    taskKind: "check",
    specialist: draft.specialist,
    checkMode: draft.checkMode,
    targetSceneId: draft.targetSceneId,
    sourceAssignmentId: draft.sourceAssignmentId,
    sourceArtifact: draft.sourceArtifact,
    idempotencyKey: draft.assignmentIdempotencyKey,
    expectedProjectVersion: draft.expectedProjectVersion,
    brief: draft.brief,
    constraints: draft.constraints,
    doneWhen: draft.doneWhen,
    sceneIds: draft.sceneIds,
    model: draft.model
  });
}

function structureBridgeSubmitBody(
  body: LocalMcpBridgeStructureSubmitRequest
): SubmitStoryWorkRequest {
  return Object.freeze({
    taskKind: "outline",
    targetBookId: body.targetBookId,
    idempotencyKey: body.assignmentIdempotencyKey,
    expectedProjectVersion: body.expectedProjectVersion,
    brief: body.brief,
    constraints: body.constraints,
    doneWhen: body.doneWhen,
    sceneIds: body.sceneIds,
    model: body.model
  });
}

function bridgeNotFound(context: Context) {
  return context.json(LOCAL_MCP_BRIDGE_NOT_FOUND_BODY, 404);
}

function bridgeInternalError(context: Context, error: unknown) {
  console.error("Local MCP bridge request failed.", {
    errorName: error instanceof Error ? error.name : "UnknownError"
  });
  return context.json(LOCAL_MCP_BRIDGE_INTERNAL_ERROR_BODY, 500);
}

async function withGrantTool(
  context: Context,
  dependencies: LocalMcpBridgeDependencies,
  tool: McpGrantToolName,
  handler: (input: Readonly<{ token: string }>) => Promise<Response>
): Promise<Response> {
  if (dependencies.enabled !== true) {
    return bridgeNotFound(context);
  }
  const token = parseBearerGrantToken(context.req.header("Authorization"));
  if (token === undefined) {
    return bridgeNotFound(context);
  }
  try {
    await dependencies.agentProvider.mcpGrants.requireToolUnderToken({ token, tool });
    return await handler({ token });
  } catch (error) {
    if (isBridgeNondisclosingError(error)) {
      return bridgeNotFound(context);
    }
    return bridgeInternalError(context, error);
  }
}

export function registerLocalMcpBridgeRoutes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mounted outside session env
  app: Hono<any>,
  dependencies: LocalMcpBridgeDependencies
): void {
  const respondDisabled = (context: Context) => bridgeNotFound(context);

  if (dependencies.enabled !== true) {
    app.all("/local-mcp/v1/*", respondDisabled);
    return;
  }

  app.get("/local-mcp/v1/grant", async (context) =>
    withGrantTool(context, dependencies, "ghostwriter_get_grant", async ({ token }) => {
      try {
        const grant = await dependencies.agentProvider.mcpGrants.getGrantUnderToken(
          token
        );
        return context.json({
          grant: Object.freeze({
            id: grant.id,
            projectId: grant.projectId,
            captureIds: grant.captureIds,
            sceneIds: grant.sceneIds,
            bookIds: grant.bookIds,
            assignmentIds: grant.assignmentIds,
            coordinationIds: grant.coordinationIds,
            allowProjectStructureRead: grant.allowProjectStructureRead,
            tools: grant.tools,
            expiresAt: grant.expiresAt
          })
        });
      } catch (error) {
        return bridgeReadRouteErrorResponse(context, error);
      }
    })
  );

  app.get("/local-mcp/v1/captures/:captureId", async (context) =>
    withGrantTool(context, dependencies, "ghostwriter_read_capture", async ({ token }) => {
      try {
        const summary = await dependencies.agentProvider.mcpGrants.readCaptureUnderToken({
          token,
          captureId: captureId(context.req.param("captureId"))
        });
        return context.json(summary);
      } catch (error) {
        return bridgeReadRouteErrorResponse(context, error);
      }
    })
  );

  app.post("/local-mcp/v1/captures/:captureId/context", async (context) =>
    withGrantTool(
      context,
      dependencies,
      "ghostwriter_assemble_capture_reflection_context",
      async ({ token }) => {
        if (!(await requireStrictEmptyBridgeBody(context.req.raw))) {
          return context.json(LOCAL_MCP_BRIDGE_INVALID_REQUEST_BODY, 422);
        }
        try {
          const receipt =
            await dependencies.agentProvider.mcpGrants.assembleCaptureReflectionContextUnderToken(
              {
                token,
                captureId: captureId(context.req.param("captureId"))
              }
            );
          return context.json(bridgeCaptureReflectionContextResponse(receipt));
        } catch (error) {
          return bridgeReadRouteErrorResponse(context, error);
        }
      }
    )
  );

  app.post("/local-mcp/v1/captures/:captureId/proposals", async (context) =>
    withGrantTool(
      context,
      dependencies,
      "ghostwriter_propose_capture_reflection",
      async ({ token }) => {
        if (!(await requireStrictEmptyBridgeBody(context.req.raw))) {
          return context.json(LOCAL_MCP_BRIDGE_INVALID_REQUEST_BODY, 422);
        }
        try {
          const captureIdValue = captureId(context.req.param("captureId"));
          const record =
            await dependencies.agentProvider.mcpGrants.requireToolUnderToken({
              token,
              tool: "ghostwriter_propose_capture_reflection"
            });
          const result =
            await dependencies.agentProvider.mcpGrants.proposeCaptureReflectionUnderToken(
              {
                token,
                captureId: captureIdValue,
                signal: context.req.raw.signal,
                createProvider: (receipt) =>
                  dependencies.agentProvider.createCompletionProviderForModel({
                    accountId: record.accountId,
                    model: receipt.model,
                    providerId: receipt.provider
                  })
              }
            );
          return context.json(bridgeCaptureReflectionProposeResponse(result));
        } catch (error) {
          return bridgeCaptureMutationErrorResponse(context, error);
        }
      }
    )
  );

  app.get("/local-mcp/v1/story-work", async (context) =>
    withGrantTool(
      context,
      dependencies,
      "ghostwriter_list_story_work",
      async ({ token }) => {
        try {
          const record =
            await dependencies.agentProvider.mcpGrants.requireToolUnderToken({
              token,
              tool: "ghostwriter_list_story_work"
            });
          const assignments = await listGrantVisibleStoryWorkAssignments(
            dependencies.agentProvider.storyWork,
            record
          );
          // Bounded recent authorized results; see listGrantVisibleStoryWorkAssignments.
          return context.json({
            assignments: assignments.map(storyWorkAssignmentResponse)
          });
        } catch (error) {
          return bridgeReadRouteErrorResponse(context, error);
        }
      }
    )
  );

  app.get("/local-mcp/v1/story-work/:assignmentId", async (context) =>
    withGrantTool(
      context,
      dependencies,
      "ghostwriter_get_story_work",
      async ({ token }) => {
        try {
          const record =
            await dependencies.agentProvider.mcpGrants.requireToolUnderToken({
              token,
              tool: "ghostwriter_get_story_work"
            });
          const assignmentId = storyWorkAssignmentId(
            context.req.param("assignmentId")
          );
          await dependencies.agentProvider.mcpGrants.assertAssignmentReadableUnderGrant(
            {
              record,
              assignmentId
            }
          );
          const assignment = await dependencies.agentProvider.storyWork.assignments.get(
            {
              accountId: record.accountId,
              projectId: record.projectId,
              assignmentId
            }
          );
          if (assignment === undefined) {
            throw new StoryWorkAssignmentNotFoundError();
          }
          const detail = await buildStoryWorkAssignmentDetailResponse(
            dependencies.agentProvider.storyWork,
            record.accountId,
            record.projectId,
            assignment
          );
          return context.json(sanitizeStoryWorkAssignmentDetailForBridge(detail));
        } catch (error) {
          return bridgeReadRouteErrorResponse(context, error);
        }
      }
    )
  );

  app.get("/local-mcp/v1/coordinations", async (context) =>
    withGrantTool(
      context,
      dependencies,
      "ghostwriter_list_story_work_coordinations",
      async ({ token }) => {
        try {
          const record =
            await dependencies.agentProvider.mcpGrants.requireToolUnderToken({
              token,
              tool: "ghostwriter_list_story_work_coordinations"
            });
          const coordinations = await listGrantVisibleStoryWorkCoordinations(
            dependencies.agentProvider.storyWork,
            record
          );
          const items = await Promise.all(
            coordinations.map((coordination) =>
              buildCoordinationDetailResponse(
                dependencies.agentProvider.storyWork,
                record.accountId,
                record.projectId,
                coordination
              )
            )
          );
          // Bounded recent authorized results; see listGrantVisibleStoryWorkCoordinations.
          return context.json({ coordinations: items });
        } catch (error) {
          return bridgeReadRouteErrorResponse(context, error);
        }
      }
    )
  );

  app.get("/local-mcp/v1/coordinations/:coordinationId", async (context) =>
    withGrantTool(
      context,
      dependencies,
      "ghostwriter_get_story_work_coordination",
      async ({ token }) => {
        try {
          const record =
            await dependencies.agentProvider.mcpGrants.requireToolUnderToken({
              token,
              tool: "ghostwriter_get_story_work_coordination"
            });
          const coordinationId = storyWorkCoordinationId(
            context.req.param("coordinationId")
          );
          await dependencies.agentProvider.mcpGrants.assertCoordinationReadableUnderGrant(
            {
              record,
              coordinationId
            }
          );
          const coordination =
            await dependencies.agentProvider.storyWork.coordinations.get({
              accountId: record.accountId,
              projectId: record.projectId,
              coordinationId
            });
          if (coordination === undefined) {
            throw new StoryWorkCoordinationNotFoundError();
          }
          const detail = await buildCoordinationDetailResponse(
            dependencies.agentProvider.storyWork,
            record.accountId,
            record.projectId,
            coordination
          );
          return context.json(detail);
        } catch (error) {
          return bridgeReadRouteErrorResponse(context, error);
        }
      }
    )
  );

  const registerSubmitRoute = (
    path: string,
    tool: McpGrantToolName,
    schema:
      | typeof localMcpBridgeCharacterSubmitRequestSchema
      | typeof localMcpBridgeSceneSubmitRequestSchema
      | typeof localMcpBridgeCheckSubmitRequestSchema
      | typeof localMcpBridgeStructureSubmitRequestSchema,
    toSubmit: (body: never) => SubmitStoryWorkRequest
  ) => {
    app.post(path, async (context) =>
      withGrantTool(context, dependencies, tool, async ({ token }) => {
        const parsed = await parseJsonRequest(context.req.raw, schema);
        if (!parsed.success) {
          return context.json(LOCAL_MCP_BRIDGE_INVALID_REQUEST_BODY, 422);
        }
        try {
          const record =
            await dependencies.agentProvider.mcpGrants.requireToolUnderToken({
              token,
              tool
            });
          const body = parsed.data as never;
          const submitBody = toSubmit(body);
          return await submitStoryWorkThroughBridge(
            context,
            dependencies,
            record,
            submitBody,
            (body as { brief: string }).brief,
            (body as { attemptIdempotencyKey: string }).attemptIdempotencyKey
          );
        } catch (error) {
          return bridgeSubmitErrorResponse(context, error);
        }
      })
    );
  };

  registerSubmitRoute(
    "/local-mcp/v1/story-work/character",
    "ghostwriter_submit_character_work",
    localMcpBridgeCharacterSubmitRequestSchema,
    characterBridgeSubmitBody as (body: never) => SubmitStoryWorkRequest
  );
  registerSubmitRoute(
    "/local-mcp/v1/story-work/scene",
    "ghostwriter_submit_scene_work",
    localMcpBridgeSceneSubmitRequestSchema,
    sceneBridgeSubmitBody as (body: never) => SubmitStoryWorkRequest
  );
  registerSubmitRoute(
    "/local-mcp/v1/story-work/check",
    "ghostwriter_submit_check_work",
    localMcpBridgeCheckSubmitRequestSchema,
    checkBridgeSubmitBody as (body: never) => SubmitStoryWorkRequest
  );
  registerSubmitRoute(
    "/local-mcp/v1/story-work/structure",
    "ghostwriter_submit_structure_work",
    localMcpBridgeStructureSubmitRequestSchema,
    structureBridgeSubmitBody as (body: never) => SubmitStoryWorkRequest
  );

  app.post("/local-mcp/v1/story-work/structure/preview", async (context) =>
    withGrantTool(
      context,
      dependencies,
      "ghostwriter_preview_story_structure",
      async ({ token }) => {
        const parsed = await parseJsonRequest(
          context.req.raw,
          localMcpBridgeStructurePreviewRequestSchema
        );
        if (!parsed.success) {
          return context.json(LOCAL_MCP_BRIDGE_INVALID_REQUEST_BODY, 422);
        }
        try {
          const record =
            await dependencies.agentProvider.mcpGrants.requireToolUnderToken({
              token,
              tool: "ghostwriter_preview_story_structure"
            });
          const assignmentId = storyWorkAssignmentId(parsed.data.assignmentId);
          await assertMcpGrantStructurePreviewAccess(
            dependencies.agentProvider.storyWork,
            record,
            assignmentId
          );
          const previewResult = await previewStructureStoryWorkForAssignment(
            dependencies.agentProvider.storyWork,
            {
              accountId: record.accountId,
              projectId: record.projectId,
              assignmentId,
              body: parsed.data
            }
          );
          if (!previewResult.ok) {
            return context.json(previewResult.body, previewResult.status);
          }
          return context.json({ preview: previewResult.preview });
        } catch (error) {
          return bridgeMutationErrorResponse(context, error);
        }
      }
    )
  );

  app.post("/local-mcp/v1/coordinations", async (context) =>
    withGrantTool(
      context,
      dependencies,
      "ghostwriter_create_story_work_coordination",
      async ({ token }) => {
        const parsed = await parseJsonRequest(
          context.req.raw,
          createStoryWorkCoordinationRequestSchema
        );
        if (!parsed.success) {
          return context.json(LOCAL_MCP_BRIDGE_INVALID_REQUEST_BODY, 422);
        }
        try {
          const record =
            await dependencies.agentProvider.mcpGrants.requireToolUnderToken({
              token,
              tool: "ghostwriter_create_story_work_coordination"
            });
          assertMcpGrantCoordinationCreateResources(record, parsed.data);
          const created = await createStoryWorkCoordinationFromRequest(
            dependencies.agentProvider.storyWork,
            {
              accountId: record.accountId,
              projectId: record.projectId,
              body: parsed.data,
              trustedOrigin: Object.freeze({ kind: "mcp", grantId: record.id })
            }
          );
          return context.json(created.response, created.status);
        } catch (error) {
          return bridgeMutationErrorResponse(context, error);
        }
      }
    )
  );

  app.post(
    "/local-mcp/v1/coordinations/:coordinationId/steps/:stepId/continue",
    async (context) =>
      withGrantTool(
        context,
        dependencies,
        "ghostwriter_continue_story_work_coordination",
        async ({ token }) => {
          const parsed = await parseJsonRequest(
            context.req.raw,
            continueStoryWorkCoordinationStepRequestSchema
          );
          if (!parsed.success) {
            return context.json(LOCAL_MCP_BRIDGE_INVALID_REQUEST_BODY, 422);
          }
          try {
            const record =
              await dependencies.agentProvider.mcpGrants.requireToolUnderToken({
                token,
                tool: "ghostwriter_continue_story_work_coordination"
              });
            const coordinationId = storyWorkCoordinationId(
              context.req.param("coordinationId")
            );
            const stepId = storyWorkCoordinationStepId(context.req.param("stepId"));
            const coordination =
              await dependencies.agentProvider.storyWork.coordinations.get({
                accountId: record.accountId,
                projectId: record.projectId,
                coordinationId
              });
            if (coordination === undefined) {
              throw new StoryWorkCoordinationNotFoundError();
            }
            const step = coordination.steps.find(
              (candidate) => candidate.stepId === stepId
            );
            const surroundingSceneIds =
              step?.kind === "proposal-continuity-check"
                ? (step.deferred.surroundingSceneIds ?? []).map((id) => id)
                : [];
            assertMcpGrantCoordinationContinueMutation(
              record,
              coordination,
              surroundingSceneIds
            );
            const bound = await continueStoryWorkCoordinationStepFromRequest(
              dependencies.agentProvider.storyWork,
              {
                accountId: record.accountId,
                projectId: record.projectId,
                coordinationId,
                stepId,
                body: parsed.data
              }
            );
            return context.json(bound.response, bound.status);
          } catch (error) {
            return bridgeMutationErrorResponse(context, error);
          }
        }
      )
  );

  app.all("/local-mcp/v1/*", respondDisabled);
}
