import {
  canvasObjectId,
  projectId,
  type CanvasObject
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  CANVAS_TOOL_DEFINITIONS,
  canvasBoardCursor,
  canvasToolAccessibilityLabel,
  canvasToolTip,
  isCanvasPlaceTool,
  objectAtScreenPoint,
  panViewportByScreenDelta,
  pinchDistance,
  shouldBackgroundPanBoard,
  shouldDragObjects,
  shouldPanBoard
} from "./canvas-interaction.js";
import { zoomViewportAtScreenPoint } from "./canvas-model.js";

const project = projectId("project-canvas-interaction");

function object(
  id: string,
  overrides: Partial<CanvasObject> = {}
): CanvasObject {
  return {
    id: canvasObjectId(id),
    projectId: project,
    kind: "note",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    z: 1,
    authority: "confirmed",
    label: id,
    note: { body: id },
    ...overrides
  };
}

describe("canvas tool labels", () => {
  it("formats accessibility labels and tooltips as Name · shortcut", () => {
    for (const definition of CANVAS_TOOL_DEFINITIONS) {
      const expected = `${definition.label} · ${definition.shortcut}`;
      expect(canvasToolAccessibilityLabel(definition)).toBe(expected);
      expect(canvasToolTip(definition)).toBe(expected);
    }

    expect(canvasToolAccessibilityLabel(CANVAS_TOOL_DEFINITIONS[0]!)).toBe(
      "Select · V"
    );
  });
});

describe("board interaction modes", () => {
  it("pans with hand tool or spacebar", () => {
    expect(shouldPanBoard("hand", false)).toBe(true);
    expect(shouldPanBoard("hand", true)).toBe(true);
    expect(shouldPanBoard("select", true)).toBe(true);
    expect(shouldPanBoard("select", false)).toBe(false);
    expect(shouldPanBoard("scene", false)).toBe(false);
  });

  it("background-pans on Select, Hand, Space, or middle button", () => {
    expect(shouldBackgroundPanBoard("select", false)).toBe(true);
    expect(shouldBackgroundPanBoard("hand", false)).toBe(true);
    expect(shouldBackgroundPanBoard("note", false, { placeArmed: true })).toBe(
      false
    );
    expect(
      shouldBackgroundPanBoard("note", false, { middleButton: true })
    ).toBe(true);
    expect(
      shouldBackgroundPanBoard("select", false, { linkDragging: true })
    ).toBe(false);
  });

  it("drags objects only with select and without spacebar", () => {
    expect(shouldDragObjects("select", false)).toBe(true);
    expect(shouldDragObjects("select", true)).toBe(false);
    expect(shouldDragObjects("hand", false)).toBe(false);
    expect(shouldDragObjects("hand", true)).toBe(false);
  });

  it("treats note, region, and image as click-to-place tools", () => {
    expect(isCanvasPlaceTool("note")).toBe(true);
    expect(isCanvasPlaceTool("region")).toBe(true);
    expect(isCanvasPlaceTool("image")).toBe(true);
    expect(isCanvasPlaceTool("select")).toBe(false);
  });

  it("maps board cursors for tools and drag state", () => {
    expect(canvasBoardCursor("hand", false)).toBe("grab");
    expect(canvasBoardCursor("select", false)).toBe("grab");
    expect(canvasBoardCursor("select", false, { draggingObject: true })).toBe(
      "grabbing"
    );
    expect(canvasBoardCursor("select", false, { panning: true })).toBe(
      "grabbing"
    );
    expect(canvasBoardCursor("connect", false)).toBe("crosshair");
    expect(canvasBoardCursor("note", false)).toBe("crosshair");
  });
});

describe("panViewportByScreenDelta", () => {
  it("converts screen delta to world coordinates using zoom", () => {
    expect(
      panViewportByScreenDelta({ x: 100, y: 50, zoom: 2 }, 20, 10)
    ).toEqual({
      x: 90,
      y: 45,
      zoom: 2
    });
  });
});

describe("zoomViewportAtScreenPoint", () => {
  it("keeps the world point under the cursor stable while zooming", () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    const next = zoomViewportAtScreenPoint(viewport, 200, 100, 2);
    expect(next.zoom).toBe(2);
    expect(viewport.x + 200 / viewport.zoom).toBeCloseTo(next.x + 200 / next.zoom);
    expect(viewport.y + 100 / viewport.zoom).toBeCloseTo(next.y + 100 / next.zoom);
  });
});

describe("pinchDistance", () => {
  it("measures the distance between two touch points", () => {
    expect(pinchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("objectAtScreenPoint", () => {
  const viewport = { x: 0, y: 0, zoom: 1 };

  it("returns the topmost object at a screen point", () => {
    const lower = object("canvas-object-lower", { x: 0, y: 0, z: 1 });
    const upper = object("canvas-object-upper", { x: 0, y: 0, z: 5 });

    expect(
      objectAtScreenPoint([lower, upper], viewport, 50, 50)?.id
    ).toBe(upper.id);
  });

  it("returns undefined on miss", () => {
    const candidate = object("canvas-object-miss", { x: 200, y: 200 });

    expect(
      objectAtScreenPoint([candidate], viewport, 50, 50)
    ).toBeUndefined();
  });

  it("skips excluded, archived, and region objects", () => {
    const excluded = object("canvas-object-excluded", { x: 0, y: 0, z: 10 });
    const behind = object("canvas-object-behind", { x: 0, y: 0, z: 1 });
    const archived = object("canvas-object-archived", {
      x: 0,
      y: 0,
      z: 20,
      archivedAt: "2026-07-18T00:00:00.000Z"
    });
    const region = object("canvas-object-region", {
      kind: "region",
      x: 0,
      y: 0,
      z: 30
    });

    expect(
      objectAtScreenPoint(
        [excluded, behind, archived, region],
        viewport,
        50,
        50,
        excluded.id
      )?.id
    ).toBe(behind.id);
  });

  it("respects viewport translation and zoom", () => {
    const candidate = object("canvas-object-zoomed", {
      x: 100,
      y: 80,
      width: 200,
      height: 120
    });

    expect(
      objectAtScreenPoint(
        [candidate],
        { x: 50, y: 30, zoom: 2 },
        150,
        110
      )?.id
    ).toBe(candidate.id);
  });
});
