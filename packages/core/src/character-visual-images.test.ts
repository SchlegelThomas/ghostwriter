import { describe, expect, it } from "vitest";
import { DomainValidationError } from "./domain.js";
import {
  CHARACTER_VISUAL_LOCATOR_ORIGIN,
  assertCharacterVisualPngDataUri,
  buildCharacterVisualLocatorUrl,
  buildCharacterVisualObjectKey,
  buildCharacterVisualPublicUrl,
  characterVisualDisplayNeedsResolve,
  isCharacterVisualLocatorUrl,
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

  it("builds public HTTPS URLs from the same object key path", () => {
    const projectId = "project-bellwether-cycle";
    const knowledgeId = "knowledge-mara-venn";
    const visualId = "visual-portrait-1";
    const origin = "https://media.ghost-writer.studio";

    expect(
      buildCharacterVisualPublicUrl(origin, projectId, knowledgeId, visualId)
    ).toBe(
      "https://media.ghost-writer.studio/projects/project-bellwether-cycle/story-knowledge/knowledge-mara-venn/visuals/visual-portrait-1.png"
    );
    expect(
      buildCharacterVisualPublicUrl(`${origin}/`, projectId, knowledgeId, visualId)
    ).toBe(
      "https://media.ghost-writer.studio/projects/project-bellwether-cycle/story-knowledge/knowledge-mara-venn/visuals/visual-portrait-1.png"
    );
  });

  it("classifies locator vs direct display URLs", () => {
    const locator = buildCharacterVisualLocatorUrl(
      "project-bellwether-cycle",
      "knowledge-mara-venn",
      "visual-portrait-1"
    );
    const publicUrl = buildCharacterVisualPublicUrl(
      "https://media.ghost-writer.studio",
      "project-bellwether-cycle",
      "knowledge-mara-venn",
      "visual-portrait-1"
    );

    expect(isCharacterVisualLocatorUrl(locator)).toBe(true);
    expect(characterVisualDisplayNeedsResolve(locator)).toBe(true);
    expect(isCharacterVisualLocatorUrl(publicUrl)).toBe(false);
    expect(characterVisualDisplayNeedsResolve(publicUrl)).toBe(false);
    expect(characterVisualDisplayNeedsResolve("data:image/png;base64,abc")).toBe(
      false
    );
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
