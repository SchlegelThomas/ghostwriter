import {
  bookId,
  canvasObjectId,
  chapterId,
  projectId,
  sceneId,
  type CanvasBoard,
  type CanvasObject,
  type ProjectNavigator
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  CANVAS_WORKFLOW_LENSES,
  PROVISIONAL_BEAT_FIXTURE_SOURCE,
  chapterBounds,
  chapterBoundOverlays,
  currentDrillScope,
  drillBack,
  drillBreadcrumbs,
  drillIntoChapter,
  drillIntoScene,
  drillToScope,
  initialDrillStack,
  projectCanvasLensProjection,
  readPrefersReducedMotion,
  sceneDrillScope,
  targetViewportForDrillScope,
  workflowLensLabel
} from "./canvas-drill.js";

const project = projectId("project-drill");
const book = bookId("book-drill");
const chapter = chapterId("chapter-drill");
const secondChapter = chapterId("chapter-drill-two");
const firstScene = sceneId("scene-drill-one");
const secondScene = sceneId("scene-drill-two");
const thirdScene = sceneId("scene-drill-three");
const beatNote = canvasObjectId("object-beat");
const sceneCardOne = canvasObjectId("object-scene-one");
const sceneCardTwo = canvasObjectId("object-scene-two");
const region = canvasObjectId("object-region");

const navigator: ProjectNavigator = {
  id: project,
  title: "Drill novel",
  version: 2,
  books: [
    {
      id: book,
      title: "Book one",
      status: "drafting",
      parts: [
        {
          id: "part-drill" as ProjectNavigator["books"][number]["parts"][number]["id"],
          title: "Part one",
          chapters: [
            {
              id: chapter,
              title: "Opening",
              scenes: [
                { id: firstScene, title: "First beat", status: "planned" },
                { id: secondScene, title: "Second beat", status: "drafting" }
              ]
            },
            {
              id: secondChapter,
              title: "Middle",
              scenes: [
                { id: thirdScene, title: "Turn", status: "drafting" }
              ]
            }
          ]
        }
      ],
      unassignedScenes: [],
      editions: [],
      sceneCount: 3
    }
  ],
  storyKnowledge: [],
  totals: { books: 1, scenes: 3, storyKnowledge: 0, editions: 0 }
};

function object(
  id: ReturnType<typeof canvasObjectId>,
  overrides: Partial<CanvasObject> = {}
): CanvasObject {
  return {
    id,
    projectId: project,
    kind: "scene-card",
    x: 100,
    y: 120,
    width: 240,
    height: 150,
    z: 1,
    authority: "confirmed",
    label: "Scene",
    ...overrides
  };
}

const board: CanvasBoard = {
  projectId: project,
  version: 3,
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
  objects: [
    object(sceneCardOne, {
      kind: "scene-card",
      sceneId: firstScene,
      label: "First beat",
      x: 80,
      y: 100
    }),
    object(sceneCardTwo, {
      kind: "scene-card",
      sceneId: secondScene,
      label: "Second beat",
      x: 360,
      y: 140,
      parentRegionId: region
    }),
    object(region, {
      kind: "region",
      label: "Opening region",
      x: 60,
      y: 80,
      width: 580,
      height: 260,
      z: -1
    }),
    object(beatNote, {
      kind: "note",
      label: "A costly turn",
      authority: "provisional",
      sourceKey: PROVISIONAL_BEAT_FIXTURE_SOURCE,
      x: 420,
      y: 180,
      width: 220,
      height: 140
    })
  ],
  links: [
    {
      id: "link-beat" as CanvasBoard["links"][number]["id"],
      projectId: project,
      kind: "beat",
      fromObjectId: beatNote,
      toObjectId: sceneCardOne,
      authority: "provisional",
      sourceKey: "fixture:beat:link"
    }
  ],
  scopePlacements: []
};

