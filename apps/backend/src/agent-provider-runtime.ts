import {
  createProviderAdapter,
  ProviderAdapterUnsupportedError,
  type CredentialValidatingProvider,
  type ListingCredentialProvider,
  type StructuredCompletionProvider
} from "@ghostwriter/ai";
import {
  createAgentFoundationServices,
  createAgentGuidanceServices,
  createCaptureReflectionServices,
  createCraftPartnerServices,
  createCraftProposalApplyServices,
  createMcpGrantServices,
  createProjectCommandServices,
  createProviderCredentialServices,
  encryptedMaterialFromEnvelope,
  OPENAI_PROVIDER_ID,
  providerForAgentModel,
  ProviderCredentialConflictError,
  ProviderCredentialCryptoContextError,
  ProviderCredentialNotFoundError,
  ProviderCredentialValidationUnsupportedError,
  type AccountId,
  type AgentFoundationServices,
  type AgentGuidanceServices,
  type CaptureDocumentRepository,
  type CapturePromotionServices,
  type CaptureReflectionServices,
  type CaptureReflectionStructuredCompletionProvider,
  type Clock,
  type CraftPartnerServices,
  type CraftPartnerStructuredCompletionProvider,
  type IdGenerator,
  type McpGrantServices,
  type ProjectRepository,
  type ProviderCredentialRepository,
  type ProviderCredentialServices,
  type ProviderCredentialStatus,
  type ProviderCredentialValidationState,
  type ProviderId,
  type SceneDocumentRepository
} from "@ghostwriter/core";
import {
  createPostgresAccountAiCollaborationProfileRepository,
  createPostgresAgentProposalRepository,
  createPostgresAgentRunReflectionCompletionUnitOfWork,
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository,
  createPostgresMcpGrantRepository,
  createPostgresProjectAgentInstructionsRepository,
  createPostgresProjectPlaybookRepository,
  createPostgresProviderCredentialRepository,
  type NodePostgresConnection
} from "@ghostwriter/storage";
import type { ProviderKekRuntimeConfig } from "./provider-kek-config.js";
import { parseProviderCallsDisabled } from "./provider-kek-config.js";
import {
  createNodeProviderCredentialCrypto,
  createUnavailableProviderCredentialCrypto
} from "./provider-credential-crypto.js";
import { createNodeSha256HashPort } from "./node-sha256-hash-port.js";
import { createNodeMcpGrantTokenPort } from "./mcp-grant-token-port.js";

export type ProviderValidationFactory = (
  apiKey: string,
  providerId: ProviderId
) => CredentialValidatingProvider;

export type ProviderCompletionFactory = (
  apiKey: string,
  providerId: ProviderId
) => StructuredCompletionProvider;

/** @deprecated Use {@link ProviderValidationFactory}. */
export type OpenAiValidationProviderFactory = (
  apiKey: string
) => CredentialValidatingProvider;

/** @deprecated Use {@link ProviderCompletionFactory}. */
export type OpenAiCompletionProviderFactory = (
  apiKey: string
) => StructuredCompletionProvider;

export type AgentProviderPolicy = Readonly<{
  callsDisabled: boolean;
  encryptionAvailable: boolean;
}>;

export type ModelListFactory = (input: Readonly<{
  providerId: ProviderId;
  apiKey: string;
}>) => ListingCredentialProvider;

export type AgentProviderRuntime = Readonly<{
  providerCredentials: ProviderCredentialServices;
  agentGuidance: AgentGuidanceServices;
  foundation: AgentFoundationServices;
  captureReflection: CaptureReflectionServices;
  craftPartners: CraftPartnerServices;
  mcpGrants: McpGrantServices;
  policy: AgentProviderPolicy;
  /** Optional test seam for live model discovery. */
  listModelsFactory?: ModelListFactory;
  validateOpenAiCredential(input: Readonly<{
    accountId: AccountId;
    expectedVersion: number;
    createProvider?: OpenAiValidationProviderFactory;
  }>): Promise<ProviderCredentialStatus>;
  validateProviderCredential(input: Readonly<{
    accountId: AccountId;
    providerId: ProviderId;
    expectedVersion: number;
    createProvider?: ProviderValidationFactory | OpenAiValidationProviderFactory;
  }>): Promise<ProviderCredentialStatus>;
  createCompletionProvider(input: Readonly<{
    accountId: AccountId;
    providerId: ProviderId;
    createProvider?: ProviderCompletionFactory | OpenAiCompletionProviderFactory;
  }>): Promise<
    CaptureReflectionStructuredCompletionProvider &
      CraftPartnerStructuredCompletionProvider
  >;
  createCompletionProviderForModel(input: Readonly<{
    accountId: AccountId;
    model: string;
    providerId?: ProviderId;
    createProvider?: ProviderCompletionFactory | OpenAiCompletionProviderFactory;
  }>): Promise<
    CaptureReflectionStructuredCompletionProvider &
      CraftPartnerStructuredCompletionProvider
  >;
  /** @deprecated Prefer {@link AgentProviderRuntime.createCompletionProviderForModel}. */
  createOpenAiCompletionProvider(input: Readonly<{
    accountId: AccountId;
    createProvider?: OpenAiCompletionProviderFactory;
  }>): Promise<
    CaptureReflectionStructuredCompletionProvider &
      CraftPartnerStructuredCompletionProvider
  >;
  /** Decrypts a provider key for ephemeral adapter calls (never log/return). */
  resolveProviderApiKey(input: Readonly<{
    accountId: AccountId;
    providerId: ProviderId;
  }>): Promise<string>;
  /** Decrypts the writer's OpenAI key for ephemeral provider calls (never log/return). */
  resolveOpenAiApiKey(input: Readonly<{
    accountId: AccountId;
  }>): Promise<string>;
}>;

