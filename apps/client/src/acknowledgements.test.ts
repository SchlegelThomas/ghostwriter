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
  acknowledgementForCanvasCommand,
  acknowledgementForProjectCommand,
  acknowledgementToast,
  problemToast,
  SAFE_UNDO_DURATION_MS,
  shouldShowDraftAcknowledgement,
  toastReducer
} from "./acknowledgements.js";

const project = projectId("project-acknowledgement");
const firstBook = bookId("book-acknowledgement-first");
const secondBook = bookId("book-acknowledgement-second");
const part = partId("part-acknowledgement");
const firstChapter = chapterId("chapter-acknowledgement-first");
const secondChapter = chapterId("chapter-acknowledgement-second");
const firstScene = sceneId("scene-acknowledgement-first");
const secondScene = sceneId("scene-acknowledgement-second");
const knowledge = storyKnowledgeId("knowledge-acknowledgement");

const before: ProjectNavigator = {
  id: project,
  title: "Harbor",
  version: 4,
  books: [
    {
      id: firstBook,
      title: "Tides",
      status: "drafting",
      parts: [
        {
          id: part,
          title: "Part One",
          chapters: [
            {
              id: firstChapter,
              title: "Low Water",
              scenes: [
                {
                  id: firstScene,
                  title: "The Pier",
                  status: "drafting",
                  summary: "A quiet arrival.",
                  povStoryKnowledgeId: knowledge
                },
                {
                  id: secondScene,
                  title: "The Bell",
                  status: "planned"
                }
              ]
            },
            { id: secondChapter, title: "High Water", scenes: [] }
          ]
        }
      ],
      unassignedScenes: [],
      editions: [],
      sceneCount: 2
    },
    {
      id: secondBook,
      title: "Storms",
      status: "planned",
      parts: [],
      unassignedScenes: [],
      editions: [],
      sceneCount: 0
    }
  ],
  storyKnowledge: [
    {
      id: knowledge,
      label: "Mara",
      kind: "character",
      authority: "confirmed",
      linkedSceneIds: [firstScene],
      linkedSceneCount: 1,
      linkedKnowledge: []
    }
  ],
  totals: { books: 2, scenes: 2, storyKnowledge: 1, editions: 0 }
};

describe("project acknowledgement and inverse commands", () => {
  it("names a rename only after the acknowledged projection and captures its inverse", () => {
    const after = { ...before, title: "Harbor Cycle", version: 5 };
    expect(
      acknowledgementForProjectCommand(
        before,
        { type: "project.rename", title: "Harbor Cycle" },
        after
      )
    ).toEqual({
      title: "Project renamed",
      detail: "Harbor Cycle · Saved to project",
      inverse: { type: "project.rename", title: "Harbor" },
      actionLabel: "Undo"
    });
  });

  it("captures the original scene placement for a safe move inverse", () => {
    const movedScene = before.books[0]!.parts[0]!.chapters[0]!.scenes[0]!;
    const after: ProjectNavigator = {
      ...before,
      version: 5,
      books: [
        {
          ...before.books[0]!,
          parts: [
            {
              ...before.books[0]!.parts[0]!,
              chapters: [
                {
                  ...before.books[0]!.parts[0]!.chapters[0]!,
                  scenes: [before.books[0]!.parts[0]!.chapters[0]!.scenes[1]!]
                },
                {
                  ...before.books[0]!.parts[0]!.chapters[1]!,
                  scenes: [movedScene]
                }
              ]
            }
          ]
        },
        before.books[1]!
      ]
    };
    const acknowledgement = acknowledgementForProjectCommand(
      before,
      {
        type: "scene.move",
        sceneId: firstScene,
        bookId: firstBook,
        chapterId: secondChapter,
        position: 0
      },
      after
    );
    expect(acknowledgement.title).toBe("Scene moved");
    expect(acknowledgement.detail).toContain("High Water");
    expect(acknowledgement.inverse).toEqual({
      type: "scene.move",
      sceneId: firstScene,
      bookId: firstBook,
      chapterId: firstChapter,
      position: 0
    });
  });

  it("does not offer client Undo for create or safe empty removal", () => {
    expect(
      acknowledgementForProjectCommand(
        before,
        { type: "book.create", title: "New Book" },
        { ...before, version: 5 }
      ).inverse
    ).toBeUndefined();
    expect(
      acknowledgementForProjectCommand(
        before,
        {
          type: "chapter.removeEmpty",
          bookId: firstBook,
          partId: part,
          chapterId: secondChapter
        },
        { ...before, version: 5 }
      ).inverse
    ).toBeUndefined();
  });

  it("uses Canvas snapshot Undo for an acknowledged relationship", () => {
    expect(
      acknowledgementForCanvasCommand({
        type: "canvas.link.create",
        link: {
          kind: "thread",
          fromObjectId: "canvas-object-from" as never,
          toObjectId: "canvas-object-to" as never,
          authority: "confirmed"
        }
      })
    ).toEqual({
      title: "Relationship linked",
      detail: "Thread relationship · Saved to Canvas",
      actionLabel: "Undo"
    });
  });
});

describe("toast timing and visibility", () => {
  it("keeps at most three visible and protects sticky problems first", () => {
    const conflict = problemToast({
      id: "conflict",
      title: "Conflict",
      detail: "Review latest",
      now: 0
    });
    let state = toastReducer([], { type: "push", toast: conflict });
    for (let index = 1; index <= 4; index += 1) {
      state = toastReducer(state, {
        type: "push",
        toast: acknowledgementToast({
          id: `success-${index}`,
          title: `Saved ${index}`,
          detail: "Acknowledged",
          now: index
        })
      });
    }
    expect(state).toHaveLength(3);
    expect(state.map((toast) => toast.id)).toEqual([
      "conflict",
      "success-3",
      "success-4"
    ]);
  });

  it("holds Undo for thirty seconds and pauses the remaining timer", () => {
    const toast = acknowledgementToast({
      id: "undo",
      title: "Chapter renamed",
      detail: "Saved",
      actionLabel: "Undo",
      now: 1_000
    });
    expect(toast.expiresAt).toBe(1_000 + SAFE_UNDO_DURATION_MS);
    let state = toastReducer([toast], {
      type: "pause",
      id: toast.id,
      now: 6_000
    });
    expect(state[0]?.pausedRemainingMs).toBe(SAFE_UNDO_DURATION_MS - 5_000);
    state = toastReducer(state, {
      type: "tick",
      now: 100_000
    });
    expect(state).toHaveLength(1);
    state = toastReducer(state, {
      type: "resume",
      id: toast.id,
      now: 100_000
    });
    state = toastReducer(state, {
      type: "tick",
      now: 100_000 + SAFE_UNDO_DURATION_MS - 5_000
    });
    expect(state).toHaveLength(0);
  });

  it("suppresses repeated Draft acknowledgements inside one quiet window", () => {
    expect(shouldShowDraftAcknowledgement(undefined, 10_000)).toBe(true);
    expect(shouldShowDraftAcknowledgement(10_000, 39_999)).toBe(false);
    expect(shouldShowDraftAcknowledgement(10_000, 40_000)).toBe(true);
  });
});
