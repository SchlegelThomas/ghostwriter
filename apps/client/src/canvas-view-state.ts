import {
  type CanvasObject,
  type CanvasObjectId,
  type CanvasPersonalScopeView,
  type CanvasPersonalViewPreference,
  type CanvasScopeRef,
  type ProjectNavigator,
  type SceneId
} from "@ghostwriter/core";
import type {
  CanvasDrillScope,
  CanvasDrillStack,
  CanvasViewport,
  CanvasWorkflowLens
} from "@ghostwriter/ui";

export type CanvasViewMode = "spatial" | "outline";
export type CanvasFocusToken = "surface" | "inspector" | "search";

export type CanvasScopeViewState = Readonly<{
  viewport?: CanvasViewport;
  viewMode?: CanvasViewMode;
  inspectorOpen?: boolean;
  focusToken?: CanvasFocusToken;
  selectedObjectId?: CanvasObjectId;
  inspectedSceneId?: SceneId;
  workflowLens?: CanvasWorkflowLens;
}>;

export type CanvasViewStateSession = Readonly<{
  projectId?: string;
  byScope: ReadonlyMap<string, CanvasScopeViewState>;
}>;

export function canvasInspectionNeedsApply(
  current: Readonly<{
    selectedObjectId?: CanvasObjectId;
    inspectedSceneId?: SceneId;
  }>,
  next: Readonly<{
    selectedObjectId?: CanvasObjectId;
    inspectedSceneId?: SceneId;
  }>
): boolean {
  return (
    current.selectedObjectId !== next.selectedObjectId ||
    current.inspectedSceneId !== next.inspectedSceneId
  );
}

export function emptyCanvasViewStateSession(): CanvasViewStateSession {
  return { byScope: new Map() };
}

export function canvasScopeRefFromDrillScope(
  scope: CanvasDrillScope
): CanvasScopeRef {
  switch (scope.kind) {
    case "project":
      return { scopeKind: "project" };
    case "chapter":
      return { scopeKind: "chapter", scopeId: scope.chapterId };
    case "scene":
      return { scopeKind: "scene", scopeId: scope.sceneId };
  }
}

function canonicalDrillScopeKey(scope: CanvasDrillScope): string {
  switch (scope.kind) {
    case "project":
      return "project";
    case "chapter":
      return `chapter:${scope.bookId}:${scope.partId}:${scope.chapterId}`;
    case "scene":
      return `scene:${scope.sceneId}`;
  }
}

