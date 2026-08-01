import { createAnthropicProvider } from "./anthropic/provider.js";
import { createDeepSeekProvider } from "./deepseek/provider.js";
import { createGoogleProvider } from "./google/provider.js";
import { createGroqProvider } from "./groq/provider.js";
import { createMistralProvider } from "./mistral/provider.js";
import { createOpenAiProvider } from "./openai/provider.js";
import { createOpenRouterProvider } from "./openrouter/provider.js";
import { createXaiProvider } from "./xai/provider.js";
import type { ListingCredentialProvider } from "./types.js";

export type AiProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "groq"
  | "xai"
  | "mistral"
  | "deepseek"
  | "openrouter";

export class ProviderAdapterUnsupportedError extends Error {
  constructor(providerId: string) {
    super(`No live adapter is available for provider "${providerId}" yet.`);
    this.name = "ProviderAdapterUnsupportedError";
  }
}

/** Create a Ghostwriter port adapter for a supported BYOK provider id. */
export function createProviderAdapter(input: Readonly<{
  providerId: AiProviderId;
  apiKey: string;
}>): ListingCredentialProvider {
  switch (input.providerId) {
    case "openai":
      return createOpenAiProvider({ apiKey: input.apiKey });
    case "anthropic":
      return createAnthropicProvider({ apiKey: input.apiKey });
    case "google":
      return createGoogleProvider({ apiKey: input.apiKey });
    case "groq":
      return createGroqProvider({ apiKey: input.apiKey });
    case "xai":
      return createXaiProvider({ apiKey: input.apiKey });
    case "mistral":
      return createMistralProvider({ apiKey: input.apiKey });
    case "deepseek":
      return createDeepSeekProvider({ apiKey: input.apiKey });
    case "openrouter":
      return createOpenRouterProvider({ apiKey: input.apiKey });
    default: {
      const _exhaustive: never = input.providerId;
      throw new ProviderAdapterUnsupportedError(_exhaustive);
    }
  }
}
