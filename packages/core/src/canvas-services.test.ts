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
  deriveCanvasReadingOrderSpine,
  CanvasNotFoundError,
  CanvasVersionConflictError
} from "./canvas.js";
import { createCanvasServices } from "./canvas-services.js";
import { createMemoryCanvasRepository, createMemoryCanvasSceneCreationUnitOfWork } from "./memory-canvas-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
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
    ).resolves.toHaveLength(historyBeforePreference.length);

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
    expect(history[0]).toMatchObject({
      boardVersion: createdVersion + 1,
      reason: "undo"
    });
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
        canvas: { x: 0, y: 0, width: 200, height: 100, z: 1 }
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
      board: { version: 1, objects: [] }
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
