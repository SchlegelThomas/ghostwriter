import {
  bookId,
  chapterId,
  createBook,
  createManuscriptChapter,
  createScene,
  createStoryKnowledge,
  defineProjectRecords,
  partId,
  sceneId,
  storyKnowledgeId,
  type Book,
  type BookId,
  type BookStatus,
  type ChapterId,
  type ManuscriptChapter,
  type ManuscriptPart,
  type PartId,
  type Project,
  type ProjectId,
  type ProjectRecords,
  type CharacterSheet,
  type Scene,
  type SceneBackdrop,
  type SceneId,
  type SceneImageRef,
  type SceneMusic,
  type SceneSketch,
  type SceneStatus,
  type StoryKnowledge,
  type StoryKnowledgeAuthority,
  type StoryKnowledgeId,
  type StoryKnowledgeKind,
  type StoryKnowledgeLinkKind
} from "./domain.js";
import {
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import {
  type Clock,
  type IdGenerator,
  type ProjectRepository,
  ProjectVersionConflictError
} from "./project-repository.js";
import { projectNavigatorFromRecords, type ProjectNavigator } from "./project-navigator.js";

async function loadRecords(
  repository: ProjectRepository,
  id: ProjectId
): Promise<ProjectRecords | undefined> {
  const project = await repository.getProject(id);
  if (project === undefined) return undefined;
  const [books, scenes, storyKnowledge, editions] = await Promise.all([
    repository.listBooks(id),
    repository.listScenes(id),
    repository.listStoryKnowledge(id),
    repository.listEditions(id)
  ]);
  return { project, books, scenes, storyKnowledge, editions };
}

export type ProjectCommandCode =
  | "RECORD_NOT_FOUND"
  | "INVALID_ORDER"
  | "UNSAFE_REMOVAL"
  | "INVALID_PLACEMENT";

export class ProjectCommandError extends Error {
  readonly code: ProjectCommandCode;

  constructor(code: ProjectCommandCode, message: string) {
    super(message);
    this.name = "ProjectCommandError";
    this.code = code;
  }
}

export type ProjectCommand =
  | Readonly<{ type: "project.rename"; title: string }>
  | Readonly<{ type: "project.setArchived"; archived: boolean }>
  | Readonly<{ type: "book.create"; title: string }>
  | Readonly<{
      type: "book.update";
      bookId: BookId;
      title?: string;
      status?: BookStatus;
    }>
  | Readonly<{ type: "book.reorder"; bookIds: readonly BookId[] }>
  | Readonly<{ type: "book.setArchived"; bookId: BookId; archived: boolean }>
  | Readonly<{ type: "part.create"; bookId: BookId; title: string }>
  | Readonly<{ type: "part.rename"; bookId: BookId; partId: PartId; title: string }>
  | Readonly<{ type: "part.reorder"; bookId: BookId; partIds: readonly PartId[] }>
  | Readonly<{ type: "part.removeEmpty"; bookId: BookId; partId: PartId }>
  | Readonly<{
      type: "chapter.create";
      bookId: BookId;
      partId: PartId;
      title: string;
    }>
  | Readonly<{
      type: "chapter.rename";
      bookId: BookId;
      partId: PartId;
      chapterId: ChapterId;
      title: string;
    }>
  | Readonly<{
      type: "chapter.update";
      bookId: BookId;
      partId: PartId;
      chapterId: ChapterId;
      title?: string;
      summary?: string | null;
    }>
  | Readonly<{
      type: "chapter.reorder";
      bookId: BookId;
      partId: PartId;
      chapterIds: readonly ChapterId[];
    }>
  | Readonly<{
      type: "chapter.removeEmpty";
      bookId: BookId;
      partId: PartId;
      chapterId: ChapterId;
    }>
  | Readonly<{
      type: "scene.create";
      bookId: BookId;
      title: string;
      chapterId?: ChapterId;
      position?: number;
    }>
  | Readonly<{
      type: "scene.update";
      sceneId: SceneId;
      title?: string;
      status?: SceneStatus;
      summary?: string | null;
      povStoryKnowledgeId?: StoryKnowledgeId | null;
      backdrop?: SceneBackdrop | null;
      music?: SceneMusic | null;
      imageRefs?: readonly SceneImageRef[] | null;
      sketch?: SceneSketch | null;
    }>
  | Readonly<{
      type: "scene.move";
      sceneId: SceneId;
      bookId: BookId;
      chapterId?: ChapterId;
      position: number;
    }>
  | Readonly<{ type: "scene.setArchived"; sceneId: SceneId; archived: boolean }>
  | Readonly<{
      type: "storyKnowledge.create";
      label: string;
      kind: StoryKnowledgeKind;
      authority: StoryKnowledgeAuthority;
    }>
  | Readonly<{
      type: "storyKnowledge.update";
      storyKnowledgeId: StoryKnowledgeId;
      label?: string;
      kind?: StoryKnowledgeKind;
      authority?: StoryKnowledgeAuthority;
      notes?: string | null;
      aliases?: readonly string[] | null;
      characterSheet?: CharacterSheet | null;
    }>
  | Readonly<{
      type: "storyKnowledge.setSceneLink";
      storyKnowledgeId: StoryKnowledgeId;
      sceneId: SceneId;
      linked: boolean;
    }>
  | Readonly<{
      type: "storyKnowledge.setKnowledgeLink";
      fromId: StoryKnowledgeId;
      toId: StoryKnowledgeId;
      kind: StoryKnowledgeLinkKind;
      linked: boolean;
    }>
  | Readonly<{
      type: "storyKnowledge.setArchived";
      storyKnowledgeId: StoryKnowledgeId;
      archived: boolean;
    }>;

export type ExecuteProjectCommandInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  expectedVersion: number;
  command: ProjectCommand;
}>;

