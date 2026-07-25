import { accountId, mcpGrantId, projectId } from "@ghostwriter/core";
import type { Context, Hono } from "hono";
import {
  createMcpGrantRequestSchema,
  parseJsonRequest
} from "./api-contract.js";
import type { AuthenticatedSession } from "./auth.js";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import {
  mapMcpGrantRouteError,
  mcpGrantCreateResponse,
  mcpGrantSummaryResponse
} from "./mcp-grant-api.js";

type McpGrantEnvironment = {
  Variables: {
    authSession: AuthenticatedSession;
  };
};

export type McpGrantRouteDependencies = Readonly<{
  agentProvider: AgentProviderRuntime;
}>;

function invalidRequestResponse(
  context: Context<McpGrantEnvironment>,
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

export function registerMcpGrantRoutes(
  app: Hono<McpGrantEnvironment>,
  dependencies: McpGrantRouteDependencies
): void {
  const { mcpGrants } = dependencies.agentProvider;

  app.get("/api/projects/:projectId/mcp-grants", async (context) => {
    try {
      const authSession = context.get("authSession");
      const grants = await mcpGrants.listGrants({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId"))
      });
      return context.json({
        grants: grants.map(mcpGrantSummaryResponse)
      });
    } catch (error) {
      const mapped = mapMcpGrantRouteError(error);
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.post("/api/projects/:projectId/mcp-grants", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      createMcpGrantRequestSchema
    );
    if (!parsed.success) {
      return invalidRequestResponse(context, parsed);
    }
    try {
      const authSession = context.get("authSession");
      const created = await mcpGrants.createGrant({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        captureIds: parsed.data.captureIds,
        tools: parsed.data.tools,
        expiresAt: parsed.data.expiresAt
      });
      return context.json(mcpGrantCreateResponse(created), 201);
    } catch (error) {
      const mapped = mapMcpGrantRouteError(error);
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.delete("/api/projects/:projectId/mcp-grants/:grantId", async (context) => {
    try {
      const authSession = context.get("authSession");
      const grant = await mcpGrants.revokeGrant({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        grantId: mcpGrantId(context.req.param("grantId"))
      });
      return context.json({ grant: mcpGrantSummaryResponse(grant) });
    } catch (error) {
      const mapped = mapMcpGrantRouteError(error);
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });
}
