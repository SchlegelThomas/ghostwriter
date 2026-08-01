import { createAnthropic } from "@ai-sdk/anthropic";
import { completeStructuredWithLanguageModel } from "../aisdk/structured-completion.js";
import { diagnosticFromHttpStatus } from "../aisdk/map-error.js";
import { aiDiagnostic } from "../diagnostics.js";
import { fetchPaginatedAnthropicModels } from "../model-listing.js";
import type {
  CredentialValidationResult,
  DiscoveredModel,
  ListingCredentialProvider,
  StructuredCompletionInput,
  StructuredCompletionResult
} from "../types.js";

export const ANTHROPIC_API_ORIGIN = "https://api.anthropic.com";

export type AnthropicProviderConfig = {
  apiKey: string;
};

export type AnthropicProviderTestConfig = AnthropicProviderConfig & {
  baseUrl: string;
  fetchImpl: typeof fetch;
};

function anthropicHeaders(apiKey: string): HeadersInit {
  return {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01"
  };
}

function createAnthropicProviderInternal(config: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
}): ListingCredentialProvider {
  const modelsUrl = `${config.baseUrl.replace(/\/$/, "")}/v1/models`;
  const anthropic = createAnthropic({
    apiKey: config.apiKey,
    baseURL: `${config.baseUrl.replace(/\/$/, "")}/v1`,
    fetch: config.fetchImpl
  });

  return {
    async validateCredential(signal?: AbortSignal): Promise<CredentialValidationResult> {
      if (signal?.aborted) {
        return { ok: false, diagnostic: aiDiagnostic("cancelled") };
      }
      try {
        const response = await config.fetchImpl(modelsUrl, {
          method: "GET",
          headers: anthropicHeaders(config.apiKey),
          signal
        });
        if (response.ok) {
          return { ok: true };
        }
        return { ok: false, diagnostic: diagnosticFromHttpStatus(response.status) };
      } catch (error) {
        if (signal?.aborted) {
          return { ok: false, diagnostic: aiDiagnostic("cancelled") };
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          return { ok: false, diagnostic: aiDiagnostic("cancelled") };
        }
        return { ok: false, diagnostic: aiDiagnostic("upstream_error") };
      }
    },

    async listModels(signal?: AbortSignal): Promise<readonly DiscoveredModel[]> {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
      }
      return fetchPaginatedAnthropicModels({
        fetchImpl: config.fetchImpl,
        baseModelsUrl: modelsUrl,
        headers: anthropicHeaders(config.apiKey),
        signal
      });
    },

    async completeStructured<TOutput>(
      input: StructuredCompletionInput<TOutput>
    ): Promise<StructuredCompletionResult<TOutput>> {
      return completeStructuredWithLanguageModel(anthropic(input.model), input);
    }
  };
}

export function createAnthropicProvider(
  config: AnthropicProviderConfig
): ListingCredentialProvider {
  return createAnthropicProviderInternal({
    apiKey: config.apiKey,
    baseUrl: ANTHROPIC_API_ORIGIN,
    fetchImpl: fetch
  });
}

export function createAnthropicProviderForTests(
  config: AnthropicProviderTestConfig
): ListingCredentialProvider {
  return createAnthropicProviderInternal({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    fetchImpl: config.fetchImpl
  });
}
