import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import { DomainValidationError } from "./domain.js";
import type { AsyncHashPort } from "./agent-domain.js";
import { createAgentFoundationServices } from "./agent-foundation-services.js";
import { createAgentGuidanceServices } from "./agent-guidance-services.js";
import {
  createCaptureReflectionServices,
  type CaptureReflectionServices,
  type CaptureReflectionStructuredCompletionProvider
} from "./capture-reflection-services.js";
import {
  CaptureNotFoundError,
  captureContentHash,
  createCaptureDocumentHead,
  createCaptureRevision
} from "./capture-documents.js";
import { captureId, captureRevisionId } from "./domain.js";
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
import { createMemoryMcpGrantRepository } from "./memory-mcp-grant-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemoryStoryWorkAssignmentRepository } from "./memory-story-work-assignment-repository.js";
import { createMemoryStoryWorkCoordinationRepository } from "./memory-story-work-coordination-repository.js";
import { BELLWETHER_FIXTURE, BELLWETHER_FIXTURE_PROJECT_ID } from "./fixtures.js";
import {
  createMcpGrantServices,
  type McpGrantCaptureReflectionProviderFactory,
  type McpGrantServices
} from "./mcp-grant-services.js";
import {
  MCP_GRANT_CAPTURE_TOOL_NAMES,
  McpGrantCaptureDeniedError,
  McpGrantNotFoundError,
  McpGrantResourceDeniedError,
  McpGrantToolDeniedError,
  mcpGrantId,
  type McpGrantTokenPort
} from "./mcp-grants.js";
import {
  createStoryWorkAssignment,
  storyWorkAssignmentId
} from "./story-work-assignment.js";
import {
  createStoryWorkCoordination,
  storyWorkCoordinationId,
  storyWorkCoordinationStepId
} from "./story-work-coordination.js";
import { bookId, sceneId } from "./domain.js";
import type { DomainIdKind, IdGenerator } from "./project-repository.js";

const OWNER = accountId("account-mcp-grant-owner");
const STRANGER = accountId("account-mcp-grant-stranger");
const CAPTURE = captureId("capture-mcp-grant");
const OTHER_CAPTURE = captureId("capture-mcp-other");
const CONTENT_HASH = captureContentHash("c".repeat(64));
const NOW = "2026-07-24T23:30:00.000Z";

const reflectionPayload = Object.freeze({
  schemaId: "capture-reflection-v1" as const,
  summary: "Grant-backed fog signal proposal.",
  questions: Object.freeze(["Where does this belong?"]),
  possibleStoryJobs: Object.freeze([
    Object.freeze({
      label: "Opening beat",
      rationale: "Keeps the signal before the confrontation."
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
      return `${kind}-mcp-grant-${next}`;
    }
  };
}

function createTestTokenPort(hashPort: AsyncHashPort): McpGrantTokenPort {
  let counter = 0;
  return Object.freeze({
    mintPlaintext() {
      counter += 1;
      return `gw_mcp_grant_test_token_${String(counter).padStart(8, "0")}_secure`;
    },
    async hash(plaintext: string) {
      return (await hashPort.digestSha256Hex(`mcp-grant-token:${plaintext}`)) as never;
    }
  });
}

function captureHead(
  id = CAPTURE,
  body = "Signal in the fog under grant.",
  workingVersion = 2
) {
  return createCaptureDocumentHead({
    captureId: id,
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
    genesisRevisionId: captureRevisionId(`capture-rev-${id}-genesis`),
    authorAccountId: OWNER,
    updatedByAccountId: OWNER,
    createdAt: NOW,
    updatedAt: NOW
  });
}

async function seedCapture(
  captureDocuments: ReturnType<typeof createMemoryCaptureDocumentRepository>,
  targetHead = captureHead()
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

function createFakeProvider(): CaptureReflectionStructuredCompletionProvider {
  return Object.freeze({
    async completeStructured(input) {
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
          inputTokens: 9,
          outputTokens: 12,
          totalTokens: 21
        }),
        providerResponseId: "fake-resp-mcp-grant"
      });
    }
  });
}

type CaptureReflectionCallMetrics = Readonly<{
  previewCalls: number;
  startCalls: number;
  lastPreviewReceiptId?: string;
  lastStartReceiptId?: string;
}>;

