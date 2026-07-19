import {
  accountId,
  BookNotFoundError,
  BookReaderTooLargeError,
  bookId,
  CanvasCommandError,
  CanvasNotFoundError,
  CanvasRevisionNotFoundError,
  CanvasVersionConflictError,
  DomainValidationError,
  InvalidSceneDocumentError,
  InvalidSceneVariantNameError,
  ProfileConflictError,
  ProjectAccessDeniedError,
  ProjectCommandError,
  ProjectVersionConflictError,
  projectId,
  SceneLeaseConflictError,
  SceneLeaseExpiredError,
  SceneNotFoundError,
  SceneRevisionNotFoundError,
  sceneId,
  SceneVariantNameConflictError,
  SceneWorkingVersionConflictError,
  type BookReaderProjection,
  type BookReaderServices,
  type CanvasRevisionMetadata,
  type CanvasServices,
  type CanvasWorkspace,
  buildDeterministicWritingAssistProposals,
  type GhostwriterServices,
  type IdentityServices,
  type WritingAssistRole,
  storyKnowledgeId,
  type SceneDocumentHead,
  type SceneRevisionMetadata,
  type SceneVariant,
  type SceneWritingServices,
  type SceneWorkspace
} from "@ghostwriter/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  compareSceneRevisionsRequestSchema,
  createSceneFromCanvasRequestSchema,
  createProjectRequestSchema,
  createSceneCheckpointRequestSchema,
  createSceneVariantRequestSchema,
  executeProjectCommandRequestSchema,
  executeCanvasCommandRequestSchema,
  restoreSceneRevisionRequestSchema,
  restoreCanvasRequestSchema,
  saveCanvasPreferenceRequestSchema,
  parseJsonRequest,
  saveSceneDocumentRequestSchema,
  SCENE_DOCUMENT_REQUEST_MAX_BYTES,
  toCanvasCommand,
  toCreateSceneFromCanvasInput,
  toProjectCommand,
  updateProfileRequestSchema,
  writingAssistRequestSchema
} from "./api-contract.js";
import type { AuthGateway, AuthenticatedSession } from "./auth.js";
import {
  ElevenLabsVoicePort,
  toReaderVoicePack,
  type VoiceSynthesisPort
} from "./voice.js";
import { z } from "zod";
import { GHOSTWRITER_CAPABILITIES } from "@ghostwriter/core";

export type BackendDependencies = Readonly<{
  services: GhostwriterServices;
  writing: SceneWritingServices;
  canvas: CanvasServices;
  reader: BookReaderServices;
  identity: IdentityServices;
  auth: AuthGateway;
  allowedOrigins?: readonly string[];
  voice?: VoiceSynthesisPort;
}>;

const readerSpeakRequestSchema = z.object({
  text: z.string().trim().min(1).max(2_400),
  voice: z.enum(["default", "narrative", "noir", "soft"]).optional()
});

const workspaceChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  projectId: z.string().trim().min(1).max(200).optional()
});

type BackendEnvironment = {
  Variables: {
    authSession: AuthenticatedSession;
  };
};

function sceneHeadResponse(head: SceneDocumentHead) {
  return {
    sceneId: head.sceneId,
    projectId: head.projectId,
    workingVersion: head.workingVersion,
    document: head.document,
    contentHash: head.contentHash,
    checkpointRevisionId: head.checkpointRevisionId,
    updatedByAccountId: head.updatedByAccountId,
    createdAt: head.createdAt,
    updatedAt: head.updatedAt
  };
}

function sceneHeadMetadataResponse(head: SceneDocumentHead) {
  return {
    sceneId: head.sceneId,
    projectId: head.projectId,
    workingVersion: head.workingVersion,
    contentHash: head.contentHash,
    checkpointRevisionId: head.checkpointRevisionId,
    updatedByAccountId: head.updatedByAccountId,
    createdAt: head.createdAt,
    updatedAt: head.updatedAt
  };
}

