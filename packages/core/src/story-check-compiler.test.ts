import { createHash } from "node:crypto";
import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import {
  assembleProposalArtifactContextResource,
  type AgentModelId
} from "./agent-context-receipt.js";
import { instructionContentHash, type AsyncHashPort } from "./agent-domain.js";
import {
  computeAgentProposalContentHash,
  validateAgentProposalPayload
} from "./agent-runs-proposals.js";
import { evaluateStoryCheckProposalDraftArtifactFreshness } from "./story-check-revision-vector.js";
import {
  agentProposalId,
  agentRunId,
  bookId,
  chapterId,
  contextReceiptId,
  narrativeBeatId,
  projectId,
  revisionId,
  sceneId,
  storyKnowledgeId,
  type NarrativeThreadResolution
} from "./domain.js";
import { accountId } from "./identity.js";
import { sceneContentHash, type SceneDocumentHead } from "./scene-documents.js";
import {
  assembleStorySceneResource,
  assembleStoryStructureResource
} from "./story-context-receipt.js";
import type { StoryContextProjection } from "./story-context.js";
import {
  STORY_CHECK_CANDIDATES_SCHEMA_ID,
  STORY_CHECK_SCHEMA_ID
} from "./story-check-findings-v1.js";
import { buildTrustedStoryCheckFindingsV1 } from "./story-check-findings-validation.js";
import {
  compileStoryCheckContinuity,
  completeStoryCheckContinuity,
  deriveStoryCheckLinkedRecheckSceneIds,
  type CompileStoryCheckContinuityInput,
  type StoryCheckResourceInput
} from "./story-check-compiler.js";
import {
  createStoryWorkAssignment,
  storyWorkAssignmentId,
  type StoryWorkAssignment
} from "./story-work-assignment.js";
import { createStoryWorkAttempt, type StoryWorkAttempt } from "./story-work-attempt.js";

const hashPort: AsyncHashPort = {
  async digestSha256Hex(value) {
    return createHash("sha256").update(value).digest("hex");
  }
};

const PROJECT = projectId("project-check-compiler");
const OWNER = accountId("account-check-compiler");
const RUN = agentRunId("run-check-compiler");
const TARGET = sceneId("scene-check-target");
const CONTEXT = sceneId("scene-check-context");
const NEIGHBOR = sceneId("scene-check-neighbor");
const TARGET_HASH = sceneContentHash("a".repeat(64));
const CONTEXT_HASH = sceneContentHash("b".repeat(64));
const DRAFT_ASSIGNMENT = storyWorkAssignmentId("assignment-scene-draft-source");
const PROPOSAL_ID = agentProposalId("proposal-scene-draft");
const NOW = "2026-09-13T03:00:00.000Z";

const targetProse = "Mara burned the letter on the dock.";
const contextProse = "Theo watched the harbor fog roll in.";
const draftProse = "  Draft harbor prose for review.  ";

const targetDocument = validateSceneDocumentV1({
  schemaVersion: 1,
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: "block-target" },
        content: [{ type: "text", text: targetProse }]
      }
    ]
  }
});

const contextDocument = validateSceneDocumentV1({
  schemaVersion: 1,
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: "block-context" },
        content: [{ type: "text", text: contextProse }]
      }
    ]
  }
});

const targetHead: SceneDocumentHead = Object.freeze({
  projectId: PROJECT,
  sceneId: TARGET,
  workingVersion: 3,
  contentHash: TARGET_HASH,
  document: targetDocument,
  checkpointRevisionId: revisionId("revision-target"),
  updatedByAccountId: OWNER,
  createdAt: NOW,
  updatedAt: NOW
});

const contextHead: SceneDocumentHead = Object.freeze({
  projectId: PROJECT,
  sceneId: CONTEXT,
  workingVersion: 2,
  contentHash: CONTEXT_HASH,
  document: contextDocument,
  checkpointRevisionId: revisionId("revision-context"),
  updatedByAccountId: OWNER,
  createdAt: NOW,
  updatedAt: NOW
});

