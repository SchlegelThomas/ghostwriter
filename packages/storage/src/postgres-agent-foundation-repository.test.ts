import { sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_FOUNDATION_LIST_MAX,
  AgentRunStateConflictError,
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  agentProposalId,
  agentRunId,
  captureContentHash,
  captureId,
  captureRevisionId,
  contextReceiptId,
  createAgentProposal,
  createAgentRun,
  createCaptureDocumentHead,
  createCaptureRevision,
  createMemoryAgentProposalRepository,
  createMemoryAgentRunRepository,
  createMemoryAgentRunReflectionCompletionUnitOfWork,
  createMemoryContextReceiptRepository,
  createProjectMembership,
  createQueuedAgentRun,
  createReadyAgentProposal,
  instructionContentHash,
  projectId,
  receiptsMatch,
  type ContextReceipt,
  type CaptureDocumentHead
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import {
  createPostgresAgentProposalRepository,
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPostgresAgentRunReflectionCompletionUnitOfWork } from "./postgres-agent-run-completion-uow.js";
import { createPostgresCaptureDocumentRepository } from "./postgres-capture-document-repository.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { agentProposals, agentRuns, contextReceipts, user } from "./schema.js";
import { seedProject } from "./seed.js";

const closers: Array<() => Promise<void>> = [];
const OWNER = accountId("account-agent-foundation-pg");
const OTHER_PROJECT = projectId("project-agent-foundation-other");
const NOW = "2026-07-24T22:00:00.000Z";
const RECEIPT_HASH = instructionContentHash("a".repeat(64));
const CONTENT_HASH = instructionContentHash("b".repeat(64));
const BASE_CAPTURE = captureId("capture-agent-foundation-pg");
const RECEIPT_ID = contextReceiptId("receipt-agent-foundation-pg");
const RUN_ID = agentRunId("run-agent-foundation-pg");
const PROPOSAL_ID = agentProposalId("proposal-agent-foundation-pg");

const reflectionPayload = {
  schemaId: "capture-reflection-v1" as const,
  summary: "Fog-bound signal.",
  questions: ["Which scene could hold this?"],
  possibleStoryJobs: [{ label: "Harbor opening", rationale: "Atmospheric hook." }]
};

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

function sampleReceipt(overrides: Partial<ContextReceipt> = {}): ContextReceipt {
  return Object.freeze({
    id: RECEIPT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
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
    receiptHash: RECEIPT_HASH,
    createdAt: NOW,
    ...overrides
  }) as ContextReceipt;
}

function queuedRun(runId = RUN_ID) {
  return createQueuedAgentRun({
    id: runId,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    initiatorAccountId: OWNER,
    workflowId: "scene-partner.capture-reflection",
    workflowVersion: "2026-07-24",
    provider: "openai",
    model: "gpt-4.1",
    receiptId: RECEIPT_ID,
    receiptHash: RECEIPT_HASH,
    status: "queued",
    createdAt: NOW,
    updatedAt: NOW
  });
}

function runningRun(runId = RUN_ID) {
  return createAgentRun({
    ...queuedRun(runId),
    status: "running",
    updatedAt: "2026-07-24T22:00:01.000Z"
  });
}

function readyRun(runId = RUN_ID) {
  return createAgentRun({
    ...runningRun(runId),
    status: "ready",
    completedAt: "2026-07-24T22:00:02.000Z",
    updatedAt: "2026-07-24T22:00:02.000Z",
    providerResponseId: "resp-agent-foundation",
    tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
  });
}

function readyProposal(runId = RUN_ID, proposalId = PROPOSAL_ID) {
  return createReadyAgentProposal({
    id: proposalId,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    runId,
    receiptId: RECEIPT_ID,
    status: "ready",
    outputSchemaId: "capture-reflection-v1",
    payload: reflectionPayload,
    contentHash: CONTENT_HASH,
    primaryTarget: { kind: "capture", id: BASE_CAPTURE },
    baseCaptureId: BASE_CAPTURE,
    baseCaptureWorkingVersion: 2,
    baseCaptureContentHash: captureContentHash("c".repeat(64)),
    createdAt: "2026-07-24T22:00:02.000Z",
    updatedAt: "2026-07-24T22:00:02.000Z"
  });
}

async function seedCapture(
  captureDocuments: ReturnType<typeof createPostgresCaptureDocumentRepository>
) {
  const document = {
    schemaVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "block-agent-foundation" },
          content: [{ type: "text", text: "Agent foundation capture." }]
        }
      ]
    }
  } as const;
  const head = createCaptureDocumentHead({
    captureId: BASE_CAPTURE,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    status: "ready",
    sourceModality: "text",
    workingVersion: 2,
    document: document as unknown as CaptureDocumentHead["document"],
    contentHash: captureContentHash("c".repeat(64)),
    genesisRevisionId: captureRevisionId("capture-rev-agent-foundation"),
    authorAccountId: OWNER,
    updatedByAccountId: OWNER,
    createdAt: NOW,
    updatedAt: NOW
  });
  const genesisRevision = createCaptureRevision({
    id: head.genesisRevisionId,
    captureId: head.captureId,
    projectId: head.projectId,
    document: head.document,
    contentHash: head.contentHash,
    actorAccountId: head.authorAccountId,
    origin: "human",
    reason: "genesis",
    createdAt: head.createdAt
  });
  await captureDocuments.initialize({ head: { ...head, workingVersion: 1, status: "draft" }, genesisRevision });
  const saved = await captureDocuments.saveWorkingDocument({
    projectId: head.projectId,
    captureId: head.captureId,
    expectedWorkingVersion: 1,
    document: head.document,
    contentHash: head.contentHash,
    actorAccountId: OWNER,
    now: NOW
  });
  if (!saved.ok) {
    throw new Error("Failed to seed capture.");
  }
}

