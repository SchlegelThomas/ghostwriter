import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  createCanvasRevision,
  createCanvasServices,
  createProjectMembership,
  sceneId,
  type CanvasSceneCreationUnitOfWork
} from "@ghostwriter/core";
import { eq } from "drizzle-orm";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import { createPostgresCanvasRepository } from "./postgres-canvas-repository.js";
import { createPostgresCanvasSceneCreationUnitOfWork } from "./postgres-canvas-scene-creation.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresSceneDocumentRepository } from "./postgres-scene-document-repository.js";
import {
  canvasBoards,
  canvasLinks,
  canvasObjects,
  canvasRevisions,
  canvasViewportPreferences,
  sceneDocuments,
  scenes,
  user
} from "./schema.js";
import { seedProject } from "./seed.js";

const OWNER = accountId("account-canvas-storage-owner");
const PROJECT_ID = BELLWETHER_FIXTURE_PROJECT_ID;
const NOW = "2026-07-12T20:30:00.000Z";
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

async function setup(
  unitOfWorkDecorator?: (
    unitOfWork: CanvasSceneCreationUnitOfWork
  ) => CanvasSceneCreationUnitOfWork
) {
  const { db, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: OWNER,
    name: "Canvas Owner",
    email: "canvas-owner@example.test",
    emailVerified: true
  });
  const repositoryDatabase = toRepositoryDatabase(db);
  const projects = createPostgresProjectRepository(repositoryDatabase);
  await seedProject(projects, BELLWETHER_FIXTURE);
  await projects.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: PROJECT_ID,
        accountId: OWNER,
        role: "owner",
        createdAt: NOW
      })
    );
  });
  const canvases = createPostgresCanvasRepository(repositoryDatabase);
  const sceneDocumentRepository =
    createPostgresSceneDocumentRepository(repositoryDatabase);
  let id = 0;
  const ids = {
    create(kind: string) {
      id += 1;
      return `${kind}-postgres-canvas-${id}`;
    }
  };
  const baseUnitOfWork =
    createPostgresCanvasSceneCreationUnitOfWork(repositoryDatabase);
  const services = createCanvasServices({
    projects,
    canvases,
    sceneDocuments: sceneDocumentRepository,
    sceneCreation:
      unitOfWorkDecorator?.(baseUnitOfWork) ?? baseUnitOfWork,
    ids,
    clock: { now: () => NOW }
  });
  return {
    db,
    projects,
    canvases,
    sceneDocumentRepository,
    services
  };
}

function note(label: string) {
  return {
    kind: "note",
    x: 100,
    y: 200,
    width: 220,
    height: 140,
    z: 1,
    authority: "confirmed",
    label,
    note: { body: label }
  } as const;
}

