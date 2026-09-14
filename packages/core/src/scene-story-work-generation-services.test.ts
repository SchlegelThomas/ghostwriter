import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import { createAgentGuidanceServices } from "./agent-guidance-services.js";
import { instructionContentHash, type AsyncHashPort } from "./agent-domain.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import {
  createMemoryAccountAiCollaborationProfileRepository,
  createMemoryProjectAgentInstructionsRepository,
  createMemoryProjectPlaybookRepository
} from "./memory-agent-guidance-repository.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemorySceneStoryWorkGenerationUnitOfWork } from "./memory-scene-story-work-generation-uow.js";
import { createMemoryStoryWorkAssignmentRepository } from "./memory-story-work-assignment-repository.js";
import { createMemoryStoryWorkAttemptRepository } from "./memory-story-work-attempt-repository.js";
import { sceneId } from "./domain.js";
import { BELLWETHER_FIXTURE, BELLWETHER_FIXTURE_PROJECT_ID } from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import type { DomainIdKind } from "./project-repository.js";
import { sceneContentHash } from "./scene-documents.js";
import {
  createSceneStoryWorkGenerationServices,
  type SceneStoryWorkAttemptRequest
} from "./scene-story-work-generation-services.js";
import type { SceneStoryWorkResourceInput } from "./scene-story-work-compiler.js";
import { storyContextFromProjectRecords } from "./story-context.js";
import type { StoryContextProjection } from "./story-context.js";
import {
  createStoryWorkAssignment,
  storyWorkAssignmentId,
  type StoryWorkAssignment
} from "./story-work-assignment.js";

const OWNER = accountId("account-scene-generation");
const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-scene-generation");
const SOURCE = BELLWETHER_FIXTURE.scenes[0]!.id;
const TARGET = sceneId("scene-generation-reserved-target");
const CREATED_AT = "2026-09-13T18:00:00.000Z";
const SOURCE_HASH = sceneContentHash("d".repeat(64));
const hashPort: AsyncHashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
});

const generatedDraft = Object.freeze({
  schemaId: "scene-draft-v1" as const,
  prose: "Mara opened the salt-stiff letter while the harbor bell counted noon.",
  sourceSceneIds: Object.freeze([SOURCE])
});

async function resourcePairs(
  context: StoryContextProjection,
  workingVersion = 1,
  contentHash = SOURCE_HASH
): Promise<readonly SceneStoryWorkResourceInput[]> {
  const structureText = canonicalJsonStringify(context);
  const structureHash = instructionContentHash(
    await hashPort.digestSha256Hex(structureText)
  );
  const sceneText = "The harbor signal changed as Mara reached the end of the pier.";
  const sceneTextHash = instructionContentHash(
    await hashPort.digestSha256Hex(sceneText)
  );
  return Object.freeze([
    Object.freeze({
      providerText: structureText,
      resource: Object.freeze({
        resourceClass: "story-context" as const,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        scope: context.scope,
        contentHash: structureHash,
        sceneIds: Object.freeze(context.scenes.map((scene) => scene.id)),
        includesProse: false as const,
        inclusionReason: "The writer selected this scene scope.",
        providerTextCharCount: structureText.length,
        providerTextHash: structureHash
      })
    }),
    Object.freeze({
      providerText: sceneText,
      resource: Object.freeze({
        resourceClass: "scene-document" as const,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        sceneId: SOURCE,
        workingVersion,
        contentHash,
        fullTextCharCount: sceneText.length,
        truncated: false,
        inclusionReason: "The writer selected this scene prose.",
        providerTextCharCount: sceneText.length,
        providerTextHash: sceneTextHash
      })
    })
  ]);
}

