import { createHash } from "node:crypto";
import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import {
  STORY_CHECK_CANDIDATES_SCHEMA_ID,
  STORY_CHECK_SCHEMA_ID
} from "./story-check-findings-v1.js";
import { buildTrustedStoryCheckFindingsV1 } from "./story-check-findings-validation.js";
import {
  agentProposalId,
  projectId,
  sceneId,
  storyKnowledgeId,
  type Scene
} from "./domain.js";
import { instructionContentHash } from "./agent-domain.js";
import { sceneContentHash } from "./scene-documents.js";
import { storyWorkAssignmentId } from "./story-work-assignment.js";
import {
  evaluateStoryAssessmentFreshness,
  storyManuscriptSliceRevisionToken,
  storySceneIntentRevisionToken
} from "./story-assessment-freshness.js";
import {
  buildStoryCheckRevisionVector,
  evaluateStoryCheckProposalDraftArtifactFreshness
} from "./story-check-revision-vector.js";
import type { StoryContextProjection } from "./story-context.js";
import { bookId, chapterId } from "./domain.js";
import { validateAgentProposalPayload } from "./agent-runs-proposals.js";

const hashPort = {
  async digestSha256Hex(text: string): Promise<string> {
    return createHash("sha256").update(text).digest("hex");
  }
};

const project = projectId("check-project");
const targetScene = sceneId("scene-target");
const neighborScene = sceneId("scene-neighbor");
const newSceneProposalTarget = sceneId("scene-new-proposal");
const knowledge = storyKnowledgeId("knowledge-thread");

const proseText = "Mara burned the letter.";
const document = validateSceneDocumentV1({
  schemaVersion: 1,
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: "block-letter" },
        content: [{ type: "text", text: proseText }]
      }
    ]
  }
});

const appliedTarget = Object.freeze({
  mode: "applied-scene" as const,
  projectId: project,
  sceneId: targetScene,
  workingVersion: 2,
  contentHash: sceneContentHash("b".repeat(64))
});

function intentScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: targetScene,
    projectId: project,
    bookId: bookId("book-check"),
    title: "The letter",
    status: "drafting",
    summary: "Mara decides what to do with the letter.",
    sketch: { purpose: "Hide the letter.", turn: "Theo notices the seal." },
    ...overrides
  };
}

function contextProjection(): StoryContextProjection {
  return {
    projectId: project,
    projectVersion: 2,
    scope: { kind: "scene", sceneId: targetScene },
    totalCanonicalSceneCount: 2,
    scenes: [
      {
        id: targetScene,
        title: "Target",
        status: "drafting",
        book: { id: bookId("book-check"), title: "Book" },
        chapter: { id: chapterId("chapter-check"), title: "Chapter" },
        placement: "chapter",
        canonicalIndex: 0,
        archival: {
          projectArchived: false,
          bookArchived: false,
          sceneArchived: false
        },
        intent: {},
        threadAssociationIds: [],
        narrativeBeats: []
      },
      {
        id: neighborScene,
        title: "Neighbor",
        status: "drafting",
        book: { id: bookId("book-check"), title: "Book" },
        chapter: { id: chapterId("chapter-check"), title: "Chapter" },
        placement: "chapter",
        canonicalIndex: 1,
        archival: {
          projectArchived: false,
          bookArchived: false,
          sceneArchived: false
        },
        intent: {},
        threadAssociationIds: [],
        narrativeBeats: []
      }
    ],
    threads: []
  };
}

