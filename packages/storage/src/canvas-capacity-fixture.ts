import {
  bookId, canvasObjectId, canvasLinkId, chapterId, partId, projectId, sceneId,
  defineProjectRecords, createCanvasBoard, type CanvasObject, type CanvasLink
} from "@ghostwriter/core";

/** Reproducible fixture shared by the opt-in storage probe and hermetic browser server. */
export function createCanvasCapacityFixture() {
  const now = "2026-09-12T00:00:00.000Z";
  const project = projectId("capacity-project");
  const book = bookId("capacity-book");
  const scenes = Array.from({ length: 500 }, (_, i) => ({
    id: sceneId(`capacity-scene-${i}`), projectId: project, bookId: book,
    title: `Scene ${i + 1}`, status: "drafting" as const,
    summary: `Scene ${i + 1} develops a planned turn and leaves a consequence for the following scene.`
  }));
  const records = defineProjectRecords({
    project: { id: project, title: "Capacity novel", bookIds: [book], createdAt: now },
    books: [{ id: book, projectId: project, title: "Capacity novel", status: "drafting",
      createdAt: now, manuscript: { unassignedSceneIds: [], parts: [{
        id: partId("capacity-part"), title: "Manuscript",
        chapters: Array.from({ length: 100 }, (_, i) => ({
          id: chapterId(`capacity-chapter-${i}`), title: `Chapter ${i + 1}`,
          sceneIds: scenes.slice(i * 5, i * 5 + 5).map(s => s.id)
        }))
      }] }
    }], scenes, storyKnowledge: [], editions: []
  });
  const objects: CanvasObject[] = Array.from({ length: 1000 }, (_, i) => ({
    id: canvasObjectId(`capacity-object-${i}`), projectId: project,
    kind: i < 500 ? "scene-card" : "note", authority: "confirmed",
    label: i < 500 ? scenes[i]!.title : `Supporting note ${i - 499}`,
    ...(i < 500 ? { sceneId: scenes[i]!.id } : { note: { body: "A motivation, clue or unresolved consequence to develop." } }),
    x: (i % 20) * 300, y: Math.floor(i / 20) * 200, width: 260, height: 160, z: i
  }));
  const links: CanvasLink[] = Array.from({ length: 1500 }, (_, i) => ({
    id: canvasLinkId(`capacity-link-${i}`), projectId: project,
    kind: "thread", authority: "confirmed", label: "Related story work",
    fromObjectId: objects[i % 1000]!.id,
    toObjectId: objects[(i + 1 + Math.floor(i / 1000)) % 1000]!.id
  }));
  const initial = createCanvasBoard({
    projectId: project, version: 1, objects, links, createdAt: now, updatedAt: now,
    scopePlacements: objects.map((object, i) => ({
      objectId: object.id, scopeKind: "chapter", scopeId: `capacity-chapter-${Math.floor((i % 500) / 5)}`,
      x: (i % 5) * 300, y: i < 500 ? 0 : 200, width: object.width, height: object.height
    }))
  });
  return { now, project, records, objects, initial };
}
