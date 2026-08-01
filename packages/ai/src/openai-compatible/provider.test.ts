import { describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleProviderForTests } from "./provider.js";

describe("createOpenAiCompatibleProviderForTests", () => {
  it("validates credentials via OpenAI-compatible models list", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const provider = createOpenAiCompatibleProviderForTests({
      apiKey: "sk-deepseek-test-key-1234567890",
      providerName: "deepseek",
      baseUrl: "https://deepseek.test/v1",
      fetchImpl
    });
    await expect(provider.validateCredential()).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://deepseek.test/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-deepseek-test-key-1234567890"
        })
      })
    );
  });

  it("maps auth failures without leaking the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("denied", { status: 401 }));
    const provider = createOpenAiCompatibleProviderForTests({
      apiKey: "sk-deepseek-secret-never-leak",
      providerName: "deepseek",
      baseUrl: "https://deepseek.test/v1",
      fetchImpl
    });
    const result = await provider.validateCredential();
    expect(result).toEqual({
      ok: false,
      diagnostic: { code: "auth_failed", retryable: false }
    });
    expect(JSON.stringify(result)).not.toContain("sk-deepseek-secret-never-leak");
  });
});
