import {
  createBook,
  createBookEdition,
  createProject,
  createScene,
  createStoryKnowledge,
  DomainValidationError,
  bookId,
  chapterId,
  editionId,
  partId,
  projectId,
  revisionId,
  sceneId,
  storyKnowledgeId,
  validateProjectRecords,
  type Book,
  type BookEdition,
  type BookStatus,
  type Project,
  type ProjectId,
  type ProjectRecords,
  type Scene,
  type SceneStatus,
  type StoryKnowledge,
  type StoryKnowledgeAuthority,
  type StoryKnowledgeKind
} from "@ghostwriter/core";
import { asc, eq } from "drizzle-orm";
import type { ProjectRecordWriter, ProjectRepository } from "@ghostwriter/core";
import type { RepositoryDatabase } from "./client.js";
import {
  bookUnassignedScenes,
  books,
  editionSceneRevisions,
  editions,
  manuscriptChapterScenes,
  manuscriptChapters,
  manuscriptParts,
  projects,
  scenes,
  storyKnowledge,
  storyKnowledgeScenes
} from "./schema.js";

type WriteBuffer = {
  seenIds: Set<string>;
  projects: Project[];
  books: Book[];
  scenes: Scene[];
  storyKnowledge: StoryKnowledge[];
  editions: BookEdition[];
};

function emptyBuffer(): WriteBuffer {
  return {
    seenIds: new Set<string>(),
    projects: [],
    books: [],
    scenes: [],
    storyKnowledge: [],
    editions: []
  };
}

function claimIds(buffer: WriteBuffer, ids: readonly string[]): void {
  for (const id of ids) {
    if (buffer.seenIds.has(id)) {
      throw new DomainValidationError(
        "DUPLICATE_ID",
        `Cannot insert duplicate definition ID "${id}" in one transaction.`
      );
    }

    buffer.seenIds.add(id);
  }
}

function makeWriter(buffer: WriteBuffer): ProjectRecordWriter {
  return Object.freeze({
    insertProject(project: Project): void {
      const frozen = createProject(project);
      claimIds(buffer, [frozen.id]);
      buffer.projects.push(frozen);
    },
    insertBook(book: Book): void {
      const frozen = createBook(book);
      claimIds(buffer, [
        frozen.id,
        ...frozen.manuscript.parts.flatMap((part) => [
          part.id,
          ...part.chapters.map((chapter) => chapter.id)
        ])
      ]);
      buffer.books.push(frozen);
    },
    insertScene(scene: Scene): void {
      const frozen = createScene(scene);
      claimIds(buffer, [frozen.id]);
      buffer.scenes.push(frozen);
    },
    insertStoryKnowledge(knowledge: StoryKnowledge): void {
      const frozen = createStoryKnowledge(knowledge);
      claimIds(buffer, [frozen.id]);
      buffer.storyKnowledge.push(frozen);
    },
    insertEdition(edition: BookEdition): void {
      const frozen = createBookEdition(edition);
      claimIds(buffer, [frozen.id]);
      buffer.editions.push(frozen);
    }
  });
}

function bookPosition(buffer: WriteBuffer, book: Book): number {
  const owner = buffer.projects.find((project) => project.id === book.projectId);

  if (owner === undefined) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      `Cannot persist book "${book.id}" without its owning project in the same transaction.`
    );
  }

  return owner.bookIds.indexOf(book.id);
}

