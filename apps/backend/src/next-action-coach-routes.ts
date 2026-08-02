import {
  accountId,
  projectId,
  sceneId,
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
  nextActionCoachRunRequestSchema,
  parseJsonRequest
} from "./api-contract.js";

type NextActionCoachEnvironment = {
  Variables: { authSession: AuthenticatedSession };
};

function invalidRequestResponse(
  context: Context<NextActionCoachEnvironment>,
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

export function registerNextActionCoachRoutes(
  app: Hono<NextActionCoachEnvironment>,
  dependencies: Readonly<{ agentProvider: AgentProviderRuntime }>
): void {
  app.post("/api/projects/:projectId/agent/next-action-runs", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      nextActionCoachRunRequestSchema
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
      const result =
        await dependencies.agentProvider.nextActionCoach.runNextActionCoach({
          accountId: account,
          projectId: projectId(context.req.param("projectId")),
          sceneId: sceneId(parsed.data.sceneId),
          trigger: parsed.data.trigger ?? "scene-prose-saved",
          ...(parsed.data.model === undefined ? {} : { model: parsed.data.model }),
          ...(provider === undefined ? {} : { provider })
        });
      return context.json(
        Object.freeze({
          ...agentProposalResponse(result.proposal),
          payload: result.payload
        }),
        201
      );
    } catch (error) {
      const mapped = mapAgentRunRouteError(error);
      if (mapped !== undefined) return context.json(mapped.body, mapped.status);
      throw error;
    }
  });
}
