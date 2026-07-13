import { describe, expect, it } from "vitest";
import {
  applyCanvasCommand,
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
        scopeId: "chapter-arrival",
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
        scopeId: "chapter-arrival",
        x: 300,
        y: 400,
        width: 220,
        height: 140
      })
    ]);
    expect(result.board.version).toBe(2);
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