describe("Postgres Story Canvas repository", () => {
  it("persists relational current state, immutable history, and preferences", async () => {
    const { db, canvases, services } = await setup();
    let workspace = await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    expect(workspace.board).toMatchObject({ version: 1, objects: [], links: [] });
    expect(await db.select().from(canvasBoards)).toHaveLength(1);
    expect(await db.select().from(canvasRevisions)).toHaveLength(1);

    workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 1,
      command: { type: "canvas.object.create", object: note("Stored note") }
    });
    const objectId = workspace.board.objects[0]!.id;
    workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 2,
      command: {
        type: "canvas.object.move",
        objectId,
        x: 900,
        y: -100
      }
    });
    expect(workspace.board).toMatchObject({
      version: 3,
      objects: [expect.objectContaining({ id: objectId, x: 900, y: -100 })]
    });
    expect(await db.select().from(canvasObjects)).toHaveLength(1);
    expect(await db.select().from(canvasRevisions)).toHaveLength(3);

    await services.saveCanvasViewportPreference({
      accountId: OWNER,
      projectId: PROJECT_ID,
      x: 20,
      y: 30,
      zoom: 2,
      selectedObjectId: objectId
    });
    expect(await db.select().from(canvasViewportPreferences)).toHaveLength(1);
    await expect(canvases.getBoard(PROJECT_ID)).resolves.toMatchObject({
      version: 3
    });

    const restored = await services.undoCanvas({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 3
    });
    expect(restored.board).toMatchObject({
      version: 4,
      objects: [expect.objectContaining({ id: objectId, x: 100, y: 200 })]
    });
    expect(await db.select().from(canvasRevisions)).toHaveLength(4);
    await expect(canvases.listRevisions(PROJECT_ID)).resolves.toMatchObject([
      { boardVersion: 4, reason: "undo" },
      { boardVersion: 3, reason: "command" },
      { boardVersion: 2, reason: "command" },
      { boardVersion: 1, reason: "genesis" }
    ]);
  });

  it("persists regions and typed links without replacing stable object rows", async () => {
    const { db, services } = await setup();
    await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    let workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 1,
      command: {
        type: "canvas.object.create",
        object: {
          kind: "region",
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          z: 0,
          authority: "confirmed",
          label: "Act I"
        }
      }
    });
    const regionId = workspace.board.objects[0]!.id;
    workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 2,
      command: {
        type: "canvas.object.create",
        object: { ...note("Inside"), parentRegionId: regionId }
      }
    });
    const childId = workspace.board.objects.find(
      (object) => object.kind === "note"
    )!.id;
    workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 3,
      command: {
        type: "canvas.link.create",
        link: {
          kind: "pin",
          fromObjectId: childId,
          toObjectId: regionId,
          authority: "confirmed"
        }
      }
    });

    expect(workspace.board).toMatchObject({ version: 4 });
    expect(await db.select().from(canvasObjects)).toHaveLength(2);
    expect(await db.select().from(canvasLinks)).toHaveLength(1);
    const childRow = (await db.select().from(canvasObjects)).find(
      (row) => row.id === childId
    );
    expect(childRow?.parentRegionId).toBe(regionId);
  });

  it("restores an older canonical card across partial unique indexes", async () => {
    const { services } = await setup();
    await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    let workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 1,
      command: {
        type: "canvas.object.place",
        object: {
          kind: "scene-card",
          x: 0,
          y: 0,
          width: 220,
          height: 140,
          z: 1,
          authority: "confirmed",
          label: "First card",
          sceneId: sceneId("scene-arrival-at-bellwether")
        }
      }
    });
    const firstObjectId = workspace.board.objects[0]!.id;
    const firstRevision = (
      await services.listCanvasHistory({
        accountId: OWNER,
        projectId: PROJECT_ID
      })
    )[0]!;
    await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 2,
      command: {
        type: "canvas.object.archive",
        objectId: firstObjectId
      }
    });
    workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 3,
      command: {
        type: "canvas.object.place",
        object: {
          kind: "scene-card",
          x: 500,
          y: 0,
          width: 220,
          height: 140,
          z: 2,
          authority: "confirmed",
          label: "Replacement card",
          sceneId: sceneId("scene-arrival-at-bellwether")
        }
      }
    });
    expect(workspace.board.objects).toHaveLength(2);

    const restored = await services.restoreCanvasRevision({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 4,
      revisionId: firstRevision.id
    });
    expect(restored.board).toMatchObject({
      version: 5,
      objects: [
        expect.objectContaining({
          id: firstObjectId
        })
      ]
    });
    expect(restored.board.objects).toHaveLength(1);
    expect(restored.board.objects[0]).not.toHaveProperty("archivedAt");
  });

  it("atomically creates project scene state, genesis, and Canvas placement", async () => {
    const { db, projects, sceneDocumentRepository, services } = await setup();
    await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    const result = await services.createSceneFromCanvas({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedProjectVersion: 1,
      expectedCanvasVersion: 1,
      title: "Created in Canvas",
      manuscriptPlacement: {
        kind: "chapter",
        bookId: BELLWETHER_FIXTURE.project.bookIds[0]!,
        chapterId:
          BELLWETHER_FIXTURE.books[0]!.manuscript.parts[0]!.chapters[0]!.id,
        position: 1
      },
      canvas: { x: 400, y: 500, width: 260, height: 160, z: 5 }
    });

    await expect(projects.getProject(PROJECT_ID)).resolves.toMatchObject({
      version: 2
    });
    await expect(
      sceneDocumentRepository.getHead(result.scene.id)
    ).resolves.toMatchObject({ workingVersion: 1 });
    expect(await db.select().from(scenes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: result.scene.id,
          title: "Created in Canvas"
        })
      ])
    );
    expect(await db.select().from(sceneDocuments)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sceneId: result.scene.id })
      ])
    );
    expect(await db.select().from(canvasObjects)).toEqual([
      expect.objectContaining({
        sceneId: result.scene.id,
        kind: "scene-card"
      })
    ]);
  });

  it("rolls back metadata and genesis when the final Canvas write fails", async () => {
    const missingActor = accountId("account-missing-canvas-revision-actor");
    const { db, projects, services } = await setup((unitOfWork) => ({
      async commitSceneFromCanvas(input) {
        return unitOfWork.commitSceneFromCanvas({
          ...input,
          canvasMutation: {
            ...input.canvasMutation,
            revision: createCanvasRevision({
              ...input.canvasMutation.revision,
              actorAccountId: missingActor
            })
          }
        });
      }
    }));
    await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    const sceneCount = (await projects.listScenes(PROJECT_ID)).length;

    await expect(
      services.createSceneFromCanvas({
        accountId: OWNER,
        projectId: PROJECT_ID,
        expectedProjectVersion: 1,
        expectedCanvasVersion: 1,
        title: "Must be atomic",
        manuscriptPlacement: {
          kind: "unassigned",
          bookId: BELLWETHER_FIXTURE.project.bookIds[0]!
        },
        canvas: { x: 0, y: 0, width: 200, height: 120, z: 1 }
      })
    ).rejects.toBeDefined();

    await expect(projects.getProject(PROJECT_ID)).resolves.toMatchObject({
      version: 1
    });
    await expect(projects.listScenes(PROJECT_ID)).resolves.toHaveLength(
      sceneCount
    );
    expect(await db.select().from(sceneDocuments)).toHaveLength(0);
    expect(await db.select().from(canvasObjects)).toHaveLength(0);
    expect(await db.select().from(canvasRevisions)).toHaveLength(1);
  });

  it("rejects stale combined creation without partial rows", async () => {
    const { db, projects, services } = await setup();
    await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    const before = (await projects.listScenes(PROJECT_ID)).length;
    await expect(
      services.createSceneFromCanvas({
        accountId: OWNER,
        projectId: PROJECT_ID,
        expectedProjectVersion: 999,
        expectedCanvasVersion: 1,
        title: "Stale",
        manuscriptPlacement: {
          kind: "unassigned",
          bookId: BELLWETHER_FIXTURE.project.bookIds[0]!
        },
        canvas: { x: 0, y: 0, width: 200, height: 120, z: 1 }
      })
    ).rejects.toMatchObject({ name: "ProjectVersionConflictError" });
    await expect(projects.listScenes(PROJECT_ID)).resolves.toHaveLength(before);
    expect(await db.select().from(sceneDocuments)).toHaveLength(0);
    expect(await db.select().from(canvasObjects)).toHaveLength(0);
  });

  it("keeps scene-card references restrictive and project-scoped", async () => {
    const { db, services } = await setup();
    await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    const workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 1,
      command: {
        type: "canvas.object.place",
        object: {
          kind: "scene-card",
          x: 0,
          y: 0,
          width: 200,
          height: 120,
          z: 1,
          authority: "confirmed",
          label: "Canonical",
          sceneId: sceneId("scene-arrival-at-bellwether")
        }
      }
    });
    expect(workspace.board.objects).toHaveLength(1);

    await expect(
      db.delete(scenes).where(
        // The test intentionally asks Postgres to enforce the restrictive edge.
        // Drizzle's predicate stays parameterized.
        eq(scenes.id, sceneId("scene-arrival-at-bellwether"))
      )
    ).rejects.toBeDefined();
  });
});