const draftPayload = Object.freeze({
  schemaId: "scene-draft-v1" as const,
  prose: draftProse,
  sourceSceneIds: Object.freeze([CONTEXT])
});

async function draftPayloadContentHash() {
  return instructionContentHash(
    await hashPort.digestSha256Hex(canonicalJsonStringify(draftPayload))
  );
}

async function fullProposalArtifactContentHash() {
  const payload = validateAgentProposalPayload("scene-draft-v1", draftPayload);
  return computeAgentProposalContentHash(
    {
      outputSchemaId: "scene-draft-v1",
      payload,
      primaryTarget: Object.freeze({ kind: "scene", id: TARGET })
    },
    hashPort
  );
}

function appliedAssignment(
  overrides: Partial<StoryWorkAssignment> = {}
): StoryWorkAssignment {
  return createStoryWorkAssignment({
    id: storyWorkAssignmentId("assignment-check-applied"),
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 2,
    taskKind: "check",
    brief: "  Check continuity for the harbor scene.\nFlag timeline breaks.  ",
    constraints: "  Use only supplied context.  ",
    doneWhen: "  Findings are ready for review.  ",
    sources: [
      { kind: "project", projectId: PROJECT, projectVersion: 5 },
      {
        kind: "scene",
        sceneId: TARGET,
        projectVersion: 5,
        workingVersion: 3,
        contentHash: TARGET_HASH
      },
      {
        kind: "scene",
        sceneId: CONTEXT,
        projectVersion: 5,
        workingVersion: 2,
        contentHash: CONTEXT_HASH
      }
    ],
    destination: { kind: "scene", sceneId: TARGET, operation: "assess" },
    provider: "openai",
    model: "gpt-4.1" as AgentModelId,
    status: "running",
    steps: [{ id: "check", title: "Run continuity check", dependencies: [] }],
    activeAttemptId: RUN,
    latestAttemptId: RUN,
    results: [],
    idempotencyKey: "submit-check-applied",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  });
}

async function proposalAssignment(artifactVersion = 2): Promise<StoryWorkAssignment> {
  return createStoryWorkAssignment({
    id: storyWorkAssignmentId("assignment-check-proposal"),
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 2,
    taskKind: "check",
    brief: "  Check continuity for the draft scene.  ",
    constraints: "  Use only supplied context.  ",
    doneWhen: "  Findings are ready for review.  ",
    sources: [
      { kind: "book", bookId: bookId("book-check"), projectVersion: 5 },
      {
        kind: "proposal-artifact",
        assignmentId: DRAFT_ASSIGNMENT,
        proposalId: PROPOSAL_ID,
        sceneId: TARGET,
        artifactVersion,
        contentHash: await fullProposalArtifactContentHash()
      },
      {
        kind: "scene",
        sceneId: CONTEXT,
        projectVersion: 5,
        workingVersion: 2,
        contentHash: CONTEXT_HASH
      }
    ],
    destination: { kind: "scene", sceneId: TARGET, operation: "assess" },
    provider: "openai",
    model: "gpt-4.1" as AgentModelId,
    status: "running",
    steps: [{ id: "check", title: "Run continuity check", dependencies: [] }],
    activeAttemptId: RUN,
    latestAttemptId: RUN,
    results: [],
    idempotencyKey: "submit-check-proposal",
    createdAt: NOW,
    updatedAt: NOW
  });
}

function attempt(
  assignment: StoryWorkAssignment,
  overrides: Partial<StoryWorkAttempt> = {}
): StoryWorkAttempt {
  return createStoryWorkAttempt({
    assignmentId: assignment.id,
    projectId: assignment.projectId,
    initiatorAccountId: assignment.initiatorAccountId,
    runId: RUN,
    version: 1,
    kind: "initial",
    sourceMode: "submitted-snapshot",
    instruction: assignment.brief,
    idempotencyKey: "check-attempt",
    requestFingerprint: instructionContentHash("d".repeat(64)),
    createdAt: NOW,
    ...overrides
  });
}

