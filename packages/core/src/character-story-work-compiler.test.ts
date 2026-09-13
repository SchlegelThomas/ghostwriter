import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AgentModelId } from "./agent-context-receipt.js";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import { instructionContentHash, type AsyncHashPort } from "./agent-domain.js";
import { createReadyAgentProposal } from "./agent-runs-proposals.js";
import {
  compileCharacterStoryWork,
  completeCharacterStoryWork,
  type CharacterStoryWorkResourceInput,
  type CompileCharacterStoryWorkInput
} from "./character-story-work-compiler.js";
import {
  agentProposalId,
  agentRunId,
  chapterId,
  contextReceiptId,
  projectId,
  sceneId,
  storyKnowledgeId
} from "./domain.js";
import { accountId } from "./identity.js";
import { sceneContentHash } from "./scene-documents.js";
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
const PROJECT = projectId("project-character-work");
const OWNER = accountId("account-character-work");
const RUN = agentRunId("run-character-work");
const TARGET = storyKnowledgeId("knowledge-reserved-character");
const SCENE = sceneId("scene-character-source");
const NOW = "2026-09-12T21:00:00.000Z";

const generatedCharacter = Object.freeze({
  schemaId: "character-create-v2" as const,
  name: "Mara Vale",
  summary: "A harbor pilot caught between family and truth.",
  aliases: Object.freeze(["Mara"]),
  characterSheet: Object.freeze({
    desire: "Protect the harbor families.",
    pressure: "Her brother betrayed their route.",
    voiceNotes: "Nautical precision; jokes when frightened."
  }),
  sourceSceneIds: Object.freeze([SCENE])
});

function assignment(
  overrides: Partial<StoryWorkAssignment> = {}
): StoryWorkAssignment {
  return createStoryWorkAssignment({
    id: storyWorkAssignmentId("assignment-character-work"),
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 2,
    taskKind: "character",
    brief: "  Keep this exact brief.\nSecond line with `code`.  ",
    constraints: "  No prophecy; keep the uncertainty.  ",
    doneWhen: "  A complete character is ready for my review.  ",
    sources: [
      { kind: "project", projectId: PROJECT, projectVersion: 5 },
      {
        kind: "scene",
        sceneId: SCENE,
        projectVersion: 5,
        workingVersion: 3,
        contentHash: sceneContentHash("a".repeat(64))
      }
    ],
    destination: {
      kind: "story-knowledge",
      storyKnowledgeId: TARGET,
      operation: "create"
    },
    provider: "openai",
    model: "gpt-4.1" as AgentModelId,
    status: "running",
    steps: [{ id: "character", title: "Develop character", dependencies: [] }],
    activeAttemptId: RUN,
    results: [],
    idempotencyKey: "submit-character-work",
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
    idempotencyKey: "character-attempt-request",
    requestFingerprint: instructionContentHash("c".repeat(64)),
    createdAt: NOW,
    ...overrides
  });
}

function storyContext(
  project = PROJECT,
  selectedScene = SCENE,
  projectVersion = 5
): StoryContextProjection {
  return Object.freeze({
    projectId: project,
    projectVersion,
    scope: Object.freeze({ kind: "project" as const }),
    totalCanonicalSceneCount: 1,
    scenes: Object.freeze([
      Object.freeze({
        id: selectedScene,
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
        intent: Object.freeze({ purpose: "Force Mara to choose." }),
        threadAssociationIds: Object.freeze([]),
        narrativeBeats: Object.freeze([])
      })
    ]),
    threads: Object.freeze([])
  });
}

async function resources(
  context = storyContext(),
  scene = SCENE,
  workingVersion = 3,
  contentHash = sceneContentHash("a".repeat(64))
): Promise<readonly CharacterStoryWorkResourceInput[]> {
  const structureText = canonicalJsonStringify(context);
  const structureHash = instructionContentHash(
    await hashPort.digestSha256Hex(structureText)
  );
  const sceneText = "Mara knots the line, then lets the navy ship pass.";
  const sceneTextHash = instructionContentHash(
    await hashPort.digestSha256Hex(sceneText)
  );
  return Object.freeze([
    Object.freeze({
      providerText: structureText,
      resource: Object.freeze({
        resourceClass: "story-context" as const,
        projectId: context.projectId,
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
        projectId: context.projectId,
        sceneId: scene,
        workingVersion,
        contentHash,
        fullTextCharCount: sceneText.length,
        truncated: false,
        inclusionReason: "Character source scene",
        providerTextCharCount: sceneText.length,
        providerTextHash: sceneTextHash
      })
    })
  ]);
}

async function compileInput(
  overrides: Partial<CompileCharacterStoryWorkInput> = {}
) {
  const current = assignment();
  const context = storyContext();
  return compileCharacterStoryWork({
    receiptId: contextReceiptId("receipt-character-work"),
    createdAt: NOW,
    assignment: current,
    attempt: attempt(current),
    storyContext: context,
    resources: await resources(context),
    hashPort,
    ...overrides
  });
}

