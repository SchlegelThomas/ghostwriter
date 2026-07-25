import type { ContextReceipt } from "@ghostwriter/core";
import {
  agentProposalId,
  agentRunId,
  agentProposalIdentityMatches,
  agentRunIdentityMatches,
  assertAgentProposalTransition,
  assertAgentRunTransition,
  captureContentHash,
  captureId,
  contextReceiptId,
  createAgentProposal,
  createAgentRun,
  createQueuedAgentRun,
  createReadyAgentProposal,
  instructionContentHash,
  normalizeAgentFoundationListLimit,
  projectId,
  receiptsMatch,
  type AgentProposal,
  type AgentProposalRepository,
  type AgentRun,
  type AgentRunRepository,
  type ContextReceiptRepository,
  type CreateAgentProposalOutcome,
  type CreateAgentRunOutcome,
  type InsertContextReceiptOutcome,
  type MarkAgentProposalAppliedInput,
  type MarkAgentProposalStaleInput,
  type RejectAgentProposalInput,
  type TransitionAgentRunInput,
  type TransitionAgentRunOutcome,
  type TransitionAgentProposalInput,
  type TransitionAgentProposalOutcome,
  type AgentFoundationListOptions,
  type AgentRunId,
  type AgentProposalId,
  type ContextReceiptId,
  type ProjectId
} from "@ghostwriter/core";
import { accountId } from "@ghostwriter/core";
import { and, desc, eq } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import { agentProposals, agentRuns, contextReceipts } from "./schema.js";

function isPersistenceConstraintError(error: unknown): boolean {
  const serialized = String(error);
  if (/23503|foreign key|violates foreign key constraint/i.test(serialized)) {
    return true;
  }
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!(current instanceof Error)) break;
    if (/foreign key|violates.*constraint|23503/i.test(current.message)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}
const STORED_RECEIPT_INVALID = "Stored context receipt is invalid.";
const STORED_RUN_INVALID = "Stored agent run is invalid.";
const STORED_PERSISTENCE_FAILED = "Agent foundation persistence failed.";
const STORED_PROPOSAL_INVALID = "Stored agent proposal is invalid.";

type ContextReceiptPayload = Omit<
  ContextReceipt,
  "id" | "projectId" | "receiptHash" | "createdAt"
>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function receiptPayloadFromReceipt(receipt: ContextReceipt): ContextReceiptPayload {
  const {
    id: _id,
    projectId: _projectId,
    receiptHash: _receiptHash,
    createdAt: _createdAt,
    ...payload
  } = receipt;
  return payload;
}

function receiptFromRow(row: typeof contextReceipts.$inferSelect): ContextReceipt {
  if (!isPlainObject(row.payload)) {
    throw new Error(STORED_RECEIPT_INVALID);
  }
  try {
    return Object.freeze({
      id: contextReceiptId(row.id),
      projectId: projectId(row.projectId),
      receiptHash: instructionContentHash(row.receiptHash),
      createdAt: row.createdAt,
      ...(row.payload as ContextReceiptPayload)
    }) as ContextReceipt;
  } catch {
    throw new Error(STORED_RECEIPT_INVALID);
  }
}

function receiptToRow(receipt: ContextReceipt) {
  return {
    id: receipt.id,
    projectId: receipt.projectId,
    payload: receiptPayloadFromReceipt(receipt),
    receiptHash: receipt.receiptHash,
    createdAt: receipt.createdAt
  };
}

function runFromRow(row: typeof agentRuns.$inferSelect): AgentRun {
  try {
    return createAgentRun({
      id: agentRunId(row.id),
      projectId: projectId(row.projectId),
      initiatorAccountId: accountId(row.initiatorAccountId),
      workflowId: row.workflowId as AgentRun["workflowId"],
      workflowVersion: row.workflowVersion,
      provider: row.provider as AgentRun["provider"],
      model: row.model as AgentRun["model"],
      receiptId: contextReceiptId(row.receiptId),
      receiptHash: instructionContentHash(row.receiptHash),
      status: row.status as AgentRun["status"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.cancelRequestedAt === null ? {} : { cancelRequestedAt: row.cancelRequestedAt }),
      ...(row.completedAt === null ? {} : { completedAt: row.completedAt }),
      ...(row.providerResponseId === null
        ? {}
        : { providerResponseId: row.providerResponseId }),
      ...(row.tokenUsage === null || !isPlainObject(row.tokenUsage)
        ? {}
        : {
            tokenUsage: {
              inputTokens: Number(row.tokenUsage.inputTokens),
              outputTokens: Number(row.tokenUsage.outputTokens),
              totalTokens: Number(row.tokenUsage.totalTokens)
            }
          }),
      ...(row.terminalDiagnosticCode === null
        ? {}
        : { terminalDiagnosticCode: row.terminalDiagnosticCode as AgentRun["terminalDiagnosticCode"] })
    });
  } catch {
    throw new Error(STORED_RUN_INVALID);
  }
}

