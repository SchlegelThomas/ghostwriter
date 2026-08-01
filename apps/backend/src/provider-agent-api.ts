import {
  AgentGuidanceConflictError,
  AgentGuidanceNotFoundError,
  availableModelsForCredentials,
  PROVIDER_IDS,
  ProviderCredentialConflictError,
  ProviderCredentialCryptoContextError,
  ProviderCredentialKeyRejectedError,
  ProviderCredentialNotFoundError,
  ProviderCredentialValidationUnsupportedError,
  type AvailableModelCatalogView,
  type ProviderCredentialStatus
} from "@ghostwriter/core";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  ProviderCallsDisabledError,
  ProviderEncryptionUnavailableError
} from "./agent-provider-runtime.js";

export function providerCredentialStatusResponse(input: Readonly<{
  configured: boolean;
  callsDisabled: boolean;
  status?: ProviderCredentialStatus;
}>) {
  if (!input.configured || input.status === undefined) {
    return Object.freeze({
      configured: false as const,
      callsDisabled: input.callsDisabled
    });
  }
  return Object.freeze({
    configured: true as const,
    callsDisabled: input.callsDisabled,
    provider: input.status.provider,
    version: input.status.version,
    maskedHint: input.status.maskedHint,
    validationState: input.status.validationState,
    createdAt: input.status.createdAt,
    updatedAt: input.status.updatedAt,
    ...(input.status.validatedAt === undefined
      ? {}
      : { validatedAt: input.status.validatedAt })
  });
}

/** @deprecated Use {@link providerCredentialStatusResponse}. */
export function openAiProviderStatusResponse(input: Readonly<{
  configured: boolean;
  callsDisabled: boolean;
  status?: ProviderCredentialStatus;
}>) {
  return providerCredentialStatusResponse(input);
}

export function availableModelsResponse(input: Readonly<{
  callsDisabled: boolean;
  configured: readonly ProviderCredentialStatus[];
  catalog?: AvailableModelCatalogView;
}>): AvailableModelCatalogView & Readonly<{ callsDisabled: boolean }> {
  const catalog = input.catalog ?? availableModelsForCredentials(input.configured);
  return Object.freeze({
    callsDisabled: input.callsDisabled,
    models: catalog.models,
    providers: catalog.providers,
    ...(catalog.discovery === undefined ? {} : { discovery: catalog.discovery })
  });
}

export function accountProvidersListResponse(input: Readonly<{
  callsDisabled: boolean;
  configured: readonly ProviderCredentialStatus[];
}>) {
  const configuredByProvider = new Map(
    input.configured.map((status) => [status.provider, status] as const)
  );
  return Object.freeze({
    callsDisabled: input.callsDisabled,
    providers: Object.freeze(
      PROVIDER_IDS.map((providerId) => {
        const status = configuredByProvider.get(providerId);
        if (status === undefined) {
          return Object.freeze({
            provider: providerId,
            configured: false as const
          });
        }
        return Object.freeze({
          provider: providerId,
          configured: true as const,
          version: status.version,
          maskedHint: status.maskedHint,
          validationState: status.validationState,
          createdAt: status.createdAt,
          updatedAt: status.updatedAt,
          ...(status.validatedAt === undefined ? {} : { validatedAt: status.validatedAt })
        });
      })
    )
  });
}

export function providerAgentErrorStatusAndBody(error: unknown):
  | Readonly<{ status: ContentfulStatusCode; body: Readonly<{ error: string; code: string }> }>
  | undefined {
  if (error instanceof ProviderCredentialNotFoundError) {
    return {
      status: 404,
      body: {
        error: "No provider credential is configured.",
        code: "PROVIDER_NOT_CONFIGURED"
      }
    };
  }
  if (error instanceof ProviderCallsDisabledError) {
    return {
      status: 503,
      body: {
        error: "Provider calls are temporarily disabled.",
        code: "PROVIDER_DISABLED"
      }
    };
  }
  if (error instanceof ProviderEncryptionUnavailableError) {
    return {
      status: 503,
      body: {
        error: "Provider credential encryption is unavailable.",
        code: "PROVIDER_ENCRYPTION_UNAVAILABLE"
      }
    };
  }
  if (error instanceof ProviderCredentialCryptoContextError) {
    return {
      status: 503,
      body: {
        error: "Provider credential encryption is unavailable.",
        code: "PROVIDER_ENCRYPTION_UNAVAILABLE"
      }
    };
  }
  if (error instanceof ProviderCredentialKeyRejectedError) {
    return {
      status: 422,
      body: {
        error: "The provider credential could not be accepted.",
        code: "PROVIDER_CREDENTIAL_INVALID"
      }
    };
  }
  if (error instanceof ProviderCredentialConflictError) {
    return {
      status: 409,
      body: {
        error: "The provider credential changed since it was loaded.",
        code: "PROVIDER_CREDENTIAL_CONFLICT"
      }
    };
  }
  if (error instanceof ProviderCredentialValidationUnsupportedError) {
    return {
      status: 501,
      body: {
        error: "Provider credential validation is not available for this provider yet.",
        code: "PROVIDER_VALIDATION_UNSUPPORTED"
      }
    };
  }
  return undefined;
}