export type CreateAgentProviderRuntimeInput = Readonly<{
  db: NodePostgresConnection["db"];
  projects: ProjectRepository;
  captureDocuments: CaptureDocumentRepository;
  ids: IdGenerator;
  clock: Clock;
  kekConfig: ProviderKekRuntimeConfig | undefined;
  callsDisabled?: boolean;
  credentials?: ProviderCredentialRepository;
  defaultValidationProviderFactory?: ProviderValidationFactory | OpenAiValidationProviderFactory;
  defaultCompletionProviderFactory?: ProviderCompletionFactory | OpenAiCompletionProviderFactory;
  /** @deprecated Prefer defaultValidationProviderFactory. */
  openAiValidationProviderFactory?: OpenAiValidationProviderFactory;
  listModelsFactory?: ModelListFactory;
  capturePromotions?: Pick<CapturePromotionServices, "promoteCaptureToScene">;
  sceneDocuments?: SceneDocumentRepository;
}>;

export class ProviderCallsDisabledError extends Error {
  constructor() {
    super("Provider calls are temporarily disabled.");
    this.name = "ProviderCallsDisabledError";
  }
}

export class ProviderEncryptionUnavailableError extends Error {
  constructor() {
    super("Provider credential encryption is unavailable.");
    this.name = "ProviderEncryptionUnavailableError";
  }
}

function toStructuredCompletionProvider(
  provider: StructuredCompletionProvider
): CaptureReflectionStructuredCompletionProvider &
  CraftPartnerStructuredCompletionProvider {
  return Object.freeze({
    async completeStructured(input: Readonly<{
      workflow: string;
      model: string;
      instructions: string;
      inputText: string;
      outputSchema: Readonly<{ name: string; schema: Record<string, unknown> }>;
      maxOutputTokens: number;
      maxDurationMs: number;
      validateOutput: (value: unknown) => boolean;
      signal?: AbortSignal;
    }>) {
      const result = await provider.completeStructured({
        ...input,
        validateOutput: (value: unknown): value is unknown =>
          input.validateOutput(value)
      });
      if (!result.ok) {
        return Object.freeze({
          ok: false as const,
          diagnostic: result.diagnostic
        });
      }
      return Object.freeze({
        ok: true as const,
        output: result.output,
        usage: result.usage,
        providerResponseId: result.providerResponseId
      });
    }
  }) as CaptureReflectionStructuredCompletionProvider &
    CraftPartnerStructuredCompletionProvider;
}

function asValidationFactory(
  factory: ProviderValidationFactory | OpenAiValidationProviderFactory | undefined
): ProviderValidationFactory | undefined {
  if (factory === undefined) {
    return undefined;
  }
  return (apiKey, providerId) => {
    if (factory.length >= 2) {
      return (factory as ProviderValidationFactory)(apiKey, providerId);
    }
    return (factory as OpenAiValidationProviderFactory)(apiKey);
  };
}

function asCompletionFactory(
  factory: ProviderCompletionFactory | OpenAiCompletionProviderFactory | undefined
): ProviderCompletionFactory | undefined {
  if (factory === undefined) {
    return undefined;
  }
  return (apiKey, providerId) => {
    if (factory.length >= 2) {
      return (factory as ProviderCompletionFactory)(apiKey, providerId);
    }
    return (factory as OpenAiCompletionProviderFactory)(apiKey);
  };
}

