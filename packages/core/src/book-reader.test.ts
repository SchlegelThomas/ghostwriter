import { createEmptySceneDocument, hashSceneDocument, validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import { sceneId } from "./domain.js";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_NAVIGATOR
} from "./fixtures.js";
import {
  BOOK_READER_CHARS_PER_PAGE,
  BOOK_READER_MAX_SCENES,
  bookReaderChapterStartSpreadIndex,
  bookReaderSpreadIndexForScene,
  buildBookReaderProjection,
  buildBookReaderSpreads,
  BookReaderTooLargeError,
  collectActiveBookSceneIds,
  paginateBookReaderProjection,
  sceneDocumentCharacterCount
} from "./book-reader.js";
import { createBookReaderServices } from "./book-reader-services.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryCanvasRepository } from "./memory-canvas-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemorySceneDocumentRepository } from "./memory-scene-document-repository.js";
import { sceneContentHash } from "./scene-documents.js";
import { createInitialSceneDocumentState } from "./scene-writing-services.js";

const signalBook = BELLWETHER_FIXTURE_NAVIGATOR.books[0]!;
const signalBookId = signalBook.id;
const arrivalSceneId = sceneId("scene-arrival-at-bellwether");

function documentWithParagraphs(...paragraphs: readonly string[]) {
  const document = createEmptySceneDocument({
    generateBlockId: () => `block-${paragraphs.length}`
  });
  return validateSceneDocumentV1({
    ...document,
    document: {
      type: "doc",
      content: paragraphs.map((text, index) => ({
        type: "paragraph" as const,
        attrs: { id: `reader-block-${index}` },
        content: [{ type: "text" as const, text }]
      }))
    }
  });
}

function documentWithParagraph(text: string) {
  return documentWithParagraphs(text);
}

describe("book reader projection", () => {
  it("orders scenes across parts, chapters, and unassigned buckets", () => {
    const projection = buildBookReaderProjection({
      navigator: BELLWETHER_FIXTURE_NAVIGATOR,
      bookId: signalBookId,
      heads: new Map()
    });
    expect(projection?.scenes.map((scene) => scene.title)).toEqual([
      "Arrival at Bellwether",
      "The dead frequency",
      "The call that hasn't happened",
      "The false rescue"
    ]);
    expect(projection?.chapters.map((chapter) => chapter.title)).toEqual([
      "Low tide",
      "Static",
      "Unassigned scenes"
    ]);
  });

  it("excludes archived scenes from the reader manuscript", () => {
    const navigator = {
      ...BELLWETHER_FIXTURE_NAVIGATOR,
      books: BELLWETHER_FIXTURE_NAVIGATOR.books.map((book) =>
        book.id === signalBookId
          ? {
              ...book,
              parts: book.parts.map((part) => ({
                ...part,
                chapters: part.chapters.map((chapter) => ({
                  ...chapter,
                  scenes: chapter.scenes.map((scene) =>
                    scene.id === arrivalSceneId
                      ? { ...scene, archivedAt: "2026-07-12T00:00:00.000Z" }
                      : scene
                  )
                }))
              }))
            }
          : book
      )
    };
    const projection = buildBookReaderProjection({
      navigator,
      bookId: signalBookId,
      heads: new Map()
    });
    expect(projection?.scenes.map((scene) => scene.sceneId)).not.toContain(
      arrivalSceneId
    );
  });

  it("uses acknowledged scene heads and empty documents when missing", async () => {
    const sceneDocuments = createMemorySceneDocumentRepository();
    const initial = await createInitialSceneDocumentState({
      projectId: BELLWETHER_FIXTURE.project.id,
      sceneId: arrivalSceneId,
      actorAccountId: accountId("account-reader"),
      ids: { create: (kind) => `${kind}-reader` },
      now: "2026-07-12T00:00:00.000Z"
    });
    await sceneDocuments.initialize(initial);
    const heads = await sceneDocuments.getHeads([arrivalSceneId]);
    const projection = buildBookReaderProjection({
      navigator: BELLWETHER_FIXTURE_NAVIGATOR,
      bookId: signalBookId,
      heads: new Map(
        [...heads.entries()].map(([id, head]) => [
          id,
          {
            document: head.document,
            workingVersion: head.workingVersion,
            contentHash: head.contentHash
          }
        ])
      )
    });
    const arrival = projection?.scenes.find(
      (scene) => scene.sceneId === arrivalSceneId
    );
    expect(arrival?.workingVersion).toBe(1);
    expect(
      projection?.scenes.find((scene) => scene.sceneId !== arrivalSceneId)
        ?.workingVersion
    ).toBe(0);
  });

  it("paginates long manuscripts into spreads and chapter landmarks", () => {
    const longText = "word ".repeat(BOOK_READER_CHARS_PER_PAGE);
    const document = documentWithParagraphs(longText, longText, longText);
    const projection = buildBookReaderProjection({
      navigator: BELLWETHER_FIXTURE_NAVIGATOR,
      bookId: signalBookId,
      heads: new Map([
        [
          arrivalSceneId,
          {
            document,
            workingVersion: 2
          }
        ]
      ]),
      pinSceneId: arrivalSceneId
    });
    expect(projection).toBeDefined();
    const pages = paginateBookReaderProjection(projection!);
    const spreads = buildBookReaderSpreads(pages);
    expect(spreads.length).toBeGreaterThan(1);
    expect(bookReaderSpreadIndexForScene(pages, arrivalSceneId)).toBe(0);
    expect(
      bookReaderChapterStartSpreadIndex(pages, signalBook.parts[0]!.chapters[0]!.id)
    ).toBe(0);
  });

  it("rejects books that exceed the scene ceiling", () => {
    const oversizedBook = {
      ...signalBook,
      parts: [
        {
          ...signalBook.parts[0]!,
          chapters: [
            {
              ...signalBook.parts[0]!.chapters[0]!,
              scenes: Array.from({ length: BOOK_READER_MAX_SCENES + 1 }, (_, index) => ({
                id: sceneId(`scene-overflow-${index}`),
                title: `Scene ${index}`,
                status: "drafting" as const
              }))
            }
          ]
        }
      ],
      unassignedScenes: []
    };
    const navigator = {
      ...BELLWETHER_FIXTURE_NAVIGATOR,
      books: [oversizedBook]
    };
    expect(() =>
      buildBookReaderProjection({
        navigator,
        bookId: signalBookId,
        heads: new Map()
      })
    ).toThrow(BookReaderTooLargeError);
  });
});