function envelopeInput(overrides: Record<string, unknown> = {}) {
  return {
    specialist: "continuity" as const,
    target: appliedTarget,
    candidates: {
      schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
      findings: [
        {
          kind: "contradiction",
          severity: "important",
          claim: "The letter was already destroyed.",
          anchors: [{ sceneId: targetScene, quote: "burned the letter" }]
        }
      ]
    },
    coverage: {
      requestedScopeSummary: "Target scene prose",
      examined: [
        {
          sceneId: targetScene,
          workingVersion: 2,
          contentHash: sceneContentHash("b".repeat(64))
        }
      ],
      skipped: [],
      truncations: []
    },
    revisionVectorInput: {
      target: appliedTarget,
      consumedSceneProse: [
        {
          sceneId: targetScene,
          workingVersion: 2,
          contentHash: sceneContentHash("b".repeat(64))
        }
      ],
      targetSceneIntent: intentScene(),
      manuscriptSlice: contextProjection(),
      hashPort
    },
    linkedRecheckSceneIds: [neighborScene],
    trustedSceneIds: [targetScene, neighborScene],
    canonicalContextSceneIds: [targetScene, neighborScene],
    anchorResources: [
      {
        kind: "scene" as const,
        sceneId: targetScene,
        providerText: proseText
      }
    ],
    allowBlockAnchors: true,
    targetBoundDocument: document,
    allocateFindingId: (index: number) => `finding-${index + 1}`,
    ...overrides
  };
}

