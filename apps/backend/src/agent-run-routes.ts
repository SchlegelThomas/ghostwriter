import {
  accountId,
  agentProposalId,
  agentRunId,
  bookId,
  captureId,
  chapterId,
  contextReceiptId,
  instructionContentHash,
  projectId,
  sceneId,
  storyKnowledgeId,
  CAPTURE_REFLECTION_WORKFLOW_ID,
  CHARACTER_COACH_WORKFLOW_ID,
  SKETCH_PARTNER_WORKFLOW_ID,
  WORLDKEEPER_WORKFLOW_ID
} from "@ghostwriter/core";
import type { Context, Hono } from "hono";
import {
  agentApplyProposalRequestSchema,
  agentContextPreviewRequestSchema,
  agentStartRunRequestSchema,
  parseJsonRequest
} from "./api-contract.js";
import type { AuthenticatedSession } from "./auth.js";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import {
  ProviderCallsDisabledError,
  ProviderEncryptionUnavailableError
} from "./agent-provider-runtime.js";
import {
  agentProposalResponse,
  agentProposalSummaryResponse,
  agentRunResponse,
  agentRunSummaryResponse,
  applyAgentProposalResponse,
  applyCraftProposalResponse,
  contextReceiptResponse,
  mapAgentRunRouteError,
  startCaptureReflectionResponse
} from "./agent-run-api.js";
import { providerAgentErrorStatusAndBody } from "./provider-agent-api.js";

type AgentRunEnvironment = {
  Variables: {
    authSession: AuthenticatedSession;
  };
};

export type AgentRunRouteDependencies = Readonly<{
  agentProvider: AgentProviderRuntime;
}>;

