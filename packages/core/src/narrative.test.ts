import { describe, expect, it } from "vitest";
import {
  bookId,
  createStoryKnowledge,
  createStoryThreadNarrative,
  defineProjectRecords,
  narrativeBeatId,
  projectId,
  sceneId,
  storyKnowledgeId,
  STORY_NARRATIVE_MAX_BEAT_DEPENDENCIES,
  STORY_NARRATIVE_MAX_BEATS,
  type NarrativeBeat,
  type StoryKnowledge
} from "./domain.js";

const project = projectId("project-narrative-domain");
const book = bookId("book-narrative-domain");
const scene = sceneId("scene-narrative-domain");

function beat(index: number, overrides: Partial<NarrativeBeat> = {}): NarrativeBeat {
  return {
    id: narrativeBeatId(`beat-narrative-${index}`),
    sceneId: scene,
    role: "development",
    summary: `Narrative beat ${index}`,
    dependsOnBeatIds: [],
    ...overrides
  };
}

function thread(
  id: string,
  beats: readonly NarrativeBeat[]
): StoryKnowledge {
  return {
    id: storyKnowledgeId(id),
    projectId: project,
    label: id,
    kind: "thread",
    authority: "planned",
    linkedSceneIds: [],
    linkedKnowledge: [],
    narrative: { resolution: "open", beats }
  };
}

function records(storyKnowledge: readonly StoryKnowledge[]) {
  return defineProjectRecords({
    project: {
      id: project,
      title: "Narrative domain",
      bookIds: [book],
      createdAt: "2026-09-12T12:00:00.000Z"
    },
    books: [
      {
        id: book,
        projectId: project,
        title: "Book",
        status: "drafting",
        manuscript: { parts: [], unassignedSceneIds: [scene] },
        createdAt: "2026-09-12T12:00:00.000Z"
      }
    ],
    scenes: [
      {
        id: scene,
        projectId: project,
        bookId: book,
        title: "Scene",
        status: "planned"
      }
    ],
    storyKnowledge,
    editions: []
  });
}

describe("authored narrative domain", () => {
  it("requires narrative aggregates to belong to thread knowledge", () => {
    expect(() =>
      createStoryKnowledge({
        ...thread("knowledge-not-thread", [beat(1)]),
        kind: "character"
      })
    ).toThrowError(/only thread story knowledge/i);
  });

  it("rejects unknown, self, and cyclic same-thread dependencies", () => {
    expect(() =>
      createStoryThreadNarrative({
        resolution: "open",
        beats: [
          beat(1, { dependsOnBeatIds: [narrativeBeatId("beat-missing")] })
        ]
      })
    ).toThrowError(/unknown same-thread dependency/i);
    expect(() =>
      createStoryThreadNarrative({
        resolution: "open",
        beats: [beat(1, { dependsOnBeatIds: [narrativeBeatId("beat-narrative-1")] })]
      })
    ).toThrowError(/cannot depend on itself/i);
    expect(() =>
      createStoryThreadNarrative({
        resolution: "open",
        beats: [
          beat(1, { dependsOnBeatIds: [narrativeBeatId("beat-narrative-2")] }),
          beat(2, { dependsOnBeatIds: [narrativeBeatId("beat-narrative-1")] })
        ]
      })
    ).toThrowError(/dependency cycle/i);
  });

  it("bounds dependencies and total project beats", () => {
    const dependencies = Array.from(
      { length: STORY_NARRATIVE_MAX_BEAT_DEPENDENCIES + 1 },
      (_, index) => beat(index)
    );
    expect(() =>
      createStoryThreadNarrative({
        resolution: "open",
        beats: [
          ...dependencies,
          beat(500, {
            dependsOnBeatIds: dependencies.map((entry) => entry.id)
          })
        ]
      })
    ).toThrowError(/limited to 100 dependencies/i);

    const firstThreadBeats = Array.from({ length: 750 }, (_, index) => beat(index));
    const secondThreadBeats = Array.from(
      { length: STORY_NARRATIVE_MAX_BEATS - firstThreadBeats.length + 1 },
      (_, index) => beat(index + firstThreadBeats.length)
    );
    expect(() =>
      records([
        thread("knowledge-thread-one", firstThreadBeats),
        thread("knowledge-thread-two", secondThreadBeats)
      ])
    ).toThrowError(/project is limited to 1500 narrative beats/i);
  });

  it("requires narrative beat IDs to be unique across the project", () => {
    expect(() =>
      records([
        thread("knowledge-thread-one", [beat(1)]),
        thread("knowledge-thread-two", [beat(1)])
      ])
    ).toThrowError(/ID .* is used by both narrative beat and narrative beat/i);
  });
});
