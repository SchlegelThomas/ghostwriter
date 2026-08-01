import { afterEach, describe, expect, it } from "vitest";
import { aiDiagnostic } from "@ghostwriter/ai";
import type { ProviderCredentialStatus } from "@ghostwriter/core";
import {
  clearModelDiscoveryCache,
  discoverModelsForAccount
} from "./model-discovery.js";

const openaiStatus: ProviderCredentialStatus = {
  provider: "openai",
  version: 1,
  maskedHint: "…7890",
  validationState: "valid",
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
  validatedAt: "2026-07-26T00:01:00.000Z"
};

afterEach(() => {
  clearModelDiscoveryCache();
});

describe("discoverModelsForAccount", () => {
  it("returns a large merged list from mocked listModels", async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      id: `gpt-discovered-${index}`,
      object: "model"
    }));
    const view = await discoverModelsForAccount({
      accountId: "acct-1",
      configured: [openaiStatus],
      resolveApiKey: async () => "sk-test",
      createListingProvider: () =>
        Object.freeze({
          async validateCredential() {
            return { ok: true as const };
          },
          async listModels() {
            return Object.freeze([
              ...many.map((row) => Object.freeze({ id: row.id, raw: row })),
              Object.freeze({ id: "gpt-4.1", raw: { id: "gpt-4.1" } }),
              Object.freeze({ id: "gpt-image-1", raw: { id: "gpt-image-1" } })
            ]);
          },
          async completeStructured() {
            return { ok: false as const, diagnostic: aiDiagnostic("upstream_error") };
          }
        })
    });
    expect(view.models.length).toBeGreaterThanOrEqual(40);
    expect(view.models.some((model) => model.id === "gpt-4.1")).toBe(true);
    expect(view.models.find((model) => model.id === "gpt-4.1")?.bestFor).toMatch(
      /Everyday project chat/i
    );
    expect(view.discovery?.[0]?.ok).toBe(true);
    expect(view.discovery?.[0]?.count).toBeGreaterThanOrEqual(40);
  });

  it("falls back to curated models when listModels fails", async () => {
    const view = await discoverModelsForAccount({
      accountId: "acct-2",
      configured: [openaiStatus],
      resolveApiKey: async () => "sk-test",
      createListingProvider: () =>
        Object.freeze({
          async validateCredential() {
            return { ok: true as const };
          },
          async listModels() {
            throw Object.assign(new Error("boom"), { status: 500 });
          },
          async completeStructured() {
            return { ok: false as const, diagnostic: aiDiagnostic("upstream_error") };
          }
        })
    });
    expect(view.models.every((model) => model.provider === "openai")).toBe(true);
    expect(view.models.some((model) => model.id === "gpt-4.1")).toBe(true);
    expect(view.discovery?.[0]).toMatchObject({
      provider: "openai",
      ok: false,
      errorCode: "upstream_error"
    });
    expect(view.discovery?.[0]?.count).toBe(view.models.length);
  });
});
