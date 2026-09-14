import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createLocalBridgeClient,
  LocalBridgeConfigError,
  resolveLocalBridgeConfigFromEnv
} from "./local-bridge-client.js";
import { createGhostwriterMcpServer } from "./server.js";

function stderrLine(message: string): never {
  console.error(message);
  process.exit(1);
}

const fixtureMode = process.env.GHOSTWRITER_MCP_FIXTURE === "1";
let bridgeConfig;
try {
  bridgeConfig = resolveLocalBridgeConfigFromEnv();
} catch (error) {
  if (error instanceof LocalBridgeConfigError) {
    stderrLine(error.message);
  }
  throw error;
}

if (fixtureMode && bridgeConfig !== undefined) {
  stderrLine(
    "Ghostwriter MCP stdio cannot combine GHOSTWRITER_MCP_FIXTURE=1 with grant bridge configuration."
  );
}

let server;
if (bridgeConfig !== undefined) {
  const bridgeClient = createLocalBridgeClient({
    apiUrl: bridgeConfig.apiUrl,
    token: bridgeConfig.token
  });
  server = createGhostwriterMcpServer({ bridgeClient });
} else if (fixtureMode) {
  server = createGhostwriterMcpServer({ fixtureMode: true });
} else {
  stderrLine(
    "Ghostwriter MCP stdio requires GHOSTWRITER_MCP_FIXTURE=1 or grant bridge env (GHOSTWRITER_MCP_API_URL + GHOSTWRITER_MCP_GRANT_TOKEN)."
  );
}

await server.connect(new StdioServerTransport());
