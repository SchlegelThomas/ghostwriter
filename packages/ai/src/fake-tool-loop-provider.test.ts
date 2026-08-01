import { describe, expect, it } from "vitest";
import { z } from "zod";
import { aiDiagnostic } from "./diagnostics.js";
import { createFakeToolLoopProvider } from "./fake-provider.js";
import { createToolLoopProvider } from "./create-tool-loop-provider.js";
import type { ToolLoopCompletionInput } from "./tool-loop-types.js";

const baseInput: ToolLoopCompletionInput = {
  workflow: "writing-agent",
  model: "fake-model",
  instructions: "Use tools when helpful.",
  inputText: "Summarize the scene.",
  tools: [
    {
      name: "project_navigator_read",
      description: "Read project context.",
      inputSchema: z.object({ path: z.string() }),
      execute: async () => ({ ok: true })
    }
  ],
  maxSteps: 5,
  maxOutputTokens: 500,
  maxDurationMs: 5_000
};

describe("createFakeToolLoopProvider", () => {
  it("returns stable text, tool traces, and usage", async () => {
    const provider = createFakeToolLoopProvider({
      text: "Scene summary ready.",
      toolTraces: [
        {
          toolName: "project_navigator_read",
          title: "Read project",
          input: { path: "/scene-1" },
          output: { title: "Scene 1" },
          ok: true
        }
      ],
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      providerResponseId: "resp-tool-1"
    });

    const result = await provider.completeWithTools(baseInput);
    expect(result).toEqual({
      ok: true,
      text: "Scene summary ready.",
      toolTraces: [
        {
          toolName: "project_navigator_read",
          title: "Read project",
          input: { path: "/scene-1" },
          output: { title: "Scene 1" },
          ok: true
        }
      ],
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      providerResponseId: "resp-tool-1",
      providerModel: "fake-model",
      finishStatus: "completed"
    });
  });

  it("honors configured completion failures", async () => {
    const provider = createFakeToolLoopProvider({
      text: "unused",
      failure: { code: "rate_limited" }
    });

    const result = await provider.completeWithTools(baseInput);
    expect(result).toEqual({
      ok: false,
      diagnostic: aiDiagnostic("rate_limited")
    });
  });

  it("returns validation_failed when fixture text is empty", async () => {
    const provider = createFakeToolLoopProvider({ text: "   " });

    const result = await provider.completeWithTools(baseInput);
    expect(result).toEqual({
      ok: false,
      diagnostic: aiDiagnostic("validation_failed")
    });
  });

  it("cancels when AbortSignal aborts during delay", async () => {
    const controller = new AbortController();
    const provider = createFakeToolLoopProvider({
      text: "late",
      delayMs: 500
    });

    const pending = provider.completeWithTools({
      ...baseInput,
      signal: controller.signal
    });
    controller.abort();

    const result = await pending;
    expect(result).toEqual({ ok: false, diagnostic: aiDiagnostic("cancelled") });
  });

  it("passes resolver input through for dynamic fixtures", async () => {
    const provider = createFakeToolLoopProvider((input) => ({
      text: `Done for ${input.workflow}.`,
      toolTraces: [
        {
          toolName: input.tools[0]?.name ?? "missing",
          title: input.tools[0]?.name ?? "missing",
          input: { workflow: input.workflow },
          output: { echoed: input.inputText },
          ok: true
        }
      ]
    }));

    const result = await provider.completeWithTools(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("Done for writing-agent.");
      expect(result.toolTraces[0]?.toolName).toBe("project_navigator_read");
    }
  });
});

describe("createToolLoopProvider", () => {
  it("returns adapters for supported provider ids", () => {
    const key = "k".repeat(24);
    expect(createToolLoopProvider({ providerId: "openai", apiKey: key })).toBeTruthy();
    expect(createToolLoopProvider({ providerId: "anthropic", apiKey: key })).toBeTruthy();
    expect(createToolLoopProvider({ providerId: "google", apiKey: key })).toBeTruthy();
    expect(createToolLoopProvider({ providerId: "groq", apiKey: key })).toBeTruthy();
    expect(createToolLoopProvider({ providerId: "xai", apiKey: key })).toBeTruthy();
    expect(createToolLoopProvider({ providerId: "mistral", apiKey: key })).toBeTruthy();
    expect(createToolLoopProvider({ providerId: "deepseek", apiKey: key })).toBeTruthy();
    expect(createToolLoopProvider({ providerId: "openrouter", apiKey: key })).toBeTruthy();
  });
});
