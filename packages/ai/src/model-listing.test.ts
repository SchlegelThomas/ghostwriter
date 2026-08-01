import { describe, expect, it, vi } from "vitest";
import { createOpenAiProviderForTests } from "./openai/provider.js";
import { createAnthropicProviderForTests } from "./anthropic/provider.js";
import { createGoogleProviderForTests } from "./google/provider.js";

describe("provider listModels", () => {
  it("lists OpenAI models from /v1/models", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: [{ id: "gpt-5" }, { id: "gpt-image-1" }]
      })
    );
    const provider = createOpenAiProviderForTests({
      apiKey: "sk-test",
      baseUrl: "https://openai.test",
      fetchImpl
    });
    await expect(provider.listModels()).resolves.toEqual([
      { id: "gpt-5", raw: { id: "gpt-5" } },
      { id: "gpt-image-1", raw: { id: "gpt-image-1" } }
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openai.test/v1/models",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("paginates Anthropic models", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "claude-opus-5", display_name: "Opus 5" }],
          has_more: true,
          last_id: "claude-opus-5"
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "claude-sonnet-5", display_name: "Sonnet 5" }],
          has_more: false
        })
      );
    const provider = createAnthropicProviderForTests({
      apiKey: "sk-ant-test",
      baseUrl: "https://anthropic.test",
      fetchImpl
    });
    const models = await provider.listModels();
    expect(models.map((model) => model.id)).toEqual(["claude-opus-5", "claude-sonnet-5"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("lists Google models and strips models/ prefix", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        models: [
          {
            name: "models/gemini-2.5-pro",
            displayName: "Gemini 2.5 Pro",
            supportedGenerationMethods: ["generateContent"]
          }
        ]
      })
    );
    const provider = createGoogleProviderForTests({
      apiKey: "google-test-key",
      baseUrl: "https://google.test",
      fetchImpl
    });
    const models = await provider.listModels();
    expect(models).toEqual([
      {
        id: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        raw: {
          name: "models/gemini-2.5-pro",
          displayName: "Gemini 2.5 Pro",
          supportedGenerationMethods: ["generateContent"]
        }
      }
    ]);
  });
});
