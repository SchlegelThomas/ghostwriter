import { describe, expect, it } from "vitest";
import {
  extractAssistantOutputText,
  isBudgetExceeded,
  mapOpenAiUsage
} from "./responses.js";

describe("OpenAI response helpers", () => {
  it("extracts output_text from assistant message content", () => {
    const extracted = extractAssistantOutputText({
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: '{"answer":1}' }]
        }
      ]
    });
    expect(extracted).toEqual({ kind: "text", text: '{"answer":1}' });
  });

  it("detects refusal parts", () => {
    expect(
      extractAssistantOutputText({
        output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }]
      })
    ).toEqual({ kind: "refusal" });
  });

  it("maps usage without retaining extra fields", () => {
    expect(
      mapOpenAiUsage({ input_tokens: 10, output_tokens: 20, total_tokens: 30 })
    ).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
  });

  it("detects budget exhaustion reasons", () => {
    expect(isBudgetExceeded({ incomplete_details: { reason: "max_output_tokens" } })).toBe(true);
    expect(isBudgetExceeded({ incomplete_details: { reason: "content_filter" } })).toBe(false);
  });
});
