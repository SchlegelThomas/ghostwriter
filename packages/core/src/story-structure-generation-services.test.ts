import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AgentModelId } from "./agent-context-receipt.js";
import { createAgentGuidanceServices } from "./agent-guidance-services.js";
import { instructionContentHash, type AsyncHashPort } from "./agent-domain.js";
import { validateAgentProposalPayload } from "./agent-runs-proposals.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import {
  createMemoryAccountAiCollaborationProfileRepository,
  createMemoryProjectAgentInstructionsRepository,
  createMemoryProjectPlaybookRepository
} from "./memory-agent-guidance-repository.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { createMemoryStoryStructureGenerationUnitOfWork } from "./memory-story-structure-generation-uow.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemoryStoryWorkAssignmentRepository } from "./memory-story-work-assignment-repository.js";
import { createMemoryStoryWorkAttemptRepository } from "./memory-story-work-attempt-repository.js";
import {
  bookId,
  chapterId,
  defineProjectRecords,
  projectId
} from "./domain.js";
import { accountId, createProjectMembership } from "./identity.js";
import {
  STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
  STORY_STRUCTURE_SCHEMA_ID,
  storyStructureLoweringContextFromBook
} from "./story-structure-proposal-v1.js";
import {
  createStoryStructureGenerationServices,
  storyStructureAttemptRequestFingerprint,
  type StoryStructureAttemptRequest
} from "./story-structure-generation-services.js";
import {
  characterStoryWorkAttemptRequestFingerprint
} from "./character-story-work-generation-services.js";
import { sceneStoryWorkAttemptRequestFingerprint } from "./scene-story-work-generation-services.js";
import { assembleStoryStructureResource } from "./story-context-receipt.js";
import type { StoryContextProjection } from "./story-context.js";
import {
  createStoryWorkAssignment,
  storyWorkAssignmentId,
  type StoryWorkAssignment
} from "./story-work-assignment.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import type { DomainIdKind, IdGenerator } from "./project-repository.js";

const hashPort: AsyncHashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
});

const PROJECT = projectId("project-structure-generation");
const OWNER = accountId("account-structure-generation");
const STRANGER = accountId("account-structure-generation-stranger");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-structure-generation");
const BOOK = bookId("book-structure-generation");
const NOW = "2026-09-13T22:00:00.000Z";

function threeChapterCandidate() {
  return Object.freeze({
    schemaId: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
    newParts: [{ localKey: "part-a", title: "Act One" }],
    newChapters: [
      {
        localKey: "ch-1",
        part: { kind: "new" as const, localKey: "part-a" },
        title: "Chapter One",
        objective: "Introduce the world"
      },
      {
        localKey: "ch-2",
        part: { kind: "new" as const, localKey: "part-a" },
        title: "Chapter Two"
      },
      {
        localKey: "ch-3",
        part: { kind: "new" as const, localKey: "part-a" },
        title: "Chapter Three"
      }
    ],
    newPlannedScenes: [
      {
        localKey: "sc-1",
        host: { kind: "newChapter" as const, localKey: "ch-1" },
        title: "Opening"
      },
      {
        localKey: "sc-2",
        host: { kind: "newChapter" as const, localKey: "ch-2" },
        title: "Middle"
      },
      {
        localKey: "sc-3",
        host: { kind: "newChapter" as const, localKey: "ch-3" },
        title: "Turn",
        intent: { purpose: "Raise the stakes" }
      }
    ],
    existingChapterUpdates: [],
    chapterReorders: [
      {
        part: { kind: "new" as const, localKey: "part-a" },
        order: [
          { kind: "new" as const, localKey: "ch-1" },
          { kind: "new" as const, localKey: "ch-2" },
          { kind: "new" as const, localKey: "ch-3" }
        ]
      }
    ],
    existingSceneMoves: [],
    existingSceneArchiveChanges: [],
    existingSceneIntentUpdates: []
  });
}

const PROJECT_RECORDS = defineProjectRecords({
  project: {
    id: PROJECT,
    title: "Structure generation",
    bookIds: [BOOK],
    version: 7,
    createdAt: NOW
  },
  books: [
    {
      id: BOOK,
      projectId: PROJECT,
      title: "Novel",
      status: "drafting",
      manuscript: { parts: [], unassignedSceneIds: [] },
      createdAt: NOW
    }
  ],
  scenes: [],
  storyKnowledge: [],
  editions: []
});

