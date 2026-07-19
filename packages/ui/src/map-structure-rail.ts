export type MapStructureWorkspaceMode = "draft" | "canvas" | "split";

export type MapStructureRailMode = "collapsed" | "expanded";

export const MAP_STRUCTURE_COLLAPSED_WIDTH = 36;
export const MAP_STRUCTURE_EXPANDED_WIDTH = 252;

/** Wide Map / Split defaults to collapsed structure for board real estate. */
export function defaultMapStructureRail(
  mode: MapStructureWorkspaceMode,
  wide: boolean
): MapStructureRailMode {
  if (!wide) return "expanded";
  return mode === "canvas" || mode === "split" ? "collapsed" : "expanded";
}

export function toggleMapStructureRail(
  current: MapStructureRailMode
): MapStructureRailMode {
  return current === "collapsed" ? "expanded" : "collapsed";
}

export function mapStructureRailWidth(
  mode: MapStructureRailMode,
  wide: boolean,
  fullWidth = MAP_STRUCTURE_EXPANDED_WIDTH
): number {
  if (!wide) return fullWidth;
  return mode === "collapsed"
    ? MAP_STRUCTURE_COLLAPSED_WIDTH
    : fullWidth;
}

export function mapStructureQuickBuildVisible(
  mode: MapStructureWorkspaceMode,
  structureRail: MapStructureRailMode
): boolean {
  if (mode === "draft") return true;
  return structureRail === "expanded";
}