async function setupPostgresFoundation() {
  const { db, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: OWNER,
    name: "Agent Foundation Owner",
    email: "agent-foundation@example.test",
    emailVerified: true
  });
  const repositoryDatabase = toRepositoryDatabase(db);
  const projects = createPostgresProjectRepository(repositoryDatabase);
  await seedProject(projects, BELLWETHER_FIXTURE);
  await projects.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: OWNER,
        role: "owner",
        createdAt: NOW
      })
    );
  });
  const captureDocuments = createPostgresCaptureDocumentRepository(repositoryDatabase);
  await seedCapture(captureDocuments);

  return {
    db,
    receipts: createPostgresContextReceiptRepository(repositoryDatabase),
    runs: createPostgresAgentRunRepository(repositoryDatabase),
    proposals: createPostgresAgentProposalRepository(repositoryDatabase),
    completion: createPostgresAgentRunReflectionCompletionUnitOfWork(repositoryDatabase)
  };
}

function memoryFoundationRepos() {
  const receipts = createMemoryContextReceiptRepository();
  const runs = createMemoryAgentRunRepository();
  const proposals = createMemoryAgentProposalRepository();
  return {
    receipts,
    runs,
    proposals,
    completion: createMemoryAgentRunReflectionCompletionUnitOfWork({ runs, proposals })
  };
}

