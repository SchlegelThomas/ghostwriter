import type {
  BookId,
  CanvasBoard,
  CanvasLink,
  CanvasObject,
  CanvasObjectId,
  CanvasReadingOrderSpine,
  CanvasRevisionMetadata,
  CanvasSpineDrift,
  ChapterId,
  PartId,
  ProjectNavigator,
  ProjectNavigatorKnowledge,
  SceneId
} from "@ghostwriter/core";

export type CanvasViewport = Readonly<{
  x: number;
  y: number;
  zoom: number;
}>;

export type CanvasViewportSize = Readonly<{
  width: number;
  height: number;
}>;

export type CanvasScreenFrame = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type CanvasOutlineItem = Readonly<{
  object: CanvasObject;
  authorityLabel: "Confirmed" | "Provisional fixture";
  stateLabel: "Active" | "Archived" | "Dismissed";
  positionLabel: string;
  orderLabel?: string;
}>;

export type CanvasFailureDisposition =
  | "reload-board"
  | "reload-project-and-board"
  | "preserve-board";

export type CanvasCanonicalReferenceState = Readonly<{
  stale: boolean;
  label?: string;
}>;

export type CanvasTool =
  | "select"
  | "hand"
  | "scene"
  | "note"
  | "story"
  | "image"
  | "region"
  | "connect";

export type CanvasChapterAggregate = Readonly<{
  bookId: BookId;
  partId: PartId;
  chapterId: ChapterId;
  title: string;
  sceneCount: number;
  placedSceneCount: number;
  linkCount: number;
}>;

export type CanvasSceneFocus = Readonly<{
  sceneId: SceneId;
  title: string;
  summary?: string;
  placed: boolean;
  inboundLinks: number;
  outboundLinks: number;
}>;

export type CanvasHandoffPlacement =
  | Readonly<{
      kind: "chapter";
      bookId: BookId;
      chapterId: ChapterId;
      position?: number;
    }>
  | Readonly<{
      kind: "unassigned";
      bookId: BookId;
      position?: number;
    }>;

/** Low enough for board overview; card fit no longer holds constant screen size below ~0.65. */
export const CANVAS_VIEW_MIN_ZOOM = 0.12;
export const CANVAS_VIEW_MAX_ZOOM = 2.5;

export function clampCanvasZoom(zoom: number): number {
  return Math.min(CANVAS_VIEW_MAX_ZOOM, Math.max(CANVAS_VIEW_MIN_ZOOM, zoom));
}

/** Zoom while keeping the world point under a screen coordinate stable. */
export function zoomViewportAtScreenPoint(
  viewport: CanvasViewport,
  screenX: number,
  screenY: number,
  nextZoom: number
): CanvasViewport {
  const zoom = clampCanvasZoom(nextZoom);
  const worldX = viewport.x + screenX / viewport.zoom;
  const worldY = viewport.y + screenY / viewport.zoom;
  return {
    x: worldX - screenX / zoom,
    y: worldY - screenY / zoom,
    zoom
  };
}

export function canvasToolInstruction(tool: CanvasTool): string {
  switch (tool) {
    case "select":
      return "Drag cards freely. Drag empty board to pan. Pinch or Ctrl+scroll to zoom.";
    case "hand":
      return "Drag the board to pan. Pinch or Ctrl+scroll to zoom. Space also pans in Select.";
    case "scene":
      return "Choose manuscript placement, then create one scene in Canvas and Draft.";
    case "note":
      return "Place a writer note at the next visible board position.";
    case "story":
      return "Choose one active story record to place as a confirmed card.";
    case "image":
      return "Place an image reference, then add alt text and caption in Details.";
    case "region":
      return "Place a region behind cards to name a story area.";
    case "connect":
      return "Drag from a card’s out-handle to a target, or finish the link in Details.";
  }
}

export function fitCanvasObjects(
  objects: readonly Pick<CanvasObject, "x" | "y" | "width" | "height">[],
  size: CanvasViewportSize,
  padding = 48
): CanvasViewport {
  if (objects.length === 0 || size.width <= 0 || size.height <= 0) {
    return { x: 0, y: 0, zoom: 1 };
  }
  const left = Math.min(...objects.map((object) => object.x));
  const top = Math.min(...objects.map((object) => object.y));
  const right = Math.max(...objects.map((object) => object.x + object.width));
  const bottom = Math.max(...objects.map((object) => object.y + object.height));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const zoom = clampCanvasZoom(
    Math.min(
      Math.max(1, size.width - padding * 2) / width,
      Math.max(1, size.height - padding * 2) / height
    )
  );
  return {
    x: Math.round(left - padding / zoom),
    y: Math.round(top - padding / zoom),
    zoom
  };
}

