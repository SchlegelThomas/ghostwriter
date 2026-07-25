import { createHash, randomBytes } from "node:crypto";
import {
  mcpGrantTokenHash,
  type McpGrantTokenPort
} from "@ghostwriter/core";

export function createNodeMcpGrantTokenPort(): McpGrantTokenPort {
  return Object.freeze({
    mintPlaintext() {
      return `gw_mcp_${randomBytes(32).toString("base64url")}`;
    },
    async hash(plaintext: string) {
      const digest = createHash("sha256")
        .update(`ghostwriter-mcp-grant-v1:${plaintext.trim()}`, "utf8")
        .digest("hex");
      return mcpGrantTokenHash(digest);
    }
  });
}