describe("book reader services", () => {
  it("requires project ownership and returns a bounded projection", async () => {
    const projects = createMemoryProjectRepository(
      [BELLWETHER_FIXTURE],
      [
        createProjectMembership({
          projectId: BELLWETHER_FIXTURE.project.id,
          accountId: accountId("account-owner"),
          role: "owner",
          createdAt: "2026-07-12T00:00:00.000Z"
        })
      ]
    );
    const sceneDocuments = createMemorySceneDocumentRepository();
    const canvases = createMemoryCanvasRepository();
    const services = createBookReaderServices({
      projects,
      sceneDocuments,
      canvases
    });
    const projection = await services.getBookReader({
      accountId: accountId("account-owner"),
      projectId: BELLWETHER_FIXTURE.project.id,
      bookId: signalBookId,
      pinSceneId: arrivalSceneId
    });
    expect(projection.bookTitle).toBe("The Signal at Bellwether");
    expect(collectActiveBookSceneIds(signalBook)).toHaveLength(4);
    expect(sceneDocumentCharacterCount(projection.scenes[0]!.document)).toBe(0);
  });
});

describe("book reader scale smoke", () => {
  it("projects and paginates a fifty-scene book", async () => {
    const scenes = Array.from({ length: 50 }, (_, index) => ({
      id: sceneId(`scene-scale-${index}`),
      projectId: BELLWETHER_FIXTURE.project.id,
      bookId: signalBookId,
      title: `Scale scene ${index}`,
      status: "drafting" as const
    }));
    const navigator = {
      ...BELLWETHER_FIXTURE_NAVIGATOR,
      books: [
        {
          ...signalBook,
          parts: [
            {
              ...signalBook.parts[0]!,
              chapters: [
                {
                  id: signalBook.parts[0]!.chapters[0]!.id,
                  title: "Scale chapter",
                  scenes
                }
              ]
            }
          ],
          unassignedScenes: []
        }
      ]
    };
    const heads = new Map(
      (
        await Promise.all(
          scenes.map(async (scene, index) => {
            const document = documentWithParagraph(`Scene ${index} prose.`);
            return [
              scene.id,
              {
                document,
                workingVersion: 1,
                contentHash: sceneContentHash(await hashSceneDocument(document))
              }
            ] as const;
          })
        )
      )
    );
    const projection = buildBookReaderProjection({
      navigator,
      bookId: signalBookId,
      heads
    });
    expect(projection?.totals.scenes).toBe(50);
    const pages = paginateBookReaderProjection(projection!);
    expect(buildBookReaderSpreads(pages).length).toBeGreaterThan(0);
  });
});
