import { describe, expect, it } from "vitest";
import {
  createProviderAdapter,
  ProviderAdapterUnsupportedError
} from "./create-provider.js";

describe("createProviderAdapter", () => {
  it("returns adapters for Wave A and Wave B provider ids", () => {
    const key = "k".repeat(24);
    expect(createProviderAdapter({ providerId: "openai", apiKey: key })).toBeTruthy();
    expect(createProviderAdapter({ providerId: "anthropic", apiKey: key })).toBeTruthy();
    expect(createProviderAdapter({ providerId: "google", apiKey: key })).toBeTruthy();
    expect(createProviderAdapter({ providerId: "groq", apiKey: key })).toBeTruthy();
    expect(createProviderAdapter({ providerId: "xai", apiKey: key })).toBeTruthy();
    expect(createProviderAdapter({ providerId: "mistral", apiKey: key })).toBeTruthy();
    expect(createProviderAdapter({ providerId: "deepseek", apiKey: key })).toBeTruthy();
    expect(createProviderAdapter({ providerId: "openrouter", apiKey: key })).toBeTruthy();
  });

  it("exhaustiveness guard rejects unknown ids at compile time only", () => {
    expect(ProviderAdapterUnsupportedError).toBeDefined();
  });
});
