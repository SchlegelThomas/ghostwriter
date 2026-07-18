import { describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_NAVIGATOR,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  bookId,
  createGhostwriterServices,
  createMemoryProjectRepository,
  createProject,
  createProjectMembership,
  DomainValidationError,
  ProjectAccessDeniedError,
  projectId,
  type IdGenerator,
  type ProjectId
} from "./index.js";

const OWNER_ACCOUNT_ID = accountId("account-owner");
const BELLWETHER_OWNER = createProjectMembership({
  projectId: BELLWETHER_FIXTURE_PROJECT_ID,
  accountId: OWNER_ACCOUNT_ID,
  role: "owner",
  createdAt: "2026-07-11T19:00:00.000Z"
});

function sequenceIds(values: readonly string[]): IdGenerator {
  let index = 0;

  return {
    create(): string {
      const value = values[index];
      index += 1;

      if (value === undefined) throw new Error("The ID fixture is exhausted.");
      return value;
    }
  };
}

describe("project services", () => {
  it("reads a seeded project through the repository query boundary", async () => {
    const services = createGhostwriterServices({
      projects: createMemoryProjectRepository([BELLWETHER_FIXTURE], [BELLWETHER_OWNER]),
      ids: sequenceIds([]),
      clock: { now: () => "2026-07-11T19:00:00.000Z" }
    });

    await expect(
      services.getProjectNavigator(OWNER_ACCOUNT_ID, BELLWETHER_FIXTURE_PROJECT_ID)
    ).resolves.toEqual(BELLWETHER_FIXTURE_NAVIGATOR);
  });

  it("creates a valid project and first book atomically", async () => {
    const repository = createMemoryProjectRepository();
    const services = createGhostwriterServices({
      projects: repository,
      ids: sequenceIds(["project-new-story", "book-new-story"]),
      clock: { now: () => "2026-07-11T19:00:00.000Z" }
    });

    const newProjectId = await services.createStoryProject({
      ownerAccountId: OWNER_ACCOUNT_ID,
      title: "  A Map of Quiet Stars  ",
      firstBookTitle: "  The Long Way Home  "
    });

    expect(newProjectId).toBe(projectId("project-new-story"));
    await expect(
      services.getProjectNavigator(OWNER_ACCOUNT_ID, newProjectId)
    ).resolves.toMatchObject({
      title: "A Map of Quiet Stars",
      books: [
        {
          id: bookId("book-new-story"),
          title: "The Long Way Home",
          status: "planned",
          sceneCount: 0
        }
      ],
      totals: {
        books: 1,
        scenes: 0,
        storyKnowledge: 0,
        editions: 0
      }
    });
    await expect(services.listStoryProjects(OWNER_ACCOUNT_ID)).resolves.toMatchObject([
      {
        id: newProjectId,
        title: "A Map of Quiet Stars",
        bookCount: 1,
        version: 1
      }
    ]);
    const otherAccountId = accountId("account-other");
    await expect(services.listStoryProjects(otherAccountId)).resolves.toEqual([]);
    await expect(
      services.getProjectNavigator(otherAccountId, newProjectId)
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });

  it("rolls back a transaction whose final records violate invariants", async () => {
    const repository = createMemoryProjectRepository();
    const incompleteProjectId = projectId("project-incomplete");

    await expect(
      repository.transaction((writer) => {
        writer.insertProject(
          createProject({
            id: incompleteProjectId,
            title: "Incomplete",
            bookIds: [bookId("book-never-inserted")],
            createdAt: "2026-07-11T19:00:00.000Z"
          })
        );
      })
    ).rejects.toBeInstanceOf(DomainValidationError);

    await expect(repository.getProject(incompleteProjectId)).resolves.toBeUndefined();
  });

  it("returns defensive immutable copies from the memory adapter", async () => {
    const repository = createMemoryProjectRepository([BELLWETHER_FIXTURE]);
    const firstRead = await repository.getProject(BELLWETHER_FIXTURE_PROJECT_ID);
    expect(firstRead).toBeDefined();

    expect(() => {
      (firstRead!.bookIds as BookIdForMutation[]).push(
        bookId("book-should-not-persist") as BookIdForMutation
      );
    }).toThrow();

    const secondRead = await repository.getProject(BELLWETHER_FIXTURE_PROJECT_ID);
    expect(secondRead?.bookIds).toHaveLength(2);
  });

  it("does not reveal an unknown or unauthorized project", async () => {
    const services = createGhostwriterServices({
      projects: createMemoryProjectRepository(),
      ids: sequenceIds([]),
      clock: { now: () => "2026-07-11T19:00:00.000Z" }
    });

    await expect(
      services.getProjectNavigator(
        OWNER_ACCOUNT_ID,
        projectId("project-missing") as ProjectId
      )
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });
});

type BookIdForMutation = ReturnType<typeof bookId>;
