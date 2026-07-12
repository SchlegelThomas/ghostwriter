type BrandedId<Name extends string> = string & { readonly __brand: Name };

export type ProjectId = BrandedId<"ProjectId">;
export type BookId = BrandedId<"BookId">;
export type PartId = BrandedId<"PartId">;
export type ChapterId = BrandedId<"ChapterId">;
export type SceneId = BrandedId<"SceneId">;
export type StoryKnowledgeId = BrandedId<"StoryKnowledgeId">;
export type EditionId = BrandedId<"EditionId">;
export type RevisionId = BrandedId<"RevisionId">;
export type SceneVariantId = BrandedId<"SceneVariantId">;
export type CanvasObjectId = BrandedId<"CanvasObjectId">;
export type CanvasLinkId = BrandedId<"CanvasLinkId">;
export type CanvasRevisionId = BrandedId<"CanvasRevisionId">;

export type DomainValidationCode =
  | "EMPTY_VALUE"
  | "DUPLICATE_ID"
  | "DUPLICATE_REFERENCE"
  | "UNKNOWN_REFERENCE"
  | "CROSS_PROJECT_REFERENCE"
  | "CROSS_BOOK_REFERENCE"
  | "INCOMPLETE_MANUSCRIPT"
  | "INVALID_VERSION";

export class DomainValidationError extends Error {
  readonly code: DomainValidationCode;

  constructor(code: DomainValidationCode, message: string) {
    super(message);
    this.name = "DomainValidationError";
    this.code = code;
  }
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", `${field} must not be empty.`);
  }

  return normalized;
}

function createId<Name extends string>(value: string, kind: Name): BrandedId<Name> {
  return requireText(value, `${kind} ID`) as BrandedId<Name>;
}

export function projectId(value: string): ProjectId {
  return createId(value, "ProjectId");
}

export function bookId(value: string): BookId {
  return createId(value, "BookId");
}

export function partId(value: string): PartId {
  return createId(value, "PartId");
}

export function chapterId(value: string): ChapterId {
  return createId(value, "ChapterId");
}

export function sceneId(value: string): SceneId {
  return createId(value, "SceneId");
}

export function storyKnowledgeId(value: string): StoryKnowledgeId {
  return createId(value, "StoryKnowledgeId");
}

export function editionId(value: string): EditionId {
  return createId(value, "EditionId");
}

export function revisionId(value: string): RevisionId {
  return createId(value, "RevisionId");
}

export function sceneVariantId(value: string): SceneVariantId {
  return createId(value, "SceneVariantId");
}

export function canvasObjectId(value: string): CanvasObjectId {
  return createId(value, "CanvasObjectId");
}

export function canvasLinkId(value: string): CanvasLinkId {
  return createId(value, "CanvasLinkId");
}

export function canvasRevisionId(value: string): CanvasRevisionId {
  return createId(value, "CanvasRevisionId");
}

function freezeList<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}

function assertUniqueReferences(values: readonly string[], label: string): void {
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      throw new DomainValidationError(
        "DUPLICATE_REFERENCE",
        `${label} contains duplicate reference "${value}".`
      );
    }

    seen.add(value);
  }
}

export type Project = Readonly<{
  id: ProjectId;
  title: string;
  bookIds: readonly BookId[];
  createdAt: string;
  version: number;
  archivedAt?: string;
}>;

export type ProjectInput = Omit<Project, "version"> &
  Readonly<{
    version?: number;
  }>;

export function createProject(input: ProjectInput): Project {
  if (input.bookIds.length === 0) {
    throw new DomainValidationError(
      "INCOMPLETE_MANUSCRIPT",
      "A story project must contain at least one book."
    );
  }

  assertUniqueReferences(input.bookIds, "Project books");
  const version = input.version ?? 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Project version must be a positive integer."
    );
  }
  const archivedAt =
    input.archivedAt === undefined
      ? undefined
      : requireText(input.archivedAt, "Project archive time");

  return Object.freeze({
    id: input.id,
    title: requireText(input.title, "Project title"),
    bookIds: freezeList(input.bookIds),
    createdAt: requireText(input.createdAt, "Project creation time"),
    version,
    ...(archivedAt === undefined ? {} : { archivedAt })
  });
}

