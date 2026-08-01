import { combineAbortWithTimeout, type CombinedAbort } from "../abort-timeout.js";
import { aiDiagnostic } from "../diagnostics.js";
import { fetchPaginatedOpenAiStyleModels } from "../model-listing.js";
import type {
  CredentialValidationResult,
  DiscoveredModel,
  ListingCredentialProvider,
  StructuredCompletionInput,
  StructuredCompletionResult
} from "../types.js";
import { OPENAI_API_ORIGIN } from "./responses.js";
import {
  buildOpenAiResponsesRequest,
  extractAssistantOutputText,
  isBudgetExceeded,
  mapOpenAiFinishStatus,
  mapOpenAiUsage,
  type OpenAiResponsesBody
} from "./responses.js";

export type OpenAiProviderConfig = {
  apiKey: string;
};

export type OpenAiProviderTestConfig = OpenAiProviderConfig & {
  baseUrl: string;
  fetchImpl: typeof fetch;
};

function authorizationHeader(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function diagnosticFromHttpStatus(status: number): import("../types.js").AiDiagnostic {
  if (status === 401 || status === 403) {
    return aiDiagnostic("auth_failed");
  }
  if (status === 429) {
    return aiDiagnostic("rate_limited");
  }
  if (status >= 500) {
    return aiDiagnostic("upstream_error");
  }
  return aiDiagnostic("upstream_error");
}

function diagnosticFromFetchFailure(
  combined: CombinedAbort,
  callerSignal: AbortSignal | undefined
): import("../types.js").AiDiagnostic {
  const reason = combined.reason();
  if (reason === "timeout") {
    return aiDiagnostic("timeout");
  }
  if (reason === "caller" || callerSignal?.aborted) {
    return aiDiagnostic("cancelled");
  }
  return aiDiagnostic("upstream_error");
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function createOpenAiProviderInternal(config: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
}): ListingCredentialProvider {
  const responsesUrl = `${config.baseUrl.replace(/\/$/, "")}/v1/responses`;
  const modelsUrl = `${config.baseUrl.replace(/\/$/, "")}/v1/models`;

  return {
    async validateCredential(signal?: AbortSignal): Promise<CredentialValidationResult> {
      if (signal?.aborted) {
        return { ok: false, diagnostic: aiDiagnostic("cancelled") };
      }

      try {
        const response = await config.fetchImpl(modelsUrl, {
          method: "GET",
          headers: authorizationHeader(config.apiKey),
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
        headers: authorizationHeader(config.apiKey),
        signal,
        paginate: false
      });
    },

    async completeStructured<TOutput>(
      input: StructuredCompletionInput<TOutput>
    ): Promise<StructuredCompletionResult<TOutput>> {
      const combined = combineAbortWithTimeout(input.signal, input.maxDurationMs);

      try {
        if (combined.signal.aborted) {
          const reason = combined.reason();
          return {
            ok: false,
            diagnostic: aiDiagnostic(reason === "timeout" ? "timeout" : "cancelled")
          };
        }

        const requestBody = buildOpenAiResponsesRequest(input);

        let response: Response;
        try {
          response = await config.fetchImpl(responsesUrl, {
            method: "POST",
            headers: authorizationHeader(config.apiKey),
            body: JSON.stringify(requestBody),
            signal: combined.signal
          });
        } catch {
          return { ok: false, diagnostic: diagnosticFromFetchFailure(combined, input.signal) };
        }

        if (!response.ok) {
          return { ok: false, diagnostic: diagnosticFromHttpStatus(response.status) };
        }

        const parsed = (await readJsonResponse(response)) as OpenAiResponsesBody;

        if (isBudgetExceeded(parsed)) {
          return { ok: false, diagnostic: aiDiagnostic("budget_exceeded") };
        }

        const finishStatus = mapOpenAiFinishStatus(parsed.status);
        if (finishStatus === "failed" || finishStatus === "cancelled") {
          return { ok: false, diagnostic: aiDiagnostic("upstream_error") };
        }

        const extracted = extractAssistantOutputText(parsed);
        if (extracted.kind === "refusal") {
          return { ok: false, diagnostic: aiDiagnostic("refusal") };
        }
        if (extracted.kind === "missing") {
          return { ok: false, diagnostic: aiDiagnostic("invalid_structured_output") };
        }

        let jsonValue: unknown;
        try {
          jsonValue = JSON.parse(extracted.text);
        } catch {
          return { ok: false, diagnostic: aiDiagnostic("invalid_structured_output") };
        }

        if (!input.validateOutput(jsonValue)) {
          return { ok: false, diagnostic: aiDiagnostic("validation_failed") };
        }

        return {
          ok: true,
          output: jsonValue,
          usage: mapOpenAiUsage(parsed.usage),
          providerResponseId: parsed.id ?? "",
          providerModel: parsed.model ?? input.model,
          finishStatus
        };
      } finally {
        combined.dispose();
      }
    }
  };
}

/** Production OpenAI adapter; fixed API origin, native fetch. */
export function createOpenAiProvider(config: OpenAiProviderConfig): ListingCredentialProvider {
  return createOpenAiProviderInternal({
    apiKey: config.apiKey,
    baseUrl: OPENAI_API_ORIGIN,
    fetchImpl: fetch
  });
}

/** Injectable fetch/base URL for unit tests only. */
export function createOpenAiProviderForTests(
  config: OpenAiProviderTestConfig
): ListingCredentialProvider {
  return createOpenAiProviderInternal({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    fetchImpl: config.fetchImpl
  });
}
