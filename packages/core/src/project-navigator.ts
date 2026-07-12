import {
  DomainValidationError,
  type BookId,
  type ChapterId,
  type EditionId,
  type PartId,
  type ProjectId,
  type ProjectRecords,
  type Scene,
  type SceneId,
  type SceneStatus,
  type StoryKnowledgeAuthority,
  type StoryKnowledgeId,
  type StoryKnowledgeKind,
  validateProjectRecords
} from "./domain.js";

export type ProjectNavigatorScene = Readonly<{
  id: SceneId;
  title: string;
  status: SceneStatus;
  summary?: string;
  povStoryKnowledgeId?: StoryKnowledgeId;
  archivedAt?: string;
}>;

export type ProjectNavigatorChapter = Readonly<{
  id: ChapterId;
  title: string;
  scenes: readonly ProjectNavigatorScene[];
}>;

export type ProjectNavigatorPart = Readonly<{
  id: PartId;
  title: string;
  chapters: readonly ProjectNavigatorChapter[];
}>;

export type ProjectNavigatorEdition = Readonly<{
  id: EditionId;
  name: string;
  sceneCount: number;
  createdAt: string;
}>;

export type ProjectNavigatorBook = Readonly<{
  id: BookId;
  title: string;
  status: "planned" | "drafting" | "revising" | "complete";
  parts: readonly ProjectNavigatorPart[];
  unassignedScenes: readonly ProjectNavigatorScene[];
  editions: readonly ProjectNavigatorEdition[];
  sceneCount: number;
  archivedAt?: string;
}>;

export type ProjectNavigatorKnowledge = Readonly<{
  id: StoryKnowledgeId;
  label: string;
  kind: StoryKnowledgeKind;
  authority: StoryKnowledgeAuthority;
  linkedSceneIds: readonly SceneId[];
  linkedSceneCount: number;
  archivedAt?: string;
}>;

export type ProjectNavigator = Readonly<{
  id: ProjectId;
  title: string;
  version: number;
  archivedAt?: string;
  books: readonly ProjectNavigatorBook[];
  storyKnowledge: readonly ProjectNavigatorKnowledge[];
  totals: Readonly<{
    books: number;
    scenes: number;
    storyKnowledge: number;
    editions: number;
  }>;
}>;

function freezeList<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}

function requireScene(
  sceneById: ReadonlyMap<SceneId, Scene>,
  sceneId: SceneId
): ProjectNavigatorScene {
  const scene = sceneById.get(sceneId);

  if (scene === undefined) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      `Project navigator cannot resolve scene "${sceneId}".`
    );
  }

  return Object.freeze({
    id: scene.id,
    title: scene.title,
    status: scene.status,
    ...(scene.summary === undefined ? {} : { summary: scene.summary }),
    ...(scene.povStoryKnowledgeId === undefined
      ? {}
      : { povStoryKnowledgeId: scene.povStoryKnowledgeId }),
    ...(scene.archivedAt === undefined ? {} : { archivedAt: scene.archivedAt })
  });
}

export function projectNavigatorFromRecords(records: ProjectRecords): ProjectNavigator {
  validateProjectRecords(records);

  const bookById = new Map(records.books.map((book) => [book.id, book]));
  const sceneById = new Map(records.scenes.map((scene) => [scene.id, scene]));
  const books = records.project.bookIds.map((bookId) => {
    const book = bookById.get(bookId);

    if (book === undefined) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        `Project navigator cannot resolve book "${bookId}".`
      );
    }

    const parts = book.manuscript.parts.map((part) =>
      Object.freeze({
        id: part.id,
        title: part.title,
        chapters: freezeList(
          part.chapters.map((chapter) =>
            Object.freeze({
              id: chapter.id,
              title: chapter.title,
              scenes: freezeList(
                chapter.sceneIds.map((sceneId) => requireScene(sceneById, sceneId))
              )
            })
          )
        )
      })
    );
    const editions = records.editions
      .filter((edition) => edition.bookId === book.id)
      .map((edition) =>
        Object.freeze({
          id: edition.id,
          name: edition.name,
          sceneCount: edition.sceneRevisions.length,
          createdAt: edition.createdAt
        })
      );

    return Object.freeze({
      id: book.id,
      title: book.title,
      status: book.status,
      parts: freezeList(parts),
      unassignedScenes: freezeList(
        book.manuscript.unassignedSceneIds.map((sceneId) =>
          requireScene(sceneById, sceneId)
        )
      ),
      editions: freezeList(editions),
      sceneCount: records.scenes.filter((scene) => scene.bookId === book.id).length,
      ...(book.archivedAt === undefined ? {} : { archivedAt: book.archivedAt })
    });
  });
  const storyKnowledge = [...records.storyKnowledge]
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((knowledge) =>
      Object.freeze({
        id: knowledge.id,
        label: knowledge.label,
        kind: knowledge.kind,
        authority: knowledge.authority,
        linkedSceneIds: freezeList(knowledge.linkedSceneIds),
        linkedSceneCount: knowledge.linkedSceneIds.length,
        ...(knowledge.archivedAt === undefined
          ? {}
          : { archivedAt: knowledge.archivedAt })
      })
    );

  return Object.freeze({
    id: records.project.id,
    title: records.project.title,
    version: records.project.version,
    ...(records.project.archivedAt === undefined
      ? {}
      : { archivedAt: records.project.archivedAt }),
    books: freezeList(books),
    storyKnowledge: freezeList(storyKnowledge),
    totals: Object.freeze({
      books: books.length,
      scenes: records.scenes.length,
      storyKnowledge: storyKnowledge.length,
      editions: records.editions.length
    })
  });
}
