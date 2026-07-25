import { accountId, playbookId, projectId, ProjectArchivedMutationError } from "@ghostwriter/core";
import type { Context, Hono } from "hono";
import {
  archiveProjectPlaybookRequestSchema,
  deleteOpenAiProviderCredentialRequestSchema,
  OPENAI_PROVIDER_CREDENTIAL_MAX_BYTES,
  parseJsonRequest,
  saveProjectAgentInstructionsRequestSchema,
  saveProjectPlaybookRequestSchema,
  setOpenAiProviderCredentialRequestSchema,
  updateProjectPlaybookRequestSchema,
  validateOpenAiProviderCredentialRequestSchema,
  patchAiCollaborationRequestSchema
} from "./api-contract.js";
import type { AuthenticatedSession } from "./auth.js";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import { ProviderEncryptionUnavailableError } from "./agent-provider-runtime.js";
import {
  aiCollaborationProfileResponse,
  mapAgentGuidanceRouteError,
  openAiProviderStatusResponse,
  projectAgentInstructionsResponse,
  projectPlaybookResponse,
  providerAgentErrorStatusAndBody
} from "./provider-agent-api.js";

type ProviderAgentEnvironment = {
  Variables: {
    authSession: AuthenticatedSession;
  };
};

export type ProviderAgentRouteDependencies = Readonly<{
  agentProvider: AgentProviderRuntime;
}>;

