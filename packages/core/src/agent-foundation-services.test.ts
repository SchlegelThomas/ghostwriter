import { hashSceneDocument, validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import type { AsyncHashPort } from "./agent-domain.js";
import { instructionContentHash } from "./agent-domain.js";
import { createCaptureReflectionAssignment } from "./agent-domain.js";
import { compileCaptureReflectionInstructions } from "./agent-instruction-compiler.js";
import { createAgentFoundationServices } from "./agent-foundation-services.js";
import {
  AgentProposalContentMismatchError,
  AgentProposalNotFoundError,
  AgentProposalStateConflictError,
  AgentReceiptConflictError,
  AgentRunNotFoundError,
  AgentRunReceiptMismatchError,
  AgentRunStateConflictError
} from "./agent-runs-proposals.js";
import {
  captureContentHash,
  createCaptureDocumentHead,
  createCaptureRevision
} from "./capture-documents.js";
import {
  agentProposalId,
  agentRunId,
  captureId,
  captureRevisionId,
  contextReceiptId,
  projectId
} from "./domain.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import {
  createFailingMemoryAgentRunReflectionCompletionUnitOfWork,
  createMemoryAgentRunReflectionCompletionUnitOfWork
} from "./memory-agent-run-completion-uow.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import { createMemoryCaptureDocumentRepository } from "./memory-capture-document-repository.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { BELLWETHER_FIXTURE, BELLWETHER_FIXTURE_PROJECT_ID } from "./fixtures.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";

const OWNER = accountId("account-owner");
const STRANGER = accountId("account-stranger");
const OTHER_PROJECT = projectId("project-other");
const CAPTURE = captureId("capture-foundation");
const RECEIPT = contextReceiptId("receipt-foundation");
const RUN = agentRunId("run-foundation");
const PROPOSAL = agentProposalId("proposal-foundation");
const CONTENT_HASH = captureContentHash("a".repeat(64));
const NOW = "2026-07-24T21:00:00.000Z";

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

function captureHead(body: string, workingVersion = 3, contentHash = CONTENT_HASH) {
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
    contentHash,
    genesisRevisionId: captureRevisionId("capture-rev-genesis"),
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

async function compiledReceipt() {
  const hashPort = createTestHashPort();
  const compiled = await compileCaptureReflectionInstructions({
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    receiptId: RECEIPT,
    createdAt: NOW,
    assignment: createCaptureReflectionAssignment({
      workflowId: "scene-partner.capture-reflection",
      captureId: CAPTURE
    }),
    captureHead: captureHead("Signal in the fog."),
    hashPort
  });
  return { receipt: compiled.receipt, hashPort };
}

function createHarness(options?: {
  completion?: ReturnType<typeof createMemoryAgentRunReflectionCompletionUnitOfWork>;
  now?: () => string;
  runs?: ReturnType<typeof createMemoryAgentRunRepository>;
  proposals?: ReturnType<typeof createMemoryAgentProposalRepository>;
  receipts?: ReturnType<typeof createMemoryContextReceiptRepository>;
  captureDocuments?: ReturnType<typeof createMemoryCaptureDocumentRepository>;
}) {
  const receipts = options?.receipts ?? createMemoryContextReceiptRepository();
  const runs = options?.runs ?? createMemoryAgentRunRepository();
  const proposals = options?.proposals ?? createMemoryAgentProposalRepository();
  const captureDocuments =
    options?.captureDocuments ?? createMemoryCaptureDocumentRepository();
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
      return options?.now?.() ?? `2026-07-24T21:00:0${Math.min(tick, 9)}.000Z`;
    }
  };
  const hashPort = createTestHashPort();
  const completion =
    options?.completion ??
    createMemoryAgentRunReflectionCompletionUnitOfWork({ runs, proposals });
  const services = createAgentFoundationServices({
    projects,
    captureDocuments,
    receipts,
    runs,
    proposals,
    completion,
    hashPort,
    clock
  });
  return { services, receipts, runs, proposals, projects, captureDocuments, hashPort, clock };
}

const reflectionPayload = {
  schemaId: "capture-reflection-v1" as const,
  summary: "Fog-bound signal.",
  questions: ["Which scene could hold this?"],
  possibleStoryJobs: [{ label: "Harbor opening", rationale: "Atmospheric hook." }]
};

