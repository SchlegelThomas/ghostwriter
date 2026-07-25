export type MapStructureWorkspaceMode = "draft" | "canvas" | "split";

export type MapStructureRailMode = "collapsed" | "expanded";

export const MAP_STRUCTURE_COLLAPSED_WIDTH = 36;
export const MAP_STRUCTURE_EXPANDED_WIDTH = 252;

/**
 * Shared manuscript structure rail for Draft / Canvas / Split whenever the
 * layout can host a thin rail (not narrow). Canvas / Split open collapsed so
 * the board leads; Draft opens expanded for writing. Collapse state then
 * persists across mode switches in the workspace shell.
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
  _structureRail: MapStructureRailMode
): boolean {
  // Draft keeps Quick Build in the center trail. Canvas / Split stay board-first —
  // add from the Explorer tree instead of a competing ＋ Add chrome control.
  return mode === "draft";
}

/** Map mode uses dense board-first chrome (trail in top bar, no center hero). */
export function mapBoardOwnsViewport(
  mode: MapStructureWorkspaceMode
): boolean {
  return mode === "canvas" || mode === "split";
}
