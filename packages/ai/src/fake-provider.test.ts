import { describe, expect, it } from "vitest";
import { aiDiagnostic } from "./diagnostics.js";
import { createFakeStructuredCompletionProvider } from "./fake-provider.js";

type DemoOutput = { summary: string };

const isDemoOutput = (value: unknown): value is DemoOutput =>
  typeof value === "object" &&
  value !== null &&
  "summary" in value &&
  typeof (value as DemoOutput).summary === "string";

const baseInput = {
  workflow: "capture-summarize",
  model: "fake-model",
  instructions: "Summarize briefly.",
  inputText: "Sensitive manuscript paragraph.",
  outputSchema: {
    name: "capture_summary",
    schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] }
  },
  maxOutputTokens: 100,
  maxDurationMs: 5_000,
  validateOutput: isDemoOutput
};

describe("createFakeStructuredCompletionProvider", () => {
  it("returns stable usage and output", async () => {
    const provider = createFakeStructuredCompletionProvider<DemoOutput>({
      output: { summary: "Stable summary." },
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      providerResponseId: "resp-fake-1"
    });

    const result = await provider.completeStructured(baseInput);
    expect(result).toEqual({
      ok: true,
      output: { summary: "Stable summary." },
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      providerResponseId: "resp-fake-1",
      providerModel: "fake-model",
      finishStatus: "completed"
    });
  });

  it("honors configured completion failures", async () => {
    const provider = createFakeStructuredCompletionProvider({
      output: { summary: "unused" },
      failure: { mode: "completion", code: "rate_limited" }
    });

    const result = await provider.completeStructured(baseInput);
    expect(result).toEqual({
      ok: false,
      diagnostic: aiDiagnostic("rate_limited")
    });
  });

  it("returns validation_failed when runtime validator rejects fixture output", async () => {
    const provider = createFakeStructuredCompletionProvider({
      output: { summary: 123 },
      failure: { mode: "validation", code: "upstream_error" }
    });

    const validationOnly = createFakeStructuredCompletionProvider({
      output: { summary: 123 }
    });
    const result = await validationOnly.completeStructured(baseInput);
    expect(result).toEqual({
      ok: false,
      diagnostic: aiDiagnostic("validation_failed")
    });

    const failureResult = await provider.completeStructured(baseInput);
    expect(failureResult.ok).toBe(false);
    if (!failureResult.ok) {
      expect(failureResult.diagnostic).toEqual(aiDiagnostic("upstream_error"));
    }
  });

  it("cancels when AbortSignal aborts during delay", async () => {
    const controller = new AbortController();
    const provider = createFakeStructuredCompletionProvider({
      output: { summary: "late" },
      delayMs: 500
    });

    const pending = provider.completeStructured({
      ...baseInput,
      signal: controller.signal
    });
    controller.abort();

    const result = await pending;
    expect(result).toEqual({ ok: false, diagnostic: aiDiagnostic("cancelled") });
  });

  it("validates credentials without echoing project content", async () => {
    const provider = createFakeStructuredCompletionProvider({
      output: { summary: "ok" },
      credentialFailure: { mode: "credential", code: "auth_failed" }
    });

    const failed = await provider.validateCredential();
    expect(failed).toEqual({ ok: false, diagnostic: aiDiagnostic("auth_failed") });

    const okProvider = createFakeStructuredCompletionProvider({ output: { summary: "ok" } });
    expect(await okProvider.validateCredential()).toEqual({ ok: true });
  });
});
