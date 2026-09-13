import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  applyCanvasCommand,
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
  canvasScopePlacements,
  canvasViewportPreferences,
  sceneDocuments,
  scenes,
  user
} from "./schema.js";
import { seedProject } from "./seed.js";

const OWNER = accountId("account-canvas-storage-owner");
const OTHER = accountId("account-canvas-storage-other");
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
  it("upgrades legacy geometry-only placements without granting membership", async () => {
    const { client, close } = createPgliteDatabase();
    closers.push(close);
    await client.exec(`
      create table canvas_scope_placements (
        project_id text not null,
        object_id text not null,
        scope_kind text not null,
        scope_id text not null default '',
        x double precision not null,
        y double precision not null,
        width double precision,
        height double precision,
        primary key (project_id, object_id, scope_kind, scope_id)
      );
      insert into canvas_scope_placements
        (project_id, object_id, scope_kind, scope_id, x, y)
      values ('project-legacy', 'object-legacy', 'chapter', 'chapter-legacy', 10, 20);
    `);
    const migration = await readFile(
      new URL("../drizzle/0023_modern_frightful_four.sql", import.meta.url),
      "utf8"
    );
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));

    const legacy = await client.query<{ membership: string | null }>(
      "select membership from canvas_scope_placements where object_id = 'object-legacy'"
    );
    expect(legacy.rows).toEqual([{ membership: null }]);
    await expect(
      client.exec(
        "update canvas_scope_placements set membership = 'implicit' where object_id = 'object-legacy'"
      )
    ).rejects.toBeDefined();
  });

  it("adds nullable restore provenance to existing Canvas revisions", async () => {
    const { client, close } = createPgliteDatabase();
    closers.push(close);
    await client.exec(`
      create table canvas_revisions (
        id text primary key
      );
      insert into canvas_revisions (id) values ('legacy-revision');
    `);
    const migration = await readFile(
      new URL("../drizzle/0024_thin_blob.sql", import.meta.url),
      "utf8"
    );
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));

    const legacy = await client.query<{
      restored_from_revision_id: string | null;
    }>(
      "select restored_from_revision_id from canvas_revisions where id = 'legacy-revision'"
    );
    expect(legacy.rows).toEqual([{ restored_from_revision_id: null }]);
  });

  it("backfills a legacy viewport as the version-one project scope view", async () => {
    const { client, close } = createPgliteDatabase();
    closers.push(close);
    await client.exec(`
      create table canvas_viewport_preferences (
        project_id text not null,
        account_id text not null,
        x double precision not null,
        y double precision not null,
        zoom double precision not null,
        selected_object_id text,
        updated_at text not null,
        primary key (project_id, account_id)
      );
      insert into canvas_viewport_preferences
        (project_id, account_id, x, y, zoom, selected_object_id, updated_at)
      values (
        'project-legacy', 'account-legacy', 120, -40, 1.25,
        'object-legacy', '2026-09-12T20:00:00.000Z'
      );
    `);
    const migration = await readFile(
      new URL("../drizzle/0026_true_wild_child.sql", import.meta.url),
      "utf8"
    );
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));

    const legacy = await client.query<{
      preference_version: number;
      last_scope_kind: string;
      last_scope_id: string;
      scope_views: Record<string, unknown>;
    }>(
      "select preference_version, last_scope_kind, last_scope_id, scope_views from canvas_viewport_preferences"
    );
    expect(legacy.rows).toEqual([
      {
        preference_version: 1,
        last_scope_kind: "project",
        last_scope_id: "",
        scope_views: {
          project: {
            scope: { scopeKind: "project" },
            viewport: { x: 120, y: -40, zoom: 1.25 },
            viewMode: "spatial",
            inspectorOpen: false,
            focusToken: "surface",
            selectedObjectId: "object-legacy",
            workflowLens: "outline",
            updatedAt: "2026-09-12T20:00:00.000Z"
          }
        }
      }
    ]);
  });

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
    const scopedPreference =
      await services.saveCanvasPersonalViewPreference({
        accountId: OWNER,
        projectId: PROJECT_ID,
        expectedPreferenceVersion: 1,
        scopeView: {
          scope: { scopeKind: "scene", scopeId: sceneId("scene-arrival-at-bellwether") },
          viewport: { x: 500, y: 600, zoom: 1.4 },
          viewMode: "outline",
          inspectorOpen: true,
          focusToken: "inspector",
          selectedObjectId: objectId,
          inspectedSceneId: sceneId("scene-arrival-at-bellwether"),
          workflowLens: "continuity"
        },
        lastScope: {
          scopeKind: "scene",
          scopeId: sceneId("scene-arrival-at-bellwether")
        }
      });
    expect(scopedPreference).toMatchObject({
      version: 2,
      scopeViews: [
        { scope: { scopeKind: "project" }, viewport: { x: 20, y: 30, zoom: 2 } },
        { scope: { scopeKind: "scene" }, viewport: { x: 500, y: 600, zoom: 1.4 } }
      ]
    });
    await expect(
      services.saveCanvasPersonalViewPreference({
        accountId: OWNER,
        projectId: PROJECT_ID,
        expectedPreferenceVersion: 1,
        scopeView: scopedPreference.scopeViews[1]!,
        lastScope: scopedPreference.lastScope
      })
    ).rejects.toMatchObject({ name: "CanvasPreferenceVersionConflictError" });
    await expect(
      services.saveCanvasPersonalViewPreference({
        accountId: OWNER,
        projectId: PROJECT_ID,
        expectedPreferenceVersion: 0,
        scopeView: scopedPreference.scopeViews[1]!,
        lastScope: scopedPreference.lastScope
      })
    ).rejects.toMatchObject({ name: "CanvasPreferenceVersionConflictError" });
    await services.saveCanvasViewportPreference({
      accountId: OWNER,
      projectId: PROJECT_ID,
      x: 25,
      y: 35,
      zoom: 1.8
    });
    await expect(
      services.getCanvasPersonalViewPreference({
        accountId: OWNER,
        projectId: PROJECT_ID
      })
    ).resolves.toMatchObject({
      version: 3,
      scopeViews: [
        { scope: { scopeKind: "project" }, viewport: { x: 25, y: 35, zoom: 1.8 } },
        { scope: { scopeKind: "scene" }, viewport: { x: 500, y: 600, zoom: 1.4 } }
      ]
    });
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
      {
        boardVersion: 4,
        reason: "undo",
        restoredFromRevisionId: expect.any(String)
      },
      { boardVersion: 3, reason: "command" },
      { boardVersion: 2, reason: "command" },
      { boardVersion: 1, reason: "genesis" }
    ]);
    await expect(canvases.getBoard(PROJECT_ID)).resolves.toEqual(restored.board);
  });

  it("isolates personal scope views by account within one project", async () => {
    const { db, projects, services } = await setup();
    await db.insert(user).values({
      id: OTHER,
      name: "Other Canvas Owner",
      email: "canvas-other@example.test",
      emailVerified: true
    });
    await projects.transaction((writer) => {
      writer.insertProjectMembership(
        createProjectMembership({
          projectId: PROJECT_ID,
          accountId: OTHER,
          role: "owner",
          createdAt: NOW
        })
      );
    });
    await services.getCanvasWorkspace({ accountId: OWNER, projectId: PROJECT_ID });
    const saveFor = (id: typeof OWNER, x: number) =>
      services.saveCanvasPersonalViewPreference({
        accountId: id,
        projectId: PROJECT_ID,
        expectedPreferenceVersion: 0,
        scopeView: {
          scope: { scopeKind: "project" },
          viewport: { x, y: 0, zoom: 1 },
          viewMode: "spatial",
          inspectorOpen: false,
          focusToken: "surface",
          workflowLens: "outline"
        },
        lastScope: { scopeKind: "project" }
      });
    await saveFor(OWNER, 10);
    await saveFor(OTHER, 20);

    expect(await db.select().from(canvasViewportPreferences)).toHaveLength(2);
    await expect(
      services.getCanvasPersonalViewPreference({
        accountId: OWNER,
        projectId: PROJECT_ID
      })
    ).resolves.toMatchObject({ scopeViews: [{ viewport: { x: 10 } }] });
    await expect(
      services.getCanvasPersonalViewPreference({
        accountId: OTHER,
        projectId: PROJECT_ID
      })
    ).resolves.toMatchObject({ scopeViews: [{ viewport: { x: 20 } }] });
  });

  it("rolls back sparse geometry when revision insertion fails and refuses stale writes", async () => {
    const { db, canvases, services } = await setup();
    let workspace = await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: workspace.board.version,
      command: { type: "canvas.object.create", object: note("Stable") }
    });
    const objectId = workspace.board.objects[0]!.id;
    const [head] = await canvases.listRevisions(PROJECT_ID, { limit: 1 });
    const mutation = await applyCanvasCommand({
      board: workspace.board,
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 2,
      command: {
        type: "canvas.object.move",
        objectId,
        x: 777,
        y: 888
      },
      actorAccountId: OWNER,
      ids: { create: () => "forced-sparse-rollback" },
      now: NOW,
      parentRevisionId: head!.id
    });
    await db.insert(canvasRevisions).values({
      id: mutation.revision.id,
      projectId: mutation.revision.projectId,
      boardVersion: mutation.revision.boardVersion,
      contentHash: mutation.revision.contentHash,
      snapshot: mutation.revision.snapshot,
      actorAccountId: mutation.revision.actorAccountId,
      reason: mutation.revision.reason,
      commandType: mutation.revision.commandType ?? null,
      parentRevisionId: mutation.revision.parentRevisionId ?? null,
      restoredFromRevisionId: null,
      createdAt: mutation.revision.createdAt
    });

    await expect(
      canvases.replace({ mutation, expectedCanvasVersion: 2 })
    ).rejects.toBeDefined();
    await expect(canvases.getBoard(PROJECT_ID)).resolves.toMatchObject({
      version: 2,
      objects: [expect.objectContaining({ id: objectId, x: 100, y: 200 })]
    });
    await expect(
      services.executeCanvasCommand({
        accountId: OWNER,
        projectId: PROJECT_ID,
        expectedCanvasVersion: 1,
        command: {
          type: "canvas.object.move",
          objectId,
          x: 999,
          y: 999
        }
      })
    ).rejects.toMatchObject({ name: "CanvasVersionConflictError" });
    await expect(canvases.getBoard(PROJECT_ID)).resolves.toMatchObject({
      version: 2,
      objects: [expect.objectContaining({ id: objectId, x: 100, y: 200 })]
    });
  });

  it("stops Undo at a legacy Undo boundary after allowing its exact state", async () => {
    const { db, canvases, services } = await setup();
    const actor = { accountId: OWNER, projectId: PROJECT_ID };
    let workspace = await services.getCanvasWorkspace(actor);
    workspace = await services.executeCanvasCommand({
      ...actor,
      expectedCanvasVersion: workspace.board.version,
      command: { type: "canvas.object.create", object: note("Before legacy Undo") }
    });
    workspace = await services.undoCanvas({
      ...actor,
      expectedCanvasVersion: workspace.board.version
    });
    const legacyUndo = (await canvases.listRevisions(PROJECT_ID, { limit: 1 }))[0]!;
    await db
      .update(canvasRevisions)
      .set({ restoredFromRevisionId: null })
      .where(eq(canvasRevisions.id, legacyUndo.id));

    workspace = await services.executeCanvasCommand({
      ...actor,
      expectedCanvasVersion: workspace.board.version,
      command: { type: "canvas.object.create", object: note("After boundary") }
    });
    workspace = await services.undoCanvas({
      ...actor,
      expectedCanvasVersion: workspace.board.version
    });
    expect(workspace.board.objects).toEqual([]);
    expect((await canvases.listRevisions(PROJECT_ID, { limit: 1 }))[0])
      .toMatchObject({
        reason: "undo",
        restoredFromRevisionId: legacyUndo.id
      });

    const boundaryVersion = workspace.board.version;
    await expect(
      services.undoCanvas({
        ...actor,
        expectedCanvasVersion: boundaryVersion
      })
    ).rejects.toMatchObject({ name: "CanvasRevisionNotFoundError" });
    await expect(canvases.getBoard(PROJECT_ID)).resolves.toMatchObject({
      version: boundaryVersion,
      objects: []
    });
  });

  it("refuses cyclic Undo provenance without changing the board", async () => {
    const { db, canvases, services } = await setup();
    const actor = { accountId: OWNER, projectId: PROJECT_ID };
    let workspace = await services.getCanvasWorkspace(actor);
    workspace = await services.executeCanvasCommand({
      ...actor,
      expectedCanvasVersion: workspace.board.version,
      command: { type: "canvas.object.create", object: note("Cycle") }
    });
    workspace = await services.undoCanvas({
      ...actor,
      expectedCanvasVersion: workspace.board.version
    });
    const cyclicUndo = (await canvases.listRevisions(PROJECT_ID, { limit: 1 }))[0]!;
    await db
      .update(canvasRevisions)
      .set({ restoredFromRevisionId: cyclicUndo.id })
      .where(eq(canvasRevisions.id, cyclicUndo.id));

    await expect(
      services.undoCanvas({
        ...actor,
        expectedCanvasVersion: workspace.board.version
      })
    ).rejects.toMatchObject({ name: "CanvasRevisionNotFoundError" });
    await expect(canvases.getBoard(PROJECT_ID)).resolves.toEqual(workspace.board);
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
    const objectsBeforeMove = await db.select().from(canvasObjects);
    const linksBeforeMove = await db.select().from(canvasLinks);
    const childRow = objectsBeforeMove.find(
      (row) => row.id === childId
    );
    expect(childRow?.parentRegionId).toBe(regionId);

    workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 4,
      command: {
        type: "canvas.object.move",
        objectId: childId,
        x: 345,
        y: 456
      }
    });
    const objectsAfterMove = await db.select().from(canvasObjects);
    const movedChild = objectsAfterMove.find((row) => row.id === childId);
    expect(movedChild).toMatchObject({
      x: 345,
      y: 456,
      parentRegionId: regionId,
      sourceKey: null,
      archivedAt: null
    });
    expect(objectsAfterMove.find((row) => row.id === regionId)).toEqual(
      objectsBeforeMove.find((row) => row.id === regionId)
    );
    expect(await db.select().from(canvasLinks)).toEqual(linksBeforeMove);
    expect(workspace.board.version).toBe(5);

    await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 5,
      command: {
        type: "canvas.object.setScopePlacement",
        objectId: childId,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        x: 55,
        y: 66
      }
    });
    const rowsBeforeMembership = await db.select().from(canvasObjects);
    const linksBeforeMembership = await db.select().from(canvasLinks);
    await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 6,
      command: {
        type: "canvas.object.setScopeMembership",
        objectId: childId,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        member: true
      }
    });
    workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 7,
      command: {
        type: "canvas.object.setScopeMembership",
        objectId: childId,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        member: false
      }
    });
    expect(await db.select().from(canvasObjects)).toEqual(rowsBeforeMembership);
    expect(await db.select().from(canvasLinks)).toEqual(linksBeforeMembership);
    expect(workspace.board.scopePlacements[0]).toMatchObject({ x: 55, y: 66 });
    expect(workspace.board.scopePlacements[0]).not.toHaveProperty("membership");
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
    ).revisions[0]!;
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
      canvas: {
        scope: {
          scopeKind: "chapter",
          scopeId: "chapter-low-tide"
        },
        x: 400,
        y: 500,
        width: 260,
        height: 160,
        z: 5
      }
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
    expect(await db.select().from(canvasScopePlacements)).toEqual([
      expect.objectContaining({
        objectId: result.canvas.board.objects[0]!.id,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        membership: "explicit"
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
        canvas: {
          scope: {
            scopeKind: "chapter",
            scopeId: "chapter-low-tide"
          },
          x: 0,
          y: 0,
          width: 200,
          height: 120,
          z: 1
        }
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
    expect(await db.select().from(canvasScopePlacements)).toHaveLength(0);
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

  it("round-trips scope-keyed placements through board load", async () => {
    const { db, canvases, services } = await setup();
    await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    let workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 1,
      command: { type: "canvas.object.create", scope: { scopeKind: "chapter", scopeId: "chapter-low-tide" }, object: note("Scoped note") }
    });
    const objectId = workspace.board.objects[0]!.id;
    workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 2,
      command: {
        type: "canvas.object.setScopePlacement",
        objectId,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        x: 55,
        y: 66,
        width: 180,
        height: 110
      }
    });
    expect(workspace.board.scopePlacements).toEqual([
      expect.objectContaining({
        objectId,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        membership: "explicit",
        x: 55,
        y: 66,
        width: 180,
        height: 110
      })
    ]);
    expect(await db.select().from(canvasScopePlacements)).toEqual([
      expect.objectContaining({
        projectId: PROJECT_ID,
        objectId,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        membership: "explicit",
        x: 55,
        y: 66,
        width: 180,
        height: 110
      })
    ]);
    await expect(canvases.getBoard(PROJECT_ID)).resolves.toMatchObject({
      version: 3,
      scopePlacements: [
        expect.objectContaining({
          objectId,
          scopeKind: "chapter",
          scopeId: "chapter-low-tide",
          membership: "explicit",
          x: 55,
          y: 66
        })
      ]
    });
  });

  it("keeps a geometry-only placement non-member through storage round-trip", async () => {
    const { db, canvases, services } = await setup();
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
        object: note("Legacy geometry")
      }
    });
    const objectId = workspace.board.objects[0]!.id;
    workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 2,
      command: {
        type: "canvas.object.setScopePlacement",
        objectId,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        x: 70,
        y: 80
      }
    });

    expect(workspace.board.scopePlacements[0]).not.toHaveProperty("membership");
    expect(await db.select().from(canvasScopePlacements)).toEqual([
      expect.objectContaining({ objectId, membership: null, x: 70, y: 80 })
    ]);
    workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 3,
      command: {
        type: "canvas.object.setScopeMembership",
        objectId,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        member: true
      }
    });
    expect(workspace.board.scopePlacements[0]).toMatchObject({
      membership: "explicit",
      x: 70,
      y: 80
    });
    expect(await db.select().from(canvasScopePlacements)).toEqual([
      expect.objectContaining({
        objectId,
        membership: "explicit",
        x: 70,
        y: 80
      })
    ]);
    workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 4,
      command: {
        type: "canvas.object.setScopeMembership",
        objectId,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        member: false
      }
    });
    expect(workspace.board.scopePlacements[0]).toMatchObject({ x: 70, y: 80 });
    expect(workspace.board.scopePlacements[0]).not.toHaveProperty("membership");
    const reloaded = await canvases.getBoard(PROJECT_ID);
    expect(reloaded).toEqual(workspace.board);
    expect(reloaded?.scopePlacements[0]).not.toHaveProperty("membership");
  });

  it("sparsely updates global geometry and its explicit project placement", async () => {
    const { db, canvases, services } = await setup();
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
        scope: { scopeKind: "project" },
        object: note("Project member")
      }
    });
    const objectId = workspace.board.objects[0]!.id;
    workspace = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 2,
      command: {
        type: "canvas.object.move",
        objectId,
        x: 901,
        y: 902
      }
    });

    expect(workspace.board.objects[0]).toMatchObject({ x: 901, y: 902 });
    expect(workspace.board.scopePlacements[0]).toMatchObject({
      objectId,
      membership: "explicit",
      x: 901,
      y: 902
    });
    expect(await db.select().from(canvasObjects)).toEqual([
      expect.objectContaining({ id: objectId, x: 901, y: 902 })
    ]);
    expect(await db.select().from(canvasScopePlacements)).toEqual([
      expect.objectContaining({
        objectId,
        membership: "explicit",
        x: 901,
        y: 902
      })
    ]);
    await expect(canvases.getBoard(PROJECT_ID)).resolves.toEqual(workspace.board);
  });
});
