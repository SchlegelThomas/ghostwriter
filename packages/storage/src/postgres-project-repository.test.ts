import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_NAVIGATOR,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  bookId,
  createGhostwriterServices,
  createProject,
  createProjectMembership,
  createScene,
  DomainValidationError,
  projectId,
  sceneId,
  type IdGenerator,
  type ProjectRepository
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { user } from "./schema.js";
import { seedProject } from "./seed.js";

const closers: Array<() => Promise<void>> = [];
const OWNER_ACCOUNT_ID = accountId("account-owner");

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

async function freshRepository(): Promise<ProjectRepository> {
  const { db, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: OWNER_ACCOUNT_ID,
    name: "Owner",
    email: "owner@example.test",
    emailVerified: true
  });
  return createPostgresProjectRepository(toRepositoryDatabase(db));
}

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

describe("postgres project repository", () => {
  it("persists and reads the seeded fixture as the same navigator", async () => {
    const repository = await freshRepository();
    await seedProject(repository, BELLWETHER_FIXTURE);
    await repository.transaction((writer) => {
      writer.insertProjectMembership(
        createProjectMembership({
          projectId: BELLWETHER_FIXTURE_PROJECT_ID,
          accountId: OWNER_ACCOUNT_ID,
          role: "owner",
          createdAt: "2026-07-11T19:00:00.000Z"
        })
      );
    });

    const services = createGhostwriterServices({
      projects: repository,
      ids: sequenceIds([]),
      clock: { now: () => "2026-07-11T19:00:00.000Z" }
    });

    await expect(
      services.getProjectNavigator(OWNER_ACCOUNT_ID, BELLWETHER_FIXTURE_PROJECT_ID)
    ).resolves.toEqual(BELLWETHER_FIXTURE_NAVIGATOR);
  });

  it("creates a project and first book through the service", async () => {
    const repository = await freshRepository();
    const services = createGhostwriterServices({
      projects: repository,
      ids: sequenceIds(["project-new-story", "book-new-story"]),
      clock: { now: () => "2026-07-11T19:00:00.000Z" }
    });

    const newProjectId = await services.createStoryProject({
      ownerAccountId: OWNER_ACCOUNT_ID,
      title: "A Map of Quiet Stars",
      firstBookTitle: "The Long Way Home"
    });

    await expect(
      services.getProjectNavigator(OWNER_ACCOUNT_ID, newProjectId)
    ).resolves.toMatchObject({
      title: "A Map of Quiet Stars",
      books: [{ title: "The Long Way Home", status: "planned", sceneCount: 0 }],
      totals: { books: 1, scenes: 0, storyKnowledge: 0, editions: 0 }
    });
  });

  it("atomically replaces an owned project from expected-version commands", async () => {
    const repository = await freshRepository();
    const services = createGhostwriterServices({
      projects: repository,
      ids: sequenceIds([
        "project-command-story",
        "book-command-story",
        "part-command-story"
      ]),
      clock: { now: () => "2026-07-11T19:00:00.000Z" }
    });
    const id = await services.createStoryProject({
      ownerAccountId: OWNER_ACCOUNT_ID,
      title: "Before",
      firstBookTitle: "Book"
    });
    const renamed = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: id,
      expectedVersion: 1,
      command: { type: "project.rename", title: "After" }
    });
    const structured = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: id,
      expectedVersion: renamed.version,
      command: {
        type: "part.create",
        bookId: bookId("book-command-story"),
        title: "Part One"
      }
    });

    expect(structured).toMatchObject({
      title: "After",
      version: 3,
      books: [{ parts: [{ id: "part-command-story", title: "Part One" }] }]
    });
    await expect(
      services.executeProjectCommand({
        accountId: OWNER_ACCOUNT_ID,
        projectId: id,
        expectedVersion: 1,
        command: { type: "project.rename", title: "Stale" }
      })
    ).rejects.toMatchObject({ name: "ProjectVersionConflictError" });
    await expect(
      services.getProjectNavigator(OWNER_ACCOUNT_ID, id)
    ).resolves.toEqual(structured);

    const concurrent = await Promise.allSettled([
      services.executeProjectCommand({
        accountId: OWNER_ACCOUNT_ID,
        projectId: id,
        expectedVersion: structured.version,
        command: { type: "project.rename", title: "Concurrent A" }
      }),
      services.executeProjectCommand({
        accountId: OWNER_ACCOUNT_ID,
        projectId: id,
        expectedVersion: structured.version,
        command: { type: "project.rename", title: "Concurrent B" }
      })
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(
      services.getProjectNavigator(OWNER_ACCOUNT_ID, id)
    ).resolves.toMatchObject({ version: 4 });
  });

  it("rejects a duplicate seed and leaves the store unchanged", async () => {
    const repository = await freshRepository();
    await seedProject(repository, BELLWETHER_FIXTURE);

    await expect(seedProject(repository, BELLWETHER_FIXTURE)).rejects.toBeInstanceOf(
      DomainValidationError
    );
  });

  it("rolls back a transaction that references an unknown book", async () => {
    const repository = await freshRepository();
    const orphanProjectId = projectId("project-orphan");

    await expect(
      repository.transaction((writer) => {
        writer.insertProject(
          createProject({
            id: orphanProjectId,
            title: "Orphan",
            bookIds: [bookId("book-orphan")],
            createdAt: "2026-07-11T19:00:00.000Z"
          })
        );
        writer.insertScene(
          createScene({
            id: sceneId("scene-orphan"),
            projectId: orphanProjectId,
            bookId: bookId("book-missing"),
            title: "Orphan scene",
            status: "planned"
          })
        );
      })
    ).rejects.toBeInstanceOf(DomainValidationError);

    await expect(repository.getProject(orphanProjectId)).resolves.toBeUndefined();
  });
});
