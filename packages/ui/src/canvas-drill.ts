import type {
  BookId,
  CanvasBoard,
  CanvasLink,
  CanvasObject,
  CanvasObjectId,
  ChapterId,
  PartId,
  ProjectNavigator,
  SceneId
} from "@ghostwriter/core";

export const CANVAS_CAMERA_TRANSITION_MS = 450;

/** Ease-out cubic for layer camera motion (Mockups 3.0). */
export function easeOutCubic(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return 1 - (1 - t) ** 3;
}
export const PROVISIONAL_BEAT_FIXTURE_SOURCE = "fixture:beat:first-turn";

export type CanvasViewport = Readonly<{
  x: number;
  y: number;
  zoom: number;
}>;

export type CanvasViewportSize = Readonly<{
  width: number;
  height: number;
}>;

export type CanvasBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type CanvasDrillScope =
  | Readonly<{ kind: "project" }>
  | Readonly<{
      kind: "chapter";
      bookId: BookId;
      partId: PartId;
      chapterId: ChapterId;
    }>
  | Readonly<{
      kind: "scene";
      bookId: BookId;
      sceneId: SceneId;
      partId?: PartId;
      chapterId?: ChapterId;
    }>;

export type CanvasDrillStack = readonly CanvasDrillScope[];

export type CanvasWorkflowLens =
  | "outline"
  | "relationships"
  | "continuity"
  | "plan-draft"
  | "review";

export const CANVAS_WORKFLOW_LENSES: readonly CanvasWorkflowLens[] = [
  "outline",
  "relationships",
  "continuity",
  "plan-draft",
  "review"
] as const;

export type CanvasDrillBreadcrumb = Readonly<{
  scope: CanvasDrillScope;
  label: string;
  focusKey: string;
}>;

export type CanvasChapterOverlay = Readonly<{
  scope: Extract<CanvasDrillScope, { kind: "chapter" }>;
  bounds: CanvasBounds;
  label: string;
}>;

export type CanvasLensProjection = Readonly<{
  objects: readonly CanvasObject[];
  links: readonly CanvasLink[];
  dimmedObjectIds: ReadonlySet<CanvasObjectId>;
  hiddenObjectIds: ReadonlySet<CanvasObjectId>;
  primaryObjectIds: ReadonlySet<CanvasObjectId>;
}>;

export function initialDrillStack(): CanvasDrillStack {
  return [{ kind: "project" }];
}

export function canvasDrillScopeKey(scope: CanvasDrillScope): string {
  switch (scope.kind) {
    case "project":
      return "project";
    case "chapter":
      return `chapter:${scope.bookId}:${scope.partId}:${scope.chapterId}`;
    case "scene":
      return `scene:${scope.sceneId}`;
  }
}

export function currentDrillScope(stack: CanvasDrillStack): CanvasDrillScope {
  return stack[stack.length - 1] ?? { kind: "project" };
}

export function drillIntoChapter(
  stack: CanvasDrillStack,
  scope: Extract<CanvasDrillScope, { kind: "chapter" }>
): CanvasDrillStack {
  const current = currentDrillScope(stack);
  if (
    current.kind === "chapter" &&
    current.chapterId === scope.chapterId &&
    current.bookId === scope.bookId &&
    current.partId === scope.partId
  ) {
    return stack;
  }
  if (current.kind === "scene") {
    return [...stack.slice(0, -1), scope];
  }
  return [...stack, scope];
}

export function drillIntoScene(
  stack: CanvasDrillStack,
  scope: Extract<CanvasDrillScope, { kind: "scene" }>
): CanvasDrillStack {
  const current = currentDrillScope(stack);
  if (current.kind === "scene" && current.sceneId === scope.sceneId) {
    return stack;
  }
  const next = [...stack];
  if (current.kind === "scene") {
    next.pop();
  }
  return [...next, scope];
}

export function drillBack(stack: CanvasDrillStack): CanvasDrillStack {
  if (stack.length <= 1) return stack;
  return stack.slice(0, -1);
}

