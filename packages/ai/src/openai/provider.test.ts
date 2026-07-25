import { describe, expect, it, vi } from "vitest";
import { aiDiagnostic } from "../diagnostics.js";
import { createOpenAiProviderForTests } from "./provider.js";

type DemoOutput = { title: string };

const SECRET_KEY = "sk-test-secret-never-log-or-diagnose";
const SENSITIVE_INPUT = "Private manuscript sentence for egress test.";
const SENSITIVE_OUTPUT = "Private model title output.";

const isDemoOutput = (value: unknown): value is DemoOutput =>
  typeof value === "object" &&
  value !== null &&
  "title" in value &&
  typeof (value as DemoOutput).title === "string";

const schema = {
  name: "demo_schema",
  schema: {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
    additionalProperties: false
  }
} as const;

function baseInput(
  overrides: Partial<{
    signal: AbortSignal;
    validateOutput: (value: unknown) => value is DemoOutput;
    maxDurationMs: number;
  }> = {}
) {
  return {
    workflow: "demo-workflow",
    model: "gpt-test",
    instructions: "Return JSON only.",
    inputText: SENSITIVE_INPUT,
    outputSchema: schema,
    maxOutputTokens: 1500,
    maxDurationMs: 60_000,
    validateOutput: overrides.validateOutput ?? isDemoOutput,
    ...overrides
  };
}

function assertDiagnosticIsContentFree(
  diagnostic: { code: string; retryable: boolean },
  forbidden: string[]
) {
  const serialized = JSON.stringify(diagnostic);
  for (const fragment of forbidden) {
    expect(serialized).not.toContain(fragment);
  }
  expect(Object.keys(diagnostic).sort()).toEqual(["code", "retryable"]);
}

function openAiSuccessBody(text: string) {
  return {
    id: "resp_123",
    model: "gpt-test",
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }]
      }
    ],
    usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 }
  };
}

