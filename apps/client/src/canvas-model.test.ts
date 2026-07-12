import {
  accountId,
  bookId,
  canvasContentHash,
  canvasObjectId,
  canvasRevisionId,
  chapterId,
  projectId,
  sceneId,
  storyKnowledgeId,
  type CanvasBoard,
  type CanvasObject,
  type CanvasReadingOrderSpine,
  type CanvasRevisionMetadata,
  type ProjectNavigator
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  availableCanvasStoryKnowledge,
  canonicalIndexForCanvasHandoff,
  canvasCanonicalReferenceState,
  canvasFailureDisposition,
  canvasHistoryLabel,
  canvasPositionAfterDrag,
  canvasScreenFrame,
  preferredCanvasSceneId,
  projectCanvasOutline,
  visibleCanvasObjects
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
      linkedSceneCount: 0
    },
    {
      id: archivedKnowledge,
      label: "Old harbor",
      kind: "location",
      authority: "planned",
      linkedSceneIds: [],
      linkedSceneCount: 0,
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
});
