import {
  CaptureNotFoundError,
  McpGrantCaptureDeniedError,
  McpGrantNotFoundError,
  McpGrantToolDeniedError,
  captureId,
  type CaptureReflectionStructuredCompletionProvider,
  type McpGrantServices
} from "@ghostwriter/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const GET_GRANT_TOOL_NAME = "ghostwriter_get_grant";
export const READ_CAPTURE_TOOL_NAME = "ghostwriter_read_capture";
export const ASSEMBLE_CAPTURE_REFLECTION_CONTEXT_TOOL_NAME =
  "ghostwriter_assemble_capture_reflection_context";
export const PROPOSE_CAPTURE_REFLECTION_TOOL_NAME =
  "ghostwriter_propose_capture_reflection";

export type McpGrantRuntime = Readonly<{
  token: string;
  grants: McpGrantServices;
  provider: CaptureReflectionStructuredCompletionProvider;
}>;

function contentFreeError(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }]
  };
}

function mapGrantToolError(error: unknown) {
  if (
    error instanceof McpGrantNotFoundError ||
    error instanceof CaptureNotFoundError ||
    error instanceof McpGrantCaptureDeniedError
  ) {
    return contentFreeError("Not found.");
  }
  if (error instanceof McpGrantToolDeniedError) {
    return contentFreeError("Not found.");
  }
  return contentFreeError("Request failed.");
}

function okStructured(output: unknown) {
  return {
    structuredContent: output as Record<string, unknown>,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(output)
      }
    ]
  };
}

export function registerMcpGrantTools(
  server: McpServer,
  runtime: McpGrantRuntime
): void {
  const grantEffectiveSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    captureIds: z.array(z.string()),
    tools: z.array(z.string()),
    expiresAt: z.string()
  });

  server.registerTool(
    GET_GRANT_TOOL_NAME,
    {
      title: "Discover active MCP grant",
      description:
        "Return the effective project-scoped MCP grant for this client. Does not list other projects.",
      inputSchema: z.object({}),
      outputSchema: grantEffectiveSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      try {
        const grant = await runtime.grants.getGrantUnderToken(runtime.token);
        return okStructured(grant);
      } catch (error) {
        return mapGrantToolError(error);
      }
    }
  );

  server.registerTool(
    READ_CAPTURE_TOOL_NAME,
    {
      title: "Read a granted Capture summary",
      description:
        "Read one granted Capture head and plain-text summary. Attachments and credentials are never included.",
      inputSchema: z.object({
        captureId: z.string().describe("Capture ID allowed by the active grant.")
      }),
      outputSchema: z.object({
        captureId: z.string(),
        projectId: z.string(),
        status: z.string(),
        sourceModality: z.string(),
        workingVersion: z.number().int().positive(),
        contentHash: z.string(),
        plainTextSummary: z.string(),
        truncated: z.boolean(),
        updatedAt: z.string()
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ captureId: captureIdValue }) => {
      try {
        const summary = await runtime.grants.readCaptureUnderToken({
          token: runtime.token,
          captureId: captureId(captureIdValue)
        });
        return okStructured(summary);
      } catch (error) {
        return mapGrantToolError(error);
      }
    }
  );

  server.registerTool(
    ASSEMBLE_CAPTURE_REFLECTION_CONTEXT_TOOL_NAME,
    {
      title: "Assemble Capture reflection context receipt",
      description:
        "Server-assemble a Capture reflection context receipt preview for one granted Capture.",
      inputSchema: z.object({
        captureId: z.string()
      }),
      outputSchema: z.object({
        id: z.string(),
        projectId: z.string(),
        workflowId: z.string(),
        receiptHash: z.string(),
        model: z.string(),
        createdAt: z.string()
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ captureId: captureIdValue }) => {
      try {
        const receipt =
          await runtime.grants.assembleCaptureReflectionContextUnderToken({
            token: runtime.token,
            captureId: captureId(captureIdValue)
          });
        return okStructured({
          id: receipt.id,
          projectId: receipt.projectId,
          workflowId: receipt.workflowId,
          receiptHash: receipt.receiptHash,
          model: receipt.model,
          createdAt: receipt.createdAt
        });
      } catch (error) {
        return mapGrantToolError(error);
      }
    }
  );

  server.registerTool(
    PROPOSE_CAPTURE_REFLECTION_TOOL_NAME,
    {
      title: "Propose Capture reflection",
      description:
        "Submit a Capture reflection run through the same core path as the UI. Creates a noncanonical proposal in the project Inbox. Cannot apply.",
      inputSchema: z.object({
        captureId: z.string()
      }),
      outputSchema: z.object({
        kind: z.string(),
        runId: z.string().optional(),
        proposalId: z.string().optional(),
        status: z.string().optional()
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ captureId: captureIdValue }) => {
      try {
        const result = await runtime.grants.proposeCaptureReflectionUnderToken({
          token: runtime.token,
          captureId: captureId(captureIdValue),
          provider: runtime.provider
        });
        if (result.kind === "ready") {
          return okStructured({
            kind: result.kind,
            runId: result.run.id,
            proposalId: result.proposal.id,
            status: result.proposal.status
          });
        }
        return okStructured({
          kind: result.kind,
          runId: result.run.id,
          status: result.run.status
        });
      } catch (error) {
        return mapGrantToolError(error);
      }
    }
  );
}
