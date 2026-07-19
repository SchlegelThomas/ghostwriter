import type { CanvasObject } from "@ghostwriter/core";

export type RecentCanvasActionTone = "info" | "warning" | "error";

export type RecentCanvasAction = Readonly<{
  id: string;
  title: string;
  detail: string;
  createdAt: number;
  canUndo: boolean;
  tone?: RecentCanvasActionTone;
  actionLabel?: string;
  actionKind?: "undo" | "reload-canvas";
}>;

export type SurfaceRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

/** Convert page/client coordinates into a surface-local point for overlays. */
export function surfaceLocalPoint(
  pageX: number,
  pageY: number,
  surface: SurfaceRect
): Readonly<{ x: number; y: number }> {
  return {
    x: pageX - surface.left,
    y: pageY - surface.top
  };
}

/** Keep a context menu inside the surface with a small gap from the anchor. */
export function clampMenuPosition(
  x: number,
  y: number,
  surface: Readonly<{ width: number; height: number }>,
  menu: Readonly<{ width: number; height: number }> = {
    width: 220,
    height: 280
  }
): Readonly<{ x: number; y: number }> {
  return {
    x: Math.min(Math.max(8, x), Math.max(8, surface.width - menu.width - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, surface.height - menu.height - 8))
  };
}

/** Anchor an object menu just outside the card’s screen frame. */
export function cardMenuAnchor(
  frame: Readonly<{ left: number; top: number; width: number; height: number }>
): Readonly<{ x: number; y: number }> {
  return {
    x: frame.left + frame.width + 8,
    y: frame.top
  };
}

export type CanvasCardFitOptions = Readonly<{
  selected?: boolean;
  sceneCard?: boolean;
  /** Current board zoom — content is screen-sized, so mins grow when zoomed out. */
  zoom?: number;
  detailLines?: number;
  hasActionRow?: boolean;
  hasHint?: boolean;
}>;

/**
 * Minimum world size so card chrome/content fits at the current zoom.
 * Text/padding do not scale with zoom, so world mins must compensate.
 */
export function fittedCanvasCardSize(
  object: Pick<CanvasObject, "width" | "height" | "kind" | "label">,
  options: CanvasCardFitOptions = {}
): Readonly<{ width: number; height: number }> {
  const selected = options.selected === true;
  const sceneCard =
    options.sceneCard === true || object.kind === "scene-card";
  const zoom = Math.max(0.35, options.zoom ?? 1);
  const detailLines = options.detailLines ?? (selected ? 2 : 3);
  const hasActionRow = options.hasActionRow ?? selected;
  // Hints live in accessibility/tooltips — not as overflow-prone card body text.
  const hasHint = options.hasHint ?? false;

  // Approximate screen-pixel budget for in-card chrome (fonts stay ~constant).
  let screenMinWidth = 188;
  let screenMinHeight = 96;

  if (object.kind === "note") {
    screenMinWidth = 200;
    screenMinHeight = 112;
  } else if (object.kind === "region") {
    screenMinWidth = 240;
    screenMinHeight = 120;
  } else if (object.kind === "image-reference") {
    screenMinWidth = 220;
    screenMinHeight = 128;
  } else if (sceneCard) {
    screenMinWidth = 220;
    screenMinHeight = 118;
  } else if (object.kind === "story-knowledge-card") {
    screenMinWidth = 220;
    screenMinHeight = 112;
  }

  // Badge + title (+ wrap) + detail + optional hint + action row + padding.
  screenMinHeight += Math.min(28, Math.ceil(object.label.length / 18) * 14);
  screenMinHeight += detailLines * 13;
  if (hasHint) screenMinHeight += 28;
  if (hasActionRow) screenMinHeight += sceneCard ? 34 : 30;
  if (selected) {
    screenMinWidth = Math.max(screenMinWidth, sceneCard ? 248 : 220);
  }

  const minWidth = Math.max(160, Math.ceil(screenMinWidth / zoom));
  const minHeight = Math.max(96, Math.ceil(screenMinHeight / zoom));

  return {
    width: Math.max(object.width, minWidth),
    height: Math.max(object.height, minHeight)
  };
}

export function needsCanvasCardFit(
  current: Readonly<{ width: number; height: number }>,
  fitted: Readonly<{ width: number; height: number }>,
  slack = 2
): boolean {
  return (
    fitted.width > current.width + slack ||
    fitted.height > current.height + slack
  );
}

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export function resizeCursorForEdge(edge: ResizeEdge): string {
  switch (edge) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "nw":
    case "se":
      return "nwse-resize";
  }
}

