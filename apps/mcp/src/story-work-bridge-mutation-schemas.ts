import {
  SCENE_DRAFT_V1_MAX_SOURCE_SCENES,
  STORY_STRUCTURE_MAX_OPERATIONS,
  STORY_WORK_COORDINATION_MAX_SURROUNDING_SCENES,
  STORY_WORK_COORDINATION_TITLE_MAX,
  isAgentModelId
} from "@ghostwriter/core";
import { z } from "zod";
import { mcpBridgeStoryWorkArtifactSchema } from "./story-work-bridge-submit-schemas.js";

const bridgeId = z.string().trim().min(1).max(200);
const exactWriterText = (maximum: number) =>
  z.string().min(1).max(maximum).refine((value) => value.trim().length > 0, {
    message: "Writer text must not be blank."
  });
const positiveVersion = z.number().int().positive();
const structureOperationId = z.string().trim().min(1).max(200);

const coordinationWriterFields = {
  brief: exactWriterText(20_000),
  constraints: exactWriterText(8_000),
  doneWhen: exactWriterText(4_000),
  model: z.string().trim().refine(isAgentModelId, "Unsupported model.")
} as const;

const mcpBridgeCoordinationSceneStepSchema = z
  .object({
    title: exactWriterText(STORY_WORK_COORDINATION_TITLE_MAX),
    ...coordinationWriterFields,
    sceneIds: z.array(bridgeId).max(SCENE_DRAFT_V1_MAX_SOURCE_SCENES)
  })
  .strict()
  .refine((body) => new Set(body.sceneIds).size === body.sceneIds.length, {
    path: ["sceneIds"],
    message: "Selected scene IDs must be unique."
  });

const mcpBridgeCoordinationCheckStepSchema = z
  .object({
    title: exactWriterText(STORY_WORK_COORDINATION_TITLE_MAX),
    ...coordinationWriterFields,
    surroundingSceneIds: z
      .array(bridgeId)
      .max(STORY_WORK_COORDINATION_MAX_SURROUNDING_SCENES)
  })
  .strict()
  .refine(
    (body) => new Set(body.surroundingSceneIds).size === body.surroundingSceneIds.length,
    {
      path: ["surroundingSceneIds"],
      message: "Surrounding scene IDs must be unique."
    }
  );

/** v1 bridge create: one scene-draft root + one deferred continuity check. */
export const mcpBridgeCreateCoordinationInputSchema = z
  .object({
    expectedProjectVersion: positiveVersion,
    idempotencyKey: bridgeId,
    title: exactWriterText(STORY_WORK_COORDINATION_TITLE_MAX),
    scene: mcpBridgeCoordinationSceneStepSchema,
    check: mcpBridgeCoordinationCheckStepSchema
  })
  .strict();

export const mcpBridgeContinueCoordinationStepBodySchema = z
  .object({
    expectedCoordinationVersion: positiveVersion,
    expectedUpstreamArtifact: mcpBridgeStoryWorkArtifactSchema
  })
  .strict();

export const mcpBridgeContinueCoordinationStepInputSchema =
  mcpBridgeContinueCoordinationStepBodySchema
    .extend({
      coordinationId: bridgeId,
      stepId: bridgeId
    })
    .strict();

export const mcpBridgeStructurePreviewInputSchema = z
  .object({
    assignmentId: bridgeId,
    expectedAssignmentVersion: positiveVersion,
    expectedProjectVersion: positiveVersion,
    artifact: mcpBridgeStoryWorkArtifactSchema,
    selectedOperationIds: z
      .array(structureOperationId)
      .min(1)
      .max(STORY_STRUCTURE_MAX_OPERATIONS)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Selected operation IDs must be unique."
      })
  })
  .strict();

export type McpBridgeCreateCoordinationInput = z.infer<
  typeof mcpBridgeCreateCoordinationInputSchema
>;
export type McpBridgeContinueCoordinationStepBody = z.infer<
  typeof mcpBridgeContinueCoordinationStepBodySchema
>;
export type McpBridgeContinueCoordinationStepInput = z.infer<
  typeof mcpBridgeContinueCoordinationStepInputSchema
>;
export type McpBridgeStructurePreviewInput = z.infer<
  typeof mcpBridgeStructurePreviewInputSchema
>;
