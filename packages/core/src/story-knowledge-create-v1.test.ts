import { describe, expect, it } from "vitest";
import {
  isStoryKnowledgeCreateV1,
  validateStoryKnowledgeCreateV1
} from "./story-knowledge-create-v1.js";

const validPayload = {
  schemaId: "story-knowledge-create-v1",
  name: "Mara",
  kind: "character",
  summary: "A rain-soaked stranger who interrupts the negotiation.",
  properties: "Wet coat, sharp eyes, knows the dockmaster.",
  sceneId: "scene-1",
  firstAppearanceNote: "Steps into the rain at the end of scene 1."
} as const;

describe("story-knowledge-create-v1", () => {
  it("validates a bounded story-knowledge create payload", () => {
    const draft = validateStoryKnowledgeCreateV1(validPayload);
    expect(draft.schemaId).toBe("story-knowledge-create-v1");
    expect(draft.name).toBe("Mara");
    expect(draft.kind).toBe("character");
    expect(draft.firstAppearanceNote).toContain("scene 1");
    expect(isStoryKnowledgeCreateV1(draft)).toBe(true);
  });

  it("rejects unexpected fields and invalid kind", () => {
    expect(() =>
      validateStoryKnowledgeCreateV1({ ...validPayload, extra: true })
    ).toThrow(/unexpected or missing fields/u);
    expect(() =>
      validateStoryKnowledgeCreateV1({ ...validPayload, kind: "plot" })
    ).toThrow(/kind is invalid/u);
    expect(() =>
      validateStoryKnowledgeCreateV1({
        ...validPayload,
        schemaId: "story-knowledge-create-v2"
      })
    ).toThrow(/schema identifier is invalid/u);
  });

  it("accepts minimal required fields", () => {
    const draft = validateStoryKnowledgeCreateV1({
      schemaId: "story-knowledge-create-v1",
      name: "The Docks",
      kind: "location",
      summary: "Foggy waterfront where deals go wrong."
    });
    expect(draft.properties).toBeUndefined();
    expect(draft.sceneId).toBeUndefined();
  });
});