export function searchCanvasObjects(
  objects: readonly CanvasObject[],
  query: string
): readonly CanvasObject[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) return [];
  return objects.filter((object) =>
    [object.label, object.note?.body, object.image?.caption, object.image?.altText]
      .filter((value): value is string => value !== undefined)
      .some((value) => value.toLocaleLowerCase().includes(normalized))
  );
}

export function canvasChapterAggregates(
  project: ProjectNavigator,
  board: CanvasBoard
): readonly CanvasChapterAggregate[] {
  const activeObjects = board.objects.filter(
    (object) => object.archivedAt === undefined && object.dismissedAt === undefined
  );
  return project.books.flatMap((book) =>
    book.parts.flatMap((part) =>
      part.chapters.map((chapter) => {
        const sceneIds = new Set(
          chapter.scenes
            .filter((scene) => scene.archivedAt === undefined)
            .map((scene) => scene.id)
        );
        const objectIds = new Set(
          activeObjects
            .filter(
              (object) =>
                object.kind === "scene-card" &&
                object.sceneId !== undefined &&
                sceneIds.has(object.sceneId)
            )
            .map((object) => object.id)
        );
        return {
          bookId: book.id,
          partId: part.id,
          chapterId: chapter.id,
          title: chapter.title,
          sceneCount: sceneIds.size,
          placedSceneCount: objectIds.size,
          linkCount: board.links.filter(
            (link) =>
              link.archivedAt === undefined &&
              (objectIds.has(link.fromObjectId) || objectIds.has(link.toObjectId))
          ).length
        };
      })
    )
  );
}

export function canvasSceneFocus(
  project: ProjectNavigator,
  board: CanvasBoard,
  sceneId: SceneId
): CanvasSceneFocus | undefined {
  const scene = project.books
    .flatMap((book) => [
      ...book.parts.flatMap((part) =>
        part.chapters.flatMap((chapter) => chapter.scenes)
      ),
      ...book.unassignedScenes
    ])
    .find((candidate) => candidate.id === sceneId);
  if (scene === undefined) return undefined;
  const object = board.objects.find(
    (candidate) =>
      candidate.kind === "scene-card" &&
      candidate.sceneId === sceneId &&
      candidate.archivedAt === undefined
  );
  const links: readonly CanvasLink[] =
    object === undefined
      ? []
      : board.links.filter((link) => link.archivedAt === undefined);
  return {
    sceneId,
    title: scene.title,
    ...(scene.summary === undefined ? {} : { summary: scene.summary }),
    placed: object !== undefined,
    inboundLinks:
      object === undefined
        ? 0
        : links.filter((link) => link.toObjectId === object.id).length,
    outboundLinks:
      object === undefined
        ? 0
        : links.filter((link) => link.fromObjectId === object.id).length
  };
}

export function canvasScreenFrame(
  object: Pick<CanvasObject, "x" | "y" | "width" | "height">,
  viewport: CanvasViewport
): CanvasScreenFrame {
  return {
    left: (object.x - viewport.x) * viewport.zoom,
    top: (object.y - viewport.y) * viewport.zoom,
    width: object.width * viewport.zoom,
    height: object.height * viewport.zoom
  };
}

export function canvasPositionAfterDrag(
  start: Readonly<{ x: number; y: number }>,
  screenDelta: Readonly<{ x: number; y: number }>,
  zoom: number
): Readonly<{ x: number; y: number }> {
  const safeZoom = clampCanvasZoom(zoom);
  return {
    x: Math.round(start.x + screenDelta.x / safeZoom),
    y: Math.round(start.y + screenDelta.y / safeZoom)
  };
}

