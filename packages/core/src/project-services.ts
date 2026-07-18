import {
  bookId,
  createBook,
  createProject,
  projectId,
  type ProjectId,
  type ProjectRecords
} from "./domain.js";
import {
  createProjectMembership,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";
import {
  createProjectCommandServices,
  type ProjectCommandServices
} from "./project-commands.js";
import {
  projectNavigatorFromRecords,
  type ProjectNavigator
} from "./project-navigator.js";

export type CreateStoryProjectInput = Readonly<{
  ownerAccountId: AccountId;
  title: string;
  firstBookTitle: string;
}>;

export type StoryProjectSummary = Readonly<{
  id: ProjectId;
  title: string;
  bookCount: number;
  version: number;
  createdAt: string;
  archivedAt?: string;
}>;

export type GhostwriterServices = Readonly<{
  createStoryProject(input: CreateStoryProjectInput): Promise<ProjectId>;
  listStoryProjects(
    accountId: AccountId,
    options?: Readonly<{ includeArchived?: boolean }>
  ): Promise<readonly StoryProjectSummary[]>;
  getProjectNavigator(
    accountId: AccountId,
    id: ProjectId
  ): Promise<ProjectNavigator | undefined>;
}> &
  ProjectCommandServices;

export type GhostwriterServiceDependencies = Readonly<{
  projects: ProjectRepository;
  ids: IdGenerator;
  clock: Clock;
}>;

export async function loadProjectRecords(
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
  const commandServices = createProjectCommandServices(dependencies);

  return Object.freeze({
    ...commandServices,
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
        writer.insertProjectMembership(
          createProjectMembership({
            projectId: newProjectId,
            accountId: input.ownerAccountId,
            role: "owner",
            createdAt
          })
        );
      });

      return newProjectId;
    },
    async listStoryProjects(
      accountId: AccountId,
      options: Readonly<{ includeArchived?: boolean }> = {}
    ): Promise<readonly StoryProjectSummary[]> {
      const ownedProjects = await projects.listProjectsForAccount(accountId, options);
      return Promise.all(
        ownedProjects.map(async (project) => ({
          id: project.id,
          title: project.title,
          bookCount: (await projects.listBooks(project.id)).length,
          version: project.version,
          createdAt: project.createdAt,
          ...(project.archivedAt === undefined ? {} : { archivedAt: project.archivedAt })
        }))
      );
    },
    async getProjectNavigator(
      accountId: AccountId,
      id: ProjectId
    ): Promise<ProjectNavigator | undefined> {
      requireProjectOwner(id, await projects.getProjectMembership(id, accountId));
      const records = await loadProjectRecords(projects, id);
      return records === undefined ? undefined : projectNavigatorFromRecords(records);
    }
  });
}
