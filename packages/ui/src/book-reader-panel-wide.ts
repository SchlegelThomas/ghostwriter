import type {
  BookReaderPage,
  BookReaderProjection,
  BookReaderSceneLink,
  ChapterId,
  SceneId
} from "@ghostwriter/core";
import {
  bookReaderSpreadIndexForScene,
  buildBookReaderSpreads,
  paginateBookReaderProjection
} from "@ghostwriter/core";
import type { SceneBlockV1, SceneInlineNodeV1 } from "@ghostwriter/editor";

export type WideReaderChapterId = ChapterId | "unassigned";

export const WIDE_READER_EMPTY_SCENE_MESSAGE =
  "This scene has no acknowledged prose yet." as const;

export function shouldShowWideReaderEmptySceneMessage(
  page: BookReaderPage | undefined
): boolean {
  return page !== undefined && page.blocks.length === 0;
}

function sceneIdsForWideReaderChapter(
  projection: BookReaderProjection,
  chapterId: WideReaderChapterId
): ReadonlySet<SceneId> {
  const chapter = projection.chapters.find((entry) => entry.id === chapterId);
  return new Set(chapter?.sceneIds ?? []);
}

/** Chapter-local reader view; does not mutate the server projection payload. */
export function bookReaderProjectionForWideChapter(
  projection: BookReaderProjection,
  chapterId: WideReaderChapterId
): BookReaderProjection {
  const allowedSceneIds = sceneIdsForWideReaderChapter(projection, chapterId);
  const scenes = projection.scenes.filter((scene) =>
    allowedSceneIds.has(scene.sceneId)
  );
  const pinSceneId =
    projection.pinSceneId !== undefined &&
    allowedSceneIds.has(projection.pinSceneId)
      ? projection.pinSceneId
      : undefined;
  const { pinSceneId: _ignoredPin, ...rest } = projection;
  return Object.freeze({
    ...rest,
    scenes,
    ...(pinSceneId === undefined ? {} : { pinSceneId })
  });
}

export function wideReaderChapterIdForScene(
  projection: BookReaderProjection,
  sceneId: SceneId
): WideReaderChapterId | undefined {
  for (const chapter of projection.chapters) {
    if (chapter.sceneIds.includes(sceneId)) return chapter.id;
  }
  const scene = projection.scenes.find((entry) => entry.sceneId === sceneId);
  if (scene === undefined) return undefined;
  if (scene.chapterId !== undefined) return scene.chapterId;
  return projection.chapters.find((chapter) => chapter.id === "unassigned")?.id;
}

export function resolveWideReaderInitialChapterId(
  projection: BookReaderProjection
): WideReaderChapterId | undefined {
  if (projection.pinSceneId !== undefined) {
    return (
      wideReaderChapterIdForScene(projection, projection.pinSceneId) ??
      projection.chapters[0]?.id
    );
  }
  return projection.chapters[0]?.id;
}

export function resolveWideReaderSpreadIndex(
  projection: BookReaderProjection,
  chapterId: WideReaderChapterId | undefined,
  options?: Readonly<{ preferPin?: boolean; spreadIndex?: number }>
): number {
  const scoped =
    chapterId === undefined
      ? projection
      : bookReaderProjectionForWideChapter(projection, chapterId);
  const pages = paginateBookReaderProjection(scoped);
  const spreads = buildBookReaderSpreads(pages);
  const maxIndex = Math.max(0, spreads.length - 1);
  if (options?.preferPin && scoped.pinSceneId !== undefined) {
    return Math.min(
      maxIndex,
      bookReaderSpreadIndexForScene(pages, scoped.pinSceneId)
    );
  }
  if (options?.spreadIndex !== undefined) {
    return Math.min(maxIndex, Math.max(0, options.spreadIndex));
  }
  return 0;
}

function blocksToSpeechText(blocks: readonly SceneBlockV1[]): string {
  return blocks
    .map((block) => {
      if (block.type === "horizontalRule") return "";
      if (block.type === "blockquote") {
        return blocksToSpeechText(block.content);
      }
      return inlineText(block.content);
    })
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function inlineText(nodes: readonly SceneInlineNodeV1[] | undefined): string {
  if (nodes === undefined) return "";
  return nodes
    .map((node) => (node.type === "text" ? node.text : "\n"))
    .join("");
}

function sceneLinksForSpread(
  projection: BookReaderProjection,
  spreadIndex: number,
  pages: readonly BookReaderPage[]
): readonly BookReaderSceneLink[] {
  const spread = buildBookReaderSpreads(pages)[spreadIndex];
  const sceneIds = new Set<SceneId>();
  for (const page of [spread?.left, spread?.right]) {
    if (page === undefined) continue;
    for (const block of page.blocks) sceneIds.add(block.sceneId);
  }
  const links: BookReaderSceneLink[] = [];
  for (const scene of projection.scenes) {
    if (!sceneIds.has(scene.sceneId)) continue;
    links.push(...scene.links);
  }
  return links;
}

export function wideReaderSpreadSpeechText(
  projection: BookReaderProjection,
  chapterId: WideReaderChapterId | undefined,
  spreadIndex: number
): string {
  const scoped =
    chapterId === undefined
      ? projection
      : bookReaderProjectionForWideChapter(projection, chapterId);
  const pages = paginateBookReaderProjection(scoped);
  const spreads = buildBookReaderSpreads(pages);
  const spread = spreads[spreadIndex] ?? spreads[0];
  const left = (spread?.left?.blocks ?? []).map((entry) => entry.block);
  const right = (spread?.right?.blocks ?? []).map((entry) => entry.block);
  return blocksToSpeechText([...left, ...right]);
}

export function wideReaderSpreadSceneLinks(
  projection: BookReaderProjection,
  chapterId: WideReaderChapterId | undefined,
  spreadIndex: number
): readonly BookReaderSceneLink[] {
  const scoped =
    chapterId === undefined
      ? projection
      : bookReaderProjectionForWideChapter(projection, chapterId);
  const pages = paginateBookReaderProjection(scoped);
  return sceneLinksForSpread(scoped, spreadIndex, pages);
}
