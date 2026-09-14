import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AgentModelId } from "./agent-context-receipt.js";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import { instructionContentHash, type AsyncHashPort } from "./agent-domain.js";
import { createReadyAgentProposal } from "./agent-runs-proposals.js";
import { captureContentHash } from "./capture-documents.js";
import {
  agentProposalId,
  agentRunId,
  captureId,
  contextReceiptId,
  projectId,
  sceneId
} from "./domain.js";
import { accountId } from "./identity.js";
import { sceneContentHash } from "./scene-documents.js";
import {
  compileSceneStoryWork,
  completeSceneStoryWork,
  type CompileSceneStoryWorkInput,
  type SceneStoryWorkResourceInput
} from "./scene-story-work-compiler.js";
import type { StoryContextProjection } from "./story-context.js";
import {
  createStoryWorkAssignment,
  storyWorkAssignmentId,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment
} from "./story-work-assignment.js";
import { createStoryWorkAttempt, type StoryWorkAttempt } from "./story-work-attempt.js";

const hashPort: AsyncHashPort = {
  async digestSha256Hex(value) {
    return createHash("sha256").update(value).digest("hex");
  }
};
const PROJECT = projectId("project-scene-work");
const OWNER = accountId("account-scene-work");
const RUN = agentRunId("run-scene-work");
const TARGET = sceneId("scene-reserved-destination");
const SOURCE = sceneId("scene-source");
const CAPTURE = captureId("capture-source");
const SUBMITTED_SCENE_HASH = sceneContentHash("a".repeat(64));
const SUBMITTED_CAPTURE_HASH = captureContentHash("c".repeat(64));
const NOW = "2026-09-13T01:00:00.000Z";

const generatedDraft = Object.freeze({
  schemaId: "scene-draft-v1" as const,
  prose: "  Rain marked the harbor glass.\nMara opened the letter.  ",
  sourceSceneIds: Object.freeze([SOURCE])
});

function assignment(
  overrides: Partial<StoryWorkAssignment> = {},
  includeCapture = false
): StoryWorkAssignment {
  return createStoryWorkAssignment({
    id: storyWorkAssignmentId("assignment-scene-work"),
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 2,
    taskKind: "scene",
    brief: "  Draft the harbor confrontation.\nKeep Mara undecided.  ",
    constraints: "  Close third person. No prophecy.  ",
    doneWhen: "  The choice lands without resolving the larger thread.  ",
    sources: [
      { kind: "project", projectId: PROJECT, projectVersion: 5 },
      {
        kind: "scene",
        sceneId: SOURCE,
        projectVersion: 5,
        workingVersion: 3,
        contentHash: SUBMITTED_SCENE_HASH
      },
      ...(includeCapture
        ? [{
            kind: "capture" as const,
            captureId: CAPTURE,
            workingVersion: 2,
            contentHash: SUBMITTED_CAPTURE_HASH
          }]
        : [])
    ],
    destination: { kind: "scene", sceneId: TARGET, operation: "create" },
    provider: "openai",
    model: "gpt-4.1" as AgentModelId,
    status: "running",
    steps: [{ id: "draft", title: "Develop scene", dependencies: [] }],
    activeAttemptId: RUN,
    latestAttemptId: RUN,
    results: [],
    idempotencyKey: "submit-scene-work",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  });
}

function attempt(
  current: StoryWorkAssignment,
  overrides: Partial<StoryWorkAttempt> = {}
): StoryWorkAttempt {
  return createStoryWorkAttempt({
    assignmentId: current.id,
    projectId: current.projectId,
    initiatorAccountId: current.initiatorAccountId,
    runId: RUN,
    version: 1,
    kind: "initial",
    sourceMode: "submitted-snapshot",
    instruction: current.brief,
    idempotencyKey: "scene-attempt-request",
    requestFingerprint: instructionContentHash("d".repeat(64)),
    createdAt: NOW,
    ...overrides
  });
}

