import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  ASSEMBLE_CAPTURE_REFLECTION_CONTEXT_TOOL_NAME,
  PROPOSE_CAPTURE_REFLECTION_TOOL_NAME,
  READ_CAPTURE_TOOL_NAME
} from "./grant-tools.js";
import { LocalBridgeNotFoundError, type LocalBridgeClient } from "./local-bridge-client.js";
import { createGhostwriterMcpServer } from "./server.js";

function createCaptureBridgeClient(
  handlers: Partial<LocalBridgeClient> = {}
): LocalBridgeClient {
  return Object.freeze({
    async getGrant() {
      return handlers.getGrant?.() ?? { id: "grant-stub" };
    },
    async listStoryWork() {
      return { assignments: [] };
    },
    async getStoryWork(assignmentId: string) {
      return { assignment: { id: assignmentId } };
    },
    async listStoryWorkCoordinations() {
      return { coordinations: [] };
    },
    async getStoryWorkCoordination(coordinationId: string) {
      return { coordination: { id: coordinationId } };
    },
    async submitCharacterWork() {
      throw new Error("not stubbed");
    },
    async submitSceneWork() {
      throw new Error("not stubbed");
    },
    async submitCheckWork() {
      throw new Error("not stubbed");
    },
    async submitStructureWork() {
      throw new Error("not stubbed");
    },
    async previewStoryStructure() {
      throw new Error("not stubbed");
    },
    async createStoryWorkCoordination() {
      throw new Error("not stubbed");
    },
    async continueStoryWorkCoordinationStep() {
      throw new Error("not stubbed");
    },
    async readCapture(captureId) {
      return (
        handlers.readCapture?.(captureId) ?? {
          captureId,
          projectId: "project-1",
          status: "ready",
          sourceModality: "text",
          workingVersion: 1,
          contentHash: "d".repeat(64),
          plainTextSummary: "Fog under grant.",
          truncated: false,
          updatedAt: "2026-07-01T00:00:00.000Z"
        }
      );
    },
    async assembleCaptureReflectionContext(captureId) {
      return (
        handlers.assembleCaptureReflectionContext?.(captureId) ?? {
          id: "receipt-1",
          projectId: "project-1",
          workflowId: "scene-partner.capture-reflection",
          receiptHash: "e".repeat(64),
          model: "gpt-4.1",
          createdAt: "2026-07-01T00:00:00.000Z"
        }
      );
    },
    async proposeCaptureReflection(captureId) {
      return (
        handlers.proposeCaptureReflection?.(captureId) ?? {
          kind: "ready",
          runId: "run-1",
          proposalId: "proposal-1",
          status: "ready"
        }
      );
    }
  });
}

describe("capture grant bridge tools", () => {
  it("reads, assembles context, and proposes through the bridge client", async () => {
    const calls: string[] = [];
    const server = createGhostwriterMcpServer({
      bridgeClient: createCaptureBridgeClient({
        async readCapture(captureId) {
          calls.push(`read:${captureId}`);
          return {
            captureId,
            projectId: "project-1",
            status: "ready",
            sourceModality: "text",
            workingVersion: 1,
            contentHash: "a".repeat(64),
            plainTextSummary: "Fog",
            truncated: false,
            updatedAt: "2026-07-01T00:00:00.000Z"
          };
        },
        async assembleCaptureReflectionContext(captureId) {
          calls.push(`context:${captureId}`);
          return {
            id: "receipt-1",
            projectId: "project-1",
            workflowId: "scene-partner.capture-reflection",
            receiptHash: "b".repeat(64),
            model: "gpt-4.1",
            createdAt: "2026-07-01T00:00:00.000Z"
          };
        },
        async proposeCaptureReflection(captureId) {
          calls.push(`propose:${captureId}`);
          return {
            kind: "ready",
            runId: "run-1",
            proposalId: "proposal-1",
            status: "ready"
          };
        }
      })
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "capture-bridge-test", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const captureId = "capture-mcp-bridge-test";
      expect(
        (await client.callTool({
          name: READ_CAPTURE_TOOL_NAME,
          arguments: { captureId }
        })).isError
      ).not.toBe(true);

      expect(
        (await client.callTool({
          name: ASSEMBLE_CAPTURE_REFLECTION_CONTEXT_TOOL_NAME,
          arguments: { captureId }
        })).isError
      ).not.toBe(true);

      const proposed = await client.callTool({
        name: PROPOSE_CAPTURE_REFLECTION_TOOL_NAME,
        arguments: { captureId }
      });
      expect(proposed.isError).not.toBe(true);
      expect(proposed.structuredContent).toMatchObject({ kind: "ready" });

      expect(calls).toEqual([
        `read:${captureId}`,
        `context:${captureId}`,
        `propose:${captureId}`
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("proposes without requiring assemble when bridge returns ready", async () => {
    const server = createGhostwriterMcpServer({
      bridgeClient: createCaptureBridgeClient({
        async assembleCaptureReflectionContext() {
          throw new LocalBridgeNotFoundError();
        }
      })
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "propose-only", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const propose = await client.callTool({
        name: PROPOSE_CAPTURE_REFLECTION_TOOL_NAME,
        arguments: { captureId: "capture-propose-only" }
      });
      expect(propose.isError).not.toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns nondisclosing errors for bridge denials", async () => {
    const server = createGhostwriterMcpServer({
      bridgeClient: createCaptureBridgeClient({
        async readCapture() {
          throw new LocalBridgeNotFoundError();
        }
      })
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "capture-denied", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const denied = await client.callTool({
        name: READ_CAPTURE_TOOL_NAME,
        arguments: { captureId: "capture-denied" }
      });
      expect(denied.isError).toBe(true);
      expect((denied.content as Array<{ text?: string }>)?.[0]?.text).toBe("Not found.");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
