import {
  createOpenAiCompatibleProvider,
  createOpenAiCompatibleProviderForTests,
  type OpenAiCompatibleProviderConfig,
  type OpenAiCompatibleProviderTestConfig
} from "../openai-compatible/provider.js";
import type { ListingCredentialProvider } from "../types.js";

export const OPENROUTER_API_ORIGIN = "https://openrouter.ai/api/v1";

export type OpenRouterProviderConfig = Readonly<{
  apiKey: string;
}>;

export type OpenRouterProviderTestConfig = OpenRouterProviderConfig & {
  baseUrl: string;
  fetchImpl: typeof fetch;
};

export function createOpenRouterProvider(
  config: OpenRouterProviderConfig
): ListingCredentialProvider {
  return createOpenAiCompatibleProvider({
    apiKey: config.apiKey,
    providerName: "openrouter",
    baseUrl: OPENROUTER_API_ORIGIN
  } satisfies OpenAiCompatibleProviderConfig);
}

export function createOpenRouterProviderForTests(
  config: OpenRouterProviderTestConfig
): ListingCredentialProvider {
  return createOpenAiCompatibleProviderForTests({
    apiKey: config.apiKey,
    providerName: "openrouter",
    baseUrl: config.baseUrl,
    fetchImpl: config.fetchImpl
  } satisfies OpenAiCompatibleProviderTestConfig);
}