function createHarness(): Readonly<{
  services: McpGrantServices;
  captureReflection: CaptureReflectionServices;
  captureReflectionMetrics: CaptureReflectionCallMetrics;
  captureDocuments: ReturnType<typeof createMemoryCaptureDocumentRepository>;
  storyWorkAssignments: ReturnType<typeof createMemoryStoryWorkAssignmentRepository>;
  storyWorkCoordinations: ReturnType<typeof createMemoryStoryWorkCoordinationRepository>;
}> {
  const receipts = createMemoryContextReceiptRepository();
  const runs = createMemoryAgentRunRepository();
  const proposals = createMemoryAgentProposalRepository();
  const captureDocuments = createMemoryCaptureDocumentRepository();
  const storyWorkAssignments = createMemoryStoryWorkAssignmentRepository();
  const storyWorkCoordinations = createMemoryStoryWorkCoordinationRepository();
  const grants = createMemoryMcpGrantRepository();
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
      return `2026-07-24T23:30:0${Math.min(tick, 9)}.000Z`;
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
  const captureReflectionBase = createCaptureReflectionServices({
    projects,
    captureDocuments,
    receipts,
    foundation,
    guidance,
    hashPort,
    ids,
    clock
  });
  const captureReflectionMetrics = {
    previewCalls: 0,
    startCalls: 0,
    lastPreviewReceiptId: undefined as string | undefined,
    lastStartReceiptId: undefined as string | undefined
  };
  const captureReflection: CaptureReflectionServices = {
    ...captureReflectionBase,
    async preview(input) {
      captureReflectionMetrics.previewCalls += 1;
      const receipt = await captureReflectionBase.preview(input);
      captureReflectionMetrics.lastPreviewReceiptId = receipt.id;
      return receipt;
    },
    async start(input) {
      captureReflectionMetrics.startCalls += 1;
      captureReflectionMetrics.lastStartReceiptId = input.receiptId;
      return captureReflectionBase.start(input);
    }
  };
  const services = createMcpGrantServices({
    projects,
    grants,
    captureDocuments,
    captureReflection,
    storyWorkAssignments,
    storyWorkCoordinations,
    tokens: createTestTokenPort(hashPort),
    ids,
    clock
  });
  return {
    services,
    captureReflection,
    captureReflectionMetrics,
    captureDocuments,
    storyWorkAssignments,
    storyWorkCoordinations
  };
}