function storyContext(projectVersion = 5): StoryContextProjection {
  const targetBeat = narrativeBeatId("beat-target");
  const neighborBeat = narrativeBeatId("beat-neighbor");
  return Object.freeze({
    projectId: PROJECT,
    projectVersion,
    scope: Object.freeze({ kind: "project" as const }),
    totalCanonicalSceneCount: 3,
    scenes: Object.freeze([
      Object.freeze({
        id: TARGET,
        title: "Target",
        status: "drafting" as const,
        book: Object.freeze({ id: bookId("book-check"), title: "Book" }),
        chapter: Object.freeze({
          id: chapterId("chapter-check"),
          title: "Chapter"
        }),
        placement: "chapter" as const,
        canonicalIndex: 0,
        archival: Object.freeze({
          projectArchived: false,
          bookArchived: false,
          sceneArchived: false
        }),
        intent: Object.freeze({
          purpose: "Hide the letter.",
          turn: "Mara burns it."
        }),
        threadAssociationIds: Object.freeze([]),
        narrativeBeats: Object.freeze([
          Object.freeze({
            id: targetBeat,
            threadId: storyKnowledgeId("thread-check"),
            sceneId: TARGET,
            role: "setup" as const,
            summary: "Mara receives the letter.",
            dependsOnBeatIds: Object.freeze([]),
            archived: false,
            canonicalIndex: 0,
            sceneTitle: "Target",
            sceneArchived: false,
            anchorState: "active" as const
          })
        ])
      }),
      Object.freeze({
        id: CONTEXT,
        title: "Context",
        status: "drafting" as const,
        book: Object.freeze({ id: bookId("book-check"), title: "Book" }),
        chapter: Object.freeze({
          id: chapterId("chapter-check"),
          title: "Chapter"
        }),
        placement: "chapter" as const,
        canonicalIndex: 1,
        archival: Object.freeze({
          projectArchived: false,
          bookArchived: false,
          sceneArchived: false
        }),
        intent: Object.freeze({}),
        threadAssociationIds: Object.freeze([]),
        narrativeBeats: Object.freeze([])
      }),
      Object.freeze({
        id: NEIGHBOR,
        title: "Neighbor",
        status: "drafting" as const,
        book: Object.freeze({ id: bookId("book-check"), title: "Book" }),
        chapter: Object.freeze({
          id: chapterId("chapter-check"),
          title: "Chapter"
        }),
        placement: "chapter" as const,
        canonicalIndex: 2,
        archival: Object.freeze({
          projectArchived: false,
          bookArchived: false,
          sceneArchived: false
        }),
        intent: Object.freeze({}),
        threadAssociationIds: Object.freeze([]),
        narrativeBeats: Object.freeze([])
      })
    ]),
    threads: Object.freeze([
      Object.freeze({
        id: storyKnowledgeId("thread-check"),
        label: "Letter thread",
        authority: "confirmed" as const,
        archived: false,
        narrativeState: "resolved" as NarrativeThreadResolution,
        associatedSceneIds: Object.freeze([TARGET, NEIGHBOR]),
        narrativeBeats: Object.freeze([
          Object.freeze({
            id: targetBeat,
            threadId: storyKnowledgeId("thread-check"),
            sceneId: TARGET,
            role: "setup" as const,
            summary: "Mara receives the letter.",
            dependsOnBeatIds: Object.freeze([]),
            archived: false,
            canonicalIndex: 0,
            sceneTitle: "Target",
            sceneArchived: false,
            anchorState: "active" as const
          }),
          Object.freeze({
            id: neighborBeat,
            threadId: storyKnowledgeId("thread-check"),
            sceneId: NEIGHBOR,
            role: "payoff" as const,
            summary: "Theo confronts Mara.",
            dependsOnBeatIds: Object.freeze([targetBeat]),
            archived: false,
            canonicalIndex: 1,
            sceneTitle: "Neighbor",
            sceneArchived: false,
            anchorState: "active" as const
          })
        ])
      })
    ])
  });
}

