export type MapStructureWorkspaceMode = "draft" | "canvas" | "split";

export type MapStructureRailMode = "collapsed" | "expanded";

export const MAP_STRUCTURE_COLLAPSED_WIDTH = 36;
export const MAP_STRUCTURE_EXPANDED_WIDTH = 252;

/**
 * Map / Split defaults to collapsed structure whenever the layout can host a
 * thin rail (not narrow). Draft stays expanded for writing.
 */
export function defaultMapStructureRail(
  mode: MapStructureWorkspaceMode,
  collapsible: boolean
): MapStructureRailMode {
  if (!collapsible) return "expanded";
  return mode === "canvas" || mode === "split" ? "collapsed" : "expanded";
}

export function toggleMapStructureRail(
  current: MapStructureRailMode
): MapStructureRailMode {
  return current === "expanded" ? "collapsed" : "expanded";
}

export function mapStructureRailWidth(
  mode: MapStructureRailMode,
  collapsible: boolean,
  fullWidth = MAP_STRUCTURE_EXPANDED_WIDTH
): number {
  if (!collapsible) return fullWidth;
  return mode === "collapsed" ? MAP_STRUCTURE_COLLAPSED_WIDTH : fullWidth;
}

export function mapStructureQuickBuildVisible(
  mode: MapStructureWorkspaceMode,
  structureRail: MapStructureRailMode
): boolean {
  if (mode === "draft") return true;
  return structureRail === "expanded";
}

/** Map mode uses dense board-first chrome (trail in top bar, no center hero). */
export function mapBoardOwnsViewport(
  mode: MapStructureWorkspaceMode
): boolean {
  return mode === "canvas" || mode === "split";
}
