import { describe, expect, it } from "vitest";
import {
  accountId,
  bookId,
  chapterId,
  createGhostwriterServices,
  createMemoryProjectRepository,
  partId,
  ProjectVersionConflictError,
  sceneId,
  storyKnowledgeId,
  type DomainIdKind,
  type IdGenerator,
  type ProjectCommand
} from "./index.js";

function sequenceIds(values: Readonly<Record<DomainIdKind, readonly string[]>>): IdGenerator {
  const positions = new Map<DomainIdKind, number>();
  return {
    create(kind): string {
      const index = positions.get(kind) ?? 0;
      const value = values[kind][index];
      positions.set(kind, index + 1);
      if (value === undefined) throw new Error(`No ${kind} ID remains in the fixture.`);
      return value;
    }
  };
}

const ids = () =>
  sequenceIds({
    project: ["project-command-test"],
    book: ["book-one", "book-two"],
    part: ["part-one", "part-two"],
    chapter: ["chapter-one", "chapter-two"],
    scene: ["scene-one"],
    sceneDocumentBlock: [],
    storyKnowledge: ["knowledge-one", "knowledge-two"],
    edition: [],
    revision: [],
    sceneVariant: [],
    canvasObject: [],
    canvasLink: [],
    canvasRevision: []
  });

async function setup() {
  const ownerAccountId = accountId("account-owner");
  const services = createGhostwriterServices({
    projects: createMemoryProjectRepository(),
    ids: ids(),
    clock: { now: () => "2026-07-11T19:00:00.000Z" }
  });
  const projectId = await services.createStoryProject({
    ownerAccountId,
    title: "Command Story",
    firstBookTitle: "Book One"
  });
  async function execute(expectedVersion: number, command: ProjectCommand) {
    return services.executeProjectCommand({
      accountId: ownerAccountId,
      projectId,
      expectedVersion,
      command
    });
  }
  return { services, ownerAccountId, projectId, execute };
}

