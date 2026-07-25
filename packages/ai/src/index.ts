export type {
  AiDiagnostic,
  AiDiagnosticCode,
  CredentialValidationResult,
  CredentialValidatingProvider,
  JsonSchema,
  ProviderFinishStatus,
  StructuredCompletionFailure,
  StructuredCompletionInput,
  StructuredCompletionProvider,
  StructuredCompletionResult,
  StructuredCompletionSuccess,
  StructuredOutputSchema,
  TokenUsage
} from "./types.js";

export { aiDiagnostic } from "./diagnostics.js";
export { combineAbortWithTimeout, type AbortReason, type CombinedAbort } from "./abort-timeout.js";

export {
  createFakeStructuredCompletionProvider,
  type FakeProviderFailure,
  type FakeProviderFailureMode,
  type FakeProviderFixture,
  type FakeProviderResolver
} from "./fake-provider.js";

export {
  buildOpenAiResponsesRequest,
  extractAssistantOutputText,
  mapOpenAiFinishStatus,
  mapOpenAiUsage,
  OPENAI_API_ORIGIN,
  type OpenAiResponsesBody,
  type OpenAiResponsesRequestBody
} from "./openai/responses.js";

export {
  createOpenAiProvider,
  createOpenAiProviderForTests,
  type OpenAiProviderConfig,
  type OpenAiProviderTestConfig
} from "./openai/provider.js";
