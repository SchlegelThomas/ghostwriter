import type {
  Book,
  BookEdition,
  Project,
  ProjectId,
  Scene,
  StoryKnowledge
} from "./domain.js";

export interface ProjectRecordWriter {
  insertProject(project: Project): void;
  insertBook(book: Book): void;
  insertScene(scene: Scene): void;
  insertStoryKnowledge(knowledge: StoryKnowledge): void;
  insertEdition(edition: BookEdition): void;
}

export interface ProjectRepository {
  getProject(id: ProjectId): Promise<Project | undefined>;
  listBooks(projectId: ProjectId): Promise<readonly Book[]>;
  listScenes(projectId: ProjectId): Promise<readonly Scene[]>;
  listStoryKnowledge(projectId: ProjectId): Promise<readonly StoryKnowledge[]>;
  listEditions(projectId: ProjectId): Promise<readonly BookEdition[]>;
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
  | "storyKnowledge"
  | "edition"
  | "revision";

export interface IdGenerator {
  create(kind: DomainIdKind): string;
}

export interface Clock {
  now(): string;
}