export type ProjectCommandServices = Readonly<{
  executeProjectCommand(input: ExecuteProjectCommandInput): Promise<ProjectNavigator>;
}>;

function missing(kind: string, id: string): never {
  throw new ProjectCommandError("RECORD_NOT_FOUND", `${kind} "${id}" was not found.`);
}

function indexForPosition(position: number, length: number): number {
  if (!Number.isSafeInteger(position) || position < 0 || position > length) {
    throw new ProjectCommandError(
      "INVALID_PLACEMENT",
      `Position ${position} must be between 0 and ${length}.`
    );
  }
  return position;
}

function reorderExactly<Value extends { id: string }>(
  values: readonly Value[],
  ids: readonly string[],
  label: string
): Value[] {
  if (ids.length !== values.length || new Set(ids).size !== ids.length) {
    throw new ProjectCommandError(
      "INVALID_ORDER",
      `${label} order must contain every current ID exactly once.`
    );
  }
  const byId = new Map(values.map((value) => [value.id, value]));
  const ordered = ids.map((id) => byId.get(id));
  if (ordered.some((value) => value === undefined)) {
    throw new ProjectCommandError(
      "INVALID_ORDER",
      `${label} order contains an unknown ID.`
    );
  }
  return ordered as Value[];
}

function updateBook(
  books: readonly Book[],
  id: BookId,
  update: (book: Book) => Book
): Book[] {
  let found = false;
  const result = books.map((book) => {
    if (book.id !== id) return book;
    found = true;
    return update(book);
  });
  if (!found) missing("Book", id);
  return result;
}

function updatePart(
  book: Book,
  id: PartId,
  update: (part: ManuscriptPart) => ManuscriptPart
): Book {
  let found = false;
  const parts = book.manuscript.parts.map((part) => {
    if (part.id !== id) return part;
    found = true;
    return update(part);
  });
  if (!found) missing("Part", id);
  return { ...book, manuscript: { ...book.manuscript, parts } };
}

function updateChapter(
  part: ManuscriptPart,
  id: ChapterId,
  update: (chapter: ManuscriptChapter) => ManuscriptChapter
): ManuscriptPart {
  let found = false;
  const chapters = part.chapters.map((chapter) => {
    if (chapter.id !== id) return chapter;
    found = true;
    return update(chapter);
  });
  if (!found) missing("Chapter", id);
  return { ...part, chapters };
}

function removeSceneFromManuscripts(
  books: readonly Book[],
  id: SceneId
): Book[] {
  return books.map((book) => ({
    ...book,
    manuscript: {
      parts: book.manuscript.parts.map((part) => ({
        ...part,
        chapters: part.chapters.map((chapter) => ({
          ...chapter,
          sceneIds: chapter.sceneIds.filter((candidate) => candidate !== id)
        }))
      })),
      unassignedSceneIds: book.manuscript.unassignedSceneIds.filter(
        (candidate) => candidate !== id
      )
    }
  }));
}

