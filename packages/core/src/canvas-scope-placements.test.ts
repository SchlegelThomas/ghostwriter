import { describe, expect, it } from "vitest";
import {
  applyCanvasCommand,
  canvasSparseGeometryChanges,
  createCanvasBoard,
  createCanvasObject,
  createCanvasScopePlacement,
  resolveObjectGeometry
} from "./canvas.js";
import { canvasObjectId, sceneId } from "./domain.js";
import { accountId } from "./identity.js";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID
} from "./fixtures.js";

const PROJECT_ID = BELLWETHER_FIXTURE_PROJECT_ID;
const OBJECT_ID = canvasObjectId("canvas_object_scene_arrival");
const ACTOR = accountId("account-canvas-owner");
const NOW = "2026-07-12T21:00:00.000Z";

function boardWithSceneCard() {
  return createCanvasBoard({
    projectId: PROJECT_ID,
    version: 1,
    objects: [
      createCanvasObject({
        id: OBJECT_ID,
        projectId: PROJECT_ID,
        kind: "scene-card",
        x: 40,
        y: 60,
        width: 240,
        height: 160,
        z: 1,
        authority: "confirmed",
        label: "Arrival",
        sceneId: sceneId("scene-arrival-at-bellwether")
      })
    ],
    links: [],
    scopePlacements: [],
    createdAt: NOW,
    updatedAt: NOW
  });
}

