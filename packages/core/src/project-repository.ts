import type {
  Book,
  BookEdition,
  Project,
  ProjectId,
  ProjectRecords,
  Scene,
  StoryKnowledge
} from "./domain.js";
import type { AccountId, ProjectMembership } from "./identity.js";

export class ProjectVersionConflictError extends Error {
  readonly projectId: ProjectId;
  readonly expectedVersion: number;

  constructor(projectId: ProjectId, expectedVersion: number) {
    super("The project changed since it was loaded.");
    this.name = "ProjectVersionConflictError";
    this.projectId = projectId;
    this.expectedVersion = expectedVersion;
  }
}

export interface ProjectRecordWriter {
  insertProject(project: Project): void;
  insertBook(book: Book): void;
  insertScene(scene: Scene): void;
  insertStoryKnowledge(knowledge: StoryKnowledge): void;
  insertEdition(edition: BookEdition): void;
  insertProjectMembership(membership: ProjectMembership): void;
  replaceProjectRecords(records: ProjectRecords, expectedVersion: number): void;
}

export interface ProjectRepository {
  getProject(id: ProjectId): Promise<Project | undefined>;
  listBooks(projectId: ProjectId): Promise<readonly Book[]>;
  listScenes(projectId: ProjectId): Promise<readonly Scene[]>;
  listStoryKnowledge(projectId: ProjectId): Promise<readonly StoryKnowledge[]>;
  listEditions(projectId: ProjectId): Promise<readonly BookEdition[]>;
  getProjectMembership(
    projectId: ProjectId,
    accountId: AccountId
  ): Promise<ProjectMembership | undefined>;
  listProjectsForAccount(
    accountId: AccountId,
    options?: Readonly<{ includeArchived?: boolean }>
  ): Promise<readonly Project[]>;
  transaction<Result>(
    operation: (writer: ProjectRecordWriter) => Result | Promise<Result>
  ): Promise<Result>;
}

export type DomainIdKind =
  | "project"
  | "book"
  | "part"
  | "chapter"
  | "scene"
  | "sceneDocumentBlock"
  | "storyKnowledge"
  | "edition"
  | "revision"
  | "sceneVariant"
  | "canvasObject"
  | "canvasLink"
  | "canvasRevision";

export interface IdGenerator {
  create(kind: DomainIdKind): string;
}

export interface Clock {
  now(): string;
}
