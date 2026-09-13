import { describe, expect, it } from "vitest";
import {
  bookId,
  chapterId,
  projectId,
  sceneId,
  storyKnowledgeId,
  type Scene,
  type StoryKnowledge
} from "./domain.js";
import {
  createStoryAssessmentRevisionVector,
  evaluateStoryAssessmentFreshness,
  storyKnowledgeRevisionToken,
  storyChapterObjectiveRevisionToken,
  storyManuscriptSliceRevisionToken,
  storySceneIntentRevisionToken
} from "./story-assessment-freshness.js";
import type { StoryContextProjection } from "./story-context.js";

const hashPort = {
  async digestSha256Hex(canonicalUtf8: string): Promise<string> {
    let hash = 0n;
    for (let index = 0; index < canonicalUtf8.length; index += 1) {
      hash =
        (hash * 131n + BigInt(canonicalUtf8.charCodeAt(index))) &
        ((1n << 256n) - 1n);
    }
    return hash.toString(16).padStart(64, "0");
  }
};

const project = projectId("project-freshness");
const book = bookId("book-freshness");
const chapter = chapterId("chapter-freshness");
const scene = sceneId("scene-freshness");
const knowledge = storyKnowledgeId("knowledge-freshness");

function intentScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: scene,
    projectId: project,
    bookId: book,
    title: "The letter",
    status: "drafting",
    summary: "Mara chooses what to do with the letter.",
    sketch: {
      purpose: "Hide the letter.",
      turn: "Theo notices the seal."
    },
    ...overrides
  };
}

function thread(overrides: Partial<StoryKnowledge> = {}): StoryKnowledge {
  return {
    id: knowledge,
    projectId: project,
    label: "The sealed letter",
    kind: "thread",
    authority: "planned",
    linkedSceneIds: [scene],
    linkedKnowledge: [],
    ...overrides
  };
}

function context(
  sceneIds: readonly ReturnType<typeof sceneId>[] = [scene]
): StoryContextProjection {
  return {
    projectId: project,
    projectVersion: 4,
    scope: { kind: "chapter", chapterId: chapter },
    totalCanonicalSceneCount: sceneIds.length,
    scenes: sceneIds.map((id, canonicalIndex) => ({
      id,
      title: String(id),
      status: "drafting",
      book: { id: book, title: "Book" },
      chapter: { id: chapter, title: "Chapter" },
      placement: "chapter",
      canonicalIndex,
      archival: {
        projectArchived: false,
        bookArchived: false,
        sceneArchived: false
      },
      intent: {},
      threadAssociationIds: [],
      narrativeBeats: []
    })),
    threads: []
  };
}

