import {
  createBook,
  createBookEdition,
  createProject,
  createScene,
  createStoryKnowledge,
  DomainValidationError,
  type Book,
  type BookEdition,
  type Project,
  type ProjectId,
  type ProjectRecords,
  type Scene,
  type StoryKnowledge,
  validateProjectRecords
} from "./domain.js";
import {
  createProjectMembership,
  type AccountId,
  type ProjectMembership
} from "./identity.js";
import {
  ProjectVersionConflictError,
  type ProjectRecordWriter,
  type ProjectRepository
} from "./project-repository.js";

type MemoryState = {
  projects: Map<string, Project>;
  books: Map<string, Book>;
  scenes: Map<string, Scene>;
  storyKnowledge: Map<string, StoryKnowledge>;
  editions: Map<string, BookEdition>;
  memberships: Map<string, ProjectMembership>;
};

function emptyState(): MemoryState {
  return {
    projects: new Map(),
    books: new Map(),
    scenes: new Map(),
    storyKnowledge: new Map(),
    editions: new Map(),
    memberships: new Map()
  };
}

function cloneState(state: MemoryState): MemoryState {
  return {
    projects: new Map(
      [...state.projects].map(([id, project]) => [id, createProject(project)])
    ),
    books: new Map([...state.books].map(([id, book]) => [id, createBook(book)])),
    scenes: new Map([...state.scenes].map(([id, scene]) => [id, createScene(scene)])),
    storyKnowledge: new Map(
      [...state.storyKnowledge].map(([id, knowledge]) => [
        id,
        createStoryKnowledge(knowledge)
      ])
    ),
    editions: new Map(
      [...state.editions].map(([id, edition]) => [id, createBookEdition(edition)])
    ),
    memberships: new Map(
      [...state.memberships].map(([key, membership]) => [
        key,
        createProjectMembership(membership)
      ])
    )
  };
}

function definitionIds(state: MemoryState): readonly string[] {
  return [
    ...state.projects.keys(),
    ...[...state.books.values()].flatMap((book) => [
      book.id,
      ...book.manuscript.parts.flatMap((part) => [
        part.id,
        ...part.chapters.map((chapter) => chapter.id)
      ])
    ]),
    ...state.scenes.keys(),
    ...state.storyKnowledge.keys(),
    ...state.editions.keys()
  ];
}

function assertGloballyUniqueDefinitions(state: MemoryState): void {
  const seen = new Set<string>();

  for (const id of definitionIds(state)) {
    if (seen.has(id)) {
      throw new DomainValidationError(
        "DUPLICATE_ID",
        `Memory repository contains duplicate definition ID "${id}".`
      );
    }

    seen.add(id);
  }
}

function recordsForProject(state: MemoryState, project: Project): ProjectRecords {
  return {
    project,
    books: [...state.books.values()].filter((book) => book.projectId === project.id),
    scenes: [...state.scenes.values()].filter((scene) => scene.projectId === project.id),
    storyKnowledge: [...state.storyKnowledge.values()].filter(
      (knowledge) => knowledge.projectId === project.id
    ),
    editions: [...state.editions.values()].filter(
      (edition) => edition.projectId === project.id
    )
  };
}

function validateState(state: MemoryState): void {
  assertGloballyUniqueDefinitions(state);

  for (const book of state.books.values()) {
    if (!state.projects.has(book.projectId)) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        `Book "${book.id}" references unknown project "${book.projectId}".`
      );
    }
  }

  for (const scene of state.scenes.values()) {
    if (!state.projects.has(scene.projectId)) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        `Scene "${scene.id}" references unknown project "${scene.projectId}".`
      );
    }
  }

  for (const knowledge of state.storyKnowledge.values()) {
    if (!state.projects.has(knowledge.projectId)) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        `Story knowledge "${knowledge.id}" references unknown project "${knowledge.projectId}".`
      );
    }
  }

  for (const edition of state.editions.values()) {
    if (!state.projects.has(edition.projectId)) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        `Edition "${edition.id}" references unknown project "${edition.projectId}".`
      );
    }
  }

  for (const membership of state.memberships.values()) {
    if (!state.projects.has(membership.projectId)) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        `Membership references unknown project "${membership.projectId}".`
      );
    }
  }

  for (const project of state.projects.values()) {
    validateProjectRecords(recordsForProject(state, project));
  }
}

function assertNewDefinitionIds(state: MemoryState, ids: readonly string[]): void {
  const existingIds = new Set(definitionIds(state));
  const candidateIds = new Set<string>();

  for (const id of ids) {
    if (existingIds.has(id) || candidateIds.has(id)) {
      throw new DomainValidationError(
        "DUPLICATE_ID",
        `Cannot insert duplicate definition ID "${id}".`
      );
    }

    candidateIds.add(id);
  }
}

