import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import {
  BELLWETHER_FIXTURE_NAVIGATOR,
  BELLWETHER_FIXTURE_PROJECT_ID
} from "@ghostwriter/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import {
  GET_GRANT_TOOL_NAME,
  PROPOSE_CAPTURE_REFLECTION_TOOL_NAME,
  READ_CAPTURE_TOOL_NAME
} from "./grant-tools.js";
import {
  GET_STORY_WORK_TOOL_NAME,
  LIST_STORY_WORK_TOOL_NAME,
  MCP_BRIDGE_TOOL_NAMES
} from "./story-work-grant-tools.js";
import { CREATE_STORY_WORK_COORDINATION_TOOL_NAME } from "./story-work-grant-mutation-tools.js";
import { SUBMIT_CHARACTER_WORK_TOOL_NAME } from "./story-work-grant-submit-tools.js";
import { GET_STORY_WORK_COORDINATION_TOOL_NAME } from "./story-work-grant-tools.js";

const appDirectory = fileURLToPath(new URL("..", import.meta.url));
const serverEntry = fileURLToPath(new URL("./index.ts", import.meta.url));

function spawnMcpServer(extraEnv: Record<string, string>) {
  const client = new Client({
    name: "ghostwriter-mcp-smoke-test",
    version: "0.0.0"
  });
  const childEnv = { ...process.env } as Record<string, string>;
  delete childEnv.GHOSTWRITER_MCP_API_URL;
  delete childEnv.GHOSTWRITER_MCP_GRANT_TOKEN;
  delete childEnv.GHOSTWRITER_MCP_FIXTURE;
  Object.assign(childEnv, extraEnv);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", serverEntry],
    cwd: appDirectory,
    env: childEnv,
    stderr: "pipe"
  });
  return { client, transport };
}