export function createAgentProviderRuntime(
  input: CreateAgentProviderRuntimeInput
): AgentProviderRuntime {
  const encryptionAvailable = input.kekConfig !== undefined;
  const crypto = encryptionAvailable
    ? createNodeProviderCredentialCrypto(input.kekConfig!)
    : createUnavailableProviderCredentialCrypto();
  const credentials =
    input.credentials ?? createPostgresProviderCredentialRepository(input.db);
  const providerCredentials = createProviderCredentialServices({
    credentials,
    crypto,
    clock: input.clock
  });
  const hashPort = createNodeSha256HashPort();
  const agentGuidance = createAgentGuidanceServices({
    projects: input.projects,
    collaborationProfiles: createPostgresAccountAiCollaborationProfileRepository(input.db),
    projectInstructions: createPostgresProjectAgentInstructionsRepository(input.db),
    playbooks: createPostgresProjectPlaybookRepository(input.db),
    hashPort,
    ids: input.ids,
    clock: input.clock
  });
  const receipts = createPostgresContextReceiptRepository(input.db);
  const runs = createPostgresAgentRunRepository(input.db);
  const proposals = createPostgresAgentProposalRepository(input.db);
  const foundation = createAgentFoundationServices({
    projects: input.projects,
    captureDocuments: input.captureDocuments,
    receipts,
    runs,
    proposals,
    completion: createPostgresAgentRunReflectionCompletionUnitOfWork(input.db),
    hashPort,
    clock: input.clock,
    ...(input.capturePromotions !== undefined && input.sceneDocuments !== undefined
      ? {
          apply: {
            capturePromotions: input.capturePromotions,
            sceneDocuments: input.sceneDocuments,
            ids: input.ids
          }
        }
      : {})
  });
  const captureReflection = createCaptureReflectionServices({
    projects: input.projects,
    captureDocuments: input.captureDocuments,
    receipts,
    foundation,
    guidance: agentGuidance,
    hashPort,
    ids: input.ids,
    clock: input.clock
  });
  const craftApply = createCraftProposalApplyServices({
    projects: input.projects,
    captureDocuments: input.captureDocuments,
    proposals,
    receipts,
    projectCommands: createProjectCommandServices({
      projects: input.projects,
      ids: input.ids,
      clock: input.clock
    }),
    clock: input.clock
  });
  const craftPartners = createCraftPartnerServices({
    projects: input.projects,
    captureDocuments: input.captureDocuments,
    receipts,
    foundation,
    guidance: agentGuidance,
    craftApply,
    hashPort,
    ids: input.ids,
    clock: input.clock
  });
  const mcpGrants = createMcpGrantServices({
    projects: input.projects,
    grants: createPostgresMcpGrantRepository(input.db),
    captureDocuments: input.captureDocuments,
    captureReflection,
    tokens: createNodeMcpGrantTokenPort(),
    ids: input.ids,
    clock: input.clock
  });
  const callsDisabled = input.callsDisabled ?? false;
  const defaultValidationProviderFactory: ProviderValidationFactory =
    asValidationFactory(
      input.defaultValidationProviderFactory ?? input.openAiValidationProviderFactory
    ) ??
    ((apiKey, providerId) => {
      try {
        return createProviderAdapter({ providerId, apiKey });
      } catch (error) {
        if (error instanceof ProviderAdapterUnsupportedError) {
          throw new ProviderCredentialValidationUnsupportedError();
        }
        throw error;
      }
    });
  const defaultCompletionProviderFactory: ProviderCompletionFactory =
    asCompletionFactory(input.defaultCompletionProviderFactory) ??
    ((apiKey, providerId) => {
      try {
        return createProviderAdapter({ providerId, apiKey });
      } catch (error) {
        if (error instanceof ProviderAdapterUnsupportedError) {
          throw new ProviderCredentialValidationUnsupportedError();
        }
        throw error;
      }
    });

  async function decryptProviderApiKey(
    accountId: AccountId,
    providerId: ProviderId
  ): Promise<string> {
    if (callsDisabled) {
      throw new ProviderCallsDisabledError();
    }
    if (!encryptionAvailable) {
      throw new ProviderEncryptionUnavailableError();
    }
    const envelope = await credentials.get(accountId, providerId);
    if (envelope === undefined) {
      throw new ProviderCredentialNotFoundError();
    }
    try {
      return await crypto.decrypt({
        accountId: envelope.accountId,
        provider: providerId,
        material: encryptedMaterialFromEnvelope(envelope)
      });
    } catch (error) {
      if (error instanceof ProviderCredentialCryptoContextError) {
        throw new ProviderEncryptionUnavailableError();
      }
      throw error;
    }
  }

  async function validateProviderCredentialInternal(validateInput: Readonly<{
    accountId: AccountId;
    providerId: ProviderId;
    expectedVersion: number;
    createProvider?: ProviderValidationFactory | OpenAiValidationProviderFactory;
  }>): Promise<ProviderCredentialStatus> {
    if (callsDisabled) {
      throw new ProviderCallsDisabledError();
    }
    if (!encryptionAvailable) {
      throw new ProviderEncryptionUnavailableError();
    }
    const envelope = await credentials.get(validateInput.accountId, validateInput.providerId);
    if (envelope === undefined) {
      throw new ProviderCredentialNotFoundError();
    }
    if (envelope.version !== validateInput.expectedVersion) {
      throw new ProviderCredentialConflictError();
    }
    let plaintext: string;
    try {
      plaintext = await crypto.decrypt({
        accountId: envelope.accountId,
        provider: validateInput.providerId,
        material: encryptedMaterialFromEnvelope(envelope)
      });
    } catch (error) {
      if (error instanceof ProviderCredentialCryptoContextError) {
        throw new ProviderEncryptionUnavailableError();
      }
      throw error;
    }
    const factory =
      asValidationFactory(validateInput.createProvider) ?? defaultValidationProviderFactory;
    const provider = factory(plaintext, validateInput.providerId);
    const validation = await provider.validateCredential();
    const validationState: ProviderCredentialValidationState = validation.ok
      ? "valid"
      : "invalid";
    return providerCredentials.markCredentialValidation({
      accountId: validateInput.accountId,
      providerId: validateInput.providerId,
      expectedVersion: validateInput.expectedVersion,
      validationState
    });
  }

  async function createCompletionProviderInternal(completionInput: Readonly<{
    accountId: AccountId;
    providerId: ProviderId;
    createProvider?: ProviderCompletionFactory | OpenAiCompletionProviderFactory;
  }>): Promise<
    CaptureReflectionStructuredCompletionProvider &
      CraftPartnerStructuredCompletionProvider
  > {
    const plaintext = await decryptProviderApiKey(
      completionInput.accountId,
      completionInput.providerId
    );
    const factory =
      asCompletionFactory(completionInput.createProvider) ?? defaultCompletionProviderFactory;
    return toStructuredCompletionProvider(
      factory(plaintext, completionInput.providerId)
    );
  }

  return Object.freeze({
    providerCredentials,
    agentGuidance,
    foundation,
    captureReflection,
    craftPartners,
    mcpGrants,
    policy: Object.freeze({
      callsDisabled,
      encryptionAvailable
    }),
    validateOpenAiCredential: async (validateInput) =>
      validateProviderCredentialInternal({
        accountId: validateInput.accountId,
        providerId: OPENAI_PROVIDER_ID,
        expectedVersion: validateInput.expectedVersion,
        createProvider: validateInput.createProvider
      }),
    validateProviderCredential: validateProviderCredentialInternal,
    createCompletionProvider: createCompletionProviderInternal,
    createCompletionProviderForModel: async (completionInput) => {
      const providerId =
        completionInput.providerId ?? providerForAgentModel(completionInput.model);
      return createCompletionProviderInternal({
        accountId: completionInput.accountId,
        providerId,
        createProvider: completionInput.createProvider
      });
    },
    createOpenAiCompletionProvider: async (completionInput) =>
      createCompletionProviderInternal({
        accountId: completionInput.accountId,
        providerId: OPENAI_PROVIDER_ID,
        createProvider: completionInput.createProvider
      }),
    resolveProviderApiKey: async (resolveInput) =>
      decryptProviderApiKey(resolveInput.accountId, resolveInput.providerId),
    resolveOpenAiApiKey: async (resolveInput) =>
      decryptProviderApiKey(resolveInput.accountId, OPENAI_PROVIDER_ID),
    ...(input.listModelsFactory === undefined
      ? {}
      : { listModelsFactory: input.listModelsFactory })
  });
}

export function createTestAgentProviderRuntime(
  input: CreateAgentProviderRuntimeInput
): AgentProviderRuntime {
  return createAgentProviderRuntime({
    ...input,
    callsDisabled: input.callsDisabled ?? false
  });
}

export function providerPolicyFromEnv(env: NodeJS.ProcessEnv): AgentProviderPolicy {
  return Object.freeze({
    callsDisabled: parseProviderCallsDisabled(env),
    encryptionAvailable: false
  });
}
