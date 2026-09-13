import {
  CHARACTER_CREATE_V2_MAX_ALIASES,
  CHARACTER_CREATE_V2_MAX_SOURCE_SCENES,
  isAgentModelId
} from "@ghostwriter/core";
import { z } from "zod";

const id = z.string().trim().min(1).max(200);
const exactWriterText = (maximum: number) =>
  z.string().min(1).max(maximum).refine((value) => value.trim().length > 0, {
    message: "Writer text must not be blank."
  });
const contentHash = z.string().regex(/^[a-f0-9]{64}$/u);
const positiveVersion = z.number().int().positive();

export const storyWorkArtifactSchema = z
  .object({
    proposalId: id,
    artifactVersion: positiveVersion,
    contentHash
  })
  .strict();

const characterSheetSchema = z
  .object({
    desire: exactWriterText(2_000).optional(),
    pressure: exactWriterText(2_000).optional(),
    voiceNotes: exactWriterText(2_000).optional()
  })
  .strict()
  .refine((sheet) => Object.values(sheet).some((value) => value !== undefined), {
    message: "Character sheet must include at least one field."
  });

export const characterCreateV2RequestSchema = z
  .object({
    schemaId: z.literal("character-create-v2"),
    name: exactWriterText(120),
    summary: exactWriterText(4_000),
    aliases: z
      .array(exactWriterText(120))
      .max(CHARACTER_CREATE_V2_MAX_ALIASES)
      .refine((aliases) => new Set(aliases.map((alias) => alias.trim())).size === aliases.length, {
        message: "Character aliases must be unique."
      }),
    characterSheet: characterSheetSchema,
    sourceSceneIds: z.array(id).max(CHARACTER_CREATE_V2_MAX_SOURCE_SCENES).optional()
  })
  .strict();

export const submitCharacterStoryWorkRequestSchema = z
  .object({
    taskKind: z.literal("character").optional(),
    idempotencyKey: id,
    expectedProjectVersion: positiveVersion,
    brief: exactWriterText(20_000),
    constraints: exactWriterText(8_000),
    doneWhen: exactWriterText(4_000),
    sceneIds: z.array(id).max(CHARACTER_CREATE_V2_MAX_SOURCE_SCENES),
    model: z.string().trim().refine(isAgentModelId, "Unsupported model.")
  })
  .strict()
  .refine((body) => new Set(body.sceneIds).size === body.sceneIds.length, {
    path: ["sceneIds"],
    message: "Selected scene IDs must be unique."
  });

export const generateCharacterStoryWorkRequestSchema = z
  .object({
    expectedAssignmentVersion: positiveVersion,
    kind: z.enum(["initial", "revision"]),
    sourceMode: z.enum(["submitted-snapshot", "latest-authorized"]),
    instruction: exactWriterText(20_000),
    priorArtifact: storyWorkArtifactSchema.optional(),
    idempotencyKey: id
  })
  .strict()
  .superRefine((body, context) => {
    if (body.kind === "initial" && body.priorArtifact !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["priorArtifact"],
        message: "Initial generation cannot include a prior artifact."
      });
    }
    if (
      (body.kind === "initial" && body.sourceMode !== "submitted-snapshot") ||
      (body.kind === "revision" && body.sourceMode !== "latest-authorized")
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceMode"],
        message:
          "Initial work uses submitted sources; revisions require an explicit latest-source refresh."
      });
    }
    if (body.kind === "revision" && body.priorArtifact === undefined) {
      context.addIssue({
        code: "custom",
        path: ["priorArtifact"],
        message: "Revision generation requires the current artifact."
      });
    }
  });

export const openCharacterStoryWorkReviewRequestSchema = z
  .object({
    expectedAssignmentVersion: positiveVersion,
    artifact: storyWorkArtifactSchema
  })
  .strict();

export const editCharacterStoryWorkReviewRequestSchema = z
  .object({
    expectedAssignmentVersion: positiveVersion,
    artifact: storyWorkArtifactSchema,
    payload: characterCreateV2RequestSchema
  })
  .strict();

export const applyCharacterStoryWorkRequestSchema = z
  .object({
    expectedAssignmentVersion: positiveVersion,
    proposalId: id,
    expectedArtifactVersion: positiveVersion,
    expectedProposalContentHash: contentHash,
    expectedProjectVersion: positiveVersion
  })
  .strict();

export const storyWorkAssignmentListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z
      .enum([
        "brief-ready",
        "running",
        "artifact-ready",
        "awaiting-review",
        "failed",
        "canceled",
        "stale",
        "rejected",
        "applied"
      ])
      .optional()
  })
  .strict();

export type SubmitCharacterStoryWorkRequest = z.infer<
  typeof submitCharacterStoryWorkRequestSchema
>;
export type GenerateCharacterStoryWorkRequest = z.infer<
  typeof generateCharacterStoryWorkRequestSchema
>;
export type EditCharacterStoryWorkReviewRequest = z.infer<
  typeof editCharacterStoryWorkReviewRequestSchema
>;
export type ApplyCharacterStoryWorkRequest = z.infer<
  typeof applyCharacterStoryWorkRequestSchema
>;
