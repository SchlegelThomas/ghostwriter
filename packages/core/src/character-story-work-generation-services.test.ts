import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAgentGuidanceServices } from "./agent-guidance-services.js";
import {
  SCENE_STORY_WORK_WORKFLOW_ID,
  instructionContentHash,
  type AsyncHashPort
} from "./agent-domain.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import {
  createMemoryAccountAiCollaborationProfileRepository,
  createMemoryProjectAgentInstructionsRepository,
  createMemoryProjectPlaybookRepository
} from "./memory-agent-guidance-repository.js";
import { createMemoryCharacterStoryWorkGenerationUnitOfWork } from "./memory-character-story-work-generation-uow.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemoryStoryWorkAssignmentRepository } from "./memory-story-work-assignment-repository.js";
import { createMemoryStoryWorkAttemptRepository } from "./memory-story-work-attempt-repository.js";
import {
  CharacterStoryWorkGenerationConflictError,
  type BeginCharacterStoryWorkGenerationInput,
  type CharacterStoryWorkGenerationUnitOfWork
} from "./character-story-work-generation-uow.js";
import type { CharacterStoryWorkGenerationRepositoryDependencies } from "./character-story-work-generation-repository-uow.js";
import {
  characterStoryWorkAttemptRequestFingerprint,
  createCharacterStoryWorkGenerationServices
} from "./character-story-work-generation-services.js";
import { agentProposalId, storyKnowledgeId } from "./domain.js";
import { BELLWETHER_FIXTURE, BELLWETHER_FIXTURE_PROJECT_ID } from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import type { DomainIdKind } from "./project-repository.js";
import { sceneContentHash } from "./scene-documents.js";
import { assembleStoryStructureResource } from "./story-context-receipt.js";
import { storyContextFromProjectRecords } from "./story-context.js";
import {
  createStoryWorkAssignment,
  storyWorkAssignmentId
} from "./story-work-assignment.js";

const OWNER = accountId("account-character-generation");
const STRANGER = accountId("account-character-generation-stranger");
const ASSIGNMENT = storyWorkAssignmentId("assignment-character-generation");
const TARGET = storyKnowledgeId("knowledge-character-generation-target");
const SCENE = BELLWETHER_FIXTURE.scenes[0]!.id;
const CREATED_AT = "2026-09-12T15:00:00.000Z";
const hashPort: AsyncHashPort = {
  async digestSha256Hex(value) {
    return createHash("sha256").update(value).digest("hex");
  }
};

const generatedCharacter = Object.freeze({
  schemaId: "character-create-v2" as const,
  name: "Inez Vale",
  summary: "A wary courier who knows why the harbor signals changed.",
  aliases: Object.freeze(["Nez"]),
  characterSheet: Object.freeze({
    desire: "Keep her crew alive.",
    pressure: "The harbor master recognizes her route."
  }),
  sourceSceneIds: Object.freeze([SCENE])
});

