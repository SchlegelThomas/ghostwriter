import { describe, expect, it } from "vitest";
import {
  isNextActionV1,
  validateNextActionV1
} from "./next-action-v1.js";

const validPayload = {
  schemaId: "next-action-v1",
  trigger: "scene-prose-saved",
  summary: "Two new names appear in this scene.",
  suggestions: [
    {
      kind: "create-story-knowledge",
      title: "Add Mara to Cast",
      rationale: "Mara is named twice but not in the roster.",
      proposedName: "Mara",
      storyKnowledgeKind: "character",
      evidenceQuote: "Mara stepped into the rain.",
      sceneId: "scene-1"
    },
    {
      kind: "continue-writing",
      title: "Keep drafting",
      rationale: "The scene ends on a strong turn."
    }
  ],
  escalate: {
    recommended: false,
    reason: "Cheap coach coverage is sufficient."
  }
} as const;

describe("next-action-v1", () => {
  it("validates a bounded next-action payload", () => {
    const action = validateNextActionV1(validPayload);
    expect(action.schemaId).toBe("next-action-v1");
    expect(action.trigger).toBe("scene-prose-saved");
    expect(action.suggestions).toHaveLength(2);
    expect(action.suggestions[0]?.proposedName).toBe("Mara");
    expect(isNextActionV1(action)).toBe(true);
  });

  it("rejects unexpected fields and invalid enums", () => {
    expect(() =>
      validateNextActionV1({ ...validPayload, extra: true })
    ).toThrow(/unexpected or missing fields/u);
    expect(() =>
      validateNextActionV1({ ...validPayload, trigger: "unknown-trigger" })
    ).toThrow(/trigger is invalid/u);
    const withSurfaces = validateNextActionV1({
      ...validPayload,
      suggestions: [
        {
          kind: "run-catalog-agent",
          title: "Run Midwife",
          rationale: "Premise is thin.",
          catalogAgentId: "idea-midwife",
          openSurface: "plans"
        },
        {
          kind: "open-surface",
          title: "Open Cast",
          rationale: "Review roster.",
          openSurface: "cast"
        }
      ]
    });
    expect(withSurfaces.suggestions[1]?.openSurface).toBe("cast");
    expect(() =>
      validateNextActionV1({
        ...validPayload,
        suggestions: [
          {
            kind: "bad-kind",
            title: "Bad",
            rationale: "Bad"
          }
        ]
      })
    ).toThrow(/kind is invalid/u);
  });

  it("caps suggestions at eight items", () => {
    const suggestions = Array.from({ length: 9 }, (_, index) => ({
      kind: "continue-writing" as const,
      title: `Suggestion ${index + 1}`,
      rationale: "Keep going."
    }));
    expect(() =>
      validateNextActionV1({ ...validPayload, suggestions })
    ).toThrow(/suggestions are invalid/u);
  });
});
