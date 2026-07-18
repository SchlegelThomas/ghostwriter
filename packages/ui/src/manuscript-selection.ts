import type {
  BookId,
  ChapterId,
  PartId,
  ProjectNavigator,
  ProjectNavigatorBook,
  ProjectNavigatorChapter,
  ProjectNavigatorKnowledge,
  ProjectNavigatorPart,
  ProjectNavigatorScene,
  SceneId,
  StoryKnowledgeId
} from "@ghostwriter/core";

export type ManuscriptSelection =
  | Readonly<{ kind: "project" }>
  | Readonly<{ kind: "book"; bookId: BookId }>
  | Readonly<{ kind: "part"; bookId: BookId; partId: PartId }>
  | Readonly<{
      kind: "chapter";
      bookId: BookId;
      partId: PartId;
      chapterId: ChapterId;
    }>
  | Readonly<{
      kind: "scene";
      bookId: BookId;
      sceneId: SceneId;
      partId?: PartId;
      chapterId?: ChapterId;
    }>
  | Readonly<{ kind: "unassigned"; bookId: BookId }>
  | Readonly<{ kind: "storyKnowledgeRoot" }>
  | Readonly<{
      kind: "storyKnowledge";
      storyKnowledgeId: StoryKnowledgeId;
    }>;

export type ResolvedManuscriptSelection = Readonly<{
  selection: ManuscriptSelection;
  book?: ProjectNavigatorBook;
  part?: ProjectNavigatorPart;
  chapter?: ProjectNavigatorChapter;
  scene?: ProjectNavigatorScene;
  knowledge?: ProjectNavigatorKnowledge;
}>;

export function manuscriptSelectionKey(selection: ManuscriptSelection): string {
  switch (selection.kind) {
    case "project":
      return "project";
    case "book":
      return `book:${selection.bookId}`;
    case "part":
      return `part:${selection.bookId}:${selection.partId}`;
    case "chapter":
      return `chapter:${selection.bookId}:${selection.partId}:${selection.chapterId}`;
    case "scene":
      return `scene:${selection.sceneId}`;
    case "unassigned":
      return `unassigned:${selection.bookId}`;
    case "storyKnowledgeRoot":
      return "story-knowledge";
    case "storyKnowledge":
      return `story-knowledge:${selection.storyKnowledgeId}`;
  }
}

export function sceneSelection(
  project: ProjectNavigator,
  sceneId: SceneId
): ManuscriptSelection | undefined {
  for (const book of project.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        if (chapter.scenes.some((scene) => scene.id === sceneId)) {
          return {
            kind: "scene",
            bookId: book.id,
            partId: part.id,
            chapterId: chapter.id,
            sceneId
          };
        }
      }
    }
    if (book.unassignedScenes.some((scene) => scene.id === sceneId)) {
      return { kind: "scene", bookId: book.id, sceneId };
    }
  }
  return undefined;
}

export function resolveManuscriptSelection(
  project: ProjectNavigator,
  selection: ManuscriptSelection
): ResolvedManuscriptSelection | undefined {
  if (
    selection.kind === "project" ||
    selection.kind === "storyKnowledgeRoot"
  ) {
    return { selection };
  }
  if (selection.kind === "storyKnowledge") {
    const knowledge = project.storyKnowledge.find(
      (candidate) => candidate.id === selection.storyKnowledgeId
    );
    return knowledge === undefined ? undefined : { selection, knowledge };
  }

  const book = project.books.find(
    (candidate) => candidate.id === selection.bookId
  );
  if (book === undefined) return undefined;
  if (selection.kind === "book" || selection.kind === "unassigned") {
    return { selection, book };
  }
  if (selection.kind === "scene" && selection.chapterId === undefined) {
    const scene = book.unassignedScenes.find(
      (candidate) => candidate.id === selection.sceneId
    );
    return scene === undefined ? undefined : { selection, book, scene };
  }

  const part = book.parts.find(
    (candidate) => candidate.id === selection.partId
  );
  if (part === undefined) return undefined;
  if (selection.kind === "part") return { selection, book, part };
  const chapter = part.chapters.find(
    (candidate) => candidate.id === selection.chapterId
  );
  if (chapter === undefined) return undefined;
  if (selection.kind === "chapter") {
    return { selection, book, part, chapter };
  }
  const scene = chapter.scenes.find(
    (candidate) => candidate.id === selection.sceneId
  );
  return scene === undefined
    ? undefined
    : { selection, book, part, chapter, scene };
}
