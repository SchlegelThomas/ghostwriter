import { generateObject, jsonSchema, type LanguageModel } from "ai";
import { combineAbortWithTimeout } from "../abort-timeout.js";
import { aiDiagnostic } from "../diagnostics.js";
import type {
  StructuredCompletionInput,
  StructuredCompletionResult
} from "../types.js";
import { mapAiSdkError } from "./map-error.js";

function usageFromAiSdk(usage: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
}): { inputTokens: number; outputTokens: number; totalTokens: number } {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

export async function completeStructuredWithLanguageModel<TOutput>(
  model: LanguageModel,
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

    const result = await generateObject({
      model,
      schema: jsonSchema(input.outputSchema.schema),
      schemaName: input.outputSchema.name,
      system: input.instructions,
      prompt: input.inputText,
      maxOutputTokens: input.maxOutputTokens,
      abortSignal: combined.signal
    });

    if (!input.validateOutput(result.object)) {
      return { ok: false, diagnostic: aiDiagnostic("validation_failed") };
    }

    return {
      ok: true,
      output: result.object,
      usage: usageFromAiSdk(result.usage),
      providerResponseId: result.response.id ?? "",
      providerModel: result.response.modelId ?? input.model,
      finishStatus: "completed"
    };
  } catch (error) {
    return {
      ok: false,
      diagnostic: mapAiSdkError(error, combined, input.signal)
    };
  } finally {
    combined.dispose();
  }
}