export function resizeObjectByEdge(
  origin: Readonly<{ x: number; y: number; width: number; height: number }>,
  edge: ResizeEdge,
  worldDx: number,
  worldDy: number,
  minSize: Readonly<{ width: number; height: number }>
): Readonly<{ x: number; y: number; width: number; height: number }> {
  let { x, y, width, height } = origin;
  const minW = Math.max(120, minSize.width);
  const minH = Math.max(88, minSize.height);

  if (edge.includes("e")) {
    width = Math.max(minW, origin.width + worldDx);
  }
  if (edge.includes("s")) {
    height = Math.max(minH, origin.height + worldDy);
  }
  if (edge.includes("w")) {
    const nextWidth = Math.max(minW, origin.width - worldDx);
    x = origin.x + (origin.width - nextWidth);
    width = nextWidth;
  }
  if (edge.includes("n")) {
    const nextHeight = Math.max(minH, origin.height - worldDy);
    y = origin.y + (origin.height - nextHeight);
    height = nextHeight;
  }

  return { x, y, width, height };
}

/** Split "Name · shortcut" tips into readable layers for the floating tooltip. */
export function splitToolTip(tip: string): Readonly<{
  name: string;
  shortcut?: string;
}> {
  const parts = tip
    .split("·")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length >= 2) {
    return { name: parts[0]!, shortcut: parts.slice(1).join(" · ") };
  }
  return { name: tip.trim() };
}

export type LiveCanvasGeometry = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

/** Overlay optimistic drag/resize geometry onto a board object for rendering. */
export function withLiveCanvasGeometry<
  T extends LiveCanvasGeometry
>(object: T, live: LiveCanvasGeometry | undefined): T {
  return live === undefined ? object : { ...object, ...live };
}

export function liveGeometryEquals(
  left: LiveCanvasGeometry | undefined,
  right: LiveCanvasGeometry | undefined
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

export type AttachSide = "n" | "e" | "s" | "w";

export const ATTACH_SIDES: readonly AttachSide[] = ["n", "e", "s", "w"];

export function attachPointOnFrame(
  frame: Readonly<{ left: number; top: number; width: number; height: number }>,
  side: AttachSide
): Readonly<{ x: number; y: number }> {
  switch (side) {
    case "n":
      return { x: frame.left + frame.width / 2, y: frame.top };
    case "e":
      return {
        x: frame.left + frame.width,
        y: frame.top + frame.height / 2
      };
    case "s":
      return {
        x: frame.left + frame.width / 2,
        y: frame.top + frame.height
      };
    case "w":
      return { x: frame.left, y: frame.top + frame.height / 2 };
  }
}

/** Pick opposing mid-side ports for a straight relationship between two frames. */
export function nearestAttachPair(
  from: Readonly<{ left: number; top: number; width: number; height: number }>,
  to: Readonly<{ left: number; top: number; width: number; height: number }>
): Readonly<{ fromSide: AttachSide; toSide: AttachSide }> {
  const fromCenter = {
    x: from.left + from.width / 2,
    y: from.top + from.height / 2
  };
  const toCenter = {
    x: to.left + to.width / 2,
    y: to.top + to.height / 2
  };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { fromSide: "e", toSide: "w" }
      : { fromSide: "w", toSide: "e" };
  }
  return dy >= 0
    ? { fromSide: "s", toSide: "n" }
    : { fromSide: "n", toSide: "s" };
}

export function pushRecentCanvasAction(
  current: readonly RecentCanvasAction[],
  next: Omit<RecentCanvasAction, "canUndo"> &
    Readonly<{ canUndo?: boolean }>,
  limit = 40
): readonly RecentCanvasAction[] {
  const canUndo = next.canUndo === true;
  const head: RecentCanvasAction = {
    id: next.id,
    title: next.title,
    detail: next.detail,
    createdAt: next.createdAt,
    canUndo,
    ...(next.tone === undefined ? {} : { tone: next.tone }),
    ...(next.actionLabel === undefined ? {} : { actionLabel: next.actionLabel }),
    ...(next.actionKind === undefined ? {} : { actionKind: next.actionKind })
  };
  return [
    head,
    ...current.map((action) =>
      action.canUndo ? { ...action, canUndo: false } : action
    )
  ].slice(0, limit);
}