export function visibleCanvasObjects(
  objects: readonly CanvasObject[],
  viewport: CanvasViewport,
  size: CanvasViewportSize,
  padding = 120
): readonly CanvasObject[] {
  const worldLeft = viewport.x - padding / viewport.zoom;
  const worldTop = viewport.y - padding / viewport.zoom;
  const worldRight = viewport.x + (size.width + padding) / viewport.zoom;
  const worldBottom = viewport.y + (size.height + padding) / viewport.zoom;

  return objects.filter(
    (object) =>
      object.x + object.width >= worldLeft &&
      object.y + object.height >= worldTop &&
      object.x <= worldRight &&
      object.y <= worldBottom
  );
}

/**
 * Soft default placement near the viewport center with a light spiral offset.
 * Intentionally not a column grid — writers drag freely after create.
 */
export function canvasCapturePosition(
  objectIndex: number,
  viewport: CanvasViewport,
  size: CanvasViewportSize
): Readonly<{ x: number; y: number }> {
  const zoom = clampCanvasZoom(viewport.zoom);
  const worldWidth = Math.max(1, size.width / zoom);
  const worldHeight = Math.max(1, size.height / zoom);
  const normalizedIndex = Math.max(0, Math.floor(objectIndex));
  const centerX = viewport.x + worldWidth * 0.5 - 130;
  const centerY = viewport.y + worldHeight * 0.5 - 80;
  const angle = normalizedIndex * 2.399963;
  const radius = 24 + (normalizedIndex % 7) * 22;

  return {
    x: Math.round(centerX + Math.cos(angle) * radius),
    y: Math.round(centerY + Math.sin(angle) * radius)
  };
}

export function canvasWorldPointFromScreen(
  viewport: CanvasViewport,
  screenX: number,
  screenY: number
): Readonly<{ x: number; y: number }> {
  const zoom = clampCanvasZoom(viewport.zoom);
  return {
    x: viewport.x + screenX / zoom,
    y: viewport.y + screenY / zoom
  };
}

export function canvasDriftLabel(drift: CanvasSpineDrift): string {
  switch (drift) {
    case "aligned":
      return "Aligned with Draft";
    case "no-hint":
      return "No Canvas order hint";
    case "earlier-on-canvas":
      return "Earlier on Canvas";
    case "later-on-canvas":
      return "Later on Canvas";
    case "not-placed":
      return "Not placed";
  }
}

export function canvasCanonicalReferenceState(
  object: CanvasObject,
  project: ProjectNavigator
): CanvasCanonicalReferenceState {
  if (object.kind === "scene-card") {
    const scene = project.books
      .flatMap((book) => [
        ...book.parts.flatMap((part) =>
          part.chapters.flatMap((chapter) => chapter.scenes)
        ),
        ...book.unassignedScenes
      ])
      .find((candidate) => candidate.id === object.sceneId);
    if (scene === undefined) {
      return { stale: true, label: "Scene unavailable · stale reference" };
    }
    if (scene.archivedAt !== undefined) {
      return { stale: true, label: "Archived scene · stale reference" };
    }
  }
  if (object.kind === "story-knowledge-card") {
    const knowledge = project.storyKnowledge.find(
      (candidate) => candidate.id === object.storyKnowledgeId
    );
    if (knowledge === undefined) {
      return {
        stale: true,
        label: "Story record unavailable · stale reference"
      };
    }
    if (knowledge.archivedAt !== undefined) {
      return { stale: true, label: "Archived story record · stale reference" };
    }
  }
  return { stale: false };
}

export function availableCanvasStoryKnowledge(
  project: ProjectNavigator,
  board: CanvasBoard
): readonly ProjectNavigatorKnowledge[] {
  const placedKnowledgeIds = new Set(
    board.objects.flatMap((object) =>
      object.kind === "story-knowledge-card" &&
      object.storyKnowledgeId !== undefined
        ? [object.storyKnowledgeId]
        : []
    )
  );
  return project.storyKnowledge.filter(
    (knowledge) =>
      knowledge.archivedAt === undefined && !placedKnowledgeIds.has(knowledge.id)
  );
}

export function canonicalIndexForCanvasHandoff(
  project: ProjectNavigator,
  placement: CanvasHandoffPlacement
): number | undefined {
  let canonicalIndex = 0;
  for (const book of project.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        if (
          placement.kind === "chapter" &&
          placement.bookId === book.id &&
          placement.chapterId === chapter.id
        ) {
          const position = placement.position ?? chapter.scenes.length;
          return Number.isSafeInteger(position) &&
            position >= 0 &&
            position <= chapter.scenes.length
            ? canonicalIndex + position
            : undefined;
        }
        canonicalIndex += chapter.scenes.length;
      }
    }
    if (placement.kind === "unassigned" && placement.bookId === book.id) {
      const position = placement.position ?? book.unassignedScenes.length;
      return Number.isSafeInteger(position) &&
        position >= 0 &&
        position <= book.unassignedScenes.length
        ? canonicalIndex + position
        : undefined;
    }
    canonicalIndex += book.unassignedScenes.length;
  }
  return undefined;
}

