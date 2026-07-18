import {
  accountId,
  bookId,
  canvasContentHash,
  canvasLinkId,
  canvasObjectId,
  canvasRevisionId,
  chapterId,
  partId,
  projectId,
  sceneId,
  storyKnowledgeId,
  type CanvasBoard,
  type CanvasLink,
  type CanvasObject,
  type CanvasReadingOrderSpine,
  type CanvasRevisionMetadata,
  type ProjectNavigator
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  availableCanvasStoryKnowledge,
  canonicalIndexForCanvasHandoff,
  canvasCapturePosition,
  canvasCanonicalReferenceState,
  canvasChapterAggregates,
  canvasFailureDisposition,
  canvasHistoryLabel,
  canvasPositionAfterDrag,
  canvasSceneFocus,
  canvasScreenFrame,
  canvasToolInstruction,
  fitCanvasObjects,
  preferredCanvasSceneId,
  projectCanvasOutline,
  searchCanvasObjects,
  visibleCanvasObjects,
  type CanvasTool
} from "./canvas-model.js";

const project = projectId("project-canvas-model");
const scene = sceneId("scene-canvas-model");
const secondScene = sceneId("scene-canvas-model-second");
const book = bookId("book-canvas-model");
const chapter = chapterId("chapter-canvas-model");
const activeKnowledge = storyKnowledgeId("knowledge-canvas-model-active");
const archivedKnowledge = storyKnowledgeId("knowledge-canvas-model-archived");

const navigator: ProjectNavigator = {
  id: project,
  title: "Canvas model",
  version: 4,
  books: [
    {
      id: book,
      title: "First book",
      status: "drafting",
      parts: [
        {
          id: "part-canvas-model" as ProjectNavigator["books"][number]["parts"][number]["id"],
          title: "Part one",
          chapters: [
            {
              id: chapter,
              title: "Opening",
              scenes: [
                { id: scene, title: "First scene", status: "drafting" },
                {
                  id: secondScene,
                  title: "Archived scene",
                  status: "planned",
                  archivedAt: "2026-07-12T20:00:00.000Z"
                }
              ]
            }
          ]
        }
      ],
      unassignedScenes: [],
      editions: [],
      sceneCount: 2
    }
  ],
  storyKnowledge: [
    {
      id: activeKnowledge,
      label: "Mara Venn",
      kind: "character",
      authority: "confirmed",
      linkedSceneIds: [],
      linkedSceneCount: 0,
      linkedKnowledge: []
    },
    {
      id: archivedKnowledge,
      label: "Old harbor",
      kind: "location",
      authority: "planned",
      linkedSceneIds: [],
      linkedSceneCount: 0,
      linkedKnowledge: [],
      archivedAt: "2026-07-12T20:00:00.000Z"
    }
  ],
  totals: { books: 1, scenes: 2, storyKnowledge: 2, editions: 0 }
};

function object(
  id: string,
  overrides: Partial<CanvasObject> = {}
): CanvasObject {
  return {
    id: canvasObjectId(id),
    projectId: project,
    kind: "note",
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    z: 1,
    authority: "confirmed",
    label: id,
    note: { body: id },
    ...overrides
  };
}

