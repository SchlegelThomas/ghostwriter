/**
 * Optional live probe against real provider /models endpoints.
 * Skipped in CI unless GHOSTWRITER_E2E_LIVE_MODEL_DISCOVERY=1 and seed keys are present.
 */
import { describe, expect, it } from "vitest";
import { createAnthropicProvider } from "./anthropic/provider.js";
import { createGoogleProvider } from "./google/provider.js";
import { createOpenAiProvider } from "./openai/provider.js";
import {
  filterAnthropicDiscoveredModels,
  filterGoogleDiscoveredModels,
  filterOpenAiDiscoveredModels
} from "./model-discovery-filters.js";

const enabled = process.env.GHOSTWRITER_E2E_LIVE_MODEL_DISCOVERY === "1";

describe.skipIf(!enabled)("live model discovery", () => {
  it(
    "lists a Cursor-scale OpenAI chatish set when OPENAI_API_KEY is set",
    async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        expect(apiKey).toBeTruthy();
        return;
      }
      const models = await createOpenAiProvider({ apiKey }).listModels();
      const filtered = filterOpenAiDiscoveredModels(models);
      expect(models.length).toBeGreaterThan(50);
      expect(filtered.length).toBeGreaterThan(40);
    },
    30_000
  );

  it(
    "lists Anthropic models when ANTHROPIC_API_KEY is set",
    async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        expect(apiKey).toBeTruthy();
        return;
      }
      const models = await createAnthropicProvider({ apiKey }).listModels();
      const filtered = filterAnthropicDiscoveredModels(models);
      expect(filtered.length).toBeGreaterThan(5);
      expect(filtered.some((model) => model.id.includes("claude"))).toBe(true);
    },
    30_000
  );

  it(
    "lists Google generateContent models when GOOGLE_API_KEY / GEMINI_API_KEY is set",
    async () => {
      const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
      if (!apiKey) {
        expect(apiKey).toBeTruthy();
        return;
      }
      const models = await createGoogleProvider({ apiKey }).listModels();
      const filtered = filterGoogleDiscoveredModels(models);
      expect(filtered.length).toBeGreaterThan(10);
    },
    30_000
  );
});