describe("character story work compiler", () => {
  it("preserves writer text byte-for-byte and builds an exact scoped receipt", async () => {
    const current = assignment();
    const compiled = await compileInput({ assignment: current, attempt: attempt(current) });

    expect(compiled.inputText).toContain(current.brief);
    expect(compiled.inputText).toContain(current.constraints);
    expect(compiled.inputText).toContain(current.doneWhen);
    expect(compiled).toMatchObject({
      workflow: "story-work.character",
      provider: "openai",
      model: "gpt-4.1",
      toolCount: 0,
      outputSchema: { name: "character_create_v2" },
      receipt: {
        projectId: PROJECT,
        workflowId: "story-work.character",
        outputSchemaId: "character-create-v2",
        primaryTarget: { kind: "story-knowledge", id: TARGET },
        targetStoryKnowledgeId: TARGET
      }
    });
    expect(compiled.receipt.excludedContextClasses).not.toContain("manuscript");
    expect(compiled.receipt.resources).toHaveLength(2);
  });

  it("preserves exact revision instruction and verifies the current prior proposal", async () => {
    const pointer: StoryWorkArtifactPointer = {
      proposalId: agentProposalId("proposal-character-prior"),
      artifactVersion: 1,
      contentHash: instructionContentHash("b".repeat(64))
    };
    const current = assignment({ currentArtifact: pointer, generatedArtifact: pointer });
    const revisionInstruction = "  Keep the same history.\nMake her voice less certain.  ";
    const revisionAttempt = attempt(current, {
      kind: "revision",
      sourceMode: "latest-authorized",
      instruction: revisionInstruction,
      priorArtifact: pointer
    });
    const proposal = createReadyAgentProposal({
      id: pointer.proposalId,
      projectId: PROJECT,
      runId: agentRunId("run-character-prior"),
      receiptId: contextReceiptId("receipt-character-prior"),
      status: "ready",
      outputSchemaId: "character-create-v2",
      payload: generatedCharacter,
      contentHash: pointer.contentHash,
      primaryTarget: { kind: "story-knowledge", id: TARGET },
      createdAt: NOW,
      updatedAt: NOW
    });
    const compiled = await compileInput({
      assignment: current,
      attempt: revisionAttempt,
      priorArtifact: { proposal, payload: generatedCharacter }
    });

    expect(compiled.inputText).toContain(revisionInstruction);
    expect(compiled.inputText).toContain(canonicalJsonStringify(generatedCharacter));
    await expect(
      compileInput({
        assignment: current,
        attempt: revisionAttempt,
        priorArtifact: {
          proposal,
          payload: { ...generatedCharacter, name: "A replaced payload" }
        }
      })
    ).rejects.toThrow(/does not match its proposal/i);
  });

  it("refreshes only an explicitly revised assignment to current authorized source revisions", async () => {
    const pointer: StoryWorkArtifactPointer = {
      proposalId: agentProposalId("proposal-character-refresh-prior"),
      artifactVersion: 1,
      contentHash: instructionContentHash("b".repeat(64))
    };
    const submittedSceneHash = sceneContentHash("a".repeat(64));
    const current = assignment({
      sources: [
        { kind: "project", projectId: PROJECT, projectVersion: 5 },
        {
          kind: "scene",
          sceneId: SCENE,
          projectVersion: 5,
          workingVersion: 3,
          contentHash: submittedSceneHash
        }
      ],
      currentArtifact: pointer,
      generatedArtifact: pointer
    });
    const latestContext = storyContext(PROJECT, SCENE, 6);
    const latestResources = await resources(
      latestContext,
      SCENE,
      4,
      sceneContentHash("d".repeat(64))
    );
    const proposal = createReadyAgentProposal({
      id: pointer.proposalId,
      projectId: PROJECT,
      runId: agentRunId("run-character-refresh-prior"),
      receiptId: contextReceiptId("receipt-character-refresh-prior"),
      status: "ready",
      outputSchemaId: "character-create-v2",
      payload: generatedCharacter,
      contentHash: pointer.contentHash,
      primaryTarget: { kind: "story-knowledge", id: TARGET },
      createdAt: NOW,
      updatedAt: NOW
    });
    const revisionAttempt = attempt(current, {
      kind: "revision",
      sourceMode: "latest-authorized",
      instruction: "Use the latest saved scene while retaining the original brief.",
      priorArtifact: pointer
    });

    const compiled = await compileInput({
      assignment: current,
      attempt: revisionAttempt,
      storyContext: latestContext,
      resources: latestResources,
      priorArtifact: { proposal, payload: generatedCharacter }
    });
    expect(compiled.receipt.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceClass: "scene-document",
          sceneId: SCENE,
          workingVersion: 4
        })
      ])
    );
    expect(current.sources).toContainEqual(
      expect.objectContaining({
        kind: "scene",
        sceneId: SCENE,
        workingVersion: 3,
        contentHash: submittedSceneHash
      })
    );
    await expect(
      compileInput({
        assignment: current,
        attempt: attempt(current),
        storyContext: latestContext,
        resources: latestResources
      })
    ).rejects.toThrow(/project version does not match/i);
  });

  it("rejects wrong project, scene, character count, and provider-text hash before completion", async () => {
    const current = assignment();
    const context = storyContext();
    await expect(
      compileInput({ storyContext: storyContext(projectId("project-other")) })
    ).rejects.toThrow(/outside the character assignment scope/i);

    await expect(
      compileInput({
        resources: await resources(context, sceneId("scene-not-in-scope"))
      })
    ).rejects.toThrow(/outside the assignment story scope/i);

    const mismatched = [...(await resources(context))];
    mismatched[1] = Object.freeze({
      ...mismatched[1]!,
      providerText: `X${mismatched[1]!.providerText.slice(1)}`
    });
    await expect(compileInput({ resources: mismatched })).rejects.toThrow(/hash/i);

    const structureResource = (await resources(context))[0]!;
    const tooMany = Array.from({ length: 101 }, () => structureResource);
    await expect(compileInput({ resources: tooMany })).rejects.toThrow(/1-100 resources/i);

    const oversizedText = "x".repeat(120_001);
    const oversizedHash = instructionContentHash(
      await hashPort.digestSha256Hex(oversizedText)
    );
    await expect(
      compileInput({
        resources: [
          {
            providerText: oversizedText,
            resource: {
              resourceClass: "story-context",
              projectId: PROJECT,
              scope: context.scope,
              contentHash: oversizedHash,
              sceneIds: [SCENE],
              includesProse: false,
              inclusionReason: "Oversized",
              providerTextCharCount: oversizedText.length,
              providerTextHash: oversizedHash
            }
          }
        ]
      })
    ).rejects.toThrow(/120,000-character/i);
    expect(current.status).toBe("running");
  });

  it("authorizes scene text through the selected chapter scope", async () => {
    const chapter = chapterId("chapter-character-source");
    const base = storyContext();
    const context: StoryContextProjection = Object.freeze({
      ...base,
      scope: Object.freeze({ kind: "chapter" as const, chapterId: chapter }),
      scenes: Object.freeze(
        base.scenes.map((scene) =>
          Object.freeze({
            ...scene,
            chapter: Object.freeze({ id: chapter, title: "Harbor Choices" }),
            placement: "chapter" as const
          })
        )
      )
    });
    const current = assignment({
      sources: [
        { kind: "chapter", chapterId: chapter, projectVersion: 5 },
        {
          kind: "scene",
          sceneId: SCENE,
          projectVersion: 5,
          workingVersion: 3,
          contentHash: sceneContentHash("a".repeat(64))
        }
      ]
    });

    await expect(
      compileInput({
        assignment: current,
        attempt: attempt(current),
        storyContext: context,
        resources: await resources(context)
      })
    ).resolves.toMatchObject({ receipt: { projectId: PROJECT } });
  });
});

