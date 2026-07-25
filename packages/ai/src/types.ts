/** JSON Schema object passed to providers; not validated by this package alone. */
export type JsonSchema = Record<string, unknown>;

export type StructuredOutputSchema = {
  name: string;
  schema: JsonSchema;
};

export type StructuredCompletionInput<TOutput> = {
  workflow: string;
  model: string;
  instructions: string;
  inputText: string;
  outputSchema: StructuredOutputSchema;
  maxOutputTokens: number;
  maxDurationMs: number;
  validateOutput: (value: unknown) => value is TOutput;
  signal?: AbortSignal | undefined;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ProviderFinishStatus = "completed" | "incomplete" | "failed" | "cancelled";

export type StructuredCompletionSuccess<TOutput> = {
  ok: true;
  output: TOutput;
  usage: TokenUsage;
  providerResponseId: string;
  providerModel: string;
  finishStatus: ProviderFinishStatus;
};

export type AiDiagnosticCode =
  | "auth_failed"
  | "rate_limited"
  | "upstream_error"
  | "timeout"
  | "cancelled"
  | "invalid_structured_output"
  | "refusal"
  | "budget_exceeded"
  | "validation_failed";

export type AiDiagnostic = {
  code: AiDiagnosticCode;
  retryable: boolean;
};

export type StructuredCompletionFailure = {
  ok: false;
  diagnostic: AiDiagnostic;
};

export type StructuredCompletionResult<TOutput> =
  | StructuredCompletionSuccess<TOutput>
  | StructuredCompletionFailure;

export type CredentialValidationResult =
  | { ok: true }
  | { ok: false; diagnostic: AiDiagnostic };

export interface StructuredCompletionProvider {
  completeStructured<TOutput>(
    input: StructuredCompletionInput<TOutput>
  ): Promise<StructuredCompletionResult<TOutput>>;
}

export interface CredentialValidatingProvider extends StructuredCompletionProvider {
  validateCredential(signal?: AbortSignal): Promise<CredentialValidationResult>;
}
