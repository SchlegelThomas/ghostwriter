import type { FlexibleSchema } from "ai";
import type {
  AiDiagnostic,
  ProviderFinishStatus,
  TokenUsage
} from "./types.js";

export type ToolLoopToolDefinition = {
  name: string;
  description: string;
  inputSchema: FlexibleSchema<unknown>;
  execute: (input: unknown) => Promise<unknown> | unknown;
};

export type ToolTraceStep = {
  toolName: string;
  title: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  errorMessage?: string;
};

export type ToolLoopCompletionInput = {
  workflow: string;
  model: string;
  instructions: string;
  inputText: string;
  tools: readonly ToolLoopToolDefinition[];
  maxSteps: number;
  maxOutputTokens: number;
  maxDurationMs: number;
  signal?: AbortSignal | undefined;
};

export type ToolLoopCompletionSuccess = {
  ok: true;
  text: string;
  toolTraces: readonly ToolTraceStep[];
  usage: TokenUsage;
  providerResponseId: string;
  providerModel: string;
  finishStatus: ProviderFinishStatus;
};

export type ToolLoopCompletionFailure = {
  ok: false;
  diagnostic: AiDiagnostic;
};

export type ToolLoopCompletionResult =
  | ToolLoopCompletionSuccess
  | ToolLoopCompletionFailure;

export interface ToolLoopCompletionProvider {
  completeWithTools(
    input: ToolLoopCompletionInput
  ): Promise<ToolLoopCompletionResult>;
}