function writerFor(state: MemoryState): ProjectRecordWriter {
  return Object.freeze({
    insertProject(project: Project): void {
      assertNewDefinitionIds(state, [project.id]);
      state.projects.set(project.id, createProject(project));
    },
    insertBook(book: Book): void {
      const structureIds = book.manuscript.parts.flatMap((part) => [
        part.id,
        ...part.chapters.map((chapter) => chapter.id)
      ]);
      assertNewDefinitionIds(state, [book.id, ...structureIds]);
      state.books.set(book.id, createBook(book));
    },
    insertScene(scene: Scene): void {
      assertNewDefinitionIds(state, [scene.id]);
      state.scenes.set(scene.id, createScene(scene));
    },
    insertStoryKnowledge(knowledge: StoryKnowledge): void {
      assertNewDefinitionIds(state, [knowledge.id]);
      state.storyKnowledge.set(knowledge.id, createStoryKnowledge(knowledge));
    },
    insertEdition(edition: BookEdition): void {
      assertNewDefinitionIds(state, [edition.id]);
      state.editions.set(edition.id, createBookEdition(edition));
    },
    insertProjectMembership(membership: ProjectMembership): void {
      const frozen = createProjectMembership(membership);
      const key = `${frozen.projectId}:${frozen.accountId}`;
      if (state.memberships.has(key)) {
        throw new DomainValidationError(
          "DUPLICATE_REFERENCE",
          `Project membership already exists for "${frozen.accountId}".`
        );
      }
      state.memberships.set(key, frozen);
    },
    replaceProjectRecords(records: ProjectRecords, expectedVersion: number): void {
      validateProjectRecords(records);
      const current = state.projects.get(records.project.id);
      if (current === undefined || current.version !== expectedVersion) {
        throw new ProjectVersionConflictError(records.project.id, expectedVersion);
      }
      if (records.project.version !== expectedVersion + 1) {
        throw new DomainValidationError(
          "INVALID_VERSION",
          "A replacement project must increment its version exactly once."
        );
      }

      for (const [id, book] of state.books) {
        if (book.projectId === records.project.id) state.books.delete(id);
      }
      for (const [id, scene] of state.scenes) {
        if (scene.projectId === records.project.id) state.scenes.delete(id);
      }
      for (const [id, knowledge] of state.storyKnowledge) {
        if (knowledge.projectId === records.project.id) {
          state.storyKnowledge.delete(id);
        }
      }
      for (const [id, edition] of state.editions) {
        if (edition.projectId === records.project.id) state.editions.delete(id);
      }

      state.projects.set(records.project.id, createProject(records.project));
      for (const book of records.books) state.books.set(book.id, createBook(book));
      for (const scene of records.scenes) state.scenes.set(scene.id, createScene(scene));
      for (const knowledge of records.storyKnowledge) {
        state.storyKnowledge.set(knowledge.id, createStoryKnowledge(knowledge));
      }
      for (const edition of records.editions) {
        state.editions.set(edition.id, createBookEdition(edition));
      }
    }
  });
}

function addSeed(state: MemoryState, records: ProjectRecords): void {
  validateProjectRecords(records);
  const writer = writerFor(state);

  writer.insertProject(records.project);
  for (const book of records.books) writer.insertBook(book);
  for (const scene of records.scenes) writer.insertScene(scene);
  for (const knowledge of records.storyKnowledge) writer.insertStoryKnowledge(knowledge);
  for (const edition of records.editions) writer.insertEdition(edition);
}

export function createMemoryProjectRepository(
  seeds: readonly ProjectRecords[] = [],
  membershipSeeds: readonly ProjectMembership[] = []
): ProjectRepository {
  let state = emptyState();
  let transactionTail: Promise<void> = Promise.resolve();

  for (const records of seeds) addSeed(state, records);
  for (const membership of membershipSeeds) {
    writerFor(state).insertProjectMembership(membership);
  }
  validateState(state);

  return Object.freeze({
    async getProject(id: ProjectId): Promise<Project | undefined> {
      const project = state.projects.get(id);
      return project === undefined ? undefined : createProject(project);
    },
    async listBooks(projectId: ProjectId): Promise<readonly Book[]> {
      return [...state.books.values()]
        .filter((book) => book.projectId === projectId)
        .map(createBook);
    },
    async listScenes(projectId: ProjectId): Promise<readonly Scene[]> {
      return [...state.scenes.values()]
        .filter((scene) => scene.projectId === projectId)
        .map(createScene);
    },
    async listStoryKnowledge(projectId: ProjectId): Promise<readonly StoryKnowledge[]> {
      return [...state.storyKnowledge.values()]
        .filter((knowledge) => knowledge.projectId === projectId)
        .map(createStoryKnowledge);
    },
    async listEditions(projectId: ProjectId): Promise<readonly BookEdition[]> {
      return [...state.editions.values()]
        .filter((edition) => edition.projectId === projectId)
        .map(createBookEdition);
    },
    async getProjectMembership(
      projectId: ProjectId,
      accountId: AccountId
    ): Promise<ProjectMembership | undefined> {
      const membership = state.memberships.get(`${projectId}:${accountId}`);
      return membership === undefined
        ? undefined
        : createProjectMembership(membership);
    },
    async listProjectsForAccount(
      accountId: AccountId,
      options: Readonly<{ includeArchived?: boolean }> = {}
    ): Promise<readonly Project[]> {
      const projectIds = new Set(
        [...state.memberships.values()]
          .filter((membership) => membership.accountId === accountId)
          .map((membership) => membership.projectId)
      );
      return [...state.projects.values()]
        .filter(
          (project) =>
            projectIds.has(project.id) &&
            (options.includeArchived === true || project.archivedAt === undefined)
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(createProject);
    },
    async transaction<Result>(
      operation: (writer: ProjectRecordWriter) => Result | Promise<Result>
    ): Promise<Result> {
      const previousTransaction = transactionTail;
      let releaseTransaction = (): void => undefined;
      transactionTail = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
      });

      await previousTransaction;

      try {
        const draft = cloneState(state);
        const result = await operation(writerFor(draft));
        validateState(draft);
        state = draft;
        return result;
      } finally {
        releaseTransaction();
      }
    }
  });
}
