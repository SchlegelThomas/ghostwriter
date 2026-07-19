import { describe, expect, it } from "vitest";
import {
  attachPointOnFrame,
  cardMenuAnchor,
  clampMenuPosition,
  fittedCanvasCardSize,
  liveGeometryEquals,
  nearestAttachPair,
  needsCanvasCardFit,
  pushRecentCanvasAction,
  resizeCursorForEdge,
  resizeObjectByEdge,
  splitToolTip,
  surfaceLocalPoint,
  withLiveCanvasGeometry,
  type RecentCanvasAction
} from "./canvas-chrome.js";

describe("surfaceLocalPoint", () => {
  it("subtracts surface origin from page coordinates", () => {
    expect(
      surfaceLocalPoint(150, 200, {
        left: 50,
        top: 80,
        width: 800,
        height: 600
      })
    ).toEqual({ x: 100, y: 120 });
  });
});

describe("clampMenuPosition", () => {
  it("keeps menu inside surface bounds with padding", () => {
    const surface = { width: 400, height: 300 };
    const menu = { width: 220, height: 280 };

    expect(clampMenuPosition(-20, -10, surface, menu)).toEqual({ x: 8, y: 8 });
    expect(clampMenuPosition(500, 500, surface, menu)).toEqual({
      x: surface.width - menu.width - 8,
      y: surface.height - menu.height - 8
    });

    const tallSurface = { width: 400, height: 600 };
    expect(clampMenuPosition(100, 120, tallSurface, menu)).toEqual({
      x: 100,
      y: 120
    });
  });

  it("uses default menu dimensions when none are supplied", () => {
    const surface = { width: 400, height: 300 };

    expect(clampMenuPosition(500, 500, surface)).toEqual({ x: 172, y: 12 });
  });
});

describe("cardMenuAnchor", () => {
  it("places menu to the right of the frame with a gap", () => {
    expect(
      cardMenuAnchor({ left: 100, top: 50, width: 200, height: 120 })
    ).toEqual({ x: 308, y: 50 });
  });
});

describe("fittedCanvasCardSize", () => {
  const openingSceneCard = {
    kind: "scene-card" as const,
    width: 160,
    height: 80,
    label: "Opening scene"
  };

  it("converts zoom-aware screen budgets to world units at zoom 1", () => {
    // screen: width 220; height 118 + 14 (title wrap) + 39 (3 detail lines) = 171
    expect(fittedCanvasCardSize(openingSceneCard, { selected: false })).toEqual({
      width: 220,
      height: 171
    });
  });

  it("grows minimum size for selected scene cards with action row", () => {
    // screen: width 248; height 118 + 14 + 26 (2 detail lines) + 34 (action row) = 192
    expect(fittedCanvasCardSize(openingSceneCard, { selected: true })).toEqual({
      width: 248,
      height: 192
    });
  });

  it("preserves larger manual sizes", () => {
    const sceneCard = {
      kind: "scene-card" as const,
      width: 320,
      height: 200,
      label: "Wide scene"
    };

    expect(fittedCanvasCardSize(sceneCard, { selected: true })).toEqual({
      width: 320,
      height: 200
    });
  });

  it("keeps authored size under the overview zoom floor", () => {
    expect(
      fittedCanvasCardSize(openingSceneCard, { selected: false, zoom: 0.35 })
    ).toEqual({ width: 160, height: 80 });
    expect(
      fittedCanvasCardSize(
        { ...openingSceneCard, width: 260, height: 160 },
        { selected: true, zoom: 0.2 }
      )
    ).toEqual({ width: 260, height: 160 });
  });
});

describe("needsCanvasCardFit", () => {
  it("returns true when fitted exceeds current by more than slack", () => {
    expect(
      needsCanvasCardFit({ width: 100, height: 80 }, { width: 103, height: 80 })
    ).toBe(true);
    expect(
      needsCanvasCardFit({ width: 100, height: 80 }, { width: 100, height: 83 })
    ).toBe(true);
  });

  it("returns false when fitted is within slack of current", () => {
    expect(
      needsCanvasCardFit({ width: 100, height: 80 }, { width: 102, height: 82 }, 2)
    ).toBe(false);
    expect(
      needsCanvasCardFit({ width: 100, height: 80 }, { width: 100, height: 80 })
    ).toBe(false);
  });
});

