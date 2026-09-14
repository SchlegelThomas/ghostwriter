import { describe, expect, it } from "vitest";
import type { ContextReceipt } from "./agent-context-receipt.js";
import {
  CHARACTER_STORY_WORK_WORKFLOW_ID,
  instructionContentHash
} from "./agent-domain.js";
import {
  createAgentRun,
  createQueuedAgentRun,
  createReadyAgentProposal
} from "./agent-runs-proposals.js";
import {
  CharacterStoryWorkArtifactMismatchError,
  StoryWorkAssignmentNotFoundError,
  createCharacterStoryWorkServices
} from "./character-story-work-services.js";
import {
  agentProposalId,
  agentRunId,
  contextReceiptId,
  defineProjectRecords,
  storyKnowledgeId,
  type ProjectRecords
} from "./domain.js";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID
} from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import {
  createMemoryCharacterStoryWorkApplyUnitOfWork,
  type MemoryCharacterStoryWorkFailurePoint
} from "./memory-character-story-work-uow.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemorySceneDocumentRepository } from "./memory-scene-document-repository.js";
import { createMemoryStoryWorkAssignmentRepository } from "./memory-story-work-assignment-repository.js";
import { createMemoryStoryWorkAttemptRepository } from "./memory-story-work-attempt-repository.js";
import {
  createStoryWorkAssignment,
  storyWorkAssignmentId,
  type StoryWorkArtifactPointer
} from "./story-work-assignment.js";
import { createStoryWorkAttempt } from "./story-work-attempt.js";
import { sceneContentHash } from "./scene-documents.js";
import { createInitialSceneDocumentState } from "./scene-writing-services.js";
import {
  assembleStorySceneResource,
  assembleStoryStructureResource
} from "./story-context-receipt.js";
import { storyContextFromProjectRecords } from "./story-context.js";

const OWNER = accountId("account-character-story-work-owner");
const FOREIGN = accountId("account-character-story-work-foreign");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-character-story-work");
const RUN_ID = agentRunId("run-character-story-work");
const PROPOSAL_ID = agentProposalId("proposal-character-story-work-v1");
const RECEIPT_ID = contextReceiptId("receipt-character-story-work");
const DESTINATION_ID = storyKnowledgeId("knowledge-character-story-work-reserved");
const CONTENT_HASH = instructionContentHash("a".repeat(64));
const RECEIPT_HASH = instructionContentHash("b".repeat(64));
const SCENE_ID = BELLWETHER_FIXTURE.scenes[0]!.id;
const CREATED_AT = "2026-09-12T14:00:00.000Z";
const APPLIED_AT = "2026-09-12T14:05:00.000Z";
const hashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
});

type HarnessOptions = Readonly<{
  failAfter?: MemoryCharacterStoryWorkFailurePoint;
  archived?: boolean;
  destinationId?: typeof DESTINATION_ID;
  assignmentArtifactProposalId?: typeof PROPOSAL_ID;
  currentArtifactVersion?: number;
  generatedArtifact?: StoryWorkArtifactPointer;
  runAccountId?: typeof OWNER;
  runReceiptHash?: typeof RECEIPT_HASH;
  proposalTargetId?: typeof DESTINATION_ID;
  receiptTargetId?: typeof DESTINATION_ID;
  payloadSourceSceneIds?: readonly typeof SCENE_ID[];
  assignmentSceneSources?: readonly typeof SCENE_ID[];
  missingConsumedHead?: boolean;
  staleSceneReceipt?: "version" | "hash";
  staleStructureReceipt?: "intent" | "order" | "knowledge";
  includeUnconsumedHead?: boolean;
}>;

