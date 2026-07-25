import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import type { AsyncHashPort } from "./agent-domain.js";
import {
  CHARACTER_COACH_WORKFLOW_ID,
  CraftTargetRequiredError,
  SKETCH_PARTNER_WORKFLOW_ID,
  WORLDKEEPER_WORKFLOW_ID
} from "./agent-domain.js";
import { createAgentFoundationServices } from "./agent-foundation-services.js";
import { createAgentGuidanceServices } from "./agent-guidance-services.js";
import {
  createCraftPartnerServices,
  type CraftPartnerStructuredCompletionProvider
} from "./craft-partner-services.js";
import { createCraftProposalApplyServices } from "./craft-proposal-apply-services.js";
import {
  CaptureNotFoundError,
  captureContentHash,
  createCaptureDocumentHead,
  createCaptureRevision
} from "./capture-documents.js";
import {
  captureId,
  captureRevisionId,
  sceneId,
  storyKnowledgeId
} from "./domain.js";
import { accountId, createProjectMembership } from "./identity.js";
import {
  createMemoryAccountAiCollaborationProfileRepository,
  createMemoryProjectAgentInstructionsRepository,
  createMemoryProjectPlaybookRepository
} from "./memory-agent-guidance-repository.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunReflectionCompletionUnitOfWork } from "./memory-agent-run-completion-uow.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import { createMemoryCaptureDocumentRepository } from "./memory-capture-document-repository.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { BELLWETHER_FIXTURE, BELLWETHER_FIXTURE_PROJECT_ID } from "./fixtures.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createProjectCommandServices } from "./project-commands.js";
import type { DomainIdKind, IdGenerator } from "./project-repository.js";

const OWNER = accountId("account-craft-owner");
const CAPTURE = captureId("capture-craft");
const SCENE = sceneId("scene-arrival-at-bellwether");
const CHARACTER = storyKnowledgeId("knowledge-mara-venn");
const CONTENT_HASH = captureContentHash("a".repeat(64));
const NOW = "2026-07-24T23:00:00.000Z";

const sketchPayload = Object.freeze({
  schemaId: "sketch-fields-v1" as const,
  purpose: "Force Mara to answer before the tide turns.",
  conflict: "The keeper's log contradicts the forecast.",
  turn: "She cannot leave the harbor unchanged."
});

const characterPayload = Object.freeze({
  schemaId: "character-sheet-v1" as const,
  storyKnowledgeId: CHARACTER,
  desire: "Protect the truth in the log.",
  pressure: "The island wants her silence.",
  voiceNotes: "Practical, clipped, weather-aware."
});

const backdropPayload = Object.freeze({
  schemaId: "backdrop-fields-v1" as const,
  sceneId: SCENE,
  caption: "Fog presses the pier until the boards creak.",
  sensoryNotesFallback: "Salt-wet rope and cold metal rails."
});

function createTestHashPort(): AsyncHashPort {
  const cache = new Map<string, string>();
  return Object.freeze({
    async digestSha256Hex(canonicalUtf8: string): Promise<string> {
      const cached = cache.get(canonicalUtf8);
      if (cached !== undefined) return cached;
      let hash = 0n;
      for (let index = 0; index < canonicalUtf8.length; index += 1) {
        hash = (hash * 131n + BigInt(canonicalUtf8.charCodeAt(index))) & ((1n << 256n) - 1n);
      }
      const digest = hash.toString(16).padStart(64, "0");
      cache.set(canonicalUtf8, digest);
      return digest;
    }
  });
}

function createSequenceIds(): IdGenerator {
  const counters = new Map<DomainIdKind, number>();
  return {
    create(kind) {
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      return `${kind}-craft-${next}`;
    }
  };
}

function captureHead(body: string, workingVersion = 2) {
  return createCaptureDocumentHead({
    captureId: CAPTURE,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    status: "ready",
    sourceModality: "text",
    workingVersion,
    document: validateSceneDocumentV1({
      schemaVersion: 1,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "block-1" },
            content: [{ type: "text", text: body }]
          }
        ]
      }
    }),
    contentHash: CONTENT_HASH,
    genesisRevisionId: captureRevisionId("capture-rev-craft-genesis"),
    authorAccountId: OWNER,
    updatedByAccountId: OWNER,
    createdAt: NOW,
    updatedAt: NOW
  });
}

