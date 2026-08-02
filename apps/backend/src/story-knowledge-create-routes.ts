import { accountId, projectId, sceneId } from "@ghostwriter/core";
import type { Context, Hono } from "hono";
import type { AuthenticatedSession } from "./auth.js";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import { agentProposalResponse, mapAgentRunRouteError } from "./agent-run-api.js";
import {
  parseJsonRequest,
  storyKnowledgeCreateDraftRequestSchema
} from "./api-contract.js";

type StoryKnowledgeCreateDraftEnvironment = {
  Variables: { authSession: AuthenticatedSession };
};

function invalidRequestResponse(
  context: Context<StoryKnowledgeCreateDraftEnvironment>,
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

export function registerStoryKnowledgeCreateRoutes(
  app: Hono<StoryKnowledgeCreateDraftEnvironment>,
  dependencies: Readonly<{ agentProvider: AgentProviderRuntime }>
): void {
  app.post("/api/projects/:projectId/agent/story-knowledge-drafts", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      storyKnowledgeCreateDraftRequestSchema
    );
    if (!parsed.success) return invalidRequestResponse(context, parsed);

    try {
      const authSession = context.get("authSession");
      const account = accountId(authSession.account.id);
      const result =
        await dependencies.agentProvider.storyKnowledgeCreate.createStoryKnowledgeDraft({
          accountId: account,
          projectId: projectId(context.req.param("projectId")),
          name: parsed.data.name,
          kind: parsed.data.kind,
          summary: parsed.data.summary,
          ...(parsed.data.properties === undefined
            ? {}
            : { properties: parsed.data.properties }),
          ...(parsed.data.sceneId === undefined
            ? {}
            : { sceneId: sceneId(parsed.data.sceneId) }),
          ...(parsed.data.firstAppearanceNote === undefined
            ? {}
            : { firstAppearanceNote: parsed.data.firstAppearanceNote })
        });
      return context.json(
        Object.freeze({
          proposal: agentProposalResponse(result.proposal)
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