function sceneRevisionResponse(revision: SceneRevisionMetadata) {
  return {
    id: revision.id,
    sceneId: revision.sceneId,
    projectId: revision.projectId,
    ...(revision.parentRevisionId === undefined
      ? {}
      : { parentRevisionId: revision.parentRevisionId }),
    schemaVersion: revision.schemaVersion,
    contentHash: revision.contentHash,
    actorAccountId: revision.actorAccountId,
    origin: revision.origin,
    reason: revision.reason,
    createdAt: revision.createdAt
  };
}

function sceneVariantResponse(variant: SceneVariant) {
  return {
    id: variant.id,
    sceneId: variant.sceneId,
    projectId: variant.projectId,
    revisionId: variant.revisionId,
    creatorAccountId: variant.creatorAccountId,
    name: variant.name,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt
  };
}

function sceneWorkspaceResponse(
  workspace: SceneWorkspace,
  currentSessionId: string
) {
  return {
    head: sceneHeadResponse(workspace.head),
    lease:
      workspace.lease === undefined
        ? null
        : {
            heldByCurrentSession:
              workspace.lease.holderId === currentSessionId,
            renewedAt: workspace.lease.renewedAt,
            expiresAt: workspace.lease.expiresAt
          }
  };
}

function canvasWorkspaceResponse(workspace: CanvasWorkspace) {
  return {
    board: workspace.board,
    spine: workspace.spine
  };
}

function bookReaderResponse(projection: BookReaderProjection) {
  return {
    projectId: projection.projectId,
    bookId: projection.bookId,
    bookTitle: projection.bookTitle,
    ...(projection.pinSceneId === undefined
      ? {}
      : { pinSceneId: projection.pinSceneId }),
    scenes: projection.scenes.map((scene) => ({
      sceneId: scene.sceneId,
      title: scene.title,
      status: scene.status,
      ...(scene.summary === undefined ? {} : { summary: scene.summary }),
      ...(scene.chapterId === undefined ? {} : { chapterId: scene.chapterId }),
      ...(scene.chapterTitle === undefined
        ? {}
        : { chapterTitle: scene.chapterTitle }),
      ...(scene.partId === undefined ? {} : { partId: scene.partId }),
      ...(scene.partTitle === undefined ? {} : { partTitle: scene.partTitle }),
      placement: scene.placement,
      document: scene.document,
      workingVersion: scene.workingVersion,
      ...(scene.contentHash === undefined ? {} : { contentHash: scene.contentHash }),
      links: scene.links
    })),
    chapters: projection.chapters,
    totals: projection.totals
  };
}

function canvasRevisionResponse(revision: CanvasRevisionMetadata) {
  return {
    id: revision.id,
    projectId: revision.projectId,
    boardVersion: revision.boardVersion,
    contentHash: revision.contentHash,
    actorAccountId: revision.actorAccountId,
    reason: revision.reason,
    ...(revision.commandType === undefined
      ? {}
      : { commandType: revision.commandType }),
    ...(revision.parentRevisionId === undefined
      ? {}
      : { parentRevisionId: revision.parentRevisionId }),
    createdAt: revision.createdAt
  };
}

