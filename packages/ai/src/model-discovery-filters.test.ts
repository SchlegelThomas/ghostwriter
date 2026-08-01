import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  filterAnthropicDiscoveredModels,
  filterGoogleDiscoveredModels,
  filterOpenAiCompatibleDiscoveredModels,
  filterOpenAiDiscoveredModels
} from "./model-discovery-filters.js";
import {
  parseAnthropicModelsResponse,
  parseGoogleModelsResponse,
  parseOpenAiStyleModelsResponse
} from "./model-listing.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as unknown;
}

describe("model discovery filters", () => {
  it("keeps OpenAI chatish + image models and drops noise", () => {
    const raw = parseOpenAiStyleModelsResponse(loadFixture("openai-models-subset.json"));
    expect(raw.length).toBe(23);
    const filtered = filterOpenAiDiscoveredModels(raw);
    const ids = filtered.map((model) => model.id);
    expect(ids).toContain("gpt-5.2");
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("chatgpt-4o-latest");
    expect(ids).toContain("o4-mini");
    expect(ids).toContain("gpt-image-1.5");
    expect(ids).toContain("dall-e-3");
    expect(ids).not.toContain("gpt-4o-realtime-preview");
    expect(ids).not.toContain("tts-1");
    expect(ids).not.toContain("text-embedding-3-large");
    expect(ids).not.toContain("whisper-1");
    expect(filtered.filter((model) => model.modelClass === "chat").length).toBeGreaterThanOrEqual(
      10
    );
    expect(filtered.filter((model) => model.modelClass === "image").length).toBeGreaterThanOrEqual(
      3
    );
    expect(filtered.length).toBe(15);
  });

  it("keeps all Anthropic /v1/models ids as chat", () => {
    const raw = parseAnthropicModelsResponse(loadFixture("anthropic-models-subset.json"));
    const filtered = filterAnthropicDiscoveredModels(raw);
    expect(filtered.length).toBe(7);
    expect(filtered.every((model) => model.modelClass === "chat")).toBe(true);
    expect(filtered.map((model) => model.id)).toContain("claude-opus-5");
    expect(filtered.map((model) => model.id)).toContain("claude-fable-5");
  });

  it("keeps Google generateContent models and marks image variants", () => {
    const raw = parseGoogleModelsResponse(loadFixture("google-models-subset.json"));
    expect(raw.some((model) => model.id === "gemini-2.5-pro")).toBe(true);
    const filtered = filterGoogleDiscoveredModels(raw);
    const ids = filtered.map((model) => model.id);
    expect(ids).toContain("gemini-3-flash-preview");
    expect(ids).toContain("gemma-3-27b-it");
    expect(ids).not.toContain("text-embedding-004");
    expect(ids).not.toContain("gemini-2.5-flash-preview-tts");
    expect(ids).not.toContain("lyria-realtime-exp");
    const image = filtered.find(
      (model) => model.id === "gemini-2.0-flash-preview-image-generation"
    );
    expect(image?.supportsImage).toBe(true);
    expect(image?.modelClass).toBe("image");
    expect(filtered.length).toBe(6);
  });

  it("keeps OpenAI-compatible chat ids and drops embeddings", () => {
    const raw = parseOpenAiStyleModelsResponse(
      loadFixture("openai-compatible-models-subset.json")
    );
    const filtered = filterOpenAiCompatibleDiscoveredModels(raw);
    expect(filtered.map((model) => model.id)).toEqual([
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "deepseek-chat",
      "mistral-large-latest",
      "grok-3-mini",
      "openai/gpt-4.1"
    ]);
  });
});
