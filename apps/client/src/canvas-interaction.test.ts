import {
  canvasObjectId,
  projectId,
  type CanvasObject
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  CANVAS_TOOL_DEFINITIONS,
  canvasToolAccessibilityLabel,
  canvasToolTip,
  objectAtScreenPoint,
  panViewportByScreenDelta,
  shouldDragObjects,
  shouldPanBoard
} from "./canvas-interaction.js";

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

  it("drags objects only with select and without spacebar", () => {
    expect(shouldDragObjects("select", false)).toBe(true);
    expect(shouldDragObjects("select", true)).toBe(false);
    expect(shouldDragObjects("hand", false)).toBe(false);
    expect(shouldDragObjects("hand", true)).toBe(false);
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
