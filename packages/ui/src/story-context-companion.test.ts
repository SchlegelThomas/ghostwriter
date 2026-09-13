import {
  bookId,
  chapterId,
  narrativeBeatId,
  partId,
  projectId,
  sceneId,
  storyContextFromProjectNavigator,
  storyKnowledgeId,
  type ProjectNavigator,
  type StoryContextBeatProjection
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  continueStoryIntentDraft,
  createStoryContextDirtySurfaces,
  createStoryIntentEditState,
  createStoryTextEditState,
  editStoryIntent,
  editStoryText,
  acknowledgedNarrativeBeatId,
  narrativeAnchorLabel,
  narrativeDependencyChoices,
  reconcileStoryIntent,
  reconcileStoryText,
  storyContextThreadChoices,
  storyIntentPatch,
  storyIntentSaveResult,
  storyIntentSaving,
  storyNarrativeDraftMatchesSubmission,
  storyTextSaveResult,
  storyTextSaving,
  hasDirtyStoryContextSurface,
  setStoryContextSurfaceDirty,
  threadSceneSemantics,
  useLatestStoryIntent
} from "./story-context-companion.js";

const project = projectId("project-context-companion");
const book = bookId("book-context-companion");
const part = partId("part-context-companion");
const chapter = chapterId("chapter-context-companion");
const firstScene = sceneId("scene-context-first");
const secondScene = sceneId("scene-context-second");
const archivedScene = sceneId("scene-context-archived");
const thread = storyKnowledgeId("thread-context-main");
const otherThread = storyKnowledgeId("thread-context-other");
const firstBeat = narrativeBeatId("beat-context-first");
const secondBeat = narrativeBeatId("beat-context-second");
const archivedBeat = narrativeBeatId("beat-context-archived");

