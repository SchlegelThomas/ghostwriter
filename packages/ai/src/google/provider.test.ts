import { describe, expect, it, vi } from "vitest";
import { createGoogleProviderForTests } from "./provider.js";

describe("createGoogleProviderForTests", () => {
  it("validates credentials via Google models list", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const provider = createGoogleProviderForTests({
      apiKey: "google-test-key-1234567890",
      baseUrl: "https://google.test",
      fetchImpl
    });
    await expect(provider.validateCredential()).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://google.test/v1beta/models?key=google-test-key-1234567890"
      ),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("maps rate limits without leaking the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("slow", { status: 429 }));
    const provider = createGoogleProviderForTests({
      apiKey: "google-secret-never-leak",
      baseUrl: "https://google.test",
      fetchImpl
    });
    const result = await provider.validateCredential();
    expect(result).toEqual({
      ok: false,
      diagnostic: { code: "rate_limited", retryable: true }
    });
    expect(JSON.stringify(result)).not.toContain("google-secret-never-leak");
  });
});
