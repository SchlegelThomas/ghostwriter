import { createHash } from "node:crypto";
import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import {
  assembleProposalArtifactContextResource,
  type AgentModelId
} from "./agent-context-receipt.js";
import { createAgentGuidanceServices } from "./agent-guidance-services.js";
import { instructionContentHash, type AsyncHashPort } from "./agent-domain.js";
import {
  computeAgentProposalContentHash,
  validateAgentProposalPayload
} from "./agent-runs-proposals.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import {
  createMemoryAccountAiCollaborationProfileRepository,
  createMemoryProjectAgentInstructionsRepository,
  createMemoryProjectPlaybookRepository
} from "./memory-agent-guidance-repository.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { createMemoryStoryCheckGenerationUnitOfWork } from "./memory-story-check-generation-uow.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemoryStoryWorkAssignmentRepository } from "./memory-story-work-assignment-repository.js";
import { createMemoryStoryWorkAttemptRepository } from "./memory-story-work-attempt-repository.js";
import {
  agentProposalId,
  bookId,
  chapterId,
  defineProjectRecords,
  narrativeBeatId,
  projectId,
  revisionId,
  sceneId,
  storyKnowledgeId,
  type NarrativeThreadResolution
} from "./domain.js";
import { accountId, createProjectMembership } from "./identity.js";
import { sceneContentHash, type SceneDocumentHead } from "./scene-documents.js";
import {
  STORY_CHECK_CANDIDATES_SCHEMA_ID,
  STORY_CHECK_SCHEMA_ID
} from "./story-check-findings-v1.js";
import type { StoryCheckResourceInput } from "./story-check-compiler.js";
import {
  characterStoryWorkAttemptRequestFingerprint
} from "./character-story-work-generation-services.js";
import {
  createStoryCheckGenerationServices,
  type StoryCheckAttemptRequest
} from "./story-check-generation-services.js";
import { sceneStoryWorkAttemptRequestFingerprint } from "./scene-story-work-generation-services.js";
import {
  assembleStorySceneResource,
  assembleStoryStructureResource
} from "./story-context-receipt.js";
import type { StoryContextProjection } from "./story-context.js";
import {
  createStoryWorkAssignment,
  storyWorkAssignmentId,
  type StoryWorkAssignment
} from "./story-work-assignment.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import type { DomainIdKind } from "./project-repository.js";

const hashPort: AsyncHashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
});

const PROJECT = projectId("project-check-generation");
const OWNER = accountId("account-check-generation");
const STRANGER = accountId("account-check-generation-stranger");
const ASSIGNMENT_APPLIED = storyWorkAssignmentId("assignment-check-generation-applied");
const ASSIGNMENT_PROPOSAL = storyWorkAssignmentId("assignment-check-generation-proposal");
const TARGET = sceneId("scene-check-generation-target");
const CONTEXT = sceneId("scene-check-generation-context");
const NEIGHBOR = sceneId("scene-check-generation-neighbor");
const DRAFT_ASSIGNMENT = storyWorkAssignmentId("assignment-check-generation-draft");
const PROPOSAL_ID = agentProposalId("proposal-check-generation-draft");
const TARGET_HASH = sceneContentHash("a".repeat(64));
const CONTEXT_HASH = sceneContentHash("b".repeat(64));
const NOW = "2026-09-13T20:00:00.000Z";

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
  checkpointRevisionId: revisionId("revision-check-generation-target"),
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
  checkpointRevisionId: revisionId("revision-check-generation-context"),
  updatedByAccountId: OWNER,
  createdAt: NOW,
  updatedAt: NOW
});

const draftPayload = Object.freeze({
  schemaId: "scene-draft-v1" as const,
  prose: draftProse,
  sourceSceneIds: Object.freeze([CONTEXT])
});

const contradictionCandidates = Object.freeze({
  schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
  findings: Object.freeze([
    Object.freeze({
      kind: "contradiction" as const,
      severity: "blocking" as const,
      claim: "The letter was already destroyed.",
      anchors: Object.freeze([Object.freeze({ sceneId: TARGET, quote: "burned the letter" })])
    })
  ])
});

