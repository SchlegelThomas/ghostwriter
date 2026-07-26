import type {
  ProjectNavigator,
  ProjectNavigatorScene,
  SceneId,
  SceneStatus,
  StoryKnowledgeId
} from "@ghostwriter/core";
import {
  resolveManuscriptSelection,
  type ManuscriptSelection
} from "./manuscript-selection.js";

export type ManuscriptChronologyScopeKind =
  | "book"
  | "part"
  | "chapter"
  | "unassigned"
  | "storyKnowledgeRoot";

export type ManuscriptChronologySceneBlock = Readonly<{
  sceneId: SceneId;
  title: string;
  status: SceneStatus;
  chapterLandmark: string;
  bookTitle?: string;
  partTitle?: string;
  povLabel?: string;
  summary?: string;
  selection: Extract<ManuscriptSelection, { kind: "scene" }>;
}>;

export type ManuscriptChronologyTocItem = Readonly<{
  id: string;
  label: string;
  firstSceneId: SceneId;
}>;

export type ManuscriptChronologyProjection = Readonly<{
  scopeKind: ManuscriptChronologyScopeKind;
  eyebrow: string;
  title: string;
  description: string;
  scenes: readonly ManuscriptChronologySceneBlock[];
  chapters: readonly ManuscriptChronologyTocItem[];
}>;

type OrderedScene = Readonly<{
  scene: ProjectNavigatorScene;
  bookTitle: string;
  partTitle?: string;
  chapterLandmark: string;
  selection: Extract<ManuscriptSelection, { kind: "scene" }>;
}>;

function povLabelFor(
  project: ProjectNavigator,
  povStoryKnowledgeId: StoryKnowledgeId | undefined
): string | undefined {
  if (povStoryKnowledgeId === undefined) return undefined;
  return project.storyKnowledge.find(
    (knowledge) => knowledge.id === povStoryKnowledgeId
  )?.label;
}

function orderedProjectScenes(project: ProjectNavigator): readonly OrderedScene[] {
  const rows: OrderedScene[] = [];
  for (const book of project.books) {
    if (book.archivedAt !== undefined) continue;
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        for (const scene of chapter.scenes) {
          if (scene.archivedAt !== undefined) continue;
          rows.push({
            scene,
            bookTitle: book.title,
            partTitle: part.title,
            chapterLandmark: chapter.title,
            selection: {
              kind: "scene",
              bookId: book.id,
              partId: part.id,
              chapterId: chapter.id,
              sceneId: scene.id
            }
          });
        }
      }
    }
    for (const scene of book.unassignedScenes) {
      if (scene.archivedAt !== undefined) continue;
      rows.push({
        scene,
        bookTitle: book.title,
        chapterLandmark: "Unassigned",
        selection: {
          kind: "scene",
          bookId: book.id,
          sceneId: scene.id
        }
      });
    }
  }
  return rows;
}

function toBlocks(
  project: ProjectNavigator,
  rows: readonly OrderedScene[]
): readonly ManuscriptChronologySceneBlock[] {
  return rows.map((row) => {
    const povLabel = povLabelFor(project, row.scene.povStoryKnowledgeId);
    return {
      sceneId: row.scene.id,
      title: row.scene.title,
      status: row.scene.status,
      chapterLandmark: row.chapterLandmark,
      bookTitle: row.bookTitle,
      ...(row.partTitle === undefined ? {} : { partTitle: row.partTitle }),
      ...(povLabel === undefined ? {} : { povLabel }),
      ...(row.scene.summary === undefined ? {} : { summary: row.scene.summary }),
      selection: row.selection
    };
  });
}

function tocFromScenes(
  scenes: readonly ManuscriptChronologySceneBlock[]
): readonly ManuscriptChronologyTocItem[] {
  const items: ManuscriptChronologyTocItem[] = [];
  const seen = new Set<string>();
  for (const scene of scenes) {
    const landmarkKey = `${scene.bookTitle ?? ""}:${scene.chapterLandmark}`;
    if (seen.has(landmarkKey)) continue;
    seen.add(landmarkKey);
    items.push({
      id: landmarkKey,
      label: scene.chapterLandmark,
      firstSceneId: scene.sceneId
    });
  }
  return items;
}