export function preferredCanvasSceneId(
  board: CanvasBoard,
  selectedObjectId: CanvasObjectId | undefined
): SceneId | undefined {
  if (selectedObjectId === undefined) return undefined;
  const object = board.objects.find((candidate) => candidate.id === selectedObjectId);
  return object?.kind === "scene-card" ? object.sceneId : undefined;
}

export function canvasHistoryLabel(revision: CanvasRevisionMetadata): string {
  if (revision.reason === "genesis") return "Canvas created";
  if (revision.reason === "restore") return "Earlier snapshot restored";
  if (revision.reason === "undo") return "Latest Canvas change undone";
  switch (revision.commandType) {
    case "canvas.object.create":
      return "Object created";
    case "canvas.object.place":
      return "Canonical card placed";
    case "canvas.object.update":
      return "Object details updated";
    case "canvas.object.move":
      return "Object moved";
    case "canvas.object.resize":
      return "Object resized";
    case "canvas.object.setScopePlacement":
      return "Scope placement updated";
    case "canvas.object.archive":
      return "Object archived";
    case "canvas.object.restore":
      return "Object restored";
    case "canvas.object.confirm":
      return "Provisional object confirmed";
    case "canvas.object.dismiss":
      return "Provisional object dismissed";
    case "canvas.link.create":
      return "Link created";
    case "canvas.link.update":
      return "Link details updated";
    case "canvas.link.archive":
      return "Link archived";
    case "canvas.link.restore":
      return "Link restored";
    case "canvas.link.confirm":
      return "Provisional link confirmed";
    case "canvas.link.dismiss":
      return "Provisional link dismissed";
    case undefined:
      return "Canvas updated";
  }
}

export function projectCanvasOutline(
  board: CanvasBoard,
  spine: CanvasReadingOrderSpine
): readonly CanvasOutlineItem[] {
  const spineByObjectId = new Map(
    spine.entries.flatMap((entry) =>
      entry.canvasObjectId === undefined
        ? []
        : [[entry.canvasObjectId, entry] as const]
    )
  );

  return [...board.objects]
    .sort((left, right) => {
      const leftSpine = spineByObjectId.get(left.id);
      const rightSpine = spineByObjectId.get(right.id);
      if (leftSpine !== undefined && rightSpine !== undefined) {
        return leftSpine.canonicalIndex - rightSpine.canonicalIndex;
      }
      if (leftSpine !== undefined) return -1;
      if (rightSpine !== undefined) return 1;
      if ((left.archivedAt === undefined) !== (right.archivedAt === undefined)) {
        return left.archivedAt === undefined ? -1 : 1;
      }
      return (
        left.z - right.z ||
        left.y - right.y ||
        left.x - right.x ||
        left.label.localeCompare(right.label)
      );
    })
    .map((object) => {
      const spineEntry = spineByObjectId.get(object.id);
      return {
        object,
        authorityLabel:
          object.authority === "confirmed"
            ? ("Confirmed" as const)
            : ("Provisional fixture" as const),
        stateLabel:
          object.dismissedAt !== undefined
            ? ("Dismissed" as const)
            : object.archivedAt !== undefined
              ? ("Archived" as const)
              : ("Active" as const),
        positionLabel: `x ${Math.round(object.x)}, y ${Math.round(object.y)} · ${Math.round(
          object.width
        )} × ${Math.round(object.height)}`,
        ...(spineEntry === undefined
          ? {}
          : {
              orderLabel: `Draft ${spineEntry.canonicalIndex + 1} · ${canvasDriftLabel(
                spineEntry.drift
              )}`
            })
      };
    });
}

export function canvasFailureDisposition(
  code: string | undefined
): CanvasFailureDisposition {
  if (code === "CANVAS_VERSION_CONFLICT") return "reload-board";
  if (code === "VERSION_CONFLICT") return "reload-project-and-board";
  return "preserve-board";
}