describe("character story work provider bridge", () => {
  it("returns one validated typed artifact from one provider invocation", async () => {
    const compiled = await compileInput();
    let calls = 0;
    const result = await completeCharacterStoryWork({
      compiled,
      provider: {
        async completeStructured(input) {
          calls += 1;
          expect(input.workflow).toBe("story-work.character");
          expect(input.outputSchema.name).toBe("character_create_v2");
          return {
            ok: true,
            output: generatedCharacter,
            providerResponseId: "provider-response-character",
            usage: { inputTokens: 100, outputTokens: 80, totalTokens: 180 }
          };
        }
      }
    });

    expect(calls).toBe(1);
    expect(result).toMatchObject({
      kind: "ready",
      artifact: generatedCharacter,
      providerResponseId: "provider-response-character"
    });
  });

  it("returns explicit failure for provider failure, throw, or malformed output without fallback", async () => {
    const compiled = await compileInput();
    await expect(
      completeCharacterStoryWork({
        compiled,
        provider: {
          async completeStructured() {
            return {
              ok: false,
              diagnostic: { code: "upstream_error", retryable: true }
            };
          }
        }
      })
    ).resolves.toEqual({
      kind: "failed",
      diagnostic: { code: "upstream_error", retryable: true }
    });

    await expect(
      completeCharacterStoryWork({
        compiled,
        provider: {
          async completeStructured() {
            return { ok: true, output: { schemaId: "story-knowledge-create-v1" } };
          }
        }
      })
    ).resolves.toEqual({
      kind: "failed",
      diagnostic: { code: "invalid_structured_output", retryable: false }
    });

    await expect(
      completeCharacterStoryWork({
        compiled,
        provider: {
          async completeStructured() {
            throw new Error("provider unavailable");
          }
        }
      })
    ).resolves.toEqual({
      kind: "failed",
      diagnostic: { code: "internal_failure", retryable: false }
    });
  });
});