function placeScene(
  books: readonly Book[],
  targetBookId: BookId,
  targetChapterId: ChapterId | undefined,
  id: SceneId,
  position: number | undefined
): Book[] {
  return updateBook(books, targetBookId, (book) => {
    if (targetChapterId === undefined) {
      const target = [...book.manuscript.unassignedSceneIds];
      target.splice(indexForPosition(position ?? target.length, target.length), 0, id);
      return {
        ...book,
        manuscript: { ...book.manuscript, unassignedSceneIds: target }
      };
    }

    let found = false;
    const parts = book.manuscript.parts.map((part) => ({
      ...part,
      chapters: part.chapters.map((chapter) => {
        if (chapter.id !== targetChapterId) return chapter;
        found = true;
        const target = [...chapter.sceneIds];
        target.splice(indexForPosition(position ?? target.length, target.length), 0, id);
        return { ...chapter, sceneIds: target };
      })
    }));
    if (!found) missing("Chapter", targetChapterId);
    return { ...book, manuscript: { ...book.manuscript, parts } };
  });
}

function findScene(scenes: readonly Scene[], id: SceneId): Scene {
  const scene = scenes.find((candidate) => candidate.id === id);
  return scene ?? missing("Scene", id);
}

function findKnowledge(
  knowledge: readonly StoryKnowledge[],
  id: StoryKnowledgeId
): StoryKnowledge {
  const record = knowledge.find((candidate) => candidate.id === id);
  return record ?? missing("Story knowledge", id);
}

function replaceScene(
  scenes: readonly Scene[],
  id: SceneId,
  replacement: Scene
): Scene[] {
  return scenes.map((scene) => (scene.id === id ? replacement : scene));
}

function updatedArchive(
  archived: boolean,
  now: string,
  current: string | undefined
): string | undefined {
  return archived ? current ?? now : undefined;
}

