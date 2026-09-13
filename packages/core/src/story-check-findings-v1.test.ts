import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import {
  STORY_CHECK_CANDIDATES_SCHEMA_ID,
  STORY_CHECK_SCHEMA_ID,
  validateStoryCheckFindingsCandidatesV1,
  validateStoryCheckFindingsV1
} from "./story-check-findings-v1.js";
import { agentProposalId, projectId, sceneId } from "./domain.js";
import { instructionContentHash } from "./agent-domain.js";
import { sceneContentHash } from "./scene-documents.js";
import { storyWorkAssignmentId } from "./story-work-assignment.js";
import { createStoryAssessmentRevisionVector } from "./story-assessment-freshness.js";

const project = projectId("check-project");
const targetScene = sceneId("scene-target");
const contextScene = sceneId("scene-context");

function baseCoverage(complete = true) {
  return {
    requestedScopeSummary: "Target scene and one neighbor",
    examined: [
      {
        sceneId: targetScene,
        workingVersion: 2,
        contentHash: sceneContentHash("b".repeat(64))
      }
    ],
    skipped: complete ? [] : [{ sceneId: contextScene, reason: "Writer excluded this scene" }],
    truncations: complete
      ? []
      : [
          {
            resourceKind: "scene-document" as const,
            resourceId: String(targetScene),
            truncated: true,
            providerCharCount: 100,
            fullCharCount: 500
          }
        ],
    completeForRequestedScope: complete
  };
}

function baseStored(overrides: Record<string, unknown> = {}) {
  return {
    schemaId: STORY_CHECK_SCHEMA_ID,
    specialist: "continuity",
    target: {
      mode: "applied-scene",
      projectId: project,
      sceneId: targetScene,
      workingVersion: 2,
      contentHash: sceneContentHash("b".repeat(64))
    },
    findings: [
      {
        id: "finding-1",
        kind: "contradiction",
        severity: "important",
        claim: "The letter was already destroyed.",
        anchors: [{ sceneId: targetScene, quote: "burned the letter" }],
        resolution: { status: "open" }
      }
    ],
    coverage: baseCoverage(true),
    revisionVector: createStoryAssessmentRevisionVector([
      {
        kind: "scene-prose",
        sceneId: targetScene,
        workingVersion: 2,
        contentHash: "b".repeat(64)
      }
    ]),
    linkedRecheckSceneIds: [contextScene],
    ...overrides
  };
}

describe("story-check-findings-v1 schema", () => {
  it("rejects unknown stored fields and enforces bounds", () => {
    expect(() =>
      validateStoryCheckFindingsV1({ ...baseStored(), aggregateScore: 0.5 })
    ).toThrow(/unexpected or missing fields/i);
    expect(() =>
      validateStoryCheckFindingsV1(
        baseStored({
          findings: [
            {
              id: "finding-1",
              kind: "contradiction",
              severity: "important",
              claim: "x".repeat(2_001),
              anchors: [{ sceneId: targetScene }],
              resolution: { status: "open" }
            }
          ]
        })
      )
    ).toThrow(/claim/i);
  });

  it("requires deferred reason and forbids false complete coverage", () => {
    expect(() =>
      validateStoryCheckFindingsV1(
        baseStored({
          findings: [
            {
              id: "finding-1",
              kind: "question",
              severity: "advisory",
              claim: "Why now?",
              anchors: [{ sceneId: targetScene }],
              resolution: { status: "deferred" }
            }
          ]
        })
      )
    ).toThrow(/deferred reason/i);
    expect(() =>
      validateStoryCheckFindingsV1(
        baseStored({
          coverage: {
            ...baseCoverage(false),
            completeForRequestedScope: true
          }
        })
      )
    ).toThrow(/cannot claim completeness/i);
  });

  it("rejects malformed scene content hashes on target and examined coverage", () => {
    expect(() =>
      validateStoryCheckFindingsV1(
        baseStored({
          target: {
            mode: "applied-scene",
            projectId: project,
            sceneId: targetScene,
            workingVersion: 2,
            contentHash: "not-a-sha256-digest"
          }
        })
      )
    ).toThrow(/sha-256 digest/i);
    expect(() =>
      validateStoryCheckFindingsV1(
        baseStored({
          coverage: {
            ...baseCoverage(true),
            examined: [
              {
                sceneId: targetScene,
                workingVersion: 2,
                contentHash: "also-invalid"
              }
            ]
          }
        })
      )
    ).toThrow(/sha-256 digest/i);
  });

  it("rejects truncation flags that contradict char counts", () => {
    expect(() =>
      validateStoryCheckFindingsV1(
        baseStored({
          coverage: {
            ...baseCoverage(true),
            truncations: [
              {
                resourceKind: "scene-document",
                resourceId: String(targetScene),
                truncated: false,
                providerCharCount: 100,
                fullCharCount: 500
              }
            ],
            completeForRequestedScope: false
          }
        })
      )
    ).toThrow(/truncation flag contradicts/i);
    expect(() =>
      validateStoryCheckFindingsV1(
        baseStored({
          coverage: {
            ...baseCoverage(true),
            truncations: [
              {
                resourceKind: "scene-document",
                resourceId: String(targetScene),
                truncated: true,
                providerCharCount: 500,
                fullCharCount: 500
              }
            ],
            completeForRequestedScope: false
          }
        })
      )
    ).toThrow(/truncation flag contradicts/i);
  });

  it("rejects zero examined coverage and overlapping examined/skipped ids", () => {
    expect(() =>
      validateStoryCheckFindingsV1(
        baseStored({
          coverage: {
            ...baseCoverage(true),
            examined: [],
            completeForRequestedScope: false
          }
        })
      )
    ).toThrow(/at least one scene/i);
    expect(() =>
      validateStoryCheckFindingsV1(
        baseStored({
          coverage: {
            ...baseCoverage(false),
            examined: [
              {
                sceneId: targetScene,
                workingVersion: 2,
                contentHash: sceneContentHash("b".repeat(64))
              }
            ],
            skipped: [{ sceneId: targetScene, reason: "duplicate overlap" }],
            completeForRequestedScope: false
          }
        })
      )
    ).toThrow(/overlap/i);
  });

  it("forbids block anchors on proposal-draft stored payloads", () => {
    expect(() =>
      validateStoryCheckFindingsV1(
        baseStored({
          target: {
            mode: "proposal-draft",
            projectId: project,
            sceneId: targetScene,
            assignmentId: storyWorkAssignmentId("assignment-check"),
            proposalId: agentProposalId("proposal-check"),
            artifactVersion: 3,
            contentHash: instructionContentHash("c".repeat(64))
          },
          findings: [
            {
              id: "finding-1",
              kind: "suggestion",
              severity: "advisory",
              claim: "Tighten the opening.",
              anchors: [
                {
                  sceneId: targetScene,
                  quote: "Opening line",
                  blockId: "block-1"
                }
              ],
              resolution: { status: "open" }
            }
          ]
        })
      )
    ).toThrow(/cannot include block/i);
  });
});

