import {
  accountId,
  DomainValidationError,
  ProfileConflictError,
  ProjectAccessDeniedError,
  ProjectCommandError,
  ProjectVersionConflictError,
  projectId,
  type GhostwriterServices,
  type IdentityServices
} from "@ghostwriter/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  createProjectRequestSchema,
  executeProjectCommandRequestSchema,
  parseJsonRequest,
  toProjectCommand,
  updateProfileRequestSchema
} from "./api-contract.js";
import type { AuthGateway, AuthenticatedSession } from "./auth.js";

export type BackendDependencies = Readonly<{
  services: GhostwriterServices;
  identity: IdentityServices;
  auth: AuthGateway;
  allowedOrigins?: readonly string[];
}>;

type BackendEnvironment = {
  Variables: {
    authSession: AuthenticatedSession;
  };
};

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
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
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

    if (["POST", "PATCH", "DELETE"].includes(context.req.method)) {
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

  app.onError((error, context) => {
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
