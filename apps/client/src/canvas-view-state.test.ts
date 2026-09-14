import {
  bookId,
  canvasObjectId,
  chapterId,
  projectId,
  sceneId,
  type CanvasObject,
  type CanvasPersonalViewPreference,
  type ProjectNavigator,
  type SceneId
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  canvasDrillStackFromScopeRef,
  canvasInspectionNeedsApply,
  canvasPersonalScopeViewFromState,
  canvasReturnDrillStack,
  canvasScopeViewState,
  emptyCanvasViewStateSession,
  hydrateCanvasViewStateSession,
  retainCanvasScopeViewState,
  sanitizeCanvasScopeViewState
} from "./canvas-view-state.js";

const navigator: ProjectNavigator = {
  id: projectId("project-view-state"),
  title: "View state",
  version: 1,
  books: [
    {
      id: bookId("book-view-state"),
      title: "Book",
      status: "drafting",
      parts: [
        {
          id: "part-view-state" as ProjectNavigator["books"][number]["parts"][number]["id"],
          title: "Part",
          chapters: [
            {
              id: chapterId("chapter-view-state"),
              title: "Chapter",
              scenes: [
                {
                  id: sceneId("scene-view-state"),
                  title: "Scene",
                  status: "planned"
                }
              ]
            }
          ]
        }
      ],
      unassignedScenes: [],
      editions: [],
      sceneCount: 1
    }
  ],
  storyKnowledge: [],
  totals: { books: 1, scenes: 1, storyKnowledge: 0, editions: 0 }
};