export function drillToScope(
  stack: CanvasDrillStack,
  target: CanvasDrillScope
): CanvasDrillStack {
  const targetKey = canvasDrillScopeKey(target);
  const index = stack.findIndex(
    (scope) => canvasDrillScopeKey(scope) === targetKey
  );
  if (index < 0) return stack;
  return stack.slice(0, index + 1);
}

export function chapterScopeForScene(
  project: ProjectNavigator,
  sceneId: SceneId
): Extract<CanvasDrillScope, { kind: "chapter" }> | undefined {
  for (const book of project.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        if (chapter.scenes.some((scene) => scene.id === sceneId)) {
          return {
            kind: "chapter",
            bookId: book.id,
            partId: part.id,
            chapterId: chapter.id
          };
        }
      }
    }
  }
  return undefined;
}

export function sceneDrillScope(
  project: ProjectNavigator,
  sceneId: SceneId
): Extract<CanvasDrillScope, { kind: "scene" }> | undefined {
  for (const book of project.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        const scene = chapter.scenes.find((candidate) => candidate.id === sceneId);
        if (scene !== undefined) {
          return {
            kind: "scene",
            bookId: book.id,
            partId: part.id,
            chapterId: chapter.id,
            sceneId: scene.id
          };
        }
      }
    }
    const unassigned = book.unassignedScenes.find(
      (candidate) => candidate.id === sceneId
    );
    if (unassigned !== undefined) {
      return {
        kind: "scene",
        bookId: book.id,
        sceneId: unassigned.id
      };
    }
  }
  return undefined;
}

export function drillBreadcrumbs(
  stack: CanvasDrillStack,
  project: ProjectNavigator
): readonly CanvasDrillBreadcrumb[] {
  return stack.map((scope) => {
    switch (scope.kind) {
      case "project":
        return {
          scope,
          label: project.title,
          focusKey: "drill-breadcrumb-project"
        };
      case "chapter": {
        const chapter = project.books
          .find((book) => book.id === scope.bookId)
          ?.parts.find((part) => part.id === scope.partId)
          ?.chapters.find((candidate) => candidate.id === scope.chapterId);
        return {
          scope,
          label: chapter?.title ?? "Chapter",
          focusKey: `drill-breadcrumb-${scope.chapterId}`
        };
      }
      case "scene": {
        const scene = project.books
          .flatMap((book) => [
            ...book.parts.flatMap((part) =>
              part.chapters.flatMap((chapter) => chapter.scenes)
            ),
            ...book.unassignedScenes
          ])
          .find((candidate) => candidate.id === scope.sceneId);
        return {
          scope,
          label: scene?.title ?? "Scene",
          focusKey: `drill-breadcrumb-${scope.sceneId}`
        };
      }
    }
  });
}

function unionBounds(
  left: CanvasBounds | undefined,
  right: CanvasBounds
): CanvasBounds {
  if (left === undefined) return right;
  const x1 = Math.min(left.x, right.x);
  const y1 = Math.min(left.y, right.y);
  const x2 = Math.max(left.x + left.width, right.x + right.width);
  const y2 = Math.max(left.y + left.height, right.y + right.height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function objectBounds(object: CanvasObject): CanvasBounds {
  return {
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height
  };
}

function expandBounds(bounds: CanvasBounds, padding: number): CanvasBounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2
  };
}

export function boundsForObjects(
  objects: readonly CanvasObject[],
  padding = 48
): CanvasBounds | undefined {
  let bounds: CanvasBounds | undefined;
  for (const object of objects) {
    if (object.archivedAt !== undefined) continue;
    bounds = unionBounds(bounds, objectBounds(object));
  }
  return bounds === undefined ? undefined : expandBounds(bounds, padding);
}

