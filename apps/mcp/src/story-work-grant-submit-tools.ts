import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
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
import {
  mcpBridgeCharacterSubmitInputSchema,
  mcpBridgeCheckSubmitInputSchema,
  mcpBridgeSceneSubmitInputSchema,
  mcpBridgeStructureSubmitInputSchema
} from "./story-work-bridge-submit-schemas.js";

export const SUBMIT_CHARACTER_WORK_TOOL_NAME = "ghostwriter_submit_character_work";
export const SUBMIT_SCENE_WORK_TOOL_NAME = "ghostwriter_submit_scene_work";
export const SUBMIT_CHECK_WORK_TOOL_NAME = "ghostwriter_submit_check_work";
export const SUBMIT_STRUCTURE_WORK_TOOL_NAME = "ghostwriter_submit_structure_work";

export const STORY_WORK_BRIDGE_SUBMIT_TOOL_NAMES = Object.freeze([
  SUBMIT_CHARACTER_WORK_TOOL_NAME,
  SUBMIT_SCENE_WORK_TOOL_NAME,
  SUBMIT_CHECK_WORK_TOOL_NAME,
  SUBMIT_STRUCTURE_WORK_TOOL_NAME
] as const);

const boundedId = z.string().min(1).max(200);
const boundedText = z.string().max(100_000);

const storyWorkAssignmentOutputSchema = z
  .object({
    id: boundedId,
    projectId: boundedId,
    version: z.number().int().positive(),
    taskKind: z.string().max(64),
    brief: boundedText,
    constraints: boundedText,
    doneWhen: boundedText,
    status: z.string().max(64),
    model: z.string().max(128),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .passthrough();

const bridgeSubmitGenerationSchema = z
  .object({
    kind: z.enum(["ready", "replayed", "failed", "canceled", "stale"]),
    state: z.record(z.string(), z.unknown())
  })
  .passthrough();

const bridgeSubmitOutputSchema = z.object({
  assignment: storyWorkAssignmentOutputSchema,
  created: z.boolean(),
  generation: bridgeSubmitGenerationSchema
});

const proposeOnlyDescriptionSuffix =
  " Creates one story-work assignment and runs one foreground provider attempt. Returns a proposal for first-party review only; never applies canon.";

function mapBridgeSubmitToolError(error: unknown) {
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

const proposeAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
});

export function registerStoryWorkGrantBridgeSubmitTools(
  server: McpServer,
  client: LocalBridgeClient
): void {
  server.registerTool(
    SUBMIT_CHARACTER_WORK_TOOL_NAME,
    {
      title: "Submit character story work",
      description: `Create a character dossier assignment from typed brief fields.${proposeOnlyDescriptionSuffix}`,
      inputSchema: mcpBridgeCharacterSubmitInputSchema,
      outputSchema: bridgeSubmitOutputSchema,
      annotations: proposeAnnotations
    },
    async (input) => {
      try {
        const result = await client.submitCharacterWork(input);
        return mcpToolOkStructured(result);
      } catch (error) {
        return mapBridgeSubmitToolError(error);
      }
    }
  );

  server.registerTool(
    SUBMIT_SCENE_WORK_TOOL_NAME,
    {
      title: "Submit new scene story work",
      description: `Create a new scene draft assignment from typed brief fields. Scene revision targets are not supported.${proposeOnlyDescriptionSuffix}`,
      inputSchema: mcpBridgeSceneSubmitInputSchema,
      outputSchema: bridgeSubmitOutputSchema,
      annotations: proposeAnnotations
    },
    async (input) => {
      try {
        const result = await client.submitSceneWork(input);
        return mcpToolOkStructured(result);
      } catch (error) {
        return mapBridgeSubmitToolError(error);
      }
    }
  );

  server.registerTool(
    SUBMIT_CHECK_WORK_TOOL_NAME,
    {
      title: "Submit continuity check story work",
      description: `Create a continuity check assignment using applied-scene or proposal-draft mode.${proposeOnlyDescriptionSuffix}`,
      inputSchema: mcpBridgeCheckSubmitInputSchema,
      outputSchema: bridgeSubmitOutputSchema,
      annotations: proposeAnnotations
    },
    async (input) => {
      try {
        const result = await client.submitCheckWork(input);
        return mcpToolOkStructured(result);
      } catch (error) {
        return mapBridgeSubmitToolError(error);
      }
    }
  );

  server.registerTool(
    SUBMIT_STRUCTURE_WORK_TOOL_NAME,
    {
      title: "Submit structure outline story work",
      description: `Create an outline assignment for one allowlisted book target.${proposeOnlyDescriptionSuffix}`,
      inputSchema: mcpBridgeStructureSubmitInputSchema,
      outputSchema: bridgeSubmitOutputSchema,
      annotations: proposeAnnotations
    },
    async (input) => {
      try {
        const result = await client.submitStructureWork(input);
        return mcpToolOkStructured(result);
      } catch (error) {
        return mapBridgeSubmitToolError(error);
      }
    }
  );
}
