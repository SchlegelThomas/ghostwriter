import { describe, expect, it } from "vitest";
import { bookId, chapterId, partId, type ProjectNavigatorBook } from "@ghostwriter/core";
import { storyWorkScenePlacementChoices } from "./story-work-scene-placement.js";

function book(id: string): ProjectNavigatorBook {
  return { id: bookId(id), title: id, status: "drafting", parts: [], unassignedScenes: [], editions: [], sceneCount: 0 };
}

describe("story work manuscript placement", () => {
  it("offers an empty book's unassigned destination and excludes archived books", () => {
    const choices = storyWorkScenePlacementChoices([book("empty"), { ...book("archived"), archivedAt: "2026-09-13T00:00:00Z" }]);
    expect(choices).toHaveLength(1);
    expect(choices[0]?.manuscriptPlacement).toEqual({ kind: "unassigned", bookId: "empty" });
  });

  it("keeps similarly named chapters distinct and leaves append order to canonical mutation", () => {
    const choices = storyWorkScenePlacementChoices([{
      ...book("story"),
      parts: [{ id: partId("part"), title: "Part one", chapters: [
        { id: chapterId("first"), title: "Arrival", scenes: [] },
        { id: chapterId("second"), title: "Arrival", scenes: [] }
      ] }]
    }]);
    expect(choices.map((choice) => choice.id)).toEqual(["chapter:story:first", "chapter:story:second", "unassigned:story"]);
    expect(choices[1]?.manuscriptPlacement).toEqual({ kind: "chapter", bookId: "story", chapterId: "second" });
  });
});