async function seedCapture(
  captureDocuments: ReturnType<typeof createMemoryCaptureDocumentRepository>,
  targetHead = captureHead("Fog over the pier.")
) {
  const genesisHead = createCaptureDocumentHead({
    ...targetHead,
    status: "draft",
    workingVersion: 1
  });
  const genesisRevision = createCaptureRevision({
    id: genesisHead.genesisRevisionId,
    captureId: genesisHead.captureId,
    projectId: genesisHead.projectId,
    document: genesisHead.document,
    contentHash: genesisHead.contentHash,
    actorAccountId: genesisHead.authorAccountId,
    origin: "human",
    reason: "genesis",
    createdAt: genesisHead.createdAt
  });
  await captureDocuments.initialize({ head: genesisHead, genesisRevision });
  for (
    let workingVersion = 1;
    workingVersion < targetHead.workingVersion;
    workingVersion += 1
  ) {
    const outcome = await captureDocuments.saveWorkingDocument({
      projectId: targetHead.projectId,
      captureId: targetHead.captureId,
      expectedWorkingVersion: workingVersion,
      document: targetHead.document,
      contentHash: targetHead.contentHash,
      actorAccountId: targetHead.authorAccountId,
      now: targetHead.updatedAt
    });
    if (!outcome.ok) {
      throw new Error("Failed to seed capture working version.");
    }
  }
  return targetHead;
}

function createFakeProvider(
  payload: typeof sketchPayload | typeof characterPayload | typeof backdropPayload
): CraftPartnerStructuredCompletionProvider {
  return Object.freeze({
    async completeStructured(input) {
      if (!input.validateOutput(payload)) {
        return Object.freeze({
          ok: false as const,
          diagnostic: Object.freeze({
            code: "validation_failed" as const,
            retryable: false
          })
        });
      }
      return Object.freeze({
        ok: true as const,
        output: payload,
        usage: Object.freeze({
          inputTokens: 9,
          outputTokens: 18,
          totalTokens: 27
        }),
        providerResponseId: "fake-resp-craft"
      });
    }
  });
}

function createHarness() {
  const receipts = createMemoryContextReceiptRepository();
  const runs = createMemoryAgentRunRepository();
  const proposals = createMemoryAgentProposalRepository();
  const captureDocuments = createMemoryCaptureDocumentRepository();
  const projects = createMemoryProjectRepository(
    [BELLWETHER_FIXTURE],
    [
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: OWNER,
        role: "owner",
        createdAt: NOW
      })
    ]
  );
  let tick = 0;
  const clock = {
    now: () => {
      tick += 1;
      return `2026-07-24T23:00:0${Math.min(tick, 9)}.000Z`;
    }
  };
  const hashPort = createTestHashPort();
  const ids = createSequenceIds();
  const foundation = createAgentFoundationServices({
    projects,
    captureDocuments,
    receipts,
    runs,
    proposals,
    completion: createMemoryAgentRunReflectionCompletionUnitOfWork({ runs, proposals }),
    hashPort,
    clock
  });
  const guidance = createAgentGuidanceServices({
    projects,
    collaborationProfiles: createMemoryAccountAiCollaborationProfileRepository(),
    projectInstructions: createMemoryProjectAgentInstructionsRepository(),
    playbooks: createMemoryProjectPlaybookRepository(),
    hashPort,
    ids,
    clock
  });
  const projectCommands = createProjectCommandServices({ projects, ids, clock });
  const craftApply = createCraftProposalApplyServices({
    projects,
    captureDocuments,
    proposals,
    receipts,
    projectCommands,
    clock
  });
  const services = createCraftPartnerServices({
    projects,
    captureDocuments,
    receipts,
    foundation,
    guidance,
    craftApply,
    hashPort,
    ids,
    clock
  });
  return { services, captureDocuments, projects };
}

