import type { CanvasObject, CanvasObjectId } from "@ghostwriter/core";
import type { CanvasTool, CanvasViewport } from "./canvas-model.js";

export type CanvasToolDefinition = Readonly<{
  tool: CanvasTool;
  label: string;
  shortcut: string;
  glyph: string;
}>;

export const CANVAS_TOOL_DEFINITIONS: readonly CanvasToolDefinition[] = [
  { tool: "select", label: "Select", shortcut: "V", glyph: "↖" },
  { tool: "hand", label: "Hand", shortcut: "H", glyph: "✋" },
  { tool: "scene", label: "Scene", shortcut: "S", glyph: "◇" },
  { tool: "note", label: "Note", shortcut: "N", glyph: "▱" },
  { tool: "story", label: "Story record", shortcut: "K", glyph: "✦" },
  { tool: "image", label: "Image reference", shortcut: "I", glyph: "▧" },
  { tool: "region", label: "Region", shortcut: "R", glyph: "▢" },
  { tool: "connect", label: "Connect", shortcut: "L", glyph: "↗" }
];

export function canvasToolAccessibilityLabel(
  definition: CanvasToolDefinition
): string {
  return `${definition.label} · ${definition.shortcut}`;
}

export function canvasToolTip(definition: CanvasToolDefinition): string {
  return `${definition.label} · ${definition.shortcut}`;
}

export type LinkDragState = Readonly<{
  fromObjectId: CanvasObjectId;
  x: number;
  y: number;
}>;

export function objectAtScreenPoint(
  objects: readonly CanvasObject[],
  viewport: CanvasViewport,
  screenX: number,
  screenY: number,
  excludeId?: CanvasObjectId,
  /** Extra screen-space padding so edge drops still register. */
  hitPadding = 10
): CanvasObject | undefined {
  const candidates = objects
    .filter(
      (object) =>
        object.archivedAt === undefined &&
        object.id !== excludeId &&
        object.kind !== "region"
    )
    .sort((left, right) => right.z - left.z);

  for (const object of candidates) {
    const left = (object.x - viewport.x) * viewport.zoom - hitPadding;
    const top = (object.y - viewport.y) * viewport.zoom - hitPadding;
    const width = object.width * viewport.zoom + hitPadding * 2;
    const height = object.height * viewport.zoom + hitPadding * 2;
    if (
      screenX >= left &&
      screenX <= left + width &&
      screenY >= top &&
      screenY <= top + height
    ) {
      return object;
    }
  }
  return undefined;
}

export function panViewportByScreenDelta(
  viewport: CanvasViewport,
  dx: number,
  dy: number
): CanvasViewport {
  return {
    x: viewport.x - dx / viewport.zoom,
    y: viewport.y - dy / viewport.zoom,
    zoom: viewport.zoom
  };
}

export function shouldPanBoard(
  activeTool: CanvasTool,
  spaceHeld: boolean
): boolean {
  return activeTool === "hand" || spaceHeld;
}

/** Empty-board / middle-button pan — Select can pan the board without Hand. */
export function shouldBackgroundPanBoard(
  activeTool: CanvasTool,
  spaceHeld: boolean,
  options: Readonly<{
    linkDragging?: boolean;
    placeArmed?: boolean;
    middleButton?: boolean;
  }> = {}
): boolean {
  if (options.linkDragging) return false;
  if (options.middleButton) return true;
  if (spaceHeld || activeTool === "hand") return true;
  if (options.placeArmed) return false;
  return activeTool === "select";
}

export function shouldDragObjects(
  activeTool: CanvasTool,
  spaceHeld: boolean
): boolean {
  return activeTool === "select" && !spaceHeld;
}

export function isCanvasPlaceTool(tool: CanvasTool): boolean {
  return tool === "note" || tool === "region" || tool === "image";
}

/** CSS cursor for the board surface (RN-web). */
export function canvasBoardCursor(
  activeTool: CanvasTool,
  spaceHeld: boolean,
  options: Readonly<{ draggingObject?: boolean; panning?: boolean }> = {}
): string {
  if (options.draggingObject) return "grabbing";
  if (options.panning) return "grabbing";
  if (activeTool === "hand" || spaceHeld || activeTool === "select") {
    return "grab";
  }
  if (activeTool === "connect") return "crosshair";
  if (isCanvasPlaceTool(activeTool) || activeTool === "scene") return "crosshair";
  return "default";
}

export function pinchDistance(
  a: Readonly<{ x: number; y: number }>,
  b: Readonly<{ x: number; y: number }>
): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
