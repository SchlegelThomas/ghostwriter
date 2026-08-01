import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";
import { completeWithToolsWithLanguageModel, streamWithToolsWithLanguageModel } from "./aisdk/tool-completion.js";
import { type AiProviderId } from "./create-provider.js";
import { ANTHROPIC_API_ORIGIN } from "./anthropic/provider.js";
import { DEEPSEEK_API_ORIGIN } from "./deepseek/provider.js";
import { GOOGLE_API_ORIGIN } from "./google/provider.js";
import { GROQ_API_ORIGIN } from "./groq/provider.js";
import { MISTRAL_API_ORIGIN } from "./mistral/provider.js";
import { OPENAI_API_ORIGIN } from "./openai/responses.js";
import { OPENROUTER_API_ORIGIN } from "./openrouter/provider.js";
import { XAI_API_ORIGIN } from "./xai/provider.js";
import type {
  ToolLoopCompletionInput,
  ToolLoopCompletionProvider,
  ToolLoopCompletionResult,
  ToolLoopStreamInput
} from "./tool-loop-types.js";

type LanguageModelFactory = (modelId: string) => LanguageModel;

function createLanguageModelFactory(
  providerId: AiProviderId,
  apiKey: string
): LanguageModelFactory {
  switch (providerId) {
    case "openai": {
      const openai = createOpenAI({
        apiKey,
        baseURL: `${OPENAI_API_ORIGIN}/v1`
      });
      return (modelId) => openai(modelId);
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey,
        baseURL: `${ANTHROPIC_API_ORIGIN}/v1`
      });
      return (modelId) => anthropic(modelId);
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey,
        baseURL: `${GOOGLE_API_ORIGIN}/v1beta`
      });
      return (modelId) => google(modelId);
    }
    case "groq": {
      const groq = createGroq({
        apiKey,
        baseURL: GROQ_API_ORIGIN
      });
      return (modelId) => groq(modelId);
    }
    case "xai": {
      const xai = createXai({
        apiKey,
        baseURL: XAI_API_ORIGIN
      });
      return (modelId) => xai(modelId);
    }
    case "mistral": {
      const mistral = createMistral({
        apiKey,
        baseURL: MISTRAL_API_ORIGIN
      });
      return (modelId) => mistral(modelId);
    }
    case "deepseek": {
      const deepseek = createOpenAICompatible({
        name: "deepseek",
        apiKey,
        baseURL: DEEPSEEK_API_ORIGIN
      });
      return (modelId) => deepseek(modelId);
    }
    case "openrouter": {
      const openrouter = createOpenAICompatible({
        name: "openrouter",
        apiKey,
        baseURL: OPENROUTER_API_ORIGIN
      });
      return (modelId) => openrouter(modelId);
    }
    default: {
      const _exhaustive: never = providerId;
      throw new Error(`No tool-loop adapter is available for provider "${_exhaustive}".`);
    }
  }
}

/** Create a Ghostwriter tool-loop port adapter for a supported BYOK provider id. */
export function createToolLoopProvider(input: Readonly<{
  providerId: AiProviderId;
  apiKey: string;
}>): ToolLoopCompletionProvider {
  const languageModel = createLanguageModelFactory(input.providerId, input.apiKey);

  return {
    async completeWithTools(
      toolInput: ToolLoopCompletionInput
    ): Promise<ToolLoopCompletionResult> {
      return completeWithToolsWithLanguageModel(languageModel(toolInput.model), toolInput);
    },
    async streamWithTools(
      toolInput: ToolLoopStreamInput
    ): Promise<ToolLoopCompletionResult> {
      return streamWithToolsWithLanguageModel(languageModel(toolInput.model), toolInput);
    }
  };
}