async function queuedRun(harness: ReturnType<typeof createHarness>) {
  const { services, captureDocuments } = harness;
  await seedCapture(captureDocuments);
  const { receipt } = await compiledReceipt();
  await services.persistPreview({ accountId: OWNER, receipt });
  return services.queueRun({
    accountId: OWNER,
    runId: RUN,
    receiptId: receipt.id,
    expectedReceiptHash: receipt.receiptHash
  });
}

describe("agent foundation services", () => {
  it("persists receipts immutably and idempotently", async () => {
    const { services } = createHarness();
    const { receipt } = await compiledReceipt();
    const first = await services.persistPreview({ accountId: OWNER, receipt });
    const second = await services.persistPreview({ accountId: OWNER, receipt });
    expect(second.id).toBe(first.id);
  });

  it("conflicts when the same receipt id carries different content", async () => {
    const { services } = createHarness();
    const first = await compiledReceipt();
    await services.persistPreview({ accountId: OWNER, receipt: first.receipt });
    const second = await compiledReceipt();
    await expect(
      services.persistPreview({
        accountId: OWNER,
        receipt: { ...second.receipt, model: "gpt-5.6-luna" }
      })
    ).rejects.toBeInstanceOf(AgentReceiptConflictError);
  });

  it("queues runs only when receipt hash matches", async () => {
    const { services } = createHarness();
    const { receipt } = await compiledReceipt();
    await services.persistPreview({ accountId: OWNER, receipt });
    await expect(
      services.queueRun({
        accountId: OWNER,
        runId: RUN,
        receiptId: receipt.id,
        expectedReceiptHash: instructionContentHash("f".repeat(64))
      })
    ).rejects.toBeInstanceOf(AgentRunReceiptMismatchError);
  });

  it("rejects duplicate run ids and cross-project reads", async () => {
    const harness = createHarness();
    const { services, captureDocuments } = harness;
    await seedCapture(captureDocuments);
    const { receipt } = await compiledReceipt();
    await services.persistPreview({ accountId: OWNER, receipt });
    await services.queueRun({
      accountId: OWNER,
      runId: RUN,
      receiptId: receipt.id,
      expectedReceiptHash: receipt.receiptHash
    });
    await expect(
      services.queueRun({
        accountId: OWNER,
        runId: RUN,
        receiptId: receipt.id,
        expectedReceiptHash: receipt.receiptHash
      })
    ).rejects.toBeInstanceOf(AgentRunStateConflictError);
    await expect(
      services.getRun({
        accountId: STRANGER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        runId: RUN
      })
    ).rejects.toBeInstanceOf(AgentRunNotFoundError);
    await expect(
      services.getRun({
        accountId: OWNER,
        projectId: OTHER_PROJECT,
        runId: RUN
      })
    ).rejects.toBeInstanceOf(AgentRunNotFoundError);
  });

  it("completes a running reflection atomically with hashed payload", async () => {
    const harness = createHarness();
    const { services } = harness;
    await queuedRun(harness);
    await services.markRunning({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      runId: RUN
    });
    const result = await services.completeReflectionRun({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      runId: RUN,
      proposalId: PROPOSAL,
      rawPayload: reflectionPayload,
      baseCaptureId: CAPTURE,
      expectedCaptureWorkingVersion: 3,
      expectedCaptureContentHash: CONTENT_HASH,
      providerResponseId: "resp-1",
      tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.run.status).toBe("ready");
    expect(result.proposal.status).toBe("ready");
    expect(result.proposal.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rolls back proposal creation when completion cannot finish", async () => {
    const runs = createMemoryAgentRunRepository();
    const proposals = createMemoryAgentProposalRepository();
    const receipts = createMemoryContextReceiptRepository();
    const captureDocuments = createMemoryCaptureDocumentRepository();
    const harness = createHarness({
      runs,
      proposals,
      receipts,
      captureDocuments,
      completion: createFailingMemoryAgentRunReflectionCompletionUnitOfWork({
        runs,
        proposals,
        failAfter: "proposal-create"
      })
    });
    const { services } = harness;
    await queuedRun(harness);
    await services.markRunning({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      runId: RUN
    });
    await expect(
      services.completeReflectionRun({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        runId: RUN,
        proposalId: PROPOSAL,
        rawPayload: reflectionPayload,
        baseCaptureId: CAPTURE,
        expectedCaptureWorkingVersion: 3,
        expectedCaptureContentHash: CONTENT_HASH
      })
    ).rejects.toBeInstanceOf(AgentRunStateConflictError);
    expect(await proposals.get(PROPOSAL)).toBeUndefined();
    expect((await runs.get(RUN))?.status).toBe("running");
  });

  it("rejects executor capture expectations that do not match the receipt", async () => {
    const harness = createHarness();
    const { services } = harness;
    await queuedRun(harness);
    await services.markRunning({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      runId: RUN
    });
    await expect(
      services.completeReflectionRun({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        runId: RUN,
        proposalId: PROPOSAL,
        rawPayload: reflectionPayload,
        baseCaptureId: CAPTURE,
        expectedCaptureWorkingVersion: 99,
        expectedCaptureContentHash: CONTENT_HASH
      })
    ).rejects.toBeInstanceOf(AgentProposalContentMismatchError);
    expect((await harness.runs.get(RUN))?.status).toBe("running");
  });

  it("allows only one concurrent completion winner", async () => {
    const harness = createHarness();
    const { services } = harness;
    await queuedRun(harness);
    await services.markRunning({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      runId: RUN
    });
    const attempts = await Promise.allSettled([
      services.completeReflectionRun({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        runId: RUN,
        proposalId: PROPOSAL,
        rawPayload: reflectionPayload,
        baseCaptureId: CAPTURE,
        expectedCaptureWorkingVersion: 3,
        expectedCaptureContentHash: CONTENT_HASH
      }),
      services.completeReflectionRun({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        runId: RUN,
        proposalId: agentProposalId("proposal-foundation-2"),
        rawPayload: reflectionPayload,
        baseCaptureId: CAPTURE,
        expectedCaptureWorkingVersion: 3,
        expectedCaptureContentHash: CONTENT_HASH
      })
    ]);
    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("marks runs stale without proposals when Capture revisions drift", async () => {
    const harness = createHarness();
    const { services, captureDocuments } = harness;
    await queuedRun(harness);
    await services.markRunning({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      runId: RUN
    });
    const updatedDocument = captureHead("Capture changed after the receipt.").document;
    const updatedHash = captureContentHash(await hashSceneDocument(updatedDocument));
    await captureDocuments.saveWorkingDocument({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: CAPTURE,
      expectedWorkingVersion: 3,
      document: updatedDocument,
      contentHash: updatedHash,
      actorAccountId: OWNER,
      now: "2026-07-24T21:00:01.000Z"
    });
    const result = await services.completeReflectionRun({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      runId: RUN,
      proposalId: PROPOSAL,
      rawPayload: reflectionPayload,
      baseCaptureId: CAPTURE,
      expectedCaptureWorkingVersion: 3,
      expectedCaptureContentHash: CONTENT_HASH
    });
    expect(result.kind).toBe("stale");
    if (result.kind !== "stale") return;
    expect(result.run.status).toBe("stale");
    expect(await harness.proposals.get(PROPOSAL)).toBeUndefined();
  });

  it("non-discloses missing or cross-project Capture reload failures", async () => {
    const missingHarness = createHarness();
    const { receipt } = await compiledReceipt();
    await missingHarness.services.persistPreview({ accountId: OWNER, receipt });
    await expect(
      missingHarness.services.queueRun({
        accountId: OWNER,
        runId: RUN,
        receiptId: receipt.id,
        expectedReceiptHash: receipt.receiptHash
      })
    ).rejects.toBeInstanceOf(AgentRunNotFoundError);

    const crossProjectHarness = createHarness();
    await seedCapture(
      crossProjectHarness.captureDocuments,
      createCaptureDocumentHead({
        ...captureHead("Cross-project capture."),
        projectId: OTHER_PROJECT
      })
    );
    await crossProjectHarness.services.persistPreview({ accountId: OWNER, receipt });
    await expect(
      crossProjectHarness.services.queueRun({
        accountId: OWNER,
        runId: agentRunId("run-cross-project"),
        receiptId: receipt.id,
        expectedReceiptHash: receipt.receiptHash
      })
    ).rejects.toBeInstanceOf(AgentRunNotFoundError);
  });

  it("cancels queued and running runs and fails with content-free diagnostics", async () => {
    const harness = createHarness();
    const { services } = harness;
    const queued = await queuedRun(harness);
    const canceledQueued = await services.cancelRun({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      runId: queued.id
    });
    expect(canceledQueued.status).toBe("canceled");
    expect(JSON.stringify(canceledQueued)).not.toMatch(/prompt|secret|password/i);

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
    await seedCapture(captureDocuments);
    const localServices = createAgentFoundationServices({
      projects,
      captureDocuments,
      receipts: createMemoryContextReceiptRepository(),
      runs,
      proposals,
      completion: createMemoryAgentRunReflectionCompletionUnitOfWork({ runs, proposals }),
      hashPort: createTestHashPort(),
      clock: { now: () => NOW }
    });
    const { receipt } = await compiledReceipt();
    await localServices.persistPreview({ accountId: OWNER, receipt });
    const running = await localServices.queueRun({
      accountId: OWNER,
      runId: agentRunId("run-running"),
      receiptId: receipt.id,
      expectedReceiptHash: receipt.receiptHash
    });
    await localServices.markRunning({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      runId: running.id
    });
    const failed = await localServices.failRun({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      runId: running.id,
      diagnosticCode: "provider-timeout"
    });
    expect(failed.terminalDiagnosticCode).toBe("provider-timeout");
    expect(failed.status).toBe("failed");
  });

  it("rejects ready proposals for owners and hides non-owners", async () => {
    const harness = createHarness();
    const { services } = harness;
    await queuedRun(harness);
    await services.markRunning({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      runId: RUN
    });
    const completed = await services.completeReflectionRun({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      runId: RUN,
      proposalId: PROPOSAL,
      rawPayload: reflectionPayload,
      baseCaptureId: CAPTURE,
      expectedCaptureWorkingVersion: 3,
      expectedCaptureContentHash: CONTENT_HASH
    });
    if (completed.kind !== "ready") {
      throw new Error("Expected a ready completion.");
    }
    const rejected = await services.rejectProposal({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      proposalId: completed.proposal.id
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.decision?.actorAccountId).toBe(OWNER);
    await expect(
      services.rejectProposal({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        proposalId: completed.proposal.id
      })
    ).rejects.toBeInstanceOf(AgentProposalStateConflictError);
    await expect(
      services.rejectProposal({
        accountId: STRANGER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        proposalId: completed.proposal.id
      })
    ).rejects.toBeInstanceOf(AgentProposalNotFoundError);
  });

  it("lists newest summaries with bounded limits", async () => {
    const runs = createMemoryAgentRunRepository();
    const proposals = createMemoryAgentProposalRepository();
    const receipts = createMemoryContextReceiptRepository();
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
    await seedCapture(captureDocuments);
    const services = createAgentFoundationServices({
      projects,
      captureDocuments,
      receipts,
      runs,
      proposals,
      completion: createMemoryAgentRunReflectionCompletionUnitOfWork({ runs, proposals }),
      hashPort: createTestHashPort(),
      clock: {
        now: () => {
          tick += 1;
          return `2026-07-24T22:00:${String(tick).padStart(2, "0")}.000Z`;
        }
      }
    });
    const { receipt } = await compiledReceipt();
    await services.persistPreview({ accountId: OWNER, receipt });
    for (let index = 0; index < 3; index += 1) {
      await services.queueRun({
        accountId: OWNER,
        runId: agentRunId(`run-${index}`),
        receiptId: receipt.id,
        expectedReceiptHash: receipt.receiptHash
      });
    }
    const summaries = await services.listRunSummaries({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      limit: 2
    });
    expect(summaries).toHaveLength(2);
    expect(summaries[0]?.id).toBe(agentRunId("run-2"));
  });

  it("does not mutate canonical project records", async () => {
    const harness = createHarness();
    const { projects } = harness;
    const before = await projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID);
    await queuedRun(harness);
    const after = await projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID);
    expect(after?.version).toBe(before?.version);
  });
});
