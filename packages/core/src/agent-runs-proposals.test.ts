import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import type { ContextReceipt } from "./agent-context-receipt.js";
import {
  AGENT_RUN_STATUSES,
  assertAgentProposalTransition,
  assertAgentRunTransition,
  agentProposalListPreviewFromPayload,
  agentProposalSummaryFromProposal,
  computeAgentProposalContentHash,
  createAgentProposal,
  createAgentRun,
  createQueuedAgentRun,
  createReadyAgentProposal,
  evaluateReceiptCaptureBinding,
  AgentProposalStateConflictError,
  AgentRunStateConflictError
} from "./agent-runs-proposals.js";
import { captureContentHash, createCaptureDocumentHead } from "./capture-documents.js";
import {
  agentProposalId,
  agentRunId,
  captureId,
  captureRevisionId,
  contextReceiptId,
  DomainValidationError,
  projectId
} from "./domain.js";
import { accountId } from "./identity.js";
import { instructionContentHash } from "./agent-domain.js";

const PROJECT = projectId("project-agent-domain");
const NOW = "2026-07-24T20:00:00.000Z";
const RECEIPT_HASH = instructionContentHash("a".repeat(64));
const BASE_CAPTURE = captureId("capture-domain");

function baseRun(status: (typeof AGENT_RUN_STATUSES)[number]) {
  return {
    id: agentRunId("run-domain"),
    projectId: PROJECT,
    initiatorAccountId: accountId("owner"),
    workflowId: "scene-partner.capture-reflection" as const,
    workflowVersion: "2026-07-24",
    provider: "openai" as const,
    model: "gpt-4.1" as const,
    receiptId: contextReceiptId("receipt-domain"),
    receiptHash: RECEIPT_HASH,
    status,
    createdAt: NOW,
    updatedAt: NOW,
    ...(status === "ready" || status === "failed" || status === "canceled" || status === "stale"
      ? { completedAt: NOW }
      : {}),
    ...(status === "failed" ? { terminalDiagnosticCode: "internal-failure" as const } : {})
  };
}

const reflectionPayload = {
  schemaId: "capture-reflection-v1" as const,
  summary: "A signal note.",
  questions: ["Where does this belong?"],
  possibleStoryJobs: [{ label: "Opening beat", rationale: "Strong sensory hook." }]
};

describe("agent run and proposal factories", () => {
  it("creates queued runs without terminal fields", () => {
    const run = createQueuedAgentRun(baseRun("queued"));
    expect(run.status).toBe("queued");
    expect(run.completedAt).toBeUndefined();
  });

  it("rejects queued runs that include terminal fields", () => {
    expect(() =>
      createQueuedAgentRun({
        ...baseRun("queued"),
        completedAt: NOW
      })
    ).toThrow(DomainValidationError);
  });

  it("requires diagnostics only on failed terminal runs", () => {
    expect(() =>
      createAgentRun({
        ...baseRun("failed"),
        terminalDiagnosticCode: undefined
      })
    ).toThrow(DomainValidationError);
    expect(() =>
      createAgentRun({
        ...baseRun("ready"),
        terminalDiagnosticCode: "internal-failure"
      })
    ).toThrow(DomainValidationError);
  });

  it("creates ready proposals with validated payload", () => {
    const proposal = createReadyAgentProposal({
      id: agentProposalId("proposal-domain"),
      projectId: PROJECT,
      runId: agentRunId("run-domain"),
      receiptId: contextReceiptId("receipt-domain"),
      status: "ready",
      outputSchemaId: "capture-reflection-v1",
      payload: reflectionPayload,
      contentHash: instructionContentHash("b".repeat(64)),
      primaryTarget: { kind: "capture", id: BASE_CAPTURE },
      baseCaptureId: BASE_CAPTURE,
      baseCaptureWorkingVersion: 2,
      baseCaptureContentHash: captureContentHash("c".repeat(64)),
      createdAt: NOW,
      updatedAt: NOW
    });
    expect(
      proposal.payload.schemaId === "capture-reflection-v1"
        ? proposal.payload.summary
        : undefined
    ).toBe("A signal note.");
  });

  it("records human decision on rejected proposals only", () => {
    const rejected = createAgentProposal({
      id: agentProposalId("proposal-rejected"),
      projectId: PROJECT,
      runId: agentRunId("run-domain"),
      receiptId: contextReceiptId("receipt-domain"),
      status: "rejected",
      outputSchemaId: "capture-reflection-v1",
      payload: reflectionPayload,
      contentHash: instructionContentHash("b".repeat(64)),
      primaryTarget: { kind: "capture", id: BASE_CAPTURE },
      baseCaptureId: BASE_CAPTURE,
      baseCaptureWorkingVersion: 2,
      baseCaptureContentHash: captureContentHash("c".repeat(64)),
      createdAt: NOW,
      updatedAt: NOW,
      decision: {
        actorAccountId: accountId("owner"),
        decidedAt: NOW
      }
    });
    expect(rejected.decision?.actorAccountId).toBe(accountId("owner"));
  });

  it("allows entity-targeted proposals without a Capture base", () => {
    const proposal = createReadyAgentProposal({
      id: agentProposalId("proposal-scene-draft"),
      projectId: PROJECT,
      runId: agentRunId("run-domain"),
      receiptId: contextReceiptId("receipt-domain"),
      status: "ready",
      outputSchemaId: "capture-reflection-v1",
      payload: reflectionPayload,
      contentHash: instructionContentHash("b".repeat(64)),
      primaryTarget: { kind: "scene", id: "scene-draft" },
      createdAt: NOW,
      updatedAt: NOW
    });
    expect(proposal.primaryTarget).toEqual({ kind: "scene", id: "scene-draft" });
    expect(proposal.baseCaptureId).toBeUndefined();
  });

  it("requires a matching Capture base for Capture targets", () => {
    expect(() =>
      createReadyAgentProposal({
        id: agentProposalId("proposal-invalid-capture-target"),
        projectId: PROJECT,
        runId: agentRunId("run-domain"),
        receiptId: contextReceiptId("receipt-domain"),
        status: "ready",
        outputSchemaId: "capture-reflection-v1",
        payload: reflectionPayload,
        contentHash: instructionContentHash("b".repeat(64)),
        primaryTarget: { kind: "capture", id: BASE_CAPTURE },
        createdAt: NOW,
        updatedAt: NOW
      })
    ).toThrow(DomainValidationError);
  });

  it("includes the primary target in proposal content identity", async () => {
    const canonicalInputs: string[] = [];
    const hashPort = {
      async digestSha256Hex(value: string) {
        canonicalInputs.push(value);
        return "f".repeat(64);
      }
    };
    await computeAgentProposalContentHash(
      {
        outputSchemaId: "capture-reflection-v1",
        payload: reflectionPayload,
        primaryTarget: { kind: "scene", id: "scene-a" }
      },
      hashPort
    );
    await computeAgentProposalContentHash(
      {
        outputSchemaId: "capture-reflection-v1",
        payload: reflectionPayload,
        primaryTarget: { kind: "scene", id: "scene-b" }
      },
      hashPort
    );
    expect(canonicalInputs[0]).not.toBe(canonicalInputs[1]);
    expect(canonicalInputs[0]).toContain('"primaryTarget":{"id":"scene-a","kind":"scene"}');
  });
});