describe("canvas drill stack", () => {
  it("starts at project scope and drills into chapter then scene", () => {
    const stack = initialDrillStack();
    const chapterScope = {
      kind: "chapter" as const,
      bookId: book,
      partId: navigator.books[0]!.parts[0]!.id,
      chapterId: chapter
    };
    const afterChapter = drillIntoChapter(stack, chapterScope);
    expect(currentDrillScope(afterChapter).kind).toBe("chapter");

    const sceneScope = sceneDrillScope(navigator, firstScene);
    expect(sceneScope).toEqual({
      kind: "scene",
      bookId: book,
      partId: navigator.books[0]!.parts[0]!.id,
      chapterId: chapter,
      sceneId: firstScene
    });

    const afterScene = drillIntoScene(afterChapter, sceneScope!);
    expect(currentDrillScope(afterScene).kind).toBe("scene");
    expect(drillBack(afterScene)).toEqual(afterChapter);
    expect(drillBack(afterChapter)).toEqual(stack);
  });

  it("replaces scene scope when drilling into another scene", () => {
    const sceneOne = sceneDrillScope(navigator, firstScene)!;
    const sceneTwo = sceneDrillScope(navigator, secondScene)!;
    const stack = drillIntoScene(
      drillIntoChapter(initialDrillStack(), {
        kind: "chapter",
        bookId: book,
        partId: navigator.books[0]!.parts[0]!.id,
        chapterId: chapter
      }),
      sceneOne
    );
    const replaced = drillIntoScene(stack, sceneTwo);
    expect(currentDrillScope(replaced)).toEqual(sceneTwo);
    expect(replaced).toHaveLength(3);
  });

  it("builds breadcrumbs and jumps to parent scope", () => {
    const chapterScope = {
      kind: "chapter" as const,
      bookId: book,
      partId: navigator.books[0]!.parts[0]!.id,
      chapterId: chapter
    };
    const stack = drillIntoScene(
      drillIntoChapter(initialDrillStack(), chapterScope),
      sceneDrillScope(navigator, firstScene)!
    );
    expect(drillBreadcrumbs(stack, navigator).map((crumb) => crumb.label)).toEqual(
      ["Drill novel", "Opening", "First beat"]
    );
    expect(drillToScope(stack, { kind: "project" })).toEqual([
      { kind: "project" }
    ]);
  });
});

describe("chapter bounds and overlays", () => {
  it("derives chapter bounds from scene cards and containing regions", () => {
    const bounds = chapterBounds(navigator, board, {
      kind: "chapter",
      bookId: book,
      partId: navigator.books[0]!.parts[0]!.id,
      chapterId: chapter
    });
    expect(bounds).toEqual({
      x: 12,
      y: 32,
      width: 676,
      height: 356
    });
    expect(chapterBoundOverlays(navigator, board)).toHaveLength(1);
    expect(chapterBoundOverlays(navigator, board)[0]?.label).toBe("Opening");
  });

  it("targets a tighter camera viewport for scene drill", () => {
    const viewport = targetViewportForDrillScope(
      navigator,
      board,
      sceneDrillScope(navigator, firstScene)!,
      { width: 900, height: 560 }
    );
    expect(viewport?.zoom).toBeGreaterThan(1);
    expect(viewport?.x).toBeLessThan(80);
  });
});

describe("workflow lens projection", () => {
  const chapterScope = {
    kind: "chapter" as const,
    bookId: book,
    partId: navigator.books[0]!.parts[0]!.id,
    chapterId: chapter
  };

  it("keeps all chapter objects visible in outline lens", () => {
    const projection = projectCanvasLensProjection(
      navigator,
      board,
      chapterScope,
      "outline"
    );
    expect(projection.objects.map((object) => object.id)).toEqual(
      expect.arrayContaining([sceneCardOne, sceneCardTwo, region, beatNote])
    );
    expect(projection.primaryObjectIds.has(sceneCardOne)).toBe(true);
    expect(projection.primaryObjectIds.has(region)).toBe(true);
  });

  it("filters continuity lens to deterministic fixture findings", () => {
    const projection = projectCanvasLensProjection(
      navigator,
      board,
      chapterScope,
      "continuity"
    );
    expect(projection.objects.map((object) => object.id)).toEqual(
      expect.arrayContaining([beatNote, sceneCardOne])
    );
    expect(projection.objects.some((object) => object.id === sceneCardTwo)).toBe(
      false
    );
    expect(projection.links).toHaveLength(1);
  });

  it("emphasizes planned scenes in plan-draft lens", () => {
    const projection = projectCanvasLensProjection(
      navigator,
      board,
      chapterScope,
      "plan-draft"
    );
    expect(projection.primaryObjectIds.has(sceneCardOne)).toBe(true);
    expect(projection.primaryObjectIds.has(sceneCardTwo)).toBe(false);
  });

  it("exposes all workflow lens labels", () => {
    expect(CANVAS_WORKFLOW_LENSES.map(workflowLensLabel)).toEqual([
      "Outline",
      "Relationships",
      "Continuity",
      "Plan → Draft",
      "Review"
    ]);
  });
});

describe("reduced motion", () => {
  it("reads prefers-reduced-motion through an injectable query", () => {
    expect(
      readPrefersReducedMotion(() => ({ matches: true }))
    ).toBe(true);
    expect(
      readPrefersReducedMotion(() => ({ matches: false }))
    ).toBe(false);
  });
});