describe("project commands", () => {
  it("manages the complete current-kernel hierarchy with one version per command", async () => {
    const { execute } = await setup();
    let navigator = await execute(1, { type: "book.create", title: "Book Two" });
    navigator = await execute(navigator.version, {
      type: "book.update",
      bookId: bookId("book-two"),
      title: "The Second Book",
      status: "drafting"
    });
    navigator = await execute(navigator.version, {
      type: "book.reorder",
      bookIds: [bookId("book-two"), bookId("book-one")]
    });
    navigator = await execute(navigator.version, {
      type: "part.create",
      bookId: bookId("book-one"),
      title: "Part One"
    });
    navigator = await execute(navigator.version, {
      type: "chapter.create",
      bookId: bookId("book-one"),
      partId: partId("part-one"),
      title: "Chapter One"
    });
    navigator = await execute(navigator.version, {
      type: "scene.create",
      bookId: bookId("book-one"),
      chapterId: chapterId("chapter-one"),
      position: 0,
      title: "Opening"
    });
    navigator = await execute(navigator.version, {
      type: "storyKnowledge.create",
      label: "Mara",
      kind: "character",
      authority: "planned"
    });
    navigator = await execute(navigator.version, {
      type: "storyKnowledge.setSceneLink",
      storyKnowledgeId: storyKnowledgeId("knowledge-one"),
      sceneId: sceneId("scene-one"),
      linked: true
    });
    navigator = await execute(navigator.version, {
      type: "scene.update",
      sceneId: sceneId("scene-one"),
      title: "The Opening Call",
      status: "drafting",
      summary: "Mara answers.",
      povStoryKnowledgeId: storyKnowledgeId("knowledge-one")
    });
    navigator = await execute(navigator.version, {
      type: "scene.move",
      sceneId: sceneId("scene-one"),
      bookId: bookId("book-two"),
      position: 0
    });
    navigator = await execute(navigator.version, {
      type: "scene.setArchived",
      sceneId: sceneId("scene-one"),
      archived: true
    });
    navigator = await execute(navigator.version, {
      type: "storyKnowledge.update",
      storyKnowledgeId: storyKnowledgeId("knowledge-one"),
      authority: "confirmed"
    });
    navigator = await execute(navigator.version, {
      type: "scene.update",
      sceneId: sceneId("scene-one"),
      povStoryKnowledgeId: null
    });
    navigator = await execute(navigator.version, {
      type: "storyKnowledge.setArchived",
      storyKnowledgeId: storyKnowledgeId("knowledge-one"),
      archived: true
    });
    navigator = await execute(navigator.version, {
      type: "book.setArchived",
      bookId: bookId("book-one"),
      archived: true
    });
    navigator = await execute(navigator.version, {
      type: "project.setArchived",
      archived: true
    });
    navigator = await execute(navigator.version, {
      type: "project.setArchived",
      archived: false
    });

    expect(navigator.version).toBe(18);
    expect(navigator.books.map((book) => book.id)).toEqual([
      bookId("book-two"),
      bookId("book-one")
    ]);
    expect(navigator.books[0]).toMatchObject({
      title: "The Second Book",
      status: "drafting",
      unassignedScenes: [
        {
          id: sceneId("scene-one"),
          title: "The Opening Call",
          archivedAt: "2026-07-11T19:00:00.000Z"
        }
      ]
    });
    expect(navigator.books[1]).toMatchObject({
      archivedAt: "2026-07-11T19:00:00.000Z"
    });
    expect(navigator.storyKnowledge[0]).toMatchObject({
      authority: "confirmed",
      linkedSceneCount: 1,
      archivedAt: "2026-07-11T19:00:00.000Z"
    });
    expect(navigator.archivedAt).toBeUndefined();
  });

  it("renames, reorders, and safely removes empty structure", async () => {
    const { execute } = await setup();
    let navigator = await execute(1, {
      type: "part.create",
      bookId: bookId("book-one"),
      title: "One"
    });
    navigator = await execute(navigator.version, {
      type: "part.create",
      bookId: bookId("book-one"),
      title: "Two"
    });
    navigator = await execute(navigator.version, {
      type: "part.rename",
      bookId: bookId("book-one"),
      partId: partId("part-two"),
      title: "Second"
    });
    navigator = await execute(navigator.version, {
      type: "part.reorder",
      bookId: bookId("book-one"),
      partIds: [partId("part-two"), partId("part-one")]
    });
    navigator = await execute(navigator.version, {
      type: "chapter.create",
      bookId: bookId("book-one"),
      partId: partId("part-one"),
      title: "One"
    });
    navigator = await execute(navigator.version, {
      type: "chapter.create",
      bookId: bookId("book-one"),
      partId: partId("part-one"),
      title: "Two"
    });
    navigator = await execute(navigator.version, {
      type: "chapter.rename",
      bookId: bookId("book-one"),
      partId: partId("part-one"),
      chapterId: chapterId("chapter-two"),
      title: "Second Chapter"
    });
    navigator = await execute(navigator.version, {
      type: "chapter.reorder",
      bookId: bookId("book-one"),
      partId: partId("part-one"),
      chapterIds: [chapterId("chapter-two"), chapterId("chapter-one")]
    });
    navigator = await execute(navigator.version, {
      type: "chapter.removeEmpty",
      bookId: bookId("book-one"),
      partId: partId("part-one"),
      chapterId: chapterId("chapter-one")
    });
    navigator = await execute(navigator.version, {
      type: "part.removeEmpty",
      bookId: bookId("book-one"),
      partId: partId("part-two")
    });

    expect(navigator.books[0]?.parts).toMatchObject([
      {
        id: partId("part-one"),
        chapters: [{ id: chapterId("chapter-two"), title: "Second Chapter" }]
      }
    ]);
  });

  it("updates chapter summary, scene ambience URLs, and knowledge depth", async () => {
    const { execute } = await setup();
    let navigator = await execute(1, {
      type: "part.create",
      bookId: bookId("book-one"),
      title: "Part One"
    });
    navigator = await execute(navigator.version, {
      type: "chapter.create",
      bookId: bookId("book-one"),
      partId: partId("part-one"),
      title: "Chapter One"
    });
    navigator = await execute(navigator.version, {
      type: "chapter.update",
      bookId: bookId("book-one"),
      partId: partId("part-one"),
      chapterId: chapterId("chapter-one"),
      summary: "Objectives: land Mara on the island."
    });
    navigator = await execute(navigator.version, {
      type: "scene.create",
      bookId: bookId("book-one"),
      chapterId: chapterId("chapter-one"),
      title: "Opening"
    });
    navigator = await execute(navigator.version, {
      type: "storyKnowledge.create",
      label: "Mara",
      kind: "character",
      authority: "planned"
    });
    navigator = await execute(navigator.version, {
      type: "storyKnowledge.create",
      label: "Bellwether",
      kind: "location",
      authority: "confirmed"
    });
    navigator = await execute(navigator.version, {
      type: "scene.update",
      sceneId: sceneId("scene-one"),
      backdrop: {
        url: "https://cdn.example.com/backdrop.jpg",
        caption: "Fog over the harbor"
      },
      music: { url: "https://cdn.example.com/score.mp3", label: "Harbor theme" },
      imageRefs: [
        {
          url: "https://cdn.example.com/mara.png",
          alt: "Mara at the pier",
          caption: "Reference still"
        }
      ]
    });
    navigator = await execute(navigator.version, {
      type: "storyKnowledge.update",
      storyKnowledgeId: storyKnowledgeId("knowledge-one"),
      notes: "Answers every late-night call.",
      aliases: ["Caller", "M. Venn"]
    });
    navigator = await execute(navigator.version, {
      type: "storyKnowledge.setKnowledgeLink",
      fromId: storyKnowledgeId("knowledge-one"),
      toId: storyKnowledgeId("knowledge-two"),
      kind: "cast",
      linked: true
    });

    expect(navigator.books[0]?.parts[0]?.chapters[0]).toMatchObject({
      id: chapterId("chapter-one"),
      summary: "Objectives: land Mara on the island."
    });
    expect(navigator.books[0]?.parts[0]?.chapters[0]?.scenes[0]).toMatchObject({
      backdrop: {
        url: "https://cdn.example.com/backdrop.jpg",
        caption: "Fog over the harbor"
      },
      music: { url: "https://cdn.example.com/score.mp3", label: "Harbor theme" },
      imageRefs: [
        {
          url: "https://cdn.example.com/mara.png",
          alt: "Mara at the pier",
          caption: "Reference still"
        }
      ]
    });
    expect(
      navigator.storyKnowledge.find(
        (knowledge) => knowledge.id === storyKnowledgeId("knowledge-one")
      )
    ).toMatchObject({
      notes: "Answers every late-night call.",
      aliases: ["Caller", "M. Venn"],
      linkedKnowledge: [
        { toId: storyKnowledgeId("knowledge-two"), kind: "cast" }
      ]
    });

    await expect(
      execute(navigator.version, {
        type: "scene.update",
        sceneId: sceneId("scene-one"),
        backdrop: { url: "ftp://cdn.example.com/bad.jpg" }
      })
    ).rejects.toMatchObject({ code: "INVALID_URL" });

    navigator = await execute(navigator.version, {
      type: "scene.update",
      sceneId: sceneId("scene-one"),
      backdrop: null,
      music: null,
      imageRefs: null
    });
    navigator = await execute(navigator.version, {
      type: "chapter.update",
      bookId: bookId("book-one"),
      partId: partId("part-one"),
      chapterId: chapterId("chapter-one"),
      summary: null
    });
    navigator = await execute(navigator.version, {
      type: "storyKnowledge.setKnowledgeLink",
      fromId: storyKnowledgeId("knowledge-one"),
      toId: storyKnowledgeId("knowledge-two"),
      kind: "cast",
      linked: false
    });
    navigator = await execute(navigator.version, {
      type: "storyKnowledge.update",
      storyKnowledgeId: storyKnowledgeId("knowledge-one"),
      notes: null,
      aliases: null
    });

    expect(navigator.books[0]?.parts[0]?.chapters[0]?.summary).toBeUndefined();
    expect(navigator.books[0]?.parts[0]?.chapters[0]?.scenes[0]?.backdrop).toBeUndefined();
    expect(
      navigator.storyKnowledge.find(
        (knowledge) => knowledge.id === storyKnowledgeId("knowledge-one")
      )
    ).toMatchObject({
      linkedKnowledge: []
    });
    expect(
      navigator.storyKnowledge.find(
        (knowledge) => knowledge.id === storyKnowledgeId("knowledge-one")
      )?.notes
    ).toBeUndefined();
  });

  it("updates part summary and title via part.update", async () => {
    const { execute } = await setup();
    let navigator = await execute(1, {
      type: "part.create",
      bookId: bookId("book-one"),
      title: "Part One"
    });
    navigator = await execute(navigator.version, {
      type: "part.update",
      bookId: bookId("book-one"),
      partId: partId("part-one"),
      summary: "Act objectives: establish the harbor mystery."
    });

    expect(navigator.books[0]?.parts[0]).toMatchObject({
      id: partId("part-one"),
      title: "Part One",
      summary: "Act objectives: establish the harbor mystery."
    });

    navigator = await execute(navigator.version, {
      type: "part.update",
      bookId: bookId("book-one"),
      partId: partId("part-one"),
      title: "Act One"
    });

    expect(navigator.books[0]?.parts[0]).toMatchObject({
      title: "Act One",
      summary: "Act objectives: establish the harbor mystery."
    });

    navigator = await execute(navigator.version, {
      type: "part.update",
      bookId: bookId("book-one"),
      partId: partId("part-one"),
      summary: null
    });

    expect(navigator.books[0]?.parts[0]?.summary).toBeUndefined();
    expect(navigator.books[0]?.parts[0]?.title).toBe("Act One");
  });

  it("rejects stale writes and unsafe archive operations atomically", async () => {
    const { execute } = await setup();
    const renamed = await execute(1, {
      type: "project.rename",
      title: "Fresh title"
    });

    await expect(
      execute(1, { type: "project.rename", title: "Stale title" })
    ).rejects.toBeInstanceOf(ProjectVersionConflictError);
    await expect(
      execute(renamed.version, {
        type: "book.setArchived",
        bookId: bookId("book-one"),
        archived: true
      })
    ).rejects.toMatchObject({
      code: "UNSAFE_REMOVAL"
    });
    const afterFailures = await execute(renamed.version, {
      type: "project.rename",
      title: "Still consistent"
    });
    expect(afterFailures.version).toBe(3);
    expect(afterFailures.title).toBe("Still consistent");
  });

  it("refuses new story links to archived scenes without trapping existing links", async () => {
    const { execute } = await setup();
    let navigator = await execute(1, {
      type: "scene.create",
      bookId: bookId("book-one"),
      title: "Archived scene"
    });
    navigator = await execute(navigator.version, {
      type: "storyKnowledge.create",
      label: "Known place",
      kind: "location",
      authority: "confirmed"
    });
    navigator = await execute(navigator.version, {
      type: "scene.setArchived",
      sceneId: sceneId("scene-one"),
      archived: true
    });

    await expect(
      execute(navigator.version, {
        type: "storyKnowledge.setSceneLink",
        storyKnowledgeId: storyKnowledgeId("knowledge-one"),
        sceneId: sceneId("scene-one"),
        linked: true
      })
    ).rejects.toMatchObject({ code: "INVALID_PLACEMENT" });

    navigator = await execute(navigator.version, {
      type: "scene.setArchived",
      sceneId: sceneId("scene-one"),
      archived: false
    });
    navigator = await execute(navigator.version, {
      type: "storyKnowledge.setSceneLink",
      storyKnowledgeId: storyKnowledgeId("knowledge-one"),
      sceneId: sceneId("scene-one"),
      linked: true
    });
    navigator = await execute(navigator.version, {
      type: "scene.setArchived",
      sceneId: sceneId("scene-one"),
      archived: true
    });
    navigator = await execute(navigator.version, {
      type: "storyKnowledge.setSceneLink",
      storyKnowledgeId: storyKnowledgeId("knowledge-one"),
      sceneId: sceneId("scene-one"),
      linked: false
    });

    expect(navigator.storyKnowledge[0]?.linkedSceneCount).toBe(0);
  });
});