async function createHarness(
  failAfter?: "begin-run" | "complete-proposal" | "finish-run",
  generationFactory?: (
    dependencies: CharacterStoryWorkGenerationRepositoryDependencies
  ) => CharacterStoryWorkGenerationUnitOfWork
) {
  const selectedSceneContentHash = sceneContentHash("d".repeat(64));
  const projects = createMemoryProjectRepository(
    [BELLWETHER_FIXTURE],
    [
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: OWNER,
        role: "owner",
        createdAt: CREATED_AT
      })
    ]
  );
  const assignments = createMemoryStoryWorkAssignmentRepository();
  const attempts = createMemoryStoryWorkAttemptRepository();
  const receipts = createMemoryContextReceiptRepository();
  const runs = createMemoryAgentRunRepository();
  const proposals = createMemoryAgentProposalRepository();
  const assignment = createStoryWorkAssignment({
    id: ASSIGNMENT,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "character",
    brief: "  Preserve this exact character brief.\nKeep both spaces.  ",
    constraints: "  Use only the selected scene.  ",
    doneWhen: "  A complete Cast proposal is ready.  ",
    sources: [
      {
        kind: "scene",
        sceneId: SCENE,
        projectVersion: BELLWETHER_FIXTURE.project.version,
        workingVersion: 1,
        contentHash: selectedSceneContentHash
      }
    ],
    destination: {
      kind: "story-knowledge",
      storyKnowledgeId: TARGET,
      operation: "create"
    },
    provider: "openai",
    model: "gpt-4.1",
    status: "brief-ready",
    steps: [{ id: "character", title: "Develop character", dependencies: [] }],
    results: [],
    idempotencyKey: "assignment-character-generation",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  });
  await assignments.create({
    assignment,
    requestFingerprint: instructionContentHash("a".repeat(64))
  });
  let id = 0;
  const ids = {
    create(kind: DomainIdKind) {
      id += 1;
      return `${kind}-character-generation-${id}`;
    }
  };
  let tick = 0;
  const clock = {
    now() {
      tick += 1;
      return `2026-09-12T15:00:0${tick}.000Z`;
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
  const generationDependencies = {
    projects,
    assignments,
    attempts,
    receipts,
    runs,
    proposals,
    ...(failAfter === undefined ? {} : { failAfter })
  };
  const generation =
    generationFactory?.(generationDependencies) ??
    createMemoryCharacterStoryWorkGenerationUnitOfWork(generationDependencies);
  const services = createCharacterStoryWorkGenerationServices({
    projects,
    assignments,
    proposals,
    guidance,
    generation,
    hashPort,
    ids,
    clock
  });
  const storyContext = storyContextFromProjectRecords(BELLWETHER_FIXTURE, {
    scope: { kind: "scene", sceneId: SCENE }
  });
  const structure = await assembleStoryStructureResource({
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    context: storyContext,
    inclusionReason: "The writer selected this scene scope.",
    hashPort
  });
  const sceneText = "Inez watches the harbor signal change.";
  const sceneProviderTextHash = instructionContentHash(
    await hashPort.digestSha256Hex(sceneText)
  );
  const sceneResource = Object.freeze({
    providerText: sceneText,
    resource: Object.freeze({
      resourceClass: "scene-document" as const,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: SCENE,
      workingVersion: 1,
      contentHash: selectedSceneContentHash,
      fullTextCharCount: sceneText.length,
      truncated: false,
      inclusionReason: "The writer selected this scene.",
      providerTextCharCount: sceneText.length,
      providerTextHash: sceneProviderTextHash
    })
  });
  const request = {
    accountId: OWNER,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    assignmentId: ASSIGNMENT,
    expectedAssignmentVersion: 1,
    kind: "initial" as const,
    sourceMode: "submitted-snapshot" as const,
    instruction: assignment.brief,
    idempotencyKey: "attempt-character-generation",
    storyContext,
    resources: [structure, sceneResource]
  };
  return {
    assignment,
    services,
    assignments,
    attempts,
    receipts,
    runs,
    proposals,
    generation,
    request
  };
}

describe("character story work generation lifecycle", () => {
  it("keeps workflow, schema, and reserved target checks in the character wrapper", async () => {
    let captured: BeginCharacterStoryWorkGenerationInput | undefined;
    const captureFailure = new Error("captured generation begin");
    const capturing = await createHarness(undefined, () => ({
      async findReplay() {
        return undefined;
      },
      async begin(input) {
        captured = input;
        throw captureFailure;
      },
      async complete() {
        throw new Error("unexpected completion");
      },
      async finishWithoutArtifact() {
        throw new Error("unexpected terminal transition");
      }
    }));
    await expect(
      capturing.services.generate({
        ...capturing.request,
        provider: {
          async completeStructured() {
            throw new Error("provider must not run before begin is durable");
          }
        }
      })
    ).rejects.toBe(captureFailure);
    if (captured === undefined) throw new Error("Expected generation begin input.");

    const harness = await createHarness();
    const otherTarget = storyKnowledgeId("knowledge-character-generation-other");
    const wrongWorkflow = {
      ...captured,
      receipt: {
        ...captured.receipt,
        workflowId: SCENE_STORY_WORK_WORKFLOW_ID
      },
      queuedRun: {
        ...captured.queuedRun,
        workflowId: SCENE_STORY_WORK_WORKFLOW_ID
      },
      runningRun: {
        ...captured.runningRun,
        workflowId: SCENE_STORY_WORK_WORKFLOW_ID
      }
    };
    const wrongSchema = {
      ...captured,
      receipt: {
        ...captured.receipt,
        outputSchemaId: "scene-draft-v1" as const
      }
    };
    const wrongTarget = {
      ...captured,
      receipt: {
        ...captured.receipt,
        primaryTarget: { kind: "story-knowledge" as const, id: otherTarget },
        targetStoryKnowledgeId: otherTarget
      }
    };

    for (const input of [wrongWorkflow, wrongSchema, wrongTarget]) {
      await expect(harness.generation.begin(input)).rejects.toBeInstanceOf(
        CharacterStoryWorkGenerationConflictError
      );
    }
    await expect(harness.receipts.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)).resolves.toEqual(
      []
    );
  });

  it("includes explicit source refresh intent in the idempotency fingerprint", async () => {
    const identity = {
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      assignmentId: ASSIGNMENT,
      kind: "revision" as const,
      instruction: "Use the latest saved sources.",
      priorArtifact: {
        proposalId: agentProposalId("proposal-source-mode"),
        artifactVersion: 1,
        contentHash: instructionContentHash("f".repeat(64))
      }
    };
    const submitted = await characterStoryWorkAttemptRequestFingerprint(
      { ...identity, sourceMode: "submitted-snapshot" },
      hashPort
    );
    const refreshed = await characterStoryWorkAttemptRequestFingerprint(
      { ...identity, sourceMode: "latest-authorized" },
      hashPort
    );
    expect(submitted).not.toBe(refreshed);
  });

  it("persists start before provider work and atomically publishes the ready artifact", async () => {
    const harness = await createHarness();
    let calls = 0;
    const result = await harness.services.generate({
      ...harness.request,
      provider: {
        async completeStructured(input) {
          calls += 1;
          const [assignments, runs, attempts, receipts] = await Promise.all([
            harness.assignments.listByProject({
              accountId: OWNER,
              projectId: BELLWETHER_FIXTURE_PROJECT_ID
            }),
            harness.runs.listByProject(BELLWETHER_FIXTURE_PROJECT_ID),
            harness.attempts.listByAssignment({
              accountId: OWNER,
              projectId: BELLWETHER_FIXTURE_PROJECT_ID,
              assignmentId: ASSIGNMENT
            }),
            harness.receipts.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)
          ]);
          expect(assignments[0]).toMatchObject({ status: "running" });
          expect(runs[0]).toMatchObject({ status: "running" });
          expect(attempts[0]?.instruction).toBe(harness.assignment.brief);
          expect(receipts[0]?.receiptHash).toBe(runs[0]?.receiptHash);
          expect(input.inputText).toContain(harness.assignment.brief);
          return {
            ok: true as const,
            output: generatedCharacter,
            providerResponseId: "response-character-generation",
            usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 }
          };
        }
      }
    });

    expect(calls).toBe(1);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("Expected ready result.");
    expect(result.state).toMatchObject({
      assignment: {
        status: "artifact-ready",
        currentArtifact: { artifactVersion: 1 },
        generatedArtifact: { artifactVersion: 1 }
      },
      attempt: { version: 2, resultArtifact: { artifactVersion: 1 } },
      run: { status: "ready", providerResponseId: "response-character-generation" },
      proposal: {
        outputSchemaId: "character-create-v2",
        primaryTarget: { kind: "story-knowledge", id: TARGET }
      }
    });
  });

  it("replays the exact scoped request without another provider invocation", async () => {
    const harness = await createHarness();
    let calls = 0;
    const provider = {
      async completeStructured() {
        calls += 1;
        return { ok: true as const, output: generatedCharacter };
      }
    };
    await harness.services.generate({ ...harness.request, provider });
    const replay = await harness.services.generate({ ...harness.request, provider });

    expect(replay.kind).toBe("replayed");
    expect(calls).toBe(1);
    if (replay.kind !== "replayed") throw new Error("Expected replay result.");
    expect(replay.state).toMatchObject({
      replayed: true,
      run: { status: "ready" },
      proposal: { outputSchemaId: "character-create-v2" }
    });

    await expect(
      harness.services.generate({
        ...harness.request,
        instruction: `${harness.assignment.brief} changed`,
        provider
      })
    ).rejects.toBeInstanceOf(CharacterStoryWorkGenerationConflictError);
    expect(calls).toBe(1);
  });

  it("starts an exact revision from the current artifact and permits identical output", async () => {
    const harness = await createHarness();
    const provider = {
      async completeStructured() {
        return { ok: true as const, output: generatedCharacter };
      }
    };
    const initial = await harness.services.generate({ ...harness.request, provider });
    if (initial.kind !== "ready") throw new Error("Expected initial artifact.");
    const prior = initial.state.assignment.currentArtifact!;
    const revisionInstruction = "  Keep every fact.\nMake the voice more guarded.  ";
    let revisionInput = "";
    const revision = await harness.services.generate({
      ...harness.request,
      expectedAssignmentVersion: initial.state.assignment.version,
      kind: "revision",
      sourceMode: "latest-authorized",
      instruction: revisionInstruction,
      priorArtifact: prior,
      idempotencyKey: "attempt-character-revision",
      provider: {
        async completeStructured(input) {
          revisionInput = input.inputText;
          return { ok: true as const, output: generatedCharacter };
        }
      }
    });

    expect(revisionInput).toContain(revisionInstruction);
    expect(revision.kind).toBe("ready");
    if (revision.kind !== "ready") throw new Error("Expected revised artifact.");
    expect(revision.state.assignment.currentArtifact).toMatchObject({
      artifactVersion: 2,
      contentHash: prior.contentHash
    });
    expect(revision.state.assignment.currentArtifact?.proposalId).not.toBe(prior.proposalId);
    expect(revision.state.attempt.priorArtifact).toEqual(prior);
  });

  it("records one timeout failure atomically and never retries automatically", async () => {
    const harness = await createHarness();
    let calls = 0;
    const result = await harness.services.generate({
      ...harness.request,
      provider: {
        async completeStructured() {
          calls += 1;
          return {
            ok: false as const,
            diagnostic: { code: "timeout" as const, retryable: true }
          };
        }
      }
    });

    expect(calls).toBe(1);
    expect(result).toMatchObject({
      kind: "failed",
      state: {
        assignment: { status: "failed" },
        attempt: { version: 1 },
        run: { status: "failed", terminalDiagnosticCode: "provider-timeout" }
      }
    });
    if (result.kind === "failed") {
      expect(result.state.attempt.resultArtifact).toBeUndefined();
    }
    expect(await harness.proposals.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)).toEqual([]);
  });

  it("hides foreign assignments and rolls back a failed atomic begin", async () => {
    const foreign = await createHarness();
    let providerCalls = 0;
    await expect(
      foreign.services.generate({
        ...foreign.request,
        accountId: STRANGER,
        provider: {
          async completeStructured() {
            providerCalls += 1;
            return { ok: true as const, output: generatedCharacter };
          }
        }
      })
    ).rejects.toThrow(/could not be found/i);
    expect(providerCalls).toBe(0);

    const failed = await createHarness("begin-run");
    await expect(
      failed.services.generate({
        ...failed.request,
        provider: {
          async completeStructured() {
            providerCalls += 1;
            return { ok: true as const, output: generatedCharacter };
          }
        }
      })
    ).rejects.toThrow(/Injected character generation failure/);
    expect(providerCalls).toBe(0);
    expect(
      await failed.assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT
      })
    ).toMatchObject({ status: "brief-ready", version: 1 });
    expect(await failed.runs.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)).toEqual([]);
    expect(await failed.receipts.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)).toEqual([]);
  });

  it("rolls back every success record when atomic completion fails", async () => {
    const harness = await createHarness("complete-proposal");
    let calls = 0;
    const provider = {
      async completeStructured() {
        calls += 1;
        return { ok: true as const, output: generatedCharacter };
      }
    };
    await expect(
      harness.services.generate({ ...harness.request, provider })
    ).rejects.toThrow(/Injected character generation failure/);

    expect(calls).toBe(1);
    expect(await harness.proposals.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)).toEqual([]);
    expect(
      await harness.assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT
      })
    ).toMatchObject({ status: "running", version: 2 });
    expect(await harness.runs.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)).toMatchObject([
      { status: "running" }
    ]);
    expect(
      await harness.attempts.listByAssignment({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT
      })
    ).toMatchObject([{ version: 1 }]);

    const replay = await harness.services.generate({ ...harness.request, provider });
    expect(replay.kind).toBe("replayed");
    expect(calls).toBe(1);
  });
});
