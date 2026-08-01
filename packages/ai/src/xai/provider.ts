import { createXai } from "@ai-sdk/xai";
import { completeStructuredWithLanguageModel } from "../aisdk/structured-completion.js";
import { diagnosticFromHttpStatus } from "../aisdk/map-error.js";
import { aiDiagnostic } from "../diagnostics.js";
import { fetchPaginatedOpenAiStyleModels } from "../model-listing.js";
import type {
  CredentialValidationResult,
  DiscoveredModel,
  ListingCredentialProvider,
  StructuredCompletionInput,
  StructuredCompletionResult
} from "../types.js";

export const XAI_API_ORIGIN = "https://api.x.ai/v1";

export type XaiProviderConfig = Readonly<{
  apiKey: string;
}>;

export type XaiProviderTestConfig = XaiProviderConfig & {
  baseUrl: string;
  fetchImpl: typeof fetch;
};

function createXaiProviderInternal(config: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
}): ListingCredentialProvider {
  const base = config.baseUrl.replace(/\/$/, "");
  const modelsUrl = `${base}/models`;
  const xai = createXai({
    apiKey: config.apiKey,
    baseURL: base,
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
          headers: {
            Authorization: `Bearer ${config.apiKey}`
          },
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
      return fetchPaginatedOpenAiStyleModels({
        fetchImpl: config.fetchImpl,
        initialUrl: modelsUrl,
        headers: {
          Authorization: `Bearer ${config.apiKey}`
        },
        signal,
        paginate: false
      });
    },

    async completeStructured<TOutput>(
      input: StructuredCompletionInput<TOutput>
    ): Promise<StructuredCompletionResult<TOutput>> {
      return completeStructuredWithLanguageModel(xai(input.model), input);
    }
  };
}

export function createXaiProvider(config: XaiProviderConfig): ListingCredentialProvider {
  return createXaiProviderInternal({
    apiKey: config.apiKey,
    baseUrl: XAI_API_ORIGIN,
    fetchImpl: fetch
  });
}

export function createXaiProviderForTests(
  config: XaiProviderTestConfig
): ListingCredentialProvider {
  return createXaiProviderInternal({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    fetchImpl: config.fetchImpl
  });
}
