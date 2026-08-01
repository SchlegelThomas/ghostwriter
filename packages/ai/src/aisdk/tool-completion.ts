import {
  generateText,
  stepCountIs,
  streamText,
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
  ToolLoopCompletionSuccess,
  ToolLoopStreamInput,
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

function mapStreamPartToToolTrace(part: {
  type: string;
  toolName: string;
  title?: string;
  input: unknown;
  output?: unknown;
  error?: unknown;
}): ToolTraceStep | undefined {
  if (part.type === "tool-result") {
    return {
      toolName: part.toolName,
      title: part.title ?? part.toolName,
      input: part.input,
      output: part.output,
      ok: true
    };
  }
  if (part.type === "tool-error") {
    return {
      toolName: part.toolName,
      title: part.title ?? part.toolName,
      input: part.input,
      output: part.error,
      ok: false,
      errorMessage: errorMessageFromUnknown(part.error)
    };
  }
  return undefined;
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

export async function streamWithToolsWithLanguageModel(
  model: LanguageModel,
  input: ToolLoopStreamInput
): Promise<ToolLoopCompletionResult> {
  const emit = input.onEvent;
  const combined = combineAbortWithTimeout(input.signal, input.maxDurationMs);

  try {
    if (combined.signal.aborted) {
      const reason = combined.reason();
      const diagnostic = aiDiagnostic(
        reason === "timeout" ? "timeout" : "cancelled"
      );
      emit?.({ type: "error", diagnostic });
      return { ok: false, diagnostic };
    }

    emit?.({ type: "status", phase: "thinking", label: "Thinking…" });

    const result = streamText({
      model,
      tools: buildToolSet(input.tools),
      stopWhen: stepCountIs(input.maxSteps),
      instructions: input.instructions,
      prompt: input.inputText,
      maxOutputTokens: input.maxOutputTokens,
      abortSignal: combined.signal
    });

    const toolTraces: ToolTraceStep[] = [];

    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        emit?.({ type: "text_delta", delta: part.text });
        continue;
      }

      const trace = mapStreamPartToToolTrace(
        part as {
          type: string;
          toolName: string;
          title?: string;
          input: unknown;
          output?: unknown;
          error?: unknown;
        }
      );
      if (trace !== undefined) {
        toolTraces.push(trace);
        emit?.({ type: "tool_trace", trace });
      }
    }

    const text = (await result.text).trim();
    if (text.length === 0) {
      const diagnostic = aiDiagnostic("validation_failed");
      emit?.({ type: "error", diagnostic });
      return { ok: false, diagnostic };
    }

    const steps = await result.steps;
    const response = await result.response;
    const success: ToolLoopCompletionSuccess = {
      ok: true,
      text,
      toolTraces:
        toolTraces.length > 0 ? toolTraces : mapToolTracesFromSteps(steps),
      usage: usageFromAiSdk(await result.usage),
      providerResponseId: response.id ?? "",
      providerModel: response.modelId ?? input.model,
      finishStatus: mapFinishReason(await result.finishReason)
    };
    emit?.({ type: "done", result: success });
    return success;
  } catch (error) {
    const diagnostic = mapAiSdkError(error, combined, input.signal);
    emit?.({ type: "error", diagnostic });
    return { ok: false, diagnostic };
  } finally {
    combined.dispose();
  }
}