describe("agent run transitions", () => {
  it.each([
    ["queued", "running"],
    ["queued", "canceled"],
    ["running", "ready"],
    ["running", "failed"],
    ["running", "needs-input"],
    ["needs-input", "running"]
  ] as const)("allows %s -> %s", (current, next) => {
    expect(() => assertAgentRunTransition(current, next)).not.toThrow();
  });

  it.each([
    ["ready", "running"],
    ["failed", "running"],
    ["canceled", "queued"],
    ["running", "queued"]
  ] as const)("rejects %s -> %s", (current, next) => {
    expect(() => assertAgentRunTransition(current, next)).toThrow(AgentRunStateConflictError);
  });
});

describe("agent proposal transitions", () => {
  it.each([
    ["ready", "rejected"],
    ["ready", "stale"],
    ["ready", "applied"]
  ] as const)("allows %s -> %s", (current, next) => {
    expect(() => assertAgentProposalTransition(current, next)).not.toThrow();
  });

  it.each([
    ["rejected", "ready"],
    ["applied", "stale"],
    ["stale", "ready"]
  ] as const)("rejects %s -> %s", (current, next) => {
    expect(() => assertAgentProposalTransition(current, next)).toThrow(
      AgentProposalStateConflictError
    );
  });
});

describe("receipt capture binding", () => {
  const receipt = Object.freeze({
    id: contextReceiptId("receipt-binding"),
    projectId: PROJECT,
    workflowId: "scene-partner.capture-reflection",
    workflowVersion: "2026-07-24",
    layers: Object.freeze([]),
    resources: Object.freeze([
      Object.freeze({
        resourceClass: "capture" as const,
        captureId: BASE_CAPTURE,
        workingVersion: 2,
        contentHash: captureContentHash("c".repeat(64)),
        inclusionReason: "selected-capture",
        providerTextCharCount: 12,
        providerTextHash: instructionContentHash("d".repeat(64))
      })
    ]),
    excludedContextClasses: Object.freeze([]),
    provider: "openai" as const,
    model: "gpt-4.1" as const,
    maxOutputTokens: 1500,
    wallClockSeconds: 60,
    toolCount: 0 as const,
    egressClass: "openai-responses" as const,
    outputSchemaId: "capture-reflection-v1" as const,
    receiptHash: instructionContentHash("e".repeat(64)),
    createdAt: NOW
  }) as ContextReceipt;

  it("accepts a matching live Capture revision", () => {
    const head = createCaptureDocumentHead({
      captureId: BASE_CAPTURE,
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
              attrs: { id: "block-binding" },
              content: [{ type: "text", text: "Binding test." }]
            }
          ]
        }
      }),
      contentHash: captureContentHash("c".repeat(64)),
      genesisRevisionId: captureRevisionId("capture-rev-binding"),
      authorAccountId: accountId("owner"),
      updatedByAccountId: accountId("owner"),
      createdAt: NOW,
      updatedAt: NOW
    });
    expect(evaluateReceiptCaptureBinding(receipt, PROJECT, head).ok).toBe(true);
  });

  it("flags revision drift as context-stale", () => {
    const head = createCaptureDocumentHead({
      captureId: BASE_CAPTURE,
      projectId: PROJECT,
      status: "ready",
      sourceModality: "text",
      workingVersion: 3,
      document: validateSceneDocumentV1({
        schemaVersion: 1,
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { id: "block-binding" },
              content: [{ type: "text", text: "Binding test." }]
            }
          ]
        }
      }),
      contentHash: captureContentHash("c".repeat(64)),
      genesisRevisionId: captureRevisionId("capture-rev-binding"),
      authorAccountId: accountId("owner"),
      updatedByAccountId: accountId("owner"),
      createdAt: NOW,
      updatedAt: NOW
    });
    const evaluation = evaluateReceiptCaptureBinding(receipt, PROJECT, head);
    expect(evaluation.ok).toBe(false);
    if (evaluation.ok) return;
    expect(evaluation.reason).toBe("context-stale");
  });
});