describe("Canvas scope placements", () => {
  it("adds and removes explicit membership without changing scoped geometry", async () => {
    const before = boardWithSceneCard();
    const included = await applyCanvasCommand({
      board: before,
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 1,
      command: {
        type: "canvas.object.setScopeMembership",
        objectId: OBJECT_ID,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        member: true
      },
      actorAccountId: ACTOR,
      ids: { create: () => "include-revision" },
      now: NOW
    });
    expect(included.board.objects).toEqual(before.objects);
    expect(included.board.links).toEqual(before.links);
    expect(included.board.scopePlacements).toEqual([
      expect.objectContaining({
        objectId: OBJECT_ID,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        membership: "explicit",
        x: 40,
        y: 60,
        width: 240,
        height: 160
      })
    ]);

    const positioned = await applyCanvasCommand({
      board: included.board,
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 2,
      command: {
        type: "canvas.object.setScopePlacement",
        objectId: OBJECT_ID,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        x: 300,
        y: 400
      },
      actorAccountId: ACTOR,
      ids: { create: () => "position-revision" },
      now: NOW
    });
    const excluded = await applyCanvasCommand({
      board: positioned.board,
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 3,
      command: {
        type: "canvas.object.setScopeMembership",
        objectId: OBJECT_ID,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        member: false
      },
      actorAccountId: ACTOR,
      ids: { create: () => "exclude-revision" },
      now: NOW
    });
    expect(excluded.board.scopePlacements).toEqual([
      expect.objectContaining({ x: 300, y: 400 })
    ]);
    expect(excluded.board.scopePlacements[0]).not.toHaveProperty("membership");
    expect(excluded.board.objects).toEqual(before.objects);
    expect(excluded.board.links).toEqual(before.links);
    const repeated = await applyCanvasCommand({
      board: excluded.board,
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 4,
      command: {
        type: "canvas.object.setScopeMembership",
        objectId: OBJECT_ID,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        member: false
      },
      actorAccountId: ACTOR,
      ids: { create: () => "repeat-exclude-revision" },
      now: NOW
    });
    expect(repeated.board.version).toBe(5);
    expect(repeated.board.scopePlacements).toEqual(excluded.board.scopePlacements);
  });

  it("allows explicit membership removal from an unavailable historical scope", async () => {
    const historical = createCanvasBoard({
      ...boardWithSceneCard(),
      scopePlacements: [
        createCanvasScopePlacement({
          objectId: OBJECT_ID,
          scopeKind: "chapter",
          scopeId: "chapter-removed",
          membership: "explicit",
          x: 700,
          y: 800,
          width: 200,
          height: 120
        })
      ]
    });
    const removed = await applyCanvasCommand({
      board: historical,
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 1,
      command: {
        type: "canvas.object.setScopeMembership",
        objectId: OBJECT_ID,
        scopeKind: "chapter",
        scopeId: "chapter-removed",
        member: false
      },
      actorAccountId: ACTOR,
      ids: { create: () => "remove-historical-revision" },
      now: NOW
    });
    expect(removed.board.scopePlacements).toEqual([
      expect.objectContaining({
        scopeId: "chapter-removed",
        x: 700,
        y: 800,
        width: 200,
        height: 120
      })
    ]);
    expect(removed.board.scopePlacements[0]).not.toHaveProperty("membership");
    await expect(
      applyCanvasCommand({
        board: historical,
        projectRecords: BELLWETHER_FIXTURE,
        expectedCanvasVersion: 1,
        command: {
          type: "canvas.object.setScopeMembership",
          objectId: OBJECT_ID,
          scopeKind: "chapter",
          scopeId: "chapter-removed",
          member: true
        },
        actorAccountId: ACTOR,
        ids: { create: () => "add-historical-revision" },
        now: NOW
      })
    ).rejects.toThrow(/scope is unavailable/iu);
    await expect(
      applyCanvasCommand({
        board: historical,
        projectRecords: BELLWETHER_FIXTURE,
        expectedCanvasVersion: 1,
        command: {
          type: "canvas.object.setScopeMembership",
          objectId: OBJECT_ID,
          scopeKind: "project",
          scopeId: "not-allowed",
          member: false
        },
        actorAccountId: ACTOR,
        ids: { create: () => "invalid-scope-shape-revision" },
        now: NOW
      })
    ).rejects.toThrow(/must not carry a scope ID/iu);
  });

  it("rejects explicit inclusion for missing, archived, or dismissed objects", async () => {
    const command = {
      type: "canvas.object.setScopeMembership" as const,
      objectId: OBJECT_ID,
      scopeKind: "project" as const,
      member: true
    };
    const archived = createCanvasBoard({
      ...boardWithSceneCard(),
      objects: [
        createCanvasObject({
          ...boardWithSceneCard().objects[0]!,
          archivedAt: NOW
        })
      ]
    });
    const dismissed = createCanvasBoard({
      ...boardWithSceneCard(),
      objects: [
        createCanvasObject({
          ...boardWithSceneCard().objects[0]!,
          authority: "provisional",
          archivedAt: NOW,
          dismissedAt: NOW
        })
      ]
    });
    const input = {
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 1,
      actorAccountId: ACTOR,
      ids: { create: () => "invalid-membership-revision" },
      now: NOW
    };
    await expect(
      applyCanvasCommand({ ...input, board: archived, command })
    ).rejects.toThrow(/must be restored/iu);
    await expect(
      applyCanvasCommand({ ...input, board: dismissed, command })
    ).rejects.toThrow(/must be restored/iu);
    const dismissedWithMembership = createCanvasBoard({
      ...dismissed,
      scopePlacements: [
        createCanvasScopePlacement({
          objectId: OBJECT_ID,
          scopeKind: "project",
          membership: "explicit",
          x: 40,
          y: 60
        })
      ]
    });
    const removed = await applyCanvasCommand({
      ...input,
      board: dismissedWithMembership,
      command: { ...command, member: false }
    });
    expect(removed.board.scopePlacements[0]).not.toHaveProperty("membership");
    await expect(
      applyCanvasCommand({
        ...input,
        board: boardWithSceneCard(),
        command: { ...command, objectId: canvasObjectId("missing") }
      })
    ).rejects.toThrow(/object not found/iu);
  });

  it("recognizes only normalized rectangle changes as sparse persistence", async () => {
    const before = boardWithSceneCard();
    const scoped = await applyCanvasCommand({
      board: before,
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 1,
      command: {
        type: "canvas.object.setScopePlacement",
        objectId: OBJECT_ID,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        x: 300,
        y: 400
      },
      actorAccountId: ACTOR,
      ids: { create: () => "sparse-placement-revision" },
      now: NOW
    });
    expect(canvasSparseGeometryChanges(before, scoped.board)).toEqual({
      objects: [],
      scopePlacements: [
        expect.objectContaining({
          objectId: OBJECT_ID,
          scopeKind: "chapter",
          scopeId: "chapter-low-tide",
          x: 300,
          y: 400
        })
      ]
    });

    const relabeled = createCanvasBoard({
      ...scoped.board,
      version: scoped.board.version + 1,
      objects: [
        createCanvasObject({ ...scoped.board.objects[0]!, label: "Changed" })
      ]
    });
    expect(canvasSparseGeometryChanges(scoped.board, relabeled)).toBeUndefined();
  });

  it("creates an object and its scoped placement atomically, rejecting unknown scopes", async () => {
    const input = {
      board: boardWithSceneCard(), projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 1, actorAccountId: ACTOR,
      ids: { create: () => "scoped-note" }, now: NOW
    };
    const command = { type: "canvas.object.create" as const,
      scope: { scopeKind: "chapter" as const, scopeId: "chapter-low-tide" },
      object: { kind: "note" as const, label: "Remember the motive", authority: "confirmed" as const,
        x: 80, y: 90, width: 200, height: 140, z: 2 }
    };
    const result = await applyCanvasCommand({ ...input, command });
    expect(result.board.version).toBe(2);
    expect(result.board.scopePlacements).toEqual([expect.objectContaining({
      objectId: "scoped-note", scopeKind: "chapter",
      scopeId: "chapter-low-tide", membership: "explicit", x: 80, y: 90
    })]);
    expect(result.board.links).toEqual([]);
    await expect(applyCanvasCommand({ ...input, command: { ...command,
      scope: { scopeKind: "chapter", scopeId: "other-project-chapter" }
    } })).rejects.toThrow(/scope is unavailable/iu);
    expect(input.board.objects).toHaveLength(1);
  });

  it("resolves missing scope keys to the object's global geometry", () => {
    const object = boardWithSceneCard().objects[0]!;
    expect(
      resolveObjectGeometry(object, [], { scopeKind: "chapter", scopeId: "chapter-1" })
    ).toEqual({ x: 40, y: 60, width: 240, height: 160 });
  });

  it("resolves a matching placement and falls back width/height when omitted", () => {
    const object = boardWithSceneCard().objects[0]!;
    const placements = [
      createCanvasScopePlacement({
        objectId: OBJECT_ID,
        scopeKind: "scene",
        scopeId: "scene-arrival-at-bellwether",
        x: 120,
        y: 180
      })
    ];
    expect(
      resolveObjectGeometry(object, placements, {
        scopeKind: "scene",
        scopeId: "scene-arrival-at-bellwether"
      })
    ).toEqual({ x: 120, y: 180, width: 240, height: 160 });
  });

  it("upserts a chapter placement without changing global geometry", async () => {
    const result = await applyCanvasCommand({
      board: boardWithSceneCard(),
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 1,
      command: {
        type: "canvas.object.setScopePlacement",
        objectId: OBJECT_ID,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        x: 300,
        y: 400,
        width: 220,
        height: 140
      },
      actorAccountId: ACTOR,
      ids: {
        create(kind) {
          return `${kind}-scope-1`;
        }
      },
      now: NOW
    });

    expect(result.board.objects[0]).toMatchObject({ x: 40, y: 60, width: 240, height: 160 });
    expect(result.board.scopePlacements).toEqual([
      expect.objectContaining({
        objectId: OBJECT_ID,
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        x: 300,
        y: 400,
        width: 220,
        height: 140
      })
    ]);
    expect(result.board.version).toBe(2);
    expect(result.board.scopePlacements[0]).not.toHaveProperty("membership");
  });

  it("preserves explicit membership through scoped geometry updates", async () => {
    const created = await applyCanvasCommand({
      board: boardWithSceneCard(),
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 1,
      command: {
        type: "canvas.object.create",
        scope: { scopeKind: "chapter", scopeId: "chapter-low-tide" },
        object: {
          kind: "note",
          label: "Scoped note",
          authority: "confirmed",
          x: 80,
          y: 90,
          width: 200,
          height: 140,
          z: 2
        }
      },
      actorAccountId: ACTOR,
      ids: { create: () => "scoped-note-preserved" },
      now: NOW
    });

    const moved = await applyCanvasCommand({
      board: created.board,
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 2,
      command: {
        type: "canvas.object.setScopePlacement",
        objectId: canvasObjectId("scoped-note-preserved"),
        scopeKind: "chapter",
        scopeId: "chapter-low-tide",
        x: 300,
        y: 400
      },
      actorAccountId: ACTOR,
      ids: { create: () => "scope-placement-revision" },
      now: NOW
    });

    expect(moved.board.scopePlacements).toEqual([
      expect.objectContaining({
        objectId: "scoped-note-preserved",
        membership: "explicit",
        x: 300,
        y: 400
      })
    ]);
  });

  it("preserves explicit project membership through a global move", async () => {
    const created = await applyCanvasCommand({
      board: boardWithSceneCard(),
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 1,
      command: {
        type: "canvas.object.create",
        scope: { scopeKind: "project" },
        object: {
          kind: "note",
          label: "Project note",
          authority: "confirmed",
          x: 80,
          y: 90,
          width: 200,
          height: 140,
          z: 2
        }
      },
      actorAccountId: ACTOR,
      ids: { create: () => "project-note-preserved" },
      now: NOW
    });

    const moved = await applyCanvasCommand({
      board: created.board,
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 2,
      command: {
        type: "canvas.object.move",
        objectId: canvasObjectId("project-note-preserved"),
        x: 500,
        y: 600
      },
      actorAccountId: ACTOR,
      ids: { create: () => "project-move-revision" },
      now: NOW
    });

    expect(moved.board.scopePlacements).toEqual([
      expect.objectContaining({
        objectId: "project-note-preserved",
        membership: "explicit",
        x: 500,
        y: 600
      })
    ]);
  });

  it("updates global geometry when the project-scope placement is set", async () => {
    const first = await applyCanvasCommand({
      board: boardWithSceneCard(),
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 1,
      command: {
        type: "canvas.object.setScopePlacement",
        objectId: OBJECT_ID,
        scopeKind: "project",
        x: 88,
        y: 99,
        width: 200,
        height: 150
      },
      actorAccountId: ACTOR,
      ids: {
        create(kind) {
          return `${kind}-scope-2`;
        }
      },
      now: NOW
    });

    expect(first.board.objects[0]).toMatchObject({
      x: 88,
      y: 99,
      width: 200,
      height: 150
    });
    expect(first.board.scopePlacements).toHaveLength(1);

    const second = await applyCanvasCommand({
      board: first.board,
      projectRecords: BELLWETHER_FIXTURE,
      expectedCanvasVersion: 2,
      command: {
        type: "canvas.object.setScopePlacement",
        objectId: OBJECT_ID,
        scopeKind: "project",
        x: 10,
        y: 20
      },
      actorAccountId: ACTOR,
      ids: {
        create(kind) {
          return `${kind}-scope-3`;
        }
      },
      now: NOW
    });

    expect(second.board.scopePlacements).toHaveLength(1);
    expect(second.board.objects[0]).toMatchObject({ x: 10, y: 20, width: 200, height: 150 });
  });
});
