import { describe, expect, it } from "vitest";
import { BELLWETHER_FIXTURE_NAVIGATOR } from "@ghostwriter/core";
import {
  manuscriptExplorerActionLabel,
  manuscriptExplorerActions,
  manuscriptExplorerHeaderActions,
  resolveManuscriptExplorerCapabilities
} from "./manuscript-explorer-actions.js";

const project = BELLWETHER_FIXTURE_NAVIGATOR;
const book = project.books[0]!;
const part = book.parts[0]!;
const chapter = part.chapters[0]!;
const scene = chapter.scenes[0]!;
const knowledge = project.storyKnowledge[0]!;

describe("manuscriptExplorerActions", () => {
  it("lists add, rename, archive, and collapse-all for the project root", () => {
    expect(
      manuscriptExplorerActions({
        canAdd: true,
        addLabel: "book",
        canRename: true,
        canReorderUp: false,
        canReorderDown: false,
        canArchive: true,
        archived: false
      })
    ).toEqual(["add", "rename", "archive", "collapse-all"]);
  });

  it("swaps archive for restore when the node is archived", () => {
    expect(
      manuscriptExplorerActions({
        canAdd: false,
        canRename: true,
        canReorderUp: false,
        canReorderDown: false,
        canArchive: true,
        archived: true,
        includeCollapseAll: false
      })
    ).toEqual(["rename", "restore"]);
  });

  it("includes reorder actions only when allowed", () => {
    expect(
      manuscriptExplorerActions({
        canAdd: true,
        addLabel: "scene",
        canRename: true,
        canReorderUp: true,
        canReorderDown: false,
        canArchive: false,
        archived: false,
        includeCollapseAll: false
      })
    ).toEqual(["add", "rename", "move-up"]);
  });

  it("labels add with the child kind", () => {
    expect(
      manuscriptExplorerActionLabel("add", { addLabel: "chapter" })
    ).toBe("Add chapter");
  });

  it("omits archive and restore from the header action set", () => {
    expect(
      manuscriptExplorerHeaderActions({
        canAdd: true,
        addLabel: "book",
        canRename: true,
        canReorderUp: false,
        canReorderDown: false,
        canArchive: true,
        archived: false
      })
    ).toEqual(["add", "rename", "collapse-all"]);
  });
});

describe("resolveManuscriptExplorerCapabilities", () => {
  it("matches tree rules for project, book, chapter, and scene", () => {
    expect(
      resolveManuscriptExplorerCapabilities(project, { kind: "project" })
    ).toMatchObject({
      canAdd: true,
      addLabel: "book",
      canRename: true,
      canArchive: true,
      archived: false
    });

    expect(
      resolveManuscriptExplorerCapabilities(project, {
        kind: "book",
        bookId: book.id
      })
    ).toMatchObject({
      canAdd: true,
      addLabel: "part",
      canRename: true,
      canReorderUp: false,
      canReorderDown: true,
      canArchive: true
    });

    expect(
      resolveManuscriptExplorerCapabilities(project, {
        kind: "chapter",
        bookId: book.id,
        partId: part.id,
        chapterId: chapter.id
      })
    ).toMatchObject({
      canAdd: true,
      addLabel: "scene",
      canRename: true,
      canArchive: false
    });

    expect(
      resolveManuscriptExplorerCapabilities(project, {
        kind: "scene",
        bookId: book.id,
        partId: part.id,
        chapterId: chapter.id,
        sceneId: scene.id
      })
    ).toMatchObject({
      canAdd: false,
      canRename: true,
      canReorderUp: false,
      canReorderDown: true,
      canArchive: true
    });
  });

  it("keeps unassigned and story folders non-renamable", () => {
    expect(
      resolveManuscriptExplorerCapabilities(project, {
        kind: "unassigned",
        bookId: book.id
      })
    ).toMatchObject({
      canAdd: true,
      addLabel: "scene",
      canRename: false,
      canArchive: false
    });

    expect(
      resolveManuscriptExplorerCapabilities(project, {
        kind: "storyKnowledgeRoot"
      })
    ).toMatchObject({
      canAdd: true,
      addLabel: "story record",
      canRename: false,
      canArchive: false
    });
  });

  it("blocks archive when story knowledge is used as POV", () => {
    const mara =
      project.storyKnowledge.find((item) => item.label === "Mara Venn") ??
      knowledge;
    const scenePov = project.books
      .flatMap((book) => [
        ...book.parts.flatMap((part) =>
          part.chapters.flatMap((chapter) => chapter.scenes)
        ),
        ...book.unassignedScenes
      ])
      .some((scene) => scene.povStoryKnowledgeId === mara.id);
    expect(scenePov).toBe(true);
    const caps = resolveManuscriptExplorerCapabilities(project, {
      kind: "storyKnowledge",
      storyKnowledgeId: mara.id
    });
    expect(caps?.canRename).toBe(true);
    expect(caps?.canArchive).toBe(false);
  });
});
