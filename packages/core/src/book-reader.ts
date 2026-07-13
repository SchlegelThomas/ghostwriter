import {
  createEmptySceneDocument,
  type SceneBlockV1,
  type SceneDocumentV1,
  type SceneInlineNodeV1
} from "@ghostwriter/editor";
import type {
  BookId,
  CanvasLinkId,
  ChapterId,
  PartId,
  ProjectId,
  SceneId,
  SceneStatus
} from "./domain.js";
import type {
  CanvasAuthority,
  CanvasBoard,
  CanvasLinkKind,
  CanvasObject
} from "./canvas.js";
import type {
  ProjectNavigator,
  ProjectNavigatorBook,
  ProjectNavigatorScene
} from "./project-navigator.js";
import type { SceneContentHash } from "./scene-documents.js";

export const BOOK_READER_MAX_SCENES = 200;
export const BOOK_READER_CHARS_PER_PAGE = 1_800;

export type BookReaderScenePlacement = "chapter" | "unassigned";

export type BookReaderSceneLink = Readonly<{
  id: CanvasLinkId;
  kind: CanvasLinkKind;
  direction: "inbound" | "outbound";
  authority: CanvasAuthority;
  label?: string;
  peerLabel: string;
  peerKind: "scene" | "story-knowledge" | "note" | "other";
}>;

export type BookReaderSceneEntry = Readonly<{
  sceneId: SceneId;
  title: string;
  status: SceneStatus;
  summary?: string;
  chapterId?: ChapterId;
  chapterTitle?: string;
  partId?: PartId;
  partTitle?: string;
  placement: BookReaderScenePlacement;
  document: SceneDocumentV1;
  workingVersion: number;
  contentHash?: SceneContentHash;
  links: readonly BookReaderSceneLink[];
}>;

export type BookReaderChapter = Readonly<{
  id: ChapterId | "unassigned";
  title: string;
  sceneIds: readonly SceneId[];
}>;

export type BookReaderProjection = Readonly<{
  projectId: ProjectId;
  bookId: BookId;
  bookTitle: string;
  pinSceneId?: SceneId;
  scenes: readonly BookReaderSceneEntry[];
  chapters: readonly BookReaderChapter[];
  totals: Readonly<{
    scenes: number;
    characters: number;
    spreads: number;
  }>;
}>;

export type BookReaderPageBlock = Readonly<{
  sceneId: SceneId;
  sceneTitle: string;
  chapterId?: ChapterId | "unassigned";
  chapterTitle: string;
  blockIndex: number;
  block: SceneBlockV1;
}>;

export type BookReaderPage = Readonly<{
  index: number;
  blocks: readonly BookReaderPageBlock[];
  runningHeader: string;
}>;

export type BookReaderSpread = Readonly<{
  index: number;
  left?: BookReaderPage;
  right?: BookReaderPage;
}>;

type SceneHeadInput = Readonly<{
  document: SceneDocumentV1;
  workingVersion: number;
  contentHash?: SceneContentHash;
}>;

type ChapterContext = Readonly<{
  chapterId?: ChapterId;
  chapterTitle?: string;
  partId?: PartId;
  partTitle?: string;
  placement: BookReaderScenePlacement;
}>;

function freezeList<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}

function inlineText(nodes: readonly SceneInlineNodeV1[] | undefined): string {
  if (nodes === undefined) return "";
  return nodes
    .map((node) => (node.type === "text" ? node.text : "\n"))
    .join("");
}

function blockText(block: SceneBlockV1): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return inlineText(block.content);
    case "horizontalRule":
      return "—";
    case "blockquote":
      return block.content
        .map((child) => blockText(child))
        .filter((value) => value.length > 0)
        .join("\n");
    default:
      return "";
  }
}

export function sceneDocumentCharacterCount(document: SceneDocumentV1): number {
  return document.document.content.reduce(
    (total, block) => total + blockText(block).length,
    0
  );
}

export function collectActiveBookSceneIds(
  book: ProjectNavigatorBook
): readonly SceneId[] {
  const sceneIds: SceneId[] = [];
  for (const part of book.parts) {
    for (const chapter of part.chapters) {
      for (const scene of chapter.scenes) {
        if (scene.archivedAt === undefined) sceneIds.push(scene.id);
      }
    }
  }
  for (const scene of book.unassignedScenes) {
    if (scene.archivedAt === undefined) sceneIds.push(scene.id);
  }
  return freezeList(sceneIds);
}

function chapterContextsForBook(
  book: ProjectNavigatorBook
): ReadonlyMap<SceneId, ChapterContext> {
  const contexts = new Map<SceneId, ChapterContext>();
  for (const part of book.parts) {
    for (const chapter of part.chapters) {
      for (const scene of chapter.scenes) {
        contexts.set(scene.id, {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          partId: part.id,
          partTitle: part.title,
          placement: "chapter"
        });
      }
    }
  }
  for (const scene of book.unassignedScenes) {
    contexts.set(scene.id, {
      chapterTitle: "Unassigned scenes",
      placement: "unassigned"
    });
  }
  return contexts;
}