describe("postgres agent foundation repositories", () => {
  it("applies agent foundation migrations from an empty database", async () => {
    const { db } = await setupPostgresFoundation();
    expect(await db.select().from(contextReceipts)).toEqual([]);
    expect(await db.select().from(agentRuns)).toEqual([]);
    expect(await db.select().from(agentProposals)).toEqual([]);
  });

  it("backfills existing Capture proposals before enforcing primary targets", async () => {
    const { client, close } = createPgliteDatabase();
    closers.push(close);
    await client.exec(`
      CREATE TABLE agent_proposals (
        project_id text NOT NULL,
        base_capture_id text NOT NULL,
        base_capture_working_version integer NOT NULL,
        base_capture_content_hash text NOT NULL,
        status text NOT NULL,
        created_at text NOT NULL
      );
      INSERT INTO agent_proposals (
        project_id,
        base_capture_id,
        base_capture_working_version,
        base_capture_content_hash,
        status,
        created_at
      ) VALUES (
        'project-backfill',
        'capture-backfill',
        3,
        '${"c".repeat(64)}',
        'ready',
        '${NOW}'
      );
    `);
    const migration = await readFile(
      new URL("../drizzle/0021_fixed_amazoness.sql", import.meta.url),
      "utf8"
    );
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
    const result = await client.query<{
      primary_target_kind: string;
      primary_target_id: string;
    }>(
      "SELECT primary_target_kind, primary_target_id FROM agent_proposals"
    );
    expect(result.rows).toEqual([
      {
        primary_target_kind: "capture",
        primary_target_id: "capture-backfill"
      }
    ]);
  });

  it("does not persist forbidden raw or content-bearing columns", async () => {
    const { db } = await setupPostgresFoundation();
    for (const tableName of ["context_receipts", "agent_runs", "agent_proposals"]) {
      const columns = await db.execute(sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = ${tableName}
          AND column_name IN (
            'prompt',
            'compiled_text',
            'compiled_instructions',
            'raw_provider_response',
            'provider_error',
            'credentials',
            'capture_prose',
            'provider_plain_text'
          )
      `);
      expect(columns.rows).toEqual([]);
    }
  });

  it("inserts receipts immutably, idempotently, and on conflict", async () => {
    const { receipts } = await setupPostgresFoundation();
    const receipt = sampleReceipt();
    const first = await receipts.insertImmutable(receipt);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(true);
    expect(receiptsMatch(first.receipt, receipt)).toBe(true);
    const second = await receipts.insertImmutable(receipt);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(receiptsMatch(second.receipt, receipt)).toBe(true);

    const conflict = await receipts.insertImmutable({
      ...receipt,
      model: "gpt-4.1-mini"
    });
    expect(conflict).toEqual({ ok: false, reason: "conflict" });
  });

  it("creates runs, transitions with status races, and lists newest", async () => {
    const { receipts, runs } = await setupPostgresFoundation();
    await receipts.insertImmutable(sampleReceipt());
    const created = await runs.create(queuedRun());
    expect(created.ok).toBe(true);
    expect(await runs.create(queuedRun())).toEqual({ ok: false, reason: "duplicate-id" });

    const running = createAgentRun({
      ...queuedRun(),
      status: "running",
      updatedAt: "2026-07-24T22:00:01.000Z"
    });
    const transitioned = await runs.transition({
      runId: RUN_ID,
      expectedStatus: "queued",
      next: running
    });
    expect(transitioned.ok).toBe(true);

    const staleTransition = await runs.transition({
      runId: RUN_ID,
      expectedStatus: "queued",
      next: readyRun()
    });
    expect(staleTransition).toEqual({ ok: false, reason: "status-conflict" });

    await runs.create({
      ...queuedRun(agentRunId("run-agent-foundation-pg-2")),
      createdAt: "2026-07-24T22:00:05.000Z",
      updatedAt: "2026-07-24T22:00:05.000Z"
    });
    const listed = await runs.listByProject(BELLWETHER_FIXTURE_PROJECT_ID, { limit: 1 });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(agentRunId("run-agent-foundation-pg-2"));
    expect(() =>
      runs.listByProject(BELLWETHER_FIXTURE_PROJECT_ID, {
        limit: AGENT_FOUNDATION_LIST_MAX + 1
      })
    ).rejects.toThrow();
  });

  it("creates proposals, rejects or marks stale, and lists newest", async () => {
    const { receipts, runs, proposals } = await setupPostgresFoundation();
    await receipts.insertImmutable(sampleReceipt());
    await runs.create(queuedRun());
    await runs.transition({
      runId: RUN_ID,
      expectedStatus: "queued",
      next: runningRun()
    });
    await runs.transition({
      runId: RUN_ID,
      expectedStatus: "running",
      next: readyRun()
    });

    const created = await proposals.create(readyProposal());
    expect(created.ok).toBe(true);
    expect(await proposals.create(readyProposal())).toEqual({
      ok: false,
      reason: "duplicate-id"
    });

    const rejected = await proposals.reject({
      proposalId: PROPOSAL_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      expectedStatus: "ready",
      actorAccountId: OWNER,
      decidedAt: "2026-07-24T22:00:03.000Z",
      updatedAt: "2026-07-24T22:00:03.000Z"
    });
    expect(rejected.ok).toBe(true);
    if (rejected.ok) {
      expect(rejected.proposal.status).toBe("rejected");
    }

    const staleProposal = readyProposal(RUN_ID, agentProposalId("proposal-agent-foundation-stale"));
    await proposals.create(staleProposal);
    const stale = await proposals.markStale({
      proposalId: staleProposal.id,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      expectedStatus: "ready",
      updatedAt: "2026-07-24T22:00:04.000Z"
    });
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      expect(stale.proposal.status).toBe("stale");
    }

    expect(
      await proposals.reject({
        proposalId: PROPOSAL_ID,
        projectId: OTHER_PROJECT,
        expectedStatus: "ready",
        actorAccountId: OWNER,
        decidedAt: NOW,
        updatedAt: NOW
      })
    ).toEqual({ ok: false, reason: "cross-project" });
  });

  it("roundtrips typed proposal payloads exactly", async () => {
    const { receipts, runs, proposals } = await setupPostgresFoundation();
    await receipts.insertImmutable(sampleReceipt());
    await runs.create(queuedRun());
    await runs.transition({
      runId: RUN_ID,
      expectedStatus: "queued",
      next: runningRun()
    });
    const proposal = readyProposal();
    await proposals.create(proposal);
    const loaded = await proposals.get(PROPOSAL_ID);
    expect(loaded?.payload).toEqual(reflectionPayload);
    expect(loaded?.contentHash).toBe(CONTENT_HASH);
  });

  it("stores and filters entity-targeted proposals without a Capture base", async () => {
    const { receipts, runs, proposals } = await setupPostgresFoundation();
    await receipts.insertImmutable(sampleReceipt());
    await runs.create(queuedRun());
    const entityProposal = createReadyAgentProposal({
      ...readyProposal(),
      id: agentProposalId("proposal-scene-draft-pg"),
      primaryTarget: { kind: "scene", id: "scene-arrival-at-bellwether" },
      baseCaptureId: undefined,
      baseCaptureWorkingVersion: undefined,
      baseCaptureContentHash: undefined
    });
    await proposals.create(entityProposal);

    const matching = await proposals.listByProject(BELLWETHER_FIXTURE_PROJECT_ID, {
      targetKind: "scene",
      targetId: "scene-arrival-at-bellwether",
      status: "ready"
    });
    expect(matching).toEqual([entityProposal]);
    expect(
      await proposals.listByProject(BELLWETHER_FIXTURE_PROJECT_ID, {
        targetKind: "capture",
        targetId: BASE_CAPTURE
      })
    ).toEqual([]);
  });

  it("completes reflection atomically and rolls back on status conflict", async () => {
    const { runs, proposals, completion, receipts } = await setupPostgresFoundation();
    await receipts.insertImmutable(sampleReceipt());
    await runs.create(queuedRun());
    await expect(
      completion.completeReflection({
        run: readyRun(),
        proposal: readyProposal()
      })
    ).rejects.toBeInstanceOf(AgentRunStateConflictError);
    expect(await proposals.get(PROPOSAL_ID)).toBeUndefined();

    await runs.transition({
      runId: RUN_ID,
      expectedStatus: "queued",
      next: runningRun()
    });
    await completion.completeReflection({
      run: readyRun(),
      proposal: readyProposal()
    });
    expect((await runs.get(RUN_ID))?.status).toBe("ready");
    expect(await proposals.get(PROPOSAL_ID)).toBeDefined();
  });

  it("allows only one concurrent reflection completion winner", async () => {
    const { receipts, runs, completion } = await setupPostgresFoundation();
    await receipts.insertImmutable(sampleReceipt());
    await runs.create(queuedRun());
    await runs.transition({
      runId: RUN_ID,
      expectedStatus: "queued",
      next: runningRun()
    });
    const attempts = await Promise.allSettled([
      completion.completeReflection({
        run: readyRun(),
        proposal: readyProposal(RUN_ID, agentProposalId("proposal-agent-foundation-a"))
      }),
      completion.completeReflection({
        run: readyRun(),
        proposal: readyProposal(RUN_ID, agentProposalId("proposal-agent-foundation-b"))
      })
    ]);
    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.status === "rejected" && rejected[0].reason).toBeInstanceOf(
      AgentRunStateConflictError
    );
  });

  it("maps foreign-key failures to content-free persistence errors", async () => {
    const { receipts, runs, proposals } = await setupPostgresFoundation();
    await receipts.insertImmutable(sampleReceipt());
    await runs.create(queuedRun());
    await runs.transition({
      runId: RUN_ID,
      expectedStatus: "queued",
      next: runningRun()
    });
    await runs.transition({
      runId: RUN_ID,
      expectedStatus: "running",
      next: readyRun()
    });
    await expect(
      proposals.create(
        createReadyAgentProposal({
          ...readyProposal(),
          primaryTarget: {
            kind: "capture",
            id: captureId("capture-missing-fk")
          },
          baseCaptureId: captureId("capture-missing-fk")
        })
      )
    ).rejects.toThrow("Agent foundation persistence failed.");
  });

  it("matches memory repository outcomes for foundation ports", async () => {
    const memory = memoryFoundationRepos();
    const postgres = await setupPostgresFoundation();
    const receipt = sampleReceipt({ id: contextReceiptId("receipt-memory-parity") });

    const memoryReceipt = await memory.receipts.insertImmutable(receipt);
    const postgresReceipt = await postgres.receipts.insertImmutable(receipt);
    expect(postgresReceipt).toEqual(memoryReceipt);

    const run = queuedRun(agentRunId("run-memory-parity"));
    await memory.receipts.insertImmutable(receipt);
    const memoryRun = await memory.runs.create({
      ...run,
      receiptId: receipt.id
    });
    const postgresRun = await postgres.runs.create({
      ...run,
      receiptId: receipt.id
    });
    expect(postgresRun).toEqual(memoryRun);
  });

  describe("identity enforcement", () => {
    it.each([
      ["model", { model: "gpt-4.1-mini" as const }],
      ["receiptHash", { receiptHash: instructionContentHash("f".repeat(64)) }],
      ["initiatorAccountId", { initiatorAccountId: accountId("other-writer") }]
    ])("rejects run %s mutation during transition", async (_label, mutation) => {
      const { receipts, runs } = await setupPostgresFoundation();
      await receipts.insertImmutable(sampleReceipt());
      const created = await runs.create(queuedRun());
      if (!created.ok) throw new Error("Expected run creation.");
      const current = created.run;
      const outcome = await runs.transition({
        runId: current.id,
        expectedStatus: "queued",
        next: createAgentRun({
          ...current,
          ...mutation,
          status: "running",
          updatedAt: "2026-07-24T22:00:01.000Z"
        })
      });
      expect(outcome).toEqual({ ok: false, reason: "status-conflict" });
      expect(await runs.get(current.id)).toEqual(current);
    });

    it.each([
      [
        "payload",
        {
          payload: {
            ...reflectionPayload,
            summary: "Tampered summary."
          }
        }
      ],
      ["baseCaptureWorkingVersion", { baseCaptureWorkingVersion: 99 }],
      ["runId", { runId: agentRunId("run-tampered") }],
      [
        "baseCaptureContentHash",
        { baseCaptureContentHash: captureContentHash("f".repeat(64)) }
      ]
    ])("rejects proposal %s mutation during transition", async (_label, mutation) => {
      const { receipts, runs, proposals } = await setupPostgresFoundation();
      await receipts.insertImmutable(sampleReceipt());
      await runs.create(queuedRun());
      const created = await proposals.create(readyProposal());
      if (!created.ok) throw new Error("Expected proposal creation.");
      const current = created.proposal;
      const outcome = await proposals.transition({
        proposalId: current.id,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        expectedStatus: "ready",
        next: createAgentProposal({
          ...current,
          ...mutation,
          status: "stale",
          updatedAt: "2026-07-24T22:00:03.000Z"
        })
      });
      expect(outcome).toEqual({ ok: false, reason: "status-conflict" });
      expect(await proposals.get(current.id)).toEqual(current);
    });
  });
});
