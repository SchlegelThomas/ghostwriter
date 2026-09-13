import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ASSEMBLE_CAPTURE_REFLECTION_CONTEXT_TOOL_NAME,
  MCP_ASSEMBLE_CAPTURE_REFLECTION_CONTEXT_INPUT_SCHEMA,
  MCP_ASSEMBLE_CAPTURE_REFLECTION_CONTEXT_OUTPUT_SCHEMA,
  MCP_PROPOSE_CAPTURE_REFLECTION_INPUT_SCHEMA,
  MCP_PROPOSE_CAPTURE_REFLECTION_OUTPUT_SCHEMA,
  MCP_READ_CAPTURE_INPUT_SCHEMA,
  MCP_READ_CAPTURE_OUTPUT_SCHEMA,
  PROPOSE_CAPTURE_REFLECTION_TOOL_NAME,
  READ_CAPTURE_TOOL_NAME,
  mcpToolContentFreeError,
  mcpToolOkStructured
} from "./grant-tools.js";
import {
  LocalBridgeConflictError,
  LocalBridgeInvalidRequestError,
  LocalBridgeNotFoundError,
  LocalBridgeRequestFailedError,
  LocalBridgeUnavailableError,
  type LocalBridgeClient
} from "./local-bridge-client.js";

export const MCP_BRIDGE_CAPTURE_TOOL_NAMES = Object.freeze([
  READ_CAPTURE_TOOL_NAME,
  ASSEMBLE_CAPTURE_REFLECTION_CONTEXT_TOOL_NAME,
  PROPOSE_CAPTURE_REFLECTION_TOOL_NAME
] as const);

function mapBridgeCaptureToolError(error: unknown) {
  if (error instanceof LocalBridgeNotFoundError) {
    return mcpToolContentFreeError("Not found.");
  }
  if (error instanceof LocalBridgeConflictError) {
    return mcpToolContentFreeError("Request conflict.");
  }
  if (error instanceof LocalBridgeInvalidRequestError) {
    return mcpToolContentFreeError("Invalid request.");
  }
  if (error instanceof LocalBridgeUnavailableError) {
    return mcpToolContentFreeError("Service unavailable.");
  }
  if (error instanceof LocalBridgeRequestFailedError) {
    return mcpToolContentFreeError("Request failed.");
  }
  return mcpToolContentFreeError("Request failed.");
}

const readOnlyAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
});

const proposeAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
});

export function registerMcpCaptureBridgeTools(
  server: McpServer,
  client: LocalBridgeClient
): void {
  server.registerTool(
    READ_CAPTURE_TOOL_NAME,
    {
      title: "Read a granted Capture summary",
      description:
        "Read one granted Capture head and plain-text summary. Attachments and credentials are never included.",
      inputSchema: MCP_READ_CAPTURE_INPUT_SCHEMA,
      outputSchema: MCP_READ_CAPTURE_OUTPUT_SCHEMA,
      annotations: readOnlyAnnotations
    },
    async ({ captureId }) => {
      try {
        const summary = await client.readCapture(captureId);
        return mcpToolOkStructured(summary);
      } catch (error) {
        return mapBridgeCaptureToolError(error);
      }
    }
  );

  server.registerTool(
    ASSEMBLE_CAPTURE_REFLECTION_CONTEXT_TOOL_NAME,
    {
      title: "Assemble Capture reflection context receipt",
      description:
        "Server-assemble a Capture reflection context receipt preview for one granted Capture.",
      inputSchema: MCP_ASSEMBLE_CAPTURE_REFLECTION_CONTEXT_INPUT_SCHEMA,
      outputSchema: MCP_ASSEMBLE_CAPTURE_REFLECTION_CONTEXT_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ captureId }) => {
      try {
        const receipt = await client.assembleCaptureReflectionContext(captureId);
        return mcpToolOkStructured(receipt);
      } catch (error) {
        return mapBridgeCaptureToolError(error);
      }
    }
  );

  server.registerTool(
    PROPOSE_CAPTURE_REFLECTION_TOOL_NAME,
    {
      title: "Propose Capture reflection",
      description:
        "Submit a Capture reflection run through the same core path as the UI. Creates a noncanonical proposal in the project Inbox. Cannot apply.",
      inputSchema: MCP_PROPOSE_CAPTURE_REFLECTION_INPUT_SCHEMA,
      outputSchema: MCP_PROPOSE_CAPTURE_REFLECTION_OUTPUT_SCHEMA,
      annotations: proposeAnnotations
    },
    async ({ captureId }) => {
      try {
        const result = await client.proposeCaptureReflection(captureId);
        return mcpToolOkStructured(result);
      } catch (error) {
        return mapBridgeCaptureToolError(error);
      }
    }
  );
}