describe("craft partner services", () => {
  it("refuses Character Coach preview without a cast target", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    await expect(
      harness.services.preview({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: CAPTURE,
        workflowId: CHARACTER_COACH_WORKFLOW_ID
      })
    ).rejects.toBeInstanceOf(CraftTargetRequiredError);
  });

  it("refuses Sketch Partner preview without a scene target", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    await expect(
      harness.services.preview({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: CAPTURE,
        workflowId: SKETCH_PARTNER_WORKFLOW_ID
      })
    ).rejects.toMatchObject({
      name: "CraftTargetRequiredError",
      targetKind: "scene"
    });
  });

  it("runs Sketch Partner preview → start → apply via scene.update", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    const receipt = await harness.services.preview({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: CAPTURE,
      workflowId: SKETCH_PARTNER_WORKFLOW_ID,
      sceneId: SCENE
    });
    expect(receipt.workflowId).toBe(SKETCH_PARTNER_WORKFLOW_ID);
    expect(receipt.outputSchemaId).toBe("sketch-fields-v1");
    expect(receipt.targetSceneId).toBe(SCENE);

    const started = await harness.services.start({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      receiptId: receipt.id,
      expectedReceiptHash: receipt.receiptHash,
      provider: createFakeProvider(sketchPayload)
    });
    expect(started.kind).toBe("ready");
    if (started.kind !== "ready") return;
    expect(started.proposal.outputSchemaId).toBe("sketch-fields-v1");

    const project = await harness.projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID);
    const applied = await harness.services.applyProposal({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      proposalId: started.proposal.id,
      expectedProposalContentHash: started.proposal.contentHash,
      expectedProjectVersion: project!.version
    });
    expect(applied.mode).toBe("craft-fields");
    expect(applied.proposal.status).toBe("applied");
    const scenes = await harness.projects.listScenes(BELLWETHER_FIXTURE_PROJECT_ID);
    const scene = scenes.find((candidate) => candidate.id === SCENE);
    expect(scene?.sketch?.purpose).toContain("tide");
    expect(scene?.sketch?.conflict).toContain("log");
  });

  it("runs Character Coach apply via storyKnowledge.update", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    const receipt = await harness.services.preview({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: CAPTURE,
      workflowId: CHARACTER_COACH_WORKFLOW_ID,
      storyKnowledgeId: CHARACTER
    });
    const started = await harness.services.start({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      receiptId: receipt.id,
      expectedReceiptHash: receipt.receiptHash,
      provider: createFakeProvider(characterPayload)
    });
    expect(started.kind).toBe("ready");
    if (started.kind !== "ready") return;

    const project = await harness.projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID);
    const applied = await harness.services.applyProposal({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      proposalId: started.proposal.id,
      expectedProposalContentHash: started.proposal.contentHash,
      expectedProjectVersion: project!.version
    });
    const mara = applied.project.storyKnowledge.find(
      (candidate) => candidate.id === CHARACTER
    );
    expect(mara?.characterSheet?.desire).toContain("truth");
    expect(mara?.characterSheet?.voiceNotes).toContain("weather");
  });

  it("runs Worldkeeper apply into sketch sensory notes when no backdrop exists", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    const receipt = await harness.services.preview({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: CAPTURE,
      workflowId: WORLDKEEPER_WORKFLOW_ID,
      sceneId: SCENE
    });
    const started = await harness.services.start({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      receiptId: receipt.id,
      expectedReceiptHash: receipt.receiptHash,
      provider: createFakeProvider(backdropPayload)
    });
    expect(started.kind).toBe("ready");
    if (started.kind !== "ready") return;
    const project = await harness.projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID);
    await harness.services.applyProposal({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      proposalId: started.proposal.id,
      expectedProposalContentHash: started.proposal.contentHash,
      expectedProjectVersion: project!.version
    });
    const scenes = await harness.projects.listScenes(BELLWETHER_FIXTURE_PROJECT_ID);
    const scene = scenes.find((candidate) => candidate.id === SCENE);
    expect(scene?.sketch?.sensoryNotes).toContain("Salt-wet rope");
  });

  it("hides captures from non-owners", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    await expect(
      harness.services.preview({
        accountId: accountId("account-stranger"),
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: CAPTURE,
        workflowId: SKETCH_PARTNER_WORKFLOW_ID,
        sceneId: SCENE
      })
    ).rejects.toBeInstanceOf(CaptureNotFoundError);
  });
});
