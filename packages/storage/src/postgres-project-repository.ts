import {
  createBook,
  createBookEdition,
  createProject,
  createProjectMembership,
  createScene,
  createStoryKnowledge,
  defineProjectRecords,
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
  accountId,
  type Book,
  type BookEdition,
  type BookStatus,
  type Project,
  type ProjectId,
  type ProjectRecords,
  type AccountId,
  type ProjectMembership,
  type ProjectRole,
  type Scene,
  type SceneStatus,
  type StoryKnowledge,
  type StoryKnowledgeAuthority,
  type StoryKnowledgeKind
} from "@ghostwriter/core";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  ProjectVersionConflictError,
  type ProjectRecordWriter,
  type ProjectRepository
} from "@ghostwriter/core";
import type { RepositoryDatabase } from "./client.js";
import {
  bookUnassignedScenes,
  books,
  editionSceneRevisions,
  editions,
  manuscriptChapterScenes,
  manuscriptChapters,
  manuscriptParts,
  projectMemberships,
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
  memberships: ProjectMembership[];
  replacements: Array<{
    records: ProjectRecords;
    expectedVersion: number;
  }>;
};

function emptyBuffer(): WriteBuffer {
  return {
    seenIds: new Set<string>(),
    projects: [],
    books: [],
    scenes: [],
    storyKnowledge: [],
    editions: [],
    memberships: [],
    replacements: []
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
    },
    insertProjectMembership(membership: ProjectMembership): void {
      buffer.memberships.push(createProjectMembership(membership));
    },
    replaceProjectRecords(records: ProjectRecords, expectedVersion: number): void {
      const frozen = defineProjectRecords(records);
      if (frozen.project.version !== expectedVersion + 1) {
        throw new DomainValidationError(
          "INVALID_VERSION",
          "A replacement project must increment its version exactly once."
        );
      }
      buffer.replacements.push({ records: frozen, expectedVersion });
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

async function persistBuffer(
  exec: RepositoryDatabase,
  buffer: WriteBuffer,
  options: Readonly<{ insertProjects?: boolean; insertMemberships?: boolean }> = {}
): Promise<void> {
  if (options.insertProjects !== false && buffer.projects.length > 0) {
    await exec.insert(projects).values(
      buffer.projects.map((project) => ({
        id: project.id,
        title: project.title,
        createdAt: project.createdAt,
        version: project.version,
        archivedAt: project.archivedAt ?? null
      }))
    );
  }

  if (options.insertMemberships !== false && buffer.memberships.length > 0) {
    await exec.insert(projectMemberships).values(
      buffer.memberships.map((membership) => ({
        projectId: membership.projectId,
        accountId: membership.accountId,
        role: membership.role,
        createdAt: membership.createdAt
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
        createdAt: book.createdAt,
        archivedAt: book.archivedAt ?? null
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
        povStoryKnowledgeId: scene.povStoryKnowledgeId ?? null,
        archivedAt: scene.archivedAt ?? null
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
        authority: knowledge.authority,
        archivedAt: knowledge.archivedAt ?? null
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

type ReplacementRows = Readonly<{
  bookRows: Array<typeof books.$inferInsert>;
  sceneRows: Array<typeof scenes.$inferInsert>;
  partRows: Array<typeof manuscriptParts.$inferInsert>;
  chapterRows: Array<typeof manuscriptChapters.$inferInsert>;
  chapterSceneRows: Array<typeof manuscriptChapterScenes.$inferInsert>;
  unassignedRows: Array<typeof bookUnassignedScenes.$inferInsert>;
  knowledgeRows: Array<typeof storyKnowledge.$inferInsert>;
  knowledgeSceneRows: Array<typeof storyKnowledgeScenes.$inferInsert>;
  editionRows: Array<typeof editions.$inferInsert>;
  editionRefRows: Array<typeof editionSceneRevisions.$inferInsert>;
}>;

type ExistingProjectRowIds = Readonly<{
  bookIds: string[];
  sceneIds: string[];
  partIds: string[];
  chapterIds: string[];
  knowledgeIds: string[];
  editionIds: string[];
}>;

function replacementRows(records: ProjectRecords): ReplacementRows {
  const bookRows: ReplacementRows["bookRows"] = [];
  const sceneRows: ReplacementRows["sceneRows"] = [];
  const partRows: ReplacementRows["partRows"] = [];
  const chapterRows: ReplacementRows["chapterRows"] = [];
  const chapterSceneRows: ReplacementRows["chapterSceneRows"] = [];
  const unassignedRows: ReplacementRows["unassignedRows"] = [];
  const knowledgeRows: ReplacementRows["knowledgeRows"] = [];
  const knowledgeSceneRows: ReplacementRows["knowledgeSceneRows"] = [];
  const editionRows: ReplacementRows["editionRows"] = [];
  const editionRefRows: ReplacementRows["editionRefRows"] = [];

  for (const book of records.books) {
    bookRows.push({
      id: book.id,
      projectId: book.projectId,
      position: records.project.bookIds.indexOf(book.id),
      title: book.title,
      status: book.status,
      createdAt: book.createdAt,
      archivedAt: book.archivedAt ?? null
    });

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

    book.manuscript.unassignedSceneIds.forEach((sceneReference, sceneIndex) => {
      unassignedRows.push({
        bookId: book.id,
        sceneId: sceneReference,
        position: sceneIndex
      });
    });
  }

  for (const scene of records.scenes) {
    sceneRows.push({
      id: scene.id,
      projectId: scene.projectId,
      bookId: scene.bookId,
      title: scene.title,
      status: scene.status,
      summary: scene.summary ?? null,
      povStoryKnowledgeId: scene.povStoryKnowledgeId ?? null,
      archivedAt: scene.archivedAt ?? null
    });
  }

  for (const knowledge of records.storyKnowledge) {
    knowledgeRows.push({
      id: knowledge.id,
      projectId: knowledge.projectId,
      label: knowledge.label,
      kind: knowledge.kind,
      authority: knowledge.authority,
      archivedAt: knowledge.archivedAt ?? null
    });

    knowledge.linkedSceneIds.forEach((sceneReference, sceneIndex) => {
      knowledgeSceneRows.push({
        storyKnowledgeId: knowledge.id,
        sceneId: sceneReference,
        position: sceneIndex
      });
    });
  }

  for (const edition of records.editions) {
    editionRows.push({
      id: edition.id,
      projectId: edition.projectId,
      bookId: edition.bookId,
      name: edition.name,
      projectRevisionId: edition.projectRevisionId,
      createdAt: edition.createdAt
    });

    edition.sceneRevisions.forEach((reference, referenceIndex) => {
      editionRefRows.push({
        editionId: edition.id,
        sceneId: reference.sceneId,
        revisionId: reference.revisionId,
        position: referenceIndex
      });
    });
  }

  return {
    bookRows,
    sceneRows,
    partRows,
    chapterRows,
    chapterSceneRows,
    unassignedRows,
    knowledgeRows,
    knowledgeSceneRows,
    editionRows,
    editionRefRows
  };
}

async function existingProjectRowIds(
  exec: RepositoryDatabase,
  id: ProjectId
): Promise<ExistingProjectRowIds> {
  const bookRows = await exec
    .select({ id: books.id })
    .from(books)
    .where(eq(books.projectId, id));
  const bookIds = bookRows.map((row) => row.id);
  const sceneRows = await exec
    .select({ id: scenes.id })
    .from(scenes)
    .where(eq(scenes.projectId, id));
  const knowledgeRows = await exec
    .select({ id: storyKnowledge.id })
    .from(storyKnowledge)
    .where(eq(storyKnowledge.projectId, id));
  const editionRows = await exec
    .select({ id: editions.id })
    .from(editions)
    .where(eq(editions.projectId, id));
  const partRows =
    bookIds.length === 0
      ? []
      : await exec
          .select({ id: manuscriptParts.id })
          .from(manuscriptParts)
          .where(inArray(manuscriptParts.bookId, bookIds));
  const partIds = partRows.map((row) => row.id);
  const chapterRows =
    partIds.length === 0
      ? []
      : await exec
          .select({ id: manuscriptChapters.id })
          .from(manuscriptChapters)
          .where(inArray(manuscriptChapters.partId, partIds));

  return {
    bookIds,
    sceneIds: sceneRows.map((row) => row.id),
    partIds,
    chapterIds: chapterRows.map((row) => row.id),
    knowledgeIds: knowledgeRows.map((row) => row.id),
    editionIds: editionRows.map((row) => row.id)
  };
}

async function clearReplacementLinks(
  exec: RepositoryDatabase,
  existing: ExistingProjectRowIds
): Promise<void> {
  if (existing.chapterIds.length > 0) {
    await exec
      .delete(manuscriptChapterScenes)
      .where(inArray(manuscriptChapterScenes.chapterId, existing.chapterIds));
  }
  if (existing.bookIds.length > 0) {
    await exec
      .delete(bookUnassignedScenes)
      .where(inArray(bookUnassignedScenes.bookId, existing.bookIds));
  }
  if (existing.knowledgeIds.length > 0) {
    await exec
      .delete(storyKnowledgeScenes)
      .where(inArray(storyKnowledgeScenes.storyKnowledgeId, existing.knowledgeIds));
  }
  if (existing.editionIds.length > 0) {
    await exec
      .delete(editionSceneRevisions)
      .where(inArray(editionSceneRevisions.editionId, existing.editionIds));
  }
}

async function persistStableReplacementRows(
  exec: RepositoryDatabase,
  rows: ReplacementRows,
  existing: ExistingProjectRowIds
): Promise<void> {
  const existingBookIds = new Set(existing.bookIds);
  for (const row of rows.bookRows) {
    if (existingBookIds.has(row.id)) {
      await exec
        .update(books)
        .set({
          projectId: row.projectId,
          position: row.position,
          title: row.title,
          status: row.status,
          createdAt: row.createdAt,
          archivedAt: row.archivedAt
        })
        .where(eq(books.id, row.id));
    } else {
      await exec.insert(books).values(row);
    }
  }

  const existingKnowledgeIds = new Set(existing.knowledgeIds);
  for (const row of rows.knowledgeRows) {
    if (existingKnowledgeIds.has(row.id)) {
      await exec
        .update(storyKnowledge)
        .set({
          projectId: row.projectId,
          label: row.label,
          kind: row.kind,
          authority: row.authority,
          archivedAt: row.archivedAt
        })
        .where(eq(storyKnowledge.id, row.id));
    } else {
      await exec.insert(storyKnowledge).values(row);
    }
  }

  const existingSceneIds = new Set(existing.sceneIds);
  for (const row of rows.sceneRows) {
    if (existingSceneIds.has(row.id)) {
      await exec
        .update(scenes)
        .set({
          projectId: row.projectId,
          bookId: row.bookId,
          title: row.title,
          status: row.status,
          summary: row.summary,
          povStoryKnowledgeId: row.povStoryKnowledgeId,
          archivedAt: row.archivedAt
        })
        .where(eq(scenes.id, row.id));
    } else {
      await exec.insert(scenes).values(row);
    }
  }

  const existingPartIds = new Set(existing.partIds);
  for (const row of rows.partRows) {
    if (existingPartIds.has(row.id)) {
      await exec
        .update(manuscriptParts)
        .set({
          bookId: row.bookId,
          position: row.position,
          title: row.title
        })
        .where(eq(manuscriptParts.id, row.id));
    } else {
      await exec.insert(manuscriptParts).values(row);
    }
  }

  const existingChapterIds = new Set(existing.chapterIds);
  for (const row of rows.chapterRows) {
    if (existingChapterIds.has(row.id)) {
      await exec
        .update(manuscriptChapters)
        .set({
          partId: row.partId,
          position: row.position,
          title: row.title
        })
        .where(eq(manuscriptChapters.id, row.id));
    } else {
      await exec.insert(manuscriptChapters).values(row);
    }
  }

  const existingEditionIds = new Set(existing.editionIds);
  for (const row of rows.editionRows) {
    if (existingEditionIds.has(row.id)) {
      await exec
        .update(editions)
        .set({
          projectId: row.projectId,
          bookId: row.bookId,
          name: row.name,
          projectRevisionId: row.projectRevisionId,
          createdAt: row.createdAt
        })
        .where(eq(editions.id, row.id));
    } else {
      await exec.insert(editions).values(row);
    }
  }
}

function removedIds(
  existingIds: readonly string[],
  desiredRows: readonly Readonly<{ id: string }>[]
): string[] {
  const desiredIds = new Set(desiredRows.map((row) => row.id));
  return existingIds.filter((id) => !desiredIds.has(id));
}

async function removeMissingReplacementRows(
  exec: RepositoryDatabase,
  project: Project,
  rows: ReplacementRows,
  existing: ExistingProjectRowIds
): Promise<void> {
  const removedEditionIds = removedIds(existing.editionIds, rows.editionRows);
  const removedChapterIds = removedIds(existing.chapterIds, rows.chapterRows);
  const removedPartIds = removedIds(existing.partIds, rows.partRows);
  const removedSceneIds = removedIds(existing.sceneIds, rows.sceneRows);
  const removedKnowledgeIds = removedIds(existing.knowledgeIds, rows.knowledgeRows);
  const removedBookIds = removedIds(existing.bookIds, rows.bookRows);

  if (removedEditionIds.length > 0) {
    await exec
      .delete(editions)
      .where(
        and(
          eq(editions.projectId, project.id),
          inArray(editions.id, removedEditionIds)
        )
      );
  }
  if (removedChapterIds.length > 0) {
    await exec
      .delete(manuscriptChapters)
      .where(inArray(manuscriptChapters.id, removedChapterIds));
  }
  if (removedPartIds.length > 0) {
    await exec
      .delete(manuscriptParts)
      .where(inArray(manuscriptParts.id, removedPartIds));
  }
  if (removedSceneIds.length > 0) {
    await exec
      .delete(scenes)
      .where(
        and(eq(scenes.projectId, project.id), inArray(scenes.id, removedSceneIds))
      );
  }
  if (removedKnowledgeIds.length > 0) {
    await exec
      .delete(storyKnowledge)
      .where(
        and(
          eq(storyKnowledge.projectId, project.id),
          inArray(storyKnowledge.id, removedKnowledgeIds)
        )
      );
  }
  if (removedBookIds.length > 0) {
    await exec
      .delete(books)
      .where(
        and(eq(books.projectId, project.id), inArray(books.id, removedBookIds))
      );
  }
}

async function insertReplacementLinks(
  exec: RepositoryDatabase,
  rows: ReplacementRows
): Promise<void> {
  if (rows.chapterSceneRows.length > 0) {
    await exec.insert(manuscriptChapterScenes).values(rows.chapterSceneRows);
  }
  if (rows.unassignedRows.length > 0) {
    await exec.insert(bookUnassignedScenes).values(rows.unassignedRows);
  }
  if (rows.knowledgeSceneRows.length > 0) {
    await exec.insert(storyKnowledgeScenes).values(rows.knowledgeSceneRows);
  }
  if (rows.editionRefRows.length > 0) {
    await exec.insert(editionSceneRevisions).values(rows.editionRefRows);
  }
}

async function persistReplacements(
  exec: RepositoryDatabase,
  replacements: WriteBuffer["replacements"]
): Promise<void> {
  for (const replacement of replacements) {
    const { records, expectedVersion } = replacement;
    const [updated] = await exec
      .update(projects)
      .set({
        title: records.project.title,
        createdAt: records.project.createdAt,
        version: records.project.version,
        archivedAt: records.project.archivedAt ?? null
      })
      .where(
        and(
          eq(projects.id, records.project.id),
          eq(projects.version, expectedVersion)
        )
      )
      .returning({ id: projects.id });

    if (updated === undefined) {
      throw new ProjectVersionConflictError(records.project.id, expectedVersion);
    }

    const rows = replacementRows(records);
    const existing = await existingProjectRowIds(exec, records.project.id);
    await clearReplacementLinks(exec, existing);
    await persistStableReplacementRows(exec, rows, existing);
    await removeMissingReplacementRows(exec, records.project, rows, existing);
    await insertReplacementLinks(exec, rows);
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
    createdAt: row.createdAt,
    version: row.version,
    ...(row.archivedAt === null ? {} : { archivedAt: row.archivedAt })
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
        createdAt: book.createdAt,
        ...(book.archivedAt === null ? {} : { archivedAt: book.archivedAt })
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
        : { povStoryKnowledgeId: storyKnowledgeId(scene.povStoryKnowledgeId) }),
      ...(scene.archivedAt === null ? {} : { archivedAt: scene.archivedAt })
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
        linkedSceneIds: linkRows.map((entry) => sceneId(entry.sceneId)),
        ...(knowledge.archivedAt === null
          ? {}
          : { archivedAt: knowledge.archivedAt })
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
  for (const membership of buffer.memberships) ids.add(membership.projectId);
  for (const replacement of buffer.replacements) ids.add(replacement.records.project.id);

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
  if (
    error instanceof DomainValidationError ||
    error instanceof ProjectVersionConflictError
  ) {
    throw error;
  }

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
    async getProjectMembership(
      id: ProjectId,
      idOfAccount: AccountId
    ): Promise<ProjectMembership | undefined> {
      const [row] = await db
        .select()
        .from(projectMemberships)
        .where(
          and(
            eq(projectMemberships.projectId, id),
            eq(projectMemberships.accountId, idOfAccount)
          )
        )
        .limit(1);
      return row === undefined
        ? undefined
        : createProjectMembership({
            projectId: projectId(row.projectId),
            accountId: accountId(row.accountId),
            role: row.role as ProjectRole,
            createdAt: row.createdAt
          });
    },
    async listProjectsForAccount(
      idOfAccount: AccountId,
      options: Readonly<{ includeArchived?: boolean }> = {}
    ): Promise<readonly Project[]> {
      const conditions = [eq(projectMemberships.accountId, idOfAccount)];
      if (options.includeArchived !== true) conditions.push(isNull(projects.archivedAt));
      const rows = await db
        .select({ id: projects.id })
        .from(projectMemberships)
        .innerJoin(projects, eq(projectMemberships.projectId, projects.id))
        .where(and(...conditions))
        .orderBy(asc(projects.createdAt));
      const ownedProjects = await Promise.all(
        rows.map((row) => queryProject(db, projectId(row.id)))
      );
      return ownedProjects.filter((project): project is Project => project !== undefined);
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
          await persistReplacements(exec, buffer.replacements);

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