export type BookStatus = "planned" | "drafting" | "revising" | "complete";

export type ManuscriptChapter = Readonly<{
  id: ChapterId;
  title: string;
  sceneIds: readonly SceneId[];
}>;

export function createManuscriptChapter(input: ManuscriptChapter): ManuscriptChapter {
  assertUniqueReferences(input.sceneIds, `Chapter "${input.id}" scenes`);

  return Object.freeze({
    id: input.id,
    title: requireText(input.title, "Chapter title"),
    sceneIds: freezeList(input.sceneIds)
  });
}

export type ManuscriptPart = Readonly<{
  id: PartId;
  title: string;
  chapters: readonly ManuscriptChapter[];
}>;

export function createManuscriptPart(input: ManuscriptPart): ManuscriptPart {
  assertUniqueReferences(
    input.chapters.map((chapter) => chapter.id),
    `Part "${input.id}" chapters`
  );

  return Object.freeze({
    id: input.id,
    title: requireText(input.title, "Part title"),
    chapters: freezeList(input.chapters.map(createManuscriptChapter))
  });
}

export type ManuscriptStructure = Readonly<{
  parts: readonly ManuscriptPart[];
  unassignedSceneIds: readonly SceneId[];
}>;

export function createManuscriptStructure(input: ManuscriptStructure): ManuscriptStructure {
  assertUniqueReferences(
    input.parts.map((part) => part.id),
    "Manuscript parts"
  );
  assertUniqueReferences(input.unassignedSceneIds, "Unassigned scenes");

  return Object.freeze({
    parts: freezeList(input.parts.map(createManuscriptPart)),
    unassignedSceneIds: freezeList(input.unassignedSceneIds)
  });
}

export type Book = Readonly<{
  id: BookId;
  projectId: ProjectId;
  title: string;
  status: BookStatus;
  manuscript: ManuscriptStructure;
  createdAt: string;
  archivedAt?: string;
}>;

export function createBook(input: Book): Book {
  const archivedAt =
    input.archivedAt === undefined
      ? undefined
      : requireText(input.archivedAt, "Book archive time");
  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    title: requireText(input.title, "Book title"),
    status: input.status,
    manuscript: createManuscriptStructure(input.manuscript),
    createdAt: requireText(input.createdAt, "Book creation time"),
    ...(archivedAt === undefined ? {} : { archivedAt })
  });
}

export type SceneStatus = "planned" | "drafting" | "revising" | "complete";

export type Scene = Readonly<{
  id: SceneId;
  projectId: ProjectId;
  bookId: BookId;
  title: string;
  status: SceneStatus;
  summary?: string;
  povStoryKnowledgeId?: StoryKnowledgeId;
  archivedAt?: string;
}>;

export function createScene(input: Scene): Scene {
  const summary =
    input.summary === undefined ? undefined : requireText(input.summary, "Scene summary");
  const archivedAt =
    input.archivedAt === undefined
      ? undefined
      : requireText(input.archivedAt, "Scene archive time");

  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    bookId: input.bookId,
    title: requireText(input.title, "Scene title"),
    status: input.status,
    ...(summary === undefined ? {} : { summary }),
    ...(input.povStoryKnowledgeId === undefined
      ? {}
      : { povStoryKnowledgeId: input.povStoryKnowledgeId }),
    ...(archivedAt === undefined ? {} : { archivedAt })
  });
}

export type StoryKnowledgeKind =
  | "character"
  | "location"
  | "world-rule"
  | "thread"
  | "custom";

export type StoryKnowledgeAuthority = "planned" | "confirmed" | "inferred" | "disputed";

export type StoryKnowledge = Readonly<{
  id: StoryKnowledgeId;
  projectId: ProjectId;
  label: string;
  kind: StoryKnowledgeKind;
  authority: StoryKnowledgeAuthority;
  linkedSceneIds: readonly SceneId[];
  archivedAt?: string;
}>;