async function persistBuffer(exec: RepositoryDatabase, buffer: WriteBuffer): Promise<void> {
  if (buffer.projects.length > 0) {
    await exec.insert(projects).values(
      buffer.projects.map((project) => ({
        id: project.id,
        title: project.title,
        createdAt: project.createdAt
      }))
    );
  }

  if (buffer.books.length > 0) {
    await exec.insert(books).values(
      buffer.books.map((book) => ({
        id: book.id,
        projectId: book.projectId,
        position: bookPosition(buffer, book),
        title: book.title,
        status: book.status,
        createdAt: book.createdAt
      }))
    );
  }

  if (buffer.scenes.length > 0) {
    await exec.insert(scenes).values(
      buffer.scenes.map((scene) => ({
        id: scene.id,
        projectId: scene.projectId,
        bookId: scene.bookId,
        title: scene.title,
        status: scene.status,
        summary: scene.summary ?? null,
        povStoryKnowledgeId: scene.povStoryKnowledgeId ?? null
      }))
    );
  }

  const partRows: Array<typeof manuscriptParts.$inferInsert> = [];
  const chapterRows: Array<typeof manuscriptChapters.$inferInsert> = [];
  const chapterSceneRows: Array<typeof manuscriptChapterScenes.$inferInsert> = [];
  const unassignedRows: Array<typeof bookUnassignedScenes.$inferInsert> = [];

  for (const book of buffer.books) {
    book.manuscript.parts.forEach((part, partIndex) => {
      partRows.push({ id: part.id, bookId: book.id, position: partIndex, title: part.title });

      part.chapters.forEach((chapter, chapterIndex) => {
        chapterRows.push({
          id: chapter.id,
          partId: part.id,
          position: chapterIndex,
          title: chapter.title
        });

        chapter.sceneIds.forEach((sceneReference, sceneIndex) => {
          chapterSceneRows.push({
            chapterId: chapter.id,
            sceneId: sceneReference,
            position: sceneIndex
          });
        });
      });
    });

    book.manuscript.unassignedSceneIds.forEach((sceneReference, index) => {
      unassignedRows.push({ bookId: book.id, sceneId: sceneReference, position: index });
    });
  }

  if (partRows.length > 0) await exec.insert(manuscriptParts).values(partRows);
  if (chapterRows.length > 0) await exec.insert(manuscriptChapters).values(chapterRows);
  if (chapterSceneRows.length > 0) {
    await exec.insert(manuscriptChapterScenes).values(chapterSceneRows);
  }
  if (unassignedRows.length > 0) await exec.insert(bookUnassignedScenes).values(unassignedRows);

  if (buffer.storyKnowledge.length > 0) {
    await exec.insert(storyKnowledge).values(
      buffer.storyKnowledge.map((knowledge) => ({
        id: knowledge.id,
        projectId: knowledge.projectId,
        label: knowledge.label,
        kind: knowledge.kind,
        authority: knowledge.authority
      }))
    );
  }

  const knowledgeSceneRows: Array<typeof storyKnowledgeScenes.$inferInsert> = [];
  for (const knowledge of buffer.storyKnowledge) {
    knowledge.linkedSceneIds.forEach((sceneReference, index) => {
      knowledgeSceneRows.push({
        storyKnowledgeId: knowledge.id,
        sceneId: sceneReference,
        position: index
      });
    });
  }
  if (knowledgeSceneRows.length > 0) {
    await exec.insert(storyKnowledgeScenes).values(knowledgeSceneRows);
  }

  if (buffer.editions.length > 0) {
    await exec.insert(editions).values(
      buffer.editions.map((edition) => ({
        id: edition.id,
        projectId: edition.projectId,
        bookId: edition.bookId,
        name: edition.name,
        projectRevisionId: edition.projectRevisionId,
        createdAt: edition.createdAt
      }))
    );
  }

  const editionRefRows: Array<typeof editionSceneRevisions.$inferInsert> = [];
  for (const edition of buffer.editions) {
    edition.sceneRevisions.forEach((reference, index) => {
      editionRefRows.push({
        editionId: edition.id,
        sceneId: reference.sceneId,
        revisionId: reference.revisionId,
        position: index
      });
    });
  }
  if (editionRefRows.length > 0) {
    await exec.insert(editionSceneRevisions).values(editionRefRows);
  }
}

async function queryProject(
  exec: RepositoryDatabase,
  id: ProjectId
): Promise<Project | undefined> {
  const projectRows = await exec.select().from(projects).where(eq(projects.id, id)).limit(1);
  const row = projectRows[0];

  if (row === undefined) return undefined;

  const bookRows = await exec
    .select({ id: books.id })
    .from(books)
    .where(eq(books.projectId, id))
    .orderBy(asc(books.position));

  return createProject({
    id: projectId(row.id),
    title: row.title,
    bookIds: bookRows.map((book) => bookId(book.id)),
    createdAt: row.createdAt
  });
}

