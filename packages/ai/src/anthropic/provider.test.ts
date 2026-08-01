import { describe, expect, it, vi } from "vitest";
import { createAnthropicProviderForTests } from "./provider.js";

describe("createAnthropicProviderForTests", () => {
  it("validates credentials via Anthropic models list", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const provider = createAnthropicProviderForTests({
      apiKey: "sk-ant-test-key-1234567890",
      baseUrl: "https://anthropic.test",
      fetchImpl
    });
    await expect(provider.validateCredential()).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://anthropic.test/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-api-key": "sk-ant-test-key-1234567890",
          "anthropic-version": "2023-06-01"
        })
      })
    );
  });

  it("maps auth failures without leaking the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("denied", { status: 401 }));
    const provider = createAnthropicProviderForTests({
      apiKey: "sk-ant-secret-never-leak",
      baseUrl: "https://anthropic.test",
      fetchImpl
    });
    const result = await provider.validateCredential();
    expect(result).toEqual({
      ok: false,
      diagnostic: { code: "auth_failed", retryable: false }
    });
    expect(JSON.stringify(result)).not.toContain("sk-ant-secret-never-leak");
  });
});
