export type {
  AiDiagnostic,
  AiDiagnosticCode,
  CredentialValidationResult,
  CredentialValidatingProvider,
  DiscoveredModel,
  JsonSchema,
  ListingCredentialProvider,
  ModelListingProvider,
  ProviderFinishStatus,
  StructuredCompletionFailure,
  StructuredCompletionInput,
  StructuredCompletionProvider,
  StructuredCompletionResult,
  StructuredCompletionSuccess,
  StructuredOutputSchema,
  TokenUsage
} from "./types.js";

export {
  filterAnthropicDiscoveredModels,
  filterDiscoveredModelsForProvider,
  filterGoogleDiscoveredModels,
  filterOpenAiCompatibleDiscoveredModels,
  filterOpenAiDiscoveredModels,
  isOpenAiChatDiscoverableId,
  isOpenAiImageDiscoverableId,
  type DiscoveredModelClass,
  type FilteredDiscoveredModel
} from "./model-discovery-filters.js";

export {
  anthropicModelsHasMore,
  anthropicModelsLastId,
  fetchPaginatedAnthropicModels,
  fetchPaginatedGoogleModels,
  fetchPaginatedOpenAiStyleModels,
  googleModelsNextPageToken,
  ModelListingHttpError,
  parseAnthropicModelsResponse,
  parseGoogleModelsResponse,
  parseOpenAiStyleModelsResponse,
  stripGoogleModelPrefix
} from "./model-listing.js";

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

export {
  createAnthropicProvider,
  createAnthropicProviderForTests,
  ANTHROPIC_API_ORIGIN,
  type AnthropicProviderConfig,
  type AnthropicProviderTestConfig
} from "./anthropic/provider.js";

export {
  createGoogleProvider,
  createGoogleProviderForTests,
  GOOGLE_API_ORIGIN,
  type GoogleProviderConfig,
  type GoogleProviderTestConfig
} from "./google/provider.js";

export {
  createDeepSeekProvider,
  createDeepSeekProviderForTests,
  DEEPSEEK_API_ORIGIN,
  type DeepSeekProviderConfig,
  type DeepSeekProviderTestConfig
} from "./deepseek/provider.js";

export {
  createGroqProvider,
  createGroqProviderForTests,
  GROQ_API_ORIGIN,
  type GroqProviderConfig,
  type GroqProviderTestConfig
} from "./groq/provider.js";

export {
  createMistralProvider,
  createMistralProviderForTests,
  MISTRAL_API_ORIGIN,
  type MistralProviderConfig,
  type MistralProviderTestConfig
} from "./mistral/provider.js";

export {
  createOpenAiCompatibleProvider,
  createOpenAiCompatibleProviderForTests,
  type OpenAiCompatibleProviderConfig,
  type OpenAiCompatibleProviderTestConfig
} from "./openai-compatible/provider.js";

export {
  createOpenRouterProvider,
  createOpenRouterProviderForTests,
  OPENROUTER_API_ORIGIN,
  type OpenRouterProviderConfig,
  type OpenRouterProviderTestConfig
} from "./openrouter/provider.js";

export {
  createXaiProvider,
  createXaiProviderForTests,
  XAI_API_ORIGIN,
  type XaiProviderConfig,
  type XaiProviderTestConfig
} from "./xai/provider.js";

export {
  createProviderAdapter,
  ProviderAdapterUnsupportedError,
  type AiProviderId
} from "./create-provider.js";

export {
  generateOpenAiImage,
  generateOpenAiImageForTests,
  type OpenAiImageGenerationFailure,
  type OpenAiImageGenerationInput,
  type OpenAiImageGenerationResult,
  type OpenAiImageGenerationSuccess,
  type OpenAiImageGenerationTestConfig
} from "./openai/images.js";