describe("Ghostwriter MCP stdio server", () => {
  it(
    "lists and invokes the project navigator through a real child process",
    async () => {
      const { client, transport } = spawnMcpServer({
        GHOSTWRITER_MCP_FIXTURE: "1"
      });

      try {
        await client.connect(transport);

        const tools = await client.listTools();
        const projectNavigatorTool = tools.tools.find(
          (tool) => tool.name === "ghostwriter_project_navigator"
        );

        expect(projectNavigatorTool).toMatchObject({
          name: "ghostwriter_project_navigator",
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
          }
        });
        expect(projectNavigatorTool?.outputSchema).toBeDefined();

        const result = await client.callTool({
          name: "ghostwriter_project_navigator",
          arguments: {
            projectId: BELLWETHER_FIXTURE_PROJECT_ID
          }
        });

        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toEqual(
          JSON.parse(JSON.stringify(BELLWETHER_FIXTURE_NAVIGATOR))
        );

        const unavailable = await client.callTool({
          name: "ghostwriter_project_navigator",
          arguments: {
            projectId: "project-not-in-fixture"
          }
        });

        expect(unavailable.isError).toBe(true);
      } finally {
        await client.close();
      }
    },
    15_000
  );

  it(
    "exits clearly when stdio configuration is missing",
    async () => {
      const childEnv = { ...process.env } as Record<string, string>;
      delete childEnv.GHOSTWRITER_MCP_API_URL;
      delete childEnv.GHOSTWRITER_MCP_GRANT_TOKEN;
      delete childEnv.GHOSTWRITER_MCP_FIXTURE;
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", serverEntry],
        cwd: appDirectory,
        env: childEnv,
        stderr: "pipe"
      });
      const client = new Client({ name: "missing-config", version: "0.0.0" });
      await expect(client.connect(transport)).rejects.toThrow();
      await client.close();
    },
    15_000
  );

  it(
    "registers fifteen bridge tools with capture read and propose",
    async () => {
      const bridgeToken = "gw_stdio_bridge_token_for_tests_only";
      const assignmentId = "assignment-bridge-stdio-1";
      let seenAuthorization: string | undefined;
      let characterPostCount = 0;
      let lastCharacterBody: { brief?: string; attemptIdempotencyKey?: string } | undefined;
      const coordinationId = "coordination-bridge-stdio-1";
      const captureId = "capture-bridge-stdio-1";

      const httpServer = createServer((request, response) => {
        seenAuthorization = request.headers.authorization;
        const path = request.url ?? "";
        if (path === `/local-mcp/v1/captures/${captureId}` && request.method === "GET") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              captureId,
              projectId: BELLWETHER_FIXTURE_PROJECT_ID,
              status: "ready",
              sourceModality: "text",
              workingVersion: 1,
              contentHash: "f".repeat(64),
              plainTextSummary: "Fog under stdio bridge.",
              truncated: false,
              updatedAt: "2026-07-01T00:00:00.000Z"
            })
          );
          return;
        }
        if (
          path === `/local-mcp/v1/captures/${captureId}/proposals` &&
          request.method === "POST"
        ) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              kind: "ready",
              runId: "run-capture-stdio",
              proposalId: "proposal-capture-stdio",
              status: "ready"
            })
          );
          return;
        }
        if (path === "/local-mcp/v1/story-work/character" && request.method === "POST") {
          const chunks: Buffer[] = [];
          request.on("data", (chunk) => chunks.push(chunk as Buffer));
          request.on("end", () => {
            lastCharacterBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              brief?: string;
              attemptIdempotencyKey?: string;
            };
            characterPostCount += 1;
            const created = characterPostCount === 1;
            response.writeHead(created ? 201 : 200, {
              "content-type": "application/json"
            });
            response.end(
              JSON.stringify({
                assignment: {
                  id: assignmentId,
                  projectId: BELLWETHER_FIXTURE_PROJECT_ID,
                  version: 1,
                  taskKind: "character",
                  brief: lastCharacterBody.brief ?? "Brief",
                  constraints: "Constraints",
                  doneWhen: "Done",
                  status: "ready",
                  model: "gpt-4.1",
                  createdAt: "2026-07-01T00:00:00.000Z",
                  updatedAt: "2026-07-01T00:00:00.000Z"
                },
                created,
                generation: {
                  kind: created ? "ready" : "replayed",
                  state: {
                    attempt: { instruction: lastCharacterBody.brief ?? "Brief" }
                  }
                }
              })
            );
          });
          return;
        }
        if (path === "/local-mcp/v1/grant") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              grant: {
                id: "grant-bridge-stdio",
                projectId: BELLWETHER_FIXTURE_PROJECT_ID,
                captureIds: [],
                sceneIds: [],
                bookIds: [],
                assignmentIds: [assignmentId],
                coordinationIds: [],
                allowProjectStructureRead: false,
                tools: [...MCP_BRIDGE_TOOL_NAMES],
                expiresAt: "2026-08-01T00:00:00.000Z"
              }
            })
          );
          return;
        }
        if (path === "/local-mcp/v1/story-work") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              assignments: [
                {
                  id: assignmentId,
                  projectId: BELLWETHER_FIXTURE_PROJECT_ID,
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
            })
          );
          return;
        }
        if (path === `/local-mcp/v1/story-work/${assignmentId}`) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              assignment: {
                id: assignmentId,
                projectId: BELLWETHER_FIXTURE_PROJECT_ID,
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
            })
          );
          return;
        }
        if (path === "/local-mcp/v1/coordinations" && request.method === "GET") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ coordinations: [] }));
          return;
        }
        if (path === "/local-mcp/v1/coordinations" && request.method === "POST") {
          const chunks: Buffer[] = [];
          request.on("data", (chunk) => chunks.push(chunk as Buffer));
          request.on("end", () => {
            response.writeHead(201, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                replayed: false,
                coordination: {
                  id: coordinationId,
                  projectId: BELLWETHER_FIXTURE_PROJECT_ID,
                  title: "Stdio coordination",
                  status: "active",
                  version: 1,
                  createdAt: "2026-07-01T00:00:00.000Z",
                  updatedAt: "2026-07-01T00:00:00.000Z",
                  steps: []
                },
                rootAssignment: {
                  id: "root-assignment-stdio",
                  projectId: BELLWETHER_FIXTURE_PROJECT_ID,
                  version: 1,
                  taskKind: "scene",
                  brief: "Brief",
                  constraints: "Constraints",
                  doneWhen: "Done",
                  status: "ready",
                  model: "gpt-4.1",
                  createdAt: "2026-07-01T00:00:00.000Z",
                  updatedAt: "2026-07-01T00:00:00.000Z"
                },
                projection: { steps: [] }
              })
            );
          });
          return;
        }
        if (path === `/local-mcp/v1/coordinations/${coordinationId}`) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              coordination: {
                id: coordinationId,
                projectId: BELLWETHER_FIXTURE_PROJECT_ID,
                title: "Stdio coordination",
                status: "active",
                version: 1,
                createdAt: "2026-07-01T00:00:00.000Z",
                updatedAt: "2026-07-01T00:00:00.000Z"
              },
              projection: { steps: [] },
              rootAssignment: { id: "root-assignment-stdio", taskKind: "scene", version: 1 }
            })
          );
          return;
        }
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Not found.", code: "NOT_FOUND" }));
      });

      await new Promise<void>((resolve) => {
        httpServer.listen(0, "127.0.0.1", () => resolve());
      });
      const address = httpServer.address();
      if (address === null || typeof address === "string") {
        throw new Error("Failed to bind bridge test HTTP server.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const { client, transport } = spawnMcpServer({
        GHOSTWRITER_MCP_API_URL: baseUrl,
        GHOSTWRITER_MCP_GRANT_TOKEN: bridgeToken
      });

      let stderrChunks = "";
      transport.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks += chunk.toString("utf8");
      });

      try {
        await client.connect(transport);

        const tools = await client.listTools();
        expect(tools.tools).toHaveLength(15);
        expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
          [...MCP_BRIDGE_TOOL_NAMES].sort()
        );

        const captureRead = await client.callTool({
          name: READ_CAPTURE_TOOL_NAME,
          arguments: { captureId }
        });
        expect(captureRead.isError).not.toBe(true);
        expect(captureRead.structuredContent).toMatchObject({
          captureId,
          plainTextSummary: expect.stringContaining("Fog")
        });

        const capturePropose = await client.callTool({
          name: PROPOSE_CAPTURE_REFLECTION_TOOL_NAME,
          arguments: { captureId }
        });
        expect(capturePropose.isError).not.toBe(true);
        expect(capturePropose.structuredContent).toMatchObject({ kind: "ready" });

        const grant = await client.callTool({
          name: GET_GRANT_TOOL_NAME,
          arguments: {}
        });
        expect(grant.isError).not.toBe(true);
        expect(grant.structuredContent).toMatchObject({
          id: "grant-bridge-stdio",
          assignmentIds: [assignmentId]
        });

        const listed = await client.callTool({
          name: LIST_STORY_WORK_TOOL_NAME,
          arguments: {}
        });
        expect(listed.isError).not.toBe(true);

        const detail = await client.callTool({
          name: GET_STORY_WORK_TOOL_NAME,
          arguments: { assignmentId }
        });
        expect(detail.isError).not.toBe(true);
        expect(detail.structuredContent).toMatchObject({
          assignment: { id: assignmentId }
        });

        const submitBody = {
          expectedProjectVersion: 1,
          assignmentIdempotencyKey: "stdio-assignment-key",
          attemptIdempotencyKey: "stdio-attempt-key",
          brief: "  Stdio bridge character brief.  ",
          constraints: "Use only supplied context.",
          doneWhen: "Ready for review.",
          sceneIds: ["scene-arrival-at-bellwether"],
          model: "gpt-4.1"
        };
        const submitted = await client.callTool({
          name: SUBMIT_CHARACTER_WORK_TOOL_NAME,
          arguments: submitBody
        });
        expect(submitted.isError).not.toBe(true);
        expect(submitted.structuredContent).toMatchObject({
          created: true,
          generation: { kind: "ready" }
        });

        const replayed = await client.callTool({
          name: SUBMIT_CHARACTER_WORK_TOOL_NAME,
          arguments: submitBody
        });
        expect(replayed.isError).not.toBe(true);
        expect(replayed.structuredContent).toMatchObject({
          created: false,
          generation: { kind: "replayed" }
        });
        expect(characterPostCount).toBe(2);
        expect(lastCharacterBody?.attemptIdempotencyKey).toBe("stdio-attempt-key");

        const coordinationCreateBody = {
          expectedProjectVersion: 1,
          idempotencyKey: "stdio-coordination-key",
          title: "Stdio harbor coordination",
          scene: {
            title: "Draft harbor scene",
            brief: "Draft a coordinated harbor scene.",
            constraints: "Use only supplied context.",
            doneWhen: "A scene draft is ready for review.",
            model: "gpt-4.1",
            sceneIds: ["scene-arrival-at-bellwether"]
          },
          check: {
            title: "Continuity check",
            brief: "Check the draft against surrounding canon.",
            constraints: "Ground findings in supplied scenes.",
            doneWhen: "Findings are ready for writer review.",
            model: "gpt-4.1",
            surroundingSceneIds: ["scene-future-call"]
          }
        };
        const coordinationCreated = await client.callTool({
          name: CREATE_STORY_WORK_COORDINATION_TOOL_NAME,
          arguments: coordinationCreateBody
        });
        expect(coordinationCreated.isError).not.toBe(true);
        expect(coordinationCreated.structuredContent).toMatchObject({
          replayed: false,
          coordination: { id: coordinationId }
        });

        const coordinationRead = await client.callTool({
          name: GET_STORY_WORK_COORDINATION_TOOL_NAME,
          arguments: { coordinationId }
        });
        expect(coordinationRead.isError).not.toBe(true);
        expect(coordinationRead.structuredContent).toMatchObject({
          coordination: { id: coordinationId }
        });

        expect(seenAuthorization).toBe(`Bearer ${bridgeToken}`);
        const serialized = JSON.stringify({
          grant,
          listed,
          detail,
          submitted,
          replayed,
          coordinationCreated,
          coordinationRead,
          captureRead,
          capturePropose,
          stderrChunks
        });
        expect(serialized).not.toContain(bridgeToken);
      } finally {
        await client.close();
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
      }
    },
    20_000
  );

  it(
    "returns nondisclosing MCP errors when the bridge responds 404",
    async () => {
      const bridgeToken = "gw_stdio_revoked_bridge_token";
      const httpServer = createServer((_request, response) => {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Not found.", code: "NOT_FOUND" }));
      });
      await new Promise<void>((resolve) => {
        httpServer.listen(0, "127.0.0.1", () => resolve());
      });
      const address = httpServer.address();
      if (address === null || typeof address === "string") {
        throw new Error("Failed to bind bridge test HTTP server.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const { client, transport } = spawnMcpServer({
        GHOSTWRITER_MCP_API_URL: baseUrl,
        GHOSTWRITER_MCP_GRANT_TOKEN: bridgeToken
      });

      try {
        await client.connect(transport);
        const result = await client.callTool({
          name: GET_GRANT_TOOL_NAME,
          arguments: {}
        });
        expect(result.isError).toBe(true);
        const content = result.content as Array<{ text?: string }> | undefined;
        expect(content?.[0]).toMatchObject({ text: "Not found." });
        expect(JSON.stringify(result)).not.toContain(bridgeToken);
      } finally {
        await client.close();
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
      }
    },
    20_000
  );
});
