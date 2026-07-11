import { fileURLToPath } from "node:url";
import {
  BELLWETHER_FIXTURE_NAVIGATOR,
  BELLWETHER_FIXTURE_PROJECT_ID
} from "@ghostwriter/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { PROJECT_NAVIGATOR_TOOL_NAME } from "./server.js";

const appDirectory = fileURLToPath(new URL("..", import.meta.url));
const serverEntry = fileURLToPath(new URL("./index.ts", import.meta.url));

describe("Ghostwriter MCP stdio server", () => {
  it(
    "lists and invokes the project navigator through a real child process",
    async () => {
      const client = new Client({
        name: "ghostwriter-mcp-smoke-test",
        version: "0.0.0"
      });
      // Spawn the server directly with `node --import tsx` rather than through pnpm, so nothing
      // pollutes the stdio JSON-RPC stream (pnpm output varies by environment).
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", serverEntry],
        cwd: appDirectory,
        stderr: "pipe"
      });

      try {
        await client.connect(transport);

        const tools = await client.listTools();
        const projectNavigatorTool = tools.tools.find(
          (tool) => tool.name === PROJECT_NAVIGATOR_TOOL_NAME
        );

        expect(projectNavigatorTool).toMatchObject({
          name: PROJECT_NAVIGATOR_TOOL_NAME,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
          }
        });
        expect(projectNavigatorTool?.outputSchema).toBeDefined();

        const result = await client.callTool({
          name: PROJECT_NAVIGATOR_TOOL_NAME,
          arguments: {
            projectId: BELLWETHER_FIXTURE_PROJECT_ID
          }
        });

        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toEqual(
          JSON.parse(JSON.stringify(BELLWETHER_FIXTURE_NAVIGATOR))
        );

        const unavailable = await client.callTool({
          name: PROJECT_NAVIGATOR_TOOL_NAME,
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
});
