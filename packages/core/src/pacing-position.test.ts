import { describe, expect, it } from "vitest";
import {
  bookId,
  chapterId,
  partId,
  projectId,
  sceneId
} from "./domain.js";
import type { ProjectNavigator, ProjectNavigatorScene } from "./project-navigator.js";
import {
  equalWeightScenePercents,
  manuscriptOrderedScenes
} from "./pacing-position.js";

const scene = (id: string, title: string): ProjectNavigatorScene => ({
  id: sceneId(id),
  title,
  status: "drafting"
});

describe("pacing position", () => {
  it("follows navigator manuscript order, including unassigned scenes per book", () => {
    const navigator: ProjectNavigator = {
      id: projectId("project-pacing"),
      title: "Pacing",
      version: 1,
      books: [
        {
          id: bookId("book-1"),
          title: "One",
          status: "drafting",
          parts: [
            {
              id: partId("part-1"),
              title: "Part",
              chapters: [
                {
                  id: chapterId("chapter-1"),
                  title: "Chapter",
                  scenes: [scene("scene-2", "Second"), scene("scene-1", "First")]
                }
              ]
            }
          ],
          unassignedScenes: [scene("scene-u", "Unassigned")],
          editions: [],
          sceneCount: 3
        }
      ],
      storyKnowledge: [],
      totals: { books: 1, scenes: 3, storyKnowledge: 0, editions: 0 }
    };
    expect(manuscriptOrderedScenes(navigator).map(({ id }) => id)).toEqual([
      "scene-2",
      "scene-1",
      "scene-u"
    ]);
  });

  it("gives every scene an equal contiguous percentage interval", () => {
    expect(
      equalWeightScenePercents([
        { id: "a", title: "A" },
        { id: "b", title: "B" },
        { id: "c", title: "C" },
        { id: "d", title: "D" }
      ])
    ).toEqual([
      { sceneId: "a", title: "A", index: 0, startPct: 0, midPct: 12.5, endPct: 25 },
      { sceneId: "b", title: "B", index: 1, startPct: 25, midPct: 37.5, endPct: 50 },
      { sceneId: "c", title: "C", index: 2, startPct: 50, midPct: 62.5, endPct: 75 },
      { sceneId: "d", title: "D", index: 3, startPct: 75, midPct: 87.5, endPct: 100 }
    ]);
  });
});