describe("resizeCursorForEdge", () => {
  it("maps north and south edges to ns-resize", () => {
    expect(resizeCursorForEdge("n")).toBe("ns-resize");
    expect(resizeCursorForEdge("s")).toBe("ns-resize");
  });

  it("maps east and west edges to ew-resize", () => {
    expect(resizeCursorForEdge("e")).toBe("ew-resize");
    expect(resizeCursorForEdge("w")).toBe("ew-resize");
  });

  it("maps northeast and southwest edges to nesw-resize", () => {
    expect(resizeCursorForEdge("ne")).toBe("nesw-resize");
    expect(resizeCursorForEdge("sw")).toBe("nesw-resize");
  });

  it("maps northwest and southeast edges to nwse-resize", () => {
    expect(resizeCursorForEdge("nw")).toBe("nwse-resize");
    expect(resizeCursorForEdge("se")).toBe("nwse-resize");
  });
});

describe("resizeObjectByEdge", () => {
  const origin = { x: 40, y: 60, width: 200, height: 120 };
  const minSize = { width: 160, height: 96 };

  it("grows width when dragging the east edge", () => {
    expect(resizeObjectByEdge(origin, "e", 30, 0, minSize)).toEqual({
      x: 40,
      y: 60,
      width: 230,
      height: 120
    });
  });

  it("moves x and adjusts width when dragging the west edge", () => {
    expect(resizeObjectByEdge(origin, "w", 20, 0, minSize)).toEqual({
      x: 60,
      y: 60,
      width: 180,
      height: 120
    });
    expect(resizeObjectByEdge(origin, "w", -40, 0, minSize)).toEqual({
      x: 0,
      y: 60,
      width: 240,
      height: 120
    });
  });

  it("moves y and adjusts height when dragging the north edge", () => {
    expect(resizeObjectByEdge(origin, "n", 0, 24, minSize)).toEqual({
      x: 40,
      y: 84,
      width: 200,
      height: 96
    });
  });

  it("respects minSize when shrinking", () => {
    expect(resizeObjectByEdge(origin, "e", -100, 0, minSize)).toEqual({
      x: 40,
      y: 60,
      width: 160,
      height: 120
    });
    expect(resizeObjectByEdge(origin, "n", 0, 200, minSize)).toEqual({
      x: 40,
      y: 84,
      width: 200,
      height: 96
    });
  });
});

describe("attachPointOnFrame", () => {
  const frame = { left: 100, top: 50, width: 200, height: 120 };

  it("returns midpoints on each frame edge", () => {
    expect(attachPointOnFrame(frame, "n")).toEqual({ x: 200, y: 50 });
    expect(attachPointOnFrame(frame, "e")).toEqual({ x: 300, y: 110 });
    expect(attachPointOnFrame(frame, "s")).toEqual({ x: 200, y: 170 });
    expect(attachPointOnFrame(frame, "w")).toEqual({ x: 100, y: 110 });
  });
});

describe("nearestAttachPair", () => {
  const from = { left: 100, top: 50, width: 200, height: 120 };

  it("uses east and west ports when the target is to the right", () => {
    const to = { left: 400, top: 50, width: 200, height: 120 };

    expect(nearestAttachPair(from, to)).toEqual({
      fromSide: "e",
      toSide: "w"
    });
  });

  it("uses south and north ports when the target is below", () => {
    const to = { left: 100, top: 250, width: 200, height: 120 };

    expect(nearestAttachPair(from, to)).toEqual({
      fromSide: "s",
      toSide: "n"
    });
  });

  it("uses west and east ports when the target is to the left", () => {
    const to = { left: -200, top: 50, width: 200, height: 120 };

    expect(nearestAttachPair(from, to)).toEqual({
      fromSide: "w",
      toSide: "e"
    });
  });

  it("uses north and south ports when the target is above", () => {
    const to = { left: 100, top: -150, width: 200, height: 120 };

    expect(nearestAttachPair(from, to)).toEqual({
      fromSide: "n",
      toSide: "s"
    });
  });
});