const CHECK_PROJECT = defineProjectRecords({
  project: {
    id: PROJECT,
    title: "Check generation",
    bookIds: [bookId("book-check-generation")],
    version: 5,
    createdAt: NOW
  },
  books: [
    {
      id: bookId("book-check-generation"),
      projectId: PROJECT,
      title: "Book",
      status: "drafting",
      manuscript: {
        parts: [],
        unassignedSceneIds: [TARGET, CONTEXT, NEIGHBOR]
      },
      createdAt: NOW
    }
  ],
  scenes: [
    {
      id: TARGET,
      projectId: PROJECT,
      bookId: bookId("book-check-generation"),
      title: "Target",
      status: "drafting"
    },
    {
      id: CONTEXT,
      projectId: PROJECT,
      bookId: bookId("book-check-generation"),
      title: "Context",
      status: "drafting"
    },
    {
      id: NEIGHBOR,
      projectId: PROJECT,
      bookId: bookId("book-check-generation"),
      title: "Neighbor",
      status: "drafting"
    }
  ],
  storyKnowledge: [],
  editions: []
});

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

function storyContext(projectVersion = 5): StoryContextProjection {
  const targetBeat = narrativeBeatId("beat-check-generation-target");
  const neighborBeat = narrativeBeatId("beat-check-generation-neighbor");
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
        book: Object.freeze({ id: bookId("book-check-generation"), title: "Book" }),
        chapter: Object.freeze({
          id: chapterId("chapter-check-generation"),
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
            threadId: storyKnowledgeId("thread-check-generation"),
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
        book: Object.freeze({ id: bookId("book-check-generation"), title: "Book" }),
        chapter: Object.freeze({
          id: chapterId("chapter-check-generation"),
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
        book: Object.freeze({ id: bookId("book-check-generation"), title: "Book" }),
        chapter: Object.freeze({
          id: chapterId("chapter-check-generation"),
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
        id: storyKnowledgeId("thread-check-generation"),
        label: "Letter thread",
        authority: "confirmed" as const,
        archived: false,
        narrativeState: "resolved" as NarrativeThreadResolution,
        associatedSceneIds: Object.freeze([TARGET, NEIGHBOR]),
        narrativeBeats: Object.freeze([
          Object.freeze({
            id: targetBeat,
            threadId: storyKnowledgeId("thread-check-generation"),
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
            threadId: storyKnowledgeId("thread-check-generation"),
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

function appliedAssignment(): StoryWorkAssignment {
  return createStoryWorkAssignment({
    id: ASSIGNMENT_APPLIED,
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 1,
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
    status: "brief-ready",
    steps: [{ id: "check", title: "Run continuity check", dependencies: [] }],
    results: [],
    idempotencyKey: "submit-check-generation-applied",
    createdAt: NOW,
    updatedAt: NOW
  });
}

async function proposalAssignment(): Promise<StoryWorkAssignment> {
  return createStoryWorkAssignment({
    id: ASSIGNMENT_PROPOSAL,
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "check",
    brief: "  Check continuity for the draft scene.  ",
    constraints: "  Use only supplied context.  ",
    doneWhen: "  Findings are ready for review.  ",
    sources: [
      { kind: "book", bookId: bookId("book-check-generation"), projectVersion: 5 },
      {
        kind: "proposal-artifact",
        assignmentId: DRAFT_ASSIGNMENT,
        proposalId: PROPOSAL_ID,
        sceneId: TARGET,
        artifactVersion: 2,
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
    status: "brief-ready",
    steps: [{ id: "check", title: "Run continuity check", dependencies: [] }],
    results: [],
    idempotencyKey: "submit-check-generation-proposal",
    createdAt: NOW,
    updatedAt: NOW
  });
}

async function appliedResources(): Promise<readonly StoryCheckResourceInput[]> {
  const context = storyContext();
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
  return Object.freeze([targetResource, contextResource, structure]);
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

async function proposalResources(): Promise<readonly StoryCheckResourceInput[]> {
  const context = storyContext();
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
  const proposalResource = await proposalTargetResource();
  return Object.freeze([proposalResource, contextResource, structure]);
}

async function createHarness(
  mode: "applied" | "proposal",
  options: Readonly<{
    failAfter?: "begin-run" | "complete-proposal" | "finish-run";
    archived?: boolean;
    assignmentVersion?: number;
  }> = {}
) {
  const projectRecords = options.archived
    ? defineProjectRecords({
        ...CHECK_PROJECT,
        project: { ...CHECK_PROJECT.project, archivedAt: NOW }
      })
    : CHECK_PROJECT;
  const projects = createMemoryProjectRepository(
    [projectRecords],
    [
      createProjectMembership({
        projectId: PROJECT,
        accountId: OWNER,
        role: "owner",
        createdAt: NOW
      })
    ]
  );
  const assignments = createMemoryStoryWorkAssignmentRepository();
  const attempts = createMemoryStoryWorkAttemptRepository();
  const receipts = createMemoryContextReceiptRepository();
  const runs = createMemoryAgentRunRepository();
  const proposals = createMemoryAgentProposalRepository();
  const assignment =
    mode === "applied" ? appliedAssignment() : await proposalAssignment();
  const versionedAssignment =
    options.assignmentVersion === undefined
      ? assignment
      : createStoryWorkAssignment({ ...assignment, version: options.assignmentVersion });
  await assignments.create({
    assignment: versionedAssignment,
    requestFingerprint: instructionContentHash("c".repeat(64))
  });
  let id = 0;
  const ids = {
    create(kind: DomainIdKind) {
      id += 1;
      return `${kind}-check-generation-${id}`;
    }
  };
  let tick = 0;
  const clock = {
    now() {
      tick += 1;
      return `2026-09-13T20:00:${String(tick).padStart(2, "0")}.000Z`;
    }
  };
  const guidance = createAgentGuidanceServices({
    projects,
    collaborationProfiles: createMemoryAccountAiCollaborationProfileRepository(),
    projectInstructions: createMemoryProjectAgentInstructionsRepository(),
    playbooks: createMemoryProjectPlaybookRepository(),
    hashPort,
    ids,
    clock
  });
  const generation = createMemoryStoryCheckGenerationUnitOfWork({
    projects,
    assignments,
    attempts,
    receipts,
    runs,
    proposals,
    ...(options.failAfter === undefined ? {} : { failAfter: options.failAfter })
  });
  const services = createStoryCheckGenerationServices({
    projects,
    assignments,
    proposals,
    guidance,
    generation,
    hashPort,
    ids,
    clock
  });
  const ctx = storyContext();
  const baseRequest: Omit<StoryCheckAttemptRequest, "provider"> =
    mode === "applied"
      ? {
          accountId: OWNER,
          projectId: PROJECT,
          assignmentId: versionedAssignment.id,
          expectedAssignmentVersion: versionedAssignment.version,
          kind: "initial",
          sourceMode: "submitted-snapshot",
          instruction: versionedAssignment.brief,
          idempotencyKey: "attempt-check-generation",
          storyContext: ctx,
          target: Object.freeze({ mode: "applied-scene", head: targetHead }),
          resources: await appliedResources(),
          targetSceneIntent: Object.freeze({
            id: TARGET,
            summary: "Hide the letter.",
            sketch: Object.freeze({ turn: "Mara burns it." })
          }),
          chapterObjective: Object.freeze({
            id: chapterId("chapter-check-generation"),
            summary: "Chapter objective"
          })
        }
      : {
          accountId: OWNER,
          projectId: PROJECT,
          assignmentId: versionedAssignment.id,
          expectedAssignmentVersion: versionedAssignment.version,
          kind: "initial",
          sourceMode: "submitted-snapshot",
          instruction: versionedAssignment.brief,
          idempotencyKey: "attempt-check-generation-proposal",
          storyContext: ctx,
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
          resources: await proposalResources()
        };
  return {
    assignments,
    attempts,
    receipts,
    runs,
    proposals,
    services,
    assignment: versionedAssignment,
    request: baseRequest,
    ids
  };
}

function successProvider(output: unknown = contradictionCandidates) {
  return {
    async completeStructured() {
      return { ok: true as const, output, providerResponseId: "provider-check-generation" };
    }
  };
}

describe("story check generation lifecycle", () => {
  it("publishes applied-scene findings with validated anchors and replays without a second provider call", async () => {
    const harness = await createHarness("applied");
    let calls = 0;
    const provider = {
      async completeStructured() {
        calls += 1;
        return {
          ok: true as const,
          output: contradictionCandidates,
          providerResponseId: "provider-check-generation"
        };
      }
    };
    const first = await harness.services.generate({ ...harness.request, provider });
    expect(first).toMatchObject({
      kind: "ready",
      state: {
        assignment: {
          status: "artifact-ready",
          version: 3,
          generatedArtifact: { artifactVersion: 1 },
          currentArtifact: { artifactVersion: 1 }
        },
        run: { workflowId: "story-work.check-continuity", status: "ready" },
        proposal: {
          outputSchemaId: "story-check-findings-v1",
          primaryTarget: { kind: "scene", id: TARGET }
        }
      }
    });
    if (first.kind !== "ready") throw new Error("Expected ready check result.");
    const payload = first.state.proposal.payload as {
      schemaId: string;
      findings: Array<{
        id: string;
        severity: string;
        anchors: Array<{ blockId?: string; quote?: string }>;
      }>;
      coverage: { completeForRequestedScope: boolean };
      revisionVector: unknown;
      linkedRecheckSceneIds: string[];
    };
    expect(payload.schemaId).toBe(STORY_CHECK_SCHEMA_ID);
    expect(payload.findings[0]).toMatchObject({
      severity: "blocking",
      anchors: [{ quote: "burned the letter", blockId: "block-target" }]
    });
    expect(payload.findings[0]?.id).toBe("storyCheckFinding-check-generation-3");
    expect(payload.coverage.completeForRequestedScope).toBe(true);
    expect(payload.revisionVector).toBeDefined();
    expect(payload.linkedRecheckSceneIds).toEqual([NEIGHBOR]);

    const replay = await harness.services.generate({ ...harness.request, provider });
    expect(replay).toMatchObject({ kind: "replayed", state: { replayed: true } });
    expect(calls).toBe(1);
    if (replay.kind !== "replayed" || replay.state.proposal === undefined) {
      throw new Error("Expected replayed proposal.");
    }
    expect(replay.state.proposal.payload).toEqual(first.state.proposal.payload);
  });

  it("publishes proposal-draft findings atomically", async () => {
    const harness = await createHarness("proposal");
    const proposalCandidates = Object.freeze({
      schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
      findings: Object.freeze([
        Object.freeze({
          kind: "contradiction" as const,
          severity: "important" as const,
          claim: "Draft tone drifts from surrounding context.",
          anchors: Object.freeze([
            Object.freeze({ sceneId: TARGET, quote: "Draft harbor prose" })
          ])
        })
      ])
    });
    const result = await harness.services.generate({
      ...harness.request,
      provider: successProvider(proposalCandidates)
    });
    expect(result).toMatchObject({
      kind: "ready",
      state: {
        proposal: {
          outputSchemaId: "story-check-findings-v1",
          primaryTarget: { kind: "scene", id: TARGET }
        },
        assignment: { status: "artifact-ready", destination: { operation: "assess" } }
      }
    });
    if (result.kind !== "ready") throw new Error("Expected proposal-target check.");
    const payload = result.state.proposal.payload as unknown as {
      target: { mode: string };
      findings: Array<{ anchors: Array<{ blockId?: string }> }>;
    };
    expect(payload.target.mode).toBe("proposal-draft");
    expect(payload.findings[0]?.anchors[0]?.blockId).toBeUndefined();
  });

  it("refuses the same idempotency key with a different request body", async () => {
    const harness = await createHarness("applied");
    await harness.services.generate({
      ...harness.request,
      provider: successProvider()
    });
    await expect(
      harness.services.generate({
        ...harness.request,
        instruction: `${harness.assignment.brief} `,
        provider: successProvider()
      })
    ).rejects.toThrow(/different instructions/i);
  });

  it("refuses foreign, archived, and stale assignments before provider work", async () => {
    const applied = await createHarness("applied");
    let calls = 0;
    await expect(
      applied.services.generate({
        ...applied.request,
        accountId: STRANGER,
        provider: {
          async completeStructured() {
            calls += 1;
            return { ok: true as const, output: contradictionCandidates };
          }
        }
      })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentNotFoundError);
    expect(calls).toBe(0);

    const archived = await createHarness("applied", { archived: true });
    await expect(
      archived.services.generate({ ...archived.request, provider: successProvider() })
    ).rejects.toBeInstanceOf(ProjectArchivedMutationError);

    const stale = await createHarness("applied", { assignmentVersion: 2 });
    await expect(
      stale.services.generate({
        ...stale.request,
        expectedAssignmentVersion: 1,
        provider: successProvider()
      })
    ).rejects.toThrow(/assignment changed before/i);
  });

  it("records malformed provider output and invalid anchors as terminal failures without proposals", async () => {
    const malformedHarness = await createHarness("applied");
    const malformed = await malformedHarness.services.generate({
      ...malformedHarness.request,
      provider: {
        async completeStructured() {
          return {
            ok: false as const,
            diagnostic: { code: "invalid_structured_output" as const, retryable: false }
          };
        }
      }
    });
    expect(malformed).toMatchObject({
      kind: "failed",
      state: {
        run: { status: "failed", terminalDiagnosticCode: "provider-malformed-output" },
        assignment: { status: "failed", version: 3 }
      }
    });
    await expect(malformedHarness.proposals.listByProject(PROJECT)).resolves.toEqual([]);

    const invalidHarness = await createHarness("applied");
    const invalidAnchor = await invalidHarness.services.generate({
      ...invalidHarness.request,
      idempotencyKey: "attempt-check-invalid-anchor",
      provider: successProvider(
        Object.freeze({
          schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
          findings: Object.freeze([
            Object.freeze({
              kind: "contradiction" as const,
              severity: "important" as const,
              claim: "Wrong scene.",
              anchors: Object.freeze([
                Object.freeze({ sceneId: NEIGHBOR, quote: "missing quote text" })
              ])
            })
          ])
        })
      )
    });
    expect(invalidAnchor).toMatchObject({
      kind: "failed",
      state: { run: { terminalDiagnosticCode: "provider-malformed-output" } }
    });
    expect(await invalidHarness.proposals.listByProject(PROJECT)).toEqual([]);
  });

  it("records provider timeout and cancel without leaving a running assignment", async () => {
    const timeoutHarness = await createHarness("applied");
    const timeout = await timeoutHarness.services.generate({
      ...timeoutHarness.request,
      provider: {
        async completeStructured() {
          return {
            ok: false as const,
            diagnostic: { code: "timeout" as const, retryable: true }
          };
        }
      }
    });
    expect(timeout).toMatchObject({
      kind: "failed",
      state: { run: { terminalDiagnosticCode: "provider-timeout" }, assignment: { status: "failed" } }
    });

    const cancelHarness = await createHarness("applied");
    const canceled = await cancelHarness.services.generate({
      ...cancelHarness.request,
      idempotencyKey: "attempt-check-cancel",
      provider: {
        async completeStructured() {
          return {
            ok: false as const,
            diagnostic: { code: "cancelled" as const, retryable: false }
          };
        }
      }
    });
    expect(canceled).toMatchObject({
      kind: "canceled",
      state: { run: { terminalDiagnosticCode: "run-canceled" }, assignment: { status: "canceled" } }
    });
  });

  it("rolls back every ready artifact record when atomic completion fails", async () => {
    const harness = await createHarness("applied", { failAfter: "finish-run" });
    await expect(
      harness.services.generate({ ...harness.request, provider: successProvider() })
    ).rejects.toThrow(/injected story check generation failure/i);
    await expect(harness.proposals.listByProject(PROJECT)).resolves.toEqual([]);
    await expect(
      harness.assignments.get({
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ASSIGNMENT_APPLIED
      })
    ).resolves.toMatchObject({ status: "running", version: 2 });
  });

  it("refuses non-initial attempts in this slice", async () => {
    const harness = await createHarness("applied");
    await expect(
      harness.services.generate({
        ...harness.request,
        kind: "revision",
        provider: successProvider()
      })
    ).rejects.toThrow(/initial attempts only/i);
  });
});

describe("story work generation regression", () => {
  it("still fingerprints scene and character generation requests independently", async () => {
    const sceneFingerprint = await sceneStoryWorkAttemptRequestFingerprint(
      {
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ASSIGNMENT_APPLIED,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "scene"
      },
      hashPort
    );
    const characterFingerprint = await characterStoryWorkAttemptRequestFingerprint(
      {
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ASSIGNMENT_APPLIED,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "character"
      },
      hashPort
    );
    expect(sceneFingerprint).not.toEqual(characterFingerprint);
  });
});