function invalidRequestResponse(
  context: Context<AgentRunEnvironment>,
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

function assertProviderCallable(agentProvider: AgentProviderRuntime): void {
  if (agentProvider.policy.callsDisabled) {
    throw new ProviderCallsDisabledError();
  }
  if (!agentProvider.policy.encryptionAvailable) {
    throw new ProviderEncryptionUnavailableError();
  }
}

function isCraftWorkflowId(
  workflowId: string
): workflowId is
  | typeof SKETCH_PARTNER_WORKFLOW_ID
  | typeof CHARACTER_COACH_WORKFLOW_ID
  | typeof WORLDKEEPER_WORKFLOW_ID {
  return (
    workflowId === SKETCH_PARTNER_WORKFLOW_ID ||
    workflowId === CHARACTER_COACH_WORKFLOW_ID ||
    workflowId === WORLDKEEPER_WORKFLOW_ID
  );
}

export function registerAgentRunRoutes(
  app: Hono<AgentRunEnvironment>,
  dependencies: AgentRunRouteDependencies
): void {
  const { agentProvider } = dependencies;
  const { captureReflection, craftPartners, foundation } = agentProvider;

  app.post("/api/projects/:projectId/agent/context-preview", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      agentContextPreviewRequestSchema
    );
    if (!parsed.success) {
      return invalidRequestResponse(context, parsed);
    }
    try {
      const authSession = context.get("authSession");
      const account = accountId(authSession.account.id);
      const scopedProjectId = projectId(context.req.param("projectId"));
      const workflowId =
        parsed.data.workflowId ?? CAPTURE_REFLECTION_WORKFLOW_ID;
      const receipt = isCraftWorkflowId(workflowId)
        ? await craftPartners.preview({
            accountId: account,
            projectId: scopedProjectId,
            captureId: captureId(parsed.data.captureId),
            workflowId,
            ...(parsed.data.sceneId === undefined
              ? {}
              : { sceneId: sceneId(parsed.data.sceneId) }),
            ...(parsed.data.storyKnowledgeId === undefined
              ? {}
              : {
                  storyKnowledgeId: storyKnowledgeId(parsed.data.storyKnowledgeId)
                }),
            ...(parsed.data.model === undefined ? {} : { model: parsed.data.model })
          })
        : await captureReflection.preview({
            accountId: account,
            projectId: scopedProjectId,
            captureId: captureId(parsed.data.captureId),
            ...(parsed.data.model === undefined ? {} : { model: parsed.data.model })
          });
      return context.json(contextReceiptResponse(receipt), 201);
    } catch (error) {
      const mapped = mapAgentRunRouteError(error);
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.post("/api/projects/:projectId/agent/runs", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      agentStartRunRequestSchema
    );
    if (!parsed.success) {
      return invalidRequestResponse(context, parsed);
    }
    try {
      assertProviderCallable(agentProvider);
      const authSession = context.get("authSession");
      const account = accountId(authSession.account.id);
      const scopedProjectId = projectId(context.req.param("projectId"));
      const receiptId = contextReceiptId(parsed.data.receiptId);
      const expectedReceiptHash = instructionContentHash(
        parsed.data.expectedReceiptHash
      );
      const receipt = await foundation.getReceipt({
        accountId: account,
        projectId: scopedProjectId,
        receiptId
      });
      const provider = await agentProvider.createOpenAiCompletionProvider({
        accountId: account
      });
      const result = isCraftWorkflowId(receipt.workflowId)
        ? await craftPartners.start({
            accountId: account,
            projectId: scopedProjectId,
            receiptId,
            expectedReceiptHash,
            provider
          })
        : await captureReflection.start({
            accountId: account,
            projectId: scopedProjectId,
            receiptId,
            expectedReceiptHash,
            provider
          });
      return context.json(startCaptureReflectionResponse(result), 201);
    } catch (error) {
      const mapped = mapAgentRunRouteError(error);
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.get("/api/projects/:projectId/agent/runs/:runId", async (context) => {
    try {
      const authSession = context.get("authSession");
      const run = await captureReflection.getRun({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        runId: agentRunId(context.req.param("runId"))
      });
      return context.json(agentRunResponse(run));
    } catch (error) {
      const mapped = mapAgentRunRouteError(error);
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.post("/api/projects/:projectId/agent/runs/:runId/cancel", async (context) => {
    try {
      const authSession = context.get("authSession");
      const run = await captureReflection.cancelRun({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        runId: agentRunId(context.req.param("runId"))
      });
      return context.json(agentRunResponse(run));
    } catch (error) {
      const mapped = mapAgentRunRouteError(error);
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.get("/api/projects/:projectId/agent/proposals", async (context) => {
    try {
      const authSession = context.get("authSession");
      const proposals = await captureReflection.listProposalSummaries({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId"))
      });
      return context.json({
        proposals: proposals.map(agentProposalSummaryResponse)
      });
    } catch (error) {
      const mapped = mapAgentRunRouteError(error) ?? providerAgentErrorStatusAndBody(error);
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.get("/api/projects/:projectId/agent/proposals/:proposalId", async (context) => {
    try {
      const authSession = context.get("authSession");
      const proposal = await captureReflection.getProposal({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        proposalId: agentProposalId(context.req.param("proposalId"))
      });
      return context.json(agentProposalResponse(proposal));
    } catch (error) {
      const mapped = mapAgentRunRouteError(error);
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.post(
    "/api/projects/:projectId/agent/proposals/:proposalId/reject",
    async (context) => {
      try {
        const authSession = context.get("authSession");
        const proposal = await captureReflection.rejectProposal({
          accountId: accountId(authSession.account.id),
          projectId: projectId(context.req.param("projectId")),
          proposalId: agentProposalId(context.req.param("proposalId"))
        });
        return context.json(agentProposalResponse(proposal));
      } catch (error) {
        const mapped = mapAgentRunRouteError(error);
        if (mapped !== undefined) {
          return context.json(mapped.body, mapped.status);
        }
        throw error;
      }
    }
  );

  app.post(
    "/api/projects/:projectId/agent/proposals/:proposalId/apply",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        agentApplyProposalRequestSchema
      );
      if (!parsed.success) {
        return invalidRequestResponse(context, parsed);
      }
      try {
        const authSession = context.get("authSession");
        const scopedProjectId = projectId(context.req.param("projectId"));
        const proposalIdValue = agentProposalId(context.req.param("proposalId"));
        const account = accountId(authSession.account.id);
        const expectedProposalContentHash = instructionContentHash(
          parsed.data.expectedProposalContentHash
        );
        if (parsed.data.mode === "craft-fields") {
          const result = await craftPartners.applyProposal({
            accountId: account,
            projectId: scopedProjectId,
            proposalId: proposalIdValue,
            expectedProposalContentHash,
            expectedProjectVersion: parsed.data.expectedProjectVersion
          });
          return context.json(applyCraftProposalResponse(result), 201);
        }
        const result =
          parsed.data.mode === "new-scene"
            ? await captureReflection.applyProposal({
                accountId: account,
                projectId: scopedProjectId,
                proposalId: proposalIdValue,
                expectedProposalContentHash,
                mode: "new-scene",
                title: parsed.data.title,
                bookId: bookId(parsed.data.bookId),
                ...(parsed.data.chapterId === undefined
                  ? {}
                  : { chapterId: chapterId(parsed.data.chapterId) }),
                ...(parsed.data.placeOnCanvas === undefined
                  ? {}
                  : { placeOnCanvas: parsed.data.placeOnCanvas }),
                expectedProjectVersion: parsed.data.expectedProjectVersion,
                ...(parsed.data.expectedCanvasVersion === undefined
                  ? {}
                  : { expectedCanvasVersion: parsed.data.expectedCanvasVersion })
              })
            : await captureReflection.applyProposal({
                accountId: account,
                projectId: scopedProjectId,
                proposalId: proposalIdValue,
                expectedProposalContentHash,
                mode: "named-variant",
                sceneId: sceneId(parsed.data.sceneId),
                variantName: parsed.data.variantName,
                expectedWorkingVersion: parsed.data.expectedWorkingVersion,
                sessionId: parsed.data.sessionId
              });
        return context.json(applyAgentProposalResponse(result), 201);
      } catch (error) {
        const mapped = mapAgentRunRouteError(error);
        if (mapped !== undefined) {
          return context.json(mapped.body, mapped.status);
        }
        throw error;
      }
    }
  );

  app.get("/api/projects/:projectId/agent/runs", async (context) => {
    try {
      const authSession = context.get("authSession");
      const runs = await captureReflection.listRunSummaries({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId"))
      });
      return context.json({
        runs: runs.map(agentRunSummaryResponse)
      });
    } catch (error) {
      const mapped = mapAgentRunRouteError(error);
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });
}