function sceneIdsForChapter(
  project: ProjectNavigator,
  scope: Extract<CanvasDrillScope, { kind: "chapter" }>
): ReadonlySet<SceneId> {
  const chapter = project.books
    .find((book) => book.id === scope.bookId)
    ?.parts.find((part) => part.id === scope.partId)
    ?.chapters.find((candidate) => candidate.id === scope.chapterId);
  if (chapter === undefined) return new Set();
  return new Set(
    chapter.scenes
      .filter((scene) => scene.archivedAt === undefined)
      .map((scene) => scene.id)
  );
}

function activeObjects(board: CanvasBoard): readonly CanvasObject[] {
  return board.objects.filter((object) => object.archivedAt === undefined);
}

function activeLinks(board: CanvasBoard): readonly CanvasLink[] {
  return board.links.filter((link) => link.archivedAt === undefined);
}

export function chapterSceneCards(
  project: ProjectNavigator,
  board: CanvasBoard,
  scope: Extract<CanvasDrillScope, { kind: "chapter" }>
): readonly CanvasObject[] {
  const sceneIds = sceneIdsForChapter(project, scope);
  return activeObjects(board).filter(
    (object) =>
      object.kind === "scene-card" &&
      object.sceneId !== undefined &&
      sceneIds.has(object.sceneId)
  );
}

export function chapterBounds(
  project: ProjectNavigator,
  board: CanvasBoard,
  scope: Extract<CanvasDrillScope, { kind: "chapter" }>
): CanvasBounds | undefined {
  const sceneCards = chapterSceneCards(project, board, scope);
  const regions = activeObjects(board).filter((object) => {
    if (object.kind !== "region") return false;
    return sceneCards.some(
      (sceneCard) => sceneCard.parentRegionId === object.id
    );
  });
  return boundsForObjects([...sceneCards, ...regions]);
}

export function sceneBounds(
  board: CanvasBoard,
  sceneId: SceneId
): CanvasBounds | undefined {
  const sceneCard = activeObjects(board).find(
    (object) => object.kind === "scene-card" && object.sceneId === sceneId
  );
  if (sceneCard === undefined) return undefined;
  const region =
    sceneCard.parentRegionId === undefined
      ? undefined
      : activeObjects(board).find(
          (object) => object.id === sceneCard.parentRegionId
        );
  return boundsForObjects(
    region === undefined ? [sceneCard] : [sceneCard, region],
    32
  );
}

export function chapterBoundOverlays(
  project: ProjectNavigator,
  board: CanvasBoard
): readonly CanvasChapterOverlay[] {
  const overlays: CanvasChapterOverlay[] = [];
  for (const book of project.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        const scope = {
          kind: "chapter" as const,
          bookId: book.id,
          partId: part.id,
          chapterId: chapter.id
        };
        const bounds = chapterBounds(project, board, scope);
        if (bounds === undefined) continue;
        overlays.push({
          scope,
          bounds,
          label: chapter.title
        });
      }
    }
  }
  return overlays;
}

function linkedObjectIds(
  seedIds: ReadonlySet<CanvasObjectId>,
  links: readonly CanvasLink[],
  objectById: ReadonlyMap<CanvasObjectId, CanvasObject>
): ReadonlySet<CanvasObjectId> {
  const result = new Set(seedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of links) {
      if (link.dismissedAt !== undefined) continue;
      const touches =
        result.has(link.fromObjectId) || result.has(link.toObjectId);
      if (!touches) continue;
      for (const id of [link.fromObjectId, link.toObjectId] as const) {
        if (!result.has(id) && objectById.has(id)) {
          result.add(id);
          changed = true;
        }
      }
    }
  }
  return result;
}