function storyContextWithoutAssessScene(projectVersion = 5): StoryContextProjection {
  const full = storyContext(projectVersion);
  const scenes = full.scenes.filter((scene) => scene.id !== TARGET);
  return Object.freeze({
    ...full,
    totalCanonicalSceneCount: scenes.length,
    scenes: Object.freeze(scenes)
  });
}

async function appliedResources(
  context: StoryContextProjection = storyContext()
): Promise<readonly StoryCheckResourceInput[]> {
  const targetResource = await assembleStorySceneResource({
    projectId: PROJECT,
    sceneId: TARGET,
    head: targetHead,
    inclusionReason: "assess-target",
    hashPort
  });
  const contextResource = await assembleStorySceneResource({
    projectId: PROJECT,
    sceneId: CONTEXT,
    head: contextHead,
    inclusionReason: "surrounding-context",
    hashPort
  });
  const structure = await assembleStoryStructureResource({
    projectId: PROJECT,
    context,
    inclusionReason: "selected-structure",
    hashPort
  });
  return Object.freeze([
    targetResource,
    contextResource,
    structure
  ]);
}

async function proposalTargetResource(artifactVersion = 2) {
  return assembleProposalArtifactContextResource({
    projectId: PROJECT,
    assignmentId: DRAFT_ASSIGNMENT,
    proposalId: PROPOSAL_ID,
    sceneId: TARGET,
    artifactVersion,
    contentHash: await fullProposalArtifactContentHash(),
    draft: draftPayload,
    providerText: draftProse,
    fullTextCharCount: draftProse.length,
    truncated: false,
    inclusionReason: "assess-proposal-target",
    hashPort
  });
}

async function proposalResources(
  artifactVersion = 2,
  context: StoryContextProjection = storyContext()
): Promise<readonly StoryCheckResourceInput[]> {
  const contextResource = await assembleStorySceneResource({
    projectId: PROJECT,
    sceneId: CONTEXT,
    head: contextHead,
    inclusionReason: "surrounding-context",
    hashPort
  });
  const structure = await assembleStoryStructureResource({
    projectId: PROJECT,
    context,
    inclusionReason: "selected-structure",
    hashPort
  });
  const proposalResource = await proposalTargetResource(artifactVersion);
  return Object.freeze([proposalResource, contextResource, structure]);
}

async function compileApplied(
  overrides: Partial<CompileStoryCheckContinuityInput> = {}
) {
  const assignment = appliedAssignment();
  return compileStoryCheckContinuity({
    receiptId: contextReceiptId("receipt-check-applied"),
    createdAt: NOW,
    assignment,
    attempt: attempt(assignment),
    storyContext: storyContext(),
    target: Object.freeze({ mode: "applied-scene", head: targetHead }),
    resources: await appliedResources(),
    hashPort,
    ...overrides
  });
}