function changedStructureRecords(
  records: ProjectRecords,
  change: NonNullable<HarnessOptions["staleStructureReceipt"]>
): ProjectRecords {
  if (change === "intent") {
    return defineProjectRecords({
      ...records,
      scenes: records.scenes.map((scene) =>
        scene.id === SCENE_ID
          ? {
              ...scene,
              sketch: { ...scene.sketch, purpose: "A changed scene purpose." }
            }
          : scene
      )
    });
  }
  if (change === "knowledge") {
    return defineProjectRecords({
      ...records,
      storyKnowledge: records.storyKnowledge.map((knowledge) =>
        knowledge.kind === "thread"
          ? { ...knowledge, label: `${knowledge.label} changed` }
          : knowledge
      )
    });
  }
  return defineProjectRecords({
    ...records,
    books: records.books.map((book, bookIndex) =>
      bookIndex === 0
        ? {
            ...book,
            manuscript: {
              ...book.manuscript,
              parts: book.manuscript.parts.map((part, partIndex) =>
                partIndex === 0
                  ? {
                      ...part,
                      chapters: part.chapters.map((chapter, chapterIndex) =>
                        chapterIndex === 0
                          ? { ...chapter, sceneIds: [...chapter.sceneIds].reverse() }
                          : chapter
                      )
                    }
                  : part
              )
            }
          }
        : book
    )
  });
}