export function scopeSeedObjectIds(
  project: ProjectNavigator,
  board: CanvasBoard,
  scope: CanvasDrillScope
): ReadonlySet<CanvasObjectId> {
  const objects = activeObjects(board);
  const ids = new Set<CanvasObjectId>();
  switch (scope.kind) {
    case "project":
      for (const object of objects) ids.add(object.id);
      return ids;
    case "chapter": {
      for (const object of chapterSceneCards(project, board, scope)) {
        ids.add(object.id);
      }
      for (const object of objects) {
        if (object.kind === "region") {
          const containsChapterScene = chapterSceneCards(
            project,
            board,
            scope
          ).some((sceneCard) => sceneCard.parentRegionId === object.id);
          if (containsChapterScene) ids.add(object.id);
        }
      }
      return linkedObjectIds(ids, activeLinks(board), new Map(objects.map((o) => [o.id, o])));
    }
    case "scene": {
      const sceneCard = objects.find(
        (object) =>
          object.kind === "scene-card" && object.sceneId === scope.sceneId
      );
      if (sceneCard !== undefined) ids.add(sceneCard.id);
      return linkedObjectIds(ids, activeLinks(board), new Map(objects.map((o) => [o.id, o])));
    }
  }
}

export function filterObjectsForScope(
  project: ProjectNavigator,
  board: CanvasBoard,
  scope: CanvasDrillScope
): readonly CanvasObject[] {
  const objects = activeObjects(board);
  if (scope.kind === "project") return objects;
  const inScope = scopeSeedObjectIds(project, board, scope);
  return objects.filter((object) => inScope.has(object.id));
}

function isContinuityFixture(object: CanvasObject): boolean {
  return (
    object.sourceKey === PROVISIONAL_BEAT_FIXTURE_SOURCE ||
    (object.authority === "provisional" &&
      object.sourceKey?.startsWith("fixture:") === true)
  );
}

function isContinuityFixtureLink(link: CanvasLink): boolean {
  return (
    link.kind === "beat" ||
    (link.authority === "provisional" &&
      link.sourceKey?.startsWith("fixture:") === true)
  );
}

function sceneStatusForObject(
  project: ProjectNavigator,
  object: CanvasObject
): string | undefined {
  if (object.kind !== "scene-card" || object.sceneId === undefined) {
    return undefined;
  }
  return project.books
    .flatMap((book) => [
      ...book.parts.flatMap((part) =>
        part.chapters.flatMap((chapter) => chapter.scenes)
      ),
      ...book.unassignedScenes
    ])
    .find((scene) => scene.id === object.sceneId)?.status;
}

export function projectCanvasLensProjection(
  project: ProjectNavigator,
  board: CanvasBoard,
  scope: CanvasDrillScope,
  lens: CanvasWorkflowLens
): CanvasLensProjection {
  const scopedObjects = filterObjectsForScope(project, board, scope);
  const scopedObjectIds = new Set(scopedObjects.map((object) => object.id));
  const scopedLinks = activeLinks(board).filter(
    (link) =>
      scopedObjectIds.has(link.fromObjectId) &&
      scopedObjectIds.has(link.toObjectId)
  );

  const dimmedObjectIds = new Set<CanvasObjectId>();
  const hiddenObjectIds = new Set<CanvasObjectId>();
  const primaryObjectIds = new Set<CanvasObjectId>();

  if (scope.kind !== "project") {
    for (const object of activeObjects(board)) {
      if (!scopedObjectIds.has(object.id)) dimmedObjectIds.add(object.id);
    }
  }

  switch (lens) {
    case "outline":
      for (const object of scopedObjects) {
        if (object.kind === "scene-card" || object.kind === "region") {
          primaryObjectIds.add(object.id);
        }
      }
      break;
    case "relationships":
      for (const link of scopedLinks) {
        primaryObjectIds.add(link.fromObjectId);
        primaryObjectIds.add(link.toObjectId);
      }
      break;
    case "continuity":
      for (const object of scopedObjects) {
        if (isContinuityFixture(object)) primaryObjectIds.add(object.id);
      }
      for (const link of scopedLinks) {
        if (isContinuityFixtureLink(link)) {
          primaryObjectIds.add(link.fromObjectId);
          primaryObjectIds.add(link.toObjectId);
        }
      }
      for (const object of scopedObjects) {
        if (!primaryObjectIds.has(object.id)) hiddenObjectIds.add(object.id);
      }
      break;
    case "plan-draft":
      for (const object of scopedObjects) {
        if (
          object.kind === "scene-card" &&
          sceneStatusForObject(project, object) === "planned"
        ) {
          primaryObjectIds.add(object.id);
        }
      }
      break;
    case "review":
      for (const object of scopedObjects) {
        if (object.authority === "provisional") {
          primaryObjectIds.add(object.id);
        }
      }
      for (const link of scopedLinks) {
        if (link.authority === "provisional") {
          primaryObjectIds.add(link.fromObjectId);
          primaryObjectIds.add(link.toObjectId);
        }
      }
      break;
  }

  const visibleObjects =
    lens === "continuity"
      ? scopedObjects.filter((object) => !hiddenObjectIds.has(object.id))
      : scopedObjects;
  const visibleObjectIds = new Set(visibleObjects.map((object) => object.id));
  const visibleLinks = scopedLinks.filter(
    (link) =>
      visibleObjectIds.has(link.fromObjectId) &&
      visibleObjectIds.has(link.toObjectId) &&
      (lens !== "continuity" ||
        isContinuityFixtureLink(link) ||
        primaryObjectIds.has(link.fromObjectId) ||
        primaryObjectIds.has(link.toObjectId))
  );

  return {
    objects: visibleObjects,
    links: visibleLinks,
    dimmedObjectIds,
    hiddenObjectIds,
    primaryObjectIds
  };
}