export function applyProjectCommandToRecords(
  records: ProjectRecords,
  command: ProjectCommand,
  ids: IdGenerator,
  now: string
): ProjectRecords {
  let project: Project = records.project;
  let books = [...records.books];
  let scenes = [...records.scenes];
  let storyKnowledge = [...records.storyKnowledge];

  switch (command.type) {
    case "project.rename":
      project = { ...project, title: command.title };
      break;
    case "project.setArchived": {
      const archivedAt = updatedArchive(command.archived, now, project.archivedAt);
      const { archivedAt: _ignored, ...activeProject } = project;
      project =
        archivedAt === undefined ? activeProject : { ...activeProject, archivedAt };
      break;
    }
    case "book.create": {
      const id = bookId(ids.create("book"));
      books.push(
        createBook({
          id,
          projectId: project.id,
          title: command.title,
          status: "planned",
          manuscript: { parts: [], unassignedSceneIds: [] },
          createdAt: now
        })
      );
      project = { ...project, bookIds: [...project.bookIds, id] };
      break;
    }
    case "book.update":
      books = updateBook(books, command.bookId, (book) =>
        createBook({
          ...book,
          title: command.title ?? book.title,
          status: command.status ?? book.status
        })
      );
      break;
    case "book.reorder": {
      const ordered = reorderExactly(
        project.bookIds.map((id) => ({ id })),
        command.bookIds,
        "Book"
      );
      project = { ...project, bookIds: ordered.map((entry) => entry.id as BookId) };
      break;
    }
    case "book.setArchived": {
      const target = books.find((book) => book.id === command.bookId);
      if (target === undefined) missing("Book", command.bookId);
      if (
        command.archived &&
        target.archivedAt === undefined &&
        books.filter((book) => book.archivedAt === undefined).length === 1
      ) {
        throw new ProjectCommandError(
          "UNSAFE_REMOVAL",
          "A project must retain at least one active book."
        );
      }
      books = updateBook(books, command.bookId, (book) => {
        const archivedAt = updatedArchive(command.archived, now, book.archivedAt);
        const { archivedAt: _ignored, ...activeBook } = book;
        return createBook(
          archivedAt === undefined ? activeBook : { ...activeBook, archivedAt }
        );
      });
      break;
    }
    case "part.create":
      books = updateBook(books, command.bookId, (book) =>
        createBook({
          ...book,
          manuscript: {
            ...book.manuscript,
            parts: [
              ...book.manuscript.parts,
              { id: partId(ids.create("part")), title: command.title, chapters: [] }
            ]
          }
        })
      );
      break;
    case "part.rename":
      books = updateBook(books, command.bookId, (book) =>
        createBook({
          ...updatePart(book, command.partId, (part) => ({
            ...part,
            title: command.title
          }))
        })
      );
      break;
    case "part.reorder":
      books = updateBook(books, command.bookId, (book) =>
        createBook({
          ...book,
          manuscript: {
            ...book.manuscript,
            parts: reorderExactly(book.manuscript.parts, command.partIds, "Part")
          }
        })
      );
      break;
    case "part.removeEmpty":
      books = updateBook(books, command.bookId, (book) => {
        const target = book.manuscript.parts.find((part) => part.id === command.partId);
        if (target === undefined) missing("Part", command.partId);
        if (target.chapters.length > 0) {
          throw new ProjectCommandError(
            "UNSAFE_REMOVAL",
            "Only a part with no chapters can be removed."
          );
        }
        return createBook({
          ...book,
          manuscript: {
            ...book.manuscript,
            parts: book.manuscript.parts.filter((part) => part.id !== command.partId)
          }
        });
      });
      break;
    case "chapter.create":
      books = updateBook(books, command.bookId, (book) =>
        createBook({
          ...updatePart(book, command.partId, (part) => ({
            ...part,
            chapters: [
              ...part.chapters,
              createManuscriptChapter({
                id: chapterId(ids.create("chapter")),
                title: command.title,
                sceneIds: []
              })
            ]
          }))
        })
      );
      break;
    case "chapter.rename":
      books = updateBook(books, command.bookId, (book) =>
        createBook({
          ...updatePart(book, command.partId, (part) =>
            updateChapter(part, command.chapterId, (chapter) =>
              createManuscriptChapter({
                ...chapter,
                title: command.title
              })
            )
          )
        })
      );
      break;
    case "chapter.update":
      books = updateBook(books, command.bookId, (book) =>
        createBook({
          ...updatePart(book, command.partId, (part) =>
            updateChapter(part, command.chapterId, (chapter) => {
              let updated: ManuscriptChapter = {
                ...chapter,
                title: command.title ?? chapter.title
              };
              if (command.summary !== undefined) {
                const { summary: _ignored, ...withoutSummary } = updated;
                updated =
                  command.summary === null
                    ? withoutSummary
                    : { ...withoutSummary, summary: command.summary };
              }
              return createManuscriptChapter(updated);
            })
          )
        })
      );
      break;
    case "chapter.reorder":
      books = updateBook(books, command.bookId, (book) =>
        createBook({
          ...updatePart(book, command.partId, (part) => ({
            ...part,
            chapters: reorderExactly(part.chapters, command.chapterIds, "Chapter")
          }))
        })
      );
      break;
    case "chapter.removeEmpty":
      books = updateBook(books, command.bookId, (book) =>
        createBook({
          ...updatePart(book, command.partId, (part) => {
            const target = part.chapters.find(
              (chapter) => chapter.id === command.chapterId
            );
            if (target === undefined) missing("Chapter", command.chapterId);
            if (target.sceneIds.length > 0) {
              throw new ProjectCommandError(
                "UNSAFE_REMOVAL",
                "Only a chapter with no scenes can be removed."
              );
            }
            return {
              ...part,
              chapters: part.chapters.filter(
                (chapter) => chapter.id !== command.chapterId
              )
            };
          })
        })
      );
      break;
    case "scene.create": {
      const id = sceneId(ids.create("scene"));
      scenes.push(
        createScene({
          id,
          projectId: project.id,
          bookId: command.bookId,
          title: command.title,
          status: "planned"
        })
      );
      books = placeScene(
        books,
        command.bookId,
        command.chapterId,
        id,
        command.position
      );
      break;
    }
    case "scene.update": {
      let updated: Scene = findScene(scenes, command.sceneId);
      updated = {
        ...updated,
        title: command.title ?? updated.title,
        status: command.status ?? updated.status
      };
      if (command.summary !== undefined) {
        const { summary: _ignored, ...withoutSummary } = updated;
        updated =
          command.summary === null
            ? withoutSummary
            : { ...withoutSummary, summary: command.summary };
      }
      if (command.povStoryKnowledgeId !== undefined) {
        const { povStoryKnowledgeId: _ignored, ...withoutPov } = updated;
        if (command.povStoryKnowledgeId === null) {
          updated = withoutPov;
        } else {
          const pov = findKnowledge(storyKnowledge, command.povStoryKnowledgeId);
          if (pov.archivedAt !== undefined) {
            throw new ProjectCommandError(
              "INVALID_PLACEMENT",
              "An archived story-knowledge record cannot be assigned as POV."
            );
          }
          updated = {
            ...withoutPov,
            povStoryKnowledgeId: command.povStoryKnowledgeId
          };
        }
      }
      if (command.backdrop !== undefined) {
        const { backdrop: _ignored, ...withoutBackdrop } = updated;
        updated =
          command.backdrop === null
            ? withoutBackdrop
            : { ...withoutBackdrop, backdrop: command.backdrop };
      }
      if (command.music !== undefined) {
        const { music: _ignored, ...withoutMusic } = updated;
        updated =
          command.music === null
            ? withoutMusic
            : { ...withoutMusic, music: command.music };
      }
      if (command.imageRefs !== undefined) {
        const { imageRefs: _ignored, ...withoutImageRefs } = updated;
        updated =
          command.imageRefs === null
            ? withoutImageRefs
            : { ...withoutImageRefs, imageRefs: command.imageRefs };
      }
      if (command.sketch !== undefined) {
        const { sketch: _ignored, ...withoutSketch } = updated;
        updated =
          command.sketch === null
            ? withoutSketch
            : { ...withoutSketch, sketch: command.sketch };
      }
      scenes = replaceScene(scenes, command.sceneId, createScene(updated));
      break;
    }
    case "scene.move": {
      const existing = findScene(scenes, command.sceneId);
      if (
        existing.bookId !== command.bookId &&
        records.editions.some((edition) =>
          edition.sceneRevisions.some((reference) => reference.sceneId === existing.id)
        )
      ) {
        throw new ProjectCommandError(
          "UNSAFE_REMOVAL",
          "A scene preserved by a named edition cannot move to another book."
        );
      }
      books = removeSceneFromManuscripts(books, command.sceneId);
      books = placeScene(
        books,
        command.bookId,
        command.chapterId,
        command.sceneId,
        command.position
      );
      scenes = replaceScene(
        scenes,
        command.sceneId,
        createScene({ ...existing, bookId: command.bookId })
      );
      break;
    }
    case "scene.setArchived": {
      const existing = findScene(scenes, command.sceneId);
      const archivedAt = updatedArchive(command.archived, now, existing.archivedAt);
      const { archivedAt: _ignored, ...activeScene } = existing;
      scenes = replaceScene(
        scenes,
        command.sceneId,
        createScene(
          archivedAt === undefined ? activeScene : { ...activeScene, archivedAt }
        )
      );
      break;
    }
    case "storyKnowledge.create":
      storyKnowledge.push(
        createStoryKnowledge({
          id: storyKnowledgeId(ids.create("storyKnowledge")),
          projectId: project.id,
          label: command.label,
          kind: command.kind,
          authority: command.authority,
          linkedSceneIds: [],
          linkedKnowledge: []
        })
      );
      break;
    case "storyKnowledge.update": {
      const existing = findKnowledge(storyKnowledge, command.storyKnowledgeId);
      let updatedFields: StoryKnowledge = {
        ...existing,
        label: command.label ?? existing.label,
        kind: command.kind ?? existing.kind,
        authority: command.authority ?? existing.authority
      };
      if (command.notes !== undefined) {
        const { notes: _ignored, ...withoutNotes } = updatedFields;
        updatedFields =
          command.notes === null
            ? withoutNotes
            : { ...withoutNotes, notes: command.notes };
      }
      if (command.aliases !== undefined) {
        const { aliases: _ignored, ...withoutAliases } = updatedFields;
        updatedFields =
          command.aliases === null
            ? withoutAliases
            : { ...withoutAliases, aliases: command.aliases };
      }
      if (command.characterSheet !== undefined) {
        const { characterSheet: _ignored, ...withoutSheet } = updatedFields;
        updatedFields =
          command.characterSheet === null
            ? withoutSheet
            : { ...withoutSheet, characterSheet: command.characterSheet };
      }
      const updated = createStoryKnowledge(updatedFields);
      storyKnowledge = storyKnowledge.map((record) =>
        record.id === updated.id ? updated : record
      );
      break;
    }
    case "storyKnowledge.setSceneLink": {
      const scene = findScene(scenes, command.sceneId);
      if (command.linked && scene.archivedAt !== undefined) {
        throw new ProjectCommandError(
          "INVALID_PLACEMENT",
          "Restore the scene before linking story knowledge to it."
        );
      }
      const existing = findKnowledge(storyKnowledge, command.storyKnowledgeId);
      const linked = existing.linkedSceneIds.includes(command.sceneId);
      const linkedSceneIds =
        command.linked && !linked
          ? [...existing.linkedSceneIds, command.sceneId]
          : !command.linked && linked
            ? existing.linkedSceneIds.filter((id) => id !== command.sceneId)
            : existing.linkedSceneIds;
      const updated = createStoryKnowledge({ ...existing, linkedSceneIds });
      storyKnowledge = storyKnowledge.map((record) =>
        record.id === updated.id ? updated : record
      );
      break;
    }
    case "storyKnowledge.setKnowledgeLink": {
      if (command.fromId === command.toId) {
        throw new ProjectCommandError(
          "INVALID_PLACEMENT",
          "Story knowledge cannot link to itself."
        );
      }
      const existing = findKnowledge(storyKnowledge, command.fromId);
      const target = findKnowledge(storyKnowledge, command.toId);
      if (command.linked && target.archivedAt !== undefined) {
        throw new ProjectCommandError(
          "INVALID_PLACEMENT",
          "Restore the story-knowledge record before linking to it."
        );
      }
      const alreadyLinked = existing.linkedKnowledge.some(
        (link) => link.toId === command.toId && link.kind === command.kind
      );
      const linkedKnowledge =
        command.linked && !alreadyLinked
          ? [...existing.linkedKnowledge, { toId: command.toId, kind: command.kind }]
          : !command.linked && alreadyLinked
            ? existing.linkedKnowledge.filter(
                (link) => !(link.toId === command.toId && link.kind === command.kind)
              )
            : existing.linkedKnowledge;
      const updated = createStoryKnowledge({ ...existing, linkedKnowledge });
      storyKnowledge = storyKnowledge.map((record) =>
        record.id === updated.id ? updated : record
      );
      break;
    }
    case "storyKnowledge.setArchived": {
      const existing = findKnowledge(storyKnowledge, command.storyKnowledgeId);
      if (
        command.archived &&
        scenes.some((scene) => scene.povStoryKnowledgeId === existing.id)
      ) {
        throw new ProjectCommandError(
          "UNSAFE_REMOVAL",
          "Story knowledge used as a scene POV must be unassigned before archiving."
        );
      }
      const archivedAt = updatedArchive(command.archived, now, existing.archivedAt);
      const { archivedAt: _ignored, ...activeKnowledge } = existing;
      const updated = createStoryKnowledge(
        archivedAt === undefined
          ? activeKnowledge
          : { ...activeKnowledge, archivedAt }
      );
      storyKnowledge = storyKnowledge.map((record) =>
        record.id === updated.id ? updated : record
      );
      break;
    }
  }

  return defineProjectRecords({
    project: { ...project, version: records.project.version + 1 },
    books,
    scenes,
    storyKnowledge,
    editions: records.editions
  });
}

export function createProjectCommandServices(dependencies: {
  projects: ProjectRepository;
  ids: IdGenerator;
  clock: Clock;
}): ProjectCommandServices {
  return Object.freeze({
    async executeProjectCommand(
      input: ExecuteProjectCommandInput
    ): Promise<ProjectNavigator> {
      requireProjectOwner(
        input.projectId,
        await dependencies.projects.getProjectMembership(
          input.projectId,
          input.accountId
        )
      );
      const records = await loadRecords(dependencies.projects, input.projectId);
      if (records === undefined) {
        throw new ProjectVersionConflictError(input.projectId, input.expectedVersion);
      }
      if (records.project.version !== input.expectedVersion) {
        throw new ProjectVersionConflictError(input.projectId, input.expectedVersion);
      }

      const updated = applyProjectCommandToRecords(
        records,
        input.command,
        dependencies.ids,
        dependencies.clock.now()
      );
      await dependencies.projects.transaction((writer) => {
        writer.replaceProjectRecords(updated, input.expectedVersion);
      });
      return projectNavigatorFromRecords(updated);
    }
  });
}