describe("trusted story check envelope builder", () => {
  it("builds a seeded contradiction with quote and block on applied head", async () => {
    const findings = await buildTrustedStoryCheckFindingsV1(envelopeInput());
    expect(findings.schemaId).toBe(STORY_CHECK_SCHEMA_ID);
    expect(findings.findings[0]?.anchors[0]).toMatchObject({
      quote: "burned the letter",
      blockId: "block-letter"
    });
    expect(findings.coverage.completeForRequestedScope).toBe(true);
    expect(findings.linkedRecheckSceneIds).toEqual([neighborScene]);
    validateAgentProposalPayload("story-check-findings-v1", findings);
  });

  it("builds trusted findings for a proposal target absent from canonical context", async () => {
    const proposalDraftProse = "Brand-new harbor draft for review.";
    const proposalTarget = Object.freeze({
      mode: "proposal-draft" as const,
      projectId: project,
      sceneId: newSceneProposalTarget,
      assignmentId: storyWorkAssignmentId("assignment-draft-new-scene"),
      proposalId: agentProposalId("proposal-new-scene"),
      artifactVersion: 1,
      contentHash: instructionContentHash("c".repeat(64))
    });
    const findings = await buildTrustedStoryCheckFindingsV1({
      specialist: "continuity",
      target: proposalTarget,
      candidates: {
        schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
        findings: [
          {
            kind: "question",
            severity: "advisory",
            claim: "Does this draft fit the setup?",
            anchors: [{ sceneId: newSceneProposalTarget, quote: "Brand-new harbor" }]
          }
        ]
      },
      coverage: {
        requestedScopeSummary: "Proposal draft target",
        examined: [
          {
            sceneId: newSceneProposalTarget,
            workingVersion: 1,
            contentHash: sceneContentHash("d".repeat(64))
          },
          {
            sceneId: neighborScene,
            workingVersion: 2,
            contentHash: sceneContentHash("e".repeat(64))
          }
        ],
        skipped: [],
        truncations: []
      },
      revisionVectorInput: {
        target: proposalTarget,
        consumedSceneProse: [
          {
            sceneId: neighborScene,
            workingVersion: 2,
            contentHash: sceneContentHash("e".repeat(64))
          }
        ],
        manuscriptSlice: contextProjection(),
        hashPort
      },
      linkedRecheckSceneIds: [],
      trustedSceneIds: [targetScene, neighborScene, newSceneProposalTarget],
      canonicalContextSceneIds: [targetScene, neighborScene],
      anchorResources: [
        {
          kind: "scene",
          sceneId: newSceneProposalTarget,
          providerText: proposalDraftProse
        },
        {
          kind: "scene",
          sceneId: neighborScene,
          providerText: "Neighbor canonical prose."
        }
      ],
      allowBlockAnchors: false,
      allocateFindingId: (index) => `finding-proposal-${index + 1}`
    });
    expect(findings.target.sceneId).toBe(newSceneProposalTarget);
    expect(findings.findings[0]?.anchors[0]).toMatchObject({
      sceneId: newSceneProposalTarget,
      quote: "Brand-new harbor"
    });
  });

  it("refuses applied targets and linked recheck scenes outside canonical context", async () => {
    await expect(
      buildTrustedStoryCheckFindingsV1(
        envelopeInput({
          canonicalContextSceneIds: [neighborScene],
          trustedSceneIds: [neighborScene]
        })
      )
    ).rejects.toMatchObject({ code: "UNKNOWN_REFERENCE" });

    await expect(
      buildTrustedStoryCheckFindingsV1(
        envelopeInput({
          linkedRecheckSceneIds: [sceneId("scene-not-in-context")]
        })
      )
    ).rejects.toThrow(/outside canonical story context/i);
  });

  it("rejects invalid scene, knowledge, and quote anchors", async () => {
    await expect(
      buildTrustedStoryCheckFindingsV1(
        envelopeInput({
          candidates: {
            schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
            findings: [
              {
                kind: "contradiction",
                severity: "important",
                claim: "Bad scene",
                anchors: [{ sceneId: neighborScene, quote: "missing" }]
              }
            ]
          }
        })
      )
    ).rejects.toMatchObject({ code: "INVALID_AGENT_OUTPUT" });

    await expect(
      buildTrustedStoryCheckFindingsV1(
        envelopeInput({
          candidates: {
            schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
            findings: [
              {
                kind: "question",
                severity: "advisory",
                claim: "Does this thread still hold?",
                anchors: [
                  {
                    sceneId: targetScene,
                    quote: "wrong quote"
                  }
                ]
              }
            ]
          }
        })
      )
    ).rejects.toMatchObject({ code: "INVALID_AGENT_OUTPUT" });

    await expect(
      buildTrustedStoryCheckFindingsV1(
        envelopeInput({
          anchorResources: [
            { kind: "scene", sceneId: targetScene, providerText: proseText },
            {
              kind: "story-knowledge",
              storyKnowledgeId: knowledge,
              providerText: "The seal must stay hidden."
            }
          ],
          candidates: {
            schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
            findings: [
              {
                kind: "question",
                severity: "advisory",
                claim: "Does this thread still hold?",
                anchors: [
                  {
                    sceneId: targetScene,
                    storyKnowledgeId: storyKnowledgeId("missing-knowledge"),
                    quote: "burned the letter"
                  }
                ]
              }
            ]
          }
        })
      )
    ).rejects.toMatchObject({ code: "INVALID_AGENT_OUTPUT" });
  });

  it("accepts a scene quote with linked included knowledge without matching knowledge text", async () => {
    const findings = await buildTrustedStoryCheckFindingsV1(
      envelopeInput({
        anchorResources: [
          { kind: "scene", sceneId: targetScene, providerText: proseText },
          {
            kind: "story-knowledge",
            storyKnowledgeId: knowledge,
            providerText: "The seal must stay hidden."
          }
        ],
        candidates: {
          schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
          findings: [
            {
              kind: "question",
              severity: "advisory",
              claim: "Does the thread still fit this beat?",
              anchors: [
                {
                  sceneId: targetScene,
                  storyKnowledgeId: knowledge,
                  quote: "burned the letter"
                }
              ]
            }
          ]
        }
      })
    );
    expect(findings.findings[0]?.anchors[0]).toMatchObject({
      sceneId: targetScene,
      storyKnowledgeId: knowledge,
      quote: "burned the letter"
    });
  });

  it("refuses anchors on skipped scenes even when receipt text exists", async () => {
    await expect(
      buildTrustedStoryCheckFindingsV1(
        envelopeInput({
          anchorResources: [
            { kind: "scene", sceneId: targetScene, providerText: proseText },
            {
              kind: "scene",
              sceneId: neighborScene,
              providerText: "Neighbor prose only in receipt."
            }
          ],
          coverage: {
            requestedScopeSummary: "Target only",
            examined: [
              {
                sceneId: targetScene,
                workingVersion: 2,
                contentHash: sceneContentHash("b".repeat(64))
              }
            ],
            skipped: [
              {
                sceneId: neighborScene,
                reason: "Writer excluded neighbor from this check"
              }
            ],
            truncations: []
          },
          candidates: {
            schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
            findings: [
              {
                kind: "contradiction",
                severity: "important",
                claim: "Neighbor contradicts target.",
                anchors: [
                  {
                    sceneId: neighborScene,
                    quote: "Neighbor prose only in receipt."
                  }
                ]
              }
            ]
          }
        })
      )
    ).rejects.toThrow(/examined coverage/i);
  });

  it("rejects contradictory truncation flags during envelope build", async () => {
    await expect(
      buildTrustedStoryCheckFindingsV1(
        envelopeInput({
          coverage: {
            requestedScopeSummary: "Target scene prose",
            examined: [
              {
                sceneId: targetScene,
                workingVersion: 2,
                contentHash: sceneContentHash("b".repeat(64))
              }
            ],
            skipped: [],
            truncations: [
              {
                resourceKind: "scene-document",
                resourceId: String(targetScene),
                truncated: false,
                providerCharCount: 10,
                fullCharCount: 100
              }
            ]
          }
        })
      )
    ).rejects.toMatchObject({ code: "INVALID_AGENT_OUTPUT" });
  });

  it("rejects provider authority injection and marks truncated coverage incomplete", async () => {
    await expect(
      buildTrustedStoryCheckFindingsV1(
        envelopeInput({
          candidates: {
            schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
            specialist: "continuity",
            coverage: { completeForRequestedScope: true },
            findings: []
          }
        })
      )
    ).rejects.toMatchObject({ code: "INVALID_AGENT_OUTPUT" });

    const truncated = await buildTrustedStoryCheckFindingsV1(
      envelopeInput({
        coverage: {
          requestedScopeSummary: "Target scene prose",
          examined: [
            {
              sceneId: targetScene,
              workingVersion: 2,
              contentHash: sceneContentHash("b".repeat(64))
            }
          ],
          skipped: [],
          truncations: [
            {
              resourceKind: "scene-document",
              resourceId: String(targetScene),
              truncated: true,
              providerCharCount: proseText.length,
              fullCharCount: proseText.length + 400
            }
          ]
        }
      })
    );
    expect(truncated.coverage.completeForRequestedScope).toBe(false);
  });

  it("forbids proposal-draft block anchors at validation time", async () => {
    const draftTarget = Object.freeze({
      mode: "proposal-draft" as const,
      projectId: project,
      sceneId: targetScene,
      assignmentId: storyWorkAssignmentId("assignment-check"),
      proposalId: agentProposalId("proposal-check"),
      artifactVersion: 1,
      contentHash: instructionContentHash("d".repeat(64))
    });
    await expect(
      buildTrustedStoryCheckFindingsV1(
        envelopeInput({
          target: draftTarget,
          allowBlockAnchors: false,
          targetBoundDocument: undefined,
          revisionVectorInput: {
            target: draftTarget,
            consumedSceneProse: [],
            targetSceneIntent: intentScene(),
            hashPort
          },
          candidates: {
            schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
            findings: [
              {
                kind: "suggestion",
                severity: "advisory",
                claim: "Tighten the draft.",
                anchors: [{ sceneId: targetScene, quote: "burned the letter" }]
              }
            ]
          }
        })
      )
    ).resolves.toMatchObject({
      target: { mode: "proposal-draft" },
      findings: [
        {
          anchors: [{ sceneId: targetScene, quote: "burned the letter" }]
        }
      ]
    });
    expect(
      (await buildTrustedStoryCheckFindingsV1(
        envelopeInput({
          target: draftTarget,
          allowBlockAnchors: false,
          targetBoundDocument: undefined,
          revisionVectorInput: {
            target: draftTarget,
            consumedSceneProse: [],
            targetSceneIntent: intentScene(),
            hashPort
          },
          candidates: {
            schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
            findings: [
              {
                kind: "suggestion",
                severity: "advisory",
                claim: "Tighten the draft.",
                anchors: [{ sceneId: targetScene, quote: "burned the letter" }]
              }
            ]
          }
        })
      )).findings[0]?.anchors[0]?.blockId
    ).toBeUndefined();
  });
});

