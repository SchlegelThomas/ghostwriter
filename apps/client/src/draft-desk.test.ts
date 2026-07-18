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
import { blockId, validateSceneDocumentV1, type SceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import {
  draftDeskSceneContext,
  projectScenes,
  sceneDocumentWordCount
} from "./draft-desk.js";

const project = projectId("project-draft-desk");
const bookOne = bookId("book-draft-desk-one");
const bookTwo = bookId("book-draft-desk-two");
const partOne = partId("part-draft-desk-one");
const chapterOpening = chapterId("chapter-draft-desk-opening");
const chapterCrossing = chapterId("chapter-draft-desk-crossing");
const chapterSecondBook = chapterId("chapter-draft-desk-second-book");
const sceneFirst = sceneId("scene-draft-desk-first");
const sceneSecond = sceneId("scene-draft-desk-second");
const sceneThird = sceneId("scene-draft-desk-third");
const sceneUnassigned = sceneId("scene-draft-desk-unassigned");
const sceneSecondBook = sceneId("scene-draft-desk-second-book");
const povKnowledge = storyKnowledgeId("knowledge-draft-desk-pov");
const missingScene = sceneId("scene-draft-desk-missing");

function navigatorScene(
  id: typeof sceneFirst,
  title: string,
  overrides: Partial<ProjectNavigatorScene> = {}
): ProjectNavigatorScene {
  return { id, title, status: "drafting", ...overrides };
}

const navigator: ProjectNavigator = {
  id: project,
  title: "Draft desk",
  version: 3,
  books: [
    {
      id: bookOne,
      title: "Harbor book",
      status: "drafting",
      parts: [
        {
          id: partOne,
          title: "Part one",
          chapters: [
            {
              id: chapterOpening,
              title: "Opening",
              scenes: [
                navigatorScene(sceneFirst, "First scene"),
                navigatorScene(sceneSecond, "Second scene", {
                  povStoryKnowledgeId: povKnowledge
                })
              ]
            },
            {
              id: chapterCrossing,
              title: "Crossing",
              scenes: [navigatorScene(sceneThird, "Third scene")]
            }
          ]
        }
      ],
      unassignedScenes: [navigatorScene(sceneUnassigned, "Unassigned scene")],
      editions: [],
      sceneCount: 4
    },
    {
      id: bookTwo,
      title: "Second book",
      status: "planned",
      parts: [
        {
          id: partId("part-draft-desk-two"),
          title: "Part one",
          chapters: [
            {
              id: chapterSecondBook,
              title: "Later",
              scenes: [navigatorScene(sceneSecondBook, "Second book scene")]
            }
          ]
        }
      ],
      unassignedScenes: [],
      editions: [],
      sceneCount: 1
    }
  ],
  storyKnowledge: [
    {
      id: povKnowledge,
      label: "Mara Venn",
      kind: "character",
      authority: "confirmed",
      linkedSceneIds: [sceneSecond],
      linkedSceneCount: 1,
      linkedKnowledge: []
    }
  ],
  totals: { books: 2, scenes: 5, storyKnowledge: 1, editions: 0 }
};

function sceneDocument(content: readonly unknown[]): SceneDocumentV1 {
  return validateSceneDocumentV1({
    schemaVersion: 1,
    document: {
      type: "doc",
      content
    }
  });
}

describe("Draft desk helpers", () => {
  it("returns the canonical scene sequence across chapters and unassigned scenes", () => {
    expect(projectScenes(navigator).map((scene) => scene.id)).toEqual([
      sceneFirst,
      sceneSecond,
      sceneThird,
      sceneUnassigned,
      sceneSecondBook
    ]);
  });

  it("resolves first, middle, and last scene boundaries with exact position labels", () => {
    const first = draftDeskSceneContext(navigator, sceneFirst);
    expect(first).toEqual({
      sceneIndex: 0,
      sceneCount: 5,
      positionLabel: "Scene 1 of 5",
      previousScene: undefined,
      nextScene: navigatorScene(sceneSecond, "Second scene", {
        povStoryKnowledgeId: povKnowledge
      }),
      povLabel: undefined
    });

    const middle = draftDeskSceneContext(navigator, sceneThird);
    expect(middle).toEqual({
      sceneIndex: 2,
      sceneCount: 5,
      positionLabel: "Scene 3 of 5",
      previousScene: navigatorScene(sceneSecond, "Second scene", {
        povStoryKnowledgeId: povKnowledge
      }),
      nextScene: navigatorScene(sceneUnassigned, "Unassigned scene"),
      povLabel: undefined
    });

    const last = draftDeskSceneContext(navigator, sceneSecondBook);
    expect(last).toEqual({
      sceneIndex: 4,
      sceneCount: 5,
      positionLabel: "Scene 5 of 5",
      previousScene: navigatorScene(sceneUnassigned, "Unassigned scene"),
      nextScene: undefined,
      povLabel: undefined
    });
  });

  it("resolves POV labels and falls back for missing scene ids", () => {
    expect(draftDeskSceneContext(navigator, sceneSecond).povLabel).toBe(
      "Mara Venn"
    );

    expect(draftDeskSceneContext(navigator, missingScene)).toEqual({
      sceneIndex: -1,
      sceneCount: 5,
      positionLabel: "Manuscript scene",
      previousScene: undefined,
      nextScene: undefined,
      povLabel: undefined
    });
  });

  it("counts words across empty, punctuated, unicode, and nested prose structures", () => {
    expect(sceneDocumentWordCount(undefined)).toBe(0);
    expect(
      sceneDocumentWordCount(
        sceneDocument([
          {
            type: "paragraph",
            attrs: { id: blockId("block-empty") }
          }
        ])
      )
    ).toBe(0);

    expect(
      sceneDocumentWordCount(
        sceneDocument([
          {
            type: "paragraph",
            attrs: { id: blockId("block-punctuation") },
            content: [{ type: "text", text: "Hello, world! How are you?" }]
          }
        ])
      )
    ).toBe(5);

    expect(
      sceneDocumentWordCount(
        sceneDocument([
          {
            type: "paragraph",
            attrs: { id: blockId("block-unicode") },
            content: [{ type: "text", text: "café naïve 日本語" }]
          }
        ])
      )
    ).toBe(3);

    expect(
      sceneDocumentWordCount(
        sceneDocument([
          {
            type: "paragraph",
            attrs: { id: blockId("block-contraction") },
            content: [{ type: "text", text: "don't well-known" }]
          }
        ])
      )
    ).toBe(2);

    expect(
      sceneDocumentWordCount(
        sceneDocument([
          {
            type: "heading",
            attrs: { id: blockId("block-heading"), level: 2 },
            content: [{ type: "text", text: "Opening" }]
          },
          {
            type: "blockquote",
            attrs: { id: blockId("block-quote") },
            content: [
              {
                type: "paragraph",
                attrs: { id: blockId("block-quote-inner") },
                content: [{ type: "text", text: "Quoted wisdom" }]
              }
            ]
          },
          {
            type: "paragraph",
            attrs: { id: blockId("block-break") },
            content: [
              { type: "text", text: "Line one" },
              { type: "hardBreak" },
              { type: "text", text: "Line two" }
            ]
          },
          {
            type: "horizontalRule",
            attrs: { id: blockId("block-rule") }
          }
        ])
      )
    ).toBe(7);
  });
});