function storyContext(projectVersion = 5, source = SOURCE): StoryContextProjection {
  return Object.freeze({
    projectId: PROJECT,
    projectVersion,
    scope: Object.freeze({ kind: "project" as const }),
    totalCanonicalSceneCount: 1,
    scenes: Object.freeze([
      Object.freeze({
        id: source,
        title: "The Harbor Choice",
        status: "drafting" as const,
        book: Object.freeze({ id: "book-one" as never, title: "Harbor Book" }),
        placement: "unassigned" as const,
        canonicalIndex: 0,
        archival: Object.freeze({
          projectArchived: false,
          bookArchived: false,
          sceneArchived: false
        }),
        intent: Object.freeze({
          purpose: "Force Mara to choose between family and duty.",
          turn: "She opens the letter instead of burning it."
        }),
        threadAssociationIds: Object.freeze([]),
        narrativeBeats: Object.freeze([])
      })
    ]),
    threads: Object.freeze([])
  });
}

async function resources(input: Readonly<{
  context?: StoryContextProjection;
  scene?: typeof SOURCE;
  sceneWorkingVersion?: number;
  sceneHash?: typeof SUBMITTED_SCENE_HASH;
  includeCapture?: boolean;
  captureWorkingVersion?: number;
  captureHash?: typeof SUBMITTED_CAPTURE_HASH;
}> = {}): Promise<readonly SceneStoryWorkResourceInput[]> {
  const context = input.context ?? storyContext();
  const source = input.scene ?? SOURCE;
  const sceneWorkingVersion = input.sceneWorkingVersion ?? 3;
  const sceneHash = input.sceneHash ?? SUBMITTED_SCENE_HASH;
  const structureText = canonicalJsonStringify(context);
  const structureHash = instructionContentHash(
    await hashPort.digestSha256Hex(structureText)
  );
  const sceneText = "Mara knots the line, then lets the navy ship pass.";
  const sceneTextHash = instructionContentHash(
    await hashPort.digestSha256Hex(sceneText)
  );
  const result: SceneStoryWorkResourceInput[] = [
    Object.freeze({
      providerText: structureText,
      resource: Object.freeze({
        resourceClass: "story-context" as const,
        projectId: PROJECT,
        scope: context.scope,
        contentHash: structureHash,
        sceneIds: Object.freeze(context.scenes.map((item) => item.id)),
        includesProse: false as const,
        inclusionReason: "Selected story scope",
        providerTextCharCount: structureText.length,
        providerTextHash: structureHash
      })
    }),
    Object.freeze({
      providerText: sceneText,
      resource: Object.freeze({
        resourceClass: "scene-document" as const,
        projectId: PROJECT,
        sceneId: source,
        workingVersion: sceneWorkingVersion,
        contentHash: sceneHash,
        fullTextCharCount: sceneText.length,
        truncated: false,
        inclusionReason: "Selected source scene",
        providerTextCharCount: sceneText.length,
        providerTextHash: sceneTextHash
      })
    })
  ];
  if (input.includeCapture) {
    const captureText = "A voice memo: keep the foghorn as the scene clock.";
    const captureTextHash = instructionContentHash(
      await hashPort.digestSha256Hex(captureText)
    );
    result.push(Object.freeze({
      providerText: captureText,
      resource: Object.freeze({
        resourceClass: "capture" as const,
        captureId: CAPTURE,
        workingVersion: input.captureWorkingVersion ?? 2,
        contentHash: input.captureHash ?? SUBMITTED_CAPTURE_HASH,
        inclusionReason: "Selected Scene Partner Capture",
        providerTextCharCount: captureText.length,
        providerTextHash: captureTextHash
      })
    }));
  }
  return Object.freeze(result);
}

async function compileInput(
  overrides: Partial<CompileSceneStoryWorkInput> = {}
) {
  const current = assignment();
  const context = storyContext();
  return compileSceneStoryWork({
    receiptId: contextReceiptId("receipt-scene-work"),
    createdAt: NOW,
    assignment: current,
    attempt: attempt(current),
    storyContext: context,
    resources: await resources({ context }),
    hashPort,
    ...overrides
  });
}