describe("story check revision vector freshness", () => {
  it("stays fresh when unchanged and needs recheck on prose, intent, and manuscript changes", async () => {
    const scene = intentScene();
    const slice = contextProjection();
    const assessedVector = (
      await buildStoryCheckRevisionVector({
        target: appliedTarget,
        consumedSceneProse: [
          {
            sceneId: targetScene,
            workingVersion: 2,
            contentHash: sceneContentHash("a".repeat(64))
          }
        ],
        targetSceneIntent: scene,
        manuscriptSlice: slice,
        hashPort
      })
    ).revisionVector;

    const unchanged = (
      await buildStoryCheckRevisionVector({
        target: appliedTarget,
        consumedSceneProse: [
          {
            sceneId: targetScene,
            workingVersion: 2,
            contentHash: sceneContentHash("a".repeat(64))
          }
        ],
        targetSceneIntent: scene,
        manuscriptSlice: slice,
        hashPort
      })
    ).revisionVector;
    expect(evaluateStoryAssessmentFreshness(assessedVector, unchanged)).toEqual({
      status: "fresh"
    });

    const proseChanged = (
      await buildStoryCheckRevisionVector({
        target: appliedTarget,
        consumedSceneProse: [
          {
            sceneId: targetScene,
            workingVersion: 3,
            contentHash: sceneContentHash("c".repeat(64))
          }
        ],
        targetSceneIntent: scene,
        manuscriptSlice: slice,
        hashPort
      })
    ).revisionVector;
    expect(evaluateStoryAssessmentFreshness(assessedVector, proseChanged)).toEqual({
      status: "needs-recheck",
      reasons: [
        {
          dependencyKey: `scene-prose:${targetScene}`,
          reason: "scene-prose-changed"
        }
      ]
    });

    const intentChanged = (
      await buildStoryCheckRevisionVector({
        target: appliedTarget,
        consumedSceneProse: [
          {
            sceneId: targetScene,
            workingVersion: 2,
            contentHash: sceneContentHash("a".repeat(64))
          }
        ],
        targetSceneIntent: intentScene({ summary: "Revised intent summary." }),
        manuscriptSlice: slice,
        hashPort
      })
    ).revisionVector;
    expect(evaluateStoryAssessmentFreshness(assessedVector, intentChanged)).toEqual({
      status: "needs-recheck",
      reasons: [
        {
          dependencyKey: `scene-intent:${targetScene}`,
          reason: "scene-intent-changed"
        }
      ]
    });

    const movedSlice: StoryContextProjection = {
      ...slice,
      scenes: slice.scenes.map((entry, index) => ({
        ...entry,
        canonicalIndex: index === 0 ? 1 : 0
      }))
    };
    const manuscriptChanged = (
      await buildStoryCheckRevisionVector({
        target: appliedTarget,
        consumedSceneProse: [
          {
            sceneId: targetScene,
            workingVersion: 2,
            contentHash: sceneContentHash("a".repeat(64))
          }
        ],
        targetSceneIntent: scene,
        manuscriptSlice: movedSlice,
        hashPort
      })
    ).revisionVector;
    expect(evaluateStoryAssessmentFreshness(assessedVector, manuscriptChanged)).toEqual({
      status: "needs-recheck",
      reasons: [
        {
          dependencyKey: `manuscript-slice:scene:${targetScene}`,
          reason: "manuscript-slice-changed"
        }
      ]
    });

    const token = await storySceneIntentRevisionToken(scene, hashPort);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const sliceToken = await storyManuscriptSliceRevisionToken(slice, hashPort);
    expect(sliceToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tracks proposal-draft artifact on target instead of scene-prose dependencies", async () => {
    const draftTarget = Object.freeze({
      mode: "proposal-draft" as const,
      projectId: project,
      sceneId: targetScene,
      assignmentId: storyWorkAssignmentId("assignment-check"),
      proposalId: agentProposalId("proposal-check"),
      artifactVersion: 2,
      contentHash: instructionContentHash("d".repeat(64))
    });
    const built = await buildStoryCheckRevisionVector({
      target: draftTarget,
      consumedSceneProse: [],
      targetSceneIntent: intentScene(),
      hashPort
    });
    expect(built.proposalDraftArtifactTrackedOnTarget).toBe(true);
    expect(built.revisionVector.dependencies.some((dep) => dep.kind === "scene-prose")).toBe(
      false
    );
    expect(
      evaluateStoryCheckProposalDraftArtifactFreshness(
        instructionContentHash("d".repeat(64)),
        instructionContentHash("e".repeat(64))
      )
    ).toEqual({ status: "needs-recheck", reason: "proposal-artifact-changed" });
  });
});
