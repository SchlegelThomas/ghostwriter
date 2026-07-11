import { createManuscript } from "@ghostwriter/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "ghostwriter", version: "0.0.0" });

server.registerTool(
  "ghostwriter_status",
  {
    description: "Return the current Ghostwriter foundation capability."
  },
  async () => {
    const manuscript = createManuscript("sample-manuscript", "Untitled Manuscript");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "ready",
            capabilities: ["manuscripts"],
            sampleManuscript: manuscript
          })
        }
      ]
    };
  }
);

await server.connect(new StdioServerTransport());
