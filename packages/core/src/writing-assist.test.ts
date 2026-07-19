import { describe, expect, it } from "vitest";
import { storyKnowledgeId } from "./domain.js";
import { buildDeterministicWritingAssistProposals } from "./writing-assist.js";

describe("deterministic writing assist", () => {
  it("returns two scene-partner prose variants", () => {
    const proposals = buildDeterministicWritingAssistProposals("scene-partner", {
      sceneTitle: "The mirror answers",
      recentProse: "The radio waited like a held breath."
    });
    expect(proposals).toHaveLength(2);
    expect(proposals[0]?.kind).toBe("prose-variant");
    expect(proposals[0]?.prose?.length).toBeGreaterThan(20);
    expect(proposals[0]?.provider).toBe("deterministic-local");
  });

  it("requires cast for character coach sheet deltas", () => {
    const empty = buildDeterministicWritingAssistProposals("character-coach", {
      sceneTitle: "The mirror answers"
    });
    expect(empty[0]?.title).toMatch(/Cast needed/i);

    const withCast = buildDeterministicWritingAssistProposals("character-coach", {
      sceneTitle: "The mirror answers",
      cast: [
        {
          id: storyKnowledgeId("sk_mara"),
          label: "Mara"
        }
      ]
    });
    expect(withCast[0]?.characterSheet?.desire).toBeTruthy();
    expect(withCast[0]?.storyKnowledgeId).toBe("sk_mara");
  });

  it("fills sketch fields from sketch partner", () => {
    const proposals = buildDeterministicWritingAssistProposals("sketch-partner", {
      sceneTitle: "The mirror answers"
    });
    expect(proposals[0]?.sketch?.purpose).toBeTruthy();
    expect(proposals[0]?.sketch?.conflict).toBeTruthy();
    expect(proposals[0]?.sketch?.turn).toBeTruthy();
  });
});