export function manuscriptChronologySupportsSelection(
  selection: ManuscriptSelection
): selection is Extract<
  ManuscriptSelection,
  { kind: ManuscriptChronologyScopeKind }
> {
  switch (selection.kind) {
    case "book":
    case "part":
    case "chapter":
    case "unassigned":
    case "storyKnowledgeRoot":
      return true;
    default:
      return false;
  }
}

/**
 * Manuscript-order scene scroll for Write-rail structure scopes.
 * Project home, Cast, and single-scene Draft are handled elsewhere.
 */
export function manuscriptChronology(
  project: ProjectNavigator,
  selection: ManuscriptSelection
): ManuscriptChronologyProjection | undefined {
  if (!manuscriptChronologySupportsSelection(selection)) return undefined;
  const resolved = resolveManuscriptSelection(project, selection);
  if (resolved === undefined) return undefined;

  const all = orderedProjectScenes(project);
  let scoped: readonly OrderedScene[];
  let eyebrow: string;
  let title: string;
  let description: string;

  switch (selection.kind) {
    case "storyKnowledgeRoot": {
      scoped = all;
      eyebrow = "Manuscript";
      title = project.title;
      description =
        scoped.length === 0
          ? "No scenes yet. Add a book and scene from Explorer, then write in order here."
          : `${scoped.length} ${
              scoped.length === 1 ? "scene" : "scenes"
            } in manuscript order. Scroll to read, or open a scene to edit.`;
      break;
    }
    case "book": {
      const book = resolved.book;
      if (book === undefined) return undefined;
      scoped = all.filter((row) => row.selection.bookId === selection.bookId);
      eyebrow = `Book · ${book.status}`;
      title = book.title;
      description =
        scoped.length === 0
          ? "This book has no active scenes yet."
          : `${scoped.length} ${
              scoped.length === 1 ? "scene" : "scenes"
            } across parts and unassigned.`;
      break;
    }
    case "part": {
      const part = resolved.part;
      if (part === undefined) return undefined;
      scoped = all.filter(
        (row) =>
          row.selection.bookId === selection.bookId &&
          row.selection.partId === selection.partId
      );
      eyebrow = "Part";
      title = part.title;
      description =
        part.summary ??
        (scoped.length === 0
          ? "No scenes in this part yet."
          : `${scoped.length} ${
              scoped.length === 1 ? "scene" : "scenes"
            } in manuscript order.`);
      break;
    }
    case "chapter": {
      const chapter = resolved.chapter;
      if (chapter === undefined) return undefined;
      scoped = all.filter(
        (row) =>
          row.selection.bookId === selection.bookId &&
          row.selection.partId === selection.partId &&
          row.selection.chapterId === selection.chapterId
      );
      eyebrow = "Chapter";
      title = chapter.title;
      description =
        chapter.summary ??
        (scoped.length === 0
          ? "This chapter is empty. Create a scene from Explorer or Quick Build."
          : `${scoped.length} ${
              scoped.length === 1 ? "scene" : "scenes"
            } in this chapter.`);
      break;
    }
    case "unassigned": {
      const book = resolved.book;
      if (book === undefined) return undefined;
      scoped = all.filter(
        (row) =>
          row.selection.bookId === selection.bookId &&
          row.selection.chapterId === undefined
      );
      eyebrow = `Unassigned · ${book.title}`;
      title =
        scoped.length === 0 ? "No loose scenes" : "Scenes waiting for a chapter";
      description =
        scoped.length === 0
          ? "Capture a scene, then place it in the manuscript when its chapter is clear."
          : `${scoped.length} unassigned ${
              scoped.length === 1 ? "scene" : "scenes"
            }. Open one to edit, or move it from Explorer.`;
      break;
    }
  }

  const scenes = toBlocks(project, scoped);
  return {
    scopeKind: selection.kind,
    eyebrow,
    title,
    description,
    scenes,
    chapters: tocFromScenes(scenes)
  };
}

export function chronologySceneIds(
  projection: ManuscriptChronologyProjection | undefined
): readonly SceneId[] {
  if (projection === undefined) return [];
  return projection.scenes.map((scene) => scene.sceneId);
}