async function createHarness(options: HarnessOptions = {}) {
  const destinationId = options.destinationId ?? DESTINATION_ID;
  const projectRecords = options.archived === true
    ? defineProjectRecords({
        ...BELLWETHER_FIXTURE,
        project: {
          ...BELLWETHER_FIXTURE.project,
          archivedAt: "2026-09-12T13:00:00.000Z"
        }
      })
    : BELLWETHER_FIXTURE;
  const projects = createMemoryProjectRepository(
    [projectRecords],
    [
      createProjectMembership({
        projectId: projectRecords.project.id,
        accountId: OWNER,
        role: "owner",
        createdAt: CREATED_AT
      })
    ]
  );
  const assignments = createMemoryStoryWorkAssignmentRepository();
  const attempts = createMemoryStoryWorkAttemptRepository();
  const proposals = createMemoryAgentProposalRepository();
  const runs = createMemoryAgentRunRepository();
  const receipts = createMemoryContextReceiptRepository();
  const sceneDocuments = createMemorySceneDocumentRepository();
  const initialScene = await createInitialSceneDocumentState({
    projectId: projectRecords.project.id,
    sceneId: SCENE_ID,
    actorAccountId: OWNER,
    ids: { create: (kind) => `${kind}-character-story-work` },
    now: CREATED_AT
  });
  if (options.missingConsumedHead !== true) {
    await sceneDocuments.initialize(initialScene);
  }
  if (options.includeUnconsumedHead === true) {
    const unrelatedScene = await createInitialSceneDocumentState({
      projectId: projectRecords.project.id,
      sceneId: projectRecords.scenes[1]!.id,
      actorAccountId: OWNER,
      ids: { create: (kind) => `${kind}-unconsumed-character-story-work` },
      now: CREATED_AT
    });
    await sceneDocuments.initialize(unrelatedScene);
  }
  const sceneSources = options.assignmentSceneSources ?? [SCENE_ID];
  const assignment = createStoryWorkAssignment({
    id: ASSIGNMENT_ID,
    projectId: projectRecords.project.id,
    initiatorAccountId: OWNER,
    version: 4,
    taskKind: "character",
    brief: "Create a complete dossier for Inez Vale.",
    constraints: "Keep every claim grounded in the selected scene.",
    doneWhen: "A reviewable Cast record is ready.",
    sources: sceneSources.map((sceneId) => ({
      kind: "scene" as const,
      sceneId,
      projectVersion: projectRecords.project.version
    })),
    destination: {
      kind: "story-knowledge",
      storyKnowledgeId: destinationId,
      operation: "create"
    },
    provider: "openai",
    model: "gpt-4.1",
    status: "awaiting-review",
    steps: [{ id: "draft-dossier", title: "Draft dossier", dependencies: [] }],
    currentArtifact: {
      proposalId: options.assignmentArtifactProposalId ?? PROPOSAL_ID,
      artifactVersion: options.currentArtifactVersion ?? 1,
      contentHash: CONTENT_HASH
    },
    generatedArtifact: options.generatedArtifact ?? {
      proposalId: options.assignmentArtifactProposalId ?? PROPOSAL_ID,
      artifactVersion: options.currentArtifactVersion ?? 1,
      contentHash: CONTENT_HASH
    },
    results: [],
    idempotencyKey: "assignment-character-story-work-key",
    createdAt: CREATED_AT,
    updatedAt: "2026-09-12T14:04:00.000Z"
  });
  expect(
    await assignments.create({
      assignment,
      requestFingerprint: instructionContentHash("c".repeat(64))
    })
  ).toMatchObject({ ok: true, created: true });

  const receiptHead = options.staleSceneReceipt === "version"
    ? { ...initialScene.head, workingVersion: initialScene.head.workingVersion + 1 }
    : options.staleSceneReceipt === "hash"
      ? { ...initialScene.head, contentHash: sceneContentHash("9".repeat(64)) }
      : initialScene.head;
  const sceneResource = await assembleStorySceneResource({
    projectId: projectRecords.project.id,
    sceneId: SCENE_ID,
    head: receiptHead,
    inclusionReason: "The writer selected this scene.",
    hashPort
  });
  const structureRecords = options.staleStructureReceipt === undefined
    ? projectRecords
    : changedStructureRecords(projectRecords, options.staleStructureReceipt);
  const structureResource = await assembleStoryStructureResource({
    projectId: projectRecords.project.id,
    context: storyContextFromProjectRecords(structureRecords),
    inclusionReason: "The assignment's exact story context.",
    hashPort
  });
  const receipt: ContextReceipt = Object.freeze({
    id: RECEIPT_ID,
    projectId: projectRecords.project.id,
    workflowId: CHARACTER_STORY_WORK_WORKFLOW_ID,
    workflowVersion: "1.0.0",
    layers: [],
    resources: [structureResource.resource, sceneResource.resource],
    excludedContextClasses: [
      "publishing-profile",
      "attachments",
      "canvas",
      "manuscript",
      "credentials",
      "unrelated-project-resources"
    ] as const,
    provider: "openai",
    model: "gpt-4.1",
    maxOutputTokens: 2_000,
    wallClockSeconds: 60,
    toolCount: 0,
    egressClass: "openai-responses",
    outputSchemaId: "character-create-v2",
    targetStoryKnowledgeId: options.receiptTargetId ?? destinationId,
    primaryTarget: {
      kind: "story-knowledge" as const,
      id: options.receiptTargetId ?? destinationId
    },
    receiptHash: RECEIPT_HASH,
    createdAt: CREATED_AT
  });
  expect(await receipts.insertImmutable(receipt)).toMatchObject({ ok: true });

  const queued = createQueuedAgentRun({
    id: RUN_ID,
    projectId: projectRecords.project.id,
    initiatorAccountId: options.runAccountId ?? OWNER,
    workflowId: CHARACTER_STORY_WORK_WORKFLOW_ID,
    workflowVersion: "1.0.0",
    provider: "openai",
    model: "gpt-4.1",
    receiptId: RECEIPT_ID,
    receiptHash: options.runReceiptHash ?? RECEIPT_HASH,
    status: "queued",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  });
  expect(await runs.create(queued)).toMatchObject({ ok: true });
  const running = createAgentRun({
    ...queued,
    status: "running",
    updatedAt: "2026-09-12T14:01:00.000Z"
  });
  expect(
    await runs.transition({ runId: RUN_ID, expectedStatus: "queued", next: running })
  ).toMatchObject({ ok: true });
  const ready = createAgentRun({
    ...running,
    status: "ready",
    updatedAt: "2026-09-12T14:02:00.000Z",
    completedAt: "2026-09-12T14:02:00.000Z",
    providerResponseId: "response-character-story-work",
    tokenUsage: { inputTokens: 80, outputTokens: 60, totalTokens: 140 }
  });
  expect(
    await runs.transition({ runId: RUN_ID, expectedStatus: "running", next: ready })
  ).toMatchObject({ ok: true });

  const proposal = createReadyAgentProposal({
    id: PROPOSAL_ID,
    projectId: projectRecords.project.id,
    runId: RUN_ID,
    receiptId: RECEIPT_ID,
    status: "ready",
    outputSchemaId: "character-create-v2",
    primaryTarget: {
      kind: "story-knowledge",
      id: options.proposalTargetId ?? destinationId
    },
    payload: {
      schemaId: "character-create-v2",
      name: "Inez Vale",
      summary: "A patient radio engineer who distrusts convenient signals.",
      aliases: ["Nez", "The night operator"],
      characterSheet: {
        desire: "Prove the signal has a human source.",
        pressure: "Her brother vanished following the same frequency.",
        voiceNotes: "Precise, restrained, and dryly funny."
      },
      sourceSceneIds: options.payloadSourceSceneIds ?? [SCENE_ID]
    },
    contentHash: CONTENT_HASH,
    createdAt: "2026-09-12T14:02:00.000Z",
    updatedAt: "2026-09-12T14:02:00.000Z"
  });
  expect(await proposals.create(proposal)).toMatchObject({ ok: true });

  expect(
    await attempts.create({
      attempt: createStoryWorkAttempt({
        assignmentId: ASSIGNMENT_ID,
        projectId: projectRecords.project.id,
        initiatorAccountId: OWNER,
        runId: RUN_ID,
        version: 2,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: assignment.brief,
        idempotencyKey: "attempt-character-story-work-key",
        requestFingerprint: instructionContentHash("f".repeat(64)),
        resultArtifact: assignment.generatedArtifact,
        createdAt: CREATED_AT,
        completedAt: "2026-09-12T14:02:00.000Z"
      })
    })
  ).toMatchObject({ ok: true });

  const unitOfWork = createMemoryCharacterStoryWorkApplyUnitOfWork({
    projects,
    sceneDocuments,
    assignments,
    attempts,
    proposals,
    runs,
    receipts,
    hashPort,
    ...(options.failAfter === undefined ? {} : { failAfter: options.failAfter })
  });
  const service = createCharacterStoryWorkServices({
    apply: unitOfWork,
    clock: { now: () => APPLIED_AT }
  });
  const input = Object.freeze({
    accountId: OWNER,
    projectId: projectRecords.project.id,
    assignmentId: ASSIGNMENT_ID,
    expectedAssignmentVersion: assignment.version,
    proposalId: PROPOSAL_ID,
    expectedArtifactVersion: assignment.currentArtifact!.artifactVersion,
    expectedProposalContentHash: CONTENT_HASH,
    expectedProjectVersion: projectRecords.project.version
  });
  return { projects, assignments, proposals, service, input, destinationId };
}

