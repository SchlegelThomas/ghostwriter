import {
  createOpenAiCompatibleProvider,
  createOpenAiCompatibleProviderForTests,
  type OpenAiCompatibleProviderConfig,
  type OpenAiCompatibleProviderTestConfig
} from "../openai-compatible/provider.js";
import type { ListingCredentialProvider } from "../types.js";

export const DEEPSEEK_API_ORIGIN = "https://api.deepseek.com/v1";

export type DeepSeekProviderConfig = Readonly<{
  apiKey: string;
}>;

export type DeepSeekProviderTestConfig = DeepSeekProviderConfig & {
  baseUrl: string;
  fetchImpl: typeof fetch;
};

export function createDeepSeekProvider(
  config: DeepSeekProviderConfig
): ListingCredentialProvider {
  return createOpenAiCompatibleProvider({
    apiKey: config.apiKey,
    providerName: "deepseek",
    baseUrl: DEEPSEEK_API_ORIGIN
  } satisfies OpenAiCompatibleProviderConfig);
}

export function createDeepSeekProviderForTests(
  config: DeepSeekProviderTestConfig
): ListingCredentialProvider {
  return createOpenAiCompatibleProviderForTests({
    apiKey: config.apiKey,
    providerName: "deepseek",
    baseUrl: config.baseUrl,
    fetchImpl: config.fetchImpl
  } satisfies OpenAiCompatibleProviderTestConfig);
}
