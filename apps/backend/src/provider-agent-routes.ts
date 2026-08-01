import {
  accountId,
  playbookId,
  projectId,
  ProjectArchivedMutationError
} from "@ghostwriter/core";
import type { Context, Hono } from "hono";
import {
  archiveProjectPlaybookRequestSchema,
  deleteOpenAiProviderCredentialRequestSchema,
  deleteProviderCredentialRequestSchema,
  OPENAI_PROVIDER_CREDENTIAL_MAX_BYTES,
  parseJsonRequest,
  saveProjectAgentInstructionsRequestSchema,
  saveProjectPlaybookRequestSchema,
  setOpenAiProviderCredentialRequestSchema,
  setProviderCredentialRequestSchema,
  updateProjectPlaybookRequestSchema,
  validateOpenAiProviderCredentialRequestSchema,
  validateProviderCredentialRequestSchema,
  patchAiCollaborationRequestSchema,
  providerIdParamSchema
} from "./api-contract.js";
import type { AuthenticatedSession } from "./auth.js";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import { ProviderEncryptionUnavailableError } from "./agent-provider-runtime.js";
import {
  aiCollaborationProfileResponse,
  accountProvidersListResponse,
  availableModelsResponse,
  mapAgentGuidanceRouteError,
  openAiProviderStatusResponse,
  providerCredentialStatusResponse,
  projectAgentInstructionsResponse,
  projectPlaybookResponse,
  providerAgentErrorStatusAndBody
} from "./provider-agent-api.js";
import { discoverModelsForAccount } from "./model-discovery.js";

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

function parseProviderRouteId(
  context: Context<ProviderAgentEnvironment>
):
  | Readonly<{ ok: true; providerId: import("@ghostwriter/core").ProviderId }>
  | Readonly<{ ok: false; response: Response }> {
  const raw = context.req.param("providerId");
  const parsed = providerIdParamSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: context.json(
        {
          error: "Invalid request.",
          code: "INVALID_PROVIDER_ID"
        },
        400
      )
    };
  }
  return { ok: true, providerId: parsed.data };
}

export function registerProviderAgentRoutes(
  app: Hono<ProviderAgentEnvironment>,
  dependencies: ProviderAgentRouteDependencies
): void {
  const { agentProvider } = dependencies;
  const {
    providerCredentials,
    agentGuidance,
    policy,
    validateOpenAiCredential,
    validateProviderCredential
  } = agentProvider;

  app.get("/api/me/providers", async (context) => {
    const authSession = context.get("authSession");
    const configured = await providerCredentials.listCredentialStatuses(
      accountId(authSession.account.id)
    );
    return context.json(
      accountProvidersListResponse({
        callsDisabled: policy.callsDisabled,
        configured
      })
    );
  });

  app.get("/api/me/available-models", async (context) => {
    const authSession = context.get("authSession");
    const account = accountId(authSession.account.id);
    const configured = await providerCredentials.listCredentialStatuses(account);
    let catalog;
    try {
      catalog = await discoverModelsForAccount({
        accountId: authSession.account.id,
        configured,
        resolveApiKey: async (providerId) =>
          agentProvider.resolveProviderApiKey({
            accountId: account,
            providerId
          }),
        ...(agentProvider.listModelsFactory === undefined
          ? {}
          : { createListingProvider: agentProvider.listModelsFactory })
      });
    } catch {
      catalog = undefined;
    }
    return context.json(
      availableModelsResponse({
        callsDisabled: policy.callsDisabled,
        configured,
        ...(catalog === undefined ? {} : { catalog })
      })
    );
  });

  app.get("/api/me/providers/:providerId", async (context) => {
    const providerParsed = parseProviderRouteId(context);
    if (!providerParsed.ok) {
      return providerParsed.response;
    }
    const authSession = context.get("authSession");
    const status = await providerCredentials.getCredentialStatus(
      accountId(authSession.account.id),
      providerParsed.providerId
    );
    return context.json(
      providerCredentialStatusResponse({
        configured: status !== undefined,
        callsDisabled: policy.callsDisabled,
        status
      })
    );
  });

  app.put("/api/me/providers/:providerId", async (context) => {
    const providerParsed = parseProviderRouteId(context);
    if (!providerParsed.ok) {
      return providerParsed.response;
    }
    const parsed = await parseJsonRequest(
      context.req.raw,
      setProviderCredentialRequestSchema,
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
      const status = await providerCredentials.setCredential({
        accountId: accountId(authSession.account.id),
        providerId: providerParsed.providerId,
        plaintext: parsed.data.apiKey,
        ...(parsed.data.expectedVersion === undefined
          ? {}
          : { expectedVersion: parsed.data.expectedVersion })
      });
      return context.json(
        providerCredentialStatusResponse({
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

  app.delete("/api/me/providers/:providerId", async (context) => {
    const providerParsed = parseProviderRouteId(context);
    if (!providerParsed.ok) {
      return providerParsed.response;
    }
    const parsed = await parseJsonRequest(
      context.req.raw,
      deleteProviderCredentialRequestSchema,
      OPENAI_PROVIDER_CREDENTIAL_MAX_BYTES
    );
    if (!parsed.success) {
      return invalidRequestResponse(context, parsed);
    }
    try {
      const authSession = context.get("authSession");
      await providerCredentials.deleteCredential({
        accountId: accountId(authSession.account.id),
        providerId: providerParsed.providerId,
        expectedVersion: parsed.data.expectedVersion
      });
      return context.json(
        providerCredentialStatusResponse({
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

  app.post("/api/me/providers/:providerId/validate", async (context) => {
    const providerParsed = parseProviderRouteId(context);
    if (!providerParsed.ok) {
      return providerParsed.response;
    }
    const parsed = await parseJsonRequest(
      context.req.raw,
      validateProviderCredentialRequestSchema,
      OPENAI_PROVIDER_CREDENTIAL_MAX_BYTES
    );
    if (!parsed.success) {
      return invalidRequestResponse(context, parsed);
    }
    try {
      const authSession = context.get("authSession");
      const status = await validateProviderCredential({
        accountId: accountId(authSession.account.id),
        providerId: providerParsed.providerId,
        expectedVersion: parsed.data.expectedVersion
      });
      return context.json(
        providerCredentialStatusResponse({
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
