import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import {
  bookId,
  chapterId,
  defineProjectRecords,
  partId,
  projectId,
  revisionId,
  sceneId,
  storyKnowledgeId,
  type ProjectRecords,
  type Scene,
  type StoryKnowledge
} from "./domain.js";
import { accountId } from "./identity.js";
import {
  buildCurrentStoryAssessmentRevisionVector,
  createStoryAssessmentRevisionVector,
  evaluateStoryAssessmentFreshness,
  storyKnowledgeRevisionToken,
  storyChapterObjectiveRevisionToken,
  storyManuscriptSliceRevisionToken,
  storySceneIntentRevisionToken
} from "./story-assessment-freshness.js";
import { createSceneDocumentHead, sceneContentHash } from "./scene-documents.js";
import { storyContextFromProjectRecords, type StoryContextProjection } from "./story-context.js";

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

const part = partId("part-freshness");
const owner = accountId("owner-freshness");
const proseHash = sceneContentHash("f".repeat(64));
const NOW = "2026-09-12T12:00:00.000Z";

function projectRecords(
  options: Readonly<{
    sceneSummary?: string;
    sceneArchived?: boolean;
    bookArchived?: boolean;
    projectArchived?: boolean;
    chapterSummary?: string;
    knowledgeArchived?: boolean;
    extraKnowledge?: StoryKnowledge;
  }> = {}
): ProjectRecords {
  return defineProjectRecords({
    project: {
      id: project,
      title: "Freshness project",
      bookIds: [book],
      createdAt: NOW,
      version: 3,
      ...(options.projectArchived ? { archivedAt: "2026-09-13T12:00:00.000Z" } : {})
    },
    books: [
      {
        id: book,
        projectId: project,
        title: "Book",
        status: "drafting",
        manuscript: {
          parts: [
            {
              id: part,
              title: "Part",
              chapters: [
                {
                  id: chapter,
                  title: "Chapter",
                  summary: options.chapterSummary ?? "Hide the letter.",
                  sceneIds: [scene]
                }
              ]
            }
          ],
          unassignedSceneIds: []
        },
        createdAt: NOW,
        ...(options.bookArchived ? { archivedAt: "2026-09-13T12:00:00.000Z" } : {})
      }
    ],
    scenes: [
      intentScene({
        summary: options.sceneSummary,
        ...(options.sceneArchived ? { archivedAt: "2026-09-13T12:00:00.000Z" } : {})
      })
    ],
    storyKnowledge: [
      thread({
        ...(options.knowledgeArchived ? { archivedAt: "2026-09-13T12:00:00.000Z" } : {})
      }),
      ...(options.extraKnowledge === undefined ? [] : [options.extraKnowledge])
    ],
    editions: []
  });
}

function sceneHead(
  workingVersion: number,
  contentHash = proseHash
) {
  return createSceneDocumentHead({
    sceneId: scene,
    projectId: project,
    workingVersion,
    document: validateSceneDocumentV1({
      schemaVersion: 1,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "block-one" },
            content: [{ type: "text", text: "Scene prose." }]
          }
        ]
      }
    }),
    contentHash,
    checkpointRevisionId: revisionId("revision-freshness"),
    updatedByAccountId: owner,
    createdAt: NOW,
    updatedAt: NOW
  });
}

