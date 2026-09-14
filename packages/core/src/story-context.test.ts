import { describe, expect, it } from "vitest";
import {
  bookId,
  chapterId,
  defineProjectRecords,
  narrativeBeatId,
  partId,
  projectId,
  sceneId,
  storyKnowledgeId,
  type ProjectRecords
} from "./domain.js";
import { projectNavigatorFromRecords } from "./project-navigator.js";
import {
  STORY_CONTEXT_MAX_SCENES,
  storyContextFromProjectNavigator,
  storyContextFromProjectRecords
} from "./story-context.js";

const project = projectId("project-story-context");
const book = bookId("book-story-context");
const part = partId("part-story-context");
const chapter = chapterId("chapter-story-context");
const opening = sceneId("scene-opening");
const turn = sceneId("scene-turn");
const archived = sceneId("scene-archived");
const unassigned = sceneId("scene-unassigned");
const letterThread = storyKnowledgeId("knowledge-letter-thread");
const setupBeat = narrativeBeatId("beat-letter-setup");
const payoffBeat = narrativeBeatId("beat-letter-payoff");

function records(
  options: Readonly<{
    sceneOrder?: readonly (typeof opening)[];
    projectArchived?: boolean;
    bookArchived?: boolean;
    narrative?: boolean;
  }> = {}
): ProjectRecords {
  const sceneOrder = options.sceneOrder ?? [opening, turn, archived];
  return defineProjectRecords({
    project: {
      id: project,
      title: "The harbor story",
      bookIds: [book],
      createdAt: "2026-09-12T12:00:00.000Z",
      version: 7,
      ...(options.projectArchived
        ? { archivedAt: "2026-09-12T13:00:00.000Z" }
        : {})
    },
    books: [
      {
        id: book,
        projectId: project,
        title: "Book one",
        status: "drafting",
        manuscript: {
          parts: [
            {
              id: part,
              title: "Part one",
              chapters: [
                {
                  id: chapter,
                  title: "The arrival",
                  summary: "Bring Mara ashore and make the letter dangerous.",
                  sceneIds: sceneOrder
                }
              ]
            }
          ],
          unassignedSceneIds: [unassigned]
        },
        createdAt: "2026-09-12T12:00:00.000Z",
        ...(options.bookArchived
          ? { archivedAt: "2026-09-12T13:00:00.000Z" }
          : {})
      }
    ],
    scenes: [
      {
        id: opening,
        projectId: project,
        bookId: book,
        title: "Mara lands",
        status: "drafting",
        sketch: {
          purpose: "Mara hides the letter.",
          conflict: "The harbor master searches every bag.",
          turn: "Theo sees the broken seal.",
          openQuestions: "Who sent the warning?",
          sensoryNotes: "Salt and wet rope"
        }
      },
      {
        id: turn,
        projectId: project,
        bookId: book,
        title: "The search",
        status: "planned"
      },
      {
        id: archived,
        projectId: project,
        bookId: book,
        title: "Old confrontation",
        status: "revising",
        archivedAt: "2026-09-12T13:00:00.000Z"
      },
      {
        id: unassigned,
        projectId: project,
        bookId: book,
        title: "A possible coda",
        status: "planned"
      }
    ],
    storyKnowledge: [
      {
        id: letterThread,
        projectId: project,
        label: "The sealed letter",
        kind: "thread",
        authority: "planned",
        linkedSceneIds: [turn, opening],
        linkedKnowledge: [],
        ...(options.narrative
          ? {
              narrative: {
                resolution: "intentionally-open" as const,
                beats: [
                  {
                    id: setupBeat,
                    sceneId: opening,
                    role: "setup" as const,
                    summary: "Mara conceals the letter.",
                    dependsOnBeatIds: []
                  },
                  {
                    id: payoffBeat,
                    sceneId: archived,
                    role: "payoff" as const,
                    summary: "The old confrontation reveals the seal.",
                    dependsOnBeatIds: [setupBeat],
                    archivedAt: "2026-09-12T14:00:00.000Z"
                  }
                ]
              }
            }
          : {})
      },
      {
        id: storyKnowledgeId("knowledge-harbor"),
        projectId: project,
        label: "Bellwether Harbor",
        kind: "location",
        authority: "confirmed",
        linkedSceneIds: [opening],
        linkedKnowledge: []
      }
    ],
    editions: []
  });
}

