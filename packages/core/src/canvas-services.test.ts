import { describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID
} from "./fixtures.js";
import {
  applyCanvasCommand,
  createCanvasBoard,
  createCanvasLink,
  createCanvasObject,
  createCanvasPersonalViewPreference,
  deriveCanvasReadingOrderSpine,
  CanvasNotFoundError,
  CanvasPreferenceVersionConflictError,
  CanvasVersionConflictError
} from "./canvas.js";
import {
  boundedCanvasPersonalScopeViews,
  createCanvasServices
} from "./canvas-services.js";
import { createMemoryCanvasRepository, createMemoryCanvasSceneCreationUnitOfWork } from "./memory-canvas-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createProjectCommandServices } from "./project-commands.js";
import { createMemorySceneDocumentRepository } from "./memory-scene-document-repository.js";
import {
  canvasLinkId,
  canvasObjectId,
  projectId,
  sceneId
} from "./domain.js";
import { accountId, createProjectMembership } from "./identity.js";
import type { CanvasSceneCreationUnitOfWork } from "./canvas-repository.js";

const OWNER = accountId("account-canvas-owner");
const OTHER = accountId("account-canvas-other");
const PROJECT_ID = BELLWETHER_FIXTURE_PROJECT_ID;
const SCENE_ID = sceneId("scene-arrival-at-bellwether");
const NOW = "2026-07-12T20:00:00.000Z";

function setup(
  unitOfWorkDecorator?: (
    unitOfWork: CanvasSceneCreationUnitOfWork
  ) => CanvasSceneCreationUnitOfWork
) {
  let sequence = 0;
  const projects = createMemoryProjectRepository(
    [BELLWETHER_FIXTURE],
    [
      createProjectMembership({
        projectId: PROJECT_ID,
        accountId: OWNER,
        role: "owner",
        createdAt: NOW
      })
    ]
  );
  const canvases = createMemoryCanvasRepository();
  const sceneDocuments = createMemorySceneDocumentRepository();
  const ids = {
    create(kind: string) {
      sequence += 1;
      return `${kind}-canvas-${sequence}`;
    }
  };
  const baseUnitOfWork = createMemoryCanvasSceneCreationUnitOfWork({
    projects,
    canvases,
    sceneDocuments
  });
  const services = createCanvasServices({
    projects,
    canvases,
    sceneDocuments,
    sceneCreation:
      unitOfWorkDecorator?.(baseUnitOfWork) ?? baseUnitOfWork,
    ids,
    clock: { now: () => NOW }
  });
  return { services, projects, canvases, sceneDocuments, ids };
}

function sceneCard(storyOrderHint?: number) {
  return {
    kind: "scene-card",
    x: 10,
    y: 20,
    width: 240,
    height: 160,
    z: 1,
    authority: "confirmed",
    label: "Arrival",
    sceneId: SCENE_ID,
    ...(storyOrderHint === undefined ? {} : { storyOrderHint })
  } as const;
}

function note(label: string, sourceKey?: string) {
  return {
    kind: "note",
    x: 30,
    y: 40,
    width: 180,
    height: 120,
    z: 2,
    authority: "confirmed",
    label,
    note: { body: label },
    ...(sourceKey === undefined ? {} : { sourceKey })
  } as const;
}

