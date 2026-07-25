import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import type { AsyncHashPort } from "./agent-domain.js";
import { createCaptureReflectionAssignment } from "./agent-domain.js";
import { createAgentFoundationServices } from "./agent-foundation-services.js";
import { compileCaptureReflectionInstructions } from "./agent-instruction-compiler.js";
import {
  AgentProposalContentMismatchError,
  AgentProposalStateConflictError
} from "./agent-runs-proposals.js";
import {
  captureContentHash,
  createCaptureDocumentHead,
  createCaptureRevision
} from "./capture-documents.js";
import { createCapturePromotionServices } from "./capture-promotion-services.js";
import {
  agentProposalId,
  agentRunId,
  bookId,
  captureId,
  captureRevisionId,
  contextReceiptId,
  sceneId
} from "./domain.js";
import { BELLWETHER_FIXTURE, BELLWETHER_FIXTURE_PROJECT_ID } from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunReflectionCompletionUnitOfWork } from "./memory-agent-run-completion-uow.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import { createMemoryCaptureDocumentRepository } from "./memory-capture-document-repository.js";
import { createMemoryCaptureScenePromotionUnitOfWork } from "./memory-capture-scene-promotion-uow.js";
import { createMemoryCanvasRepository } from "./memory-canvas-repository.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemorySceneDocumentRepository } from "./memory-scene-document-repository.js";
import { createInitialSceneDocumentState } from "./scene-writing-services.js";

const OWNER = accountId("account-apply-owner");
const PROJECT = BELLWETHER_FIXTURE_PROJECT_ID;
const CAPTURE = captureId("capture-apply");
const RECEIPT = contextReceiptId("receipt-apply");
const RUN = agentRunId("run-apply");
const PROPOSAL = agentProposalId("proposal-apply");
const GENESIS_HASH = captureContentHash("a".repeat(64));
const CONTENT_HASH = captureContentHash("b".repeat(64));
const SIGNAL_BOOK = bookId("book-signal-at-bellwether");
const TARGET_SCENE = sceneId("scene-arrival-at-bellwether");
const NOW = "2026-07-24T22:30:00.000Z";
const SESSION = "session-apply";

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

const reflectionPayload = {
  schemaId: "capture-reflection-v1" as const,
  summary: "A harbor note seeking a scene.",
  questions: ["Where does the fog land?"],
  possibleStoryJobs: [{ label: "Cold open", rationale: "Sets weather first." }]
};

function captureHead(body: string) {
  return createCaptureDocumentHead({
    captureId: CAPTURE,
    projectId: PROJECT,
    status: "ready",
    sourceModality: "text",
    workingVersion: 2,
    document: validateSceneDocumentV1({
      schemaVersion: 1,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "block-apply-1" },
            content: [{ type: "text", text: body }]
          }
        ]
      }
    }),
    contentHash: CONTENT_HASH,
    genesisRevisionId: captureRevisionId("capture-rev-apply"),
    authorAccountId: OWNER,
    updatedByAccountId: OWNER,
    createdAt: NOW,
    updatedAt: NOW
  });
}

