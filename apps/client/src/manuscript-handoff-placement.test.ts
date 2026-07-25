import {
  bookId,
  chapterId,
  partId,
  projectId,
  sceneId,
  type ProjectNavigator
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  canonicalIndexForCanvasHandoff,
  decodeManuscriptHandoffKey,
  encodeManuscriptHandoffKey,
  listManuscriptHandoffChoices,
  manuscriptHandoffStoryOrderHintText,
  resolveManuscriptHandoffPlacement,
  validateManuscriptHandoffSelection
} from "./manuscript-handoff-placement.js";

const project = projectId("project-manuscript-handoff");
const activeBook = bookId("book-active");
const archivedBook = bookId("book-archived");
const secondBook = bookId("book-second");
const partOne = partId("part-one");
const partTwo = partId("part-two");
const chapterOpening = chapterId("chapter-opening");
const chapterMiddle = chapterId("chapter-middle");
const chapterOtherBook = chapterId("chapter-other");
const sceneA = sceneId("scene-a");
const sceneB = sceneId("scene-b");
const sceneUnassigned = sceneId("scene-unassigned");

const navigator: ProjectNavigator = {
  id: project,
  title: "Handoff placement",
  version: 1,
  books: [
    {
      id: activeBook,
      title: "Active novel",
      status: "drafting",
      parts: [
        {
          id: partOne,
          title: "Part I",
          chapters: [
            {
              id: chapterOpening,
              title: "Opening",
              scenes: [
                { id: sceneA, title: "First", status: "drafting" },
                { id: sceneB, title: "Second", status: "planned" }
              ]
            }
          ]
        },
        {
          id: partTwo,
          title: "Part II",
          chapters: [
            {
              id: chapterMiddle,
              title: "Middle",
              scenes: []
            }
          ]
        }
      ],
      unassignedScenes: [
        { id: sceneUnassigned, title: "Loose beat", status: "planned" }
      ],
      editions: [],
      sceneCount: 3
    },
    {
      id: archivedBook,
      title: "Archived book",
      status: "complete",
      archivedAt: "2026-07-01T00:00:00.000Z",
      parts: [
        {
          id: partId("part-archived"),
          title: "Archived part",
          chapters: [
            {
              id: chapterId("chapter-archived"),
              title: "Should not appear",
              scenes: []
            }
          ]
        }
      ],
      unassignedScenes: [],
      editions: [],
      sceneCount: 0
    },
    {
      id: secondBook,
      title: "Companion",
      status: "planned",
      parts: [
        {
          id: partId("part-companion"),
          title: "Companion part",
          chapters: [
            {
              id: chapterOtherBook,
              title: "Epilogue",
              scenes: []
            }
          ]
        }
      ],
      unassignedScenes: [],
      editions: [],
      sceneCount: 0
    }
  ],
  storyKnowledge: [],
  totals: {
    books: 3,
    scenes: 3,
    storyKnowledge: 0,
    editions: 0
  }
};

describe("manuscript-handoff-placement", () => {
  it("encodes and decodes stable selection keys", () => {
    expect(encodeManuscriptHandoffKey(activeBook, "unassigned")).toBe(
      `${activeBook}::unassigned`
    );
    expect(encodeManuscriptHandoffKey(activeBook, chapterOpening)).toBe(
      `${activeBook}::${chapterOpening}`
    );
    expect(decodeManuscriptHandoffKey(`${activeBook}::unassigned`)).toEqual({
      bookId: activeBook,
      chapterId: "unassigned"
    });
    expect(decodeManuscriptHandoffKey("")).toBeUndefined();
    expect(decodeManuscriptHandoffKey("no-separator")).toBeUndefined();
    expect(decodeManuscriptHandoffKey(`${activeBook}::`)).toBeUndefined();
  });

  it("lists active-book unassigned and chapter choices across parts", () => {
    const choices = listManuscriptHandoffChoices(navigator);
    expect(choices.map((choice) => choice.label)).toEqual([
      "Active novel · Unassigned",
      "Active novel · Opening",
      "Active novel · Middle",
      "Companion · Unassigned",
      "Companion · Epilogue"
    ]);
    expect(choices.every((choice) => choice.key.includes("::"))).toBe(true);
    expect(
      choices.some((choice) => choice.label.includes("Archived book"))
    ).toBe(false);
  });

  it("resolves chapter-append and unassigned placements", () => {
    expect(
      resolveManuscriptHandoffPlacement(
        navigator,
        encodeManuscriptHandoffKey(activeBook, chapterOpening)
      )
    ).toEqual({
      kind: "chapter",
      bookId: activeBook,
      chapterId: chapterOpening
    });
    expect(
      resolveManuscriptHandoffPlacement(
        navigator,
        encodeManuscriptHandoffKey(activeBook, "unassigned")
      )
    ).toEqual({ kind: "unassigned", bookId: activeBook });
    expect(
      resolveManuscriptHandoffPlacement(
        navigator,
        encodeManuscriptHandoffKey(secondBook, chapterOtherBook)
      )
    ).toEqual({
      kind: "chapter",
      bookId: secondBook,
      chapterId: chapterOtherBook
    });
  });

  it("rejects archived books, unknown chapters, and invalid keys", () => {
    expect(
      resolveManuscriptHandoffPlacement(
        navigator,
        encodeManuscriptHandoffKey(archivedBook, "unassigned")
      )
    ).toBeUndefined();
    expect(
      resolveManuscriptHandoffPlacement(
        navigator,
        `${activeBook}::${chapterId("missing-chapter")}`
      )
    ).toBeUndefined();
    expect(validateManuscriptHandoffSelection(navigator, "bad-key")).toEqual({
      valid: false
    });
  });

  it("derives canonical append indices for chapter and unassigned targets", () => {
    expect(
      canonicalIndexForCanvasHandoff(navigator, {
        kind: "chapter",
        bookId: activeBook,
        chapterId: chapterOpening
      })
    ).toBe(2);
    expect(
      canonicalIndexForCanvasHandoff(navigator, {
        kind: "chapter",
        bookId: activeBook,
        chapterId: chapterMiddle
      })
    ).toBe(2);
    expect(
      canonicalIndexForCanvasHandoff(navigator, {
        kind: "unassigned",
        bookId: activeBook
      })
    ).toBe(3);
    expect(
      canonicalIndexForCanvasHandoff(navigator, {
        kind: "chapter",
        bookId: secondBook,
        chapterId: chapterOtherBook
      })
    ).toBe(3);
    expect(
      manuscriptHandoffStoryOrderHintText(
        navigator,
        encodeManuscriptHandoffKey(activeBook, chapterMiddle)
      )
    ).toBe("2");
    expect(
      manuscriptHandoffStoryOrderHintText(
        navigator,
        encodeManuscriptHandoffKey(activeBook, "unassigned")
      )
    ).toBe("3");
  });
});
