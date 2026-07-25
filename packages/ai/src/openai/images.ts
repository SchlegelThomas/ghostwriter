import { combineAbortWithTimeout, type CombinedAbort } from "../abort-timeout.js";
import { aiDiagnostic } from "../diagnostics.js";
import type { AiDiagnostic } from "../types.js";
import { OPENAI_API_ORIGIN } from "./responses.js";

/** Default GPT Image model — current accounts often lack DALL·E access. */
export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-1";

export type OpenAiImageGenerationInput = Readonly<{
  apiKey: string;
  prompt: string;
  /** Defaults to gpt-image-1. */
  model?: string;
  /** Defaults to 1024x1024. */
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "1024x1792" | "1792x1024";
  maxDurationMs?: number;
  signal?: AbortSignal;
}>;

function usesLegacyDalleResponseFormat(model: string): boolean {
  return model.startsWith("dall-e-");
}

export type OpenAiImageGenerationSuccess = Readonly<{
  ok: true;
  b64Json: string;
  dataUri: string;
}>;

export type OpenAiImageGenerationFailure = Readonly<{
  ok: false;
  diagnostic: AiDiagnostic;
}>;

export type OpenAiImageGenerationResult =
  | OpenAiImageGenerationSuccess
  | OpenAiImageGenerationFailure;

export type OpenAiImageGenerationTestConfig = Readonly<{
  baseUrl: string;
  fetchImpl: typeof fetch;
}>;

function authorizationHeader(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function diagnosticFromHttpStatus(status: number): AiDiagnostic {
  if (status === 401 || status === 403) {
    return aiDiagnostic("auth_failed");
  }
  if (status === 429) {
    return aiDiagnostic("rate_limited");
  }
  return aiDiagnostic("upstream_error");
}

function diagnosticFromImageErrorBody(
  body: unknown,
  status: number
): AiDiagnostic {
  if (typeof body === "object" && body !== null) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "object" && error !== null) {
      const code = (error as { code?: unknown }).code;
      const message = String((error as { message?: unknown }).message ?? "");
      if (
        code === "moderation_blocked" ||
        /safety system|moderation/iu.test(message)
      ) {
        return aiDiagnostic("refusal");
      }
    }
  }
  return diagnosticFromHttpStatus(status);
}

function diagnosticFromFetchFailure(
  combined: CombinedAbort,
  callerSignal: AbortSignal | undefined
): AiDiagnostic {
  const reason = combined.reason();
  if (reason === "timeout") {
    return aiDiagnostic("timeout");
  }
  if (reason === "caller" || callerSignal?.aborted) {
    return aiDiagnostic("cancelled");
  }
  return aiDiagnostic("upstream_error");
}

function extractB64Json(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return undefined;
  const first = data[0];
  if (typeof first !== "object" || first === null) return undefined;
  const b64 = (first as { b64_json?: unknown }).b64_json;
  return typeof b64 === "string" && b64.length > 0 ? b64 : undefined;
}

async function generateOpenAiImageInternal(
  input: OpenAiImageGenerationInput,
  config: Readonly<{ baseUrl: string; fetchImpl: typeof fetch }>
): Promise<OpenAiImageGenerationResult> {
  const prompt = input.prompt.trim();
  if (prompt.length === 0) {
    return { ok: false, diagnostic: aiDiagnostic("validation_failed") };
  }

  const combined = combineAbortWithTimeout(
    input.signal,
    input.maxDurationMs ?? 90_000
  );
  const url = `${config.baseUrl.replace(/\/$/, "")}/v1/images/generations`;

  try {
    if (combined.signal.aborted) {
      return {
        ok: false,
        diagnostic: aiDiagnostic(
          combined.reason() === "timeout" ? "timeout" : "cancelled"
        )
      };
    }

    const model = input.model ?? DEFAULT_OPENAI_IMAGE_MODEL;
    const body: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
      size: input.size ?? "1024x1024"
    };
    // GPT Image models reject response_format and always return b64_json.
    if (usesLegacyDalleResponseFormat(model)) {
      body.response_format = "b64_json";
    }

    let response: Response;
    try {
      response = await config.fetchImpl(url, {
        method: "POST",
        headers: authorizationHeader(input.apiKey),
        body: JSON.stringify(body),
        signal: combined.signal
      });
    } catch {
      return {
        ok: false,
        diagnostic: diagnosticFromFetchFailure(combined, input.signal)
      };
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return {
        ok: false,
        diagnostic: response.ok
          ? aiDiagnostic("upstream_error")
          : diagnosticFromHttpStatus(response.status)
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        diagnostic: diagnosticFromImageErrorBody(parsed, response.status)
      };
    }

    const b64Json = extractB64Json(parsed);
    if (b64Json === undefined) {
      return { ok: false, diagnostic: aiDiagnostic("invalid_structured_output") };
    }

    return {
      ok: true,
      b64Json,
      dataUri: `data:image/png;base64,${b64Json}`
    };
  } finally {
    combined.dispose();
  }
}

/** Production OpenAI Images adapter; fixed API origin, native fetch. */
export function generateOpenAiImage(
  input: OpenAiImageGenerationInput
): Promise<OpenAiImageGenerationResult> {
  return generateOpenAiImageInternal(input, {
    baseUrl: OPENAI_API_ORIGIN,
    fetchImpl: fetch
  });
}

/** Injectable fetch/base URL for unit tests only. */
export function generateOpenAiImageForTests(
  input: OpenAiImageGenerationInput,
  config: OpenAiImageGenerationTestConfig
): Promise<OpenAiImageGenerationResult> {
  return generateOpenAiImageInternal(input, config);
}