describe("createOpenAiProviderForTests", () => {
  it("posts strict Responses API shape with bearer auth and store false", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(openAiSuccessBody(JSON.stringify({ title: "Ok" }))), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const provider = createOpenAiProviderForTests({
      apiKey: SECRET_KEY,
      baseUrl: "https://example.test",
      fetchImpl: fetchImpl as typeof fetch
    });

    await provider.completeStructured(baseInput());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://example.test/v1/responses");
    expect(calls[0]?.init.method).toBe("POST");

    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${SECRET_KEY}`);
    expect(headers.get("Content-Type")).toBe("application/json");

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body.store).toBe(false);
    expect(body.model).toBe("gpt-test");
    expect(body.instructions).toBe("Return JSON only.");
    expect(body.input).toBe(SENSITIVE_INPUT);
    expect(body.max_output_tokens).toBe(1500);
    expect(body.text).toEqual({
      format: {
        type: "json_schema",
        name: "demo_schema",
        strict: true,
        schema: schema.schema
      }
    });
    expect(body).not.toHaveProperty("tools");
  });

  it("parses success output and runs caller validator", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(openAiSuccessBody(JSON.stringify({ title: SENSITIVE_OUTPUT })))
    );

    const provider = createOpenAiProviderForTests({
      apiKey: SECRET_KEY,
      baseUrl: "https://example.test",
      fetchImpl: fetchImpl as typeof fetch
    });

    const result = await provider.completeStructured(baseInput());
    expect(result).toEqual({
      ok: true,
      output: { title: SENSITIVE_OUTPUT },
      usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
      providerResponseId: "resp_123",
      providerModel: "gpt-test",
      finishStatus: "completed"
    });
  });

  it("rejects malformed JSON and schema validation failures with content-free diagnostics", async () => {
    const malformed = createOpenAiProviderForTests({
      apiKey: SECRET_KEY,
      baseUrl: "https://example.test",
      fetchImpl: vi.fn(async () =>
        Response.json(openAiSuccessBody("{not-json"))
      ) as typeof fetch
    });
    const malformedResult = await malformed.completeStructured(baseInput());
    expect(malformedResult.ok).toBe(false);
    if (!malformedResult.ok) {
      assertDiagnosticIsContentFree(malformedResult.diagnostic, [
        SECRET_KEY,
        SENSITIVE_INPUT,
        SENSITIVE_OUTPUT,
        "{not-json"
      ]);
      expect(malformedResult.diagnostic).toEqual(aiDiagnostic("invalid_structured_output"));
    }

    const invalidShape = createOpenAiProviderForTests({
      apiKey: SECRET_KEY,
      baseUrl: "https://example.test",
      fetchImpl: vi.fn(async () =>
        Response.json(openAiSuccessBody(JSON.stringify({ title: 42 })))
      ) as typeof fetch
    });
    const invalidResult = await invalidShape.completeStructured(baseInput());
    expect(invalidResult).toEqual({ ok: false, diagnostic: aiDiagnostic("validation_failed") });
  });

  it("maps refusal, auth, rate limit, and upstream errors", async () => {
    const refusal = createOpenAiProviderForTests({
      apiKey: SECRET_KEY,
      baseUrl: "https://example.test",
      fetchImpl: vi.fn(async () =>
        Response.json({
          id: "resp",
          status: "completed",
          output: [{ type: "message", content: [{ type: "refusal" }] }]
        })
      ) as typeof fetch
    });
    expect(await refusal.completeStructured(baseInput())).toEqual({
      ok: false,
      diagnostic: aiDiagnostic("refusal")
    });

    for (const [status, code] of [
      [401, "auth_failed"],
      [429, "rate_limited"],
      [503, "upstream_error"]
    ] as const) {
      const provider = createOpenAiProviderForTests({
        apiKey: SECRET_KEY,
        baseUrl: "https://example.test",
        fetchImpl: vi.fn(async () => new Response("", { status })) as typeof fetch
      });
      const result = await provider.completeStructured(baseInput());
      expect(result).toEqual({ ok: false, diagnostic: aiDiagnostic(code) });
    }
  });

  it("maps timeout and caller abort via AbortSignal", async () => {
    const slow = createOpenAiProviderForTests({
      apiKey: SECRET_KEY,
      baseUrl: "https://example.test",
      fetchImpl: vi.fn(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          })
      ) as typeof fetch
    });

    const controller = new AbortController();
    const aborted = slow.completeStructured({
      ...baseInput({ maxDurationMs: 60_000 }),
      signal: controller.signal
    });
    controller.abort();
    expect(await aborted).toEqual({ ok: false, diagnostic: aiDiagnostic("cancelled") });

    const timedOut = slow.completeStructured(baseInput({ maxDurationMs: 5 }));
    expect(await timedOut).toEqual({ ok: false, diagnostic: aiDiagnostic("timeout") });
  });

  it("maps ordinary network fetch rejections to upstream_error", async () => {
    const provider = createOpenAiProviderForTests({
      apiKey: SECRET_KEY,
      baseUrl: "https://example.test",
      fetchImpl: vi.fn(async () => {
        throw new TypeError("network unreachable");
      }) as typeof fetch
    });

    const result = await provider.completeStructured(baseInput());
    expect(result).toEqual({ ok: false, diagnostic: aiDiagnostic("upstream_error") });
    if (!result.ok) {
      expect(result.diagnostic.retryable).toBe(true);
    }
  });

  it("disposes timeout after a successful response so timers do not abort later", async () => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      const provider = createOpenAiProviderForTests({
        apiKey: SECRET_KEY,
        baseUrl: "https://example.test",
        fetchImpl: vi.fn(async () =>
          Response.json(openAiSuccessBody(JSON.stringify({ title: "Done" })))
        ) as typeof fetch
      });

      const result = await provider.completeStructured({
        ...baseInput({ maxDurationMs: 5_000 }),
        signal: caller.signal
      });

      expect(result.ok).toBe(true);
      vi.advanceTimersByTime(10_000);
      expect(caller.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("validates credentials via GET /v1/models without project content", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("{}", { status: 200 });
    });

    const provider = createOpenAiProviderForTests({
      apiKey: SECRET_KEY,
      baseUrl: "https://example.test",
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(await provider.validateCredential()).toEqual({ ok: true });
    expect(calls[0]?.url).toBe("https://example.test/v1/models");
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.body).toBeUndefined();

    const authFailed = createOpenAiProviderForTests({
      apiKey: SECRET_KEY,
      baseUrl: "https://example.test",
      fetchImpl: vi.fn(async () => new Response("", { status: 401 })) as typeof fetch
    });
    const result = await authFailed.validateCredential();
    expect(result).toEqual({ ok: false, diagnostic: aiDiagnostic("auth_failed") });
    if (!result.ok) {
      assertDiagnosticIsContentFree(result.diagnostic, [SECRET_KEY]);
    }
  });

  it("maps budget exhaustion from incomplete_details", async () => {
    const provider = createOpenAiProviderForTests({
      apiKey: SECRET_KEY,
      baseUrl: "https://example.test",
      fetchImpl: vi.fn(async () =>
        Response.json({
          id: "resp",
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: []
        })
      ) as typeof fetch
    });

    expect(await provider.completeStructured(baseInput())).toEqual({
      ok: false,
      diagnostic: aiDiagnostic("budget_exceeded")
    });
  });
});
