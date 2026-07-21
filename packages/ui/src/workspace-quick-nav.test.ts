import {
  bookId,
  chapterId,
  partId,
  projectId,
  sceneId,
  storyKnowledgeId,
  type ProjectNavigator
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  buildWorkspaceJumpTargets,
  commandPaletteKinds,
  filterWorkspaceJumpTargets,
  manuscriptJumpKinds,
  type WorkspaceJumpKind,
  type WorkspaceJumpTarget
} from "./workspace-quick-nav.js";

const projectIdValue = projectId("project-trail");
const book = bookId("book-trail");
const archivedBook = bookId("book-archived");
const part = partId("part-trail");
const chapter = chapterId("chapter-trail");
const emptyChapter = chapterId("chapter-empty");
const sceneOne = sceneId("scene-one");
const sceneTwo = sceneId("scene-two");
const archivedChapterScene = sceneId("scene-archived");
const unassignedScene = sceneId("scene-unassigned");
const archivedUnassignedScene = sceneId("scene-unassigned-archived");
const knowledge = storyKnowledgeId("knowledge-one");
const archivedKnowledge = storyKnowledgeId("knowledge-archived");
const archivedAt = "2026-07-18T12:00:00.000Z";

const navigator: ProjectNavigator = {
  id: projectIdValue,
  title: "Trail Harbor",
  version: 4,
  books: [
    {
      id: book,
      title: "Book of Steps",
      status: "drafting",
      parts: [
        {
          id: part,
          title: "Act One",
          chapters: [
            {
              id: chapter,
              title: "First Landing",
              summary: "The crew reaches shore.",
              scenes: [
                { id: sceneOne, title: "Step One", status: "drafting" },
                { id: sceneTwo, title: "Step Two", status: "planned" },
                {
                  id: archivedChapterScene,
                  title: "Archived Step",
                  status: "planned",
                  archivedAt
                }
              ]
            },
            {
              id: emptyChapter,
              title: "Empty Cove",
              scenes: []
            }
          ]
        }
      ],
      unassignedScenes: [
        { id: unassignedScene, title: "Loose Idea", status: "planned" },
        {
          id: archivedUnassignedScene,
          title: "Archived Loose",
          status: "planned",
          archivedAt
        }
      ],
      editions: [],
      sceneCount: 5
    },
    {
      id: archivedBook,
      title: "Archived Book",
      status: "planned",
      parts: [],
      unassignedScenes: [],
      editions: [],
      sceneCount: 0,
      archivedAt
    }
  ],
  storyKnowledge: [
    {
      id: knowledge,
      label: "Mara Venn",
      kind: "character",
      authority: "planned",
      linkedSceneIds: [sceneOne],
      linkedSceneCount: 1,
      linkedKnowledge: []
    },
    {
      id: archivedKnowledge,
      label: "Old Rule",
      kind: "world-rule",
      authority: "planned",
      linkedSceneIds: [],
      linkedSceneCount: 0,
      linkedKnowledge: [],
      archivedAt
    }
  ],
  totals: { books: 1, scenes: 5, storyKnowledge: 2, editions: 0 }
};

function targetsByKind(
  targets: readonly WorkspaceJumpTarget[],
  kind: WorkspaceJumpKind
): readonly WorkspaceJumpTarget[] {
  return targets.filter((target) => target.kind === kind);
}

function targetIds(targets: readonly WorkspaceJumpTarget[]): string[] {
  return targets.map((target) => target.id);
}

describe("buildWorkspaceJumpTargets", () => {
  const targets = buildWorkspaceJumpTargets(navigator);

  it("includes shell mode and panel destinations", () => {
    expect(targetIds(targetsByKind(targets, "mode"))).toEqual([
      "mode:draft",
      "mode:canvas",
      "mode:split"
    ]);
    expect(targetIds(targetsByKind(targets, "panel"))).toEqual([
      "panel:structure",
      "panel:chat",
      "panel:jump"
    ]);
  });

  it("indexes active manuscript books, chapters, scenes, and story records", () => {
    expect(targetIds(targetsByKind(targets, "book"))).toEqual([
      `book:${book}`,
      `book:${archivedBook}`
    ]);
    expect(targetIds(targetsByKind(targets, "chapter"))).toEqual([
      `chapter:${chapter}`,
      `chapter:${emptyChapter}`
    ]);
    expect(targetIds(targetsByKind(targets, "scene"))).toEqual([
      `scene:${sceneOne}`,
      `scene:${sceneTwo}`,
      `scene:${unassignedScene}`
    ]);
    expect(targetIds(targetsByKind(targets, "story-knowledge"))).toEqual([
      `story-knowledge:${knowledge}`
    ]);
  });

  it("skips archived scenes and story records but keeps book metadata", () => {
    const ids = targetIds(targets);
    expect(ids).not.toContain(`scene:${archivedChapterScene}`);
    expect(ids).not.toContain(`scene:${archivedUnassignedScene}`);
    expect(ids).not.toContain(`story-knowledge:${archivedKnowledge}`);
  });

  it("carries manuscript selection metadata on indexed targets", () => {
    expect(targets.find((target) => target.id === `scene:${sceneOne}`)).toMatchObject({
      title: "Step One",
      kind: "scene",
      mode: "draft",
      selection: {
        kind: "scene",
        bookId: book,
        partId: part,
        chapterId: chapter,
        sceneId: sceneOne
      }
    });
    expect(
      targets.find((target) => target.id === `story-knowledge:${knowledge}`)
    ).toMatchObject({
      title: "Mara Venn",
      subtitle: "Story record · character",
      selection: { kind: "storyKnowledge", storyKnowledgeId: knowledge }
    });
  });
});

describe("filterWorkspaceJumpTargets", () => {
  const targets = buildWorkspaceJumpTargets(navigator);

  it("returns all targets for an empty query", () => {
    expect(filterWorkspaceJumpTargets(targets, "")).toHaveLength(targets.length);
  });

  it("ranks an exact scene title match at the top", () => {
    const results = filterWorkspaceJumpTargets(targets, "Step One");
    expect(results[0]?.id).toBe(`scene:${sceneOne}`);
    expect(results[0]?.title).toBe("Step One");
  });

  it("excludes shell destinations when limited to manuscript kinds", () => {
    const results = filterWorkspaceJumpTargets(targets, "", {
      kinds: manuscriptJumpKinds()
    });
    expect(results.every((target) => manuscriptJumpKinds().includes(target.kind))).toBe(
      true
    );
    expect(results.some((target) => target.kind === "mode")).toBe(false);
    expect(results.some((target) => target.kind === "panel")).toBe(false);
    expect(results).toHaveLength(8);
  });
});

describe("workspace jump kind helpers", () => {
  it("returns manuscript-only kinds for quick open", () => {
    expect(manuscriptJumpKinds()).toEqual([
      "book",
      "chapter",
      "scene",
      "story-knowledge"
    ]);
  });

  it("returns shell command kinds for the command palette", () => {
    expect(commandPaletteKinds()).toEqual(["mode", "panel"]);
  });
});
