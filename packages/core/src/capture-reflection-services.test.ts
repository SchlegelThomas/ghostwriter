import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import type { AsyncHashPort } from "./agent-domain.js";
import { instructionContentHash } from "./agent-domain.js";
import { createAgentFoundationServices } from "./agent-foundation-services.js";
import { createAgentGuidanceServices } from "./agent-guidance-services.js";
import {
  AgentReceiptNotFoundError,
  AgentRunReceiptMismatchError
} from "./agent-runs-proposals.js";
import {
  createCaptureReflectionServices,
  type CaptureReflectionStructuredCompletionProvider
} from "./capture-reflection-services.js";
import {
  CaptureNotFoundError,
  captureContentHash,
  createCaptureDocumentHead,
  createCaptureRevision
} from "./capture-documents.js";
import { captureId, captureRevisionId, contextReceiptId } from "./domain.js";
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
import type { DomainIdKind, IdGenerator } from "./project-repository.js";

const OWNER = accountId("account-reflection-owner");
const STRANGER = accountId("account-reflection-stranger");
const CAPTURE = captureId("capture-reflection");
const CONTENT_HASH = captureContentHash("b".repeat(64));
const NOW = "2026-07-24T22:30:00.000Z";

const reflectionPayload = Object.freeze({
  schemaId: "capture-reflection-v1" as const,
  summary: "A fog signal waiting for a scene.",
  questions: Object.freeze(["Which opening could hold this mood?"]),
  possibleStoryJobs: Object.freeze([
    Object.freeze({
      label: "Harbor cold open",
      rationale: "Places the signal before the first confrontation."
    })
  ])
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
      return `${kind}-reflection-${next}`;
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
    genesisRevisionId: captureRevisionId("capture-rev-reflection-genesis"),
    authorAccountId: OWNER,
    updatedByAccountId: OWNER,
    createdAt: NOW,
    updatedAt: NOW
  });
}

async function seedCapture(
  captureDocuments: ReturnType<typeof createMemoryCaptureDocumentRepository>,
  targetHead = captureHead("Signal in the fog.")
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
  mode: "success" | "failure" = "success"
): CaptureReflectionStructuredCompletionProvider {
  return Object.freeze({
    async completeStructured(input) {
      if (mode === "failure") {
        return Object.freeze({
          ok: false as const,
          diagnostic: Object.freeze({
            code: "upstream_error" as const,
            retryable: true
          })
        });
      }
      if (!input.validateOutput(reflectionPayload)) {
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
        output: reflectionPayload,
        usage: Object.freeze({
          inputTokens: 11,
          outputTokens: 22,
          totalTokens: 33
        }),
        providerResponseId: "fake-resp-reflection"
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
      return `2026-07-24T22:30:0${Math.min(tick, 9)}.000Z`;
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
  const services = createCaptureReflectionServices({
    projects,
    captureDocuments,
    receipts,
    foundation,
    guidance,
    hashPort,
    ids,
    clock
  });
  return { services, captureDocuments, foundation, runs, proposals };
}

describe("capture reflection services", () => {
  it("previews a receipt without calling the provider", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    const receipt = await harness.services.preview({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: CAPTURE
    });
    expect(receipt.workflowId).toBe("scene-partner.capture-reflection");
    expect(receipt.outputSchemaId).toBe("capture-reflection-v1");
    expect(receipt.resources[0]?.captureId).toBe(CAPTURE);
    expect(receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("hides captures from non-owners during preview", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    await expect(
      harness.services.preview({
        accountId: STRANGER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: CAPTURE
      })
    ).rejects.toBeInstanceOf(CaptureNotFoundError);
  });

  it("runs preview → start with a fake provider into a ready proposal", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    const receipt = await harness.services.preview({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: CAPTURE
    });
    const started = await harness.services.start({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      receiptId: receipt.id,
      expectedReceiptHash: receipt.receiptHash,
      provider: createFakeProvider("success")
    });
    expect(started.kind).toBe("ready");
    if (started.kind !== "ready") return;
    expect(started.run.status).toBe("ready");
    expect(started.proposal.status).toBe("ready");
    expect(
      started.proposal.payload.schemaId === "capture-reflection-v1"
        ? started.proposal.payload.summary
        : ""
    ).toContain("fog signal");
    expect(started.run.providerResponseId).toBe("fake-resp-reflection");

    const listed = await harness.services.listProposalSummaries({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(started.proposal.id);

    const rejected = await harness.services.rejectProposal({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      proposalId: started.proposal.id
    });
    expect(rejected.status).toBe("rejected");
  });

  it("maps provider failures onto failed runs", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    const receipt = await harness.services.preview({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: CAPTURE
    });
    const started = await harness.services.start({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      receiptId: receipt.id,
      expectedReceiptHash: receipt.receiptHash,
      provider: createFakeProvider("failure")
    });
    expect(started.kind).toBe("failed");
    if (started.kind !== "failed") return;
    expect(started.run.status).toBe("failed");
    expect(started.run.terminalDiagnosticCode).toBe("provider-unavailable");
  });

  it("rejects mismatched receipt hashes before queueing", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    const receipt = await harness.services.preview({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: CAPTURE
    });
    await expect(
      harness.services.start({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        receiptId: receipt.id,
        expectedReceiptHash: instructionContentHash("c".repeat(64)),
        provider: createFakeProvider("success")
      })
    ).rejects.toBeInstanceOf(AgentRunReceiptMismatchError);
  });

  it("rejects unknown receipts", async () => {
    const harness = createHarness();
    await expect(
      harness.services.start({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        receiptId: contextReceiptId("receipt-missing-reflection"),
        expectedReceiptHash: instructionContentHash("d".repeat(64)),
        provider: createFakeProvider("success")
      })
    ).rejects.toBeInstanceOf(AgentReceiptNotFoundError);
  });
});
