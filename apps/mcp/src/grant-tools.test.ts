import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  MCP_GRANT_TOOL_NAMES,
  accountId,
  captureContentHash,
  captureId,
  captureRevisionId,
  createAgentFoundationServices,
  createAgentGuidanceServices,
  createCaptureDocumentHead,
  createCaptureReflectionServices,
  createCaptureRevision,
  createMcpGrantServices,
  createMemoryAccountAiCollaborationProfileRepository,
  createMemoryAgentProposalRepository,
  createMemoryAgentRunReflectionCompletionUnitOfWork,
  createMemoryAgentRunRepository,
  createMemoryCaptureDocumentRepository,
  createMemoryContextReceiptRepository,
  createMemoryMcpGrantRepository,
  createMemoryProjectAgentInstructionsRepository,
  createMemoryProjectPlaybookRepository,
  createMemoryProjectRepository,
  createProjectMembership,
  type AsyncHashPort,
  type CaptureReflectionStructuredCompletionProvider,
  type DomainIdKind,
  type IdGenerator,
  type McpGrantTokenPort
} from "@ghostwriter/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  ASSEMBLE_CAPTURE_REFLECTION_CONTEXT_TOOL_NAME,
  GET_GRANT_TOOL_NAME,
  PROPOSE_CAPTURE_REFLECTION_TOOL_NAME,
  READ_CAPTURE_TOOL_NAME,
  createGhostwriterMcpServer
} from "./server.js";

const OWNER = accountId("account-mcp-tool-owner");
const CAPTURE = captureId("capture-mcp-tool");
const CONTENT_HASH = captureContentHash("e".repeat(64));
const NOW = "2026-07-24T23:50:00.000Z";

const reflectionPayload = Object.freeze({
  schemaId: "capture-reflection-v1" as const,
  summary: "Inbox-visible proposal from MCP grant tools.",
  questions: Object.freeze(["Which scene absorbs this fog?"]),
  possibleStoryJobs: Object.freeze([
    Object.freeze({
      label: "Harbor beat",
      rationale: "Keeps the weather before confrontation."
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
      return `${kind}-mcp-tool-${next}`;
    }
  };
}

function createTestTokenPort(hashPort: AsyncHashPort): McpGrantTokenPort {
  let counter = 0;
  return Object.freeze({
    mintPlaintext() {
      counter += 1;
      return `gw_mcp_tool_token_${String(counter).padStart(8, "0")}_secure`;
    },
    async hash(plaintext: string) {
      return (await hashPort.digestSha256Hex(`mcp-grant-token:${plaintext}`)) as never;
    }
  });
}

async function seedCapture(
  captureDocuments: ReturnType<typeof createMemoryCaptureDocumentRepository>
) {
  const targetHead = createCaptureDocumentHead({
    captureId: CAPTURE,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
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
            attrs: { id: "block-1" },
            content: [{ type: "text", text: "Fog under an MCP grant." }]
          }
        ]
      }
    }),
    contentHash: CONTENT_HASH,
    genesisRevisionId: captureRevisionId("capture-rev-mcp-tool-genesis"),
    authorAccountId: OWNER,
    updatedByAccountId: OWNER,
    createdAt: NOW,
    updatedAt: NOW
  });
  const genesisHead = createCaptureDocumentHead({
    ...targetHead,
    status: "draft",
    workingVersion: 1
  });
  await captureDocuments.initialize({
    head: genesisHead,
    genesisRevision: createCaptureRevision({
      id: genesisHead.genesisRevisionId,
      captureId: genesisHead.captureId,
      projectId: genesisHead.projectId,
      document: genesisHead.document,
      contentHash: genesisHead.contentHash,
      actorAccountId: genesisHead.authorAccountId,
      origin: "human",
      reason: "genesis",
      createdAt: genesisHead.createdAt
    })
  });
  const saved = await captureDocuments.saveWorkingDocument({
    projectId: targetHead.projectId,
    captureId: targetHead.captureId,
    expectedWorkingVersion: 1,
    document: targetHead.document,
    contentHash: targetHead.contentHash,
    actorAccountId: targetHead.authorAccountId,
    now: targetHead.updatedAt
  });
  if (!saved.ok) throw new Error("Failed to seed capture.");
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
          inputTokens: 5,
          outputTokens: 7,
          totalTokens: 12
        }),
        providerResponseId: "fake-resp-mcp-tool"
      });
    }
  });
}

async function createGrantHarness() {
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
      return `2026-07-24T23:50:0${Math.min(tick, 9)}.000Z`;
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
  const grantServices = createMcpGrantServices({
    projects,
    grants,
    captureDocuments,
    captureReflection,
    tokens: createTestTokenPort(hashPort),
    ids,
    clock
  });
  await seedCapture(captureDocuments);
  const created = await grantServices.createGrant({
    accountId: OWNER,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    captureIds: [CAPTURE],
    tools: [...MCP_GRANT_TOOL_NAMES],
    expiresAt: "2026-08-01T00:00:00.000Z"
  });
  return {
    token: created.token,
    grantServices,
    captureReflection,
    provider: createFakeProvider()
  };
}

describe("MCP grant tools (memory)", () => {
  it("lists grant tools and proposes a Capture reflection that lands in Inbox", async () => {
    const harness = await createGrantHarness();
    const server = createGhostwriterMcpServer({
      grantRuntime: {
        token: harness.token,
        grants: harness.grantServices,
        provider: harness.provider
      }
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: "ghostwriter-mcp-grant-test",
      version: "0.0.0"
    });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain(GET_GRANT_TOOL_NAME);
      expect(names).toContain(READ_CAPTURE_TOOL_NAME);
      expect(names).toContain(ASSEMBLE_CAPTURE_REFLECTION_CONTEXT_TOOL_NAME);
      expect(names).toContain(PROPOSE_CAPTURE_REFLECTION_TOOL_NAME);

      const grant = await client.callTool({
        name: GET_GRANT_TOOL_NAME,
        arguments: {}
      });
      expect(grant.isError).not.toBe(true);
      expect(grant.structuredContent).toMatchObject({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureIds: [CAPTURE]
      });

      const read = await client.callTool({
        name: READ_CAPTURE_TOOL_NAME,
        arguments: { captureId: CAPTURE }
      });
      expect(read.isError).not.toBe(true);
      expect(read.structuredContent).toMatchObject({
        captureId: CAPTURE,
        plainTextSummary: expect.stringContaining("Fog")
      });

      const assembled = await client.callTool({
        name: ASSEMBLE_CAPTURE_REFLECTION_CONTEXT_TOOL_NAME,
        arguments: { captureId: CAPTURE }
      });
      expect(assembled.isError).not.toBe(true);
      expect(assembled.structuredContent).toMatchObject({
        workflowId: "scene-partner.capture-reflection"
      });

      const proposed = await client.callTool({
        name: PROPOSE_CAPTURE_REFLECTION_TOOL_NAME,
        arguments: { captureId: CAPTURE }
      });
      expect(proposed.isError).not.toBe(true);
      expect(proposed.structuredContent).toMatchObject({
        kind: "ready",
        status: "ready"
      });
      const proposalId = (proposed.structuredContent as { proposalId?: string })
        .proposalId;
      expect(proposalId).toBeTruthy();

      const inbox = await harness.captureReflection.listProposalSummaries({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID
      });
      expect(inbox).toHaveLength(1);
      expect(inbox[0]?.id).toBe(proposalId);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