function invalidRequestResponse(
  context: Context<ProviderAgentEnvironment>,
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

function mapRouteError(
  error: unknown,
  scope?: "collaboration" | "instructions" | "playbook"
) {
  if (error instanceof ProjectArchivedMutationError) {
    return {
      status: 409 as const,
      body: {
        error: "Archived projects cannot be changed.",
        code: "PROJECT_ARCHIVED"
      }
    };
  }
  return scope === undefined
    ? providerAgentErrorStatusAndBody(error)
    : mapAgentGuidanceRouteError(error, scope);
}

export function registerProviderAgentRoutes(
  app: Hono<ProviderAgentEnvironment>,
  dependencies: ProviderAgentRouteDependencies
): void {
  const { agentProvider } = dependencies;
  const { providerCredentials, agentGuidance, policy, validateOpenAiCredential } = agentProvider;

  app.get("/api/me/provider/openai", async (context) => {
    const authSession = context.get("authSession");
    const status = await providerCredentials.getOpenAiCredentialStatus(
      accountId(authSession.account.id)
    );
    return context.json(
      openAiProviderStatusResponse({
        configured: status !== undefined,
        callsDisabled: policy.callsDisabled,
        status
      })
    );
  });

  app.put("/api/me/provider/openai", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      setOpenAiProviderCredentialRequestSchema,
      OPENAI_PROVIDER_CREDENTIAL_MAX_BYTES
    );
    if (!parsed.success) {
      return invalidRequestResponse(context, parsed);
    }
    if (!policy.encryptionAvailable) {
      return context.json(
        providerAgentErrorStatusAndBody(new ProviderEncryptionUnavailableError())!.body,
        503
      );
    }
    try {
      const authSession = context.get("authSession");
      const status = await providerCredentials.setOpenAiCredential({
        accountId: accountId(authSession.account.id),
        plaintext: parsed.data.apiKey,
        ...(parsed.data.expectedVersion === undefined
          ? {}
          : { expectedVersion: parsed.data.expectedVersion })
      });
      return context.json(
        openAiProviderStatusResponse({
          configured: true,
          callsDisabled: policy.callsDisabled,
          status
        })
      );
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.delete("/api/me/provider/openai", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      deleteOpenAiProviderCredentialRequestSchema,
      OPENAI_PROVIDER_CREDENTIAL_MAX_BYTES
    );
    if (!parsed.success) {
      return invalidRequestResponse(context, parsed);
    }
    try {
      const authSession = context.get("authSession");
      await providerCredentials.deleteOpenAiCredential({
        accountId: accountId(authSession.account.id),
        expectedVersion: parsed.data.expectedVersion
      });
      return context.json(
        openAiProviderStatusResponse({
          configured: false,
          callsDisabled: policy.callsDisabled
        })
      );
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.post("/api/me/provider/openai/validate", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      validateOpenAiProviderCredentialRequestSchema,
      OPENAI_PROVIDER_CREDENTIAL_MAX_BYTES
    );
    if (!parsed.success) {
      return invalidRequestResponse(context, parsed);
    }
    try {
      const authSession = context.get("authSession");
      const status = await validateOpenAiCredential({
        accountId: accountId(authSession.account.id),
        expectedVersion: parsed.data.expectedVersion
      });
      return context.json(
        openAiProviderStatusResponse({
          configured: true,
          callsDisabled: policy.callsDisabled,
          status
        })
      );
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.get("/api/me/ai-collaboration", async (context) => {
    const authSession = context.get("authSession");
    const profile = await agentGuidance.getAccountAiCollaborationProfile(
      accountId(authSession.account.id)
    );
    return context.json(aiCollaborationProfileResponse(profile));
  });

  app.patch("/api/me/ai-collaboration", async (context) => {
    const parsed = await parseJsonRequest(context.req.raw, patchAiCollaborationRequestSchema);
    if (!parsed.success) {
      return invalidRequestResponse(context, parsed);
    }
    try {
      const authSession = context.get("authSession");
      const account = accountId(authSession.account.id);
      const payload = parsed.data;
      if ("skipSetup" in payload && payload.skipSetup) {
        const profile = await agentGuidance.skipAccountAiCollaborationSetup({
          accountId: account,
          ...(payload.expectedVersion === undefined
            ? {}
            : { expectedVersion: payload.expectedVersion })
        });
        return context.json(aiCollaborationProfileResponse(profile));
      }
      const savePayload = payload as Extract<
        typeof payload,
        { posture: "options" | "questions-first" | "craft-explanations" | "minimal" }
      >;
      const profile = await agentGuidance.saveAccountAiCollaborationProfile({
        accountId: account,
        posture: savePayload.posture,
        ...(savePayload.boundaries === undefined
          ? {}
          : { boundaries: savePayload.boundaries }),
        ...(savePayload.expectedVersion === undefined
          ? {}
          : { expectedVersion: savePayload.expectedVersion })
      });
      return context.json(aiCollaborationProfileResponse(profile));
    } catch (error) {
      const mapped = mapRouteError(error, "collaboration");
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.get("/api/projects/:projectId/agent-instructions", async (context) => {
    try {
      const authSession = context.get("authSession");
      const instructions = await agentGuidance.getProjectAgentInstructions({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId"))
      });
      return context.json(projectAgentInstructionsResponse(instructions));
    } catch (error) {
      const mapped = mapRouteError(error, "instructions");
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.patch("/api/projects/:projectId/agent-instructions", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      saveProjectAgentInstructionsRequestSchema
    );
    if (!parsed.success) {
      return invalidRequestResponse(context, parsed);
    }
    try {
      const authSession = context.get("authSession");
      const instructions = await agentGuidance.saveProjectAgentInstructions({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        body: parsed.data.body,
        ...(parsed.data.expectedVersion === undefined
          ? {}
          : { expectedVersion: parsed.data.expectedVersion })
      });
      return context.json(projectAgentInstructionsResponse(instructions));
    } catch (error) {
      const mapped = mapRouteError(error, "instructions");
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.get("/api/projects/:projectId/playbooks", async (context) => {
    try {
      const authSession = context.get("authSession");
      const limitRaw = context.req.query("limit");
      const limit =
        limitRaw === undefined ? undefined : Number.parseInt(limitRaw, 10);
      const playbooks = await agentGuidance.listProjectPlaybooks({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        ...(limit === undefined || Number.isNaN(limit) ? {} : { limit }),
        includeArchived: context.req.query("includeArchived") === "true"
      });
      return context.json({
        playbooks: playbooks.map((playbook) => projectPlaybookResponse(playbook).playbook)
      });
    } catch (error) {
      const mapped = mapRouteError(error, "instructions");
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.post("/api/projects/:projectId/playbooks", async (context) => {
    const parsed = await parseJsonRequest(context.req.raw, saveProjectPlaybookRequestSchema);
    if (!parsed.success) {
      return invalidRequestResponse(context, parsed);
    }
    try {
      const authSession = context.get("authSession");
      const playbook = await agentGuidance.saveProjectPlaybook({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        name: parsed.data.name,
        enabled: parsed.data.enabled,
        trigger: parsed.data.trigger,
        allowedContextClasses: parsed.data.allowedContextClasses,
        outputSchemaId: parsed.data.outputSchemaId,
        guidance: parsed.data.guidance
      });
      return context.json(projectPlaybookResponse(playbook), 201);
    } catch (error) {
      const mapped = mapRouteError(error, "playbook");
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.patch("/api/projects/:projectId/playbooks/:playbookId", async (context) => {
    const parsed = await parseJsonRequest(context.req.raw, updateProjectPlaybookRequestSchema);
    if (!parsed.success) {
      return invalidRequestResponse(context, parsed);
    }
    try {
      const authSession = context.get("authSession");
      const playbook = await agentGuidance.saveProjectPlaybook({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        playbookId: playbookId(context.req.param("playbookId")),
        name: parsed.data.name,
        enabled: parsed.data.enabled,
        trigger: parsed.data.trigger,
        allowedContextClasses: parsed.data.allowedContextClasses,
        outputSchemaId: parsed.data.outputSchemaId,
        guidance: parsed.data.guidance,
        ...(parsed.data.expectedVersion === undefined
          ? {}
          : { expectedVersion: parsed.data.expectedVersion })
      });
      return context.json(projectPlaybookResponse(playbook));
    } catch (error) {
      const mapped = mapRouteError(error, "playbook");
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });

  app.delete("/api/projects/:projectId/playbooks/:playbookId", async (context) => {
    const parsed = await parseJsonRequest(context.req.raw, archiveProjectPlaybookRequestSchema);
    if (!parsed.success) {
      return invalidRequestResponse(context, parsed);
    }
    try {
      const authSession = context.get("authSession");
      const playbook = await agentGuidance.archiveProjectPlaybook({
        accountId: accountId(authSession.account.id),
        projectId: projectId(context.req.param("projectId")),
        playbookId: playbookId(context.req.param("playbookId")),
        expectedVersion: parsed.data.expectedVersion
      });
      return context.json(projectPlaybookResponse(playbook));
    } catch (error) {
      const mapped = mapRouteError(error, "playbook");
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });
}