describe("withLiveCanvasGeometry", () => {
  const object = {
    id: "scene-1",
    x: 10,
    y: 20,
    width: 200,
    height: 120
  };

  it("returns the object unchanged when live geometry is undefined", () => {
    expect(withLiveCanvasGeometry(object, undefined)).toBe(object);
    expect(withLiveCanvasGeometry(object, undefined)).toEqual(object);
  });

  it("merges live x/y/width/height onto the object", () => {
    expect(
      withLiveCanvasGeometry(object, { x: 30, y: 40, width: 240, height: 160 })
    ).toEqual({
      id: "scene-1",
      x: 30,
      y: 40,
      width: 240,
      height: 160
    });
  });
});

describe("liveGeometryEquals", () => {
  const geometry = { x: 10, y: 20, width: 200, height: 120 };

  it("returns true when both sides are undefined", () => {
    expect(liveGeometryEquals(undefined, undefined)).toBe(true);
  });

  it("returns true when all fields match", () => {
    expect(liveGeometryEquals(geometry, { ...geometry })).toBe(true);
  });

  it("returns false when one side is undefined", () => {
    expect(liveGeometryEquals(geometry, undefined)).toBe(false);
    expect(liveGeometryEquals(undefined, geometry)).toBe(false);
  });

  it("returns false when any field differs", () => {
    expect(liveGeometryEquals(geometry, { ...geometry, x: 11 })).toBe(false);
    expect(liveGeometryEquals(geometry, { ...geometry, y: 21 })).toBe(false);
    expect(liveGeometryEquals(geometry, { ...geometry, width: 201 })).toBe(
      false
    );
    expect(liveGeometryEquals(geometry, { ...geometry, height: 121 })).toBe(
      false
    );
  });
});

describe("splitToolTip", () => {
  it("splits name and shortcut when the tip contains a middle dot", () => {
    expect(splitToolTip("Pan · Space / middle-drag")).toEqual({
      name: "Pan",
      shortcut: "Space / middle-drag"
    });
  });

  it("returns only the name when the tip has no middle dot", () => {
    expect(splitToolTip("Select")).toEqual({ name: "Select" });
  });
});

describe("pushRecentCanvasAction", () => {
  function action(
    id: string,
    canUndo = true,
    createdAt = 1
  ): RecentCanvasAction {
    return {
      id,
      title: id,
      detail: `${id} detail`,
      createdAt,
      canUndo
    };
  }

  it("prepends the new action", () => {
    const result = pushRecentCanvasAction([action("older")], {
      id: "new",
      title: "New action",
      detail: "Just happened",
      createdAt: 2,
      canUndo: true
    });

    expect(result.map((entry) => entry.id)).toEqual(["new", "older"]);
    expect(result[0]).toMatchObject({
      title: "New action",
      detail: "Just happened",
      canUndo: true
    });
  });

  it("clears canUndo on prior actions that were undoable", () => {
    const result = pushRecentCanvasAction(
      [action("first", true), action("second", false)],
      {
        id: "latest",
        title: "Latest",
        detail: "Latest detail",
        createdAt: 3,
        canUndo: true
      }
    );

    expect(result[0]?.canUndo).toBe(true);
    expect(result[1]?.canUndo).toBe(false);
    expect(result[2]?.canUndo).toBe(false);
  });

  it("respects the recent-action limit", () => {
    const current = Array.from({ length: 5 }, (_, index) =>
      action(`action-${index}`, false, index)
    );

    const result = pushRecentCanvasAction(
      current,
      {
        id: "head",
        title: "Head",
        detail: "Head detail",
        createdAt: 99,
        canUndo: true
      },
      3
    );

    expect(result).toHaveLength(3);
    expect(result.map((entry) => entry.id)).toEqual(["head", "action-0", "action-1"]);
  });

  it("honors canUndo: false on the incoming action", () => {
    const result = pushRecentCanvasAction([], {
      id: "locked",
      title: "Locked",
      detail: "Cannot undo",
      createdAt: 1,
      canUndo: false
    });

    expect(result[0]?.canUndo).toBe(false);
  });
});