describe("Story Canvas core and memory adapter", () => {
  it("initializes one owner-only board with independent versioning", async () => {
    const { services, projects } = setup();
    const initial = await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });

    expect(initial).toMatchObject({
      board: { version: 1, objects: [], links: [] },
      spine: { projectVersion: 1, canvasVersion: 1 }
    });
    await expect(
      services.getCanvasWorkspace({
        accountId: OTHER,
        projectId: PROJECT_ID
      })
    ).rejects.toBeInstanceOf(CanvasNotFoundError);
    await expect(projects.getProject(PROJECT_ID)).resolves.toMatchObject({
      version: 1
    });
  });

  it("commits each completed object/link gesture exactly once", async () => {
    const { services } = setup();
    await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    let canvas = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 1,
      command: { type: "canvas.object.place", object: sceneCard(0) }
    });
    const sceneObjectId = canvas.board.objects[0]!.id;
    expect(canvas.board).toMatchObject({
      version: 2,
      objects: [expect.objectContaining({ sceneId: SCENE_ID })]
    });
    expect(canvas.spine.entries[0]).toMatchObject({ drift: "aligned" });

    canvas = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 2,
      command: { type: "canvas.object.create", object: note("Question") }
    });
    const noteObjectId = canvas.board.objects.find(
      (object) => object.kind === "note"
    )!.id;
    canvas = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: 3,
      command: {
        type: "canvas.link.create",
        link: {
          kind: "thread",
          fromObjectId: sceneObjectId,
          toObjectId: noteObjectId,
          authority: "confirmed",
          label: "Open question"
        }
      }
    });
    expect(canvas.board).toMatchObject({ version: 4 });
    expect(canvas.board.links).toHaveLength(1);

    await expect(
      services.executeCanvasCommand({
        accountId: OWNER,
        projectId: PROJECT_ID,
        expectedCanvasVersion: 3,
        command: {
          type: "canvas.object.move",
          objectId: noteObjectId,
          x: 90,
          y: 100
        }
      })
    ).rejects.toBeInstanceOf(CanvasVersionConflictError);
    const unchanged = await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    expect(unchanged.board).toMatchObject({ version: 4 });
  });

  it("enforces canonical, region, geometry, and link reference rules", async () => {
    expect(() =>
      createCanvasObject({
        ...sceneCard(),
        id: canvasObjectId("object-bad-scene-card"),
        projectId: PROJECT_ID,
        sceneId: undefined as never
      })
    ).toThrow(/canonical reference/u);
    expect(() =>
      createCanvasObject({
        ...note("Bad geometry"),
        id: canvasObjectId("object-bad-geometry"),
        projectId: PROJECT_ID,
        x: Number.NaN
      })
    ).toThrow(/finite/u);
    expect(() =>
      createCanvasLink({
        id: canvasLinkId("link-self"),
        projectId: PROJECT_ID,
        kind: "reference",
        fromObjectId: canvasObjectId("same"),
        toObjectId: canvasObjectId("same"),
        authority: "confirmed"
      })
    ).toThrow(/itself/u);

    const { services } = setup();
    const initial = await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    await expect(
      services.executeCanvasCommand({
        accountId: OWNER,
        projectId: PROJECT_ID,
        expectedCanvasVersion: initial.board.version,
        command: {
          type: "canvas.object.place",
          object: {
            ...sceneCard(),
            sceneId: sceneId("scene-from-another-project")
          }
        }
      })
    ).rejects.toThrow(/unknown scene/u);
  });

  it("archives provisional dismissals and blocks deterministic resurfacing", async () => {
    const { services } = setup();
    let canvas = await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    canvas = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: canvas.board.version,
      command: {
        type: "canvas.object.create",
        object: {
          ...note("Suggested beat", "fixture:beat:1"),
          authority: "provisional"
        }
      }
    });
    const suggestionId = canvas.board.objects[0]!.id;
    canvas = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: canvas.board.version,
      command: {
        type: "canvas.object.dismiss",
        objectId: suggestionId
      }
    });
    expect(canvas.board.objects[0]).toMatchObject({
      id: suggestionId,
      authority: "provisional",
      sourceKey: "fixture:beat:1",
      archivedAt: NOW,
      dismissedAt: NOW
    });
    await expect(
      services.executeCanvasCommand({
        accountId: OWNER,
        projectId: PROJECT_ID,
        expectedCanvasVersion: canvas.board.version,
        command: {
          type: "canvas.object.create",
          object: {
            ...note("Same suggestion", "fixture:beat:1"),
            authority: "provisional"
          }
        }
      })
    ).rejects.toThrow(/source keys must remain unique/u);
  });

  it("keeps viewport preference outside board history and supports guarded undo", async () => {
    const { services } = setup();
    let canvas = await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    canvas = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: canvas.board.version,
      command: { type: "canvas.object.create", object: note("Undo me") }
    });
    const createdVersion = canvas.board.version;
    const objectId = canvas.board.objects[0]!.id;
    const historyBeforePreference = await services.listCanvasHistory({
      accountId: OWNER,
      projectId: PROJECT_ID
    });

    await services.saveCanvasViewportPreference({
      accountId: OWNER,
      projectId: PROJECT_ID,
      x: 500,
      y: -250,
      zoom: 1.5,
      selectedObjectId: objectId
    });
    await expect(
      services.getCanvasViewportPreference({
        accountId: OWNER,
        projectId: PROJECT_ID
      })
    ).resolves.toMatchObject({
      x: 500,
      y: -250,
      zoom: 1.5,
      selectedObjectId: objectId
    });
    const afterPreference = await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    expect(afterPreference.board.version).toBe(createdVersion);
    await expect(
      services.listCanvasHistory({
        accountId: OWNER,
        projectId: PROJECT_ID
      })
    ).resolves.toMatchObject({
      revisions: { length: historyBeforePreference.revisions.length }
    });

    const undone = await services.undoCanvas({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: createdVersion
    });
    expect(undone.board).toMatchObject({
      version: createdVersion + 1,
      objects: []
    });
    const history = await services.listCanvasHistory({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    expect(history.revisions[0]).toMatchObject({
      boardVersion: createdVersion + 1,
      reason: "undo",
      restoredFromRevisionId: expect.any(String)
    });
  });

  it("persists bounded personal scope views under an independent CAS", async () => {
    const { services, projects } = setup();
    let canvas = await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    canvas = await services.executeCanvasCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedCanvasVersion: canvas.board.version,
      command: { type: "canvas.object.create", object: sceneCard() }
    });
    const objectId = canvas.board.objects[0]!.id;
    const initial = await services.saveCanvasPersonalViewPreference({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedPreferenceVersion: 0,
      scopeView: {
        scope: { scopeKind: "project" },
        viewport: { x: 10, y: 20, zoom: 1.2 },
        viewMode: "spatial",
        inspectorOpen: true,
        focusToken: "inspector",
        selectedObjectId: objectId,
        inspectedSceneId: SCENE_ID,
        workflowLens: "relationships"
      },
      lastScope: { scopeKind: "project" }
    });
    expect(initial).toMatchObject({ version: 1, scopeViews: [{ selectedObjectId: objectId }] });

    const scoped = await services.saveCanvasPersonalViewPreference({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedPreferenceVersion: 1,
      scopeView: {
        scope: { scopeKind: "scene", scopeId: SCENE_ID },
        viewport: { x: 300, y: -50, zoom: 2 },
        viewMode: "outline",
        inspectorOpen: false,
        focusToken: "search",
        workflowLens: "continuity"
      },
      lastScope: { scopeKind: "scene", scopeId: SCENE_ID }
    });
    expect(scoped).toMatchObject({
      version: 2,
      lastScope: { scopeKind: "scene", scopeId: SCENE_ID },
      scopeViews: [{ scope: { scopeKind: "project" } }, { scope: { scopeKind: "scene" } }]
    });
    await expect(
      services.saveCanvasPersonalViewPreference({
        accountId: OWNER,
        projectId: PROJECT_ID,
        expectedPreferenceVersion: 1,
        scopeView: scoped.scopeViews[1]!,
        lastScope: scoped.lastScope
      })
    ).rejects.toBeInstanceOf(CanvasPreferenceVersionConflictError);

    await services.saveCanvasViewportPreference({
      accountId: OWNER,
      projectId: PROJECT_ID,
      x: 40,
      y: 50,
      zoom: 1.5
    });
    await expect(
      services.getCanvasPersonalViewPreference({
        accountId: OWNER,
        projectId: PROJECT_ID
      })
    ).resolves.toMatchObject({
      version: 3,
      scopeViews: [
        { scope: { scopeKind: "project" }, viewport: { x: 40, y: 50, zoom: 1.5 } },
        { scope: { scopeKind: "scene" }, viewport: { x: 300, y: -50, zoom: 2 } }
      ]
    });
    await expect(
      services.getCanvasPersonalViewPreference({
        accountId: OTHER,
        projectId: PROJECT_ID
      })
    ).rejects.toBeInstanceOf(CanvasNotFoundError);
    await expect(projects.getProject(PROJECT_ID)).resolves.toMatchObject({ version: 1 });
    await expect(services.getCanvasWorkspace({ accountId: OWNER, projectId: PROJECT_ID }))
      .resolves.toMatchObject({ board: { version: 2 } });
  });

  it("rejects personal preference aggregates beyond the scope bound", () => {
    expect(() =>
      createCanvasPersonalViewPreference({
        projectId: PROJECT_ID,
        accountId: OWNER,
        version: 1,
        lastScope: { scopeKind: "project" },
        scopeViews: Array.from({ length: 1_025 }, (_, index) => ({
          scope: index === 0
            ? { scopeKind: "project" as const }
            : { scopeKind: "scene" as const, scopeId: `scene-${index}` },
          viewport: { x: 0, y: 0, zoom: 1 },
          viewMode: "spatial" as const,
          inspectorOpen: false,
          focusToken: "surface" as const,
          workflowLens: "outline" as const,
          updatedAt: NOW
        })),
        updatedAt: NOW
      })
    ).toThrow(/1024 scopes/u);
  });

  it("evicts the least-recent non-project view while retaining the current scope", () => {
    const views = Array.from({ length: 1_025 }, (_, index) => ({
      scope: index === 0
        ? { scopeKind: "project" as const }
        : { scopeKind: "scene" as const, scopeId: `scene-${index}` },
      viewport: { x: 0, y: 0, zoom: 1 },
      viewMode: "spatial" as const,
      inspectorOpen: false,
      focusToken: "surface" as const,
      workflowLens: "outline" as const,
      updatedAt: `2026-09-12T20:${String(index).padStart(4, "0")}:00.000Z`
    }));
    const bounded = boundedCanvasPersonalScopeViews(views, {
      scopeKind: "scene",
      scopeId: "scene-1024"
    });
    expect(bounded).toHaveLength(1_024);
    expect(bounded.some((view) => view.scope.scopeKind === "project")).toBe(true);
    expect(bounded.some((view) => view.scope.scopeId === "scene-1")).toBe(false);
    expect(bounded.some((view) => view.scope.scopeId === "scene-1024")).toBe(true);
  });

  it("falls back from an archived last scene to its active chapter", async () => {
    const { services, projects, ids } = setup();
    await services.getCanvasWorkspace({ accountId: OWNER, projectId: PROJECT_ID });
    await services.saveCanvasPersonalViewPreference({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedPreferenceVersion: 0,
      scopeView: {
        scope: { scopeKind: "scene", scopeId: SCENE_ID },
        viewport: { x: 30, y: 40, zoom: 1.1 },
        viewMode: "spatial",
        inspectorOpen: false,
        focusToken: "surface",
        workflowLens: "outline"
      },
      lastScope: { scopeKind: "scene", scopeId: SCENE_ID }
    });
    const commands = createProjectCommandServices({
      projects,
      ids,
      clock: { now: () => NOW }
    });
    await commands.executeProjectCommand({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedVersion: 1,
      command: { type: "scene.setArchived", sceneId: SCENE_ID, archived: true }
    });

    await expect(
      services.getCanvasPersonalViewPreference({
        accountId: OWNER,
        projectId: PROJECT_ID
      })
    ).resolves.toMatchObject({
      version: 1,
      lastScope: { scopeKind: "chapter" },
      scopeViews: expect.arrayContaining([
        expect.objectContaining({
          scope: { scopeKind: "scene", scopeId: SCENE_ID }
        })
      ])
    });
  });

  it("refuses unavailable scopes and unknown personal inspection references", async () => {
    const { services } = setup();
    await services.getCanvasWorkspace({ accountId: OWNER, projectId: PROJECT_ID });
    const base = {
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedPreferenceVersion: 0,
      scopeView: {
        scope: { scopeKind: "project" as const },
        viewport: { x: 0, y: 0, zoom: 1 },
        viewMode: "spatial" as const,
        inspectorOpen: false,
        focusToken: "surface" as const,
        workflowLens: "outline" as const
      },
      lastScope: { scopeKind: "project" as const }
    };
    await expect(
      services.saveCanvasPersonalViewPreference({
        ...base,
        lastScope: { scopeKind: "scene", scopeId: sceneId("scene-missing") }
      })
    ).rejects.toThrow(/scope is unavailable/u);
    await expect(
      services.saveCanvasPersonalViewPreference({
        ...base,
        scopeView: {
          ...base.scopeView,
          selectedObjectId: canvasObjectId("object-missing")
        }
      })
    ).rejects.toBeInstanceOf(CanvasNotFoundError);
    await expect(
      services.saveCanvasPersonalViewPreference({
        ...base,
        scopeView: {
          ...base.scopeView,
          inspectedSceneId: sceneId("scene-missing")
        }
      })
    ).rejects.toBeInstanceOf(CanvasNotFoundError);
    await expect(
      services.getCanvasPersonalViewPreference({
        accountId: OWNER,
        projectId: PROJECT_ID
      })
    ).resolves.toBeUndefined();
  });

  it("persists explicit scope membership through the memory service with version guards", async () => {
    const { services } = setup();
    const actor = { accountId: OWNER, projectId: PROJECT_ID };
    let canvas = await services.getCanvasWorkspace(actor);
    canvas = await services.executeCanvasCommand({
      ...actor,
      expectedCanvasVersion: canvas.board.version,
      command: { type: "canvas.object.create", object: note("Membership") }
    });
    const objectId = canvas.board.objects[0]!.id;
    canvas = await services.executeCanvasCommand({
      ...actor,
      expectedCanvasVersion: 2,
      command: {
        type: "canvas.object.setScopeMembership",
        objectId,
        scopeKind: "scene",
        scopeId: SCENE_ID,
        member: true
      }
    });
    expect(canvas.board.scopePlacements).toEqual([
      expect.objectContaining({
        objectId,
        scopeKind: "scene",
        scopeId: SCENE_ID,
        membership: "explicit",
        x: 30,
        y: 40
      })
    ]);
    await expect(
      services.executeCanvasCommand({
        ...actor,
        expectedCanvasVersion: 2,
        command: {
          type: "canvas.object.setScopeMembership",
          objectId,
          scopeKind: "scene",
          scopeId: SCENE_ID,
          member: false
        }
      })
    ).rejects.toBeInstanceOf(CanvasVersionConflictError);
    canvas = await services.executeCanvasCommand({
      ...actor,
      expectedCanvasVersion: canvas.board.version,
      command: {
        type: "canvas.object.setScopeMembership",
        objectId,
        scopeKind: "scene",
        scopeId: SCENE_ID,
        member: false
      }
    });
    expect(canvas.board.scopePlacements[0]).not.toHaveProperty("membership");
    expect(canvas.board.objects[0]).toMatchObject({ id: objectId, x: 30, y: 40 });
  });

  it("undoes consecutive actions, keeps audit history, and branches after a new action", async () => {
    const { services, canvases } = setup();
    const actor = { accountId: OWNER, projectId: PROJECT_ID };
    let canvas = await services.getCanvasWorkspace(actor);
    const create = async (label: string) => {
      canvas = await services.executeCanvasCommand({ ...actor,
        expectedCanvasVersion: canvas.board.version,
        command: { type: "canvas.object.create", object: note(label) }
      });
    };
    const undo = async () => {
      canvas = await services.undoCanvas({ ...actor, expectedCanvasVersion: canvas.board.version });
    };
    await create("First");
    await create("Second");
    const secondHead = (await canvases.listRevisions(PROJECT_ID, { limit: 1 }))[0]!;
    await undo();
    expect(canvas.board.objects.map(o => o.label)).toEqual(["First"]);
    const firstUndo = (await canvases.listRevisions(PROJECT_ID, { limit: 1 }))[0]!;
    expect(firstUndo).toMatchObject({
      reason: "undo",
      parentRevisionId: secondHead.id
    });
    expect(firstUndo.restoredFromRevisionId).not.toBe(secondHead.id);
    await create("Replacement");
    await undo();
    expect(canvas.board.objects.map(o => o.label)).toEqual(["First"]);
    await undo();
    expect(canvas.board.objects).toEqual([]);
    const version = canvas.board.version;
    await expect(services.undoCanvas({ ...actor, expectedCanvasVersion: version }))
      .rejects.toThrow(/revision/iu);
    expect((await services.getCanvasWorkspace(actor)).board.version).toBe(version);
    expect((await services.listCanvasHistory(actor)).revisions).toHaveLength(7);
  });

  it("pages history newest-first with an exclusive version cursor", async () => {
    const { services } = setup();
    const actor = { accountId: OWNER, projectId: PROJECT_ID };
    let canvas = await services.getCanvasWorkspace(actor);
    for (let index = 0; index < 4; index += 1) {
      canvas = await services.executeCanvasCommand({
        ...actor,
        expectedCanvasVersion: canvas.board.version,
        command: {
          type: "canvas.object.create",
          object: note(`Page ${index}`)
        }
      });
    }

    const first = await services.listCanvasHistory({ ...actor, limit: 2 });
    expect(first.revisions.map((revision) => revision.boardVersion)).toEqual([5, 4]);
    expect(first.nextBeforeVersion).toBe(4);
    const second = await services.listCanvasHistory({
      ...actor,
      limit: 2,
      beforeVersion: first.nextBeforeVersion
    });
    expect(second.revisions.map((revision) => revision.boardVersion)).toEqual([3, 2]);
    expect(second.nextBeforeVersion).toBe(2);
    const final = await services.listCanvasHistory({
      ...actor,
      limit: 2,
      beforeVersion: second.nextBeforeVersion
    });
    expect(final.revisions.map((revision) => revision.boardVersion)).toEqual([1]);
    expect(final).not.toHaveProperty("nextBeforeVersion");
    await expect(
      services.listCanvasHistory({ ...actor, limit: 101 })
    ).rejects.toThrow(/between 1 and 100/iu);
    await expect(
      services.listCanvasHistory({ ...actor, beforeVersion: 0 })
    ).rejects.toThrow(/positive integer/iu);
    await expect(
      services.listCanvasHistory({
        accountId: OTHER,
        projectId: PROJECT_ID
      })
    ).rejects.toBeInstanceOf(CanvasNotFoundError);
  });

  it("undoes explicit restores as actions and can restore an Undo snapshot", async () => {
    const { services, canvases } = setup();
    const actor = { accountId: OWNER, projectId: PROJECT_ID };
    let canvas = await services.getCanvasWorkspace(actor);
    const genesis = (await canvases.listRevisions(PROJECT_ID, { limit: 1 }))[0]!;
    canvas = await services.executeCanvasCommand({
      ...actor,
      expectedCanvasVersion: canvas.board.version,
      command: { type: "canvas.object.create", object: note("A") }
    });
    const revisionA = (await canvases.listRevisions(PROJECT_ID, { limit: 1 }))[0]!;
    canvas = await services.executeCanvasCommand({
      ...actor,
      expectedCanvasVersion: canvas.board.version,
      command: { type: "canvas.object.create", object: note("B") }
    });
    const revisionB = (await canvases.listRevisions(PROJECT_ID, { limit: 1 }))[0]!;

    canvas = await services.restoreCanvasRevision({
      ...actor,
      expectedCanvasVersion: canvas.board.version,
      revisionId: genesis.id
    });
    expect(canvas.board.objects).toEqual([]);
    expect((await canvases.listRevisions(PROJECT_ID, { limit: 1 }))[0]).toMatchObject({
      reason: "restore",
      parentRevisionId: revisionB.id,
      restoredFromRevisionId: genesis.id
    });

    canvas = await services.undoCanvas({
      ...actor,
      expectedCanvasVersion: canvas.board.version
    });
    expect(canvas.board.objects.map((object) => object.label)).toEqual(["A", "B"]);
    const firstUndo = (await canvases.listRevisions(PROJECT_ID, { limit: 1 }))[0]!;
    expect(firstUndo.restoredFromRevisionId).toBe(revisionB.id);
    canvas = await services.undoCanvas({
      ...actor,
      expectedCanvasVersion: canvas.board.version
    });
    expect(canvas.board.objects.map((object) => object.label)).toEqual(["A"]);
    expect((await canvases.listRevisions(PROJECT_ID, { limit: 1 }))[0])
      .toMatchObject({ restoredFromRevisionId: revisionA.id });

    canvas = await services.restoreCanvasRevision({
      ...actor,
      expectedCanvasVersion: canvas.board.version,
      revisionId: firstUndo.id
    });
    expect(canvas.board.objects.map((object) => object.label)).toEqual(["A", "B"]);
    expect((await canvases.listRevisions(PROJECT_ID, { limit: 1 }))[0])
      .toMatchObject({
        reason: "restore",
        restoredFromRevisionId: firstUndo.id
      });
    canvas = await services.undoCanvas({
      ...actor,
      expectedCanvasVersion: canvas.board.version
    });
    expect(canvas.board.objects.map((object) => object.label)).toEqual(["A"]);
  });

  it("derives a 500+ object spine without changing manuscript authority", () => {
    const manuscriptBefore = JSON.stringify(
      BELLWETHER_FIXTURE.books.map((book) => book.manuscript)
    );
    const objects = Array.from({ length: 501 }, (_, index) =>
      createCanvasObject({
        id: canvasObjectId(`object-smoke-${index}`),
        projectId: PROJECT_ID,
        ...note(`Note ${index}`)
      })
    );
    objects.push(
      createCanvasObject({
        id: canvasObjectId("object-smoke-scene"),
        projectId: PROJECT_ID,
        ...sceneCard(99)
      })
    );
    const board = createCanvasBoard({
      projectId: PROJECT_ID,
      version: 1,
      objects,
      links: [],
      createdAt: NOW,
      updatedAt: NOW
    });
    const spine = deriveCanvasReadingOrderSpine(BELLWETHER_FIXTURE, board);

    expect(board.objects).toHaveLength(502);
    expect(spine.entries).toHaveLength(BELLWETHER_FIXTURE.scenes.length);
    expect(
      spine.entries.find((entry) => entry.sceneId === SCENE_ID)
    ).toMatchObject({ storyOrderHint: 99, drift: "later-on-canvas" });
    expect(
      JSON.stringify(BELLWETHER_FIXTURE.books.map((book) => book.manuscript))
    ).toBe(manuscriptBefore);
  });

  it("creates scene metadata, genesis, and Canvas card through one use case", async () => {
    const { services, projects, sceneDocuments } = setup();
    const initial = await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    const result = await services.createSceneFromCanvas({
      accountId: OWNER,
      projectId: PROJECT_ID,
      expectedProjectVersion: 1,
      expectedCanvasVersion: initial.board.version,
      title: "A Canvas-born scene",
      manuscriptPlacement: {
        kind: "unassigned",
        bookId: BELLWETHER_FIXTURE.project.bookIds[0]!,
        position: 1
      },
      canvas: {
        scope: {
          scopeKind: "chapter",
          scopeId: "chapter-low-tide"
        },
        x: 700,
        y: 300,
        width: 260,
        height: 180,
        z: 10,
        storyOrderHint: 2
      }
    });

    expect(result).toMatchObject({
      scene: { title: "A Canvas-born scene" },
      sceneDocumentHead: { workingVersion: 1 },
      navigator: { version: 2 },
      canvas: {
        board: {
          version: 2,
          objects: [
            expect.objectContaining({
              kind: "scene-card",
              sceneId: result.scene.id
            })
          ],
          scopePlacements: [
            expect.objectContaining({
              scopeKind: "chapter",
              scopeId: "chapter-low-tide",
              membership: "explicit"
            })
          ]
        }
      }
    });
    await expect(sceneDocuments.getHead(result.scene.id)).resolves.toMatchObject({
      sceneId: result.scene.id,
      workingVersion: 1
    });
    await expect(projects.getProject(PROJECT_ID)).resolves.toMatchObject({
      version: 2
    });

    await expect(
      services.createSceneFromCanvas({
        accountId: OWNER,
        projectId: PROJECT_ID,
        expectedProjectVersion: 1,
        expectedCanvasVersion: 2,
        title: "Must roll back",
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
          height: 100,
          z: 1
        }
      })
    ).rejects.toMatchObject({ name: "ProjectVersionConflictError" });
    await expect(projects.listScenes(PROJECT_ID)).resolves.toHaveLength(
      BELLWETHER_FIXTURE.scenes.length + 1
    );
  });

  it("rolls back all memory stores when the final Canvas publish fails", async () => {
    const { services, projects, sceneDocuments } = setup((unitOfWork) => ({
      commitSceneFromCanvas(input) {
        return unitOfWork.commitSceneFromCanvas({
          ...input,
          canvasMutation: {
            ...input.canvasMutation,
            board: createCanvasBoard({
              ...input.canvasMutation.board,
              updatedAt: "2026-07-12T20:00:01.000Z"
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
        title: "Must roll back everywhere",
        manuscriptPlacement: {
          kind: "unassigned",
          bookId: BELLWETHER_FIXTURE.project.bookIds[0]!
        },
        canvas: { x: 0, y: 0, width: 200, height: 100, z: 1 }
      })
    ).rejects.toThrow(/revision does not match/u);

    await expect(projects.getProject(PROJECT_ID)).resolves.toMatchObject({
      version: 1
    });
    await expect(projects.listScenes(PROJECT_ID)).resolves.toHaveLength(
      sceneCount
    );
    await expect(
      sceneDocuments.getHead(sceneId("scene-canvas-1"))
    ).resolves.toBeUndefined();
    await expect(
      services.getCanvasWorkspace({
        accountId: OWNER,
        projectId: PROJECT_ID
      })
    ).resolves.toMatchObject({
      board: { version: 1, objects: [], scopePlacements: [] }
    });
  });

  it("rejects cross-account combined creation before any effect", async () => {
    const { services, projects } = setup();
    await services.getCanvasWorkspace({
      accountId: OWNER,
      projectId: PROJECT_ID
    });
    await expect(
      services.createSceneFromCanvas({
        accountId: OTHER,
        projectId: PROJECT_ID,
        expectedProjectVersion: 1,
        expectedCanvasVersion: 1,
        title: "Invisible",
        manuscriptPlacement: {
          kind: "unassigned",
          bookId: BELLWETHER_FIXTURE.project.bookIds[0]!
        },
        canvas: { x: 0, y: 0, width: 200, height: 100, z: 1 }
      })
    ).rejects.toBeInstanceOf(CanvasNotFoundError);
    await expect(projects.listScenes(PROJECT_ID)).resolves.toHaveLength(
      BELLWETHER_FIXTURE.scenes.length
    );
  });
});

describe("pure Canvas commands", () => {
  it("rejects unknown projects before producing a revision", async () => {
    const board = createCanvasBoard({
      projectId: projectId("project-wrong"),
      version: 1,
      objects: [],
      links: [],
      createdAt: NOW,
      updatedAt: NOW
    });
    await expect(
      applyCanvasCommand({
        board,
        projectRecords: BELLWETHER_FIXTURE,
        expectedCanvasVersion: 1,
        command: { type: "canvas.object.create", object: note("Wrong project") },
        actorAccountId: OWNER,
        ids: { create: () => "object-wrong-project" },
        now: NOW
      })
    ).rejects.toThrow(/different projects/u);
  });
});