export const AI_COLLABORATION_VERSION_CONFLICT_BODY = Object.freeze({
  error: "The AI collaboration profile changed since it was loaded.",
  code: "AI_COLLABORATION_VERSION_CONFLICT"
} as const);

export const PROJECT_INSTRUCTIONS_VERSION_CONFLICT_BODY = Object.freeze({
  error: "The project instructions changed since they were loaded.",
  code: "PROJECT_INSTRUCTIONS_VERSION_CONFLICT"
} as const);

export const PLAYBOOK_VERSION_CONFLICT_BODY = Object.freeze({
  error: "The playbook changed since it was loaded.",
  code: "PLAYBOOK_VERSION_CONFLICT"
} as const);

export const PLAYBOOK_NOT_FOUND_BODY = Object.freeze({
  error: "The requested playbook could not be found.",
  code: "PLAYBOOK_NOT_FOUND"
} as const);

export function mapAgentGuidanceRouteError(
  error: unknown,
  scope: "collaboration" | "instructions" | "playbook"
):
  | Readonly<{ status: ContentfulStatusCode; body: Readonly<{ error: string; code: string }> }>
  | undefined {
  if (error instanceof AgentGuidanceConflictError) {
    const body =
      scope === "collaboration"
        ? AI_COLLABORATION_VERSION_CONFLICT_BODY
        : scope === "instructions"
          ? PROJECT_INSTRUCTIONS_VERSION_CONFLICT_BODY
          : PLAYBOOK_VERSION_CONFLICT_BODY;
    return { status: 409, body };
  }
  if (error instanceof AgentGuidanceNotFoundError) {
    if (scope === "playbook") {
      return { status: 404, body: PLAYBOOK_NOT_FOUND_BODY };
    }
    return { status: 404, body: projectAgentGuidanceNotFoundBody() };
  }
  return providerAgentErrorStatusAndBody(error);
}

export function projectAgentGuidanceNotFoundBody(): Readonly<{
  error: string;
  code: string;
}> {
  return {
    error: "Project not found.",
    code: "PROJECT_NOT_FOUND"
  };
}

export function aiCollaborationProfileResponse(
  profile:
    | Readonly<{
        version: number;
        setupSkipped: boolean;
        posture?: string;
        boundaries?: string;
        updatedAt: string;
      }>
    | undefined
) {
  if (profile === undefined) {
    return Object.freeze({ configured: false as const });
  }
  return Object.freeze({
    configured: true as const,
    profile: Object.freeze({
      version: profile.version,
      setupSkipped: profile.setupSkipped,
      updatedAt: profile.updatedAt,
      ...(profile.posture === undefined ? {} : { posture: profile.posture }),
      ...(profile.boundaries === undefined ? {} : { boundaries: profile.boundaries })
    })
  });
}

export function projectAgentInstructionsResponse(
  instructions:
    | Readonly<{
        version: number;
        body: string;
        contentHash: string;
        createdAt: string;
        updatedAt: string;
      }>
    | undefined
) {
  if (instructions === undefined) {
    return Object.freeze({ configured: false as const });
  }
  return Object.freeze({
    configured: true as const,
    instructions: Object.freeze({
      version: instructions.version,
      body: instructions.body,
      contentHash: instructions.contentHash,
      createdAt: instructions.createdAt,
      updatedAt: instructions.updatedAt
    })
  });
}

export function projectPlaybookResponse(playbook: Readonly<{
  id: string;
  projectId: string;
  version: number;
  name: string;
  enabled: boolean;
  trigger: string;
  allowedContextClasses: readonly string[];
  outputSchemaId: string;
  guidance: string;
  guidanceHash: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}>) {
  return Object.freeze({
    playbook: Object.freeze({
      id: playbook.id,
      projectId: playbook.projectId,
      version: playbook.version,
      name: playbook.name,
      enabled: playbook.enabled,
      trigger: playbook.trigger,
      allowedContextClasses: playbook.allowedContextClasses,
      outputSchemaId: playbook.outputSchemaId,
      guidance: playbook.guidance,
      guidanceHash: playbook.guidanceHash,
      createdAt: playbook.createdAt,
      updatedAt: playbook.updatedAt,
      ...(playbook.archivedAt === undefined ? {} : { archivedAt: playbook.archivedAt })
    })
  });
}
