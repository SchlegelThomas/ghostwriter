import { describe, expect, it } from "vitest";
import {
  MAP_STRUCTURE_COLLAPSED_WIDTH,
  MAP_STRUCTURE_EXPANDED_WIDTH,
  defaultMapStructureRail,
  mapStructureQuickBuildVisible,
  mapStructureRailWidth,
  toggleMapStructureRail
} from "./map-structure-rail.js";

describe("defaultMapStructureRail", () => {
  it("collapses on wide canvas and split for board real estate", () => {
    expect(defaultMapStructureRail("canvas", true)).toBe("collapsed");
    expect(defaultMapStructureRail("split", true)).toBe("collapsed");
  });

  it("keeps draft expanded even on wide layouts", () => {
    expect(defaultMapStructureRail("draft", true)).toBe("expanded");
  });

  it("always expands when the workspace is not wide", () => {
    expect(defaultMapStructureRail("canvas", false)).toBe("expanded");
    expect(defaultMapStructureRail("split", false)).toBe("expanded");
    expect(defaultMapStructureRail("draft", false)).toBe("expanded");
  });
});

describe("toggleMapStructureRail", () => {
  it("switches between collapsed and expanded", () => {
    expect(toggleMapStructureRail("collapsed")).toBe("expanded");
    expect(toggleMapStructureRail("expanded")).toBe("collapsed");
  });
});

describe("mapStructureRailWidth", () => {
  it("uses 36px collapsed and 252px expanded on wide layouts", () => {
    expect(mapStructureRailWidth("collapsed", true)).toBe(
      MAP_STRUCTURE_COLLAPSED_WIDTH
    );
    expect(mapStructureRailWidth("expanded", true)).toBe(
      MAP_STRUCTURE_EXPANDED_WIDTH
    );
    expect(MAP_STRUCTURE_COLLAPSED_WIDTH).toBe(36);
    expect(MAP_STRUCTURE_EXPANDED_WIDTH).toBe(252);
  });

  it("uses full width when the workspace is not wide", () => {
    expect(mapStructureRailWidth("collapsed", false)).toBe(
      MAP_STRUCTURE_EXPANDED_WIDTH
    );
    expect(mapStructureRailWidth("expanded", false, 300)).toBe(300);
  });
});

describe("mapStructureQuickBuildVisible", () => {
  it("always shows quick build in draft", () => {
    expect(mapStructureQuickBuildVisible("draft", "collapsed")).toBe(true);
    expect(mapStructureQuickBuildVisible("draft", "expanded")).toBe(true);
  });

  it("shows quick build on canvas and split only when expanded", () => {
    expect(mapStructureQuickBuildVisible("canvas", "collapsed")).toBe(false);
    expect(mapStructureQuickBuildVisible("canvas", "expanded")).toBe(true);
    expect(mapStructureQuickBuildVisible("split", "collapsed")).toBe(false);
    expect(mapStructureQuickBuildVisible("split", "expanded")).toBe(true);
  });
});
