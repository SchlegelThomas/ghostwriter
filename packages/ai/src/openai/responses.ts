export const OPENAI_API_ORIGIN = "https://api.openai.com";

export type OpenAiResponsesRequestBody = {
  model: string;
  instructions: string;
  input: string;
  store: false;
  max_output_tokens: number;
  text: {
    format: {
      type: "json_schema";
      name: string;
      strict: true;
      schema: Record<string, unknown>;
    };
  };
};

export type OpenAiOutputTextPart = {
  type: "output_text";
  text: string;
};

export type OpenAiRefusalPart = {
  type: "refusal";
  refusal?: string;
};

export type OpenAiMessageOutput = {
  type: "message";
  role?: string;
  content?: Array<OpenAiOutputTextPart | OpenAiRefusalPart | Record<string, unknown>>;
};

export type OpenAiResponsesBody = {
  id?: string;
  model?: string;
  status?: string;
  output?: OpenAiMessageOutput[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  incomplete_details?: {
    reason?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
};

export function buildOpenAiResponsesRequest(
  input: import("../types.js").StructuredCompletionInput<unknown>
): OpenAiResponsesRequestBody {
  return {
    model: input.model,
    instructions: input.instructions,
    input: input.inputText,
    store: false,
    max_output_tokens: input.maxOutputTokens,
    text: {
      format: {
        type: "json_schema",
        name: input.outputSchema.name,
        strict: true,
        schema: input.outputSchema.schema
      }
    }
  };
}

export function extractAssistantOutputText(body: OpenAiResponsesBody): {
  kind: "text";
  text: string;
} | {
  kind: "refusal";
} | {
  kind: "missing";
} {
  const outputs = body.output ?? [];
  for (const item of outputs) {
    if (item.type !== "message") {
      continue;
    }
    for (const part of item.content ?? []) {
      if (part.type === "refusal") {
        return { kind: "refusal" };
      }
      if (part.type === "output_text" && typeof part.text === "string") {
        return { kind: "text", text: part.text };
      }
    }
  }
  return { kind: "missing" };
}

export function mapOpenAiFinishStatus(status: string | undefined): import("../types.js").ProviderFinishStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "incomplete":
      return "incomplete";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}

export function mapOpenAiUsage(usage: OpenAiResponsesBody["usage"]): import("../types.js").TokenUsage {
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

export function isBudgetExceeded(body: OpenAiResponsesBody): boolean {
  const reason = body.incomplete_details?.reason;
  return reason === "max_output_tokens" || reason === "max_tokens";
}