describe("scene story work compiler", () => {
  it("preserves the exact brief and CP1a context while fixing the destination outside output", async () => {
    const current = assignment();
    const context = storyContext();
    const compiled = await compileInput({
      assignment: current,
      attempt: attempt(current),
      storyContext: context,
      resources: await resources({ context })
    });

    expect(compiled.inputText).toContain(current.brief);
    expect(compiled.inputText).toContain(current.constraints);
    expect(compiled.inputText).toContain(current.doneWhen);
    expect(compiled.inputText).toContain("Force Mara to choose between family and duty.");
    expect(compiled.inputText).toContain("She opens the letter instead of burning it.");
    expect(compiled).toMatchObject({
      workflow: "story-work.scene",
      provider: "openai",
      model: "gpt-4.1",
      toolCount: 0,
      outputSchema: { name: "scene_draft_v1" },
      receipt: {
        projectId: PROJECT,
        workflowId: "story-work.scene",
        outputSchemaId: "scene-draft-v1",
        primaryTarget: { kind: "scene", id: TARGET },
        targetSceneId: TARGET
      }
    });
    expect(compiled.receipt.resources).toHaveLength(2);
    expect(compiled.receipt.excludedContextClasses).not.toContain("manuscript");
    expect(JSON.stringify(compiled.outputSchema.schema)).not.toContain(TARGET);
  });

  it("consumes the optional selected Capture and every selected scene exactly once", async () => {
    const current = assignment({}, true);
    const context = storyContext();
    const exactResources = await resources({ context, includeCapture: true });
    await expect(compileInput({
      assignment: current,
      attempt: attempt(current),
      storyContext: context,
      resources: exactResources
    })).resolves.toMatchObject({ receipt: { resources: expect.any(Array) } });

    await expect(compileInput({
      assignment: current,
      attempt: attempt(current),
      storyContext: context,
      resources: exactResources.slice(0, 2)
    })).rejects.toThrow(/consume exactly/i);
    await expect(compileInput({
      assignment: current,
      attempt: attempt(current),
      storyContext: context,
      resources: [...exactResources, exactResources[1]!]
    })).rejects.toThrow(/outside the assignment source scope/i);
  });

  it("rejects changed or unauthorized resources on the submitted snapshot", async () => {
    const current = assignment();
    const context = storyContext();
    await expect(compileInput({
      assignment: current,
      attempt: attempt(current),
      storyContext: context,
      resources: await resources({
        context,
        sceneWorkingVersion: 4,
        sceneHash: sceneContentHash("e".repeat(64))
      })
    })).rejects.toThrow(/submitted assignment revision/i);

    const foreignContext = storyContext(5, sceneId("scene-foreign"));
    await expect(compileInput({
      assignment: current,
      attempt: attempt(current),
      storyContext: foreignContext,
      resources: await resources({
        context: foreignContext,
        scene: sceneId("scene-foreign") as typeof SOURCE
      })
    })).rejects.toThrow(/outside the assignment source scope/i);

    const tampered = [...await resources({ context })];
    tampered[1] = Object.freeze({
      ...tampered[1]!,
      providerText: `X${tampered[1]!.providerText.slice(1)}`
    });
    await expect(compileInput({ resources: tampered })).rejects.toThrow(/hash/i);
  });

  it("refreshes only the same authorized IDs for an explicit revision", async () => {
    const pointer: StoryWorkArtifactPointer = {
      proposalId: agentProposalId("proposal-scene-prior"),
      artifactVersion: 1,
      contentHash: instructionContentHash("b".repeat(64))
    };
    const current = assignment({
      taskKind: "revise",
      destination: { kind: "scene", sceneId: TARGET, operation: "update" },
      currentArtifact: pointer,
      generatedArtifact: pointer
    }, true);
    const revisionInstruction = "  Keep the choice; sharpen the last exchange.  ";
    const revisionAttempt = attempt(current, {
      kind: "revision",
      sourceMode: "latest-authorized",
      instruction: revisionInstruction,
      priorArtifact: pointer
    });
    const proposal = createReadyAgentProposal({
      id: pointer.proposalId,
      projectId: PROJECT,
      runId: agentRunId("run-scene-prior"),
      receiptId: contextReceiptId("receipt-scene-prior"),
      status: "ready",
      outputSchemaId: "scene-draft-v1",
      payload: generatedDraft,
      contentHash: pointer.contentHash,
      primaryTarget: { kind: "scene", id: TARGET },
      createdAt: NOW,
      updatedAt: NOW
    });
    const latestContext = storyContext(6);
    const latestResources = await resources({
      context: latestContext,
      sceneWorkingVersion: 4,
      sceneHash: sceneContentHash("f".repeat(64)),
      includeCapture: true,
      captureWorkingVersion: 3,
      captureHash: captureContentHash("8".repeat(64))
    });
    const compiled = await compileInput({
      assignment: current,
      attempt: revisionAttempt,
      storyContext: latestContext,
      resources: latestResources,
      priorArtifact: { proposal, payload: generatedDraft }
    });

    expect(compiled.inputText).toContain(revisionInstruction);
    expect(compiled.inputText).toContain(canonicalJsonStringify(generatedDraft));
    expect(compiled.receipt.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceClass: "scene-document",
        sceneId: SOURCE,
        workingVersion: 4
      }),
      expect.objectContaining({
        resourceClass: "capture",
        captureId: CAPTURE,
        workingVersion: 3
      })
    ]));
    expect(current.sources).toContainEqual(expect.objectContaining({
      kind: "scene",
      sceneId: SOURCE,
      workingVersion: 3,
      contentHash: SUBMITTED_SCENE_HASH
    }));

    const foreignContext = storyContext(6, sceneId("scene-new-scope"));
    await expect(compileInput({
      assignment: current,
      attempt: revisionAttempt,
      storyContext: foreignContext,
      resources: await resources({
        context: foreignContext,
        scene: sceneId("scene-new-scope") as typeof SOURCE,
        sceneWorkingVersion: 1,
        sceneHash: sceneContentHash("9".repeat(64)),
        includeCapture: true,
        captureWorkingVersion: 3,
        captureHash: captureContentHash("8".repeat(64))
      }),
      priorArtifact: { proposal, payload: generatedDraft }
    })).rejects.toThrow(/outside the assignment source scope/i);
  });

  it("requires the task kind to agree with the reserved create or update destination", async () => {
    const wrong = assignment({
      taskKind: "scene",
      destination: { kind: "scene", sceneId: TARGET, operation: "update" }
    });
    await expect(compileInput({
      assignment: wrong,
      attempt: attempt(wrong)
    })).rejects.toThrow(/reserved create or update destination/i);

    const tooManySceneSources = assignment({
      sources: [
        { kind: "project", projectId: PROJECT, projectVersion: 5 },
        ...Array.from({ length: 33 }, (_, index) => ({
          kind: "scene" as const,
          sceneId: sceneId(`scene-source-${index}`),
          projectVersion: 5,
          workingVersion: 1,
          contentHash: sceneContentHash("a".repeat(64))
        }))
      ]
    });
    await expect(compileInput({
      assignment: tooManySceneSources,
      attempt: attempt(tooManySceneSources)
    })).rejects.toThrow(/at most 32 selected scene sources/i);
  });
});

describe("scene story work completion bridge", () => {
  it("accepts only bounded prose with the exact selected source scene IDs", async () => {
    const compiled = await compileInput();
    let calls = 0;
    const ready = await completeSceneStoryWork({
      compiled,
      provider: {
        async completeStructured(input) {
          calls += 1;
          expect(input.workflow).toBe("story-work.scene");
          expect(input.outputSchema.name).toBe("scene_draft_v1");
          expect(input.validateOutput(generatedDraft)).toBe(true);
          return { ok: true, output: generatedDraft };
        }
      }
    });
    expect(calls).toBe(1);
    expect(ready).toEqual({ kind: "ready", artifact: generatedDraft });

    await expect(completeSceneStoryWork({
      compiled,
      provider: {
        async completeStructured() {
          return {
            ok: true,
            output: {
              ...generatedDraft,
              sourceSceneIds: [sceneId("scene-model-invented")]
            }
          };
        }
      }
    })).resolves.toEqual({
      kind: "failed",
      diagnostic: { code: "invalid_structured_output", retryable: false }
    });
  });
});