export function canvasDrillScopeFromRef(
  project: ProjectNavigator,
  scope: CanvasScopeRef
): CanvasDrillScope | undefined {
  if (scope.scopeKind === "project") return { kind: "project" };
  if (scope.scopeId === undefined) return undefined;
  if (scope.scopeKind === "scene") {
    for (const book of project.books) {
      if (book.archivedAt !== undefined) continue;
      for (const part of book.parts) {
        for (const chapter of part.chapters) {
          const scene = chapter.scenes.find(
            (candidate) =>
              candidate.id === scope.scopeId &&
              candidate.archivedAt === undefined
          );
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
      const scene = book.unassignedScenes.find(
        (candidate) =>
          candidate.id === scope.scopeId && candidate.archivedAt === undefined
      );
      if (scene !== undefined) {
        return { kind: "scene", bookId: book.id, sceneId: scene.id };
      }
    }
    return undefined;
  }
  for (const book of project.books) {
    if (book.archivedAt !== undefined) continue;
    for (const part of book.parts) {
      const chapter = part.chapters.find(
        (candidate) => candidate.id === scope.scopeId
      );
      if (chapter !== undefined) {
        return {
          kind: "chapter",
          bookId: book.id,
          partId: part.id,
          chapterId: chapter.id
        };
      }
    }
  }
  return undefined;
}

export function canvasDrillStackFromScopeRef(
  project: ProjectNavigator,
  scope: CanvasScopeRef
): CanvasDrillStack {
  const drillScope = canvasDrillScopeFromRef(project, scope);
  if (drillScope === undefined || drillScope.kind === "project") {
    return [{ kind: "project" }];
  }
  if (drillScope.kind === "chapter") {
    return [{ kind: "project" }, drillScope];
  }
  const chapterScope: Extract<CanvasDrillScope, { kind: "chapter" }> | undefined =
    drillScope.chapterId === undefined || drillScope.partId === undefined
      ? undefined
      : {
          kind: "chapter",
          bookId: drillScope.bookId,
          partId: drillScope.partId,
          chapterId: drillScope.chapterId
        };
  return chapterScope === undefined
    ? [{ kind: "project" }, drillScope]
    : [{ kind: "project" }, chapterScope, drillScope];
}

export function canvasReturnDrillStack(
  project: ProjectNavigator,
  preference: CanvasPersonalViewPreference | null,
  requestedStack: CanvasDrillStack,
  hasExplicitInspection: boolean
): CanvasDrillStack {
  return !hasExplicitInspection && preference !== null
    ? canvasDrillStackFromScopeRef(project, preference.lastScope)
    : requestedStack;
}

function stateFromPersonalScopeView(
  view: CanvasPersonalScopeView
): CanvasScopeViewState {
  return {
    viewport: view.viewport,
    viewMode: view.viewMode,
    inspectorOpen: view.inspectorOpen,
    focusToken: view.focusToken,
    selectedObjectId: view.selectedObjectId,
    inspectedSceneId: view.inspectedSceneId,
    workflowLens: view.workflowLens
  };
}

export function hydrateCanvasViewStateSession(
  project: ProjectNavigator,
  preference: CanvasPersonalViewPreference | null,
  retained: CanvasViewStateSession = emptyCanvasViewStateSession()
): CanvasViewStateSession {
  const byScope = new Map<string, CanvasScopeViewState>();
  for (const view of preference?.scopeViews ?? []) {
    const scope = canvasDrillScopeFromRef(project, view.scope);
    if (scope !== undefined) {
      byScope.set(canonicalDrillScopeKey(scope), stateFromPersonalScopeView(view));
    }
  }
  if (retained.projectId === project.id) {
    for (const [key, state] of retained.byScope) {
      byScope.set(key, { ...byScope.get(key), ...state });
    }
  }
  return { projectId: project.id, byScope };
}

export function canvasPersonalScopeViewFromState(
  scope: CanvasDrillScope,
  state: CanvasScopeViewState | undefined,
  fallbackLens: CanvasWorkflowLens
): Omit<CanvasPersonalScopeView, "updatedAt"> {
  return {
    scope: canvasScopeRefFromDrillScope(scope),
    viewport: state?.viewport ?? { x: 0, y: 0, zoom: 1 },
    viewMode: state?.viewMode ?? "spatial",
    inspectorOpen: state?.inspectorOpen ?? false,
    focusToken:
      state?.focusToken ??
      (state?.inspectorOpen === true ? "inspector" : "surface"),
    ...(state?.selectedObjectId === undefined
      ? {}
      : { selectedObjectId: state.selectedObjectId }),
    ...(state?.inspectedSceneId === undefined
      ? {}
      : { inspectedSceneId: state.inspectedSceneId }),
    workflowLens: state?.workflowLens ?? fallbackLens
  };
}

export function retainCanvasScopeViewState(
  session: CanvasViewStateSession,
  projectId: string,
  scopeKey: string,
  patch: CanvasScopeViewState
): CanvasViewStateSession {
  const byScope =
    session.projectId === projectId ? new Map(session.byScope) : new Map();
  byScope.set(scopeKey, { ...byScope.get(scopeKey), ...patch });
  return { projectId, byScope };
}

export function canvasScopeViewState(
  session: CanvasViewStateSession,
  projectId: string,
  scopeKey: string
): CanvasScopeViewState | undefined {
  if (session.projectId !== projectId) return undefined;
  return session.byScope.get(scopeKey);
}

export function sanitizeCanvasScopeViewState(
  state: CanvasScopeViewState | undefined,
  objects: readonly Pick<CanvasObject, "id" | "sceneId">[],
  sceneIds: ReadonlySet<SceneId>
): CanvasScopeViewState | undefined {
  if (state === undefined) return undefined;
  const selectedObject = objects.find(
    (object) => object.id === state.selectedObjectId
  );
  const inspectedSceneId =
    selectedObject !== undefined
      ? selectedObject.sceneId !== undefined && sceneIds.has(selectedObject.sceneId)
        ? selectedObject.sceneId
        : undefined
      : state.inspectedSceneId !== undefined && sceneIds.has(state.inspectedSceneId)
        ? state.inspectedSceneId
        : undefined;
  return {
    ...state,
    selectedObjectId: selectedObject?.id,
    inspectedSceneId
  };
}
