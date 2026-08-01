import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
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

export type OpenAiCompatibleProviderConfig = Readonly<{
  apiKey: string;
  /** Provider label passed to createOpenAICompatible (e.g. deepseek). */
  providerName: string;
  /** Base URL including /v1 when required by the upstream API. */
  baseUrl: string;
}>;

export type OpenAiCompatibleProviderTestConfig = OpenAiCompatibleProviderConfig & {
  fetchImpl: typeof fetch;
};

function createOpenAiCompatibleProviderInternal(config: {
  apiKey: string;
  providerName: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
}): ListingCredentialProvider {
  const base = config.baseUrl.replace(/\/$/, "");
  const modelsUrl = `${base}/models`;
  const languageProvider = createOpenAICompatible({
    name: config.providerName,
    baseURL: base,
    apiKey: config.apiKey,
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
      return completeStructuredWithLanguageModel(languageProvider(input.model), input);
    }
  };
}

export function createOpenAiCompatibleProvider(
  config: OpenAiCompatibleProviderConfig
): ListingCredentialProvider {
  return createOpenAiCompatibleProviderInternal({
    apiKey: config.apiKey,
    providerName: config.providerName,
    baseUrl: config.baseUrl,
    fetchImpl: fetch
  });
}

export function createOpenAiCompatibleProviderForTests(
  config: OpenAiCompatibleProviderTestConfig
): ListingCredentialProvider {
  return createOpenAiCompatibleProviderInternal({
    apiKey: config.apiKey,
    providerName: config.providerName,
    baseUrl: config.baseUrl,
    fetchImpl: config.fetchImpl
  });
}
