import {
  DEFAULT_IMAGE_MODEL_ID,
  OPENAI_PROVIDER_ID,
  requireModelCatalogEntry,
  type AccountId
} from "@ghostwriter/core";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import {
  ProviderCallsDisabledError,
  ProviderEncryptionUnavailableError
} from "./agent-provider-runtime.js";

export type ResolvedCatalogImageGeneration = Readonly<{
  apiKey: string;
  model: string;
}>;

function resolveImageModelId(imageModel: string | undefined): string {
  const normalized = imageModel?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return DEFAULT_IMAGE_MODEL_ID;
  }
  return normalized;
}

function assertOpenAiImageCatalogModel(modelId: string): string {
  const entry = requireModelCatalogEntry(modelId);
  if (!entry.supportsImage) {
    throw new Error("Image model must support image generation.");
  }
  if (entry.provider !== OPENAI_PROVIDER_ID) {
    throw new Error("Only OpenAI image models are supported for cover and character visuals.");
  }
  return entry.id;
}

export async function resolveCatalogImageGeneration(input: Readonly<{
  agentProvider: AgentProviderRuntime;
  accountId: AccountId;
  imageModel?: string | undefined;
  usingInjectedGenerator: boolean;
}>): Promise<ResolvedCatalogImageGeneration> {
  const model = assertOpenAiImageCatalogModel(resolveImageModelId(input.imageModel));

  if (input.usingInjectedGenerator) {
    return Object.freeze({
      apiKey: "injected-image-generator",
      model
    });
  }

  if (input.agentProvider.policy.callsDisabled) {
    throw new ProviderCallsDisabledError();
  }
  if (!input.agentProvider.policy.encryptionAvailable) {
    throw new ProviderEncryptionUnavailableError();
  }

  const apiKey = await input.agentProvider.resolveProviderApiKey({
    accountId: input.accountId,
    providerId: OPENAI_PROVIDER_ID
  });

  return Object.freeze({
    apiKey,
    model
  });
}