function storyContext(projectVersion = 7): StoryContextProjection {
  return Object.freeze({
    projectId: PROJECT,
    projectVersion,
    scope: Object.freeze({ kind: "project" as const }),
    totalCanonicalSceneCount: 0,
    scenes: Object.freeze([]),
    threads: Object.freeze([])
  });
}

function outlineAssignment(): StoryWorkAssignment {
  return createStoryWorkAssignment({
    id: ASSIGNMENT_ID,
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "outline",
    brief: "  Develop a three-chapter outline for the active book.  ",
    constraints: "  Respect existing canon.  ",
    doneWhen: "  Structure is ready for writer review.  ",
    sources: [{ kind: "book", bookId: BOOK, projectVersion: 7 }],
    destination: { kind: "book", bookId: BOOK, operation: "update" },
    provider: "openai",
    model: "gpt-4.1" as AgentModelId,
    status: "brief-ready",
    steps: [{ id: "structure", title: "Propose structure", dependencies: [] }],
    results: [],
    idempotencyKey: "submit-structure-generation",
    createdAt: NOW,
    updatedAt: NOW
  });
}

async function resourcesFor(context: StoryContextProjection) {
  const structure = await assembleStoryStructureResource({
    projectId: PROJECT,
    context,
    inclusionReason: "selected-structure",
    hashPort
  });
  return Object.freeze([structure]);
}

function loweringContext() {
  return storyStructureLoweringContextFromBook(
    PROJECT,
    PROJECT_RECORDS.books[0]!,
    []
  );
}

function sequenceIds(values: Partial<Record<DomainIdKind, readonly string[]>>): IdGenerator {
  const positions = new Map<DomainIdKind, number>();
  return {
    create(kind): string {
      const index = positions.get(kind) ?? 0;
      const list = values[kind] ?? [`generated-${kind}-${index + 1}`];
      const value = list[index];
      positions.set(kind, index + 1);
      if (value === undefined) throw new Error(`No ${kind} ID remains in the fixture.`);
      return value;
    }
  };
}