async function expectUnchanged(harness: Awaited<ReturnType<typeof createHarness>>) {
  expect((await harness.projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID))?.version).toBe(
    BELLWETHER_FIXTURE.project.version
  );
  expect(
    (await harness.projects.listStoryKnowledge(BELLWETHER_FIXTURE_PROJECT_ID)).some(
      (entry) => entry.id === harness.destinationId
    )
  ).toBe(BELLWETHER_FIXTURE.storyKnowledge.some((entry) => entry.id === harness.destinationId));
  expect((await harness.proposals.get(PROPOSAL_ID))?.status).toBe("ready");
  expect(
    (
      await harness.assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID
      })
    )?.status
  ).toBe("awaiting-review");
}

describe("memory character story work apply unit of work", () => {
  it("applies the exact reviewed tuple once and preserves the full character dossier", async () => {
    const harness = await createHarness();
    const first = await harness.service.applyCharacterProposal(harness.input);
    expect(first.replayed).toBe(false);
    expect(first.result).toEqual({
      kind: "story-knowledge",
      storyKnowledgeId: DESTINATION_ID,
      projectVersion: BELLWETHER_FIXTURE.project.version + 1
    });
    const record = (await harness.projects.listStoryKnowledge(BELLWETHER_FIXTURE_PROJECT_ID))
      .find((entry) => entry.id === DESTINATION_ID);
    expect(record).toMatchObject({
      label: "Inez Vale",
      kind: "character",
      authority: "planned",
      notes: "A patient radio engineer who distrusts convenient signals.",
      aliases: ["Nez", "The night operator"],
      characterSheet: {
        desire: "Prove the signal has a human source.",
        pressure: "Her brother vanished following the same frequency.",
        voiceNotes: "Precise, restrained, and dryly funny."
      },
      linkedSceneIds: [SCENE_ID]
    });

    const replay = await harness.service.applyCharacterProposal(harness.input);
    expect(replay.replayed).toBe(true);
    expect((await harness.projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID))?.version).toBe(
      BELLWETHER_FIXTURE.project.version + 1
    );
  });

  it("serializes concurrent exact applies into one commit and one replay", async () => {
    const harness = await createHarness();
    const results = await Promise.all([
      harness.service.applyCharacterProposal(harness.input),
      harness.service.applyCharacterProposal(harness.input)
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(
      (await harness.projects.listStoryKnowledge(BELLWETHER_FIXTURE_PROJECT_ID)).filter(
        (entry) => entry.id === DESTINATION_ID
      )
    ).toHaveLength(1);
  });

  it("applies an edited review artifact through its immutable generated origin", async () => {
    const generatedArtifact: StoryWorkArtifactPointer = {
      proposalId: agentProposalId("proposal-character-story-work-generated"),
      artifactVersion: 1,
      contentHash: instructionContentHash("8".repeat(64))
    };
    const harness = await createHarness({
      currentArtifactVersion: 2,
      generatedArtifact
    });
    const applied = await harness.service.applyCharacterProposal(harness.input);
    expect(applied).toMatchObject({ replayed: false, assignment: { status: "applied" } });
    expect(applied.assignment.generatedArtifact).toEqual(generatedArtifact);
    expect(applied.assignment.currentArtifact).toMatchObject({
      proposalId: PROPOSAL_ID,
      artifactVersion: 2,
      contentHash: CONTENT_HASH
    });
    await expect(
      harness.service.applyCharacterProposal(harness.input)
    ).resolves.toMatchObject({ replayed: true });
  });

  for (const failAfter of ["after-project", "after-proposal"] as const) {
    it(`rolls every participant back after an injected ${failAfter} failure`, async () => {
      const harness = await createHarness({ failAfter });
      await expect(harness.service.applyCharacterProposal(harness.input)).rejects.toThrow(
        /Injected character apply failure/
      );
      await expectUnchanged(harness);
    });
  }

  it("hides foreign ownership and rejects stale reviewed tuples without mutation", async () => {
    const harness = await createHarness();
    await expect(
      harness.service.applyCharacterProposal({ ...harness.input, accountId: FOREIGN })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentNotFoundError);
    await expect(
      harness.service.applyCharacterProposal({
        ...harness.input,
        expectedProposalContentHash: instructionContentHash("d".repeat(64))
      })
    ).rejects.toBeInstanceOf(CharacterStoryWorkArtifactMismatchError);
    await expect(
      harness.service.applyCharacterProposal({
        ...harness.input,
        expectedAssignmentVersion: harness.input.expectedAssignmentVersion - 1
      })
    ).rejects.toThrow();
    await expect(
      harness.service.applyCharacterProposal({
        ...harness.input,
        expectedArtifactVersion: 2
      })
    ).rejects.toBeInstanceOf(CharacterStoryWorkArtifactMismatchError);
    await expect(
      harness.service.applyCharacterProposal({
        ...harness.input,
        expectedProjectVersion: harness.input.expectedProjectVersion + 1
      })
    ).rejects.toThrow();
    await expectUnchanged(harness);
  });

  it("rejects foreign runs, receipt drift, and an old review artifact without mutation", async () => {
    const foreignRun = await createHarness({ runAccountId: FOREIGN });
    await expect(
      foreignRun.service.applyCharacterProposal(foreignRun.input)
    ).rejects.toThrow();
    await expectUnchanged(foreignRun);

    const receiptDrift = await createHarness({
      runReceiptHash: instructionContentHash("e".repeat(64))
    });
    await expect(
      receiptDrift.service.applyCharacterProposal(receiptDrift.input)
    ).rejects.toThrow();
    await expectUnchanged(receiptDrift);

    const oldReview = await createHarness({
      assignmentArtifactProposalId: agentProposalId("proposal-newer-review")
    });
    await expect(
      oldReview.service.applyCharacterProposal(oldReview.input)
    ).rejects.toBeInstanceOf(CharacterStoryWorkArtifactMismatchError);
    await expectUnchanged(oldReview);
  });

  it("rejects target drift, archived projects, source expansion, and collisions", async () => {
    const targetDrift = await createHarness({
      proposalTargetId: storyKnowledgeId("knowledge-wrong-target")
    });
    await expect(
      targetDrift.service.applyCharacterProposal(targetDrift.input)
    ).rejects.toBeInstanceOf(CharacterStoryWorkArtifactMismatchError);
    await expectUnchanged(targetDrift);

    const receiptTargetDrift = await createHarness({
      receiptTargetId: storyKnowledgeId("knowledge-wrong-receipt-target")
    });
    await expect(
      receiptTargetDrift.service.applyCharacterProposal(receiptTargetDrift.input)
    ).rejects.toBeInstanceOf(CharacterStoryWorkArtifactMismatchError);
    await expectUnchanged(receiptTargetDrift);

    const archived = await createHarness({ archived: true });
    await expect(archived.service.applyCharacterProposal(archived.input)).rejects.toThrow();
    await expectUnchanged(archived);

    const sourceExpansion = await createHarness({ assignmentSceneSources: [] });
    await expect(
      sourceExpansion.service.applyCharacterProposal(sourceExpansion.input)
    ).rejects.toThrow(/explicit scene sources/i);
    await expectUnchanged(sourceExpansion);

    const collisionId = BELLWETHER_FIXTURE.storyKnowledge[0]!.id;
    const collision = await createHarness({ destinationId: collisionId });
    await expect(collision.service.applyCharacterProposal(collision.input)).rejects.toThrow(
      /already in use/i
    );
    await expectUnchanged(collision);
  });

  it("checks only exact consumed prose and structure dependencies", async () => {
    for (const change of ["version", "hash"] as const) {
      const staleProse = await createHarness({ staleSceneReceipt: change });
      await expect(
        staleProse.service.applyCharacterProposal(staleProse.input)
      ).rejects.toMatchObject({ code: "CHARACTER_STORY_WORK_CONTEXT_STALE" });
      await expectUnchanged(staleProse);
    }

    const missingProse = await createHarness({ missingConsumedHead: true });
    await expect(
      missingProse.service.applyCharacterProposal(missingProse.input)
    ).rejects.toMatchObject({ code: "CHARACTER_STORY_WORK_CONTEXT_STALE" });
    await expectUnchanged(missingProse);

    for (const change of ["intent", "order", "knowledge"] as const) {
      const staleStructure = await createHarness({ staleStructureReceipt: change });
      await expect(
        staleStructure.service.applyCharacterProposal(staleStructure.input)
      ).rejects.toMatchObject({ code: "CHARACTER_STORY_WORK_CONTEXT_STALE" });
      await expectUnchanged(staleStructure);
    }

    const unrelatedProse = await createHarness({ includeUnconsumedHead: true });
    await expect(
      unrelatedProse.service.applyCharacterProposal(unrelatedProse.input)
    ).resolves.toMatchObject({ replayed: false });
  });
});
import { createHash } from "node:crypto";