describe("story context projection", () => {
  it("projects the same acknowledged intent and order from records and navigator", () => {
    const source = records();
    const scope = { kind: "chapter", chapterId: chapter } as const;
    const fromRecords = storyContextFromProjectRecords(source, { scope });
    const fromNavigator = storyContextFromProjectNavigator(
      projectNavigatorFromRecords(source),
      { scope }
    );

    expect(fromNavigator).toEqual(fromRecords);
    expect(fromRecords.projectVersion).toBe(7);
    expect(fromRecords.scenes.map((scene) => scene.title)).toEqual([
      "Mara lands",
      "The search",
      "Old confrontation"
    ]);
    expect(fromRecords.scenes[0]).toMatchObject({
      placement: "chapter",
      canonicalIndex: 0,
      chapter: {
        id: chapter,
        objective: "Bring Mara ashore and make the letter dangerous."
      },
      intent: {
        purpose: "Mara hides the letter.",
        conflict: "The harbor master searches every bag.",
        turn: "Theo sees the broken seal.",
        openQuestions: "Who sent the warning?"
      },
      nextScene: { id: turn, canonicalIndex: 1 },
      threadAssociationIds: [letterThread],
      narrativeBeats: []
    });
    expect(fromRecords.scenes[1]?.previousScene?.id).toBe(opening);
    expect(fromRecords.scenes[1]?.nextScene?.id).toBe(archived);
    expect(fromRecords.threads[0]).toMatchObject({
      id: letterThread,
      associatedSceneIds: [opening, turn],
      narrativeBeats: []
    });
  });

  it("keeps unassigned scenes in canonical context without a Canvas placement", () => {
    const context = storyContextFromProjectRecords(records());
    const coda = context.scenes.find((scene) => scene.id === unassigned);

    expect(coda).toMatchObject({
      placement: "unassigned",
      canonicalIndex: 3,
      previousScene: { id: archived }
    });
    expect(coda?.chapter).toBeUndefined();
    expect(JSON.stringify(coda)).not.toContain("canvas");
  });

  it("does not infer narrative roles from thread associations", () => {
    const associated = storyContextFromProjectRecords(records(), {
      scope: { kind: "scene", sceneId: opening }
    });
    expect(associated.scenes[0]?.threadAssociationIds).toEqual([letterThread]);
    expect(associated.scenes[0]?.narrativeBeats).toEqual([]);
    expect(associated.threads[0]?.associatedSceneIds).toEqual([opening]);
    expect(associated.threads[0]?.narrativeState).toBe("unmapped");

    const explicit = storyContextFromProjectRecords(records({ narrative: true }), {
      scope: { kind: "chapter", chapterId: chapter }
    });
    expect(explicit.threads[0]?.narrativeState).toBe("intentionally-open");
    expect(explicit.threads[0]?.narrativeBeats.map((beat) => beat.role)).toEqual([
      "setup",
      "payoff"
    ]);
    expect(explicit.scenes[2]?.narrativeBeats[0]).toMatchObject({
      id: payoffBeat,
      dependsOnBeatIds: [setupBeat],
      anchorState: "beat-and-scene-archived"
    });
  });

  it("reports project, book, and scene archival state independently", () => {
    const context = storyContextFromProjectRecords(
      records({ projectArchived: true, bookArchived: true }),
      { scope: { kind: "scene", sceneId: archived } }
    );
    expect(context.scenes[0]?.archival).toEqual({
      projectArchived: true,
      bookArchived: true,
      sceneArchived: true
    });
  });

  it("rejects unknown scopes and bounded oversized inputs", () => {
    expect(() =>
      storyContextFromProjectRecords(records(), {
        scope: {
          kind: "chapter",
          chapterId: chapterId("chapter-missing")
        }
      })
    ).toThrowError(/cannot resolve chapter/i);

    const sceneIds = Array.from(
      { length: STORY_CONTEXT_MAX_SCENES + 1 },
      (_, index) => sceneId(`scene-bound-${index}`)
    );
    const boundedChapter = chapterId("chapter-bound");
    const oversized = defineProjectRecords({
      project: {
        id: projectId("project-bound"),
        title: "Bound",
        bookIds: [bookId("book-bound")],
        createdAt: "2026-09-12T12:00:00.000Z"
      },
      books: [
        {
          id: bookId("book-bound"),
          projectId: projectId("project-bound"),
          title: "Bound",
          status: "planned",
          manuscript: {
            parts: [
              {
                id: partId("part-bound"),
                title: "Bound",
                chapters: [
                  {
                    id: boundedChapter,
                    title: "One scene",
                    sceneIds: [sceneIds[0]!]
                  }
                ]
              }
            ],
            unassignedSceneIds: sceneIds.slice(1)
          },
          createdAt: "2026-09-12T12:00:00.000Z"
        }
      ],
      scenes: sceneIds.map((id) => ({
        id,
        projectId: projectId("project-bound"),
        bookId: bookId("book-bound"),
        title: String(id),
        status: "planned" as const
      })),
      storyKnowledge: [],
      editions: []
    });
    expect(() => storyContextFromProjectRecords(oversized)).toThrowError(
      /limited to 500 scenes in one scope/i
    );
    expect(
      storyContextFromProjectRecords(oversized, {
        scope: { kind: "chapter", chapterId: boundedChapter }
      }).scenes
    ).toHaveLength(1);
    expect(
      storyContextFromProjectRecords(oversized, {
        scope: { kind: "scene", sceneId: sceneIds[500]! }
      }).scenes
    ).toHaveLength(1);
  });
});