async function queryBooks(
  exec: RepositoryDatabase,
  id: ProjectId
): Promise<readonly Book[]> {
  const bookRows = await exec
    .select()
    .from(books)
    .where(eq(books.projectId, id))
    .orderBy(asc(books.position));
  const result: Book[] = [];

  for (const book of bookRows) {
    const partRows = await exec
      .select()
      .from(manuscriptParts)
      .where(eq(manuscriptParts.bookId, book.id))
      .orderBy(asc(manuscriptParts.position));
    const parts = [];

    for (const part of partRows) {
      const chapterRows = await exec
        .select()
        .from(manuscriptChapters)
        .where(eq(manuscriptChapters.partId, part.id))
        .orderBy(asc(manuscriptChapters.position));
      const chapters = [];

      for (const chapter of chapterRows) {
        const chapterSceneRows = await exec
          .select({ sceneId: manuscriptChapterScenes.sceneId })
          .from(manuscriptChapterScenes)
          .where(eq(manuscriptChapterScenes.chapterId, chapter.id))
          .orderBy(asc(manuscriptChapterScenes.position));

        chapters.push({
          id: chapterId(chapter.id),
          title: chapter.title,
          sceneIds: chapterSceneRows.map((entry) => sceneId(entry.sceneId))
        });
      }

      parts.push({ id: partId(part.id), title: part.title, chapters });
    }

    const unassignedRows = await exec
      .select({ sceneId: bookUnassignedScenes.sceneId })
      .from(bookUnassignedScenes)
      .where(eq(bookUnassignedScenes.bookId, book.id))
      .orderBy(asc(bookUnassignedScenes.position));

    result.push(
      createBook({
        id: bookId(book.id),
        projectId: projectId(book.projectId),
        title: book.title,
        status: book.status as BookStatus,
        manuscript: {
          parts,
          unassignedSceneIds: unassignedRows.map((entry) => sceneId(entry.sceneId))
        },
        createdAt: book.createdAt
      })
    );
  }

  return result;
}

async function queryScenes(
  exec: RepositoryDatabase,
  id: ProjectId
): Promise<readonly Scene[]> {
  const sceneRows = await exec.select().from(scenes).where(eq(scenes.projectId, id));

  return sceneRows.map((scene) =>
    createScene({
      id: sceneId(scene.id),
      projectId: projectId(scene.projectId),
      bookId: bookId(scene.bookId),
      title: scene.title,
      status: scene.status as SceneStatus,
      ...(scene.summary === null ? {} : { summary: scene.summary }),
      ...(scene.povStoryKnowledgeId === null
        ? {}
        : { povStoryKnowledgeId: storyKnowledgeId(scene.povStoryKnowledgeId) })
    })
  );
}

async function queryStoryKnowledge(
  exec: RepositoryDatabase,
  id: ProjectId
): Promise<readonly StoryKnowledge[]> {
  const knowledgeRows = await exec
    .select()
    .from(storyKnowledge)
    .where(eq(storyKnowledge.projectId, id));
  const result: StoryKnowledge[] = [];

  for (const knowledge of knowledgeRows) {
    const linkRows = await exec
      .select({ sceneId: storyKnowledgeScenes.sceneId })
      .from(storyKnowledgeScenes)
      .where(eq(storyKnowledgeScenes.storyKnowledgeId, knowledge.id))
      .orderBy(asc(storyKnowledgeScenes.position));

    result.push(
      createStoryKnowledge({
        id: storyKnowledgeId(knowledge.id),
        projectId: projectId(knowledge.projectId),
        label: knowledge.label,
        kind: knowledge.kind as StoryKnowledgeKind,
        authority: knowledge.authority as StoryKnowledgeAuthority,
        linkedSceneIds: linkRows.map((entry) => sceneId(entry.sceneId))
      })
    );
  }

  return result;
}

