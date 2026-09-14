import type {
  BookReaderPage,
  BookReaderProjection,
  BookReaderSceneLink
} from "@ghostwriter/core";
import {
  BELLWETHER_FIXTURE_NAVIGATOR,
  BOOK_READER_CHARS_PER_PAGE,
  bookId,
  buildBookReaderProjection,
  buildBookReaderSpreads,
  canvasLinkId,
  chapterId,
  paginateBookReaderProjection,
  sceneId
} from "@ghostwriter/core";
import { createEmptySceneDocument, validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import {
  bookReaderProjectionForWideChapter,
  resolveWideReaderInitialChapterId,
  resolveWideReaderSpreadIndex,
  shouldShowWideReaderEmptySceneMessage,
  wideReaderChapterIdForScene,
  wideReaderSpreadSceneLinks,
  wideReaderSpreadSpeechText
} from "./book-reader-panel-wide.js";

const signalBook = BELLWETHER_FIXTURE_NAVIGATOR.books[0]!;
const testBookId = bookId("book-wide-reader-tabs");
const chapterOneId = chapterId("chapter-alpha");
const chapterTwoId = chapterId("chapter-beta");
const chapterThreeId = chapterId("chapter-gamma");
const sceneOneId = sceneId("scene-alpha");
const sceneTwoId = sceneId("scene-beta");
const sceneThreeId = sceneId("scene-gamma");
const sceneLongId = sceneId("scene-long");

function paragraphDocument(...paragraphs: readonly string[]) {
  const document = createEmptySceneDocument({
    generateBlockId: () => "block-reader-test"
  });
  return validateSceneDocumentV1({
    ...document,
    document: {
      type: "doc",
      content: paragraphs.map((text, index) => ({
        type: "paragraph" as const,
        attrs: { id: `reader-paragraph-${index}` },
        content: [{ type: "text" as const, text }]
      }))
    }
  });
}

function threeShortChapterProjection(
  pinSceneId?: typeof sceneTwoId
): BookReaderProjection {
  const navigator = {
    ...BELLWETHER_FIXTURE_NAVIGATOR,
    books: [
      {
        ...signalBook,
        id: testBookId,
        title: "Tab isolation book",
        parts: [
          {
            ...signalBook.parts[0]!,
            chapters: [
              {
                id: chapterOneId,
                title: "Alpha chapter",
                scenes: [
                  {
                    id: sceneOneId,
                    title: "Alpha scene",
                    status: "drafting" as const
                  }
                ]
              },
              {
                id: chapterTwoId,
                title: "Beta chapter",
                scenes: [
                  {
                    id: sceneTwoId,
                    title: "Beta scene",
                    status: "drafting" as const
                  }
                ]
              },
              {
                id: chapterThreeId,
                title: "Gamma chapter",
                scenes: [
                  {
                    id: sceneThreeId,
                    title: "Gamma scene",
                    status: "drafting" as const
                  }
                ]
              }
            ]
          }
        ],
        unassignedScenes: []
      }
    ]
  };
  const heads = new Map([
    [
      sceneOneId,
      { document: paragraphDocument("Alpha prose only."), workingVersion: 1 }
    ],
    [
      sceneTwoId,
      { document: paragraphDocument("Beta prose only."), workingVersion: 1 }
    ],
    [
      sceneThreeId,
      { document: paragraphDocument("Gamma prose only."), workingVersion: 1 }
    ]
  ]);
  const built = buildBookReaderProjection({
    navigator,
    bookId: testBookId,
    heads,
    ...(pinSceneId === undefined ? {} : { pinSceneId })
  });
  if (built === undefined) {
    throw new Error("expected projection");
  }
  return built;
}

function spreadProse(projection: BookReaderProjection, spreadIndex: number): string {
  const pages = paginateBookReaderProjection(projection);
  const spread = buildBookReaderSpreads(pages)[spreadIndex];
  const blocks = [
    ...(spread?.left?.blocks ?? []),
    ...(spread?.right?.blocks ?? [])
  ].map((entry) => entry.block);
  return blocks
    .flatMap((block) =>
      block.type === "paragraph"
        ? (block.content?.map((node) =>
            node.type === "text" ? node.text : ""
          ) ?? [])
        : []
    )
    .join(" ");
}

describe("BookReaderPanel wide chapter scope", () => {
  it("shares one full-book spread for three short chapters but isolates each chapter view", () => {
    const projection = threeShortChapterProjection();
    const fullPages = paginateBookReaderProjection(projection);
    expect(buildBookReaderSpreads(fullPages)).toHaveLength(1);
    expect(spreadProse(projection, 0)).toMatch(/Alpha prose/);
    expect(spreadProse(projection, 0)).toMatch(/Beta prose/);
    expect(spreadProse(projection, 0)).toMatch(/Gamma prose/);

    for (const [chapterIdValue, prose, absent] of [
      [chapterOneId, "Alpha prose only.", ["Beta prose", "Gamma prose"]] as const,
      [chapterTwoId, "Beta prose only.", ["Alpha prose", "Gamma prose"]] as const,
      [chapterThreeId, "Gamma prose only.", ["Alpha prose", "Beta prose"]] as const
    ]) {
      const scoped = bookReaderProjectionForWideChapter(projection, chapterIdValue);
      const spread = buildBookReaderSpreads(paginateBookReaderProjection(scoped))[0];
      expect(spread?.left).toBeDefined();
      expect(spread?.right).toBeUndefined();
      expect(shouldShowWideReaderEmptySceneMessage(spread?.right)).toBe(false);
      expect(spreadProse(scoped, 0)).toContain(prose);
      for (const other of absent) {
        expect(spreadProse(scoped, 0)).not.toContain(other);
      }
      expect(wideReaderSpreadSpeechText(projection, chapterIdValue, 0)).toContain(prose);
      expect(
        resolveWideReaderSpreadIndex(projection, chapterIdValue, { spreadIndex: 0 })
      ).toBe(0);
    }
  });

  it("keeps chapter-local pagination and speech when advancing within a long chapter", () => {
    const longText = "word ".repeat(BOOK_READER_CHARS_PER_PAGE);
    const navigator = {
      ...BELLWETHER_FIXTURE_NAVIGATOR,
      books: [
        {
          ...signalBook,
          id: testBookId,
          title: "Long chapter book",
          parts: [
            {
              ...signalBook.parts[0]!,
              chapters: [
                {
                  id: chapterOneId,
                  title: "Long chapter",
                  scenes: [
                    {
                      id: sceneLongId,
                      title: "Long scene",
                      status: "drafting" as const
                    }
                  ]
                }
              ]
            }
          ],
          unassignedScenes: []
        }
      ]
    };
    const built = buildBookReaderProjection({
      navigator,
      bookId: testBookId,
      heads: new Map([
        [
          sceneLongId,
          {
            document: paragraphDocument(longText, longText, longText),
            workingVersion: 1
          }
        ]
      ])
    });
    expect(built).toBeDefined();
    const scoped = bookReaderProjectionForWideChapter(built!, chapterOneId);
    const spreads = buildBookReaderSpreads(paginateBookReaderProjection(scoped));
    expect(spreads.length).toBeGreaterThan(1);
    expect(resolveWideReaderSpreadIndex(built!, chapterOneId, { spreadIndex: 1 })).toBe(1);
    expect(wideReaderSpreadSpeechText(built!, chapterOneId, 0).length).toBeGreaterThan(0);
    expect(wideReaderSpreadSpeechText(built!, chapterOneId, 1).length).toBeGreaterThan(0);
  });

  it("shows empty-chapter copy when a chapter scene has no prose", () => {
    const emptySceneId = sceneId("scene-empty");
    const navigator = {
      ...BELLWETHER_FIXTURE_NAVIGATOR,
      books: [
        {
          ...signalBook,
          id: testBookId,
          parts: [
            {
              ...signalBook.parts[0]!,
              chapters: [
                {
                  id: chapterOneId,
                  title: "Empty chapter",
                  scenes: [
                    {
                      id: emptySceneId,
                      title: "Empty scene",
                      status: "drafting" as const
                    }
                  ]
                }
              ]
            }
          ],
          unassignedScenes: []
        }
      ]
    };
    const built = buildBookReaderProjection({
      navigator,
      bookId: testBookId,
      heads: new Map()
    });
    expect(built).toBeDefined();
    const scoped = bookReaderProjectionForWideChapter(built!, chapterOneId);
    expect(wideReaderSpreadSpeechText(built!, chapterOneId, 0).trim()).toBe("");
    expect(scoped.scenes).toHaveLength(1);
    expect(
      spreadProse(scoped, 0).replace(/\s+/g, " ").trim()
    ).toBe("");
  });

  it("shows the empty-scene message only for paginated pages with no blocks", () => {
    const emptyScenePage: BookReaderPage = Object.freeze({
      index: 0,
      blocks: Object.freeze([]),
      runningHeader: "Empty chapter · Empty scene"
    });
    expect(shouldShowWideReaderEmptySceneMessage(undefined)).toBe(false);
    expect(shouldShowWideReaderEmptySceneMessage(emptyScenePage)).toBe(true);
  });

  it("derives initial chapter and spread from pinSceneId", () => {
    const projection = threeShortChapterProjection(sceneTwoId);
    expect(resolveWideReaderInitialChapterId(projection)).toBe(chapterTwoId);
    expect(wideReaderChapterIdForScene(projection, sceneTwoId)).toBe(chapterTwoId);
    expect(
      resolveWideReaderSpreadIndex(projection, chapterTwoId, { preferPin: true })
    ).toBe(0);
  });

  it("scopes scene links to the visible chapter spread", () => {
    const projection = threeShortChapterProjection();
    const link: BookReaderSceneLink = {
      id: canvasLinkId("link-beta"),
      direction: "outbound",
      kind: "reference",
      authority: "confirmed",
      peerLabel: "Peer beta",
      peerKind: "scene",
      label: "Beta link"
    };
    const withLinks: BookReaderProjection = {
      ...projection,
      scenes: projection.scenes.map((scene) =>
        scene.sceneId === sceneTwoId ? { ...scene, links: [link] } : scene
      )
    };
    expect(wideReaderSpreadSceneLinks(withLinks, chapterOneId, 0)).toHaveLength(0);
    expect(wideReaderSpreadSceneLinks(withLinks, chapterTwoId, 0)).toEqual([link]);
  });
});