export function createApp(dependencies: BackendDependencies): Hono<BackendEnvironment> {
  const app = new Hono<BackendEnvironment>();
  const allowedOrigins = new Set(dependencies.allowedOrigins ?? []);

  app.use(
    "/api/*",
    cors({
      origin(origin) {
        return allowedOrigins.has(origin) ? origin : "";
      },
      allowHeaders: ["Content-Type", "Idempotency-Key"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
      maxAge: 600
    })
  );

  app.get("/health", (context) => context.json({ status: "ok" }));

  app.on(["GET", "POST"], "/api/auth/*", (context) =>
    dependencies.auth.handler(context.req.raw)
  );

  app.use("/api/*", async (context, next) => {
    const session = await dependencies.auth.getSession(context.req.raw.headers);

    if (session === null) {
      return context.json({ error: "Authentication required.", code: "UNAUTHENTICATED" }, 401);
    }

    context.set("authSession", session);

    if (["POST", "PUT", "PATCH", "DELETE"].includes(context.req.method)) {
      const origin = context.req.header("origin");
      if (origin === undefined || !allowedOrigins.has(origin)) {
        return context.json(
          { error: "Request origin is not trusted.", code: "UNTRUSTED_ORIGIN" },
          403
        );
      }
    }

    await next();
  });

  app.get("/api/me", async (context) => {
    const { account, session } = context.get("authSession");
    const profile = await dependencies.identity.ensureWriterProfile({
      accountId: accountId(account.id),
      providerDisplayName: account.name
    });
    return context.json({ account, profile, session });
  });

  app.patch("/api/me/profile", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      updateProfileRequestSchema
    );
    if (!parsed.success) {
      return context.json(
        {
          error: "Invalid request.",
          code: parsed.code,
          ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
        },
        parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
      );
    }
    const authSession = context.get("authSession");
    await dependencies.identity.ensureWriterProfile({
      accountId: accountId(authSession.account.id),
      providerDisplayName: authSession.account.name
    });
    const profile = await dependencies.identity.updateWriterProfile({
      accountId: accountId(authSession.account.id),
      displayName: parsed.data.displayName,
      ...(parsed.data.publishing === undefined
        ? {}
        : { publishing: parsed.data.publishing }),
      expectedVersion: parsed.data.expectedVersion
    });
    return context.json({ profile });
  });

  app.get("/api/projects", async (context) => {
    const authSession = context.get("authSession");
    const includeArchived = context.req.query("includeArchived") === "true";
    const projectSummaries = await dependencies.services.listStoryProjects(
      accountId(authSession.account.id),
      { includeArchived }
    );
    return context.json({ projects: projectSummaries });
  });

  app.post("/api/projects", async (context) => {
    const parsed = await parseJsonRequest(context.req.raw, createProjectRequestSchema);
    if (!parsed.success) {
      return context.json(
        {
          error: "Invalid request.",
          code: parsed.code,
          ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
        },
        parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
      );
    }
    const authSession = context.get("authSession");
    const id = await dependencies.services.createStoryProject({
      ownerAccountId: accountId(authSession.account.id),
      ...parsed.data
    });
    const navigator = await dependencies.services.getProjectNavigator(
      accountId(authSession.account.id),
      id
    );
    return context.json(navigator, 201);
  });

  app.get("/api/projects/:projectId/navigator", async (context) => {
    const rawProjectId = context.req.param("projectId");

    let id;
    try {
      id = projectId(rawProjectId);
    } catch (error) {
      if (error instanceof DomainValidationError) {
        return context.json({ error: "Invalid project id." }, 400);
      }
      throw error;
    }

    const session = context.get("authSession");
    let navigator;
    try {
      navigator = await dependencies.services.getProjectNavigator(
        accountId(session.account.id),
        id
      );
    } catch (error) {
      if (error instanceof ProjectAccessDeniedError) {
        return context.json({ error: "Project not found." }, 404);
      }
      throw error;
    }

    if (navigator === undefined) {
      return context.json({ error: "Project not found." }, 404);
    }

    return context.json(navigator);
  });

  app.get("/api/projects/:projectId/books/:bookId/reader", async (context) => {
    const rawProjectId = context.req.param("projectId");
    const rawBookId = context.req.param("bookId");
    const pinSceneId = context.req.query("pinSceneId");

    let id;
    let resolvedBookId;
    try {
      id = projectId(rawProjectId);
      resolvedBookId = bookId(rawBookId);
    } catch (error) {
      if (error instanceof DomainValidationError) {
        return context.json({ error: "Invalid request id.", code: error.code }, 400);
      }
      throw error;
    }

    let resolvedPinSceneId;
    if (pinSceneId !== undefined && pinSceneId.length > 0) {
      try {
        resolvedPinSceneId = sceneId(pinSceneId);
      } catch (error) {
        if (error instanceof DomainValidationError) {
          return context.json(
            { error: "Invalid pin scene id.", code: error.code },
            400
          );
        }
        throw error;
      }
    }

    const authSession = context.get("authSession");
    const projection = await dependencies.reader.getBookReader({
      accountId: accountId(authSession.account.id),
      projectId: id,
      bookId: resolvedBookId,
      ...(resolvedPinSceneId === undefined
        ? {}
        : { pinSceneId: resolvedPinSceneId })
    });
    return context.json(bookReaderResponse(projection));
  });

  app.post("/api/reader/speak", async (context) => {
    const parsed = await parseJsonRequest(context.req.raw, readerSpeakRequestSchema);
    if (!parsed.success) {
      return context.json(
        {
          error: "Invalid request.",
          code: parsed.code,
          ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
        },
        parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
      );
    }
    const voice =
      dependencies.voice ?? ElevenLabsVoicePort.fromEnvOrUndefined();
    if (voice === undefined) {
      return context.json(
        {
          error: "Reader voice is not configured on this server.",
          code: "VOICE_UNAVAILABLE"
        },
        503
      );
    }
    const pack = toReaderVoicePack(parsed.data.voice);
    const speech = await voice.synthesize(parsed.data.text, pack);
    if (speech === null) {
      return context.json(
        {
          error: "Reader voice could not synthesize this passage.",
          code: "VOICE_UNAVAILABLE"
        },
        503
      );
    }
    return context.json(speech);
  });

  app.post("/api/workspace/chat", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      workspaceChatRequestSchema
    );
    if (!parsed.success) {
      return context.json(
        {
          error: "Invalid request.",
          code: parsed.code,
          ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
        },
        parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
      );
    }
    const normalizedMessage = parsed.data.message.toLocaleLowerCase();
    const requestedCapability = GHOSTWRITER_CAPABILITIES.find(
      (capability) =>
        capability.id.toLocaleLowerCase() === normalizedMessage ||
        capability.title.toLocaleLowerCase() === normalizedMessage
    );

    if (requestedCapability?.id === "project.navigator.read") {
      if (parsed.data.projectId === undefined) {
        return context.json({
          reply:
            "Open a project before running the manuscript hierarchy capability."
        });
      }
      const authSession = context.get("authSession");
      let navigator;
      try {
        navigator = await dependencies.services.getProjectNavigator(
          accountId(authSession.account.id),
          projectId(parsed.data.projectId)
        );
      } catch (error) {
        if (
          error instanceof DomainValidationError ||
          error instanceof ProjectAccessDeniedError
        ) {
          return context.json(
            { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
            404
          );
        }
        throw error;
      }
      if (navigator === undefined) {
        return context.json(
          { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
          404
        );
      }
      return context.json({
        reply: [
          `Ran ${requestedCapability.title}.`,
          `${navigator.title} · project version ${navigator.version}`,
          `${navigator.totals.books} books · ${navigator.totals.scenes} scenes · ${navigator.totals.storyKnowledge} story records`,
          `Books: ${navigator.books.map((book) => book.title).join(", ")}`
        ].join("\n")
      });
    }

    const capabilities = (
      requestedCapability === undefined
        ? GHOSTWRITER_CAPABILITIES.filter((capability) =>
            capability.title
              .toLocaleLowerCase()
              .includes(normalizedMessage.slice(0, 24))
          )
        : [requestedCapability]
    ).slice(0, 5);
    const listed =
      capabilities.length > 0
        ? capabilities.map((capability) => `• ${capability.title}`).join("\n")
        : GHOSTWRITER_CAPABILITIES.slice(0, 8)
            .map((capability) => `• ${capability.title}`)
            .join("\n");
    return context.json({
      reply: [
        "Tool-only chat is active. OpenAI completion is not configured yet.",
        parsed.data.projectId === undefined
          ? "No project context was supplied."
          : `Open project: ${parsed.data.projectId}`,
        "Matching capabilities:",
        listed
      ].join("\n")
    });
  });

  app.post("/api/projects/:projectId/writing-assist", async (context) => {
    const id = projectId(context.req.param("projectId"));
    const parsed = await parseJsonRequest(
      context.req.raw,
      writingAssistRequestSchema
    );
    if (!parsed.success) {
      return context.json(
        {
          error: "Invalid request.",
          code: parsed.code,
          ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
        },
        parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
      );
    }
    const authSession = context.get("authSession");
    try {
      const navigator = await dependencies.services.getProjectNavigator(
        accountId(authSession.account.id),
        id
      );
      if (navigator === undefined) {
        return context.json(
          { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
          404
        );
      }
    } catch (error) {
      if (
        error instanceof DomainValidationError ||
        error instanceof ProjectAccessDeniedError
      ) {
        return context.json(
          { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
          404
        );
      }
      throw error;
    }

    const proposals = buildDeterministicWritingAssistProposals(
      parsed.data.role as WritingAssistRole,
      {
        sceneTitle: parsed.data.sceneTitle,
        ...(parsed.data.sceneSummary === undefined
          ? {}
          : { sceneSummary: parsed.data.sceneSummary }),
        ...(parsed.data.recentProse === undefined
          ? {}
          : { recentProse: parsed.data.recentProse }),
        ...(parsed.data.sketch === undefined ? {} : { sketch: parsed.data.sketch }),
        ...(parsed.data.backdropCaption === undefined
          ? {}
          : { backdropCaption: parsed.data.backdropCaption }),
        ...(parsed.data.cast === undefined
          ? {}
          : {
              cast: parsed.data.cast.map((entry) => ({
                id: storyKnowledgeId(entry.id),
                label: entry.label,
                ...(entry.characterSheet === undefined
                  ? {}
                  : { characterSheet: entry.characterSheet })
              }))
            })
      }
    );

    return context.json({
      provider: "deterministic-local",
      proposals
    });
  });

  app.post("/api/projects/:projectId/commands", async (context) => {
    const id = projectId(context.req.param("projectId"));
    const parsed = await parseJsonRequest(
      context.req.raw,
      executeProjectCommandRequestSchema
    );
    if (!parsed.success) {
      return context.json(
        {
          error: "Invalid request.",
          code: parsed.code,
          ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
        },
        parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
      );
    }
    const authSession = context.get("authSession");
    const navigator = await dependencies.services.executeProjectCommand({
      accountId: accountId(authSession.account.id),
      projectId: id,
      expectedVersion: parsed.data.expectedVersion,
      command: toProjectCommand(parsed.data.command)
    });
    return context.json(navigator);
  });

  app.get("/api/projects/:projectId/canvas", async (context) => {
    const authSession = context.get("authSession");
    const result = await dependencies.canvas.getCanvasWorkspace({
      accountId: accountId(authSession.account.id),
      projectId: projectId(context.req.param("projectId"))
    });
    return context.json(canvasWorkspaceResponse(result));
  });

  app.post("/api/projects/:projectId/canvas/commands", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      executeCanvasCommandRequestSchema
    );
    if (!parsed.success) {
      return context.json(
        {
          error: "Invalid Canvas command request.",
          code: parsed.code,
          ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
        },
        parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
      );
    }
    const authSession = context.get("authSession");
    const result = await dependencies.canvas.executeCanvasCommand({
      accountId: accountId(authSession.account.id),
      projectId: projectId(context.req.param("projectId")),
      expectedCanvasVersion: parsed.data.expectedCanvasVersion,
      command: toCanvasCommand(parsed.data.command)
    });
    return context.json(canvasWorkspaceResponse(result));
  });

  app.get("/api/projects/:projectId/canvas/history", async (context) => {
    const authSession = context.get("authSession");
    const revisions = await dependencies.canvas.listCanvasHistory({
      accountId: accountId(authSession.account.id),
      projectId: projectId(context.req.param("projectId"))
    });
    return context.json({
      revisions: revisions.map(canvasRevisionResponse)
    });
  });

  app.post(
    "/api/projects/:projectId/canvas/history/restore",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        restoreCanvasRequestSchema
      );
      if (!parsed.success) {
        return context.json(
          {
            error: "Invalid Canvas restore request.",
            code: parsed.code,
            ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
          },
          parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
        );
      }
      const authSession = context.get("authSession");
      const scope = {
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        expectedCanvasVersion: parsed.data.expectedCanvasVersion
      };
      const result =
        parsed.data.revisionId === undefined
          ? await dependencies.canvas.undoCanvas(scope)
          : await dependencies.canvas.restoreCanvasRevision({
              ...scope,
              revisionId: parsed.data.revisionId
            });
      return context.json(canvasWorkspaceResponse(result), 201);
    }
  );

  app.get("/api/projects/:projectId/canvas/preference", async (context) => {
    const authSession = context.get("authSession");
    const preference =
      await dependencies.canvas.getCanvasViewportPreference({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId"))
      });
    return context.json({ preference: preference ?? null });
  });

  app.put("/api/projects/:projectId/canvas/preference", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      saveCanvasPreferenceRequestSchema
    );
    if (!parsed.success) {
      return context.json(
        {
          error: "Invalid Canvas preference request.",
          code: parsed.code,
          ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
        },
        parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
      );
    }
    const authSession = context.get("authSession");
    const { selectedObjectId, ...viewport } = parsed.data;
    const preference =
      await dependencies.canvas.saveCanvasViewportPreference({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        ...viewport,
        ...(selectedObjectId === undefined || selectedObjectId === null
          ? {}
          : { selectedObjectId })
      });
    return context.json({ preference });
  });

  app.post("/api/projects/:projectId/canvas/scenes", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      createSceneFromCanvasRequestSchema
    );
    if (!parsed.success) {
      return context.json(
        {
          error: "Invalid Canvas scene request.",
          code: parsed.code,
          ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
        },
        parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
      );
    }
    const authSession = context.get("authSession");
    const result = await dependencies.canvas.createSceneFromCanvas(
      toCreateSceneFromCanvasInput(
        parsed.data,
        accountId(authSession.account.id),
        projectId(context.req.param("projectId"))
      )
    );
    return context.json(
      {
        scene: result.scene,
        sceneDocumentHead: sceneHeadResponse(result.sceneDocumentHead),
        navigator: result.navigator,
        canvas: canvasWorkspaceResponse(result.canvas)
      },
      201
    );
  });

  app.get(
    "/api/projects/:projectId/scenes/:sceneId/workspace",
    async (context) => {
      const authSession = context.get("authSession");
      const workspace = await dependencies.writing.getSceneWorkspace({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        sceneId: sceneId(context.req.param("sceneId"))
      });
      return context.json(
        sceneWorkspaceResponse(workspace, authSession.session.id)
      );
    }
  );

  app.get(
    "/api/projects/:projectId/scenes/:sceneId/history",
    async (context) => {
      const authSession = context.get("authSession");
      const scope = {
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        sceneId: sceneId(context.req.param("sceneId"))
      };
      const [revisions, variants] = await Promise.all([
        dependencies.writing.listSceneRevisions(scope),
        dependencies.writing.listNamedSceneVariants(scope)
      ]);
      return context.json({
        revisions: revisions.map(sceneRevisionResponse),
        variants: variants.map(sceneVariantResponse)
      });
    }
  );

  app.post(
    "/api/projects/:projectId/scenes/:sceneId/checkpoints",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        createSceneCheckpointRequestSchema
      );
      if (!parsed.success) {
        return context.json(
          {
            error: "Invalid scene checkpoint request.",
            code: parsed.code,
            ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
          },
          parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
        );
      }
      const authSession = context.get("authSession");
      const result = await dependencies.writing.createManualCheckpoint({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        sceneId: sceneId(context.req.param("sceneId")),
        sessionId: authSession.session.id,
        expectedWorkingVersion: parsed.data.expectedWorkingVersion
      });
      return context.json(
        {
          head: sceneHeadMetadataResponse(result.head),
          revision: sceneRevisionResponse(result.revision),
          created: result.created
        },
        result.created ? 201 : 200
      );
    }
  );

  app.post(
    "/api/projects/:projectId/scenes/:sceneId/variants",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        createSceneVariantRequestSchema
      );
      if (!parsed.success) {
        return context.json(
          {
            error: "Invalid scene variant request.",
            code: parsed.code,
            ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
          },
          parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
        );
      }
      const authSession = context.get("authSession");
      const result = await dependencies.writing.createNamedSceneVariant({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        sceneId: sceneId(context.req.param("sceneId")),
        sessionId: authSession.session.id,
        expectedWorkingVersion: parsed.data.expectedWorkingVersion,
        name: parsed.data.name
      });
      return context.json(
        {
          head: sceneHeadMetadataResponse(result.head),
          revision: sceneRevisionResponse(result.revision),
          variant: sceneVariantResponse(result.variant),
          checkpointCreated: result.checkpointCreated
        },
        201
      );
    }
  );

  app.post(
    "/api/projects/:projectId/scenes/:sceneId/compare",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        compareSceneRevisionsRequestSchema
      );
      if (!parsed.success) {
        return context.json(
          {
            error: "Invalid scene comparison request.",
            code: parsed.code,
            ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
          },
          parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
        );
      }
      const authSession = context.get("authSession");
      const result = await dependencies.writing.compareSceneRevisions({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        sceneId: sceneId(context.req.param("sceneId")),
        beforeRevisionId: parsed.data.beforeRevisionId,
        afterRevisionId: parsed.data.afterRevisionId
      });
      return context.json({
        beforeRevision: sceneRevisionResponse(result.beforeRevision),
        afterRevision: sceneRevisionResponse(result.afterRevision),
        comparison: result.comparison
      });
    }
  );

  app.post(
    "/api/projects/:projectId/scenes/:sceneId/restore",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        restoreSceneRevisionRequestSchema
      );
      if (!parsed.success) {
        return context.json(
          {
            error: "Invalid scene restore request.",
            code: parsed.code,
            ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
          },
          parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
        );
      }
      const authSession = context.get("authSession");
      const result = await dependencies.writing.restoreSceneRevision({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        sceneId: sceneId(context.req.param("sceneId")),
        sessionId: authSession.session.id,
        expectedWorkingVersion: parsed.data.expectedWorkingVersion,
        revisionId: parsed.data.revisionId
      });
      return context.json(
        {
          head: sceneHeadResponse(result.head),
          revision: sceneRevisionResponse(result.revision)
        },
        201
      );
    }
  );

  app.post(
    "/api/projects/:projectId/scenes/:sceneId/lease",
    async (context) => {
      const authSession = context.get("authSession");
      const lease = await dependencies.writing.acquireOrRenewSceneLease({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        sceneId: sceneId(context.req.param("sceneId")),
        sessionId: authSession.session.id
      });
      return context.json({
        lease: {
          heldByCurrentSession: true,
          renewedAt: lease.renewedAt,
          expiresAt: lease.expiresAt
        }
      });
    }
  );

  app.delete(
    "/api/projects/:projectId/scenes/:sceneId/lease",
    async (context) => {
      const authSession = context.get("authSession");
      await dependencies.writing.releaseSceneLease({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        sceneId: sceneId(context.req.param("sceneId")),
        sessionId: authSession.session.id
      });
      return context.body(null, 204);
    }
  );

  app.patch(
    "/api/projects/:projectId/scenes/:sceneId/body",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        saveSceneDocumentRequestSchema,
        SCENE_DOCUMENT_REQUEST_MAX_BYTES
      );
      if (!parsed.success) {
        return context.json(
          {
            error: "Invalid scene document request.",
            code: parsed.code,
            ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
          },
          parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
        );
      }
      const authSession = context.get("authSession");
      const head = await dependencies.writing.saveWorkingSceneDocument({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        sceneId: sceneId(context.req.param("sceneId")),
        sessionId: authSession.session.id,
        expectedWorkingVersion: parsed.data.expectedWorkingVersion,
        document: parsed.data.document
      });
      return context.json({ head: sceneHeadResponse(head) });
    }
  );

  app.onError((error, context) => {
    if (error instanceof CanvasNotFoundError) {
      return context.json(
        { error: "Canvas not found.", code: "CANVAS_NOT_FOUND" },
        404
      );
    }
    if (error instanceof CanvasRevisionNotFoundError) {
      return context.json(
        { error: "Canvas revision not found.", code: "CANVAS_REVISION_NOT_FOUND" },
        404
      );
    }
    if (error instanceof CanvasVersionConflictError) {
      return context.json(
        {
          error: "The Canvas changed since it was loaded.",
          code: "CANVAS_VERSION_CONFLICT"
        },
        409
      );
    }
    if (error instanceof CanvasCommandError) {
      if (error.code === "RECORD_NOT_FOUND") {
        return context.json({ error: error.message, code: error.code }, 404);
      }
      if (error.code === "UNSAFE_ARCHIVE") {
        return context.json({ error: error.message, code: error.code }, 409);
      }
      return context.json({ error: error.message, code: error.code }, 422);
    }
    if (error instanceof SceneNotFoundError) {
      return context.json(
        { error: "Scene not found.", code: "SCENE_NOT_FOUND" },
        404
      );
    }
    if (error instanceof SceneWorkingVersionConflictError) {
      return context.json(
        { error: "The scene changed since it was loaded.", code: "REVISION_CONFLICT" },
        409
      );
    }
    if (error instanceof SceneLeaseExpiredError) {
      return context.json(
        { error: "The scene editing lease expired.", code: "LEASE_EXPIRED" },
        409
      );
    }
    if (error instanceof SceneLeaseConflictError) {
      return context.json(
        { error: "The scene is being edited elsewhere.", code: "LEASE_CONFLICT" },
        409
      );
    }
    if (error instanceof InvalidSceneDocumentError) {
      return context.json(
        { error: "Invalid scene document.", code: "INVALID_SCENE_DOCUMENT" },
        422
      );
    }
    if (error instanceof SceneRevisionNotFoundError) {
      return context.json(
        { error: "Scene revision not found.", code: "REVISION_NOT_FOUND" },
        404
      );
    }
    if (error instanceof SceneVariantNameConflictError) {
      return context.json(
        {
          error: "A variant with this name already exists.",
          code: "VARIANT_NAME_CONFLICT"
        },
        409
      );
    }
    if (error instanceof InvalidSceneVariantNameError) {
      return context.json(
        { error: error.message, code: "INVALID_VARIANT_NAME" },
        422
      );
    }
    if (error instanceof BookNotFoundError) {
      return context.json(
        { error: "Book not found.", code: "BOOK_NOT_FOUND" },
        404
      );
    }
    if (error instanceof BookReaderTooLargeError) {
      return context.json(
        {
          error: "This book is too large to load in the reader.",
          code: "BOOK_READER_TOO_LARGE"
        },
        413
      );
    }
    if (error instanceof ProjectAccessDeniedError) {
      return context.json(
        { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
        404
      );
    }
    if (
      error instanceof ProjectVersionConflictError ||
      error instanceof ProfileConflictError
    ) {
      return context.json(
        { error: error.message, code: "VERSION_CONFLICT" },
        409
      );
    }
    if (error instanceof ProjectCommandError) {
      if (error.code === "RECORD_NOT_FOUND") {
        return context.json({ error: error.message, code: error.code }, 404);
      }
      if (error.code === "UNSAFE_REMOVAL") {
        return context.json({ error: error.message, code: error.code }, 409);
      }
      return context.json({ error: error.message, code: error.code }, 422);
    }
    if (error instanceof DomainValidationError) {
      return context.json({ error: error.message, code: error.code }, 422);
    }

    console.error("Ghostwriter backend request failed.", {
      errorName: error.name
    });
    return context.json({ error: "Internal server error.", code: "INTERNAL_ERROR" }, 500);
  });

  return app;
}