describe("Canvas per-scope return state", () => {
  it("reapplies same-Draft-scene inspection after a scope transition clears it", () => {
    const intendedScene = sceneId("scene-view-state");
    expect(
      canvasInspectionNeedsApply(
        {},
        { inspectedSceneId: intendedScene }
      )
    ).toBe(true);
    expect(
      canvasInspectionNeedsApply(
        { inspectedSceneId: intendedScene },
        { inspectedSceneId: intendedScene }
      )
    ).toBe(false);
  });

  it("retains distinct cameras and modes for project and chapter scopes", () => {
    let session = emptyCanvasViewStateSession();
    session = retainCanvasScopeViewState(session, "project-a", "project", {
      viewport: { x: 10, y: 20, zoom: 0.8 },
      viewMode: "spatial"
    });
    session = retainCanvasScopeViewState(session, "project-a", "project", {
      workflowLens: "continuity"
    });
    session = retainCanvasScopeViewState(
      session,
      "project-a",
      "chapter:book:part:chapter",
      {
        viewport: { x: 300, y: 120, zoom: 1.4 },
        viewMode: "outline",
        inspectorOpen: true,
        focusToken: "inspector",
        workflowLens: "relationships"
      }
    );

    expect(canvasScopeViewState(session, "project-a", "project")).toMatchObject({
      viewport: { x: 10, y: 20, zoom: 0.8 },
      viewMode: "spatial",
      workflowLens: "continuity"
    });
    expect(
      canvasScopeViewState(
        session,
        "project-a",
        "chapter:book:part:chapter"
      )
    ).toMatchObject({
      viewport: { x: 300, y: 120, zoom: 1.4 },
      viewMode: "outline",
      inspectorOpen: true,
      focusToken: "inspector",
      workflowLens: "relationships"
    });
  });

  it("starts a clean session when the project changes", () => {
    let session = retainCanvasScopeViewState(
      emptyCanvasViewStateSession(),
      "project-a",
      "project",
      { viewport: { x: 10, y: 20, zoom: 0.8 } }
    );
    session = retainCanvasScopeViewState(session, "project-b", "project", {
      viewport: { x: 0, y: 0, zoom: 1 }
    });

    expect(canvasScopeViewState(session, "project-a", "project")).toBeUndefined();
    expect(canvasScopeViewState(session, "project-b", "project")).toMatchObject({
      viewport: { x: 0, y: 0, zoom: 1 }
    });
  });

  it("drops a stale object while retaining a still-valid unplaced scene", () => {
    const inspectedScene = sceneId("scene-retained-inspection");
    const state = sanitizeCanvasScopeViewState(
      {
        selectedObjectId: canvasObjectId("canvas-object-removed"),
        inspectedSceneId: inspectedScene,
        inspectorOpen: true
      },
      [],
      new Set<SceneId>([inspectedScene])
    );

    expect(state).toMatchObject({
      inspectedSceneId: inspectedScene,
      inspectorOpen: true
    });
    expect(state?.selectedObjectId).toBeUndefined();
  });

  it("derives scene inspection from a retained scene card and clears deleted scenes", () => {
    const cardScene = sceneId("scene-card-retained");
    const cardId = canvasObjectId("canvas-object-retained");
    const objects: Pick<CanvasObject, "id" | "sceneId">[] = [
      { id: cardId, sceneId: cardScene }
    ];

    expect(
      sanitizeCanvasScopeViewState(
        { selectedObjectId: cardId },
        objects,
        new Set<SceneId>([cardScene])
      )
    ).toMatchObject({ selectedObjectId: cardId, inspectedSceneId: cardScene });
    expect(
      sanitizeCanvasScopeViewState(
        { inspectedSceneId: sceneId("scene-deleted") },
        objects,
        new Set<SceneId>([cardScene])
      )?.inspectedSceneId
    ).toBeUndefined();
  });

  it("does not carry an old scene inspection onto a retained note", () => {
    const oldScene = sceneId("scene-old-inspection");
    const noteId = canvasObjectId("canvas-note-retained");
    expect(
      sanitizeCanvasScopeViewState(
        { selectedObjectId: noteId, inspectedSceneId: oldScene },
        [{ id: noteId }],
        new Set<SceneId>([oldScene])
      )
    ).toMatchObject({ selectedObjectId: noteId });
    expect(
      sanitizeCanvasScopeViewState(
        { selectedObjectId: noteId, inspectedSceneId: oldScene },
        [{ id: noteId }],
        new Set<SceneId>([oldScene])
      )?.inspectedSceneId
    ).toBeUndefined();
  });

  it("hydrates server scopes into lineage-preserving drill keys", () => {
    const preference: CanvasPersonalViewPreference = {
      projectId: navigator.id,
      accountId: "account-view-state" as CanvasPersonalViewPreference["accountId"],
      version: 4,
      lastScope: {
        scopeKind: "scene",
        scopeId: "scene-view-state"
      },
      scopeViews: [
        {
          scope: { scopeKind: "project" },
          viewport: { x: 1, y: 2, zoom: 1 },
          viewMode: "spatial",
          inspectorOpen: false,
          focusToken: "surface",
          workflowLens: "outline",
          updatedAt: "2026-09-12T20:00:00.000Z"
        },
        {
          scope: { scopeKind: "chapter", scopeId: "chapter-view-state" },
          viewport: { x: 20, y: 30, zoom: 1.2 },
          viewMode: "outline",
          inspectorOpen: true,
          focusToken: "inspector",
          workflowLens: "continuity",
          updatedAt: "2026-09-12T20:01:00.000Z"
        }
      ],
      updatedAt: "2026-09-12T20:01:00.000Z"
    };

    const hydrated = hydrateCanvasViewStateSession(navigator, preference);
    expect(
      canvasScopeViewState(
        hydrated,
        navigator.id,
        "chapter:book-view-state:part-view-state:chapter-view-state"
      )
    ).toMatchObject({
      viewport: { x: 20, y: 30, zoom: 1.2 },
      inspectorOpen: true,
      workflowLens: "continuity"
    });
    expect(canvasDrillStackFromScopeRef(navigator, preference.lastScope)).toEqual([
      { kind: "project" },
      {
        kind: "chapter",
        bookId: "book-view-state",
        partId: "part-view-state",
        chapterId: "chapter-view-state"
      },
      {
        kind: "scene",
        bookId: "book-view-state",
        partId: "part-view-state",
        chapterId: "chapter-view-state",
        sceneId: "scene-view-state"
      }
    ]);
  });

  it("keeps newer in-session intent over a loaded server echo", () => {
    const retained = retainCanvasScopeViewState(
      emptyCanvasViewStateSession(),
      navigator.id,
      "project",
      { viewport: { x: 90, y: 80, zoom: 1.4 }, focusToken: "search" }
    );
    const preference: CanvasPersonalViewPreference = {
      projectId: navigator.id,
      accountId: "account-view-state" as CanvasPersonalViewPreference["accountId"],
      version: 2,
      lastScope: { scopeKind: "project" },
      scopeViews: [
        {
          scope: { scopeKind: "project" },
          viewport: { x: 1, y: 2, zoom: 1 },
          viewMode: "spatial",
          inspectorOpen: false,
          focusToken: "surface",
          workflowLens: "outline",
          updatedAt: "2026-09-12T20:00:00.000Z"
        }
      ],
      updatedAt: "2026-09-12T20:00:00.000Z"
    };
    const hydrated = hydrateCanvasViewStateSession(
      navigator,
      preference,
      retained
    );
    expect(canvasScopeViewState(hydrated, navigator.id, "project")).toMatchObject({
      viewport: { x: 90, y: 80, zoom: 1.4 },
      focusToken: "search",
      workflowLens: "outline"
    });
  });

  it("keeps an intended unplaced-scene inspection when no preference exists", () => {
    const inspectedSceneId = sceneId("scene-view-state");
    const retained = retainCanvasScopeViewState(
      emptyCanvasViewStateSession(),
      navigator.id,
      "scene:scene-view-state",
      { inspectedSceneId, inspectorOpen: true }
    );
    const hydrated = hydrateCanvasViewStateSession(navigator, null, retained);
    expect(
      canvasScopeViewState(
        hydrated,
        navigator.id,
        "scene:scene-view-state"
      )
    ).toMatchObject({ inspectedSceneId, inspectorOpen: true });
  });

  it("forms a complete transport view while preserving optional focus references", () => {
    expect(
      canvasPersonalScopeViewFromState(
        {
          kind: "chapter",
          bookId: bookId("book-view-state"),
          partId: "part-view-state" as ProjectNavigator["books"][number]["parts"][number]["id"],
          chapterId: chapterId("chapter-view-state")
        },
        {
          viewport: { x: 10, y: 11, zoom: 0.9 },
          inspectorOpen: true,
          selectedObjectId: canvasObjectId("object-view-state")
        },
        "relationships"
      )
    ).toEqual({
      scope: { scopeKind: "chapter", scopeId: "chapter-view-state" },
      viewport: { x: 10, y: 11, zoom: 0.9 },
      viewMode: "spatial",
      inspectorOpen: true,
      focusToken: "inspector",
      selectedObjectId: "object-view-state",
      workflowLens: "relationships"
    });
  });

  it("restores last scope only for passive Canvas entry", () => {
    const requested = [{ kind: "project" as const }];
    const preference: CanvasPersonalViewPreference = {
      projectId: navigator.id,
      accountId: "account-view-state" as CanvasPersonalViewPreference["accountId"],
      version: 2,
      lastScope: { scopeKind: "scene", scopeId: "scene-view-state" },
      scopeViews: [],
      updatedAt: "2026-09-12T20:00:00.000Z"
    };
    expect(
      canvasReturnDrillStack(navigator, preference, requested, false).at(-1)
    ).toMatchObject({ kind: "scene", sceneId: "scene-view-state" });

    const explicitScene = [
      { kind: "project" as const },
      {
        kind: "scene" as const,
        bookId: bookId("book-view-state"),
        sceneId: sceneId("scene-view-state")
      }
    ];
    expect(
      canvasReturnDrillStack(navigator, preference, explicitScene, true)
    ).toBe(explicitScene);
    expect(canvasReturnDrillStack(navigator, null, explicitScene, true)).toBe(
      explicitScene
    );
  });
});