describe("agentProposalListPreviewFromPayload", () => {
  it("extracts catalog memo partner, title, and summary", () => {
    expect(
      agentProposalListPreviewFromPayload("catalog-memo-v1", {
        schemaId: "catalog-memo-v1",
        agentId: "idea-midwife",
        title: "Harry Potter",
        summary: "A grounded opening with strong promise.",
        sections: [],
        evidence: []
      })
    ).toEqual({
      agentId: "idea-midwife",
      agentLabel: "Idea Midwife",
      title: "Harry Potter",
      summary: "A grounded opening with strong promise."
    });
  });

  it("extracts pacing doctor preview fields", () => {
    expect(
      agentProposalListPreviewFromPayload("pacing-findings-v1", {
        schemaId: "paging-findings-v1",
        title: "Act II lag",
        summary: "The midpoint arrives late."
      })
    ).toEqual({
      agentLabel: "Pacing Doctor",
      title: "Act II lag",
      summary: "The midpoint arrives late."
    });
  });

  it("summarizes plan outlines from the outline body", () => {
    expect(
      agentProposalListPreviewFromPayload("plan-outline-v1", {
        schemaId: "plan-outline-v1",
        title: "Act I beats",
        outline: "Opening image. Catalyst. Debate.",
        sourceMode: "plan"
      })
    ).toEqual({
      title: "Act I beats",
      summary: "Opening image. Catalyst. Debate."
    });
  });

  it("leaves capture reflection title empty and uses summary", () => {
    expect(
      agentProposalListPreviewFromPayload("capture-reflection-v1", {
        schemaId: "capture-reflection-v1",
        summary: "This note could anchor the opening scene.",
        questions: ["Where does this belong?"],
        possibleStoryJobs: [{ label: "Opening beat", rationale: "Strong hook." }]
      })
    ).toEqual({
      summary: "This note could anchor the opening scene."
    });
  });

  it("never throws on malformed payloads", () => {
    expect(agentProposalListPreviewFromPayload("catalog-memo-v1", null)).toEqual({});
    expect(agentProposalListPreviewFromPayload("catalog-memo-v1", "bad")).toEqual({});
  });
});

describe("agentProposalSummaryFromProposal preview", () => {
  it("includes preview extracted from proposal payload", () => {
    const proposal = createReadyAgentProposal({
      id: agentProposalId("proposal-preview"),
      projectId: PROJECT,
      runId: agentRunId("run-domain"),
      receiptId: contextReceiptId("receipt-domain"),
      status: "ready",
      outputSchemaId: "catalog-memo-v1",
      payload: {
        schemaId: "catalog-memo-v1",
        agentId: "genre-compass",
        title: "Market fit check",
        summary: "Genre signals are clear.",
        sections: [],
        evidence: []
      },
      contentHash: RECEIPT_HASH,
      createdAt: NOW,
      updatedAt: NOW,
      primaryTarget: { kind: "project", id: PROJECT }
    });
    expect(agentProposalSummaryFromProposal(proposal).preview).toEqual({
      agentId: "genre-compass",
      agentLabel: "Genre Compass",
      title: "Market fit check",
      summary: "Genre signals are clear."
    });
  });
});
