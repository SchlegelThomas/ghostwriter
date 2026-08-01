import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { completeStructuredWithLanguageModel } from "../aisdk/structured-completion.js";
import { diagnosticFromHttpStatus } from "../aisdk/map-error.js";
import { aiDiagnostic } from "../diagnostics.js";
import { fetchPaginatedGoogleModels } from "../model-listing.js";
import type {
  CredentialValidationResult,
  DiscoveredModel,
  ListingCredentialProvider,
  StructuredCompletionInput,
  StructuredCompletionResult
} from "../types.js";

export const GOOGLE_API_ORIGIN = "https://generativelanguage.googleapis.com";

export type GoogleProviderConfig = {
  apiKey: string;
};

export type GoogleProviderTestConfig = GoogleProviderConfig & {
  baseUrl: string;
  fetchImpl: typeof fetch;
};

function createGoogleProviderInternal(config: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
}): ListingCredentialProvider {
  const modelsUrl = `${config.baseUrl.replace(/\/$/, "")}/v1beta/models?key=${encodeURIComponent(config.apiKey)}`;
  const google = createGoogleGenerativeAI({
    apiKey: config.apiKey,
    baseURL: `${config.baseUrl.replace(/\/$/, "")}/v1beta`,
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
      return fetchPaginatedGoogleModels({
        fetchImpl: config.fetchImpl,
        baseModelsUrl: modelsUrl,
        signal
      });
    },

    async completeStructured<TOutput>(
      input: StructuredCompletionInput<TOutput>
    ): Promise<StructuredCompletionResult<TOutput>> {
      return completeStructuredWithLanguageModel(google(input.model), input);
    }
  };
}

export function createGoogleProvider(
  config: GoogleProviderConfig
): ListingCredentialProvider {
  return createGoogleProviderInternal({
    apiKey: config.apiKey,
    baseUrl: GOOGLE_API_ORIGIN,
    fetchImpl: fetch
  });
}

export function createGoogleProviderForTests(
  config: GoogleProviderTestConfig
): ListingCredentialProvider {
  return createGoogleProviderInternal({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    fetchImpl: config.fetchImpl
  });
}
