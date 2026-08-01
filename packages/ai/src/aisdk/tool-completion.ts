import {
  generateText,
  stepCountIs,
  tool,
  type LanguageModel,
  type ToolSet
} from "ai";
import { combineAbortWithTimeout } from "../abort-timeout.js";
import { aiDiagnostic } from "../diagnostics.js";
import type {
  ProviderFinishStatus,
  TokenUsage
} from "../types.js";
import type {
  ToolLoopCompletionInput,
  ToolLoopCompletionResult,
  ToolLoopToolDefinition,
  ToolTraceStep
} from "../tool-loop-types.js";
import { mapAiSdkError } from "./map-error.js";

function usageFromAiSdk(usage: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
}): TokenUsage {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Tool execution failed";
}

function mapFinishReason(finishReason: string): ProviderFinishStatus {
  switch (finishReason) {
    case "stop":
    case "tool-calls":
      return "completed";
    case "length":
      return "incomplete";
    case "content-filter":
    case "error":
    case "other":
      return "failed";
    default:
      return "failed";
  }
}

function mapToolTracesFromSteps(
  steps: ReadonlyArray<{ content: ReadonlyArray<{ type: string }> }>
): ToolTraceStep[] {
  const traces: ToolTraceStep[] = [];

  for (const step of steps) {
    for (const part of step.content) {
      if (part.type === "tool-result") {
        const result = part as unknown as {
          toolName: string;
          title?: string;
          input: unknown;
          output: unknown;
        };
        traces.push({
          toolName: result.toolName,
          title: result.title ?? result.toolName,
          input: result.input,
          output: result.output,
          ok: true
        });
        continue;
      }

      if (part.type === "tool-error") {
        const errorPart = part as unknown as {
          toolName: string;
          title?: string;
          input: unknown;
          error: unknown;
        };
        traces.push({
          toolName: errorPart.toolName,
          title: errorPart.title ?? errorPart.toolName,
          input: errorPart.input,
          output: errorPart.error,
          ok: false,
          errorMessage: errorMessageFromUnknown(errorPart.error)
        });
      }
    }
  }

  return traces;
}

function buildToolSet(tools: readonly ToolLoopToolDefinition[]): ToolSet {
  const toolSet: ToolSet = {};

  for (const definition of tools) {
    toolSet[definition.name] = tool({
      description: definition.description,
      inputSchema: definition.inputSchema,
      execute: async (input) => definition.execute(input)
    });
  }

  return toolSet;
}

export async function completeWithToolsWithLanguageModel(
  model: LanguageModel,
  input: ToolLoopCompletionInput
): Promise<ToolLoopCompletionResult> {
  const combined = combineAbortWithTimeout(input.signal, input.maxDurationMs);

  try {
    if (combined.signal.aborted) {
      const reason = combined.reason();
      return {
        ok: false,
        diagnostic: aiDiagnostic(reason === "timeout" ? "timeout" : "cancelled")
      };
    }

    const result = await generateText({
      model,
      tools: buildToolSet(input.tools),
      stopWhen: stepCountIs(input.maxSteps),
      instructions: input.instructions,
      prompt: input.inputText,
      maxOutputTokens: input.maxOutputTokens,
      abortSignal: combined.signal
    });

    const text = result.text.trim();
    if (text.length === 0) {
      return { ok: false, diagnostic: aiDiagnostic("validation_failed") };
    }

    return {
      ok: true,
      text,
      toolTraces: mapToolTracesFromSteps(result.steps),
      usage: usageFromAiSdk(result.usage),
      providerResponseId: result.response.id ?? "",
      providerModel: result.response.modelId ?? input.model,
      finishStatus: mapFinishReason(result.finishReason)
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
