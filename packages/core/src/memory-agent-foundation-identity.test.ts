import { describe, expect, it } from "vitest";
import { instructionContentHash } from "./agent-domain.js";
import {
  assertAgentProposalIdentityPreserved,
  assertAgentRunIdentityPreserved,
  agentProposalIdentityMatches,
  agentRunIdentityMatches,
  createAgentProposal,
  createAgentRun,
  createQueuedAgentRun,
  createReadyAgentProposal,
  AgentProposalStateConflictError,
  AgentRunStateConflictError
} from "./agent-runs-proposals.js";
import { captureContentHash } from "./capture-documents.js";
import {
  agentProposalId,
  agentRunId,
  captureId,
  contextReceiptId,
  projectId
} from "./domain.js";
import { accountId } from "./identity.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";

const PROJECT = projectId("project-identity");
const NOW = "2026-07-24T23:00:00.000Z";
const RECEIPT_HASH = instructionContentHash("a".repeat(64));
const CAPTURE = captureId("capture-identity");

const reflectionPayload = {
  schemaId: "capture-reflection-v1" as const,
  summary: "Identity test.",
  questions: ["Where does this go?"],
  possibleStoryJobs: [{ label: "Beat", rationale: "Hook." }]
};

function queuedRunRecord() {
  return createQueuedAgentRun({
    id: agentRunId("run-identity"),
    projectId: PROJECT,
    initiatorAccountId: accountId("owner"),
    workflowId: "scene-partner.capture-reflection",
    workflowVersion: "2026-07-24",
    provider: "openai",
    model: "gpt-4.1",
    receiptId: contextReceiptId("receipt-identity"),
    receiptHash: RECEIPT_HASH,
    status: "queued",
    createdAt: NOW,
    updatedAt: NOW
  });
}

function readyProposalRecord() {
  return createReadyAgentProposal({
    id: agentProposalId("proposal-identity"),
    projectId: PROJECT,
    runId: agentRunId("run-identity"),
    receiptId: contextReceiptId("receipt-identity"),
    status: "ready",
    outputSchemaId: "capture-reflection-v1",
    payload: reflectionPayload,
    contentHash: instructionContentHash("b".repeat(64)),
    primaryTarget: { kind: "capture", id: CAPTURE },
    baseCaptureId: CAPTURE,
    baseCaptureWorkingVersion: 2,
    baseCaptureContentHash: captureContentHash("c".repeat(64)),
    createdAt: NOW,
    updatedAt: NOW
  });
}

describe("agent run identity preservation", () => {
  it("detects immutable field mutation", () => {
    const current = queuedRunRecord();
    const next = createAgentRun({
      ...current,
      status: "running",
      model: "gpt-4.1-mini",
      updatedAt: "2026-07-24T23:00:01.000Z"
    });
    expect(agentRunIdentityMatches(current, next)).toBe(false);
    expect(() => assertAgentRunIdentityPreserved(current, next)).toThrow(
      AgentRunStateConflictError
    );
  });

  it("allows lifecycle field updates", () => {
    const current = queuedRunRecord();
    const next = createAgentRun({
      ...current,
      status: "running",
      updatedAt: "2026-07-24T23:00:01.000Z"
    });
    expect(agentRunIdentityMatches(current, next)).toBe(true);
  });
});

describe("agent proposal identity preservation", () => {
  it("detects payload and base revision mutation", () => {
    const current = readyProposalRecord();
    const next = createAgentProposal({
      ...current,
      status: "rejected",
      updatedAt: "2026-07-24T23:00:01.000Z",
      payload: {
        ...reflectionPayload,
        summary: "Tampered summary."
      },
      baseCaptureWorkingVersion: 99,
      decision: {
        actorAccountId: accountId("owner"),
        decidedAt: "2026-07-24T23:00:01.000Z"
      }
    });
    expect(agentProposalIdentityMatches(current, next)).toBe(false);
    expect(() => assertAgentProposalIdentityPreserved(current, next)).toThrow(
      AgentProposalStateConflictError
    );
  });
});

describe("memory agent run repository identity enforcement", () => {
  it.each([
    ["model", { model: "gpt-4.1-mini" as const }],
    ["receiptHash", { receiptHash: instructionContentHash("f".repeat(64)) }],
    ["initiatorAccountId", { initiatorAccountId: accountId("other-writer") }]
  ])("rejects %s mutation during transition", async (_label, mutation) => {
    const runs = createMemoryAgentRunRepository();
    const created = await runs.create(queuedRunRecord());
    if (!created.ok) throw new Error("Expected run creation.");
    const current = created.run;
    const outcome = await runs.transition({
      runId: current.id,
      expectedStatus: "queued",
      next: createAgentRun({
        ...current,
        ...mutation,
        status: "running",
        updatedAt: "2026-07-24T23:00:01.000Z"
      })
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("status-conflict");
    expect(await runs.get(current.id)).toEqual(current);
  });
});

describe("memory agent proposal repository identity enforcement", () => {
  it("preserves immutable fields when rejecting", async () => {
    const proposals = createMemoryAgentProposalRepository();
    const created = await proposals.create(readyProposalRecord());
    if (!created.ok) throw new Error("Expected proposal creation.");
    const rejected = await proposals.reject({
      proposalId: created.proposal.id,
      projectId: PROJECT,
      expectedStatus: "ready",
      actorAccountId: accountId("owner"),
      decidedAt: "2026-07-24T23:00:01.000Z",
      updatedAt: "2026-07-24T23:00:02.000Z"
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(agentProposalIdentityMatches(created.proposal, rejected.proposal)).toBe(true);
    expect(rejected.proposal.status).toBe("rejected");
    expect(rejected.proposal.decision?.actorAccountId).toBe(accountId("owner"));
  });

  it.each([
    ["receiptId", { receiptId: contextReceiptId("receipt-tampered") }],
    ["primaryTarget", { primaryTarget: { kind: "scene" as const, id: "scene-tampered" } }],
    [
      "baseCaptureContentHash",
      { baseCaptureContentHash: captureContentHash("f".repeat(64)) }
    ]
  ])("rejects %s mutation during transition", async (_label, mutation) => {
    const proposals = createMemoryAgentProposalRepository();
    const created = await proposals.create(readyProposalRecord());
    if (!created.ok) throw new Error("Expected proposal creation.");
    const current = created.proposal;
    const outcome = await proposals.transition({
      proposalId: current.id,
      projectId: PROJECT,
      expectedStatus: "ready",
      next: createAgentProposal({
        ...current,
        ...mutation,
        status: "stale",
        updatedAt: "2026-07-24T23:00:01.000Z"
      })
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("status-conflict");
    expect(await proposals.get(current.id)).toEqual(current);
  });

  it("filters entity proposals by primary target and status", async () => {
    const proposals = createMemoryAgentProposalRepository();
    const sceneProposal = createReadyAgentProposal({
      ...readyProposalRecord(),
      id: agentProposalId("proposal-scene-target"),
      primaryTarget: { kind: "scene", id: "scene-target" },
      baseCaptureId: undefined,
      baseCaptureWorkingVersion: undefined,
      baseCaptureContentHash: undefined
    });
    await proposals.create(sceneProposal);
    expect(
      await proposals.listByProject(PROJECT, {
        targetKind: "scene",
        targetId: "scene-target",
        status: "ready"
      })
    ).toEqual([sceneProposal]);
    expect(
      await proposals.listByProject(PROJECT, {
        targetKind: "project",
        targetId: PROJECT
      })
    ).toEqual([]);
  });
});