function runToRow(run: AgentRun) {
  const candidate = createAgentRun(run);
  return {
    id: candidate.id,
    projectId: candidate.projectId,
    initiatorAccountId: candidate.initiatorAccountId,
    receiptId: candidate.receiptId,
    workflowId: candidate.workflowId,
    workflowVersion: candidate.workflowVersion,
    provider: candidate.provider,
    model: candidate.model,
    receiptHash: candidate.receiptHash,
    status: candidate.status,
    providerResponseId: candidate.providerResponseId ?? null,
    tokenUsage: candidate.tokenUsage ?? null,
    terminalDiagnosticCode: candidate.terminalDiagnosticCode ?? null,
    cancelRequestedAt: candidate.cancelRequestedAt ?? null,
    completedAt: candidate.completedAt ?? null,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  };
}

function proposalFromRow(row: typeof agentProposals.$inferSelect): AgentProposal {
  if (!isPlainObject(row.payload)) {
    throw new Error(STORED_PROPOSAL_INVALID);
  }
  try {
    return createAgentProposal({
      id: agentProposalId(row.id),
      projectId: projectId(row.projectId),
      runId: agentRunId(row.runId),
      receiptId: contextReceiptId(row.receiptId),
      status: row.status as AgentProposal["status"],
      outputSchemaId: row.outputSchemaId as AgentProposal["outputSchemaId"],
      payload: row.payload as AgentProposal["payload"],
      contentHash: instructionContentHash(row.contentHash),
      baseCaptureId: captureId(row.baseCaptureId),
      baseCaptureWorkingVersion: row.baseCaptureWorkingVersion,
      baseCaptureContentHash: captureContentHash(row.baseCaptureContentHash),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.decisionActorAccountId === null || row.decidedAt === null
        ? {}
        : {
            decision: {
              actorAccountId: accountId(row.decisionActorAccountId),
              decidedAt: row.decidedAt
            }
          }),
      ...(row.appliedActorAccountId === null || row.appliedAt === null
        ? {}
        : {
            applied: {
              actorAccountId: accountId(row.appliedActorAccountId),
              appliedAt: row.appliedAt
            }
          })
    });
  } catch {
    throw new Error(STORED_PROPOSAL_INVALID);
  }
}

function proposalToRow(proposal: AgentProposal) {
  const candidate = createAgentProposal(proposal);
  return {
    id: candidate.id,
    projectId: candidate.projectId,
    runId: candidate.runId,
    receiptId: candidate.receiptId,
    baseCaptureId: candidate.baseCaptureId,
    status: candidate.status,
    outputSchemaId: candidate.outputSchemaId,
    payload: candidate.payload,
    contentHash: candidate.contentHash,
    baseCaptureWorkingVersion: candidate.baseCaptureWorkingVersion,
    baseCaptureContentHash: candidate.baseCaptureContentHash,
    decisionActorAccountId: candidate.decision?.actorAccountId ?? null,
    decidedAt: candidate.decision?.decidedAt ?? null,
    appliedActorAccountId: candidate.applied?.actorAccountId ?? null,
    appliedAt: candidate.applied?.appliedAt ?? null,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  };
}

async function loadProposal(
  db: RepositoryDatabase,
  proposalId: AgentProposalId
): Promise<AgentProposal | undefined> {
  const [row] = await db
    .select()
    .from(agentProposals)
    .where(eq(agentProposals.id, proposalId))
    .limit(1);
  return row === undefined ? undefined : proposalFromRow(row);
}