async function queryEditions(
  exec: RepositoryDatabase,
  id: ProjectId
): Promise<readonly BookEdition[]> {
  const editionRows = await exec.select().from(editions).where(eq(editions.projectId, id));
  const result: BookEdition[] = [];

  for (const edition of editionRows) {
    const refRows = await exec
      .select({ sceneId: editionSceneRevisions.sceneId, revisionId: editionSceneRevisions.revisionId })
      .from(editionSceneRevisions)
      .where(eq(editionSceneRevisions.editionId, edition.id))
      .orderBy(asc(editionSceneRevisions.position));

    result.push(
      createBookEdition({
        id: editionId(edition.id),
        projectId: projectId(edition.projectId),
        bookId: bookId(edition.bookId),
        name: edition.name,
        projectRevisionId: revisionId(edition.projectRevisionId),
        sceneRevisions: refRows.map((entry) => ({
          sceneId: sceneId(entry.sceneId),
          revisionId: revisionId(entry.revisionId)
        })),
        createdAt: edition.createdAt
      })
    );
  }

  return result;
}

async function loadProjectRecords(
  exec: RepositoryDatabase,
  id: ProjectId
): Promise<ProjectRecords | undefined> {
  const project = await queryProject(exec, id);

  if (project === undefined) return undefined;

  return {
    project,
    books: await queryBooks(exec, id),
    scenes: await queryScenes(exec, id),
    storyKnowledge: await queryStoryKnowledge(exec, id),
    editions: await queryEditions(exec, id)
  };
}

function affectedProjectIds(buffer: WriteBuffer): readonly ProjectId[] {
  const ids = new Set<ProjectId>();

  for (const project of buffer.projects) ids.add(project.id);
  for (const book of buffer.books) ids.add(book.projectId);
  for (const scene of buffer.scenes) ids.add(scene.projectId);
  for (const knowledge of buffer.storyKnowledge) ids.add(knowledge.projectId);
  for (const edition of buffer.editions) ids.add(edition.projectId);

  return [...ids];
}

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    if (typeof current === "object" && "code" in current) {
      const code = (current as { code: unknown }).code;
      if (typeof code === "string" && code.length > 0) return code;
    }

    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : undefined;
  }

  return undefined;
}

function mapPersistError(error: unknown): never {
  if (error instanceof DomainValidationError) throw error;

  const code = postgresErrorCode(error);

  if (code === "23505") {
    throw new DomainValidationError("DUPLICATE_ID", "A record with this ID already exists.");
  }

  if (code === "23503") {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "A record references another record that does not exist."
    );
  }

  throw error;
}

export function createPostgresProjectRepository(db: RepositoryDatabase): ProjectRepository {
  return Object.freeze({
    getProject(id: ProjectId): Promise<Project | undefined> {
      return queryProject(db, id);
    },
    listBooks(id: ProjectId): Promise<readonly Book[]> {
      return queryBooks(db, id);
    },
    listScenes(id: ProjectId): Promise<readonly Scene[]> {
      return queryScenes(db, id);
    },
    listStoryKnowledge(id: ProjectId): Promise<readonly StoryKnowledge[]> {
      return queryStoryKnowledge(db, id);
    },
    listEditions(id: ProjectId): Promise<readonly BookEdition[]> {
      return queryEditions(db, id);
    },
    async transaction<Result>(
      operation: (writer: ProjectRecordWriter) => Result | Promise<Result>
    ): Promise<Result> {
      const buffer = emptyBuffer();
      const result = await operation(makeWriter(buffer));

      try {
        await db.transaction(async (tx) => {
          const exec = tx as unknown as RepositoryDatabase;
          await persistBuffer(exec, buffer);

          for (const id of affectedProjectIds(buffer)) {
            const records = await loadProjectRecords(exec, id);
            if (records !== undefined) validateProjectRecords(records);
          }
        });
      } catch (error) {
        mapPersistError(error);
      }

      return result;
    }
  });
}
