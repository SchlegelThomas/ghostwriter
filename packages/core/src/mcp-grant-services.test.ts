import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import type { AsyncHashPort } from "./agent-domain.js";
import { createAgentFoundationServices } from "./agent-foundation-services.js";
import { createAgentGuidanceServices } from "./agent-guidance-services.js";
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
import { BELLWETHER_FIXTURE, BELLWETHER_FIXTURE_PROJECT_ID } from "./fixtures.js";
import {
  createMcpGrantServices,
  type McpGrantServices
} from "./mcp-grant-services.js";
import {
  MCP_GRANT_TOOL_NAMES,
  McpGrantCaptureDeniedError,
  McpGrantNotFoundError,
  McpGrantToolDeniedError,
  type McpGrantTokenPort
} from "./mcp-grants.js";
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

function createHarness(): Readonly<{
  services: McpGrantServices;
  captureReflection: ReturnType<typeof createCaptureReflectionServices>;
  captureDocuments: ReturnType<typeof createMemoryCaptureDocumentRepository>;
}> {
  const receipts = createMemoryContextReceiptRepository();
  const runs = createMemoryAgentRunRepository();
  const proposals = createMemoryAgentProposalRepository();
  const captureDocuments = createMemoryCaptureDocumentRepository();
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
  const captureReflection = createCaptureReflectionServices({
    projects,
    captureDocuments,
    receipts,
    foundation,
    guidance,
    hashPort,
    ids,
    clock
  });
  const services = createMcpGrantServices({
    projects,
    grants,
    captureDocuments,
    captureReflection,
    tokens: createTestTokenPort(hashPort),
    ids,
    clock
  });
  return { services, captureReflection, captureDocuments };
}

describe("MCP grant services", () => {
  it("creates a project-scoped grant and returns the opaque token once", async () => {
    const harness = createHarness();
    await seedCapture(harness.captureDocuments);
    const created = await harness.services.createGrant({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureIds: [CAPTURE],
      tools: [...MCP_GRANT_TOOL_NAMES],
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
      tools: [...MCP_GRANT_TOOL_NAMES],
      expiresAt: "2026-08-01T00:00:00.000Z"
    });

    const effective = await harness.services.getGrantUnderToken(created.token);
    expect(effective).toEqual({
      id: created.grant.id,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureIds: [CAPTURE],
      tools: [...MCP_GRANT_TOOL_NAMES].sort(),
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
    expect(receipt.resources[0]?.captureId).toBe(CAPTURE);

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
});
