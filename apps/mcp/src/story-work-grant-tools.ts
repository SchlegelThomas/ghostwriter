import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  GET_GRANT_TOOL_NAME,
  MCP_GRANT_EFFECTIVE_OUTPUT_SCHEMA,
  mcpToolContentFreeError,
  mcpToolOkStructured
} from "./grant-tools.js";
import {
  LocalBridgeNotFoundError,
  LocalBridgeRequestFailedError,
  type LocalBridgeClient
} from "./local-bridge-client.js";
import {
  MCP_BRIDGE_CAPTURE_TOOL_NAMES,
  registerMcpCaptureBridgeTools
} from "./capture-grant-bridge-tools.js";

export { MCP_BRIDGE_CAPTURE_TOOL_NAMES } from "./capture-grant-bridge-tools.js";
import {
  registerStoryWorkGrantBridgeMutationTools,
  STORY_WORK_BRIDGE_MUTATION_TOOL_NAMES
} from "./story-work-grant-mutation-tools.js";
import {
  registerStoryWorkGrantBridgeSubmitTools,
  STORY_WORK_BRIDGE_SUBMIT_TOOL_NAMES
} from "./story-work-grant-submit-tools.js";

export const LIST_STORY_WORK_TOOL_NAME = "ghostwriter_list_story_work";
export const GET_STORY_WORK_TOOL_NAME = "ghostwriter_get_story_work";
export const LIST_STORY_WORK_COORDINATIONS_TOOL_NAME =
  "ghostwriter_list_story_work_coordinations";
export const GET_STORY_WORK_COORDINATION_TOOL_NAME =
  "ghostwriter_get_story_work_coordination";

export const STORY_WORK_BRIDGE_READ_TOOL_NAMES = Object.freeze([
  GET_GRANT_TOOL_NAME,
  LIST_STORY_WORK_TOOL_NAME,
  GET_STORY_WORK_TOOL_NAME,
  LIST_STORY_WORK_COORDINATIONS_TOOL_NAME,
  GET_STORY_WORK_COORDINATION_TOOL_NAME
] as const);

/** Story-work bridge tools excluding grant discover and Capture grant tools. */
export const MCP_BRIDGE_STORY_TOOL_NAMES = Object.freeze([
  LIST_STORY_WORK_TOOL_NAME,
  GET_STORY_WORK_TOOL_NAME,
  LIST_STORY_WORK_COORDINATIONS_TOOL_NAME,
  GET_STORY_WORK_COORDINATION_TOOL_NAME,
  ...STORY_WORK_BRIDGE_SUBMIT_TOOL_NAMES,
  ...STORY_WORK_BRIDGE_MUTATION_TOOL_NAMES
] as const);

/** Full closed grant-bridge stdio surface (15 tools). */
export const MCP_BRIDGE_TOOL_NAMES = Object.freeze([
  GET_GRANT_TOOL_NAME,
  ...MCP_BRIDGE_CAPTURE_TOOL_NAMES,
  ...MCP_BRIDGE_STORY_TOOL_NAMES
] as const);

/** @deprecated Use {@link MCP_BRIDGE_TOOL_NAMES}. */
export const STORY_WORK_BRIDGE_TOOL_NAMES = MCP_BRIDGE_TOOL_NAMES;

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

const listStoryWorkOutputSchema = z.object({
  assignments: z.array(storyWorkAssignmentOutputSchema).max(500)
});

const getStoryWorkOutputSchema = z
  .object({
    assignment: storyWorkAssignmentOutputSchema
  })
  .passthrough();