describe("buildCurrentStoryAssessmentRevisionVector", () => {
  it("rebuilds an unchanged vector that stays fresh", async () => {
    const records = projectRecords();
    const assessed = createStoryAssessmentRevisionVector([
      {
        kind: "scene-prose",
        sceneId: scene,
        workingVersion: 2,
        contentHash: proseHash
      },
      {
        kind: "scene-intent",
        sceneId: scene,
        revisionToken: await storySceneIntentRevisionToken(records.scenes[0]!, hashPort)
      },
      {
        kind: "chapter-objective",
        chapterId: chapter,
        revisionToken: await storyChapterObjectiveRevisionToken(
          { id: chapter, summary: "Hide the letter." },
          hashPort
        )
      },
      {
        kind: "story-knowledge",
        storyKnowledgeId: knowledge,
        revisionToken: await storyKnowledgeRevisionToken(records.storyKnowledge[0]!, hashPort)
      },
      {
        kind: "manuscript-slice",
        scope: { kind: "chapter", chapterId: chapter },
        revisionToken: await storyManuscriptSliceRevisionToken(
          storyContextFromProjectRecords(records, {
            scope: { kind: "chapter", chapterId: chapter }
          }),
          hashPort
        )
      }
    ]);
    const current = await buildCurrentStoryAssessmentRevisionVector({
      assessed,
      records,
      sceneDocumentHeads: new Map([[scene, sceneHead(2)]]),
      hashPort
    });
    expect(evaluateStoryAssessmentFreshness(assessed, current)).toEqual({ status: "fresh" });
  });

  it("preserves assessed dependency order in the rebuilt vector", async () => {
    const records = projectRecords();
    const assessed = createStoryAssessmentRevisionVector([
      {
        kind: "story-knowledge",
        storyKnowledgeId: knowledge,
        revisionToken: await storyKnowledgeRevisionToken(records.storyKnowledge[0]!, hashPort)
      },
      {
        kind: "scene-intent",
        sceneId: scene,
        revisionToken: await storySceneIntentRevisionToken(records.scenes[0]!, hashPort)
      },
      {
        kind: "chapter-objective",
        chapterId: chapter,
        revisionToken: await storyChapterObjectiveRevisionToken(
          { id: chapter, summary: "Hide the letter." },
          hashPort
        )
      }
    ]);
    const current = await buildCurrentStoryAssessmentRevisionVector({
      assessed,
      records,
      sceneDocumentHeads: new Map(),
      hashPort
    });
    expect(current.dependencies.map((dependency) => dependency.kind)).toEqual([
      "story-knowledge",
      "scene-intent",
      "chapter-objective"
    ]);
  });

  it("detects prose, intent, objective, and knowledge drift via rebuild", async () => {
    const beforeRecords = projectRecords();
    const assessed = createStoryAssessmentRevisionVector([
      {
        kind: "scene-prose",
        sceneId: scene,
        workingVersion: 2,
        contentHash: proseHash
      },
      {
        kind: "scene-intent",
        sceneId: scene,
        revisionToken: await storySceneIntentRevisionToken(beforeRecords.scenes[0]!, hashPort)
      },
      {
        kind: "chapter-objective",
        chapterId: chapter,
        revisionToken: await storyChapterObjectiveRevisionToken(
          { id: chapter, summary: "Hide the letter." },
          hashPort
        )
      },
      {
        kind: "story-knowledge",
        storyKnowledgeId: knowledge,
        revisionToken: await storyKnowledgeRevisionToken(beforeRecords.storyKnowledge[0]!, hashPort)
      }
    ]);
    const afterRecords = projectRecords({
      sceneSummary: "Mara already burned the letter.",
      chapterSummary: "Expose the letter.",
      knowledgeArchived: true
    });
    const current = await buildCurrentStoryAssessmentRevisionVector({
      assessed,
      records: afterRecords,
      sceneDocumentHeads: new Map([
        [scene, sceneHead(3, sceneContentHash("e".repeat(64)))]
      ]),
      hashPort
    });
    expect(evaluateStoryAssessmentFreshness(assessed, current)).toEqual({
      status: "needs-recheck",
      reasons: [
        { dependencyKey: `scene-prose:${scene}`, reason: "scene-prose-changed" },
        { dependencyKey: `scene-intent:${scene}`, reason: "scene-intent-changed" },
        {
          dependencyKey: `chapter-objective:${chapter}`,
          reason: "chapter-objective-changed"
        },
        {
          dependencyKey: `story-knowledge:${knowledge}`,
          reason: "story-knowledge-changed"
        }
      ]
    });
  });

  it("omits missing or archived dependencies and flags manuscript-slice drift", async () => {
    const records = projectRecords();
    const assessed = createStoryAssessmentRevisionVector([
      {
        kind: "scene-prose",
        sceneId: scene,
        workingVersion: 2,
        contentHash: proseHash
      },
      {
        kind: "manuscript-slice",
        scope: { kind: "project" },
        revisionToken: await storyManuscriptSliceRevisionToken(
          storyContextFromProjectRecords(records),
          hashPort
        )
      }
    ]);
    const archivedSceneRecords = projectRecords({ sceneArchived: true });
    expect(
      evaluateStoryAssessmentFreshness(
        assessed,
        await buildCurrentStoryAssessmentRevisionVector({
          assessed,
          records: archivedSceneRecords,
          sceneDocumentHeads: new Map([[scene, sceneHead(2)]]),
          hashPort
        })
      )
    ).toEqual({
      status: "needs-recheck",
      reasons: [
        { dependencyKey: `scene-prose:${scene}`, reason: "dependency-missing" },
        {
          dependencyKey: "manuscript-slice:project",
          reason: "manuscript-slice-changed"
        }
      ]
    });

    const missingHeadRecords = projectRecords();
    expect(
      evaluateStoryAssessmentFreshness(
        assessed,
        await buildCurrentStoryAssessmentRevisionVector({
          assessed,
          records: missingHeadRecords,
          sceneDocumentHeads: new Map(),
          hashPort
        })
      )
    ).toEqual({
      status: "needs-recheck",
      reasons: [
        { dependencyKey: `scene-prose:${scene}`, reason: "dependency-missing" }
      ]
    });

    const secondScene = sceneId("scene-freshness-second");
    function orderedRecords(sceneIds: readonly ReturnType<typeof sceneId>[]) {
      return defineProjectRecords({
        project: {
          id: project,
          title: "Freshness project",
          bookIds: [book],
          createdAt: NOW,
          version: 3
        },
        books: [
          {
            id: book,
            projectId: project,
            title: "Book",
            status: "drafting",
            manuscript: {
              parts: [
                {
                  id: part,
                  title: "Part",
                  chapters: [
                    {
                      id: chapter,
                      title: "Chapter",
                      summary: "Hide the letter.",
                      sceneIds
                    }
                  ]
                }
              ],
              unassignedSceneIds: []
            },
            createdAt: NOW
          }
        ],
        scenes: [
          intentScene(),
          intentScene({ id: secondScene, title: "Second scene" })
        ],
        storyKnowledge: [thread()],
        editions: []
      });
    }
    const beforeOrder = orderedRecords([scene, secondScene]);
    const afterOrder = orderedRecords([secondScene, scene]);
    const sliceAssessed = createStoryAssessmentRevisionVector([
      {
        kind: "manuscript-slice",
        scope: { kind: "chapter", chapterId: chapter },
        revisionToken: await storyManuscriptSliceRevisionToken(
          storyContextFromProjectRecords(beforeOrder, {
            scope: { kind: "chapter", chapterId: chapter }
          }),
          hashPort
        )
      }
    ]);
    expect(
      evaluateStoryAssessmentFreshness(
        sliceAssessed,
        await buildCurrentStoryAssessmentRevisionVector({
          assessed: sliceAssessed,
          records: afterOrder,
          sceneDocumentHeads: new Map(),
          hashPort
        })
      )
    ).toEqual({
      status: "needs-recheck",
      reasons: [
        {
          dependencyKey: `manuscript-slice:chapter:${chapter}`,
          reason: "manuscript-slice-changed"
        }
      ]
    });

    const projectArchivedRecords = projectRecords({ projectArchived: true });
    expect(
      evaluateStoryAssessmentFreshness(
        assessed,
        await buildCurrentStoryAssessmentRevisionVector({
          assessed,
          records: projectArchivedRecords,
          sceneDocumentHeads: new Map([[scene, sceneHead(2)]]),
          hashPort
        })
      )
    ).toEqual({
      status: "needs-recheck",
      reasons: [
        {
          dependencyKey: "manuscript-slice:project",
          reason: "dependency-missing"
        }
      ]
    });
  });

  it("ignores unrelated project additions when rebuilding consumed dependencies", async () => {
    const records = projectRecords();
    const assessed = createStoryAssessmentRevisionVector([
      {
        kind: "scene-intent",
        sceneId: scene,
        revisionToken: await storySceneIntentRevisionToken(records.scenes[0]!, hashPort)
      }
    ]);
    const expanded = projectRecords({
      extraKnowledge: {
        id: storyKnowledgeId("knowledge-unrelated"),
        projectId: project,
        label: "Unrelated lore",
        kind: "location",
        authority: "planned",
        linkedSceneIds: [],
        linkedKnowledge: []
      }
    });
    const current = await buildCurrentStoryAssessmentRevisionVector({
      assessed,
      records: expanded,
      sceneDocumentHeads: new Map(),
      hashPort
    });
    expect(evaluateStoryAssessmentFreshness(assessed, current)).toEqual({ status: "fresh" });
    expect(current.dependencies).toHaveLength(1);
  });

  it("drops archived book and unknown manuscript-slice scopes", async () => {
    const unknownChapter = chapterId("chapter-missing");
    const assessed = createStoryAssessmentRevisionVector([
      {
        kind: "chapter-objective",
        chapterId: chapter,
        revisionToken: await storyChapterObjectiveRevisionToken(
          { id: chapter, summary: "Hide the letter." },
          hashPort
        )
      },
      {
        kind: "manuscript-slice",
        scope: { kind: "chapter", chapterId: unknownChapter },
        revisionToken: "placeholder-token-for-unknown-scope"
      }
    ]);
    const bookArchivedRecords = projectRecords({ bookArchived: true });
    const current = await buildCurrentStoryAssessmentRevisionVector({
      assessed,
      records: bookArchivedRecords,
      sceneDocumentHeads: new Map(),
      hashPort
    });
    expect(current.dependencies).toEqual([]);
    expect(evaluateStoryAssessmentFreshness(assessed, current)).toEqual({
      status: "needs-recheck",
      reasons: [
        {
          dependencyKey: `chapter-objective:${chapter}`,
          reason: "dependency-missing"
        },
        {
          dependencyKey: `manuscript-slice:chapter:${unknownChapter}`,
          reason: "dependency-missing"
        }
      ]
    });
  });
});
