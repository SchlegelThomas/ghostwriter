import {
  accountId,
  projectId,
  ProviderCredentialNotFoundError
} from "@ghostwriter/core";
import type { Context, Hono } from "hono";
import type { AuthenticatedSession } from "./auth.js";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import {
  ProviderCallsDisabledError,
  ProviderEncryptionUnavailableError
} from "./agent-provider-runtime.js";
import { agentProposalResponse, mapAgentRunRouteError } from "./agent-run-api.js";
import {
  catalogAgentRunRequestSchema,
  parseJsonRequest
} from "./api-contract.js";

type CatalogAgentEnvironment = {
  Variables: { authSession: AuthenticatedSession };
};

function invalidRequestResponse(
  context: Context<CatalogAgentEnvironment>,
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

export function registerCatalogAgentRoutes(
  app: Hono<CatalogAgentEnvironment>,
  dependencies: Readonly<{ agentProvider: AgentProviderRuntime }>
): void {
  app.post("/api/projects/:projectId/agent/catalog-runs", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      catalogAgentRunRequestSchema
    );
    if (!parsed.success) return invalidRequestResponse(context, parsed);

    try {
      const authSession = context.get("authSession");
      const account = accountId(authSession.account.id);
      let provider:
        | Awaited<
            ReturnType<AgentProviderRuntime["createCompletionProviderForModel"]>
          >
        | undefined;
      if (parsed.data.model !== undefined) {
        try {
          provider =
            await dependencies.agentProvider.createCompletionProviderForModel({
              accountId: account,
              model: parsed.data.model
            });
        } catch (error) {
          if (
            !(error instanceof ProviderCredentialNotFoundError) &&
            !(error instanceof ProviderCallsDisabledError) &&
            !(error instanceof ProviderEncryptionUnavailableError)
          ) {
            throw error;
          }
        }
      }
      const proposal =
        await dependencies.agentProvider.catalogAgents.runCatalogAgent({
          accountId: account,
          projectId: projectId(context.req.param("projectId")),
          agentId: parsed.data.agentId,
          ...(parsed.data.lens === undefined ? {} : { lens: parsed.data.lens }),
          ...(parsed.data.model === undefined ? {} : { model: parsed.data.model }),
          ...(parsed.data.effort === undefined ? {} : { effort: parsed.data.effort }),
          ...(parsed.data.sceneId === undefined
            ? {}
            : { sceneId: parsed.data.sceneId }),
          ...(parsed.data.storyKnowledgeId === undefined
            ? {}
            : { storyKnowledgeId: parsed.data.storyKnowledgeId }),
          ...(provider === undefined ? {} : { provider })
        });
      return context.json(agentProposalResponse(proposal), 201);
    } catch (error) {
      const mapped = mapAgentRunRouteError(error);
      if (mapped !== undefined) return context.json(mapped.body, mapped.status);
      throw error;
    }
  });
}