describe("story assessment freshness", () => {
  it("stays fresh when unrelated live resources or scene metadata change", async () => {
    const before = intentScene();
    const unrelatedMetadataChange = intentScene({
      title: "Renamed letter scene",
      status: "revising",
      backdrop: { url: "https://example.com/harbor.jpg" }
    });
    const assessed = createStoryAssessmentRevisionVector([
      {
        kind: "scene-intent",
        sceneId: scene,
        revisionToken: await storySceneIntentRevisionToken(before, hashPort)
      }
    ]);
    const current = createStoryAssessmentRevisionVector([
      {
        kind: "scene-intent",
        sceneId: scene,
        revisionToken: await storySceneIntentRevisionToken(
          unrelatedMetadataChange,
          hashPort
        )
      },
      {
        kind: "story-knowledge",
        storyKnowledgeId: knowledge,
        revisionToken: await storyKnowledgeRevisionToken(thread(), hashPort)
      }
    ]);

    expect(evaluateStoryAssessmentFreshness(assessed, current)).toEqual({
      status: "fresh"
    });
  });

  it("identifies exact prose and intent changes without calling any provider", async () => {
    const assessed = createStoryAssessmentRevisionVector([
      {
        kind: "scene-prose",
        sceneId: scene,
        workingVersion: 4,
        contentHash: "prose-hash-before"
      },
      {
        kind: "scene-intent",
        sceneId: scene,
        revisionToken: await storySceneIntentRevisionToken(intentScene(), hashPort)
      }
    ]);
    const current = createStoryAssessmentRevisionVector([
      {
        kind: "scene-prose",
        sceneId: scene,
        workingVersion: 5,
        contentHash: "prose-hash-after"
      },
      {
        kind: "scene-intent",
        sceneId: scene,
        revisionToken: await storySceneIntentRevisionToken(
          intentScene({ sketch: { purpose: "Burn the letter." } }),
          hashPort
        )
      }
    ]);

    expect(evaluateStoryAssessmentFreshness(assessed, current)).toEqual({
      status: "needs-recheck",
      reasons: [
        {
          dependencyKey: `scene-prose:${scene}`,
          reason: "scene-prose-changed"
        },
        {
          dependencyKey: `scene-intent:${scene}`,
          reason: "scene-intent-changed"
        }
      ]
    });
  });

  it("separates knowledge and manuscript-slice changes", async () => {
    const second = sceneId("scene-freshness-second");
    const assessed = createStoryAssessmentRevisionVector([
      {
        kind: "story-knowledge",
        storyKnowledgeId: knowledge,
        revisionToken: await storyKnowledgeRevisionToken(thread(), hashPort)
      },
      {
        kind: "manuscript-slice",
        scope: { kind: "chapter", chapterId: chapter },
        revisionToken: await storyManuscriptSliceRevisionToken(
          context([scene, second]),
          hashPort
        )
      }
    ]);
    const current = createStoryAssessmentRevisionVector([
      {
        kind: "story-knowledge",
        storyKnowledgeId: knowledge,
        revisionToken: await storyKnowledgeRevisionToken(
          thread({ notes: "The promise remains deliberately open." }),
          hashPort
        )
      },
      {
        kind: "manuscript-slice",
        scope: { kind: "chapter", chapterId: chapter },
        revisionToken: await storyManuscriptSliceRevisionToken(
          context([second, scene]),
          hashPort
        )
      }
    ]);

    expect(evaluateStoryAssessmentFreshness(assessed, current)).toEqual({
      status: "needs-recheck",
      reasons: [
        {
          dependencyKey: `story-knowledge:${knowledge}`,
          reason: "story-knowledge-changed"
        },
        {
          dependencyKey: `manuscript-slice:chapter:${chapter}`,
          reason: "manuscript-slice-changed"
        }
      ]
    });
  });

  it("reports missing dependencies and validates vector identity", () => {
    const assessed = createStoryAssessmentRevisionVector([
      {
        kind: "scene-prose",
        sceneId: scene,
        workingVersion: 1,
        contentHash: "hash"
      }
    ]);
    expect(
      evaluateStoryAssessmentFreshness(
        assessed,
        createStoryAssessmentRevisionVector([])
      )
    ).toEqual({
      status: "needs-recheck",
      reasons: [
        {
          dependencyKey: `scene-prose:${scene}`,
          reason: "dependency-missing"
        }
      ]
    });
    expect(() =>
      createStoryAssessmentRevisionVector([
        {
          kind: "scene-prose",
          sceneId: scene,
          workingVersion: 1,
          contentHash: "one"
        },
        {
          kind: "scene-prose",
          sceneId: scene,
          workingVersion: 2,
          contentHash: "two"
        }
      ])
    ).toThrowError(/duplicate dependency/i);
  });

  it("hashes and accepts an exact 500-scene manuscript slice", async () => {
    const sceneIds = Array.from({ length: 500 }, (_, index) =>
      sceneId(`scene-capacity-${index}-${"x".repeat(180)}`)
    );
    let canonicalLength = 0;
    const observingHashPort = {
      async digestSha256Hex(canonicalUtf8: string): Promise<string> {
        canonicalLength = canonicalUtf8.length;
        return hashPort.digestSha256Hex(canonicalUtf8);
      }
    };
    const revisionToken = await storyManuscriptSliceRevisionToken(
      context(sceneIds),
      observingHashPort
    );

    expect(canonicalLength).toBeGreaterThan(100_000);
    expect(revisionToken).toMatch(/^[a-f0-9]{64}$/u);
    expect(() =>
      createStoryAssessmentRevisionVector([
        {
          kind: "manuscript-slice",
          scope: { kind: "chapter", chapterId: chapter },
          revisionToken
        }
      ])
    ).not.toThrow();
  });
});

it("invalidates only assessments that consumed a changed chapter objective", async () => {
  const before = await storyChapterObjectiveRevisionToken({ id: chapter, summary: "Hide the letter." }, hashPort);
  const after = await storyChapterObjectiveRevisionToken({ id: chapter, summary: "Expose the letter." }, hashPort);
  const consumed = createStoryAssessmentRevisionVector([
    { kind: "chapter-objective", chapterId: chapter, revisionToken: before }
  ]);
  const live = createStoryAssessmentRevisionVector([
    { kind: "chapter-objective", chapterId: chapter, revisionToken: after }
  ]);
  expect(evaluateStoryAssessmentFreshness(consumed, live)).toMatchObject({
    status: "needs-recheck", reasons: [{ reason: "chapter-objective-changed" }]
  });
  expect(evaluateStoryAssessmentFreshness(createStoryAssessmentRevisionVector([]), live))
    .toEqual({ status: "fresh" });
});