export function workflowLensLabel(lens: CanvasWorkflowLens): string {
  switch (lens) {
    case "outline":
      return "Outline";
    case "relationships":
      return "Relationships";
    case "continuity":
      return "Continuity";
    case "plan-draft":
      return "Plan → Draft";
    case "review":
      return "Review";
  }
}

export function clampCanvasZoom(zoom: number): number {
  return Math.min(2.5, Math.max(0.35, zoom));
}

export function cameraViewportForBounds(
  bounds: CanvasBounds,
  surfaceSize: CanvasViewportSize,
  padding = 80
): CanvasViewport {
  const padded = expandBounds(bounds, padding);
  const zoom = clampCanvasZoom(
    Math.min(
      surfaceSize.width / Math.max(padded.width, 1),
      surfaceSize.height / Math.max(padded.height, 1),
      1.35
    )
  );
  const centerX = padded.x + padded.width / 2;
  const centerY = padded.y + padded.height / 2;
  return {
    x: centerX - surfaceSize.width / (2 * zoom),
    y: centerY - surfaceSize.height / (2 * zoom),
    zoom
  };
}

export function interpolateCanvasViewport(
  from: CanvasViewport,
  to: CanvasViewport,
  progress: number,
  ease: (t: number) => number = (t) => t
): CanvasViewport {
  const t = ease(Math.min(1, Math.max(0, progress)));
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    zoom: from.zoom + (to.zoom - from.zoom) * t
  };
}

export function readPrefersReducedMotion(
  query: (media: string) => { matches: boolean } = defaultReducedMotionQuery
): boolean {
  return query("(prefers-reduced-motion: reduce)").matches;
}

function defaultReducedMotionQuery(media: string): { matches: boolean } {
  if (
    typeof globalThis.matchMedia !== "function" ||
    media.length === 0
  ) {
    return { matches: false };
  }
  return globalThis.matchMedia(media);
}

export function targetViewportForDrillScope(
  project: ProjectNavigator,
  board: CanvasBoard,
  scope: CanvasDrillScope,
  surfaceSize: CanvasViewportSize
): CanvasViewport | undefined {
  switch (scope.kind) {
    case "project":
      return { x: 0, y: 0, zoom: 1 };
    case "chapter": {
      const bounds = chapterBounds(project, board, scope);
      return bounds === undefined
        ? undefined
        : cameraViewportForBounds(bounds, surfaceSize);
    }
    case "scene": {
      const bounds = sceneBounds(board, scope.sceneId);
      return bounds === undefined
        ? undefined
        : cameraViewportForBounds(bounds, surfaceSize, 56);
    }
  }
}