const coordinationOutputSchema = z
  .object({
    id: boundedId,
    projectId: boundedId,
    title: boundedText,
    status: z.string().max(64),
    version: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .passthrough();

const getStoryWorkCoordinationOutputSchema = z
  .object({
    coordination: coordinationOutputSchema
  })
  .passthrough();

const listCoordinationsOutputSchema = z.object({
  coordinations: z.array(getStoryWorkCoordinationOutputSchema).max(500)
});

function mapBridgeToolError(error: unknown) {
  if (error instanceof LocalBridgeNotFoundError) {
    return mcpToolContentFreeError("Not found.");
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

export type RegisterStoryWorkGrantBridgeToolsOptions = Readonly<{
  /** When false, skip `ghostwriter_get_grant` (in-process grant runtime already registered it). */
  includeGetGrant?: boolean;
}>;

export function registerStoryWorkGrantBridgeTools(
  server: McpServer,
  client: LocalBridgeClient,
  options: RegisterStoryWorkGrantBridgeToolsOptions = {}
): void {
  const includeGetGrant = options.includeGetGrant !== false;

  if (includeGetGrant) {
    server.registerTool(
      GET_GRANT_TOOL_NAME,
      {
        title: "Discover active MCP grant",
        description:
          "Return the effective project-scoped MCP grant for this client. Does not list other projects.",
        inputSchema: z.object({}),
        outputSchema: MCP_GRANT_EFFECTIVE_OUTPUT_SCHEMA,
        annotations: readOnlyAnnotations
      },
      async () => {
        try {
          const grant = await client.getGrant();
          return mcpToolOkStructured(grant);
        } catch (error) {
          return mapBridgeToolError(error);
        }
      }
    );
  }

  server.registerTool(
    LIST_STORY_WORK_TOOL_NAME,
    {
      title: "List granted story work assignments",
      description:
        "List story work assignments visible under the active MCP grant. Does not scan the whole project.",
      inputSchema: z.object({}),
      outputSchema: listStoryWorkOutputSchema,
      annotations: readOnlyAnnotations
    },
    async () => {
      try {
        const body = await client.listStoryWork();
        return mcpToolOkStructured(body);
      } catch (error) {
        return mapBridgeToolError(error);
      }
    }
  );

  server.registerTool(
    GET_STORY_WORK_TOOL_NAME,
    {
      title: "Get story work assignment detail",
      description:
        "Read one granted story work assignment, including bounded recovery and check freshness projections when present.",
      inputSchema: z.object({
        assignmentId: boundedId.describe(
          "Story work assignment ID allowed by the active grant."
        )
      }),
      outputSchema: getStoryWorkOutputSchema,
      annotations: readOnlyAnnotations
    },
    async ({ assignmentId }) => {
      try {
        const detail = await client.getStoryWork(assignmentId);
        return mcpToolOkStructured(detail);
      } catch (error) {
        return mapBridgeToolError(error);
      }
    }
  );

  server.registerTool(
    LIST_STORY_WORK_COORDINATIONS_TOOL_NAME,
    {
      title: "List granted story work coordinations",
      description:
        "List story work coordinations visible under the active MCP grant.",
      inputSchema: z.object({}),
      outputSchema: listCoordinationsOutputSchema,
      annotations: readOnlyAnnotations
    },
    async () => {
      try {
        const body = await client.listStoryWorkCoordinations();
        return mcpToolOkStructured(body);
      } catch (error) {
        return mapBridgeToolError(error);
      }
    }
  );

  server.registerTool(
    GET_STORY_WORK_COORDINATION_TOOL_NAME,
    {
      title: "Get story work coordination detail",
      description:
        "Read one granted story work coordination and projected child assignment status.",
      inputSchema: z.object({
        coordinationId: boundedId.describe(
          "Story work coordination ID allowed by the active grant."
        )
      }),
      outputSchema: getStoryWorkCoordinationOutputSchema,
      annotations: readOnlyAnnotations
    },
    async ({ coordinationId }) => {
      try {
        const detail = await client.getStoryWorkCoordination(coordinationId);
        return mcpToolOkStructured(detail);
      } catch (error) {
        return mapBridgeToolError(error);
      }
    }
  );

  registerMcpCaptureBridgeTools(server, client);
  registerStoryWorkGrantBridgeSubmitTools(server, client);
  registerStoryWorkGrantBridgeMutationTools(server, client);
}
