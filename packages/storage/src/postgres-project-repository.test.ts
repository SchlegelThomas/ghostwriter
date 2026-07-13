import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_NAVIGATOR,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  bookId,
  chapterId,
  createGhostwriterServices,
  createProject,
  createProjectMembership,
  createScene,
  DomainValidationError,
  partId,
  projectId,
  sceneId,
  storyKnowledgeId,
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

async function freshRepositoryDatabase() {
  const { db, client, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: OWNER_ACCOUNT_ID,
    name: "Owner",
    email: "owner@example.test",
    emailVerified: true
  });
  return {
    repository: createPostgresProjectRepository(toRepositoryDatabase(db)),
    client
  };
}

async function freshRepository(): Promise<ProjectRepository> {
  return (await freshRepositoryDatabase()).repository;
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

    const renamed = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      expectedVersion: 1,
      command: { type: "project.rename", title: "The Renamed Bellwether Cycle" }
    });
    expect(renamed).toEqual({
      ...BELLWETHER_FIXTURE_NAVIGATOR,
      title: "The Renamed Bellwether Cycle",
      version: 2
    });
    await expect(
      services.getProjectNavigator(OWNER_ACCOUNT_ID, BELLWETHER_FIXTURE_PROJECT_ID)
    ).resolves.toEqual(renamed);
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

  it("preserves a scene row referenced by a restrictive foreign key", async () => {
    const { repository, client } = await freshRepositoryDatabase();
    const services = createGhostwriterServices({
      projects: repository,
      ids: sequenceIds([
        "project-stable-scene",
        "book-origin",
        "book-destination",
        "part-origin",
        "chapter-origin",
        "scene-stable"
      ]),
      clock: { now: () => "2026-07-11T19:00:00.000Z" }
    });
    const id = await services.createStoryProject({
      ownerAccountId: OWNER_ACCOUNT_ID,
      title: "Before",
      firstBookTitle: "Origin"
    });
    let navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: id,
      expectedVersion: 1,
      command: { type: "book.create", title: "Destination" }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: id,
      expectedVersion: navigator.version,
      command: {
        type: "part.create",
        bookId: bookId("book-origin"),
        title: "Part One"
      }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: id,
      expectedVersion: navigator.version,
      command: {
        type: "chapter.create",
        bookId: bookId("book-origin"),
        partId: partId("part-origin"),
        title: "Chapter One"
      }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: id,
      expectedVersion: navigator.version,
      command: {
        type: "scene.create",
        bookId: bookId("book-origin"),
        chapterId: chapterId("chapter-origin"),
        title: "Opening"
      }
    });

    await client.exec(`
      CREATE TABLE scene_fk_sentinel (
        id text PRIMARY KEY,
        scene_id text NOT NULL REFERENCES scenes(id) ON DELETE RESTRICT
      );
      INSERT INTO scene_fk_sentinel (id, scene_id)
      VALUES ('dependent-draft', 'scene-stable');
    `);

    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: id,
      expectedVersion: navigator.version,
      command: { type: "project.rename", title: "After" }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: id,
      expectedVersion: navigator.version,
      command: {
        type: "scene.update",
        sceneId: sceneId("scene-stable"),
        title: "A Different Opening",
        status: "drafting",
        summary: "The metadata changed without replacing the scene."
      }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: id,
      expectedVersion: navigator.version,
      command: {
        type: "scene.move",
        sceneId: sceneId("scene-stable"),
        bookId: bookId("book-destination"),
        position: 0
      }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: id,
      expectedVersion: navigator.version,
      command: {
        type: "chapter.removeEmpty",
        bookId: bookId("book-origin"),
        partId: partId("part-origin"),
        chapterId: chapterId("chapter-origin")
      }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: id,
      expectedVersion: navigator.version,
      command: {
        type: "part.removeEmpty",
        bookId: bookId("book-origin"),
        partId: partId("part-origin")
      }
    });

    const dependentRows = await client.query<{
      id: string;
      scene_id: string;
    }>("SELECT id, scene_id FROM scene_fk_sentinel");
    expect(dependentRows.rows).toEqual([
      { id: "dependent-draft", scene_id: "scene-stable" }
    ]);
    await expect(repository.listScenes(id)).resolves.toContainEqual(
      expect.objectContaining({
        id: sceneId("scene-stable"),
        bookId: bookId("book-destination"),
        title: "A Different Opening",
        status: "drafting",
        summary: "The metadata changed without replacing the scene."
      })
    );
    expect(
      navigator.books.find((book) => book.id === bookId("book-origin"))?.parts
    ).toEqual([]);
    expect(navigator).toMatchObject({ title: "After", version: 10 });
  });

  it("persists chapter summary, scene ambience, and knowledge depth", async () => {
    const repository = await freshRepository();
    const services = createGhostwriterServices({
      projects: repository,
      ids: sequenceIds([
        "project-depth",
        "book-depth",
        "part-depth",
        "chapter-depth",
        "scene-depth",
        "knowledge-mara",
        "knowledge-island"
      ]),
      clock: { now: () => "2026-07-12T20:00:00.000Z" }
    });
    const projectIdValue = await services.createStoryProject({
      ownerAccountId: OWNER_ACCOUNT_ID,
      title: "Depth Story",
      firstBookTitle: "Book One"
    });
    let navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: projectIdValue,
      expectedVersion: 1,
      command: {
        type: "part.create",
        bookId: bookId("book-depth"),
        title: "Part One"
      }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: projectIdValue,
      expectedVersion: navigator.version,
      command: {
        type: "chapter.create",
        bookId: bookId("book-depth"),
        partId: partId("part-depth"),
        title: "Chapter One"
      }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: projectIdValue,
      expectedVersion: navigator.version,
      command: {
        type: "chapter.update",
        bookId: bookId("book-depth"),
        partId: partId("part-depth"),
        chapterId: chapterId("chapter-depth"),
        summary: "Folder objectives"
      }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: projectIdValue,
      expectedVersion: navigator.version,
      command: {
        type: "scene.create",
        bookId: bookId("book-depth"),
        chapterId: chapterId("chapter-depth"),
        title: "Opening"
      }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: projectIdValue,
      expectedVersion: navigator.version,
      command: {
        type: "storyKnowledge.create",
        label: "Mara",
        kind: "character",
        authority: "planned"
      }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: projectIdValue,
      expectedVersion: navigator.version,
      command: {
        type: "storyKnowledge.create",
        label: "Island",
        kind: "location",
        authority: "confirmed"
      }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: projectIdValue,
      expectedVersion: navigator.version,
      command: {
        type: "scene.update",
        sceneId: sceneId("scene-depth"),
        backdrop: { url: "https://cdn.example.com/fog.jpg", caption: "Fog" },
        music: { url: "https://cdn.example.com/theme.mp3" },
        imageRefs: [
          { url: "https://cdn.example.com/mara.png", alt: "Mara" }
        ]
      }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: projectIdValue,
      expectedVersion: navigator.version,
      command: {
        type: "storyKnowledge.update",
        storyKnowledgeId: storyKnowledgeId("knowledge-mara"),
        notes: "Answers late calls.",
        aliases: ["Caller"]
      }
    });
    navigator = await services.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: projectIdValue,
      expectedVersion: navigator.version,
      command: {
        type: "storyKnowledge.setKnowledgeLink",
        fromId: storyKnowledgeId("knowledge-mara"),
        toId: storyKnowledgeId("knowledge-island"),
        kind: "cast",
        linked: true
      }
    });

    const reloaded = await services.getProjectNavigator(
      OWNER_ACCOUNT_ID,
      projectIdValue
    );
    expect(reloaded?.books[0]?.parts[0]?.chapters[0]).toMatchObject({
      summary: "Folder objectives"
    });
    expect(reloaded?.books[0]?.parts[0]?.chapters[0]?.scenes[0]).toMatchObject({
      backdrop: { url: "https://cdn.example.com/fog.jpg", caption: "Fog" },
      music: { url: "https://cdn.example.com/theme.mp3" },
      imageRefs: [{ url: "https://cdn.example.com/mara.png", alt: "Mara" }]
    });
    expect(
      reloaded?.storyKnowledge.find(
        (knowledge) => knowledge.id === storyKnowledgeId("knowledge-mara")
      )
    ).toMatchObject({
      notes: "Answers late calls.",
      aliases: ["Caller"],
      linkedKnowledge: [
        { toId: storyKnowledgeId("knowledge-island"), kind: "cast" }
      ]
    });
    expect(navigator.version).toBe(reloaded?.version);
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