async function createHarness(
  failAfter?: "begin-run" | "complete-proposal" | "finish-run",
  assignmentOverrides: Partial<StoryWorkAssignment> = {}
) {
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
    id: ASSIGNMENT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "scene",
    brief: "  Draft the harbor confrontation. Keep this spacing.  ",
    constraints: "  Close third person. Do not resolve the letters.  ",
    doneWhen: "  Mara makes one irreversible choice.  ",
    sources: [
      {
        kind: "scene",
        sceneId: SOURCE,
        projectVersion: BELLWETHER_FIXTURE.project.version,
        workingVersion: 1,
        contentHash: SOURCE_HASH
      }
    ],
    destination: { kind: "scene", sceneId: TARGET, operation: "create" },
    provider: "openai",
    model: "gpt-4.1",
    status: "brief-ready",
    steps: [{ id: "draft", title: "Develop scene", dependencies: [] }],
    results: [],
    idempotencyKey: "assignment-scene-generation",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...assignmentOverrides
  });
  await assignments.create({
    assignment,
    requestFingerprint: instructionContentHash("a".repeat(64))
  });
  let id = 0;
  const ids = {
    create(kind: DomainIdKind) {
      id += 1;
      return `${kind}-scene-generation-${id}`;
    }
  };
  let tick = 0;
  const clock = {
    now() {
      tick += 1;
      return `2026-09-13T18:00:${String(tick).padStart(2, "0")}.000Z`;
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
  const generation = createMemorySceneStoryWorkGenerationUnitOfWork({
    projects,
    assignments,
    attempts,
    receipts,
    runs,
    proposals,
    ...(failAfter === undefined ? {} : { failAfter })
  });
  const services = createSceneStoryWorkGenerationServices({
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
    scope: { kind: "scene", sceneId: SOURCE }
  });
  const request: Omit<SceneStoryWorkAttemptRequest, "provider"> = {
    accountId: OWNER,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    assignmentId: ASSIGNMENT_ID,
    expectedAssignmentVersion: assignment.version,
    kind: "initial",
    sourceMode: "submitted-snapshot",
    instruction: assignment.brief,
    idempotencyKey: "attempt-scene-generation",
    storyContext,
    resources: await resourcePairs(storyContext)
  };
  return {
    assignments,
    attempts,
    receipts,
    runs,
    proposals,
    services,
    assignment,
    request,
    storyContext
  };
}

describe("scene story work generation lifecycle", () => {
  it("publishes the reserved scene artifact atomically and replays before provider work", async () => {
    const harness = await createHarness();
    let calls = 0;
    const provider = {
      async completeStructured() {
        calls += 1;
        return {
          ok: true as const,
          output: generatedDraft,
          providerResponseId: "response-scene-generation"
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
          latestAttemptId: expect.any(String),
          generatedArtifact: { artifactVersion: 1 },
          currentArtifact: { artifactVersion: 1 }
        },
        attempt: {
          kind: "initial",
          sourceMode: "submitted-snapshot",
          version: 2,
          resultArtifact: { artifactVersion: 1 }
        },
        run: { workflowId: "story-work.scene", status: "ready" },
        proposal: {
          outputSchemaId: "scene-draft-v1",
          primaryTarget: { kind: "scene", id: TARGET }
        }
      }
    });
    const replay = await harness.services.generate({ ...harness.request, provider });
    expect(replay).toMatchObject({ kind: "replayed", state: { replayed: true } });
    expect(calls).toBe(1);
  });

  it("starts an explicit revision from the exact current artifact with latest sources", async () => {
    const harness = await createHarness();
    const provider = {
      async completeStructured() {
        return { ok: true as const, output: generatedDraft };
      }
    };
    const first = await harness.services.generate({ ...harness.request, provider });
    if (first.kind !== "ready") throw new Error("Expected initial scene artifact.");
    const priorArtifact = first.state.assignment.currentArtifact;
    if (priorArtifact === undefined) throw new Error("Expected current scene artifact.");
    const revisionInstruction = "  Keep the choice, but sharpen the last exchange.  ";
    const revision = await harness.services.generate({
      ...harness.request,
      expectedAssignmentVersion: first.state.assignment.version,
      kind: "revision",
      sourceMode: "latest-authorized",
      instruction: revisionInstruction,
      priorArtifact,
      idempotencyKey: "attempt-scene-revision",
      resources: await resourcePairs(
        harness.storyContext,
        2,
        sceneContentHash("e".repeat(64))
      ),
      provider
    });
    expect(revision).toMatchObject({
      kind: "ready",
      state: {
        assignment: {
          status: "artifact-ready",
          version: 5,
          generatedArtifact: { artifactVersion: 2 },
          currentArtifact: { artifactVersion: 2 }
        },
        attempt: {
          kind: "revision",
          sourceMode: "latest-authorized",
          instruction: revisionInstruction,
          priorArtifact,
          resultArtifact: { artifactVersion: 2 }
        }
      }
    });
  });

  it("records one provider timeout without retrying", async () => {
    const harness = await createHarness();
    let calls = 0;
    const failed = await harness.services.generate({
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
    expect(failed).toMatchObject({
      kind: "failed",
      state: {
        assignment: { status: "failed", version: 3 },
        attempt: { version: 1 },
        run: { status: "failed", terminalDiagnosticCode: "provider-timeout" }
      }
    });
    if (failed.kind !== "failed") throw new Error("Expected failed scene work.");
    expect(failed.state.attempt.resultArtifact).toBeUndefined();
    expect(calls).toBe(1);
  });

  it("accepts the revise/update assignment pair and retains its existing scene target", async () => {
    const harness = await createHarness(undefined, {
      taskKind: "revise",
      destination: { kind: "scene", sceneId: SOURCE, operation: "update" }
    });
    const result = await harness.services.generate({
      ...harness.request,
      provider: {
        async completeStructured() {
          return { ok: true as const, output: generatedDraft };
        }
      }
    });
    expect(result).toMatchObject({
      kind: "ready",
      state: {
        proposal: { primaryTarget: { kind: "scene", id: SOURCE } },
        assignment: {
          destination: { kind: "scene", sceneId: SOURCE, operation: "update" }
        }
      }
    });
  });

  it("rolls back every ready artifact record when atomic completion fails", async () => {
    const harness = await createHarness("finish-run");
    await expect(
      harness.services.generate({
        ...harness.request,
        provider: {
          async completeStructured() {
            return { ok: true as const, output: generatedDraft };
          }
        }
      })
    ).rejects.toThrow(/injected scene generation failure/i);
    await expect(
      harness.proposals.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)
    ).resolves.toEqual([]);
    await expect(
      harness.assignments.get({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID
      })
    ).resolves.toMatchObject({ status: "running", version: 2 });
    await expect(
      harness.attempts.listByAssignment({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        assignmentId: ASSIGNMENT_ID
      })
    ).resolves.toMatchObject([{ version: 1 }]);
  });

  it("refuses mismatched task and destination pairs before provider work", async () => {
    const harness = await createHarness(undefined, {
      taskKind: "scene",
      destination: { kind: "scene", sceneId: TARGET, operation: "update" }
    });
    let calls = 0;
    await expect(
      harness.services.generate({
        ...harness.request,
        provider: {
          async completeStructured() {
            calls += 1;
            return { ok: true as const, output: generatedDraft };
          }
        }
      })
    ).rejects.toThrow(/reserved create or update destination/i);
    expect(calls).toBe(0);
    await expect(
      harness.receipts.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)
    ).resolves.toEqual([]);
  });

  it("requires the initial attempt to retain the exact original brief", async () => {
    const harness = await createHarness();
    let calls = 0;
    await expect(
      harness.services.generate({
        ...harness.request,
        instruction: `${harness.assignment.brief} `,
        provider: {
          async completeStructured() {
            calls += 1;
            return { ok: true as const, output: generatedDraft };
          }
        }
      })
    ).rejects.toThrow(/exact submitted brief/i);
    expect(calls).toBe(0);
    await expect(
      harness.receipts.listByProject(BELLWETHER_FIXTURE_PROJECT_ID)
    ).resolves.toEqual([]);
  });
});
