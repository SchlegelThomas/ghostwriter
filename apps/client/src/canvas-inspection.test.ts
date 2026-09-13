import {
  canvasObjectId,
  sceneId,
  type CanvasObject,
  type CanvasObjectId,
  type SceneId
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  canvasInspectionForObject,
  canvasInspectionForScene
} from "./canvas-inspection.js";

const firstScene = sceneId("scene-inspection-first");
const secondScene = sceneId("scene-inspection-second");
const firstCard = canvasObjectId("canvas-object-inspection-first");
const note = canvasObjectId("canvas-object-inspection-note");

function object(
  id: CanvasObjectId,
  scene: SceneId | undefined,
  dismissedAt?: string
): Pick<CanvasObject, "archivedAt" | "dismissedAt" | "id" | "sceneId"> {
  return {
    id,
    ...(scene === undefined ? {} : { sceneId: scene }),
    ...(dismissedAt === undefined ? {} : { dismissedAt })
  };
}

const objects = [object(firstCard, firstScene), object(note, undefined)];

describe("Canvas scene inspection", () => {
  it("selects a placed scene card for inspection without requiring Draft state", () => {
    expect(canvasInspectionForScene(objects, firstScene)).toEqual({
      inspectedSceneId: firstScene,
      selectedObjectId: firstCard
    });
  });

  it("keeps an unplaced spine scene inspectable while clearing the prior card", () => {
    expect(canvasInspectionForScene(objects, secondScene)).toEqual({
      inspectedSceneId: secondScene
    });
  });

  it("does not select a dismissed provisional card for active scene inspection", () => {
    const dismissedCard = canvasObjectId("canvas-object-inspection-dismissed");
    expect(
      canvasInspectionForScene(
        [...objects, object(dismissedCard, secondScene, "2026-09-12T12:00:00Z")],
        secondScene
      )
    ).toEqual({ inspectedSceneId: secondScene });
  });

  it("clears scene inspection when a non-scene Canvas object is inspected", () => {
    expect(canvasInspectionForObject(objects, note)).toEqual({
      selectedObjectId: note
    });
  });

  it("clears stale object and scene inspection together", () => {
    expect(
      canvasInspectionForObject(
        objects,
        canvasObjectId("canvas-object-inspection-missing")
      )
    ).toEqual({});
  });
});