async function seedCapture(
  captureDocuments: ReturnType<typeof createMemoryCaptureDocumentRepository>,
  targetHead = captureHead("Fog presses the harbor glass.")
) {
  const genesisDocument = validateSceneDocumentV1({
    schemaVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "block-apply-genesis" },
          content: [{ type: "text", text: " " }]
        }
      ]
    }
  });
  const genesisHead = createCaptureDocumentHead({
    ...targetHead,
    status: "draft",
    workingVersion: 1,
    document: genesisDocument,
    contentHash: GENESIS_HASH
  });
  const genesisRevision = createCaptureRevision({
    id: genesisHead.genesisRevisionId,
    captureId: genesisHead.captureId,
    projectId: genesisHead.projectId,
    document: genesisDocument,
    contentHash: GENESIS_HASH,
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

async function createHarness() {
  const captureDocuments = createMemoryCaptureDocumentRepository();
  const projects = createMemoryProjectRepository(
    [BELLWETHER_FIXTURE],
    [
      createProjectMembership({
        projectId: PROJECT,
        accountId: OWNER,
        role: "owner",
        createdAt: NOW
      })
    ]
  );
  const sceneDocuments = createMemorySceneDocumentRepository();
  const canvases = createMemoryCanvasRepository();
  const receipts = createMemoryContextReceiptRepository();
  const runs = createMemoryAgentRunRepository();
  const proposals = createMemoryAgentProposalRepository();
  let tick = 0;
  const clock = {
    now: () => {
      tick += 1;
      return `2026-07-24T22:30:${String(tick).padStart(2, "0")}.000Z`;
    }
  };
  let sequence = 0;
  const ids = {
    create(kind: string) {
      sequence += 1;
      return `${kind}-apply-${sequence}`;
    }
  };
  const hashPort = createTestHashPort();
  const capturePromotions = createCapturePromotionServices({
    projects,
    captureDocuments,
    canvases,
    promotion: createMemoryCaptureScenePromotionUnitOfWork({
      projects,
      sceneDocuments,
      captureDocuments,
      canvases
    }),
    ids,
    clock
  });
  const services = createAgentFoundationServices({
    projects,
    captureDocuments,
    receipts,
    runs,
    proposals,
    completion: createMemoryAgentRunReflectionCompletionUnitOfWork({ runs, proposals }),
    hashPort,
    clock,
    apply: {
      capturePromotions,
      sceneDocuments,
      ids
    }
  });

  const head = await seedCapture(captureDocuments);
  const compiled = await compileCaptureReflectionInstructions({
    projectId: PROJECT,
    receiptId: RECEIPT,
    createdAt: NOW,
    assignment: createCaptureReflectionAssignment({
      workflowId: "scene-partner.capture-reflection",
      captureId: CAPTURE
    }),
    captureHead: head,
    hashPort
  });
  await services.persistPreview({ accountId: OWNER, receipt: compiled.receipt });
  await services.queueRun({
    accountId: OWNER,
    runId: RUN,
    receiptId: RECEIPT,
    expectedReceiptHash: compiled.receipt.receiptHash
  });
  await services.markRunning({
    accountId: OWNER,
    projectId: PROJECT,
    runId: RUN
  });
  const completed = await services.completeReflectionRun({
    accountId: OWNER,
    projectId: PROJECT,
    runId: RUN,
    proposalId: PROPOSAL,
    rawPayload: reflectionPayload,
    baseCaptureId: CAPTURE,
    expectedCaptureWorkingVersion: 2,
    expectedCaptureContentHash: CONTENT_HASH
  });
  if (completed.kind !== "ready") {
    throw new Error("Expected ready proposal.");
  }

  return {
    services,
    sceneDocuments,
    proposal: completed.proposal,
    captureHead: head
  };
}

describe("agent proposal apply services", () => {
  it("applies a ready proposal as a new scene and refuses re-apply", async () => {
    const { services, proposal } = await createHarness();
    const applied = await services.applyProposal({
      accountId: OWNER,
      projectId: PROJECT,
      proposalId: proposal.id,
      expectedProposalContentHash: proposal.contentHash,
      mode: "new-scene",
      title:
        proposal.payload.schemaId === "capture-reflection-v1"
          ? proposal.payload.possibleStoryJobs[0]!.label
          : "Cold open",
      bookId: SIGNAL_BOOK,
      expectedProjectVersion: 1
    });
    expect(applied.mode).toBe("new-scene");
    if (applied.mode !== "new-scene") throw new Error("Expected new-scene.");
    expect(applied.proposal.status).toBe("applied");
    expect(applied.proposal.applied?.actorAccountId).toBe(OWNER);
    expect(applied.promotion.scene.title).toBe("Cold open");
    expect(applied.promotion.captureHead.status).toBe("integrated");
    expect(applied.promotion.captureHead.integratedSceneId).toBe(
      applied.promotion.scene.id
    );

    await expect(
      services.applyProposal({
        accountId: OWNER,
        projectId: PROJECT,
        proposalId: proposal.id,
        expectedProposalContentHash: proposal.contentHash,
        mode: "new-scene",
        title: "Again",
        bookId: SIGNAL_BOOK,
        expectedProjectVersion: 2
      })
    ).rejects.toBeInstanceOf(AgentProposalStateConflictError);
  });

  it("applies as a named variant without changing the working draft", async () => {
    const { services, proposal, sceneDocuments, captureHead } = await createHarness();
    const initial = await createInitialSceneDocumentState({
      projectId: PROJECT,
      sceneId: TARGET_SCENE,
      actorAccountId: OWNER,
      ids: {
        create(kind) {
          return `${kind}-target-1`;
        }
      },
      now: NOW
    });
    const workingBefore = await sceneDocuments.initialize(initial);
    expect(workingBefore.document).not.toEqual(captureHead.document);

    const applied = await services.applyProposal({
      accountId: OWNER,
      projectId: PROJECT,
      proposalId: proposal.id,
      expectedProposalContentHash: proposal.contentHash,
      mode: "named-variant",
      sceneId: TARGET_SCENE,
      variantName: "Capture fog take",
      expectedWorkingVersion: workingBefore.workingVersion,
      sessionId: SESSION
    });
    expect(applied.mode).toBe("named-variant");
    if (applied.mode !== "named-variant") throw new Error("Expected named-variant.");
    expect(applied.proposal.status).toBe("applied");
    expect(applied.head.workingVersion).toBe(workingBefore.workingVersion);
    expect(applied.head.contentHash).toBe(workingBefore.contentHash);
    expect(applied.revision.origin).toBe("agent");
    expect(applied.revision.reason).toBe("named-variant");
    expect(applied.revision.document).toEqual(captureHead.document);
    expect(applied.variant.name).toBe("Capture fog take");
    expect(applied.variant.revisionId).toBe(applied.revision.id);

    const headAfter = await sceneDocuments.getHead(TARGET_SCENE);
    expect(headAfter?.workingVersion).toBe(workingBefore.workingVersion);
    expect(headAfter?.document).toEqual(workingBefore.document);
  });

  it("rejects apply when the proposal content hash is stale", async () => {
    const { services, proposal } = await createHarness();
    await expect(
      services.applyProposal({
        accountId: OWNER,
        projectId: PROJECT,
        proposalId: proposal.id,
        expectedProposalContentHash: "c".repeat(64),
        mode: "new-scene",
        title: "Cold open",
        bookId: SIGNAL_BOOK,
        expectedProjectVersion: 1
      })
    ).rejects.toBeInstanceOf(AgentProposalContentMismatchError);
  });
});
