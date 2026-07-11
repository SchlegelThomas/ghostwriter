import {
  bookId,
  createBook,
  createProject,
  projectId,
  type ProjectId,
  type ProjectRecords
} from "./domain.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";
import {
  projectNavigatorFromRecords,
  type ProjectNavigator
} from "./project-navigator.js";

export type CreateStoryProjectInput = Readonly<{
  title: string;
  firstBookTitle: string;
}>;

export type GhostwriterServices = Readonly<{
  createStoryProject(input: CreateStoryProjectInput): Promise<ProjectId>;
  getProjectNavigator(id: ProjectId): Promise<ProjectNavigator | undefined>;
}>;

export type GhostwriterServiceDependencies = Readonly<{
  projects: ProjectRepository;
  ids: IdGenerator;
  clock: Clock;
}>;

async function loadProjectRecords(
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

  return {
    project,
    books,
    scenes,
    storyKnowledge,
    editions
  };
}

export function createGhostwriterServices(
  dependencies: GhostwriterServiceDependencies
): GhostwriterServices {
  const { projects, ids, clock } = dependencies;

  return Object.freeze({
    async createStoryProject(input: CreateStoryProjectInput): Promise<ProjectId> {
      const newProjectId = projectId(ids.create("project"));
      const firstBookId = bookId(ids.create("book"));
      const createdAt = clock.now();
      const project = createProject({
        id: newProjectId,
        title: input.title,
        bookIds: [firstBookId],
        createdAt
      });
      const book = createBook({
        id: firstBookId,
        projectId: newProjectId,
        title: input.firstBookTitle,
        status: "planned",
        manuscript: { parts: [], unassignedSceneIds: [] },
        createdAt
      });

      await projects.transaction((writer) => {
        writer.insertProject(project);
        writer.insertBook(book);
      });

      return newProjectId;
    },
    async getProjectNavigator(id: ProjectId): Promise<ProjectNavigator | undefined> {
      const records = await loadProjectRecords(projects, id);
      return records === undefined ? undefined : projectNavigatorFromRecords(records);
    }
  });
}