async function transitionAgentProposal(
  db: RepositoryDatabase,
  input: TransitionAgentProposalInput
): Promise<TransitionAgentProposalOutcome> {
  const current = await loadProposal(db, input.proposalId);
  if (current === undefined) {
    return { ok: false, reason: "not-found" };
  }
  if (current.projectId !== input.projectId) {
    return { ok: false, reason: "cross-project" };
  }
  if (current.status !== input.expectedStatus) {
    return { ok: false, reason: "status-conflict" };
  }
  if (!agentProposalIdentityMatches(current, input.next)) {
    return { ok: false, reason: "status-conflict" };
  }
  try {
    assertAgentProposalTransition(current.status, input.next.status);
  } catch {
    return { ok: false, reason: "status-conflict" };
  }
  let next: AgentProposal;
  try {
    next = createAgentProposal(input.next);
  } catch {
    return { ok: false, reason: "status-conflict" };
  }
  if (next.id !== input.proposalId) {
    return { ok: false, reason: "status-conflict" };
  }
  const [updated] = await db
    .update(agentProposals)
    .set(proposalToRow(next))
    .where(
      and(
        eq(agentProposals.id, input.proposalId),
        eq(agentProposals.status, input.expectedStatus),
        eq(agentProposals.projectId, input.projectId)
      )
    )
    .returning();
  if (updated === undefined) {
    const latest = await loadProposal(db, input.proposalId);
    if (latest === undefined) {
      return { ok: false, reason: "not-found" };
    }
    if (latest.projectId !== input.projectId) {
      return { ok: false, reason: "cross-project" };
    }
    return { ok: false, reason: "status-conflict" };
  }
  return { ok: true, proposal: proposalFromRow(updated) };
}

async function loadRun(db: RepositoryDatabase, runId: AgentRunId): Promise<AgentRun | undefined> {
  const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  return row === undefined ? undefined : runFromRow(row);
}

export function createPostgresContextReceiptRepository(
  db: RepositoryDatabase
): ContextReceiptRepository {
  return Object.freeze({
    async get(receiptId: ContextReceiptId): Promise<ContextReceipt | undefined> {
      const [row] = await db
        .select()
        .from(contextReceipts)
        .where(eq(contextReceipts.id, receiptId))
        .limit(1);
      return row === undefined ? undefined : receiptFromRow(row);
    },

    async listByProject(projectIdValue: ProjectId, options: AgentFoundationListOptions = {}) {
      const limit = normalizeAgentFoundationListLimit(options.limit);
      const rows = await db
        .select()
        .from(contextReceipts)
        .where(eq(contextReceipts.projectId, projectIdValue))
        .orderBy(desc(contextReceipts.createdAt), desc(contextReceipts.id))
        .limit(limit);
      return Object.freeze(rows.map(receiptFromRow));
    },

    async insertImmutable(receipt: ContextReceipt): Promise<InsertContextReceiptOutcome> {
      const row = receiptToRow(receipt);
      const [inserted] = await db
        .insert(contextReceipts)
        .values(row)
        .onConflictDoNothing({ target: contextReceipts.id })
        .returning();
      if (inserted !== undefined) {
        return { ok: true, receipt: receiptFromRow(inserted), created: true };
      }
      const existing = await this.get(receipt.id);
      if (existing === undefined) {
        return { ok: false, reason: "conflict" };
      }
      if (receiptsMatch(existing, receipt)) {
        return { ok: true, receipt: existing, created: false };
      }
      return { ok: false, reason: "conflict" };
    }
  });
}

export function createPostgresAgentRunRepository(db: RepositoryDatabase): AgentRunRepository {
  return Object.freeze({
    async get(runId: AgentRunId): Promise<AgentRun | undefined> {
      return loadRun(db, runId);
    },

    async listByProject(projectIdValue: ProjectId, options: AgentFoundationListOptions = {}) {
      const limit = normalizeAgentFoundationListLimit(options.limit);
      const rows = await db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.projectId, projectIdValue))
        .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
        .limit(limit);
      return Object.freeze(rows.map(runFromRow));
    },

    async create(run: AgentRun): Promise<CreateAgentRunOutcome> {
      const normalized = createQueuedAgentRun(run);
      try {
        const [inserted] = await db
          .insert(agentRuns)
          .values(runToRow(normalized))
          .onConflictDoNothing({ target: agentRuns.id })
          .returning();
        if (inserted === undefined) {
          return { ok: false, reason: "duplicate-id" };
        }
        return { ok: true, run: runFromRow(inserted) };
      } catch (error) {
        if (isPersistenceConstraintError(error)) {
          throw new Error(STORED_PERSISTENCE_FAILED, { cause: error });
        }
        throw error;
      }
    },

    async transition(input: TransitionAgentRunInput): Promise<TransitionAgentRunOutcome> {
      const current = await loadRun(db, input.runId);
      if (current === undefined) {
        return { ok: false, reason: "not-found" };
      }
      if (current.projectId !== input.next.projectId) {
        return { ok: false, reason: "cross-project" };
      }
      if (current.status !== input.expectedStatus) {
        return { ok: false, reason: "status-conflict" };
      }
      if (!agentRunIdentityMatches(current, input.next)) {
        return { ok: false, reason: "status-conflict" };
      }
      try {
        assertAgentRunTransition(current.status, input.next.status);
      } catch {
        return { ok: false, reason: "status-conflict" };
      }
      let next: AgentRun;
      try {
        next = createAgentRun(input.next);
      } catch {
        return { ok: false, reason: "status-conflict" };
      }
      const [updated] = await db
        .update(agentRuns)
        .set(runToRow(next))
        .where(
          and(
            eq(agentRuns.id, input.runId),
            eq(agentRuns.status, input.expectedStatus),
            eq(agentRuns.projectId, input.next.projectId)
          )
        )
        .returning();
      if (updated === undefined) {
        const latest = await loadRun(db, input.runId);
        if (latest === undefined) {
          return { ok: false, reason: "not-found" };
        }
        if (latest.projectId !== input.next.projectId) {
          return { ok: false, reason: "cross-project" };
        }
        return { ok: false, reason: "status-conflict" };
      }
      return { ok: true, run: runFromRow(updated) };
    }
  });
}

