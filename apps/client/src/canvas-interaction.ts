import type { CanvasObject, CanvasObjectId } from "@ghostwriter/core";
import type { CanvasTool, CanvasViewport } from "./canvas-model.js";

export type CanvasToolDefinition = Readonly<{
  tool: CanvasTool;
  label: string;
  shortcut: string;
  glyph: string;
}>;

export const CANVAS_TOOL_DEFINITIONS: readonly CanvasToolDefinition[] = [
  { tool: "select", label: "Select", shortcut: "V", glyph: "V" },
  { tool: "hand", label: "Hand", shortcut: "H", glyph: "H" },
  { tool: "scene", label: "Scene", shortcut: "S", glyph: "S" },
  { tool: "note", label: "Note", shortcut: "N", glyph: "N" },
  { tool: "story", label: "Story record", shortcut: "K", glyph: "K" },
  { tool: "image", label: "Image reference", shortcut: "I", glyph: "I" },
  { tool: "region", label: "Region", shortcut: "R", glyph: "R" },
  { tool: "connect", label: "Connect", shortcut: "L", glyph: "L" }
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
  excludeId?: CanvasObjectId
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
    const left = (object.x - viewport.x) * viewport.zoom;
    const top = (object.y - viewport.y) * viewport.zoom;
    const width = object.width * viewport.zoom;
    const height = object.height * viewport.zoom;
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

export function shouldDragObjects(
  activeTool: CanvasTool,
  spaceHeld: boolean
): boolean {
  return activeTool === "select" && !spaceHeld;
}
