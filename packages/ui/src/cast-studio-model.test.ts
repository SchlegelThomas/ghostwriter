import { describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE_NAVIGATOR,
  type ProjectNavigatorKnowledge,
  type StoryKnowledgeId
} from "@ghostwriter/core";
import {
  buildKnowledgeConstellation,
  characterVisualEmptyStateCopy,
  composeCharacterRoleSummary,
  groupConstellationPeersByKind,
  parseAliasList,
  projectCastRoster,
  scenePresenceRows,
  selectedCastKnowledge,
  visualsAfterDelete
} from "./cast-studio-model.js";

const mara = BELLWETHER_FIXTURE_NAVIGATOR.storyKnowledge.find(
  (record) => record.kind === "character"
)!;

function withLinks(
  ego: ProjectNavigatorKnowledge,
  peers: readonly ProjectNavigatorKnowledge[]
): ProjectNavigatorKnowledge {
  return {
    ...ego,
    linkedKnowledge: peers.map((peer) => ({
      toId: peer.id,
      kind: "cast" as const
    })),
    linkedSceneCount: ego.linkedSceneCount
  };
}

describe("composeCharacterRoleSummary", () => {
  it("joins non-empty notes and sheet fields in order", () => {
    expect(
      composeCharacterRoleSummary({
        notes: "  Island operator  ",
        characterSheet: {
          desire: "Stay ahead of the calls",
          pressure: "  ",
          voiceNotes: "Dry, clipped"
        }
      })
    ).toBe("Island operator\n\nStay ahead of the calls\n\nDry, clipped");
  });

  it("returns empty string when nothing is authored", () => {
    expect(composeCharacterRoleSummary({})).toBe("");
    expect(
      composeCharacterRoleSummary({
        notes: "   ",
        characterSheet: { desire: "", pressure: undefined }
      })
    ).toBe("");
  });
});

describe("projectCastRoster", () => {
  it("lists non-archived characters with scene and link counts", () => {
    const roster = projectCastRoster(BELLWETHER_FIXTURE_NAVIGATOR);
    expect(roster.every((row) => !row.archived)).toBe(true);
    expect(roster.map((row) => row.label)).toContain("Mara Venn");
    const row = roster.find((entry) => entry.label === "Mara Venn");
    expect(row?.sceneCount).toBe(mara.linkedSceneCount);
    expect(row?.linkCount).toBe(mara.linkedKnowledge.length);
    expect(row?.authority).toBe("confirmed");
  });

  it("excludes non-character knowledge", () => {
    const roster = projectCastRoster(BELLWETHER_FIXTURE_NAVIGATOR);
    expect(roster.every((row) => {
      const record = BELLWETHER_FIXTURE_NAVIGATOR.storyKnowledge.find(
        (candidate) => candidate.id === row.id
      );
      return record?.kind === "character";
    })).toBe(true);
  });
});

describe("buildKnowledgeConstellation", () => {
  it("projects ego plus linked non-archived peers with kinds", () => {
    const location = BELLWETHER_FIXTURE_NAVIGATOR.storyKnowledge.find(
      (record) => record.kind === "location"
    )!;
    const ego = withLinks(mara, [location]);
    const graph = buildKnowledgeConstellation(
      ego,
      BELLWETHER_FIXTURE_NAVIGATOR.storyKnowledge
    );
    expect(graph.ego).toEqual({
      id: mara.id,
      label: mara.label,
      kind: "character"
    });
    expect(graph.peers).toEqual([
      {
        id: location.id,
        label: location.label,
        kind: "location",
        linkKind: "cast"
      }
    ]);
  });

  it("groups peers by link kind for narrow list fallback", () => {
    const peers = [
      {
        id: "a" as StoryKnowledgeId,
        label: "A",
        kind: "character" as const,
        linkKind: "related" as const
      },
      {
        id: "b" as StoryKnowledgeId,
        label: "B",
        kind: "location" as const,
        linkKind: "cast" as const
      }
    ];
    expect(groupConstellationPeersByKind(peers)).toEqual([
      { kind: "cast", peers: [peers[1]] },
      { kind: "related", peers: [peers[0]] }
    ]);
  });
});

describe("scenePresenceRows", () => {
  it("lists linked scenes and marks POV when ids match", () => {
    const ego: ProjectNavigatorKnowledge = {
      ...mara,
      linkedSceneIds: mara.linkedSceneIds.slice(0, 1)
    };
    const firstId = ego.linkedSceneIds[0]!;
    const withPov: ProjectNavigatorKnowledge = ego;
    const project = {
      ...BELLWETHER_FIXTURE_NAVIGATOR,
      books: BELLWETHER_FIXTURE_NAVIGATOR.books.map((book) => ({
        ...book,
        parts: book.parts.map((part) => ({
          ...part,
          chapters: part.chapters.map((chapter) => ({
            ...chapter,
            scenes: chapter.scenes.map((scene) =>
              scene.id === firstId
                ? { ...scene, povStoryKnowledgeId: mara.id }
                : scene
            )
          }))
        }))
      }))
    };
    const rows = scenePresenceRows(withPov, project);
    expect(rows.length).toBe(1);
    expect(rows[0]?.sceneId).toBe(firstId);
    expect(rows[0]?.isPov).toBe(true);
  });
});

describe("selectedCastKnowledge", () => {
  it("returns character knowledge only for storyKnowledge selection", () => {
    expect(
      selectedCastKnowledge(BELLWETHER_FIXTURE_NAVIGATOR, {
        kind: "storyKnowledgeRoot"
      })
    ).toBeUndefined();
    expect(
      selectedCastKnowledge(BELLWETHER_FIXTURE_NAVIGATOR, {
        kind: "storyKnowledge",
        storyKnowledgeId: mara.id
      })?.label
    ).toBe("Mara Venn");
    const location = BELLWETHER_FIXTURE_NAVIGATOR.storyKnowledge.find(
      (record) => record.kind === "location"
    )!;
    expect(
      selectedCastKnowledge(BELLWETHER_FIXTURE_NAVIGATOR, {
        kind: "storyKnowledge",
        storyKnowledgeId: location.id
      })
    ).toBeUndefined();
  });
});

describe("parseAliasList", () => {
  it("splits comma-separated aliases", () => {
    expect(parseAliasList(" Mara , Venn,  ")).toEqual(["Mara", "Venn"]);
  });
});

describe("character visual gallery helpers", () => {
  const sample = [
    {
      id: "v1",
      url: "https://ghostwriter.character/projects/p/story-knowledge/k/visuals/v1",
      alt: "One",
      source: "generated" as const
    },
    {
      id: "v2",
      url: "https://cdn.example.com/two.png",
      alt: "Two",
      source: "upload" as const
    }
  ];

  it("removes a visual and clears when empty", () => {
    expect(visualsAfterDelete(sample, "v1")?.map((visual) => visual.id)).toEqual([
      "v2"
    ]);
    expect(visualsAfterDelete(sample, "v2")).toEqual([sample[0]]);
    expect(visualsAfterDelete([sample[0]!], "v1")).toBeNull();
    expect(characterVisualEmptyStateCopy(undefined)).toMatch(/No portraits/);
    expect(characterVisualEmptyStateCopy(sample)).toBeUndefined();
  });
});