describe("MCP grant services", () => {
  it("creates a project-scoped grant and returns the opaque token once", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    const created = await harness.services.createGrant({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureIds: [CAPTURE],
      tools: ["ghostwriter_get_grant", ...MCP_GRANT_CAPTURE_TOOL_NAMES],
      expiresAt: "2026-08-01T00:00:00.000Z"
    });
    expect(created.token.length).toBeGreaterThanOrEqual(24);
    expect(created.grant.tokenHint.endsWith(created.token.slice(-4))).toBe(true);
    expect(created.grant.captureIds).toEqual([CAPTURE]);
    expect(JSON.stringify(created.grant)).not.toContain(created.token);

    const listed = await harness.services.listGrants({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.grant.id);
    expect(JSON.stringify(listed)).not.toContain(created.token);
  });

  it("hides create from non-owners and missing captures", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    await expect(
      harness.services.createGrant({
        accountId: STRANGER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureIds: [CAPTURE],
        tools: ["ghostwriter_get_grant"],
        expiresAt: "2026-08-01T00:00:00.000Z"
      })
    ).rejects.toThrow();

    await expect(
      harness.services.createGrant({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureIds: [OTHER_CAPTURE],
        tools: ["ghostwriter_get_grant"],
        expiresAt: "2026-08-01T00:00:00.000Z"
      })
    ).rejects.toBeInstanceOf(CaptureNotFoundError);
  });

  it("resolves get_grant / read / assemble / propose under grant into Inbox proposals", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    const created = await harness.services.createGrant({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureIds: [CAPTURE],
      tools: ["ghostwriter_get_grant", ...MCP_GRANT_CAPTURE_TOOL_NAMES],
      expiresAt: "2026-08-01T00:00:00.000Z"
    });

    const effective = await harness.services.getGrantUnderToken(created.token);
    expect(effective).toEqual({
      id: created.grant.id,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureIds: [CAPTURE],
      sceneIds: [],
      bookIds: [],
      assignmentIds: [],
      coordinationIds: [],
      allowProjectStructureRead: false,
      tools: ["ghostwriter_get_grant", ...MCP_GRANT_CAPTURE_TOOL_NAMES].sort(),
      expiresAt: "2026-08-01T00:00:00.000Z"
    });

    const plain = await harness.services.readCaptureUnderToken({
      token: created.token,
      captureId: CAPTURE
    });
    expect(plain.plainTextSummary).toContain("fog");
    expect(plain).not.toHaveProperty("document");

    const receipt = await harness.services.assembleCaptureReflectionContextUnderToken({
      token: created.token,
      captureId: CAPTURE
    });
    expect(receipt.workflowId).toBe("scene-partner.capture-reflection");
    expect(receipt.resources[0]).toMatchObject({ resourceClass: "capture", captureId: CAPTURE });

    const proposed = await harness.services.proposeCaptureReflectionUnderToken({
      token: created.token,
      captureId: CAPTURE,
      provider: createFakeProvider()
    });
    expect(proposed.kind).toBe("ready");
    if (proposed.kind !== "ready") return;

    const listed = await harness.captureReflection.listProposalSummaries({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(proposed.proposal.id);
    expect(listed[0]?.status).toBe("ready");
  });

  it("proposes capture reflection with an internal receipt factory without assemble/read tools", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    const created = await harness.services.createGrant({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureIds: [CAPTURE],
      tools: ["ghostwriter_get_grant", "ghostwriter_propose_capture_reflection"],
      expiresAt: "2026-08-01T00:00:00.000Z"
    });

    let factoryCalls = 0;
    let factoryReceiptId: string | undefined;
    const createProvider: McpGrantCaptureReflectionProviderFactory = async (receipt) => {
      factoryCalls += 1;
      factoryReceiptId = receipt.id;
      expect(receipt.workflowId).toBe("scene-partner.capture-reflection");
      expect(receipt.resources[0]).toMatchObject({
        resourceClass: "capture",
        captureId: CAPTURE
      });
      return createFakeProvider();
    };

    const proposed = await harness.services.proposeCaptureReflectionUnderToken({
      token: created.token,
      captureId: CAPTURE,
      createProvider
    });
    expect(proposed.kind).toBe("ready");
    expect(harness.captureReflectionMetrics.previewCalls).toBe(1);
    expect(harness.captureReflectionMetrics.startCalls).toBe(1);
    expect(factoryCalls).toBe(1);
    expect(factoryReceiptId).toBe(harness.captureReflectionMetrics.lastPreviewReceiptId);
    expect(harness.captureReflectionMetrics.lastStartReceiptId).toBe(
      harness.captureReflectionMetrics.lastPreviewReceiptId
    );

    await expect(
      harness.services.assembleCaptureReflectionContextUnderToken({
        token: created.token,
        captureId: CAPTURE
      })
    ).rejects.toBeInstanceOf(McpGrantToolDeniedError);
  });

  it("rejects invalid provider modes and denies bad captures before the factory runs", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    const created = await harness.services.createGrant({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureIds: [CAPTURE],
      tools: ["ghostwriter_get_grant", "ghostwriter_propose_capture_reflection"],
      expiresAt: "2026-08-01T00:00:00.000Z"
    });

    await expect(
      harness.services.proposeCaptureReflectionUnderToken({
        token: created.token,
        captureId: CAPTURE,
        provider: createFakeProvider(),
        createProvider: async () => createFakeProvider()
      } as never)
    ).rejects.toBeInstanceOf(DomainValidationError);

    await expect(
      harness.services.proposeCaptureReflectionUnderToken({
        token: created.token,
        captureId: CAPTURE
      } as never)
    ).rejects.toBeInstanceOf(DomainValidationError);

    const previewCallsBefore = harness.captureReflectionMetrics.previewCalls;
    let factoryCalled = false;
    await expect(
      harness.services.proposeCaptureReflectionUnderToken({
        token: created.token,
        captureId: OTHER_CAPTURE,
        createProvider: async () => {
          factoryCalled = true;
          return createFakeProvider();
        }
      })
    ).rejects.toBeInstanceOf(McpGrantCaptureDeniedError);
    expect(factoryCalled).toBe(false);
    expect(harness.captureReflectionMetrics.previewCalls).toBe(previewCallsBefore);
  });

  it("non-discloses missing, revoked, and unauthorized capture/tool access", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    await seedCapture(harness.captureDocuments, captureHead(OTHER_CAPTURE, "Other capture."));

    const created = await harness.services.createGrant({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureIds: [CAPTURE],
      tools: ["ghostwriter_get_grant", "ghostwriter_read_capture"],
      expiresAt: "2026-08-01T00:00:00.000Z"
    });

    await expect(
      harness.services.getGrantUnderToken("not-a-real-token-value-xxxxxx")
    ).rejects.toBeInstanceOf(McpGrantNotFoundError);

    await expect(
      harness.services.readCaptureUnderToken({
        token: created.token,
        captureId: OTHER_CAPTURE
      })
    ).rejects.toBeInstanceOf(McpGrantCaptureDeniedError);

    await expect(
      harness.services.assembleCaptureReflectionContextUnderToken({
        token: created.token,
        captureId: CAPTURE
      })
    ).rejects.toBeInstanceOf(McpGrantToolDeniedError);

    await harness.services.revokeGrant({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      grantId: created.grant.id
    });
    await expect(
      harness.services.getGrantUnderToken(created.token)
    ).rejects.toBeInstanceOf(McpGrantNotFoundError);
  });

  it("creates story-work grants without captures and enforces access under token", async () => {
    const harness = createHarness();
    const explicitAssignment = storyWorkAssignmentId("assignment-grant-explicit");
    const foreignAssignment = storyWorkAssignmentId("assignment-grant-foreign");
    const explicitCoordination = storyWorkCoordinationId("coordination-grant-explicit");
    const scene = sceneId("scene-arrival-at-bellwether");
    const book = bookId("book-signal-at-bellwether");

    const assignmentBase = {
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      initiatorAccountId: OWNER,
      version: 1,
      taskKind: "character" as const,
      brief: "Brief",
      constraints: "Constraints",
      doneWhen: "Done",
      sources: [
        { kind: "project" as const, projectId: BELLWETHER_FIXTURE_PROJECT_ID, projectVersion: 1 }
      ],
      destination: {
        kind: "story-knowledge" as const,
        storyKnowledgeId: "knowledge-mara-venn" as never,
        operation: "create" as const
      },
      provider: "openai" as const,
      model: "gpt-4.1" as never,
      status: "brief-ready" as const,
      steps: [{ id: "step-1", title: "Step", dependencies: [] }],
      results: [],
      idempotencyKey: "idem-explicit",
      createdAt: NOW,
      updatedAt: NOW
    };
    await harness.storyWorkAssignments.create({
      assignment: createStoryWorkAssignment({
        ...assignmentBase,
        id: explicitAssignment
      }),
      requestFingerprint: "f".repeat(64) as never
    });
    await harness.storyWorkAssignments.create({
      assignment: createStoryWorkAssignment({
        ...assignmentBase,
        id: foreignAssignment,
        idempotencyKey: "idem-foreign",
        origin: { kind: "mcp", grantId: mcpGrantId("grant-other") }
      }),
      requestFingerprint: "e".repeat(64) as never
    });
    await harness.storyWorkCoordinations.create({
      coordination: createStoryWorkCoordination({
        id: explicitCoordination,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        initiatorAccountId: OWNER,
        version: 1,
        title: "Coordination",
        status: "active",
        steps: [
          {
            kind: "scene-draft",
            stepId: storyWorkCoordinationStepId("coord-step-scene"),
            title: "Draft",
            assignmentId: explicitAssignment
          },
          {
            kind: "proposal-continuity-check",
            stepId: storyWorkCoordinationStepId("coord-step-check"),
            title: "Check",
            dependencies: [
              {
                stepId: storyWorkCoordinationStepId("coord-step-scene"),
                requiredState: "artifact-ready"
              }
            ],
            deferred: {
              brief: "Brief",
              constraints: "Constraints",
              doneWhen: "Done",
              model: "gpt-4.1" as never
            }
          }
        ],
        idempotencyKey: "coord-idem",
        createdAt: NOW,
        updatedAt: NOW
      }),
      requestFingerprint: "c".repeat(64) as never
    });

    const created = await harness.services.createGrant({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneIds: [scene],
      bookIds: [book],
      assignmentIds: [explicitAssignment],
      coordinationIds: [explicitCoordination],
      allowProjectStructureRead: true,
      tools: ["ghostwriter_get_grant", "ghostwriter_list_story_work"],
      expiresAt: "2026-08-01T00:00:00.000Z"
    });
    expect(created.grant.captureIds).toEqual([]);

    const record = await harness.services.resolveActiveGrantRecordFromToken(
      created.token
    );
    await harness.services.assertAssignmentReadableUnderGrant({
      record,
      assignmentId: explicitAssignment
    });
    await expect(
      harness.services.assertAssignmentReadableUnderGrant({
        record,
        assignmentId: foreignAssignment
      })
    ).rejects.toBeInstanceOf(McpGrantResourceDeniedError);
  });
});