export function createStoryKnowledge(input: StoryKnowledge): StoryKnowledge {
  assertUniqueReferences(input.linkedSceneIds, `Story knowledge "${input.id}" linked scenes`);
  const archivedAt =
    input.archivedAt === undefined
      ? undefined
      : requireText(input.archivedAt, "Story knowledge archive time");

  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    label: requireText(input.label, "Story knowledge label"),
    kind: input.kind,
    authority: input.authority,
    linkedSceneIds: freezeList(input.linkedSceneIds),
    ...(archivedAt === undefined ? {} : { archivedAt })
  });
}

export type SceneRevisionReference = Readonly<{
  sceneId: SceneId;
  revisionId: RevisionId;
}>;

export type BookEdition = Readonly<{
  id: EditionId;
  projectId: ProjectId;
  bookId: BookId;
  name: string;
  projectRevisionId: RevisionId;
  sceneRevisions: readonly SceneRevisionReference[];
  createdAt: string;
}>;

export function createBookEdition(input: BookEdition): BookEdition {
  if (input.sceneRevisions.length === 0) {
    throw new DomainValidationError(
      "INCOMPLETE_MANUSCRIPT",
      "A named edition must preserve at least one scene revision."
    );
  }

  assertUniqueReferences(
    input.sceneRevisions.map((reference) => reference.sceneId),
    `Edition "${input.id}" scenes`
  );

  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    bookId: input.bookId,
    name: requireText(input.name, "Edition name"),
    projectRevisionId: input.projectRevisionId,
    sceneRevisions: freezeList(
      input.sceneRevisions.map((reference) =>
        Object.freeze({
          sceneId: reference.sceneId,
          revisionId: reference.revisionId
        })
      )
    ),
    createdAt: requireText(input.createdAt, "Edition creation time")
  });
}

export type ProjectRecords = Readonly<{
  project: Project;
  books: readonly Book[];
  scenes: readonly Scene[];
  storyKnowledge: readonly StoryKnowledge[];
  editions: readonly BookEdition[];
}>;

export type ProjectRecordsInput = Omit<ProjectRecords, "project"> &
  Readonly<{ project: ProjectInput }>;

function assertUniqueIds(records: ProjectRecords): void {
  const entries: Array<readonly [string, string]> = [
    ["project", records.project.id],
    ...records.books.map((book) => ["book", book.id] as const),
    ...records.scenes.map((scene) => ["scene", scene.id] as const),
    ...records.storyKnowledge.map((knowledge) => ["story knowledge", knowledge.id] as const),
    ...records.editions.map((edition) => ["edition", edition.id] as const),
    ...records.books.flatMap((book) =>
      book.manuscript.parts.flatMap((part) => [
        ["part", part.id] as const,
        ...part.chapters.map((chapter) => ["chapter", chapter.id] as const)
      ])
    )
  ];
  const seen = new Map<string, string>();

  for (const [kind, id] of entries) {
    const previousKind = seen.get(id);

    if (previousKind !== undefined) {
      throw new DomainValidationError(
        "DUPLICATE_ID",
        `ID "${id}" is used by both ${previousKind} and ${kind} records.`
      );
    }

    seen.set(id, kind);
  }
}

function assertSameProject(actual: ProjectId, expected: ProjectId, label: string): void {
  if (actual !== expected) {
    throw new DomainValidationError(
      "CROSS_PROJECT_REFERENCE",
      `${label} belongs to project "${actual}", not "${expected}".`
    );
  }
}

function assertExactReferenceSet(
  expectedValues: readonly string[],
  actualValues: readonly string[],
  label: string
): void {
  assertUniqueReferences(expectedValues, label);
  assertUniqueReferences(actualValues, label);

  const expected = new Set(expectedValues);
  const actual = new Set(actualValues);
  const missing = expectedValues.find((value) => !actual.has(value));
  const extra = actualValues.find((value) => !expected.has(value));

  if (missing !== undefined || extra !== undefined) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      `${label} does not match its canonical records${
        missing === undefined ? "" : `; missing "${missing}"`
      }${extra === undefined ? "" : `; unknown "${extra}"`}.`
    );
  }
}