function objectLabel(object: CanvasObject): string {
  return object.label.trim().length > 0 ? object.label : object.kind;
}

function objectPeerKind(
  object: CanvasObject
): BookReaderSceneLink["peerKind"] {
  if (object.kind === "scene-card") return "scene";
  if (object.kind === "story-knowledge-card") return "story-knowledge";
  if (object.kind === "note") return "note";
  return "other";
}

function linksForScene(
  sceneId: SceneId,
  board: CanvasBoard | undefined
): readonly BookReaderSceneLink[] {
  if (board === undefined) return freezeList([]);

  const objectById = new Map(board.objects.map((object) => [object.id, object]));
  const sceneObjectIds = new Set(
    board.objects
      .filter(
        (object) =>
          object.kind === "scene-card" &&
          object.sceneId === sceneId &&
          object.archivedAt === undefined &&
          object.dismissedAt === undefined
      )
      .map((object) => object.id)
  );
  if (sceneObjectIds.size === 0) return freezeList([]);

  const links: BookReaderSceneLink[] = [];
  for (const link of board.links) {
    if (link.archivedAt !== undefined || link.dismissedAt !== undefined) {
      continue;
    }
    const fromIsScene = sceneObjectIds.has(link.fromObjectId);
    const toIsScene = sceneObjectIds.has(link.toObjectId);
    if (!fromIsScene && !toIsScene) continue;

    const direction = fromIsScene ? "outbound" : "inbound";
    const peerObjectId = fromIsScene ? link.toObjectId : link.fromObjectId;
    const peer = objectById.get(peerObjectId);
    if (peer === undefined || peer.archivedAt !== undefined) continue;

    links.push(
      Object.freeze({
        id: link.id,
        kind: link.kind,
        direction,
        authority: link.authority,
        ...(link.label === undefined ? {} : { label: link.label }),
        peerLabel: objectLabel(peer),
        peerKind: objectPeerKind(peer)
      })
    );
  }

  return freezeList(
    links.sort((left, right) =>
      `${left.direction}:${left.kind}:${left.peerLabel}`.localeCompare(
        `${right.direction}:${right.kind}:${right.peerLabel}`
      )
    )
  );
}

function sceneEntry(
  scene: ProjectNavigatorScene,
  context: ChapterContext | undefined,
  head: SceneHeadInput | undefined,
  board: CanvasBoard | undefined
): BookReaderSceneEntry {
  const document =
    head?.document ??
    createEmptySceneDocument({
      generateBlockId: () => `reader-empty-${scene.id}`
    });
  return Object.freeze({
    sceneId: scene.id,
    title: scene.title,
    status: scene.status,
    ...(scene.summary === undefined ? {} : { summary: scene.summary }),
    ...(context?.chapterId === undefined ? {} : { chapterId: context.chapterId }),
    ...(context?.chapterTitle === undefined
      ? {}
      : { chapterTitle: context.chapterTitle }),
    ...(context?.partId === undefined ? {} : { partId: context.partId }),
    ...(context?.partTitle === undefined ? {} : { partTitle: context.partTitle }),
    placement: context?.placement ?? "unassigned",
    document,
    workingVersion: head?.workingVersion ?? 0,
    ...(head?.contentHash === undefined ? {} : { contentHash: head.contentHash }),
    links: linksForScene(scene.id, board)
  });
}

function chaptersForBook(
  book: ProjectNavigatorBook
): readonly BookReaderChapter[] {
  const chapters: BookReaderChapter[] = [];
  for (const part of book.parts) {
    for (const chapter of part.chapters) {
      const sceneIds = chapter.scenes
        .filter((scene) => scene.archivedAt === undefined)
        .map((scene) => scene.id);
      if (sceneIds.length === 0) continue;
      chapters.push(
        Object.freeze({
          id: chapter.id,
          title: chapter.title,
          sceneIds: freezeList(sceneIds)
        })
      );
    }
  }
  const unassignedSceneIds = book.unassignedScenes
    .filter((scene) => scene.archivedAt === undefined)
    .map((scene) => scene.id);
  if (unassignedSceneIds.length > 0) {
    chapters.push(
      Object.freeze({
        id: "unassigned",
        title: "Unassigned scenes",
        sceneIds: freezeList(unassignedSceneIds)
      })
    );
  }
  return freezeList(chapters);
}

