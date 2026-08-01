import { describe, expect, it } from "vitest";
import {
  AGENT_MODEL_IDS,
  assertAgentModelId,
  availableModelsForCredentials,
  CAPTURE_REFLECTION_DEFAULT_MODEL,
  getModelCatalogEntry,
  isAgentModelId,
  isCuratedModelId,
  mergeDiscoveredModels,
  MODEL_CATALOG,
  providerForAgentModel,
  providerForAvailableModel
} from "./model-catalog.js";
import type { ProviderCredentialStatus } from "./provider-credentials.js";

describe("model-catalog", () => {
  it("keeps catalog ids unique and includes Wave A defaults", () => {
    const ids = MODEL_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isAgentModelId(CAPTURE_REFLECTION_DEFAULT_MODEL)).toBe(true);
    expect(isCuratedModelId(CAPTURE_REFLECTION_DEFAULT_MODEL)).toBe(true);
    expect(getModelCatalogEntry("gpt-4.1")?.provider).toBe("openai");
    expect(getModelCatalogEntry("gpt-5")?.provider).toBe("openai");
    expect(getModelCatalogEntry("claude-sonnet-4-5")?.provider).toBe("anthropic");
    expect(getModelCatalogEntry("claude-opus-5")?.provider).toBe("anthropic");
    expect(getModelCatalogEntry("gemini-2.5-pro")?.provider).toBe("google");
    expect(getModelCatalogEntry("gemini-2.0-flash")?.provider).toBe("google");
    expect(getModelCatalogEntry("gpt-image-1")?.supportsImage).toBe(true);
    expect(AGENT_MODEL_IDS).toContain("gpt-4.1");
  });

  it("accepts plausible discovered ids and rejects retired Ghostwriter aliases", () => {
    expect(isAgentModelId("gpt-5.2")).toBe(true);
    expect(isAgentModelId("claude-sonnet-4-5-20250929")).toBe(true);
    expect(isCuratedModelId("claude-sonnet-4-5-20250929")).toBe(false);
    expect(isAgentModelId("gpt-5.6-terra")).toBe(false);
    expect(() => assertAgentModelId("gpt-5.6-luna")).toThrow(/valid/i);
    expect(() => providerForAgentModel("not-a-model")).toThrow(/resolved/i);
  });

  it("merges discovered models with curated metadata winning on id/stem match", () => {
    const merged = mergeDiscoveredModels({
      provider: "anthropic",
      discovered: [
        {
          id: "claude-sonnet-4-5-20250929",
          displayName: "Claude Sonnet 4.5",
          modelClass: "chat",
          supportsImage: false
        },
        {
          id: "claude-brand-new-experimental",
          displayName: "Brand New",
          modelClass: "chat",
          supportsImage: false
        }
      ]
    });
    const sonnet = merged.find((entry) => entry.id === "claude-sonnet-4-5");
    expect(sonnet?.label).toBe("Claude Sonnet 4.5");
    expect(sonnet?.bestFor).toMatch(/Scene craft/i);
    expect(sonnet?.relativeStrength).toMatch(/prose/i);
    expect(sonnet?.adapterReady).toBe(true);
    expect(
      merged.some((entry) => entry.id === "claude-sonnet-4-5-20250929")
    ).toBe(false);
    const discoveredOnly = merged.find(
      (entry) => entry.id === "claude-brand-new-experimental"
    );
    expect(discoveredOnly?.label).toBe("Brand New");
    expect(discoveredOnly?.supportsTools).toBe(true);
    expect(discoveredOnly?.adapterReady).toBe(true);
    expect(merged.length).toBeGreaterThanOrEqual(2);
  });

  it("collapses dated discovery ids onto curated stems without duplicate labels", () => {
    const merged = mergeDiscoveredModels({
      provider: "anthropic",
      discovered: [
        {
          id: "claude-haiku-4-5",
          displayName: "Claude Haiku 4.5",
          modelClass: "chat",
          supportsImage: false
        },
        {
          id: "claude-haiku-4-5-20251001",
          displayName: "Claude Haiku 4.5",
          modelClass: "chat",
          supportsImage: false
        },
        {
          id: "claude-opus-4-5-20251101",
          displayName: "Claude Opus 4.5",
          modelClass: "chat",
          supportsImage: false
        }
      ]
    });
    const haikuMatches = merged.filter(
      (entry) => entry.label === "Claude Haiku 4.5"
    );
    const opusMatches = merged.filter(
      (entry) => entry.label === "Claude Opus 4.5"
    );
    expect(haikuMatches).toHaveLength(1);
    expect(haikuMatches[0]?.id).toBe("claude-haiku-4-5");
    expect(opusMatches).toHaveLength(1);
    expect(opusMatches[0]?.id).toBe("claude-opus-4-5");
  });

  it("resolves provider from available merge for discovered ids", () => {
    const available = mergeDiscoveredModels({
      provider: "openai",
      discovered: [
        { id: "gpt-5.2", modelClass: "chat", supportsImage: false },
        { id: "gpt-only-discovered", modelClass: "chat", supportsImage: false }
      ]
    });
    expect(providerForAvailableModel("gpt-only-discovered", available)).toBe("openai");
    expect(providerForAvailableModel("missing", available)).toBeUndefined();
  });

  it("intersects catalog with non-revoked credentials", () => {
    const openai: ProviderCredentialStatus = {
      provider: "openai",
      version: 1,
      maskedHint: "…7890",
      validationState: "unvalidated",
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z"
    };
    const anthropic: ProviderCredentialStatus = {
      provider: "anthropic",
      version: 2,
      maskedHint: "…abcd",
      validationState: "valid",
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
      validatedAt: "2026-07-26T00:01:00.000Z"
    };
    const revokedGoogle: ProviderCredentialStatus = {
      provider: "google",
      version: 1,
      maskedHint: "…zzzz",
      validationState: "revoked",
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z"
    };

    const view = availableModelsForCredentials([openai, anthropic, revokedGoogle]);
    const providers = view.models.map((model) => model.provider);
    expect(providers).toContain("openai");
    expect(providers).toContain("anthropic");
    expect(providers).not.toContain("google");
    expect(view.providers.find((p) => p.provider === "openai")?.validationState).toBe(
      "unvalidated"
    );
    expect(view.providers.find((p) => p.provider === "google")?.configured).toBe(true);
    expect(view.providers.find((p) => p.provider === "google")?.validationState).toBe(
      "revoked"
    );
  });
});