async function createHarness(
  options: Readonly<{
    failAfter?: "begin-run" | "complete-proposal" | "finish-run";
    archived?: boolean;
    assignmentVersion?: number;
    ids?: IdGenerator;
  }> = {}
) {
  const projectRecords = options.archived
    ? defineProjectRecords({
        ...PROJECT_RECORDS,
        project: { ...PROJECT_RECORDS.project, archivedAt: NOW }
      })
    : PROJECT_RECORDS;
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
  const assignment = outlineAssignment();
  const versionedAssignment =
    options.assignmentVersion === undefined
      ? assignment
      : createStoryWorkAssignment({ ...assignment, version: options.assignmentVersion });
  await assignments.create({
    assignment: versionedAssignment,
    requestFingerprint: instructionContentHash("c".repeat(64))
  });
  let id = 0;
  const ids =
    options.ids ??
    ({
      create(kind: DomainIdKind) {
        id += 1;
        return `${kind}-structure-generation-${id}`;
      }
    } satisfies IdGenerator);
  let tick = 0;
  const clock = {
    now() {
      tick += 1;
      return `2026-09-13T22:00:${String(tick).padStart(2, "0")}.000Z`;
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
  const generation = createMemoryStoryStructureGenerationUnitOfWork({
    projects,
    assignments,
    attempts,
    receipts,
    runs,
    proposals,
    ...(options.failAfter === undefined ? {} : { failAfter: options.failAfter })
  });
  const services = createStoryStructureGenerationServices({
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
  const baseRequest: Omit<StoryStructureAttemptRequest, "provider"> = {
    accountId: OWNER,
    projectId: PROJECT,
    assignmentId: versionedAssignment.id,
    expectedAssignmentVersion: versionedAssignment.version,
    kind: "initial",
    sourceMode: "submitted-snapshot",
    instruction: versionedAssignment.brief,
    idempotencyKey: "attempt-structure-generation",
    projectRecords,
    storyContext: ctx,
    resources: await resourcesFor(ctx),
    trustedLoweringContext: loweringContext()
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
    ids,
    projectRecords
  };
}

function successProvider(output: unknown = threeChapterCandidate()) {
  return {
    async completeStructured() {
      return { ok: true as const, output, providerResponseId: "provider-structure-generation" };
    }
  };
}

describe("story structure generation lifecycle", () => {
  it("publishes a three-chapter structure proposal with stable ids and no prose or canvas fields", async () => {
    const harness = await createHarness({
      ids: sequenceIds({
        agentRun: ["agentRun-structure-ready"],
        contextReceipt: ["receipt-structure-ready"],
        agentProposal: ["proposal-structure-ready"],
        storyStructureOperation: [
          "op-part",
          "op-ch-1",
          "op-ch-2",
          "op-ch-3",
          "op-reorder",
          "op-sc-1",
          "op-sc-2",
          "op-sc-3",
          "op-sc-3-intent"
        ],
        part: ["part-canonical"],
        chapter: ["chapter-1", "chapter-2", "chapter-3"],
        scene: ["scene-1", "scene-2", "scene-3"]
      })
    });

    const result = await harness.services.generate({
      ...harness.request,
      provider: successProvider()
    });
    expect(result).toMatchObject({
      kind: "ready",
      state: {
        assignment: {
          status: "artifact-ready",
          version: 3,
          generatedArtifact: { artifactVersion: 1 }
        },
        run: { workflowId: "story-work.structure", status: "ready" },
        proposal: {
          outputSchemaId: STORY_STRUCTURE_SCHEMA_ID,
          primaryTarget: { kind: "book", id: BOOK }
        }
      }
    });
    if (result.kind !== "ready") throw new Error("Expected ready structure result.");
    const payload = result.state.proposal.payload as {
      schemaId: string;
      operations: Array<{ operationId: string; type: string }>;
      dependencies: unknown[];
    };
    expect(payload.schemaId).toBe(STORY_STRUCTURE_SCHEMA_ID);
    expect(payload.operations.map((operation) => operation.operationId)).toEqual([
      "op-part",
      "op-ch-1",
      "op-ch-2",
      "op-ch-3",
      "op-reorder",
      "op-sc-1",
      "op-sc-2",
      "op-sc-3",
      "op-sc-3-intent"
    ]);
    expect(JSON.stringify(payload)).not.toContain("canvas");
    expect(JSON.stringify(payload)).not.toContain("prose");
    validateAgentProposalPayload(STORY_STRUCTURE_SCHEMA_ID, payload);
    const receipt = await harness.receipts.get(result.state.run.receiptId);
    expect(receipt?.receiptHash).toBeDefined();
    expect(receipt?.resources).toHaveLength(1);
  });

  it("replays without a second provider call and allocates no entity ids on replay", async () => {
    const harness = await createHarness();
    let calls = 0;
    const provider = {
      async completeStructured() {
        calls += 1;
        return { ok: true as const, output: threeChapterCandidate() };
      }
    };
    const first = await harness.services.generate({ ...harness.request, provider });
    expect(first.kind).toBe("ready");
    const replay = await harness.services.generate({ ...harness.request, provider });
    expect(replay).toMatchObject({ kind: "replayed", state: { replayed: true } });
    expect(calls).toBe(1);
  });

  it("refuses the same idempotency key with a different request body", async () => {
    const harness = await createHarness();
    await harness.services.generate({ ...harness.request, provider: successProvider() });
    await expect(
      harness.services.generate({
        ...harness.request,
        instruction: `${harness.assignment.brief} `,
        provider: successProvider()
      })
    ).rejects.toThrow(/different instructions/i);
  });

  it("refuses foreign, archived, and stale assignments before provider work", async () => {
    const harness = await createHarness();
    let calls = 0;
    await expect(
      harness.services.generate({
        ...harness.request,
        accountId: STRANGER,
        provider: {
          async completeStructured() {
            calls += 1;
            return { ok: true as const, output: threeChapterCandidate() };
          }
        }
      })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentNotFoundError);
    expect(calls).toBe(0);

    const archived = await createHarness({ archived: true });
    await expect(
      archived.services.generate({ ...archived.request, provider: successProvider() })
    ).rejects.toBeInstanceOf(ProjectArchivedMutationError);

    const stale = await createHarness({ assignmentVersion: 2 });
    await expect(
      stale.services.generate({
        ...stale.request,
        expectedAssignmentVersion: 1,
        provider: successProvider()
      })
    ).rejects.toThrow(/assignment changed before/i);
  });

  it("records malformed provider output and invalid existing refs as terminal failures", async () => {
    const malformedHarness = await createHarness();
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

    const invalidHarness = await createHarness();
    const invalidCandidate = Object.freeze({
      ...threeChapterCandidate(),
      existingChapterUpdates: [
        {
          chapterId: chapterId("chapter-outside-allowlist"),
          objective: "Invalid"
        }
      ]
    });
    const invalid = await invalidHarness.services.generate({
      ...invalidHarness.request,
      idempotencyKey: "attempt-structure-invalid-ref",
      provider: successProvider(invalidCandidate)
    });
    expect(invalid).toMatchObject({
      kind: "failed",
      state: { run: { terminalDiagnosticCode: "provider-malformed-output" } }
    });
    expect(await invalidHarness.proposals.listByProject(PROJECT)).toEqual([]);
  });

  it("records provider timeout and cancel without leaving a running assignment", async () => {
    const timeoutHarness = await createHarness();
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

    const cancelHarness = await createHarness();
    const canceled = await cancelHarness.services.generate({
      ...cancelHarness.request,
      idempotencyKey: "attempt-structure-cancel",
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

  it("rolls back begin and complete when atomic completion fails", async () => {
    const harness = await createHarness({ failAfter: "finish-run" });
    await expect(
      harness.services.generate({ ...harness.request, provider: successProvider() })
    ).rejects.toThrow(/injected story structure generation failure/i);
    await expect(harness.proposals.listByProject(PROJECT)).resolves.toEqual([]);
    await expect(
      harness.assignments.get({
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ASSIGNMENT_ID
      })
    ).resolves.toMatchObject({ status: "running", version: 2 });
  });

  it("allocates part/chapter/scene ids only after provider success", async () => {
    const failedCreate = vi.fn(
      (kind: DomainIdKind) => `${kind}-tracked-${failedCreate.mock.calls.length}`
    );
    const failedHarness = await createHarness({ ids: { create: failedCreate } });
    await expect(
      failedHarness.services.generate({
        ...failedHarness.request,
        idempotencyKey: "attempt-structure-id-guard-fail",
        provider: successProvider({
          schemaId: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
          newParts: [],
          newChapters: [],
          newPlannedScenes: [],
          existingChapterUpdates: [],
          chapterReorders: [],
          existingSceneMoves: [],
          existingSceneArchiveChanges: [],
          existingSceneIntentUpdates: []
        })
      })
    ).resolves.toMatchObject({ kind: "failed" });
    const failedEntityKinds = failedCreate.mock.calls
      .map(([kind]) => kind)
      .filter(
        (kind) =>
          kind === "part" ||
          kind === "chapter" ||
          kind === "scene" ||
          kind === "storyStructureOperation"
      );
    expect(failedEntityKinds).toEqual([]);

    const successCreate = vi.fn(
      (kind: DomainIdKind) => `${kind}-tracked-${successCreate.mock.calls.length}`
    );
    const successHarness = await createHarness({ ids: { create: successCreate } });
    await successHarness.services.generate({
      ...successHarness.request,
      idempotencyKey: "attempt-structure-id-guard-success",
      provider: successProvider()
    });
    const successKinds = successCreate.mock.calls.map(([kind]) => kind);
    expect(successKinds).toContain("part");
    expect(successKinds).toContain("chapter");
    expect(successKinds).toContain("scene");
    expect(successKinds).toContain("storyStructureOperation");
  });
});

describe("story work generation regression", () => {
  it("still fingerprints scene, character, and structure generation requests independently", async () => {
    const ctx = storyContext();
    const structureFingerprint = await storyStructureAttemptRequestFingerprint(
      {
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ASSIGNMENT_ID,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "structure",
        projectRecords: PROJECT_RECORDS,
        storyContext: ctx,
        resources: await resourcesFor(ctx),
        trustedLoweringContext: loweringContext(),
        targetBookId: BOOK
      },
      hashPort
    );
    const sceneFingerprint = await sceneStoryWorkAttemptRequestFingerprint(
      {
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ASSIGNMENT_ID,
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
        assignmentId: ASSIGNMENT_ID,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "character"
      },
      hashPort
    );
    expect(structureFingerprint).not.toEqual(sceneFingerprint);
    expect(structureFingerprint).not.toEqual(characterFingerprint);
  });
});