describe("Canvas presentation helpers", () => {
  it("transforms world geometry and converts one completed drag at any zoom", () => {
    expect(
      canvasScreenFrame(object("canvas-object-frame", { x: 120, y: 80 }), {
        x: 20,
        y: 30,
        zoom: 2
      })
    ).toEqual({ left: 200, top: 100, width: 400, height: 240 });
    expect(
      canvasPositionAfterDrag({ x: 120, y: 80 }, { x: 48, y: -24 }, 1.5)
    ).toEqual({ x: 152, y: 64 });
  });

  it("culls only objects outside the padded viewport", () => {
    const near = object("canvas-object-near", { x: 40, y: 60 });
    const edge = object("canvas-object-edge", { x: 760, y: 500 });
    const far = object("canvas-object-far", { x: 2_000, y: 2_000 });

    expect(
      visibleCanvasObjects(
        [near, edge, far],
        { x: 0, y: 0, zoom: 1 },
        { width: 800, height: 500 },
        100
      ).map((candidate) => candidate.id)
    ).toEqual([near.id, edge.id]);
  });

  it("places new captures in visible slots for wide and narrow Canvas panes", () => {
    const viewport = { x: 100, y: 50, zoom: 1 };

    expect(
      [0, 1, 2, 3].map((index) =>
        canvasCapturePosition(index, viewport, { width: 900, height: 580 })
      )
    ).toEqual([
      { x: 148, y: 102 },
      { x: 438, y: 102 },
      { x: 728, y: 102 },
      { x: 148, y: 292 }
    ]);

    const compactPosition = canvasCapturePosition(2, viewport, {
      width: 230,
      height: 580
    });
    const cascadedPosition = canvasCapturePosition(3, viewport, {
      width: 230,
      height: 580
    });
    expect(compactPosition).toEqual({ x: 148, y: 482 });
    expect(cascadedPosition).toEqual({ x: 172, y: 126 });
    expect(
      visibleCanvasObjects(
        [object("canvas-object-capture", compactPosition)],
        viewport,
        { width: 230, height: 580 },
        0
      )
    ).toHaveLength(1);
  });

  it("projects scene cards in canonical Draft order with explicit states", () => {
    const later = object("canvas-object-later", {
      kind: "scene-card",
      sceneId: scene,
      note: undefined,
      x: 900,
      storyOrderHint: 4,
      authority: "provisional"
    });
    const active = object("canvas-object-active", { x: 20, z: 2 });
    const archived = object("canvas-object-archived", {
      archivedAt: "2026-07-12T20:00:00.000Z",
      x: 10,
      z: 0
    });
    const board: CanvasBoard = {
      projectId: project,
      version: 3,
      objects: [archived, active, later],
      links: [],
      scopePlacements: [],
      createdAt: "2026-07-12T19:00:00.000Z",
      updatedAt: "2026-07-12T20:00:00.000Z"
    };
    const spine: CanvasReadingOrderSpine = {
      projectId: project,
      projectVersion: 2,
      canvasVersion: 3,
      entries: [
        {
          sceneId: scene,
          bookId: "book-canvas-model" as CanvasReadingOrderSpine["entries"][number]["bookId"],
          placement: "unassigned",
          canonicalIndex: 0,
          canvasObjectId: later.id,
          storyOrderHint: 4,
          drift: "later-on-canvas",
          archived: false
        }
      ]
    };

    const projection = projectCanvasOutline(board, spine);
    expect(projection.map((item) => item.object.id)).toEqual([
      later.id,
      active.id,
      archived.id
    ]);
    expect(projection[0]).toMatchObject({
      authorityLabel: "Provisional fixture",
      stateLabel: "Active",
      orderLabel: "Draft 1 · Later on Canvas"
    });
    expect(projection[2]?.stateLabel).toBe("Archived");
  });

  it("distinguishes Canvas and project conflicts from retryable failures", () => {
    expect(canvasFailureDisposition("CANVAS_VERSION_CONFLICT")).toBe(
      "reload-board"
    );
    expect(canvasFailureDisposition("VERSION_CONFLICT")).toBe(
      "reload-project-and-board"
    );
    expect(canvasFailureDisposition("INTERNAL_ERROR")).toBe("preserve-board");
  });

  it("offers only active unplaced story knowledge and labels stale references", () => {
    const placed = object("canvas-object-knowledge", {
      kind: "story-knowledge-card",
      note: undefined,
      storyKnowledgeId: activeKnowledge,
      archivedAt: "2026-07-12T20:02:00.000Z"
    });
    const board: CanvasBoard = {
      projectId: project,
      version: 2,
      objects: [placed],
      links: [],
      scopePlacements: [],
      createdAt: "2026-07-12T19:00:00.000Z",
      updatedAt: "2026-07-12T20:02:00.000Z"
    };

    expect(
      availableCanvasStoryKnowledge(navigator, { ...board, objects: [] }).map(
        (knowledge) => knowledge.id
      )
    ).toEqual([activeKnowledge]);
    expect(availableCanvasStoryKnowledge(navigator, board)).toEqual([]);
    expect(
      canvasCanonicalReferenceState(
        object("canvas-object-archived-scene", {
          kind: "scene-card",
          note: undefined,
          sceneId: secondScene
        }),
        navigator
      )
    ).toEqual({
      stale: true,
      label: "Archived scene · stale reference"
    });
    expect(
      canvasCanonicalReferenceState(
        object("canvas-object-archived-knowledge", {
          kind: "story-knowledge-card",
          note: undefined,
          storyKnowledgeId: archivedKnowledge
        }),
        navigator
      )
    ).toEqual({
      stale: true,
      label: "Archived story record · stale reference"
    });
  });

  it("derives aligned handoff order and restores a preferred scene-card selection", () => {
    expect(
      canonicalIndexForCanvasHandoff(navigator, {
        kind: "chapter",
        bookId: book,
        chapterId: chapter
      })
    ).toBe(2);

    const selectedCard = object("canvas-object-preferred-scene", {
      kind: "scene-card",
      note: undefined,
      sceneId: secondScene
    });
    const board: CanvasBoard = {
      projectId: project,
      version: 2,
      objects: [selectedCard],
      links: [],
      scopePlacements: [],
      createdAt: "2026-07-12T19:00:00.000Z",
      updatedAt: "2026-07-12T20:00:00.000Z"
    };
    expect(preferredCanvasSceneId(board, selectedCard.id)).toBe(secondScene);
  });

  it("uses writer-facing Canvas history labels without Git language", () => {
    const revision: CanvasRevisionMetadata = {
      id: canvasRevisionId(`canvas_revision_${"a".repeat(64)}`),
      projectId: project,
      boardVersion: 3,
      contentHash: canvasContentHash("a".repeat(64)),
      actorAccountId: accountId("account-canvas-model"),
      reason: "command",
      commandType: "canvas.object.update",
      createdAt: "2026-07-12T20:00:00.000Z"
    };
    expect(canvasHistoryLabel(revision)).toBe("Object details updated");
    expect(canvasHistoryLabel({ ...revision, reason: "restore", commandType: undefined })).toBe(
      "Earlier snapshot restored"
    );
  });

  it("returns distinct writer-facing instructions for every Canvas tool", () => {
    const tools: CanvasTool[] = [
      "select",
      "hand",
      "scene",
      "note",
      "story",
      "image",
      "region",
      "connect"
    ];
    const instructions = tools.map(canvasToolInstruction);

    expect(new Set(instructions).size).toBe(tools.length);
    expect(canvasToolInstruction("select")).toBe(
      "Select a card, link, or region to reveal its common actions."
    );
    expect(canvasToolInstruction("connect")).toBe(
      "Choose a source card, target, relationship kind, authority, and label."
    );
  });

  it("fits visible objects with padding and clamps zoom, resetting on empty or invalid size", () => {
    expect(fitCanvasObjects([], { width: 800, height: 600 })).toEqual({
      x: 0,
      y: 0,
      zoom: 1
    });
    expect(fitCanvasObjects([{ x: 10, y: 20, width: 100, height: 80 }], { width: 0, height: 600 })).toEqual({
      x: 0,
      y: 0,
      zoom: 1
    });
    expect(
      fitCanvasObjects([{ x: 10, y: 20, width: 100, height: 80 }], { width: 800, height: -1 })
    ).toEqual({ x: 0, y: 0, zoom: 1 });

    expect(
      fitCanvasObjects(
        [
          { x: 100, y: 100, width: 200, height: 100 },
          { x: 400, y: 300, width: 100, height: 50 }
        ],
        { width: 800, height: 600 },
        48
      )
    ).toEqual({ x: 73, y: 73, zoom: 1.76 });

    expect(
      fitCanvasObjects([{ x: 0, y: 0, width: 10_000, height: 10_000 }], { width: 800, height: 600 })
    ).toEqual({ x: -137, y: -137, zoom: 0.35 });
  });

  it("searches active objects case-insensitively across label, note, and image text", () => {
    const harborNote = object("canvas-object-search-note", {
      label: "Dockside memo",
      note: { body: "The harbor lights stay on after midnight." }
    });
    const coverImage = object("canvas-object-search-image", {
      kind: "image-reference",
      note: undefined,
      label: "Cover reference",
      image: {
        altText: "Storm over the MARINA",
        caption: "Chapter opener illustration"
      }
    });
    const unrelated = object("canvas-object-search-unrelated", {
      label: "Beat grid",
      note: { body: "No match here" }
    });
    const objects = [harborNote, coverImage, unrelated];

    expect(searchCanvasObjects(objects, "   ")).toEqual([]);
    expect(searchCanvasObjects(objects, "marina").map((candidate) => candidate.id)).toEqual([
      coverImage.id
    ]);
    expect(searchCanvasObjects(objects, "HARBOR").map((candidate) => candidate.id)).toEqual([
      harborNote.id
    ]);
    expect(searchCanvasObjects(objects, "chapter opener").map((candidate) => candidate.id)).toEqual([
      coverImage.id
    ]);
  });

  it("aggregates chapters in canonical order and excludes archived or dismissed canvas state", () => {
    const secondChapter = chapterId("chapter-canvas-model-second");
    const thirdScene = sceneId("scene-canvas-model-third");
    const aggregateProject: ProjectNavigator = {
      ...navigator,
      books: [
        {
          ...navigator.books[0]!,
          parts: [
            {
              ...navigator.books[0]!.parts[0]!,
              chapters: [
                navigator.books[0]!.parts[0]!.chapters[0]!,
                {
                  id: secondChapter,
                  title: "Crossing",
                  scenes: [{ id: thirdScene, title: "River scene", status: "planned" }]
                }
              ]
            }
          ]
        }
      ]
    };
    const placedSceneCard = object("canvas-object-aggregate-scene", {
      kind: "scene-card",
      note: undefined,
      sceneId: scene,
      x: 40,
      y: 60
    });
    const dismissedSceneCard = object("canvas-object-aggregate-dismissed", {
      kind: "scene-card",
      note: undefined,
      sceneId: thirdScene,
      dismissedAt: "2026-07-12T20:01:00.000Z"
    });
    const archivedSceneCard = object("canvas-object-aggregate-archived", {
      kind: "scene-card",
      note: undefined,
      sceneId: thirdScene,
      archivedAt: "2026-07-12T20:02:00.000Z"
    });
    const noteObject = object("canvas-object-aggregate-note", { x: 200, y: 80 });
    const outboundTarget = object("canvas-object-aggregate-target", { x: 320, y: 80 });
    const activeLink: CanvasLink = {
      id: canvasLinkId("link-aggregate-active"),
      projectId: project,
      kind: "reference",
      fromObjectId: placedSceneCard.id,
      toObjectId: outboundTarget.id,
      authority: "confirmed"
    };
    const archivedLink: CanvasLink = {
      id: canvasLinkId("link-aggregate-archived"),
      projectId: project,
      kind: "beat",
      fromObjectId: placedSceneCard.id,
      toObjectId: noteObject.id,
      authority: "confirmed",
      archivedAt: "2026-07-12T20:03:00.000Z"
    };
    const board: CanvasBoard = {
      projectId: project,
      version: 5,
      objects: [
        placedSceneCard,
        dismissedSceneCard,
        archivedSceneCard,
        noteObject,
        outboundTarget
      ],
      links: [activeLink, archivedLink],
      scopePlacements: [],
      createdAt: "2026-07-12T19:00:00.000Z",
      updatedAt: "2026-07-12T20:03:00.000Z"
    };

    expect(canvasChapterAggregates(aggregateProject, board)).toEqual([
      {
        bookId: book,
        partId: partId("part-canvas-model"),
        chapterId: chapter,
        title: "Opening",
        sceneCount: 1,
        placedSceneCount: 1,
        linkCount: 1
      },
      {
        bookId: book,
        partId: partId("part-canvas-model"),
        chapterId: secondChapter,
        title: "Crossing",
        sceneCount: 1,
        placedSceneCount: 0,
        linkCount: 0
      }
    ]);
  });

  it("focuses an active scene card with link counts and omits missing scenes", () => {
    const missingScene = sceneId("scene-canvas-model-missing");
    const summaryScene = sceneId("scene-canvas-model-summary");
    const focusProject: ProjectNavigator = {
      ...navigator,
      books: [
        {
          ...navigator.books[0]!,
          unassignedScenes: [
            {
              id: summaryScene,
              title: "Unassigned beat",
              summary: "Bridge confrontation",
              status: "drafting"
            }
          ]
        }
      ]
    };
    const placedCard = object("canvas-object-focus-placed", {
      kind: "scene-card",
      note: undefined,
      sceneId: summaryScene,
      x: 120,
      y: 140
    });
    const inboundSource = object("canvas-object-focus-inbound", { x: 40, y: 140 });
    const outboundTarget = object("canvas-object-focus-outbound", { x: 260, y: 140 });
    const inboundLink: CanvasLink = {
      id: canvasLinkId("link-focus-inbound"),
      projectId: project,
      kind: "dependency",
      fromObjectId: inboundSource.id,
      toObjectId: placedCard.id,
      authority: "confirmed"
    };
    const outboundLink: CanvasLink = {
      id: canvasLinkId("link-focus-outbound"),
      projectId: project,
      kind: "reference",
      fromObjectId: placedCard.id,
      toObjectId: outboundTarget.id,
      authority: "confirmed"
    };
    const archivedInboundLink: CanvasLink = {
      id: canvasLinkId("link-focus-archived"),
      projectId: project,
      kind: "beat",
      fromObjectId: inboundSource.id,
      toObjectId: placedCard.id,
      authority: "confirmed",
      archivedAt: "2026-07-12T20:04:00.000Z"
    };
    const board: CanvasBoard = {
      projectId: project,
      version: 6,
      objects: [placedCard, inboundSource, outboundTarget],
      links: [inboundLink, outboundLink, archivedInboundLink],
      scopePlacements: [],
      createdAt: "2026-07-12T19:00:00.000Z",
      updatedAt: "2026-07-12T20:04:00.000Z"
    };

    expect(canvasSceneFocus(focusProject, board, missingScene)).toBeUndefined();
    expect(canvasSceneFocus(focusProject, board, scene)).toEqual({
      sceneId: scene,
      title: "First scene",
      placed: false,
      inboundLinks: 0,
      outboundLinks: 0
    });
    expect(canvasSceneFocus(focusProject, board, summaryScene)).toEqual({
      sceneId: summaryScene,
      title: "Unassigned beat",
      summary: "Bridge confrontation",
      placed: true,
      inboundLinks: 1,
      outboundLinks: 1
    });
  });

  it("leaves manuscript order and board arrays untouched while deriving aggregates and focus", () => {
    const aggregateBoard: CanvasBoard = {
      projectId: project,
      version: 7,
      objects: [
        object("canvas-object-immutable-scene", {
          kind: "scene-card",
          note: undefined,
          sceneId: scene
        })
      ],
      links: [],
      scopePlacements: [],
      createdAt: "2026-07-12T19:00:00.000Z",
      updatedAt: "2026-07-12T20:05:00.000Z"
    };
    const booksBefore = structuredClone(navigator.books);
    const objectsRef = aggregateBoard.objects;
    const linksRef = aggregateBoard.links;
    const objectsBefore = [...aggregateBoard.objects];
    const linksBefore = [...aggregateBoard.links];

    canvasChapterAggregates(navigator, aggregateBoard);
    canvasSceneFocus(navigator, aggregateBoard, scene);
    searchCanvasObjects(aggregateBoard.objects, "scene");
    fitCanvasObjects(aggregateBoard.objects, { width: 800, height: 600 });
    canvasToolInstruction("select");

    expect(navigator.books).toEqual(booksBefore);
    expect(aggregateBoard.objects).toBe(objectsRef);
    expect(aggregateBoard.links).toBe(linksRef);
    expect(aggregateBoard.objects).toEqual(objectsBefore);
    expect(aggregateBoard.links).toEqual(linksBefore);
  });
});