export function buildBookReaderProjection(input: Readonly<{
  navigator: ProjectNavigator;
  bookId: BookId;
  heads: ReadonlyMap<SceneId, SceneHeadInput>;
  board?: CanvasBoard;
  pinSceneId?: SceneId;
}>): BookReaderProjection | undefined {
  const book = input.navigator.books.find(
    (candidate) => candidate.id === input.bookId
  );
  if (
    book === undefined ||
    book.archivedAt !== undefined ||
    input.navigator.archivedAt !== undefined
  ) {
    return undefined;
  }

  const contexts = chapterContextsForBook(book);
  const scenes: BookReaderSceneEntry[] = [];
  const pushScene = (scene: ProjectNavigatorScene): void => {
    if (scene.archivedAt !== undefined) return;
    scenes.push(
      sceneEntry(scene, contexts.get(scene.id), input.heads.get(scene.id), input.board)
    );
  };

  for (const part of book.parts) {
    for (const chapter of part.chapters) {
      for (const scene of chapter.scenes) pushScene(scene);
    }
  }
  for (const scene of book.unassignedScenes) pushScene(scene);

  if (scenes.length > BOOK_READER_MAX_SCENES) {
    throw new BookReaderTooLargeError();
  }

  const characters = scenes.reduce(
    (total, entry) => total + sceneDocumentCharacterCount(entry.document),
    0
  );
  const pages = paginateBookReaderProjection(
    Object.freeze({
      projectId: input.navigator.id,
      bookId: book.id,
      bookTitle: book.title,
      ...(input.pinSceneId === undefined ? {} : { pinSceneId: input.pinSceneId }),
      scenes: freezeList(scenes),
      chapters: chaptersForBook(book),
      totals: Object.freeze({
        scenes: scenes.length,
        characters,
        spreads: 0
      })
    })
  );

  return Object.freeze({
    projectId: input.navigator.id,
    bookId: book.id,
    bookTitle: book.title,
    ...(input.pinSceneId === undefined ? {} : { pinSceneId: input.pinSceneId }),
    scenes: freezeList(scenes),
    chapters: chaptersForBook(book),
    totals: Object.freeze({
      scenes: scenes.length,
      characters,
      spreads: bookReaderSpreadCount(pages)
    })
  });
}

export function paginateBookReaderProjection(
  projection: BookReaderProjection
): readonly BookReaderPage[] {
  const pages: BookReaderPage[] = [];
  let currentBlocks: BookReaderPageBlock[] = [];
  let currentChars = 0;

  const flush = (): void => {
    if (currentBlocks.length === 0) return;
    const first = currentBlocks[0];
    pages.push(
      Object.freeze({
        index: pages.length,
        blocks: freezeList(currentBlocks),
        runningHeader: `${first?.chapterTitle ?? projection.bookTitle} · ${
          first?.sceneTitle ?? ""
        }`
      })
    );
    currentBlocks = [];
    currentChars = 0;
  };

  for (const entry of projection.scenes) {
    const chapterTitle = entry.chapterTitle ?? "Unassigned scenes";
    const chapterId = entry.chapterId ?? "unassigned";
    entry.document.document.content.forEach((block, blockIndex) => {
      const blockChars = Math.max(blockText(block).length, 1);
      if (
        currentBlocks.length > 0 &&
        currentChars + blockChars > BOOK_READER_CHARS_PER_PAGE
      ) {
        flush();
      }
      currentBlocks.push(
        Object.freeze({
          sceneId: entry.sceneId,
          sceneTitle: entry.title,
          chapterId,
          chapterTitle,
          blockIndex,
          block
        })
      );
      currentChars += blockChars;
      if (currentChars >= BOOK_READER_CHARS_PER_PAGE) flush();
    });
  }
  flush();

  if (pages.length === 0) {
    const firstScene = projection.scenes[0];
    pages.push(
      Object.freeze({
        index: 0,
        blocks: freezeList([]),
        runningHeader:
          firstScene === undefined
            ? projection.bookTitle
            : `${firstScene.chapterTitle ?? projection.bookTitle} · ${firstScene.title}`
      })
    );
  }

  return freezeList(pages);
}

export function bookReaderSpreadCount(pages: readonly BookReaderPage[]): number {
  return Math.max(1, Math.ceil(pages.length / 2));
}

export function buildBookReaderSpreads(
  pages: readonly BookReaderPage[]
): readonly BookReaderSpread[] {
  const spreads: BookReaderSpread[] = [];
  for (let index = 0; index < pages.length; index += 2) {
    spreads.push(
      Object.freeze({
        index: spreads.length,
        ...(pages[index] === undefined ? {} : { left: pages[index] }),
        ...(pages[index + 1] === undefined ? {} : { right: pages[index + 1] })
      })
    );
  }
  if (spreads.length === 0) {
    spreads.push(Object.freeze({ index: 0 }));
  }
  return freezeList(spreads);
}

export function bookReaderSpreadIndexForScene(
  pages: readonly BookReaderPage[],
  sceneId: SceneId
): number {
  const pageIndex = pages.findIndex((page) =>
    page.blocks.some((block) => block.sceneId === sceneId)
  );
  if (pageIndex < 0) return 0;
  return Math.floor(pageIndex / 2);
}

export function bookReaderChapterStartSpreadIndex(
  pages: readonly BookReaderPage[],
  chapterId: ChapterId | "unassigned"
): number {
  const pageIndex = pages.findIndex((page) =>
    page.blocks.some((block) => block.chapterId === chapterId)
  );
  if (pageIndex < 0) return 0;
  return Math.floor(pageIndex / 2);
}

export class BookNotFoundError extends Error {
  constructor() {
    super("Book not found.");
    this.name = "BookNotFoundError";
  }
}

export class BookReaderTooLargeError extends Error {
  constructor() {
    super("This book is too large to load in the reader.");
    this.name = "BookReaderTooLargeError";
  }
}