export function createPostgresAgentProposalRepository(
  db: RepositoryDatabase
): AgentProposalRepository {
  return Object.freeze({
    async get(proposalId: AgentProposalId): Promise<AgentProposal | undefined> {
      return loadProposal(db, proposalId);
    },

    async listByProject(projectIdValue: ProjectId, options: AgentFoundationListOptions = {}) {
      const limit = normalizeAgentFoundationListLimit(options.limit);
      const rows = await db
        .select()
        .from(agentProposals)
        .where(eq(agentProposals.projectId, projectIdValue))
        .orderBy(desc(agentProposals.createdAt), desc(agentProposals.id))
        .limit(limit);
      return Object.freeze(rows.map(proposalFromRow));
    },

    async create(proposal: AgentProposal): Promise<CreateAgentProposalOutcome> {
      const normalized = createReadyAgentProposal(proposal);
      try {
        const [inserted] = await db
          .insert(agentProposals)
          .values(proposalToRow(normalized))
          .onConflictDoNothing({ target: agentProposals.id })
          .returning();
        if (inserted === undefined) {
          return { ok: false, reason: "duplicate-id" };
        }
        return { ok: true, proposal: proposalFromRow(inserted) };
      } catch (error) {
        if (isPersistenceConstraintError(error)) {
          throw new Error(STORED_PERSISTENCE_FAILED, { cause: error });
        }
        throw error;
      }
    },

    async transition(
      input: TransitionAgentProposalInput
    ): Promise<TransitionAgentProposalOutcome> {
      return transitionAgentProposal(db, input);
    },

    async reject(input: RejectAgentProposalInput): Promise<TransitionAgentProposalOutcome> {
      const current = await loadProposal(db, input.proposalId);
      if (current === undefined) {
        return { ok: false, reason: "not-found" };
      }
      if (current.projectId !== input.projectId) {
        return { ok: false, reason: "cross-project" };
      }
      return transitionAgentProposal(db, {
        proposalId: input.proposalId,
        projectId: input.projectId,
        expectedStatus: input.expectedStatus,
        next: createAgentProposal({
          ...current,
          status: "rejected",
          updatedAt: input.updatedAt,
          decision: {
            actorAccountId: input.actorAccountId,
            decidedAt: input.decidedAt
          }
        })
      });
    },

    async markStale(input: MarkAgentProposalStaleInput): Promise<TransitionAgentProposalOutcome> {
      const current = await loadProposal(db, input.proposalId);
      if (current === undefined) {
        return { ok: false, reason: "not-found" };
      }
      if (current.projectId !== input.projectId) {
        return { ok: false, reason: "cross-project" };
      }
      return transitionAgentProposal(db, {
        proposalId: input.proposalId,
        projectId: input.projectId,
        expectedStatus: input.expectedStatus,
        next: createAgentProposal({
          ...current,
          status: "stale",
          updatedAt: input.updatedAt
        })
      });
    },

    async markApplied(
      input: MarkAgentProposalAppliedInput
    ): Promise<TransitionAgentProposalOutcome> {
      const current = await loadProposal(db, input.proposalId);
      if (current === undefined) {
        return { ok: false, reason: "not-found" };
      }
      if (current.projectId !== input.projectId) {
        return { ok: false, reason: "cross-project" };
      }
      return transitionAgentProposal(db, {
        proposalId: input.proposalId,
        projectId: input.projectId,
        expectedStatus: input.expectedStatus,
        next: createAgentProposal({
          ...current,
          status: "applied",
          updatedAt: input.updatedAt,
          applied: {
            actorAccountId: input.actorAccountId,
            appliedAt: input.appliedAt
          }
        })
      });
    }
  });
}