export function validateProjectRecords(records: ProjectRecords): void {
  assertUniqueIds(records);

  const { project } = records;
  const bookById = new Map(records.books.map((book) => [book.id, book]));
  const sceneById = new Map(records.scenes.map((scene) => [scene.id, scene]));
  const knowledgeById = new Map(
    records.storyKnowledge.map((knowledge) => [knowledge.id, knowledge])
  );

  assertExactReferenceSet(
    project.bookIds,
    records.books.map((book) => book.id),
    "Project books"
  );

  for (const book of records.books) {
    assertSameProject(book.projectId, project.id, `Book "${book.id}"`);

    const bookScenes = records.scenes.filter((scene) => scene.bookId === book.id);
    const scheduledSceneIds = book.manuscript.parts.flatMap((part) =>
      part.chapters.flatMap((chapter) => chapter.sceneIds)
    );
    const manuscriptSceneIds = [...scheduledSceneIds, ...book.manuscript.unassignedSceneIds];

    assertExactReferenceSet(
      bookScenes.map((scene) => scene.id),
      manuscriptSceneIds,
      `Book "${book.id}" manuscript scenes`
    );
  }

  for (const scene of records.scenes) {
    assertSameProject(scene.projectId, project.id, `Scene "${scene.id}"`);

    const book = bookById.get(scene.bookId);

    if (book === undefined) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        `Scene "${scene.id}" references unknown book "${scene.bookId}".`
      );
    }

    if (book.projectId !== scene.projectId) {
      throw new DomainValidationError(
        "CROSS_PROJECT_REFERENCE",
        `Scene "${scene.id}" and book "${book.id}" belong to different projects.`
      );
    }

    if (scene.povStoryKnowledgeId !== undefined) {
      const knowledge = knowledgeById.get(scene.povStoryKnowledgeId);

      if (knowledge === undefined) {
        throw new DomainValidationError(
          "UNKNOWN_REFERENCE",
          `Scene "${scene.id}" references unknown POV knowledge "${scene.povStoryKnowledgeId}".`
        );
      }
    }
  }

  for (const knowledge of records.storyKnowledge) {
    assertSameProject(knowledge.projectId, project.id, `Story knowledge "${knowledge.id}"`);

    for (const linkedSceneId of knowledge.linkedSceneIds) {
      if (!sceneById.has(linkedSceneId)) {
        throw new DomainValidationError(
          "UNKNOWN_REFERENCE",
          `Story knowledge "${knowledge.id}" references unknown scene "${linkedSceneId}".`
        );
      }
    }
  }

  for (const edition of records.editions) {
    assertSameProject(edition.projectId, project.id, `Edition "${edition.id}"`);

    const book = bookById.get(edition.bookId);

    if (book === undefined) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        `Edition "${edition.id}" references unknown book "${edition.bookId}".`
      );
    }

    for (const reference of edition.sceneRevisions) {
      const scene = sceneById.get(reference.sceneId);

      if (scene === undefined) {
        throw new DomainValidationError(
          "UNKNOWN_REFERENCE",
          `Edition "${edition.id}" references unknown scene "${reference.sceneId}".`
        );
      }

      if (scene.bookId !== edition.bookId) {
        throw new DomainValidationError(
          "CROSS_BOOK_REFERENCE",
          `Edition "${edition.id}" references scene "${scene.id}" from another book.`
        );
      }
    }
  }
}

export function defineProjectRecords(input: ProjectRecordsInput): ProjectRecords {
  const records = Object.freeze({
    project: createProject(input.project),
    books: freezeList(input.books.map(createBook)),
    scenes: freezeList(input.scenes.map(createScene)),
    storyKnowledge: freezeList(input.storyKnowledge.map(createStoryKnowledge)),
    editions: freezeList(input.editions.map(createBookEdition))
  });

  validateProjectRecords(records);
  return records;
}
