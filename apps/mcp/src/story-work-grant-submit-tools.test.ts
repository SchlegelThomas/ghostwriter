import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { LocalBridgeClient, LocalBridgeSubmitResponse } from "./local-bridge-client.js";
import { createGhostwriterMcpServer } from "./server.js";
import {
  SUBMIT_CHARACTER_WORK_TOOL_NAME,
  SUBMIT_CHECK_WORK_TOOL_NAME,
  SUBMIT_SCENE_WORK_TOOL_NAME,
  SUBMIT_STRUCTURE_WORK_TOOL_NAME
} from "./story-work-grant-submit-tools.js";

const SCENE_ID = "scene-test-mcp-bridge";
const BOOK_ID = "book-test-mcp-bridge";

function sampleAssignment(id: string) {
  return {
    id,
    projectId: "project-test",
    version: 1,
    taskKind: "character",
    brief: "Brief",
    constraints: "Constraints",
    doneWhen: "Done",
    status: "ready",
    model: "gpt-4.1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  };
}

function characterBody(overrides: Record<string, unknown> = {}) {
  return {
    expectedProjectVersion: 1,
    assignmentIdempotencyKey: `assignment-${randomUUID()}`,
    attemptIdempotencyKey: `attempt-${randomUUID()}`,
    brief: "  Develop the navigator.  ",
    constraints: "Use only supplied context.",
    doneWhen: "A dossier is ready for review.",
    sceneIds: [SCENE_ID],
    model: "gpt-4.1",
    ...overrides
  };
}

function createRecordingBridgeClient(
  handlers: Partial<{
    submitCharacterWork: (
      body: ReturnType<typeof characterBody>
    ) => Promise<LocalBridgeSubmitResponse>;
    submitSceneWork: (body: unknown) => Promise<LocalBridgeSubmitResponse>;
    submitCheckWork: (body: unknown) => Promise<LocalBridgeSubmitResponse>;
    submitStructureWork: (body: unknown) => Promise<LocalBridgeSubmitResponse>;
  }>
): LocalBridgeClient {
  const ready = (assignmentId: string): LocalBridgeSubmitResponse =>
    Object.freeze({
      assignment: sampleAssignment(assignmentId),
      created: true,
      generation: Object.freeze({
        kind: "ready",
        state: Object.freeze({
          attempt: Object.freeze({ instruction: "  Develop the navigator.  " })
        })
      })
    });
  return Object.freeze({
    async getGrant() {
      return { id: "grant-stub" };
    },
    async listStoryWork() {
      return { assignments: [] };
    },
    async getStoryWork(assignmentId: string) {
      return { assignment: sampleAssignment(assignmentId) };
    },
    async listStoryWorkCoordinations() {
      return { coordinations: [] };
    },
    async getStoryWorkCoordination(coordinationId: string) {
      return { coordination: { id: coordinationId } };
    },
    async submitCharacterWork(body) {
      return (
        handlers.submitCharacterWork?.(body) ??
        ready(`assignment-${randomUUID()}`)
      );
    },
    async submitSceneWork(body) {
      return handlers.submitSceneWork?.(body) ?? ready(`scene-${randomUUID()}`);
    },
    async submitCheckWork(body) {
      return handlers.submitCheckWork?.(body) ?? ready(`check-${randomUUID()}`);
    },
    async submitStructureWork(body) {
      return (
        handlers.submitStructureWork?.(body) ?? ready(`structure-${randomUUID()}`)
      );
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

describe("story-work grant bridge submit tools", () => {
  it("invokes all four submit tools with bounded bridge bodies", async () => {
    const calls: Array<{ tool: string; body: unknown }> = [];
    const server = createGhostwriterMcpServer({
      bridgeClient: createRecordingBridgeClient({
        async submitCharacterWork(body) {
          calls.push({ tool: SUBMIT_CHARACTER_WORK_TOOL_NAME, body });
          return Object.freeze({
            assignment: sampleAssignment("assignment-char"),
            created: true,
            generation: { kind: "ready", state: { attempt: { instruction: body.brief } } }
          });
        },
        async submitSceneWork(body) {
          calls.push({ tool: SUBMIT_SCENE_WORK_TOOL_NAME, body });
          return Object.freeze({
            assignment: { ...sampleAssignment("assignment-scene"), taskKind: "scene" },
            created: true,
            generation: { kind: "ready", state: {} }
          });
        },
        async submitCheckWork(body) {
          calls.push({ tool: SUBMIT_CHECK_WORK_TOOL_NAME, body });
          return Object.freeze({
            assignment: { ...sampleAssignment("assignment-check"), taskKind: "check" },
            created: true,
            generation: { kind: "ready", state: {} }
          });
        },
        async submitStructureWork(body) {
          calls.push({ tool: SUBMIT_STRUCTURE_WORK_TOOL_NAME, body });
          return Object.freeze({
            assignment: { ...sampleAssignment("assignment-structure"), taskKind: "outline" },
            created: true,
            generation: { kind: "ready", state: {} }
          });
        }
      })
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "submit-tools-test", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const charBody = characterBody();
      const character = await client.callTool({
        name: SUBMIT_CHARACTER_WORK_TOOL_NAME,
        arguments: charBody
      });
      expect(character.isError).not.toBe(true);
      expect(character.structuredContent).toMatchObject({
        created: true,
        generation: { kind: "ready" }
      });

      const sceneBody = {
        ...characterBody({ sceneIds: [SCENE_ID] }),
        assignmentIdempotencyKey: `scene-assignment-${randomUUID()}`,
        attemptIdempotencyKey: `scene-attempt-${randomUUID()}`
      };
      expect((await client.callTool({
        name: SUBMIT_SCENE_WORK_TOOL_NAME,
        arguments: sceneBody
      })).isError).not.toBe(true);

      const checkBody = {
        ...characterBody({ sceneIds: [] }),
        assignmentIdempotencyKey: `check-assignment-${randomUUID()}`,
        attemptIdempotencyKey: `check-attempt-${randomUUID()}`,
        specialist: "continuity" as const,
        checkMode: "applied-scene" as const,
        targetSceneId: SCENE_ID
      };
      expect((await client.callTool({
        name: SUBMIT_CHECK_WORK_TOOL_NAME,
        arguments: checkBody
      })).isError).not.toBe(true);

      const structureBody = {
        ...characterBody(),
        assignmentIdempotencyKey: `structure-assignment-${randomUUID()}`,
        attemptIdempotencyKey: `structure-attempt-${randomUUID()}`,
        targetBookId: BOOK_ID
      };
      expect((await client.callTool({
        name: SUBMIT_STRUCTURE_WORK_TOOL_NAME,
        arguments: structureBody
      })).isError).not.toBe(true);

      expect(calls.map((call) => call.tool)).toEqual([
        SUBMIT_CHARACTER_WORK_TOOL_NAME,
        SUBMIT_SCENE_WORK_TOOL_NAME,
        SUBMIT_CHECK_WORK_TOOL_NAME,
        SUBMIT_STRUCTURE_WORK_TOOL_NAME
      ]);
      expect(calls[0]?.body).toMatchObject({
        brief: charBody.brief,
        attemptIdempotencyKey: charBody.attemptIdempotencyKey
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("maps bridge submit failures to safe MCP errors without leaking details", async () => {
    const { LocalBridgeNotFoundError, LocalBridgeConflictError, LocalBridgeUnavailableError } =
      await import("./local-bridge-client.js");
    const server = createGhostwriterMcpServer({
      bridgeClient: createRecordingBridgeClient({
        async submitCharacterWork() {
          throw new LocalBridgeNotFoundError();
        }
      })
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "submit-error-test", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const denied = await client.callTool({
        name: SUBMIT_CHARACTER_WORK_TOOL_NAME,
        arguments: characterBody()
      });
      expect(denied.isError).toBe(true);
      expect((denied.content as Array<{ text?: string }>)?.[0]?.text).toBe("Not found.");

      const conflictClient = createRecordingBridgeClient({
        async submitCharacterWork() {
          throw new LocalBridgeConflictError();
        }
      });
      const conflictServer = createGhostwriterMcpServer({ bridgeClient: conflictClient });
      const [cTransport, sTransport] = InMemoryTransport.createLinkedPair();
      const c = new Client({ name: "conflict", version: "0.0.0" });
      await conflictServer.connect(sTransport);
      await c.connect(cTransport);
      const conflict = await c.callTool({
        name: SUBMIT_CHARACTER_WORK_TOOL_NAME,
        arguments: characterBody()
      });
      expect((conflict.content as Array<{ text?: string }>)?.[0]?.text).toBe(
        "Request conflict."
      );
      await c.close();
      await conflictServer.close();

      const unavailableClient = createRecordingBridgeClient({
        async submitCharacterWork() {
          throw new LocalBridgeUnavailableError();
        }
      });
      const unavailableServer = createGhostwriterMcpServer({
        bridgeClient: unavailableClient
      });
      const [uTransport, uServerTransport] = InMemoryTransport.createLinkedPair();
      const u = new Client({ name: "unavailable", version: "0.0.0" });
      await unavailableServer.connect(uServerTransport);
      await u.connect(uTransport);
      const unavailable = await u.callTool({
        name: SUBMIT_CHARACTER_WORK_TOOL_NAME,
        arguments: characterBody()
      });
      expect((unavailable.content as Array<{ text?: string }>)?.[0]?.text).toBe(
        "Service unavailable."
      );
      await u.close();
      await unavailableServer.close();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