const navigator: ProjectNavigator = {
  id: project,
  title: "Context project",
  version: 7,
  books: [
    {
      id: book,
      title: "Context book",
      status: "drafting",
      parts: [
        {
          id: part,
          title: "Part one",
          chapters: [
            {
              id: chapter,
              title: "Chapter one",
              summary: "Force the truth into view.",
              scenes: [
                {
                  id: firstScene,
                  title: "Arrival",
                  status: "drafting",
                  sketch: {
                    purpose: "Reveal the letter",
                    conflict: "Mara hides it",
                    sensoryNotes: "Salt in the air",
                    detail: "A locked tide"
                  }
                },
                {
                  id: secondScene,
                  title: "Reckoning",
                  status: "drafting"
                },
                {
                  id: archivedScene,
                  title: "Old ending",
                  status: "drafting",
                  archivedAt: "2026-08-01T00:00:00.000Z"
                }
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
  storyKnowledge: [
    {
      id: thread,
      label: "The missing letter",
      kind: "thread",
      authority: "planned",
      linkedSceneIds: [firstScene],
      linkedSceneCount: 1,
      linkedKnowledge: [],
      narrative: {
        resolution: "open",
        beats: [
          {
            id: firstBeat,
            sceneId: firstScene,
            role: "setup",
            summary: "The letter appears.",
            dependsOnBeatIds: []
          },
          {
            id: secondBeat,
            sceneId: secondScene,
            role: "development",
            summary: "Mara denies knowing it.",
            dependsOnBeatIds: [firstBeat]
          },
          {
            id: archivedBeat,
            sceneId: archivedScene,
            role: "payoff",
            summary: "An abandoned confession.",
            dependsOnBeatIds: [secondBeat],
            archivedAt: "2026-08-02T00:00:00.000Z"
          }
        ]
      }
    },
    {
      id: otherThread,
      label: "Weather front",
      kind: "thread",
      authority: "planned",
      linkedSceneIds: [],
      linkedSceneCount: 0,
      linkedKnowledge: []
    }
  ],
  totals: { books: 1, scenes: 3, storyKnowledge: 2, editions: 0 }
};

describe("story intent edit state", () => {
  it("builds a partial patch, trims authored text, and represents a clear with null", () => {
    const base = {
      purpose: "Reveal the letter",
      conflict: "Mara hides it",
      turn: "",
      openQuestions: "Who sent it?"
    };
    const draft = {
      purpose: "  Reveal who sent the letter  ",
      conflict: "  ",
      turn: "",
      openQuestions: "Who sent it?"
    };

    expect(storyIntentPatch(base, draft)).toEqual({
      purpose: "Reveal who sent the letter",
      conflict: null
    });
    expect(storyIntentPatch(base, draft)).not.toHaveProperty("turn");
    expect(storyIntentPatch(base, draft)).not.toHaveProperty("openQuestions");
  });

  it("retains dirty text on refusal and requires an explicit choice after canonical change", () => {
    const initial = createStoryIntentEditState(firstScene, 7, {
      purpose: "Reveal the letter",
      conflict: "Mara hides it"
    });
    const edited = editStoryIntent(initial, "purpose", "Reveal the forgery");
    const refused = storyIntentSaveResult(edited, false);
    expect(refused.status).toBe("not-saved");
    expect(refused.draft.purpose).toBe("Reveal the forgery");

    const changed = reconcileStoryIntent(refused, firstScene, 8, {
      purpose: "Reveal the signature",
      conflict: "Mara hides it"
    });
    expect(changed.status).toBe("canonical-changed");
    expect(changed.draft.purpose).toBe("Reveal the forgery");

    const continued = continueStoryIntentDraft(changed);
    expect(continued.projectVersion).toBe(8);
    expect(continued.base.purpose).toBe("Reveal the signature");
    expect(continued.draft.purpose).toBe("Reveal the forgery");
    expect(useLatestStoryIntent(changed).draft.purpose).toBe("Reveal the signature");
  });

  it("does not silently replace dirty text when a host changes scenes", () => {
    const edited = editStoryIntent(
      createStoryIntentEditState(firstScene, 7, { purpose: "Arrival purpose" }),
      "purpose",
      "My unfinished purpose"
    );
    const changed = reconcileStoryIntent(edited, secondScene, 8, {
      purpose: "Reckoning purpose"
    });

    expect(changed.sceneId).toBe(firstScene);
    expect(changed.draft.purpose).toBe("My unfinished purpose");
    expect(changed.status).toBe("canonical-changed");
    expect(continueStoryIntentDraft(changed)).toBe(changed);
    expect(useLatestStoryIntent(changed).sceneId).toBe(secondScene);
  });

  it("recognizes its own canonical intent acknowledgement and preserves edits made after submit", () => {
    const saving = storyIntentSaving(editStoryIntent(
      createStoryIntentEditState(firstScene, 7, { purpose: "Reveal the letter" }),
      "purpose",
      "Reveal the forgery"
    ));
    const editedAfterSubmit = editStoryIntent(saving, "conflict", "Mara objects");
    const acknowledged = reconcileStoryIntent(editedAfterSubmit, firstScene, 8, {
      purpose: "Reveal the forgery"
    });

    expect(acknowledged.status).toBe("saving");
    expect(acknowledged.draft.conflict).toBe("Mara objects");
    const completed = storyIntentSaveResult(acknowledged, true);
    expect(completed.status).toBe("editing");
    expect(completed.base.purpose).toBe("Reveal the forgery");
    expect(completed.draft.conflict).toBe("Mara objects");
  });

  it("keeps objective edits made after submit when its own acknowledgement arrives", () => {
    const saving = storyTextSaving(editStoryText(
      createStoryTextEditState("chapter", 7, "Find the letter"),
      "Expose the forgery"
    ));
    const editedAfterSubmit = editStoryText(saving, "Expose the forgery and culprit");
    const acknowledged = reconcileStoryText(
      editedAfterSubmit,
      "chapter",
      8,
      "Expose the forgery"
    );
    const completed = storyTextSaveResult(acknowledged, true);

    expect(completed.status).toBe("editing");
    expect(completed.base).toBe("Expose the forgery");
    expect(completed.draft).toBe("Expose the forgery and culprit");
  });
});

describe("bounded narrative presentation", () => {
  it("matches one newly acknowledged beat without confusing an existing identical beat", () => {
    const submission = {
      projectVersion: 7,
      threadId: thread,
      sceneId: firstScene,
      role: "payoff" as const,
      summary: "The letter is opened",
      dependencyIds: [firstBeat],
      existingBeatIds: [firstBeat]
    };
    const addedBeat = narrativeBeatId("beat-context-added");
    const acknowledged = acknowledgedNarrativeBeatId(submission, [
      {
        id: firstBeat,
        sceneId: firstScene,
        role: "payoff",
        summary: "The letter is opened",
        dependsOnBeatIds: [firstBeat]
      },
      {
        id: addedBeat,
        sceneId: firstScene,
        role: "payoff",
        summary: "The letter is opened",
        dependsOnBeatIds: [firstBeat]
      }
    ]);

    expect(acknowledged).toBe(addedBeat);
    expect(storyNarrativeDraftMatchesSubmission({
      threadId: thread,
      sceneId: firstScene,
      beatId: addedBeat,
      role: "payoff",
      summary: "The letter is opened",
      dependencyIds: [firstBeat]
    }, submission)).toBe(true);
  });

  it("keeps relevant threads first and bounds the choice list", () => {
    const context = storyContextFromProjectNavigator(navigator, {
      scope: { kind: "scene", sceneId: firstScene }
    });
    expect(storyContextThreadChoices(navigator, context, 1)).toEqual([
      {
        id: thread,
        label: "The missing letter",
        relevant: true,
        archived: false
      }
    ]);
  });

  it("searches canonical thread names before applying the display bound", () => {
    const context = storyContextFromProjectNavigator(navigator, { scope: { kind: "scene", sceneId: firstScene } });
    expect(storyContextThreadChoices(navigator, context, 1, "MISSING LETTER")[0]?.id).toBe(thread);
    expect(storyContextThreadChoices(navigator, context, 1, "no such thread")).toEqual([]);
  });

  it("offers only same-thread dependencies and retains selected archived anchors beyond the limit", () => {
    const selectedThread = navigator.storyKnowledge[0];
    if (selectedThread === undefined) throw new Error("Expected fixture thread.");
    const choices = narrativeDependencyChoices(navigator, selectedThread, {
      excludeBeatId: secondBeat,
      includeBeatIds: [archivedBeat],
      limit: 1
    });

    expect(choices.map((choice) => choice.id)).toEqual([firstBeat, archivedBeat]);
    expect(choices[1]).toMatchObject({ archived: true, sceneArchived: true });
  });

  it("labels archived anchors and keeps association semantics separate from authored beats", () => {
    const beat = {
      id: archivedBeat,
      threadId: thread,
      sceneId: archivedScene,
      role: "payoff",
      summary: "An abandoned confession.",
      dependsOnBeatIds: [secondBeat],
      archived: true,
      canonicalIndex: 2,
      sceneTitle: "Old ending",
      sceneArchived: true,
      anchorState: "beat-and-scene-archived"
    } satisfies StoryContextBeatProjection;

    expect(narrativeAnchorLabel(beat)).toBe("Archived beat · archived scene anchor");
    expect(threadSceneSemantics({ associated: true, mappedBeatCount: 0 })).toEqual([
      "Story-record association"
    ]);
    expect(threadSceneSemantics({ associated: false, mappedBeatCount: 1 })).toEqual([
      "Explicit narrative beat"
    ]);
  });
});

describe("story context surface dirtiness", () => {
  it("tracks Draft and Canvas independently for Split hosts", () => {
    const clean = createStoryContextDirtySurfaces();
    const draftDirty = setStoryContextSurfaceDirty(clean, "draft", true);
    const bothDirty = setStoryContextSurfaceDirty(draftDirty, "canvas", true);
    const canvasOnly = setStoryContextSurfaceDirty(bothDirty, "draft", false);

    expect(draftDirty).toEqual({ draft: true, canvas: false });
    expect(bothDirty).toEqual({ draft: true, canvas: true });
    expect(canvasOnly).toEqual({ draft: false, canvas: true });
    expect(hasDirtyStoryContextSurface(canvasOnly)).toBe(true);
    expect(
      hasDirtyStoryContextSurface(
        setStoryContextSurfaceDirty(canvasOnly, "canvas", false)
      )
    ).toBe(false);
  });
});
