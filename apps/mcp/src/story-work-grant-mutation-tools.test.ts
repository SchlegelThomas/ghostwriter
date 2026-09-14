import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  LocalBridgeNotFoundError,
  LocalBridgeStructurePreviewConflictError,
  type LocalBridgeClient
} from "./local-bridge-client.js";
import { createGhostwriterMcpServer } from "./server.js";
import {
  CREATE_STORY_WORK_COORDINATION_TOOL_NAME,
  CONTINUE_STORY_WORK_COORDINATION_TOOL_NAME,
  PREVIEW_STORY_STRUCTURE_TOOL_NAME
} from "./story-work-grant-mutation-tools.js";

const ARTIFACT = {
  proposalId: "proposal-preview-1",
  artifactVersion: 1,
  contentHash: "a".repeat(64)
};

function createMutationBridgeClient(
  handlers: Partial<LocalBridgeClient> = {}
): LocalBridgeClient {
  return Object.freeze({
    async getGrant() {
      return handlers.getGrant?.() ?? { id: "grant-stub" };
    },
    async listStoryWork() {
      return handlers.listStoryWork?.() ?? { assignments: [] };
    },
    async getStoryWork(assignmentId: string) {
      return handlers.getStoryWork?.(assignmentId) ?? { assignment: { id: assignmentId } };
    },
    async listStoryWorkCoordinations() {
      return handlers.listStoryWorkCoordinations?.() ?? { coordinations: [] };
    },
    async getStoryWorkCoordination(coordinationId: string) {
      return (
        handlers.getStoryWorkCoordination?.(coordinationId) ?? {
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
    async previewStoryStructure(body) {
      return (
        handlers.previewStoryStructure?.(body) ?? {
          preview: { operations: body.selectedOperationIds }
        }
      );
    },
    async createStoryWorkCoordination(body) {
      return (
        handlers.createStoryWorkCoordination?.(body) ?? {
          replayed: false,
          coordination: { id: `coord-${randomUUID()}`, title: body.title },
          rootAssignment: { id: "root-assignment", taskKind: "scene" }
        }
      );
    },
    async continueStoryWorkCoordinationStep(coordinationId, stepId, body) {
      return (
        handlers.continueStoryWorkCoordinationStep?.(coordinationId, stepId, body) ?? {
          replayed: false,
          coordination: { id: coordinationId, version: body.expectedCoordinationVersion },
          rootAssignment: { id: "root-assignment" },
          checkAssignment: { id: "check-assignment" }
        }
      );
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

function coordinationCreateBody() {
  return {
    expectedProjectVersion: 1,
    idempotencyKey: `coordination-${randomUUID()}`,
    title: "Harbor coordination",
    scene: {
      title: "Draft harbor scene",
      brief: "Draft a coordinated harbor scene.",
      constraints: "Keep canon intact.",
      doneWhen: "A scene draft is ready for review.",
      model: "gpt-4.1",
      sceneIds: ["scene-a"]
    },
    check: {
      title: "Continuity check",
      brief: "Check the draft against surrounding canon.",
      constraints: "Ground findings in supplied scenes.",
      doneWhen: "Findings are ready for writer review.",
      model: "gpt-4.1",
      surroundingSceneIds: ["scene-b"]
    }
  };
}

describe("story-work grant bridge mutation tools", () => {
  it("invokes preview, create, and continue with exact bridge payloads", async () => {
    const calls: Array<{ tool: string; payload: unknown }> = [];
    const server = createGhostwriterMcpServer({
      bridgeClient: createMutationBridgeClient({
        async previewStoryStructure(body) {
          calls.push({ tool: PREVIEW_STORY_STRUCTURE_TOOL_NAME, payload: body });
          return { preview: { selected: body.selectedOperationIds } };
        },
        async createStoryWorkCoordination(body) {
          calls.push({ tool: CREATE_STORY_WORK_COORDINATION_TOOL_NAME, payload: body });
          return {
            replayed: false,
            coordination: {
              id: "coord-1",
              title: body.title,
              version: 1,
              status: "active"
            },
            rootAssignment: {
              id: "root-1",
              taskKind: "scene",
              version: 1,
              status: "ready"
            }
          };
        },
        async continueStoryWorkCoordinationStep(coordinationId, stepId, body) {
          calls.push({
            tool: CONTINUE_STORY_WORK_COORDINATION_TOOL_NAME,
            payload: { coordinationId, stepId, ...body }
          });
          return {
            replayed: true,
            coordination: {
              id: coordinationId,
              title: "Harbor coordination",
              status: "active",
              version: body.expectedCoordinationVersion
            },
            rootAssignment: { id: "root-1", taskKind: "scene", version: 1, status: "ready" },
            checkAssignment: { id: "check-1", taskKind: "check", version: 1, status: "ready" }
          };
        }
      })
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mutation-tools-test", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const previewBody = {
        assignmentId: "assignment-outline-1",
        expectedAssignmentVersion: 2,
        expectedProjectVersion: 1,
        artifact: ARTIFACT,
        selectedOperationIds: ["op-root", "op-chapter"]
      };
      const preview = await client.callTool({
        name: PREVIEW_STORY_STRUCTURE_TOOL_NAME,
        arguments: previewBody
      });
      expect(preview.isError).not.toBe(true);
      expect(preview.structuredContent).toMatchObject({
        preview: { selected: ["op-root", "op-chapter"] }
      });

      const createBody = coordinationCreateBody();
      const created = await client.callTool({
        name: CREATE_STORY_WORK_COORDINATION_TOOL_NAME,
        arguments: createBody
      });
      expect(created.isError).not.toBe(true);
      expect(created.structuredContent).toMatchObject({
        replayed: false,
        coordination: { id: "coord-1" }
      });

      const continued = await client.callTool({
        name: CONTINUE_STORY_WORK_COORDINATION_TOOL_NAME,
        arguments: {
          coordinationId: "coord-1",
          stepId: "step-check-1",
          expectedCoordinationVersion: 1,
          expectedUpstreamArtifact: ARTIFACT
        }
      });
      expect(continued.isError).not.toBe(true);
      expect(continued.structuredContent).toMatchObject({ replayed: true });

      expect(calls.map((call) => call.tool)).toEqual([
        PREVIEW_STORY_STRUCTURE_TOOL_NAME,
        CREATE_STORY_WORK_COORDINATION_TOOL_NAME,
        CONTINUE_STORY_WORK_COORDINATION_TOOL_NAME
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("maps preview missingRequired conflicts and other denials safely", async () => {
    const previewDenied = createGhostwriterMcpServer({
      bridgeClient: createMutationBridgeClient({
        async previewStoryStructure() {
          throw new LocalBridgeStructurePreviewConflictError(["op-missing-a", "op-missing-b"]);
        }
      })
    });
    const [previewTransport, previewServerTransport] =
      InMemoryTransport.createLinkedPair();
    const previewClient = new Client({ name: "preview-conflict", version: "0.0.0" });
    await previewDenied.connect(previewServerTransport);
    await previewClient.connect(previewTransport);
    try {
      const result = await previewClient.callTool({
        name: PREVIEW_STORY_STRUCTURE_TOOL_NAME,
        arguments: {
          assignmentId: "assignment-1",
          expectedAssignmentVersion: 1,
          expectedProjectVersion: 1,
          artifact: ARTIFACT,
          selectedOperationIds: ["op-only"]
        }
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text?: string }>)?.[0]?.text).toBe(
        "Request conflict. Missing required operations: op-missing-a, op-missing-b"
      );
    } finally {
      await previewClient.close();
      await previewDenied.close();
    }

    const continueDenied = createGhostwriterMcpServer({
      bridgeClient: createMutationBridgeClient({
        async continueStoryWorkCoordinationStep() {
          throw new LocalBridgeNotFoundError();
        }
      })
    });
    const [continueTransport, continueServerTransport] =
      InMemoryTransport.createLinkedPair();
    const continueClient = new Client({ name: "continue-denied", version: "0.0.0" });
    await continueDenied.connect(continueServerTransport);
    await continueClient.connect(continueTransport);
    try {
      const denied = await continueClient.callTool({
        name: CONTINUE_STORY_WORK_COORDINATION_TOOL_NAME,
        arguments: {
          coordinationId: "coord-foreign",
          stepId: "step-1",
          expectedCoordinationVersion: 1,
          expectedUpstreamArtifact: ARTIFACT
        }
      });
      expect((denied.content as Array<{ text?: string }>)?.[0]?.text).toBe("Not found.");
    } finally {
      await continueClient.close();
      await continueDenied.close();
    }
  });
});
