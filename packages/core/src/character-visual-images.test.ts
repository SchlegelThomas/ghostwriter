import { describe, expect, it } from "vitest";
import { DomainValidationError } from "./domain.js";
import {
  CHARACTER_VISUAL_LOCATOR_ORIGIN,
  assertCharacterVisualPngDataUri,
  buildCharacterVisualLocatorUrl,
  buildCharacterVisualObjectKey,
  parseCharacterVisualLocatorUrl
} from "./character-visual-images.js";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("character visual image locators", () => {
  it("builds object keys and locator URLs that round-trip through parse", () => {
    const projectId = "project-bellwether-cycle";
    const knowledgeId = "knowledge-mara-venn";
    const visualId = "visual-portrait-1";

    expect(buildCharacterVisualObjectKey(projectId, knowledgeId, visualId)).toBe(
      "projects/project-bellwether-cycle/story-knowledge/knowledge-mara-venn/visuals/visual-portrait-1.png"
    );

    const locator = buildCharacterVisualLocatorUrl(projectId, knowledgeId, visualId);
    expect(locator.startsWith(`${CHARACTER_VISUAL_LOCATOR_ORIGIN}/`)).toBe(true);
    expect(parseCharacterVisualLocatorUrl(locator)).toEqual({
      projectId,
      knowledgeId,
      visualId
    });
  });

  it("rejects non-locator URLs", () => {
    expect(
      parseCharacterVisualLocatorUrl("https://cdn.example.com/portrait.png")
    ).toBeUndefined();
    expect(
      parseCharacterVisualLocatorUrl(
        `${CHARACTER_VISUAL_LOCATOR_ORIGIN}/projects/only-one`
      )
    ).toBeUndefined();
    expect(parseCharacterVisualLocatorUrl("not-a-url")).toBeUndefined();
  });
});

describe("assertCharacterVisualPngDataUri", () => {
  it("decodes a PNG data URI", () => {
    const bytes = assertCharacterVisualPngDataUri(
      `data:image/png;base64,${TINY_PNG_B64}`
    );
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes[0]).toBe(0x89);
  });

  it("rejects non-PNG data URIs", () => {
    expect(() =>
      assertCharacterVisualPngDataUri("data:image/jpeg;base64,aaaa")
    ).toThrow(DomainValidationError);
  });
});
