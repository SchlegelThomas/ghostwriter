import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { GET_GRANT_TOOL_NAME } from "./grant-tools.js";
import type { LocalBridgeClient } from "./local-bridge-client.js";
import { createGhostwriterMcpServer } from "./server.js";
import {
  GET_STORY_WORK_TOOL_NAME,
  LIST_STORY_WORK_COORDINATIONS_TOOL_NAME,
  LIST_STORY_WORK_TOOL_NAME,
  MCP_BRIDGE_TOOL_NAMES
} from "./story-work-grant-tools.js";

function createStubBridgeClient(
  handlers: Partial<
    Record<
      keyof LocalBridgeClient,
      (...args: never[]) => Promise<unknown>
    >
  >
): LocalBridgeClient {
  return Object.freeze({
    async getGrant() {
      return handlers.getGrant?.() ?? { id: "grant-stub" };
    },
    async listStoryWork() {
      return handlers.listStoryWork?.() ?? { assignments: [] };
    },
    async getStoryWork(assignmentId: string) {
      return (
        handlers.getStoryWork?.(assignmentId as never) ?? {
          assignment: { id: assignmentId }
        }
      );
    },
    async listStoryWorkCoordinations() {
      return handlers.listStoryWorkCoordinations?.() ?? { coordinations: [] };
    },
    async getStoryWorkCoordination(coordinationId: string) {
      return (
        handlers.getStoryWorkCoordination?.(coordinationId as never) ?? {
          coordination: { id: coordinationId }
        }
      );
    },
    async submitCharacterWork() {
      throw new Error("submitCharacterWork not stubbed");
    },
    async submitSceneWork() {
      throw new Error("submitSceneWork not stubbed");
    },
    async submitCheckWork() {
      throw new Error("submitCheckWork not stubbed");
    },
    async submitStructureWork() {
      throw new Error("submitStructureWork not stubbed");
    },
    async previewStoryStructure() {
      throw new Error("previewStoryStructure not stubbed");
    },
    async createStoryWorkCoordination() {
      throw new Error("createStoryWorkCoordination not stubbed");
    },
    async continueStoryWorkCoordinationStep() {
      throw new Error("continueStoryWorkCoordinationStep not stubbed");
    },
    async readCapture() {
      throw new Error("readCapture not stubbed");
    },
    async assembleCaptureReflectionContext() {
      throw new Error("assembleCaptureReflectionContext not stubbed");
    },
    async proposeCaptureReflection() {
      throw new Error("proposeCaptureReflection not stubbed");
    }
  });
}

describe("story-work grant bridge tools", () => {
  it("registers fifteen closed bridge tools in bridge-only mode", async () => {
    const server = createGhostwriterMcpServer({
      bridgeClient: createStubBridgeClient({})
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "bridge-tools-test", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
        [...MCP_BRIDGE_TOOL_NAMES].sort()
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns nondisclosing errors from bridge failures", async () => {
    const server = createGhostwriterMcpServer({
      bridgeClient: createStubBridgeClient({
        async getGrant() {
          throw new Error("secret should not leak");
        }
      })
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "bridge-error-test", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: GET_GRANT_TOOL_NAME,
        arguments: {}
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ text?: string }> | undefined;
      expect(content?.[0]).toMatchObject({ text: "Request failed." });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("invokes list and get story work through the bridge client", async () => {
    let listed = false;
    let fetchedId: string | undefined;
    const server = createGhostwriterMcpServer({
      bridgeClient: createStubBridgeClient({
        async listStoryWork() {
          listed = true;
          return {
            assignments: [
              {
                id: "assignment-a",
                projectId: "project-a",
                version: 1,
                taskKind: "character",
                brief: "Brief",
                constraints: "Constraints",
                doneWhen: "Done",
                status: "ready",
                model: "gpt-4.1",
                createdAt: "2026-07-01T00:00:00.000Z",
                updatedAt: "2026-07-01T00:00:00.000Z"
              }
            ]
          };
        },
        async getStoryWork(assignmentId) {
          fetchedId = assignmentId;
          return {
            assignment: {
              id: assignmentId,
              projectId: "project-a",
              version: 1,
              taskKind: "character",
              brief: "Brief",
              constraints: "Constraints",
              doneWhen: "Done",
              status: "ready",
              model: "gpt-4.1",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            }
          };
        }
      })
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "bridge-read-test", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const list = await client.callTool({
        name: LIST_STORY_WORK_TOOL_NAME,
        arguments: {}
      });
      expect(listed).toBe(true);
      expect(list.isError).not.toBe(true);

      const detail = await client.callTool({
        name: GET_STORY_WORK_TOOL_NAME,
        arguments: { assignmentId: "assignment-a" }
      });
      expect(fetchedId).toBe("assignment-a");
      expect(detail.isError).not.toBe(true);

      const coordinations = await client.callTool({
        name: LIST_STORY_WORK_COORDINATIONS_TOOL_NAME,
        arguments: {}
      });
      expect(coordinations.isError).not.toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
