import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mcpToolContentFreeError, mcpToolOkStructured } from "./grant-tools.js";
import {
  LocalBridgeConflictError,
  LocalBridgeInvalidRequestError,
  LocalBridgeNotFoundError,
  LocalBridgeRequestFailedError,
  LocalBridgeStructurePreviewConflictError,
  LocalBridgeUnavailableError,
  type LocalBridgeClient
} from "./local-bridge-client.js";
import {
  mcpBridgeContinueCoordinationStepInputSchema,
  mcpBridgeCreateCoordinationInputSchema,
  mcpBridgeStructurePreviewInputSchema
} from "./story-work-bridge-mutation-schemas.js";

export const PREVIEW_STORY_STRUCTURE_TOOL_NAME = "ghostwriter_preview_story_structure";
export const CREATE_STORY_WORK_COORDINATION_TOOL_NAME =
  "ghostwriter_create_story_work_coordination";
export const CONTINUE_STORY_WORK_COORDINATION_TOOL_NAME =
  "ghostwriter_continue_story_work_coordination";

export const STORY_WORK_BRIDGE_MUTATION_TOOL_NAMES = Object.freeze([
  PREVIEW_STORY_STRUCTURE_TOOL_NAME,
  CREATE_STORY_WORK_COORDINATION_TOOL_NAME,
  CONTINUE_STORY_WORK_COORDINATION_TOOL_NAME
] as const);

const boundedId = z.string().min(1).max(200);
const boundedText = z.string().max(100_000);

const coordinationSummarySchema = z
  .object({
    id: boundedId,
    title: boundedText,
    status: z.string().max(64),
    version: z.number().int().positive()
  })
  .passthrough();

const assignmentSummarySchema = z
  .object({
    id: boundedId,
    taskKind: z.string().max(64),
    status: z.string().max(64),
    version: z.number().int().positive()
  })
  .passthrough();

const structurePreviewOutputSchema = z.object({
  preview: z.record(z.string(), z.unknown())
});

const coordinationCreateOutputSchema = z
  .object({
    replayed: z.boolean(),
    coordination: coordinationSummarySchema,
    rootAssignment: assignmentSummarySchema
  })
  .passthrough();

const coordinationContinueOutputSchema = coordinationCreateOutputSchema
  .extend({
    checkAssignment: assignmentSummarySchema
  })
  .passthrough();

function mapPreviewConflict(error: LocalBridgeStructurePreviewConflictError) {
  if (error.missingRequired.length === 0) {
    return mcpToolContentFreeError("Request conflict.");
  }
  return mcpToolContentFreeError(
    `Request conflict. Missing required operations: ${error.missingRequired.join(", ")}`
  );
}

function mapBridgeMutationToolError(error: unknown) {
  if (error instanceof LocalBridgeStructurePreviewConflictError) {
    return mapPreviewConflict(error);
  }
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

const previewAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
});

const manageAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
});

export function registerStoryWorkGrantBridgeMutationTools(
  server: McpServer,
  client: LocalBridgeClient
): void {
  server.registerTool(
    PREVIEW_STORY_STRUCTURE_TOOL_NAME,
    {
      title: "Preview structure story work selection",
      description:
        "Dependency-complete structure preview for a submitted outline artifact and selected operations. Read-only: no provider rerun and no manuscript writes.",
      inputSchema: mcpBridgeStructurePreviewInputSchema,
      outputSchema: structurePreviewOutputSchema,
      annotations: previewAnnotations
    },
    async (input) => {
      try {
        const result = await client.previewStoryStructure(input);
        return mcpToolOkStructured(result);
      } catch (error) {
        return mapBridgeMutationToolError(error);
      }
    }
  );

  server.registerTool(
    CREATE_STORY_WORK_COORDINATION_TOOL_NAME,
    {
      title: "Create story work coordination",
      description:
        "Create a v1 coordination with one scene-draft root and one deferred continuity check. Zero provider spend; child attempts are not auto-started and nothing is applied to canon.",
      inputSchema: mcpBridgeCreateCoordinationInputSchema,
      outputSchema: coordinationCreateOutputSchema,
      annotations: manageAnnotations
    },
    async (input) => {
      try {
        const result = await client.createStoryWorkCoordination(input);
        return mcpToolOkStructured(result);
      } catch (error) {
        return mapBridgeMutationToolError(error);
      }
    }
  );

  server.registerTool(
    CONTINUE_STORY_WORK_COORDINATION_TOOL_NAME,
    {
      title: "Continue story work coordination step",
      description:
        "Bind a deferred coordination step to an upstream artifact at the exact coordination version. Does not auto-start child provider attempts or apply canon.",
      inputSchema: mcpBridgeContinueCoordinationStepInputSchema,
      outputSchema: coordinationContinueOutputSchema,
      annotations: manageAnnotations
    },
    async ({ coordinationId, stepId, expectedCoordinationVersion, expectedUpstreamArtifact }) => {
      try {
        const result = await client.continueStoryWorkCoordinationStep(
          coordinationId,
          stepId,
          {
            expectedCoordinationVersion,
            expectedUpstreamArtifact
          }
        );
        return mcpToolOkStructured(result);
      } catch (error) {
        return mapBridgeMutationToolError(error);
      }
    }
  );
}