describe("story-check coverage truncations", () => {
  it("accepts proposal-artifact truncation resource kinds", () => {
    const validated = validateStoryCheckFindingsV1(
      baseStored({
        coverage: {
          ...baseCoverage(true),
          truncations: [
            {
              resourceKind: "proposal-artifact",
              resourceId: "proposal-scene-draft:2",
              truncated: false,
              providerCharCount: 120,
              fullCharCount: 120
            }
          ]
        }
      })
    );
    expect(validated.coverage.truncations[0]?.resourceKind).toBe("proposal-artifact");
  });
});

describe("story-check-findings-candidates-v1", () => {
  it("accepts bounded candidates without authority fields", () => {
    const validated = validateStoryCheckFindingsCandidatesV1({
      schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
      findings: [
        {
          kind: "contradiction",
          severity: "blocking",
          claim: "Timeline breaks.",
          anchors: [{ sceneId: targetScene, quote: "Yesterday" }]
        }
      ]
    });
    expect(validated.findings).toHaveLength(1);
  });

  it("rejects candidate block ids and unknown fields", () => {
    expect(() =>
      validateStoryCheckFindingsCandidatesV1({
        schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
        findings: [
          {
            kind: "contradiction",
            severity: "important",
            claim: "Bad anchor",
            anchors: [{ sceneId: targetScene, blockId: "block-1" }]
          }
        ]
      })
    ).toThrow(/unexpected or missing fields/i);
    expect(() =>
      validateStoryCheckFindingsCandidatesV1({
        schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
        coverage: {},
        findings: []
      })
    ).toThrow(/unexpected or missing fields/i);
  });
});

describe("applied-scene stored anchors", () => {
  it("accepts block ids on applied-scene findings when present", () => {
    const document = validateSceneDocumentV1({
      schemaVersion: 1,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "block-letter" },
            content: [{ type: "text", text: "Mara burned the letter." }]
          }
        ]
      }
    });
    void document;
    const validated = validateStoryCheckFindingsV1(
      baseStored({
        findings: [
          {
            id: "finding-1",
            kind: "contradiction",
            severity: "important",
            claim: "The letter was already destroyed.",
            anchors: [
              {
                sceneId: targetScene,
                quote: "burned the letter",
                blockId: "block-letter"
              }
            ],
            resolution: { status: "open" }
          }
        ]
      })
    );
    expect(validated.findings[0]?.anchors[0]?.blockId).toBe("block-letter");
  });
});