describe("story-check-compiler", () => {
  it("compiles applied-scene checks with exact brief, receipt metadata, and trusted handoff", async () => {
    const compiled = await compileApplied();
    expect(compiled.workflow).toBe("story-work.check-continuity");
    expect(compiled.receipt.outputSchemaId).toBe("story-check-findings-v1");
    expect(compiled.receipt.targetSceneId).toBe(TARGET);
    expect(compiled.receipt.toolCount).toBe(0);
    expect(compiled.receipt.resources).toHaveLength(3);
    expect(compiled.receipt.resources.every((resource) => resource.resourceClass !== "capture")).toBe(
      true
    );

    expect(compiled.inputText).toContain("Check continuity for the harbor scene.");
    expect(compiled.inputText).toContain("Use only supplied context.");
    expect(compiled.inputText).toContain("Findings are ready for review.");
    expect(compiled.inputText).toContain("CHECK TARGET: applied scene");
    expect(compiled.inputText).toContain(targetProse);
    expect(compiled.instructions.toLowerCase()).toContain("continuity reader");

    const expectedHash = instructionContentHash(
      await hashPort.digestSha256Hex(
        canonicalJsonStringify({
          id: compiled.receipt.id,
          projectId: compiled.receipt.projectId,
          workflowId: compiled.receipt.workflowId,
          workflowVersion: compiled.receipt.workflowVersion,
          layers: compiled.receipt.layers,
          resources: compiled.receipt.resources,
          excludedContextClasses: compiled.receipt.excludedContextClasses,
          provider: compiled.receipt.provider,
          model: compiled.receipt.model,
          maxOutputTokens: compiled.receipt.maxOutputTokens,
          wallClockSeconds: compiled.receipt.wallClockSeconds,
          toolCount: compiled.receipt.toolCount,
          egressClass: compiled.receipt.egressClass,
          outputSchemaId: compiled.receipt.outputSchemaId,
          primaryTarget: compiled.receipt.primaryTarget,
          targetSceneId: compiled.receipt.targetSceneId,
          createdAt: compiled.receipt.createdAt
        })
      )
    );
    expect(compiled.receipt.receiptHash).toBe(expectedHash);

    expect(compiled.trustedHandoff.target).toMatchObject({
      mode: "applied-scene",
      sceneId: TARGET,
      workingVersion: 3,
      contentHash: TARGET_HASH
    });
    expect(compiled.trustedHandoff.linkedRecheckSceneIds).toEqual([NEIGHBOR]);
    expect(compiled.trustedHandoff.coverage.requestedScopeSummary).toContain("Selected scope");
    expect(compiled.trustedHandoff.coverage.examined.map((entry) => entry.sceneId).sort()).toEqual(
      [CONTEXT, TARGET].sort()
    );
    expect(compiled.trustedHandoff.allowBlockAnchors).toBe(true);
    expect(compiled.trustedHandoff.targetBoundDocument).toBe(targetDocument);

    const findings = await buildTrustedStoryCheckFindingsV1({
      specialist: "continuity",
      target: compiled.trustedHandoff.target,
      candidates: {
        schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
        findings: [
          {
            kind: "contradiction",
            severity: "important",
            claim: "The letter was already destroyed.",
            anchors: [{ sceneId: TARGET, quote: "burned the letter" }]
          }
        ]
      },
      coverage: compiled.trustedHandoff.coverage,
      revisionVectorInput: compiled.trustedHandoff.revisionVectorInput,
      linkedRecheckSceneIds: compiled.trustedHandoff.linkedRecheckSceneIds,
      trustedSceneIds: compiled.trustedHandoff.trustedSceneIds,
      canonicalContextSceneIds: compiled.trustedHandoff.canonicalContextSceneIds,
      anchorResources: compiled.trustedHandoff.anchorResources,
      allowBlockAnchors: true,
      targetBoundDocument: targetDocument,
      allocateFindingId: (index) => `finding-${index + 1}`
    });
    expect(findings.schemaId).toBe(STORY_CHECK_SCHEMA_ID);
    expect(findings.findings[0]?.anchors[0]?.blockId).toBe("block-target");
  });

  it("compiles proposal-draft checks with an honest proposal-artifact receipt resource", async () => {
    const assignment = await proposalAssignment();
    const compiled = await compileStoryCheckContinuity({
      receiptId: contextReceiptId("receipt-check-proposal"),
      createdAt: NOW,
      assignment,
      attempt: attempt(assignment),
      storyContext: storyContext(),
      target: Object.freeze({
        mode: "proposal-draft",
        draft: draftPayload,
        providerText: draftProse,
        fullTextCharCount: draftProse.length,
        truncated: false,
        artifactContentHash: await fullProposalArtifactContentHash(),
        coverageSceneHead: Object.freeze({
          workingVersion: 3,
          contentHash: TARGET_HASH
        })
      }),
      resources: await proposalResources(),
      hashPort
    });

    const artifactHash = await fullProposalArtifactContentHash();
    const payloadHash = await draftPayloadContentHash();
    expect(artifactHash).not.toBe(payloadHash);

    const proposalReceipt = compiled.receipt.resources.find(
      (resource) => resource.resourceClass === "proposal-artifact"
    );
    expect(proposalReceipt).toMatchObject({
      resourceClass: "proposal-artifact",
      sceneId: TARGET,
      proposalId: PROPOSAL_ID,
      artifactVersion: 2,
      contentHash: artifactHash
    });
    expect(proposalReceipt?.contentHash).not.toBe(payloadHash);
    expect(compiled.trustedHandoff.target.contentHash).toBe(artifactHash);
    expect(
      evaluateStoryCheckProposalDraftArtifactFreshness(artifactHash, artifactHash)
    ).toEqual({ status: "fresh" });
    expect(
      evaluateStoryCheckProposalDraftArtifactFreshness(
        artifactHash,
        instructionContentHash("f".repeat(64))
      )
    ).toEqual({ status: "needs-recheck", reason: "proposal-artifact-changed" });
    expect(compiled.receipt.resources.every((resource) => resource.resourceClass === "scene-document"
      ? resource.sceneId !== TARGET
      : true)).toBe(true);
    expect(compiled.inputText).toContain("STORY RESOURCE 1: proposal-artifact");
    expect(compiled.inputText).toContain(draftProse);
    expect(compiled.inputText).toContain(
      "CHECK TARGET: scene-draft proposal (see proposal-artifact story resource)"
    );
    expect(compiled.trustedHandoff.target.mode).toBe("proposal-draft");
    expect(compiled.trustedHandoff.allowBlockAnchors).toBe(false);
    expect(compiled.trustedHandoff.coverage.truncations).toContainEqual(
      expect.objectContaining({
        resourceKind: "proposal-artifact",
        resourceId: `${PROPOSAL_ID}:2`,
        providerCharCount: draftProse.length,
        fullCharCount: draftProse.length,
        truncated: false
      })
    );
    expect(
      compiled.receipt.resources.some(
        (resource) => resource.resourceClass === "proposal-artifact"
      )
    ).toBe(true);
    expect(compiled.trustedHandoff.revisionVectorInput.consumedSceneProse).toEqual([
      {
        sceneId: CONTEXT,
        workingVersion: 2,
        contentHash: CONTEXT_HASH
      }
    ]);
    expect(
      compiled.trustedHandoff.anchorResources.find(
        (resource) => resource.kind === "scene" && resource.sceneId === TARGET
      )?.providerText
    ).toBe(draftProse);

    const assignmentV3 = await proposalAssignment(3);
    const compiledOtherVersion = await compileStoryCheckContinuity({
      receiptId: contextReceiptId("receipt-check-proposal-v3"),
      createdAt: NOW,
      assignment: assignmentV3,
      attempt: attempt(assignmentV3),
      storyContext: storyContext(),
      target: Object.freeze({
        mode: "proposal-draft",
        draft: draftPayload,
        providerText: draftProse,
        fullTextCharCount: draftProse.length,
        truncated: false,
        artifactContentHash: await fullProposalArtifactContentHash(),
        coverageSceneHead: Object.freeze({
          workingVersion: 3,
          contentHash: TARGET_HASH
        })
      }),
      resources: await proposalResources(3),
      hashPort
    });
    expect(compiledOtherVersion.receipt.receiptHash).not.toBe(compiled.receipt.receiptHash);
    expect(
      compiledOtherVersion.receipt.resources.find(
        (resource) => resource.resourceClass === "proposal-artifact"
      )
    ).toMatchObject({ artifactVersion: 3 });
  });

  it("allows a new-scene proposal target absent from context and builds trusted findings", async () => {
    const assignment = await proposalAssignment();
    const contextWithoutTarget = storyContextWithoutAssessScene();
    const compiled = await compileStoryCheckContinuity({
      receiptId: contextReceiptId("receipt-check-new-scene-proposal"),
      createdAt: NOW,
      assignment,
      attempt: attempt(assignment),
      storyContext: contextWithoutTarget,
      target: Object.freeze({
        mode: "proposal-draft",
        draft: draftPayload,
        providerText: draftProse,
        fullTextCharCount: draftProse.length,
        truncated: false,
        artifactContentHash: await fullProposalArtifactContentHash(),
        coverageSceneHead: Object.freeze({
          workingVersion: 1,
          contentHash: TARGET_HASH
        })
      }),
      resources: await proposalResources(2, contextWithoutTarget),
      hashPort
    });

    expect(compiled.trustedHandoff.canonicalContextSceneIds).not.toContain(TARGET);
    expect(compiled.trustedHandoff.trustedSceneIds).toContain(TARGET);
    expect(
      contextWithoutTarget.scenes.some((scene) => scene.id === TARGET)
    ).toBe(false);

    const findings = await buildTrustedStoryCheckFindingsV1({
      specialist: "continuity",
      target: compiled.trustedHandoff.target,
      candidates: {
        schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
        findings: [
          {
            kind: "question",
            severity: "advisory",
            claim: "Does this draft fit the harbor setup?",
            anchors: [{ sceneId: TARGET, quote: "Draft harbor" }]
          }
        ]
      },
      coverage: compiled.trustedHandoff.coverage,
      revisionVectorInput: compiled.trustedHandoff.revisionVectorInput,
      linkedRecheckSceneIds: compiled.trustedHandoff.linkedRecheckSceneIds,
      trustedSceneIds: compiled.trustedHandoff.trustedSceneIds,
      canonicalContextSceneIds: compiled.trustedHandoff.canonicalContextSceneIds,
      anchorResources: compiled.trustedHandoff.anchorResources,
      allowBlockAnchors: false,
      allocateFindingId: (index) => `finding-new-scene-${index + 1}`
    });
    expect(findings.schemaId).toBe(STORY_CHECK_SCHEMA_ID);
    expect(findings.findings[0]?.anchors[0]).toMatchObject({
      sceneId: TARGET,
      quote: "Draft harbor"
    });
  });

  it("refuses applied-scene checks when the target is absent from story context", async () => {
    const assignment = appliedAssignment();
    await expect(
      compileStoryCheckContinuity({
        receiptId: contextReceiptId("receipt-check-applied-missing-target"),
        createdAt: NOW,
        assignment,
        attempt: attempt(assignment),
        storyContext: storyContextWithoutAssessScene(),
        target: Object.freeze({
          mode: "applied-scene",
          head: targetHead
        }),
        resources: await appliedResources(storyContextWithoutAssessScene()),
        hashPort
      })
    ).rejects.toThrow(/not represented by the story context projection/i);
  });

  it("refuses proposal-draft checks without a proposal-artifact receipt resource", async () => {
    const assignment = await proposalAssignment();
    const contextWithoutTarget = storyContextWithoutAssessScene();
    const resources = await proposalResources(2, contextWithoutTarget);
    const withoutProposal = resources.filter(
      (pair) => pair.resource.resourceClass !== "proposal-artifact"
    );
    await expect(
      compileStoryCheckContinuity({
        receiptId: contextReceiptId("receipt-check-proposal-missing-artifact"),
        createdAt: NOW,
        assignment,
        attempt: attempt(assignment),
        storyContext: contextWithoutTarget,
        target: Object.freeze({
          mode: "proposal-draft",
          draft: draftPayload,
          providerText: draftProse,
          fullTextCharCount: draftProse.length,
          truncated: false,
          artifactContentHash: await fullProposalArtifactContentHash(),
          coverageSceneHead: Object.freeze({
            workingVersion: 1,
            contentHash: TARGET_HASH
          })
        }),
        resources: withoutProposal,
        hashPort
      })
    ).rejects.toThrow(/proposal-artifact receipt resource/i);
  });

  it("refuses proposal checks when source, artifact hash, or provider text disagree", async () => {
    const assignment = await proposalAssignment();
    const resources = await proposalResources();
    const mismatchedHashTarget = Object.freeze({
      mode: "proposal-draft" as const,
      draft: draftPayload,
      providerText: draftProse,
      fullTextCharCount: draftProse.length,
      truncated: false,
      artifactContentHash: instructionContentHash("f".repeat(64)),
      coverageSceneHead: Object.freeze({
        workingVersion: 3,
        contentHash: TARGET_HASH
      })
    });

    await expect(
      compileStoryCheckContinuity({
        receiptId: contextReceiptId("receipt-check-proposal-hash-mismatch"),
        createdAt: NOW,
        assignment,
        attempt: attempt(assignment),
        storyContext: storyContext(),
        target: mismatchedHashTarget,
        resources,
        hashPort
      })
    ).rejects.toThrow(/proposal-artifact|assignment proposal-artifact source/i);

    const mismatchedProviderTarget = Object.freeze({
      mode: "proposal-draft" as const,
      draft: draftPayload,
      providerText: draftProse.slice(0, 24),
      fullTextCharCount: draftProse.length,
      truncated: true,
      artifactContentHash: await fullProposalArtifactContentHash(),
      coverageSceneHead: Object.freeze({
        workingVersion: 3,
        contentHash: TARGET_HASH
      })
    });

    await expect(
      compileStoryCheckContinuity({
        receiptId: contextReceiptId("receipt-check-proposal-provider-mismatch"),
        createdAt: NOW,
        assignment,
        attempt: attempt(assignment),
        storyContext: storyContext(),
        target: mismatchedProviderTarget,
        resources,
        hashPort
      })
    ).rejects.toThrow(/provider text does not match the target binding/i);
  });

  it("retains revision recheck instructions and selected-scope coverage with truncation metadata", async () => {
    const assignment = appliedAssignment();
    const compiled = await compileApplied({
      assignment,
      attempt: attempt(assignment, {
        kind: "revision",
        sourceMode: "latest-authorized",
        instruction: "  Recheck after the letter scene changed.  ",
        priorArtifact: Object.freeze({
          proposalId: agentProposalId("proposal-prior-check"),
          artifactVersion: 1,
          contentHash: instructionContentHash("e".repeat(64))
        })
      }),
      skippedScenes: Object.freeze([
        Object.freeze({ sceneId: NEIGHBOR, reason: "Writer excluded this scene from scope." })
      ])
    });
    expect(compiled.inputText).toContain("RECHECK INSTRUCTION (exact)");
    expect(compiled.inputText).toContain("Recheck after the letter scene changed.");
    expect(compiled.trustedHandoff.coverage.skipped).toEqual([
      { sceneId: NEIGHBOR, reason: "Writer excluded this scene from scope." }
    ]);
    const targetTruncation = compiled.trustedHandoff.coverage.truncations.find(
      (entry) => entry.resourceId === String(TARGET)
    );
    expect(targetTruncation?.resourceKind).toBe("scene-document");
  });

  it("derives linked recheck scene ids only from explicit beat dependencies", () => {
    const linked = deriveStoryCheckLinkedRecheckSceneIds(storyContext(), TARGET);
    expect(linked).toEqual([NEIGHBOR]);
    expect(deriveStoryCheckLinkedRecheckSceneIds(storyContext(), CONTEXT)).toEqual([]);
  });

  it("maps provider failures and rejects malformed or over-authority candidates", async () => {
    const compiled = await compileApplied();
    const failed = await completeStoryCheckContinuity({
      compiled,
      provider: {
        async completeStructured() {
          return Object.freeze({
            ok: false as const,
            diagnostic: Object.freeze({
              code: "timeout" as const,
              retryable: true
            })
          });
        }
      }
    });
    expect(failed).toEqual({
      kind: "failed",
      diagnostic: { code: "timeout", retryable: true }
    });

    const malformed = await completeStoryCheckContinuity({
      compiled,
      provider: {
        async completeStructured() {
          return Object.freeze({
            ok: true as const,
            output: { schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID, findings: [] }
          });
        }
      }
    });
    expect(malformed.kind).toBe("ready");

    const authority = await completeStoryCheckContinuity({
      compiled,
      provider: {
        async completeStructured() {
          return Object.freeze({
            ok: true as const,
            output: {
              schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
              coverage: { completeForRequestedScope: true },
              findings: [
                {
                  kind: "question",
                  severity: "advisory",
                  claim: "Was the letter already gone?",
                  anchors: [{ sceneId: TARGET, quote: "burned the letter" }]
                }
              ]
            }
          });
        }
      }
    });
    expect(authority).toEqual({
      kind: "failed",
      diagnostic: { code: "validation_failed", retryable: false }
    });
  });
});
