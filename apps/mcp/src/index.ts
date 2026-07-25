import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGhostwriterMcpServer } from "./server.js";

/**
 * Stdio MCP defaults to the fixture navigator. Optional `GHOSTWRITER_MCP_GRANT_TOKEN`
 * enables grant-authenticated tools only when a grant runtime is injected by a host
 * process or test harness. Production remote MCP auth remains later; v1 proves
 * propose-only Capture reflection parity locally via injectable memory/Postgres deps.
 */
const server = createGhostwriterMcpServer();
await server.connect(new StdioServerTransport());
