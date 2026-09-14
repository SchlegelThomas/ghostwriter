import {
  SCENE_DRAFT_V1_MAX_SOURCE_SCENES,
  isAgentModelId
} from "@ghostwriter/core";
import { z } from "zod";

const bridgeId = z.string().trim().min(1).max(200);
const exactWriterText = (maximum: number) =>
  z.string().min(1).max(maximum).refine((value) => value.trim().length > 0, {
    message: "Writer text must not be blank."
  });
const positiveVersion = z.number().int().positive();
const contentHash = z.string().regex(/^[a-f0-9]{64}$/u);

export const mcpBridgeStoryWorkArtifactSchema = z
  .object({
    proposalId: bridgeId,
    artifactVersion: positiveVersion,
    contentHash
  })
  .strict();

const mcpBridgeSubmissionBase = z
  .object({
    expectedProjectVersion: positiveVersion,
    assignmentIdempotencyKey: bridgeId,
    attemptIdempotencyKey: bridgeId,
    brief: exactWriterText(20_000),
    constraints: exactWriterText(8_000),
    doneWhen: exactWriterText(4_000),
    sceneIds: z.array(bridgeId).max(SCENE_DRAFT_V1_MAX_SOURCE_SCENES),
    model: z.string().trim().refine(isAgentModelId, "Unsupported model.")
  })
  .strict();

const uniqueSelectedScenes = <Schema extends z.ZodTypeAny>(schema: Schema) =>
  schema.refine(
    (body) => {
      const value = body as { sceneIds: readonly string[] };
      return new Set(value.sceneIds).size === value.sceneIds.length;
    },
    {
      path: ["sceneIds"],
      message: "Selected scene IDs must be unique."
    }
  );

export const mcpBridgeCharacterSubmitInputSchema = uniqueSelectedScenes(
  mcpBridgeSubmissionBase
);

/** New scene draft only — no revise targets. */
export const mcpBridgeSceneSubmitInputSchema = uniqueSelectedScenes(
  mcpBridgeSubmissionBase
    .extend({
      captureId: bridgeId.optional()
    })
    .strict()
);

const mcpBridgeCheckSubmitBase = mcpBridgeSubmissionBase
  .extend({
    specialist: z.literal("continuity"),
    targetSceneId: bridgeId
  })
  .strict();

export const mcpBridgeAppliedSceneCheckSubmitInputSchema = uniqueSelectedScenes(
  mcpBridgeCheckSubmitBase
    .extend({
      checkMode: z.literal("applied-scene")
    })
    .strict()
);

export const mcpBridgeProposalDraftCheckSubmitInputSchema = uniqueSelectedScenes(
  mcpBridgeCheckSubmitBase
    .extend({
      checkMode: z.literal("proposal-draft"),
      sourceAssignmentId: bridgeId,
      sourceArtifact: mcpBridgeStoryWorkArtifactSchema
    })
    .strict()
    .superRefine((body, context) => {
      if (body.sceneIds.includes(body.targetSceneId)) {
        context.addIssue({
          code: "custom",
          message: "Proposal-draft checks must not include the assess scene in sceneIds.",
          path: ["sceneIds"]
        });
      }
    })
);

export const mcpBridgeCheckSubmitInputSchema = z.discriminatedUnion("checkMode", [
  mcpBridgeAppliedSceneCheckSubmitInputSchema,
  mcpBridgeProposalDraftCheckSubmitInputSchema
]);

export const mcpBridgeStructureSubmitInputSchema = uniqueSelectedScenes(
  mcpBridgeSubmissionBase
    .extend({
      targetBookId: bridgeId
    })
    .strict()
);

export type McpBridgeCharacterSubmitInput = z.infer<
  typeof mcpBridgeCharacterSubmitInputSchema
>;
export type McpBridgeSceneSubmitInput = z.infer<typeof mcpBridgeSceneSubmitInputSchema>;
export type McpBridgeCheckSubmitInput = z.infer<typeof mcpBridgeCheckSubmitInputSchema>;
export type McpBridgeStructureSubmitInput = z.infer<
  typeof mcpBridgeStructureSubmitInputSchema
>;
