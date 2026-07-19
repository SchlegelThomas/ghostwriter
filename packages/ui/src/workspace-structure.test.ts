import {
  bookId,
  chapterId,
  partId,
  projectId,
  sceneId,
  storyKnowledgeId,
  type ProjectNavigator
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import type { ManuscriptSelection } from "./manuscript-selection.js";
import {
  quickBuildOptions,
  sceneTimeline,
  storyTrail,
  structureLaunchpad
} from "./workspace-structure.js";

const projectIdValue = projectId("project-trail");
const book = bookId("book-trail");
const archivedBook = bookId("book-archived");
const part = partId("part-trail");
const chapter = chapterId("chapter-trail");
const emptyChapter = chapterId("chapter-empty");
const sceneOne = sceneId("scene-one");
const sceneTwo = sceneId("scene-two");
const archivedChapterScene = sceneId("scene-archived");
const unassignedScene = sceneId("scene-unassigned");
const archivedUnassignedScene = sceneId("scene-unassigned-archived");
const knowledge = storyKnowledgeId("knowledge-one");
const archivedKnowledge = storyKnowledgeId("knowledge-archived");
const archivedAt = "2026-07-18T12:00:00.000Z";

const navigator: ProjectNavigator = {
  id: projectIdValue,
  title: "Trail Harbor",
  version: 4,
  books: [
    {
      id: book,
      title: "Book of Steps",
      status: "drafting",
      parts: [
        {
          id: part,
          title: "Act One",
          chapters: [
            {
              id: chapter,
              title: "First Landing",
              summary: "The crew reaches shore.",
              scenes: [
                { id: sceneOne, title: "Step One", status: "drafting" },
                { id: sceneTwo, title: "Step Two", status: "planned" },
                {
                  id: archivedChapterScene,
                  title: "Archived Step",
                  status: "planned",
                  archivedAt
                }
              ]
            },
            {
              id: emptyChapter,
              title: "Empty Cove",
              scenes: []
            }
          ]
        }
      ],
      unassignedScenes: [
        { id: unassignedScene, title: "Loose Idea", status: "planned" },
        {
          id: archivedUnassignedScene,
          title: "Archived Loose",
          status: "planned",
          archivedAt
        }
      ],
      editions: [],
      sceneCount: 5
    },
    {
      id: archivedBook,
      title: "Archived Book",
      status: "planned",
      parts: [],
      unassignedScenes: [],
      editions: [],
      sceneCount: 0,
      archivedAt
    }
  ],
  storyKnowledge: [
    {
      id: knowledge,
      label: "Mara Venn",
      kind: "character",
      authority: "planned",
      linkedSceneIds: [sceneOne],
      linkedSceneCount: 1,
      linkedKnowledge: []
    },
    {
      id: archivedKnowledge,
      label: "Old Rule",
      kind: "world-rule",
      authority: "planned",
      linkedSceneIds: [],
      linkedSceneCount: 0,
      linkedKnowledge: [],
      archivedAt
    }
  ],
  totals: { books: 1, scenes: 5, storyKnowledge: 2, editions: 0 }
};

const archivedProject: ProjectNavigator = {
  ...navigator,
  archivedAt
};

const projectSelection: ManuscriptSelection = { kind: "project" };
const bookSelection: ManuscriptSelection = { kind: "book", bookId: book };
const partSelection: ManuscriptSelection = {
  kind: "part",
  bookId: book,
  partId: part
};
const chapterSelection: ManuscriptSelection = {
  kind: "chapter",
  bookId: book,
  partId: part,
  chapterId: chapter
};
const emptyChapterSelection: ManuscriptSelection = {
  kind: "chapter",
  bookId: book,
  partId: part,
  chapterId: emptyChapter
};
const chapterSceneSelection: ManuscriptSelection = {
  kind: "scene",
  bookId: book,
  partId: part,
  chapterId: chapter,
  sceneId: sceneOne
};
const unassignedSelection: ManuscriptSelection = {
  kind: "unassigned",
  bookId: book
};
const unassignedSceneSelection: ManuscriptSelection = {
  kind: "scene",
  bookId: book,
  sceneId: unassignedScene
};
const storyKnowledgeRootSelection: ManuscriptSelection = {
  kind: "storyKnowledgeRoot"
};
const storyKnowledgeSelection: ManuscriptSelection = {
  kind: "storyKnowledge",
  storyKnowledgeId: knowledge
};
const danglingSelection: ManuscriptSelection = {
  kind: "chapter",
  bookId: book,
  partId: part,
  chapterId: chapterId("chapter-missing")
};

function trailLabels(selection: ManuscriptSelection): string[] {
  return storyTrail(navigator, selection).map((item) => item.label);
}

describe("storyTrail", () => {
  it("projects project, book, part, chapter, and chapter scene hierarchies", () => {
    expect(trailLabels(projectSelection)).toEqual(["Trail Harbor"]);
    expect(trailLabels(bookSelection)).toEqual([
      "Trail Harbor",
      "Book of Steps"
    ]);
    expect(trailLabels(partSelection)).toEqual([
      "Trail Harbor",
      "Book of Steps",
      "Act One"
    ]);
    expect(trailLabels(chapterSelection)).toEqual([
      "Trail Harbor",
      "Book of Steps",
      "Act One",
      "First Landing"
    ]);
    expect(trailLabels(chapterSceneSelection)).toEqual([
      "Trail Harbor",
      "Book of Steps",
      "Act One",
      "First Landing",
      "Step One"
    ]);
  });

  it("projects unassigned bucket and unassigned scene paths", () => {
    expect(trailLabels(unassignedSelection)).toEqual([
      "Trail Harbor",
      "Book of Steps",
      "Unassigned"
    ]);
    expect(trailLabels(unassignedSceneSelection)).toEqual([
      "Trail Harbor",
      "Book of Steps",
      "Unassigned",
      "Loose Idea"
    ]);
  });

  it("projects story knowledge root and records", () => {
    expect(trailLabels(storyKnowledgeRootSelection)).toEqual([
      "Trail Harbor",
      "Story knowledge"
    ]);
    expect(trailLabels(storyKnowledgeSelection)).toEqual([
      "Trail Harbor",
      "Story knowledge",
      "Mara Venn"
    ]);
  });

  it("falls back to the project item for unresolvable selections", () => {
    expect(trailLabels(danglingSelection)).toEqual(["Trail Harbor"]);
  });
});

describe("quickBuildOptions", () => {
  it("offers project-level create actions", () => {
    expect(quickBuildOptions(navigator, projectSelection)).toEqual([
      {
        id: 'book:{"kind":"project"}',
        kind: "book",
        label: "New book",
        detail: "Add a book to Trail Harbor",
        parent: projectSelection
      },
      {
        id: 'story-record:{"kind":"storyKnowledgeRoot"}',
        kind: "story-record",
        label: "New story record",
        detail: "Add a character, place, rule, thread, or custom record",
        parent: { kind: "storyKnowledgeRoot" }
      }
    ]);
  });

  it("offers book-level create actions", () => {
    expect(quickBuildOptions(navigator, bookSelection)).toEqual([
      {
        id: `part:${JSON.stringify(bookSelection)}`,
        kind: "part",
        label: "New part",
        detail: "Add a part to Book of Steps",
        parent: bookSelection
      },
      {
        id: `scene:${JSON.stringify({ kind: "unassigned", bookId: book })}`,
        kind: "scene",
        label: "New unassigned scene",
        detail: "Capture a scene in Book of Steps",
        parent: { kind: "unassigned", bookId: book }
      }
    ]);
  });

  it("offers part, chapter, unassigned, and scene sibling actions", () => {
    expect(quickBuildOptions(navigator, partSelection)).toEqual([
      {
        id: `chapter:${JSON.stringify(partSelection)}`,
        kind: "chapter",
        label: "New chapter",
        detail: "Add a chapter to Act One",
        parent: partSelection
      }
    ]);
    expect(quickBuildOptions(navigator, chapterSelection)).toEqual([
      {
        id: `scene:${JSON.stringify(chapterSelection)}`,
        kind: "scene",
        label: "New scene",
        detail: "Add a scene to First Landing",
        parent: chapterSelection
      }
    ]);
    expect(quickBuildOptions(navigator, unassignedSelection)).toEqual([
      {
        id: `scene:${JSON.stringify(unassignedSelection)}`,
        kind: "scene",
        label: "New unassigned scene",
        detail: "Capture a scene in Book of Steps",
        parent: unassignedSelection
      }
    ]);
    expect(quickBuildOptions(navigator, chapterSceneSelection)).toEqual([
      {
        id: `scene:${JSON.stringify(chapterSelection)}`,
        kind: "scene",
        label: "New scene in this folder",
        detail: "Append a sibling scene to the selected scene’s folder",
        parent: chapterSelection
      }
    ]);
    expect(quickBuildOptions(navigator, unassignedSceneSelection)).toEqual([
      {
        id: `scene:${JSON.stringify(unassignedSelection)}`,
        kind: "scene",
        label: "New scene in this folder",
        detail: "Append a sibling scene to the selected scene’s folder",
        parent: unassignedSelection
      }
    ]);
  });

  it("offers story knowledge create actions", () => {
    const storyRecordOption = {
      id: 'story-record:{"kind":"storyKnowledgeRoot"}',
      kind: "story-record" as const,
      label: "New story record",
      detail: "Add a character, place, rule, thread, or custom record",
      parent: { kind: "storyKnowledgeRoot" as const }
    };
    expect(quickBuildOptions(navigator, storyKnowledgeRootSelection)).toEqual([
      storyRecordOption
    ]);
    expect(quickBuildOptions(navigator, storyKnowledgeSelection)).toEqual([
      storyRecordOption
    ]);
  });

  it("returns no options for archived or unresolvable selections", () => {
    expect(quickBuildOptions(archivedProject, projectSelection)).toEqual([]);
    expect(
      quickBuildOptions(navigator, { kind: "book", bookId: archivedBook })
    ).toEqual([]);
    expect(
      quickBuildOptions(navigator, {
        kind: "scene",
        bookId: book,
        partId: part,
        chapterId: chapter,
        sceneId: archivedChapterScene
      })
    ).toEqual([]);
    expect(quickBuildOptions(navigator, danglingSelection)).toEqual([]);
  });
});

describe("structureLaunchpad", () => {
  it("returns undefined for scene selections", () => {
    expect(structureLaunchpad(navigator, chapterSceneSelection)).toBeUndefined();
    expect(structureLaunchpad(navigator, unassignedSceneSelection)).toBeUndefined();
  });

  it("describes project totals and lists books to open", () => {
    const launchpad = structureLaunchpad(navigator, projectSelection);
    expect(launchpad).toMatchObject({
      eyebrow: "Project structure",
      title: "Trail Harbor",
      description: "1 book · 5 scenes · 2 story records",
      scenes: [],
      moveCandidateCount: 0
    });
    expect(launchpad?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "book",
          title: "Book of Steps",
          selection: { kind: "book", bookId: book }
        })
      ])
    );
  });

  it("describes an empty chapter with storyboard scope", () => {
    const launchpad = structureLaunchpad(navigator, emptyChapterSelection);
    expect(launchpad).toMatchObject({
      eyebrow: "Empty chapter · ready to shape",
      title: "Empty Cove",
      description:
        "Start with prose, move an existing scene here, or storyboard this chapter on Canvas.",
      scenes: [],
      entries: [],
      moveCandidateCount: 3,
      storyboardChapter: emptyChapterSelection
    });
  });

  it("uses part summary for launchpad description when present", () => {
    const navigatorWithPartSummary: ProjectNavigator = {
      ...navigator,
      books: [
        {
          ...navigator.books[0]!,
          parts: [
            {
              ...navigator.books[0]!.parts[0]!,
              summary: "The crew's first act on shore."
            }
          ]
        }
      ]
    };
    const launchpad = structureLaunchpad(navigatorWithPartSummary, partSelection);
    expect(launchpad).toMatchObject({
      eyebrow: "Part",
      title: "Act One",
      description: "The crew's first act on shore."
    });
  });

  it("lists only active chapter scenes and counts move candidates", () => {
    const launchpad = structureLaunchpad(navigator, chapterSelection);
    expect(launchpad).toMatchObject({
      eyebrow: "Chapter folder · 2 scenes",
      title: "First Landing",
      description: "The crew reaches shore.",
      moveCandidateCount: 1,
      storyboardChapter: chapterSelection
    });
    expect(launchpad?.scenes.map((scene) => scene.id)).toEqual([
      sceneOne,
      sceneTwo
    ]);
    expect(launchpad?.entries.map((entry) => entry.title)).toEqual([
      "Step One",
      "Step Two"
    ]);
  });

  it("describes unassigned buckets with and without active scenes", () => {
    const launchpad = structureLaunchpad(navigator, unassignedSelection);
    expect(launchpad).toMatchObject({
      eyebrow: "Unassigned scenes · Book of Steps",
      title: "Ideas waiting for a chapter",
      description:
        "Open a scene to write or move it into the chapter where it belongs.",
      moveCandidateCount: 2
    });
    expect(launchpad?.entries.map((entry) => entry.title)).toEqual([
      "Loose Idea"
    ]);

    const emptyUnassignedBook: ProjectNavigator = {
      ...navigator,
      books: [
        {
          ...navigator.books[0]!,
          unassignedScenes: []
        }
      ]
    };
    expect(
      structureLaunchpad(emptyUnassignedBook, unassignedSelection)
    ).toMatchObject({
      eyebrow: "Unassigned scenes · Book of Steps",
      title: "No loose scenes",
      description:
        "Capture a scene now, then place it in the manuscript when its chapter becomes clear.",
      scenes: [],
      entries: [],
      moveCandidateCount: 2
    });
  });
});

describe("sceneTimeline", () => {
  it("lists sibling scenes for chapter and unassigned folders", () => {
    expect(
      sceneTimeline(navigator, chapterSceneSelection).map((item) => item.title)
    ).toEqual(["Step One", "Step Two"]);
    expect(
      sceneTimeline(navigator, unassignedSceneSelection).map((item) => item.title)
    ).toEqual(["Loose Idea"]);
  });
});

