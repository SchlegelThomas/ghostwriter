import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGhostwriterMcpServer } from "./server.js";

const server = createGhostwriterMcpServer();
await server.connect(new StdioServerTransport());
