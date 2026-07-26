import {
  bookId,
  chapterId,
  partId,
  projectId,
  sceneId,
  storyKnowledgeId,
  type ProjectNavigator,
  type ProjectNavigatorScene
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  chronologySceneIds,
  manuscriptChronology,
  manuscriptChronologySupportsSelection
} from "./manuscript-chronology.js";
import type { ManuscriptSelection } from "./manuscript-selection.js";

const project = projectId("project-chronology");
const book = bookId("book-chronology");
const part = partId("part-chronology");
const chapterOne = chapterId("chapter-chronology-one");
const chapterTwo = chapterId("chapter-chronology-two");
const sceneOne = sceneId("scene-chronology-one");
const sceneTwo = sceneId("scene-chronology-two");
const sceneThree = sceneId("scene-chronology-three");
const sceneLoose = sceneId("scene-chronology-loose");
const sceneArchived = sceneId("scene-chronology-archived");
const pov = storyKnowledgeId("knowledge-chronology-pov");

function scene(
  id: typeof sceneOne,
  title: string,
  overrides: Partial<ProjectNavigatorScene> = {}
): ProjectNavigatorScene {
  return { id, title, status: "drafting", ...overrides };
}

const navigator: ProjectNavigator = {
  id: project,
  title: "Chronology Project",
  version: 1,
  books: [
    {
      id: book,
      title: "Harbor Book",
      status: "drafting",
      parts: [
        {
          id: part,
          title: "Act One",
          summary: "The first act on shore.",
          chapters: [
            {
              id: chapterOne,
              title: "Landing",
              summary: "They reach the cove.",
              scenes: [
                scene(sceneOne, "Step One"),
                scene(sceneTwo, "Step Two", {
                  povStoryKnowledgeId: pov,
                  summary: "Mara answers."
                }),
                scene(sceneArchived, "Archived beat", {
                  archivedAt: "2026-07-01T00:00:00.000Z"
                })
              ]
            },
            {
              id: chapterTwo,
              title: "Crossing",
              scenes: [scene(sceneThree, "Step Three")]
            }
          ]
        }
      ],
      unassignedScenes: [scene(sceneLoose, "Loose Idea")],
      editions: [],
      sceneCount: 4
    }
  ],
  storyKnowledge: [
    {
      id: pov,
      label: "Mara",
      kind: "character",
      authority: "planned",
      linkedSceneIds: [sceneTwo],
      linkedSceneCount: 1,
      linkedKnowledge: []
    }
  ],
  totals: { books: 1, scenes: 4, storyKnowledge: 1, editions: 0 }
};

describe("manuscriptChronologySupportsSelection", () => {
  it("accepts Write-rail chronology scopes only", () => {
    expect(
      manuscriptChronologySupportsSelection({ kind: "storyKnowledgeRoot" })
    ).toBe(true);
    expect(
      manuscriptChronologySupportsSelection({ kind: "book", bookId: book })
    ).toBe(true);
    expect(
      manuscriptChronologySupportsSelection({ kind: "project" })
    ).toBe(false);
    expect(
      manuscriptChronologySupportsSelection({
        kind: "scene",
        bookId: book,
        sceneId: sceneOne
      })
    ).toBe(false);
    expect(
      manuscriptChronologySupportsSelection({
        kind: "storyKnowledge",
        storyKnowledgeId: pov
      })
    ).toBe(false);
  });
});

describe("manuscriptChronology", () => {
  it("returns undefined for project, scene, and story-knowledge selections", () => {
    expect(manuscriptChronology(navigator, { kind: "project" })).toBeUndefined();
    expect(
      manuscriptChronology(navigator, {
        kind: "scene",
        bookId: book,
        partId: part,
        chapterId: chapterOne,
        sceneId: sceneOne
      })
    ).toBeUndefined();
    expect(
      manuscriptChronology(navigator, {
        kind: "storyKnowledge",
        storyKnowledgeId: pov
      })
    ).toBeUndefined();
  });

  it("projects whole-project manuscript order for storyKnowledgeRoot", () => {
    const projection = manuscriptChronology(navigator, {
      kind: "storyKnowledgeRoot"
    });
    expect(projection?.scopeKind).toBe("storyKnowledgeRoot");
    expect(projection?.title).toBe("Chronology Project");
    expect(projection?.scenes.map((row) => row.sceneId)).toEqual([
      sceneOne,
      sceneTwo,
      sceneThree,
      sceneLoose
    ]);
    expect(projection?.scenes.map((row) => row.chapterLandmark)).toEqual([
      "Landing",
      "Landing",
      "Crossing",
      "Unassigned"
    ]);
    expect(projection?.chapters.map((item) => item.label)).toEqual([
      "Landing",
      "Crossing",
      "Unassigned"
    ]);
    expect(chronologySceneIds(projection)).toEqual([
      sceneOne,
      sceneTwo,
      sceneThree,
      sceneLoose
    ]);
  });

  it("scopes book, part, chapter, and unassigned selections", () => {
    const bookSelection: ManuscriptSelection = { kind: "book", bookId: book };
    expect(
      manuscriptChronology(navigator, bookSelection)?.scenes.map(
        (row) => row.sceneId
      )
    ).toEqual([sceneOne, sceneTwo, sceneThree, sceneLoose]);

    const partProjection = manuscriptChronology(navigator, {
      kind: "part",
      bookId: book,
      partId: part
    });
    expect(partProjection?.description).toBe("The first act on shore.");
    expect(partProjection?.scenes.map((row) => row.sceneId)).toEqual([
      sceneOne,
      sceneTwo,
      sceneThree
    ]);

    const chapterProjection = manuscriptChronology(navigator, {
      kind: "chapter",
      bookId: book,
      partId: part,
      chapterId: chapterOne
    });
    expect(chapterProjection?.description).toBe("They reach the cove.");
    expect(chapterProjection?.scenes.map((row) => row.title)).toEqual([
      "Step One",
      "Step Two"
    ]);
    expect(chapterProjection?.scenes[1]).toMatchObject({
      povLabel: "Mara",
      summary: "Mara answers.",
      selection: {
        kind: "scene",
        bookId: book,
        partId: part,
        chapterId: chapterOne,
        sceneId: sceneTwo
      }
    });

    const unassigned = manuscriptChronology(navigator, {
      kind: "unassigned",
      bookId: book
    });
    expect(unassigned?.scenes.map((row) => row.sceneId)).toEqual([sceneLoose]);
    expect(unassigned?.scenes[0]?.chapterLandmark).toBe("Unassigned");
  });

  it("returns an empty chapter projection without inventing scenes", () => {
    const emptyChapter = chapterId("chapter-chronology-empty");
    const emptyNavigator: ProjectNavigator = {
      ...navigator,
      books: [
        {
          ...navigator.books[0]!,
          parts: [
            {
              ...navigator.books[0]!.parts[0]!,
              chapters: [
                ...navigator.books[0]!.parts[0]!.chapters,
                { id: emptyChapter, title: "Empty Cove", scenes: [] }
              ]
            }
          ]
        }
      ]
    };
    const projection = manuscriptChronology(emptyNavigator, {
      kind: "chapter",
      bookId: book,
      partId: part,
      chapterId: emptyChapter
    });
    expect(projection).toMatchObject({
      title: "Empty Cove",
      scenes: [],
      chapters: []
    });
    expect(projection?.description).toContain("empty");
  });
});
